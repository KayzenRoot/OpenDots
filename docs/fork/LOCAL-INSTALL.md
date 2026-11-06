# Local installation (Windows, for testing)

Runs the full stack on one machine: **app + PostgreSQL + reverse proxy**, with a
single stable URL. Nothing is exposed beyond loopback.

This is the test installation. For the VPS use
[DEPLOYMENT.md](./DEPLOYMENT.md) and `deployment/Caddyfile`, which terminates
HTTPS for a real domain.

## One-click install (desktop app)

`deployment/windows/NexBot.exe` is a native launcher (no console window):

- **Double-click** — checks the stack, starts it if it is down, then opens
  NexBot in its **own application window** (Edge/Chrome application mode: no
  address bar, its own taskbar entry). The Desktop and Start Menu shortcuts
  point at it.
- **`NexBot.exe --install`** — runs the full installer: verifies Docker,
  generates `.env.local` with random database and owner-token secrets, builds
  the image, starts the stack, waits for readiness, installs autostart, and
  creates the shortcuts.

Rebuild the executable after editing `NexBot.cs` with
`deployment\windows\build-launcher.cmd` (uses the C# compiler that ships with
.NET Framework; no SDK needed). The binary is gitignored.

To use a different browser, the launcher tries Edge first, then Chrome, then
falls back to the default browser.

## What runs

| Service    | Image / build                        | Address                              | Purpose                            |
| ---------- | ------------------------------------ | ------------------------------------ | ---------------------------------- |
| `app`      | built from this repo (`target: app`) | `127.0.0.1:4310`                     | Hono server + built client         |
| `postgres` | `postgres:17-alpine`                 | internal only, **no published port** | conversations, runs, state, skills |
| `caddy`    | `caddy:2-alpine`                     | `127.0.0.1:8080`                     | single entry URL, unbuffered SSE   |

Open **http://localhost:8080**.

The direct app port `4310` stays published for debugging; both are in
`APP_ORIGIN`, so either works.

## Requirements

- Docker Desktop running (Compose v2).
- Node is **not** required on the host: the build happens inside the image.

## First-time setup

1. Create the environment file. It is gitignored and must never be committed:

   ```powershell
   Copy-Item .env.example .env.local
   notepad .env.local
   ```

   Minimum to fill in:

   - `DATABASE_URL` — `postgres://nexbot:<password>@postgres:5432/nexbot`
   - `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — must match
     `DATABASE_URL`
   - `OWNER_TOKEN` — 24+ random characters (this is the login token)
   - `APP_ORIGIN` — `http://localhost:4310,http://127.0.0.1:4310,http://localhost:8080,http://127.0.0.1:8080`
   - `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and
     `OPENAI_EXTRA_HEADERS` if your gateway needs routing headers

2. Start it:

   ```powershell
   powershell -ExecutionPolicy Bypass -File deployment\windows\start.ps1
   ```

   The script waits for `/api/ready` and prints the URL, so a green result means
   the database migrated and the app is serving.

## Day-to-day

```powershell
powershell -ExecutionPolicy Bypass -File deployment\windows\status.ps1
powershell -ExecutionPolicy Bypass -File deployment\windows\stop.ps1
powershell -ExecutionPolicy Bypass -File deployment\windows\start.ps1
```

`stop` keeps the volumes, so conversations and app state survive.

## Autostart at logon

```powershell
powershell -ExecutionPolicy Bypass -File deployment\windows\install-autostart.ps1
```

It writes `NexBot.vbs` into the per-user Startup folder, which needs no
administrator rights (a scheduled task would). Remove it by deleting that file;
the script prints the exact path.

## Slack

The Slack app's Request URL must be publicly reachable over HTTPS, so loopback
is not enough. For a test machine, expose the proxy with a tunnel and point the
manifest at it:

```powershell
cloudflared tunnel --url http://127.0.0.1:8080
```

Then set the Slack app's Event Subscriptions URL to
`https://<tunnel-host>/api/slack/events` and restart the app so it picks up
`SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` / `SLACK_USER_IDS` from `.env.local`.
The tunnel is temporary: when it closes, Slack events stop until it is
restarted. A real deployment avoids this with a stable domain.

## Backup and restore

Both stores must be kept as a pair. With the local overlay the service names are
unchanged, so:

```powershell
$env:COMPOSE_PROJECT_NAME = 'nexbot'
sh deployment/backup.sh
```

Pass `COMPOSE_FILES="-f compose.yml -f compose.local.yml"` and
`BACKUP_DIR` as needed, and use a Windows-style `BACKUP_DIR` (for example
`D:/nexbot/backups`): a POSIX `/d/...` path is not resolvable by the Docker
bind mount.

Restore with `deployment/restore.sh <backup-dir>`. If the stack was started
with the overlay, pass the same `COMPOSE_FILES` so the proxy is not orphaned.

## Troubleshooting

| Symptom                                 | Check                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `start.ps1` throws "Missing .env.local" | create it from `.env.example`                                             |
| App restarts in a loop                  | `docker compose -p nexbot logs app` — usually a bad value in `.env.local` |
| 503 on `/api/ready`                     | the body names the missing variables; the database may be unreachable     |
| Slack does nothing                      | the tunnel is down, or the Request URL no longer matches it               |
| Port already in use                     | another stack is running; check `docker ps` before starting               |
