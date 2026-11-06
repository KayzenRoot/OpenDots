#!/bin/sh
# NexBot restore: PostgreSQL + SQLite from a backup produced by backup.sh.
# Loud and idempotent: the order is fixed and every step is printed.
#
# Order (documented, do not reorder):
#   1. stop the app          (no writers)
#   2. restore PostgreSQL    (drop + recreate the database, then pg_restore)
#   3. restore SQLite        (replace the file and drop stale -wal/-shm)
#   4. start the app
#   5. verify readiness      (/api/ready, falling back to /api/health)
#
# Usage:
#   deployment/restore.sh <backup-dir>
#   FORCE=1 deployment/restore.sh <backup-dir>      # skip the confirmation prompt
#
# Configuration (environment):
#   COMPOSE_FILES   e.g. "-f compose.yml -f compose.computers.yml"
#                                                     (default "-f compose.yml")
#   PG_SERVICE      postgres service name               (default postgres)
#   APP_SERVICE     app service name                    (default app)
#
# Never prints secrets: the password is read from the postgres container's own
# environment and is never echoed or passed on the command line.
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILES=${COMPOSE_FILES:-"-f compose.yml"}
PG_SERVICE=${PG_SERVICE:-postgres}
APP_SERVICE=${APP_SERVICE:-app}
FORCE=${FORCE:-0}

log() { printf '[restore] %s\n' "$*" >&2; }
die() {
  printf '[restore] ERROR: %s\n' "$*" >&2
  exit 1
}

# shellcheck disable=SC2086
compose() { docker compose $COMPOSE_FILES "$@"; }

command -v docker >/dev/null 2>&1 || die 'docker is not installed or not on PATH.'
cd "$REPO_ROOT"

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <backup-dir>\n' "$0" >&2
  exit 2
fi
backup_dir=$1
[ -d "$backup_dir" ] || die "backup directory not found: $backup_dir"
[ -f "$backup_dir/nexbot.pgdump" ] || die "missing $backup_dir/nexbot.pgdump"
[ -f "$backup_dir/nexbot.sqlite" ] || die "missing $backup_dir/nexbot.sqlite"

log "about to restore from: $backup_dir"
log "plan:"
log "  1. stop $APP_SERVICE"
log "  2. DROP and recreate the PostgreSQL database, then pg_restore"
log "  3. replace the SQLite file (removes stale -wal/-shm)"
log "  4. start $APP_SERVICE"
log "  5. verify readiness"
log "This OVERWRITES current conversations and app state."

if [ "$FORCE" != "1" ]; then
  printf '[restore] type exactly RESTORE to continue: ' >&2
  answer=''
  read -r answer || answer=''
  [ "$answer" = "RESTORE" ] || die 'aborted (confirmation not given)'
fi

# --- 1. stop the app ---------------------------------------------------------
log "step 1/5: stopping $APP_SERVICE"
compose stop "$APP_SERVICE" >/dev/null || die "could not stop $APP_SERVICE"

# --- 2. restore PostgreSQL ---------------------------------------------------
log "step 2/5: restoring PostgreSQL"
compose cp "$backup_dir/nexbot.pgdump" "$PG_SERVICE:/tmp/nexbot-restore.pgdump" \
  || die 'could not copy the PostgreSQL dump into the postgres container'
compose exec -T "$PG_SERVICE" sh -c '
  set -eu
  export PGPASSWORD="$POSTGRES_PASSWORD"
  # --force terminates any lingering connections so DROP cannot fail.
  dropdb --if-exists --force -h 127.0.0.1 -U "$POSTGRES_USER" "$POSTGRES_DB"
  createdb -h 127.0.0.1 -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"
  pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --no-owner --no-privileges -Fc /tmp/nexbot-restore.pgdump
' || die 'PostgreSQL restore failed'
compose exec -T "$PG_SERVICE" rm -f /tmp/nexbot-restore.pgdump >/dev/null 2>&1 || true

# --- 3. restore SQLite -------------------------------------------------------
log "step 3/5: restoring SQLite"
# The app service drops all capabilities, so root alone cannot unlink a file
# owned by `node`. Re-add only DAC_OVERRIDE for this one-shot restore container
# so it can replace the SQLite file, then chown it back to the app user.
compose run -T --rm --no-deps --user 0:0 --cap-add DAC_OVERRIDE --cap-add CHOWN \
  -v "$backup_dir:/restore:ro" \
  --entrypoint sh "$APP_SERVICE" -c '
    set -eu
    db="${DATABASE_PATH:-/data/nexbot.sqlite}"
    rm -f "$db" "$db-wal" "$db-shm"
    cp /restore/nexbot.sqlite "$db"
    # chmod while root still owns the fresh copy: after chown it belongs to
    # `node`, and root without CAP_FOWNER could not change its mode.
    chmod 0644 "$db"
    # The app runs as `node`; a root-owned file makes SQLite fail with
    # "attempt to write a readonly database", so ownership is not optional.
    chown node:node "$db"
  ' || die 'SQLite restore failed'

# --- 4. start the app --------------------------------------------------------
log "step 4/5: starting $APP_SERVICE"
compose up -d "$APP_SERVICE" >/dev/null || die "could not start $APP_SERVICE"

# --- 5. verify ---------------------------------------------------------------
log "step 5/5: waiting for readiness"
attempt=0
until compose exec -T "$APP_SERVICE" node --input-type=module -e '
  const base = "http://127.0.0.1:4310";
  const ready = await fetch(base + "/api/ready").catch(() => null);
  if (ready && ready.ok) process.exit(0);
  const health = await fetch(base + "/api/health").catch(() => null);
  process.exit(health && health.ok ? 0 : 1);
'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    die 'app did not become ready within 120s; inspect `docker compose logs app`'
  fi
  sleep 2
done

log "restore complete and the app reports ready."
log "If conversation data looks wrong, check pairing: SQLite thread_bindings.id"
log "must exist in PostgreSQL conversations.id and vice versa."
