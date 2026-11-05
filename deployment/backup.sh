#!/bin/sh
# OpenDots consistent backup: PostgreSQL (custom format) + SQLite, into one
# timestamped directory, then optional pruning. Safe for cron; fails loudly.
#
# The two datastores share conversation IDs, so they must be kept as one pair:
# both are written under the same timestamped directory in the same run.
#
# Usage:
#   deployment/backup.sh
#
# Configuration (environment):
#   BACKUP_DIR            where timestamped dirs are written   (default ./backups)
#   RETENTION_DAYS        prune dirs older than N days; 0=keep all (default 14)
#   COMPOSE_FILES         e.g. "-f compose.yml -f compose.computers.yml"
#                                                            (default "-f compose.yml")
#   PG_SERVICE            postgres service name                (default postgres)
#   APP_SERVICE           app service name (used for SQLite)   (default app)
#   QUIESCE               1=stop the app for a quiesced pair, 0=online (default 1)
#   HOST_SQLITE_PATH      host-visible SQLite file, if any; uses host sqlite3
#
# Never prints secrets: the password is read from the postgres container's own
# environment and is never echoed or passed on the command line.
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BACKUP_DIR=${BACKUP_DIR:-"$REPO_ROOT/backups"}
RETENTION_DAYS=${RETENTION_DAYS:-14}
COMPOSE_FILES=${COMPOSE_FILES:-"-f compose.yml"}
PG_SERVICE=${PG_SERVICE:-postgres}
APP_SERVICE=${APP_SERVICE:-app}
QUIESCE=${QUIESCE:-1}
HOST_SQLITE_PATH=${HOST_SQLITE_PATH:-}

log() { printf '[backup] %s\n' "$*" >&2; }
die() {
  printf '[backup] ERROR: %s\n' "$*" >&2
  exit 1
}

# shellcheck disable=SC2086
compose() { docker compose $COMPOSE_FILES "$@"; }

command -v docker >/dev/null 2>&1 || die 'docker is not installed or not on PATH.'
cd "$REPO_ROOT"

timestamp=$(date -u '+%Y%m%d-%H%M%S')
dest="$BACKUP_DIR/opendots-backup-$timestamp"
mkdir -p "$dest" || die "cannot create backup directory: $dest"

app_running=0
if [ "$QUIESCE" = "1" ] && [ -n "$(compose ps -q "$APP_SERVICE" 2>/dev/null)" ]; then
  app_running=1
fi

restart_app() {
  if [ "$app_running" = "1" ]; then
    log "starting $APP_SERVICE again"
    compose start "$APP_SERVICE" >/dev/null 2>&1 \
      || compose up -d "$APP_SERVICE" >/dev/null 2>&1 \
      || log "WARNING: could not restart $APP_SERVICE; start it manually"
  fi
}
trap 'rc=$?; restart_app; exit $rc' EXIT INT TERM

if [ "$app_running" = "1" ]; then
  log "stopping $APP_SERVICE for a quiesced backup"
  compose stop "$APP_SERVICE" >/dev/null || die "could not stop $APP_SERVICE"
else
  log "WARNING: taking an online backup (app not stopped). The two stores may"
  log "         differ by the turns that were in flight. Set QUIESCE=1 (default)"
  log "         when the app was running to stop it for a consistent pair."
fi

# --- PostgreSQL (conversations) ----------------------------------------------
log "dumping PostgreSQL to $dest/opendots.pgdump (custom format)"
# Reads POSTGRES_* from the container's own environment; no secret on the CLI.
compose exec -T "$PG_SERVICE" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  >"$dest/opendots.pgdump" || die 'pg_dump failed'
[ -s "$dest/opendots.pgdump" ] || die 'pg_dump produced an empty file'
head -c 5 "$dest/opendots.pgdump" | grep -q 'PGDMP' \
  || die 'pg_dump output is not a custom-format archive'

# --- SQLite (non-conversation state) -----------------------------------------
log "snapshotting SQLite to $dest/opendots.sqlite"
if [ -n "$HOST_SQLITE_PATH" ] && [ -f "$HOST_SQLITE_PATH" ] && command -v sqlite3 >/dev/null 2>&1; then
  rm -f "$dest/opendots.sqlite"
  sqlite3 "$HOST_SQLITE_PATH" ".backup '$dest/opendots.sqlite'" \
    || die 'sqlite3 .backup failed'
  integrity=$(sqlite3 "$dest/opendots.sqlite" 'PRAGMA integrity_check;')
  [ "$integrity" = "ok" ] || die "SQLite integrity_check failed: $integrity"
else
  # The app image ships node:sqlite (the app uses it). Its `backup()` function is
  # the programmatic equivalent of `sqlite3 .backup`: a consistent online copy.
  # It needs neither a host sqlite3 nor the file to be visible outside the
  # volume. Runs as root so it can always write into the host bind mount.
  compose run -T --rm --no-deps --user 0:0 -v "$dest:/backup" \
    --entrypoint node "$APP_SERVICE" --input-type=module -e '
      import { DatabaseSync, backup } from "node:sqlite";
      import { rmSync } from "node:fs";
      const src = process.env.DATABASE_PATH ?? "/data/opendots.sqlite";
      const out = "/backup/opendots.sqlite";
      const db = new DatabaseSync(src);
      db.exec("PRAGMA busy_timeout=5000");
      // Fold the WAL into the main file; not essential (backup() already reads
      // a consistent snapshot) so a busy checkpoint is not fatal online.
      try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
      rmSync(out, { force: true });
      await backup(db, out);
      db.close();
      const check = new DatabaseSync(out);
      const rows = check.prepare("PRAGMA integrity_check").all();
      check.close();
      if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
        console.error("SQLite integrity_check failed:", JSON.stringify(rows));
        process.exit(1);
      }
    ' || die 'container SQLite snapshot failed'
fi
[ -s "$dest/opendots.sqlite" ] || die 'SQLite snapshot is empty'

# --- Manifest ----------------------------------------------------------------
{
  printf 'created_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'git_commit=%s\n' "$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || printf 'unknown')"
  printf 'postgres_dump=opendots.pgdump (pg_dump -Fc)\n'
  printf 'sqlite_file=opendots.sqlite\n'
  printf 'quiesced=%s\n' "$QUIESCE"
} >"$dest/MANIFEST.txt"

# --- Prune -------------------------------------------------------------------
if [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
  log "pruning backups older than ${RETENTION_DAYS} day(s) in $BACKUP_DIR"
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'opendots-backup-*' \
    -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} + 2>/dev/null \
    || log "WARNING: pruning reported an error (backup itself succeeded)"
fi

log "backup complete: $dest"
ls -l "$dest" >&2 || true
