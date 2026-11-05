# Deployment

How to run the decoupled fork on an owner-controlled VPS, and how to recover it.
**No CopilotKit account, project selection, or API key is needed.** The only
mandatory external credential is an OpenAI-compatible model endpoint.

Status: the existing Compose files (`compose.yml`, `compose.computers.yml`,
`compose.computers-app.yml`) target the upstream app; the Postgres service, the
new env template, health checks, and the backup/restore procedures described
here are PLANNED for WORK-008 and must be added before this is a validated
procedure.

## 1. Resource requirements

| Component                      | CPU    | RAM         | Disk                  | Notes                                                                                        |
| ------------------------------ | ------ | ----------- | --------------------- | -------------------------------------------------------------------------------------------- |
| app                            | 1 vCPU | 1 GB        | ~1 GB image + volumes | Hono + `node:sqlite`; the busy part is agent runs, which are mostly network-bound            |
| Postgres                       | 1 vCPU | 512 MB–1 GB | 5–20 GB               | Conversations grow with use; `thread_events` is the fast-growing table                       |
| browser (optional)             | 1 vCPU | 1 GB        | ~1 GB                 | Playwright chromium; `shm_size: 256mb`; `read_only` + tmpfs                                  |
| computer supervisor (optional) | 1 vCPU | 512 MB      | ~2 GB image           | Each Dot computer consumes additional RAM/Disk (`COMPUTER_MEMORY_BYTES`, default 2147483648) |

Minimum for the core stack (app + Postgres): a 2 vCPU / 2 GB VPS with 20 GB
disk. Add ~1 GB RAM + 1 GB image for the browser profile; add capacity per
computer if using persisted computers.

## 2. Docker Compose topology

```
                 ┌──────────────────── host (VPS) ─────────────────────┐
   :443 ──► reverse proxy (Caddy/nginx/Traefik)  ──►  127.0.0.1:4310
                                                              │
                                                      app container (4310)
                                                        │           │
                              app-egress (egress) ──────┘           └── browser-link ─► browser (4311)
                                                                                        [profile: browser]
   Postgres (5432, internal only) ◄──── app (conversation store)
   computer-supervisor (4312→4300, optional)  ── Docker socket (only mounter)
```

- `compose.yml` defines `app` (port `127.0.0.1:4310` published, volumes
  `opendots-data:/data`, networks `browser-link` + `app-egress`,
  `no-new-privileges`, `cap_drop: ALL`, `restart: unless-stopped`, `init: true`)
  and `browser` (profile `browser`, `read_only`, tmpfs `/tmp`, `shm_size: 256mb`,
  internal `browser-link`, egress `browser-egress`).
- **PLANNED (WORK-008):** add a `postgres` service to `compose.yml` on an
  internal network with a named volume, and set `DATABASE_URL` (or `PG*`
  variables) for the app. The app's 4310 port should remain bound to loopback
  and be fronted by the reverse proxy.
- `compose.computers.yml` builds and runs the computer supervisor (pinned to
  OpenBot `b6932d31a8d6e7896c15139dfc27a6c6911deb27`), publishing
  `127.0.0.1:4312:4300`, mounting the Docker socket, `cap_drop: [ALL]`, with a
  `/health` healthcheck that also asserts `docker` availability.
- `compose.computers-app.yml` is an overlay for an app running in Compose: it
  points the app at `http://computer-supervisor:4300` over the internal
  `computer-control` network and removes the host-published supervisor port.

## 3. Environment variable template

`.env` (server only; never commit). Required marked **R**. Start from
`.env.example` and remove the CopilotKit-only entries after WORK-004.

```dotenv
# --- Core ---------------------------------------------------------------
HOST=0.0.0.0                 # external binding requires OWNER_TOKEN (24+ chars)
PORT=4310
OWNER_TOKEN=                 # R for external binding; 24+ chars; bearer login
OWNER_ID=opendots-owner      # keep stable
APP_ORIGIN=https://dots.example.com   # exact origin(s), comma-separated
DATABASE_PATH=/data/opendots.sqlite   # SQLite (app state)

# --- PostgreSQL (conversations) --- PLANNED WORK-003/008 -----------------
DATABASE_URL=postgres://opendots:***@postgres:5432/opendots
# or discrete PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
PGSSLMODE=require            # depends on network placement

# --- Model endpoint REQUIRED for agent runs -----------------------------
OPENAI_BASE_URL=https://api.openai.com/v1   # or Ollama/vLLM/LM Studio/...
OPENAI_API_KEY=
OPENAI_MODEL=
AGENT_RUN_TIMEOUT_MS=90000

# --- Optional: voice ----------------------------------------------------
VOICE_API_KEY=
VOICE_MODEL=
VOICE_NAME=marin

# --- Optional: web search ----------------------------------------------
WEB_SEARCH_PROVIDER=parallel  # parallel | browser | disabled
PARALLEL_API_KEY=

# --- Optional: isolated browser (needed only for provider=browser) ------
BROWSER_URL=http://browser:4311
BROWSER_SECRET=               # 24+ chars, shared by app and browser
BROWSER_HOST=0.0.0.0
BROWSER_PORT=4311

# --- Optional: Composio connected apps ---------------------------------
COMPOSIO_API_KEY=

# --- Optional: self-hosted Slack (WORK-005) -----------------------------
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
SLACK_TEAM_ID=
SLACK_USER_IDS=
SLACK_DOT_ID=

# --- Optional: computers (OpenBot supervisor) ---------------------------
COMPUTER_SUPERVISOR_URL=
COMPUTER_SUPERVISOR_TOKEN=     # 24+ chars
COMPUTER_TOKEN=               # 24+ chars, master token (derivation uses HMAC)
COMPUTER_NAMESPACE=opendots   # keep stable; identifies containers/volumes
```

Removed by WORK-004: `CPK_INTELLIGENCE_API_KEY`, `INTELLIGENCE_API_KEY`,
`INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, `INTELLIGENCE_WS_URL`,
`CPK_TELEMETRY_ID`, `COPILOTKIT_TELEMETRY_*`, `DO_NOT_TRACK` (kept harmless),
and the managed `SLACK_CHANNEL_NAME` in favour of the self-hosted
`SLACK_SIGNING_SECRET`/`SLACK_BOT_TOKEN`.

## 4. HTTPS, reverse proxy, and network exposure

- Terminate TLS at a reverse proxy (Caddy with automatic certs, nginx, or
  Traefik) and proxy to `127.0.0.1:4310`. Set `APP_ORIGIN` to the public HTTPS
  origin so the origin allowlist matches.
- Keep the app port bound to loopback; never publish `4310` publicly.
- Expose only `:443` (and `:80` only for ACME/redirect). Postgres, the browser
  service (`4311`), and the supervisor (`4312`) must **not** be reachable from
  the internet. On a cloud VPS, enforce this in the provider firewall/security
  group as well as the host firewall.
- Add rate limiting and request-size limits at the proxy (the app has no
  per-IP rate limiting; see [SECURITY.md](./SECURITY.md) §9).
- If you use the self-hosted Slack integration, Slack must reach the public
  webhook URL (`/api/slack/events`) over HTTPS; allowlist Slack's egress IPs if
  your proxy supports it.

## 5. Health and readiness

| Endpoint                          | Use                                                                                                      | Status             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------ |
| `GET /api/health`                 | Liveness: process is serving. No datastore access, no auth.                                              | PLANNED (WORK-008) |
| `GET /api/ready`                  | Readiness: SQLite reachable, Postgres reachable and migrated, required config present. `503` until true. | PLANNED (WORK-008) |
| `GET /health` (browser container) | Liveness for the browser service.                                                                        | DONE               |

Wire `/api/health` to the container healthcheck and `/api/ready` to the reverse
proxy's upstream check. The supervisor already has a `/health` that asserts
Docker availability.

## 6. Restart policies and lifecycle

- `restart: unless-stopped` on app, browser, and supervisor; `init: true` on
  app and browser to reap child processes.
- Postgres (PLANNED service) should use `restart: unless-stopped` and a
  `pg_isready` healthcheck; the app should wait for Postgres readiness before
  accepting turns (or fail `/api/ready` until then).
- The app handles `SIGTERM`/`SIGINT` via `createShutdown`
  (`src/server/shutdown.ts`): stops the task runner, stops the platform
  (including channels), closes the HTTP server, then exits.
- On boot, `PostgresAgentRunner` must reconcile runs left in `running` state
  (mark failed/abandoned) so recovery is deterministic.

## 7. Volumes and persistent data

| Data                         | Location                                               | Backup needed                          |
| ---------------------------- | ------------------------------------------------------ | -------------------------------------- |
| App state (SQLite)           | named volume `opendots-data` → `/data/opendots.sqlite` | Yes (paired with Postgres)             |
| Conversations (Postgres)     | PLANNED named volume → `/var/lib/postgresql/data`      | Yes (paired with SQLite)               |
| Computer workspaces/profiles | supervisor-managed named volumes (per Dot)             | Optional; do not delete during updates |
| Browser service              | none (read-only, tmpfs)                                | No                                     |

Never delete the `opendots-data` volume or the Postgres volume during a normal
update. The supervisor notes that profile/workspace volumes must be retained
across credential changes.

## 8. Backup and restore

The two datastores share conversation IDs (see
[DATA-MODEL.md](./DATA-MODEL.md) §2.1), so they must be backed up and restored
as **one consistent pair**.

### 8.1 Backup (quiesce or accept a brief window)

1. Stop the app container (so no turns are writing):
   `docker compose stop app`.
2. SQLite: copy the file **and** its WAL/SHM sidecars, or use
   `sqlite3 /data/opendots.sqlite ".backup /backup/opendots.sqlite"` from a
   helper container.
3. Postgres: `docker compose exec -T postgres pg_dump -Fc -U opendots opendots
   > /backup/opendots.pgdump`.
4. Start the app: `docker compose start app`.
5. Store the pair together with a timestamp and the git commit of the running
   build.

### 8.2 Restore

1. Stop the app.
2. Restore Postgres: recreate the database and
   `pg_restore -Fc -U opendots -d opendots /backup/opendots.pgdump`.
3. Restore SQLite: replace `/data/opendots.sqlite` (remove stale `-wal`/`-shm`
   before restoring).
4. Start the app.
5. **Reconcile** (catch dangling references after a partial restore):
   - SQLite `thread_bindings.id` not present in Postgres `conversations.id`.
   - Postgres `conversations.id` with no SQLite `thread_bindings.id`.
     Report and handle per policy (re-bind or archive). This reconciliation is
     required by [DATA-MODEL.md](./DATA-MODEL.md) §2.1 and is part of WORK-008.

### 8.3 Validation

WORK-008 must demonstrate a full round-trip: seed a conversation, back up both
stores, destroy the volumes, restore, and confirm the conversation and its
messages, events, and bound pages are intact and the app reports ready.

## 9. Upgrade and rollback

### Upgrade

1. `git fetch && git checkout <tag/commit>` (pin a commit; do not track `main`
   blindly).
2. `docker compose build app` (and `browser` if changed).
3. Stop app; run Postgres migrations via the app's startup path (idempotent,
   versioned — see [DATA-MODEL.md](./DATA-MODEL.md) §1.2).
4. Start app; confirm `/api/ready` returns 200.
5. Smoke test one chat turn and the conversation list.

### Rollback

1. Stop app.
2. `git checkout <previous-commit>`; `docker compose build app`.
3. If migrations are forward-only, restore the Postgres backup taken before the
   upgrade (Section 8) and restore SQLite only if app-state schema changed.
4. Start app; confirm `/api/ready`.

Migrations must be additive/forward-compatible where possible so a rollback
does not require a database restore. Any non-additive migration must be
documented as such in the WORK-003 migration notes.

## 10. Firewall and exposure summary

| Port                     | Expose publicly?                       |
| ------------------------ | -------------------------------------- |
| 443 (proxy → app)        | Yes                                    |
| 80 (ACME/redirect)       | Optional                               |
| 4310 (app)               | No — loopback only, behind proxy       |
| 5432 (Postgres)          | No — internal network only             |
| 4311 (browser)           | No — internal network only             |
| 4312 / 4300 (supervisor) | No — loopback or internal network only |

## 11. Explicit non-requirement

**No CopilotKit account, project, or API key is required to deploy this fork.**
The deployment uses only owner-controlled infrastructure (owner Postgres, owner
backend, owner agent runtime) plus an owner-selected OpenAI-compatible model
endpoint.
