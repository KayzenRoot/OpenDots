# NexBot deployment runbook

Operate the decoupled, self-hosted NexBot fork on your own Linux VPS.
**No CopilotKit account, project, or API key is required.** Conversations live in
your own PostgreSQL; everything else stays in SQLite; the app talks only to the
OpenAI-compatible model endpoint you choose.

- Topology and rationale: [`docs/fork/ARCHITECTURE.md`](../docs/fork/ARCHITECTURE.md)
- Planned-vs-built status: [`docs/fork/DEPLOYMENT.md`](../docs/fork/DEPLOYMENT.md)

## 1. Prerequisites

- A Linux VPS (2 vCPU / 2 GB RAM / 20 GB disk minimum for app + Postgres).
- Docker Engine 24+ with the Compose v2 plugin (`docker compose version`).
- A public domain pointing at the VPS (for HTTPS), ports 80 and 443 reachable.
- Git, and `openssl` for secret generation.
- Node.js 24 is only needed if you build outside Docker; the Docker build
  handles it.

## 2. First install

```sh
git clone <your-fork-url> /opt/nexbot
cd /opt/nexbot
git checkout fork/decouple-and-harden          # pin a commit, do not track main
cp .env.example .env
```

Generate the two core secrets (each 24+ characters) and put them in `.env`:

```sh
openssl rand -base64 48      # -> OWNER_TOKEN
openssl rand -base64 48      # -> POSTGRES_PASSWORD
```

Fill in `.env`. The required values are:

| Variable            | Notes                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| `OWNER_TOKEN`       | 24+ chars. Bearer login + every `/api` call. Treat as a password.            |
| `DATABASE_URL`      | `postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>` |
| `POSTGRES_USER`     | Default `nexbot`.                                                            |
| `POSTGRES_PASSWORD` | Must match the password inside `DATABASE_URL`.                               |
| `POSTGRES_DB`       | Default `nexbot`.                                                            |
| `APP_ORIGIN`        | Your public HTTPS origin, e.g. `https://dots.example.com`.                   |
| `OPENAI_BASE_URL`   | Model endpoint (OpenAI, Ollama, vLLM, LM Studio, OpenRouter, ...).           |
| `OPENAI_MODEL`      | Model id served by that endpoint.                                            |

`HOST=0.0.0.0` in the template is correct inside the container; only the proxy
binds publicly.

Start the core stack (app + Postgres):

```sh
docker compose up -d --build
```

Start the core stack plus the optional read-only browser service (needed only
for `WEB_SEARCH_PROVIDER=browser`):

```sh
docker compose --profile browser up -d --build
```

Add the optional computer supervisor (one container per Dot) by layering the
overlays, in this order:

```sh
docker compose -f compose.yml -f compose.computers.yml -f compose.computers-app.yml \
  build computer-image computer-supervisor app browser
docker compose -f compose.yml -f compose.computers.yml -f compose.computers-app.yml \
  up -d app browser computer-supervisor
```

The Docker socket is mounted **only** into `computer-supervisor`; the app and
each Dot computer never receive it.

## 3. Migrations

There is no separate migration command to run. On every start the app applies
its idempotent, versioned PostgreSQL migrations as part of boot:

- The app container's entrypoint validates config, waits (bounded, 60s) for
  Postgres to accept connections, then `exec`s the server.
- The server runs migrations during startup and **exits non-zero** if they
  cannot run. Because the entrypoint `exec`s it, the container fails fast rather
  than serving with an unmigrated database.
- `depends_on: condition: service_healthy` already holds the app until
  `pg_isready` passes, so the wait is a second, explicit guard.

To watch migrations: `docker compose logs -f app`.

## 4. Health and readiness

| Check            | Command                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Container health | `docker compose ps` (uses the image `HEALTHCHECK`)                                                                              |
| App liveness     | `curl -fsS http://127.0.0.1:4310/api/health`                                                                                    |
| App readiness    | `curl -fsS http://127.0.0.1:4310/api/ready`                                                                                     |
| Browser liveness | `docker compose --profile browser exec browser node -e 'fetch("http://127.0.0.1:4311/health").then(r=>process.exit(r.ok?0:1))'` |
| Postgres         | `docker compose exec postgres pg_isready -U "$POSTGRES_USER"`                                                                   |

`/api/health` and `/api/ready` are documented as PLANNED in
`docs/fork/DEPLOYMENT.md`; if they 404 on your build, the app-side workstream
has not landed them yet.

## 5. Reverse proxy (HTTPS)

Prefer Caddy: [`Caddyfile`](./Caddyfile) does automatic TLS.
Alternative: [`nginx.conf.example`](./nginx.conf.example) (with certbot notes).

The app's port stays bound to `127.0.0.1:4310`. Never publish 4310.

Run Caddy as a container on the app's network by saving this as
`deployment/compose.caddy.yml` and layering it:

```yaml
services:
  caddy:
    image: caddy:2.10-alpine
    ports:
      - '80:80'
      - '443:443'
    environment:
      NEXBOT_DOMAIN: ${NEXBOT_DOMAIN:?Set NEXBOT_DOMAIN in .env}
      ACME_EMAIL: ${ACME_EMAIL:-admin@example.com}
    volumes:
      - ./deployment/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - app-egress
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
volumes:
  caddy-data:
  caddy-config:
```

```sh
docker compose -f compose.yml -f deployment/compose.caddy.yml up -d
```

If you run Caddy (or nginx) directly on the host instead, change the upstream
from `app:4310` to `127.0.0.1:4310` in the proxy config.

## 6. Firewall

Expose only 80 and 443 publicly. Nothing else.

```sh
sudo ufw default deny incoming
sudo ufw allow 22/tcp        # SSH: restrict to your IP if possible
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

| Port      | Service             | Public?                            |
| --------- | ------------------- | ---------------------------------- |
| 80/443    | reverse proxy       | Yes                                |
| 4310      | app                 | No — loopback only, behind proxy   |
| 5432      | Postgres            | No — internal network, no `ports:` |
| 4311      | browser service     | No — internal network only         |
| 4312/4300 | computer supervisor | No — loopback/internal only        |

On a cloud VPS enforce this in the provider security group too, not only on the
host.

## 7. Upgrade

```sh
cd /opt/nexbot
git fetch && git checkout <new-commit-or-tag>   # pin; do not track main blindly
docker compose build app browser                # browser only if it changed
docker compose stop app
docker compose up -d app                        # applies migrations on boot
docker compose logs -f app                      # confirm migrations + readiness
curl -fsS http://127.0.0.1:4310/api/ready
```

Smoke-test one chat turn and the conversation list in the UI.

## 8. Rollback

```sh
cd /opt/nexbot
docker compose stop app
git checkout <previous-commit>
docker compose build app
docker compose up -d app
curl -fsS http://127.0.0.1:4310/api/ready
```

Migrations are additive/forward-compatible where possible. If a release
contains a non-additive migration, restore the Postgres backup taken before the
upgrade (Section 9) before starting the old build.

## 9. Backup and restore

```sh
# Consistent pair into ./backups/nexbot-backup-<UTC timestamp>/
deployment/backup.sh

# Prune older than 30 days instead of the 14-day default, online (no downtime):
RETENTION_DAYS=30 QUIESCE=0 deployment/backup.sh

# Restore (asks for confirmation; prints the fixed order):
deployment/restore.sh backups/nexbot-backup-20260101-030000
```

- `backup.sh` stops the app by default (`QUIESCE=1`) so the SQLite and Postgres
  pair is consistent, then restarts it. It dumps Postgres with
  `pg_dump -Fc` and snapshots SQLite with a consistent online copy
  (`sqlite3 .backup` on the host, or `node:sqlite`'s `backup()` via the app image
  when the DB lives in a volume), verifies integrity, writes a
  `MANIFEST.txt`, and prunes old backups.
- `restore.sh` stops the app, drops and recreates the Postgres database, restores
  Postgres, replaces the SQLite file (dropping stale `-wal`/`-shm`), starts the
  app, and waits for readiness. It is idempotent and can be re-run.
- Schedule it from cron (as a user that can run `docker`):

  ```cron
  15 3 * * *  cd /opt/nexbot && QUIESCE=0 ./deployment/backup.sh >>/var/log/nexbot-backup.log 2>&1
  ```

  Use `QUIESCE=1` (default) if you accept a brief stop for a fully consistent
  pair; `QUIESCE=0` avoids downtime but the two stores may differ by in-flight
  turns.

After a restore, verify pairing if anything looks wrong: SQLite
`thread_bindings.id` must exist in PostgreSQL `conversations.id`, and vice
versa.

## 10. Resource requirements

| Component                      | CPU    | RAM         | Disk                  |
| ------------------------------ | ------ | ----------- | --------------------- |
| app                            | 1 vCPU | 1 GB        | ~1 GB image + volumes |
| Postgres                       | 1 vCPU | 512 MB–1 GB | 5–20 GB               |
| browser (optional)             | 1 vCPU | 1 GB        | ~1 GB                 |
| computer supervisor (optional) | 1 vCPU | 512 MB      | ~2 GB image           |

`compose.yml` sets `deploy.resources.limits` of 1 CPU / 1 GB for both `app` and
`postgres` as recommended minimums; raise them for heavy concurrent use. Each
Dot computer consumes additional RAM/disk (`COMPUTER_MEMORY_BYTES`, default
2 GiB).

## 11. systemd (optional)

Operators who prefer systemd over Compose restart policies can use
[`nexbot.service.example`](./nexbot.service.example). It runs
`docker compose up` on boot with `NoNewPrivileges` and a dedicated user. Follow
the install steps in the file header.
