#!/bin/sh
# OpenDots app container entrypoint.
#
# Responsibilities:
#   1. Fail fast if required configuration is missing.
#   2. Wait, briefly and with a hard bound, for PostgreSQL to accept TCP
#      connections. The app applies its idempotent, versioned schema migrations
#      on startup, so a reachable Postgres is a precondition, not a nicety.
#   3. `exec` the app so migrations run as part of start and the app's exit code
#      (non-zero when migrations cannot run) becomes the container's exit code.
#
# Failure is never swallowed: `set -eu` plus `exec` means any error here or in
# the app is the container's non-zero exit status.
set -eu

log() {
  printf '[entrypoint] %s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

die() {
  log "FATAL: $*"
  exit 1
}

[ -n "${DATABASE_URL:-}" ] || die 'DATABASE_URL is required (PostgreSQL connection string).'
[ -n "${DATABASE_PATH:-}" ] || die 'DATABASE_PATH is required (SQLite file path).'

node -e '
try {
  const u = new URL(process.env.DATABASE_URL);
  if (!u.hostname) process.exit(1);
} catch {
  process.exit(1);
}
' || die 'DATABASE_URL is not a valid URL.'

# Bounded wait for Postgres TCP reachability. Compose normally gates this with
# the postgres healthcheck (`depends_on: condition: service_healthy`); this is a
# second, explicit guard so a manually started or restarted container fails
# loudly instead of crash-looping.
wait_seconds="${PG_WAIT_SECONDS:-60}"
elapsed=0
until node -e '
import("node:net").then(({ connect }) => {
  let u;
  try {
    u = new URL(process.env.DATABASE_URL);
  } catch {
    process.exit(2);
  }
  const sock = connect({ host: u.hostname, port: Number(u.port || 5432) });
  sock.setTimeout(4000);
  sock.on("connect", () => { sock.end(); process.exit(0); });
  sock.on("timeout", () => { sock.destroy(); process.exit(1); });
  sock.on("error", () => process.exit(1));
}).catch(() => process.exit(1));
'; do
  if [ "$elapsed" -ge "$wait_seconds" ]; then
    die "PostgreSQL not reachable at DATABASE_URL after ${wait_seconds}s; refusing to start (migrations cannot run)."
  fi
  log "waiting for PostgreSQL (${elapsed}s/${wait_seconds}s)..."
  sleep 2
  elapsed=$((elapsed + 2))
done

log "PostgreSQL reachable; running: $*"
exec "$@"
