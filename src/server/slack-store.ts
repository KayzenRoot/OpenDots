import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Slack retries a delivery for a few minutes; keep a bounded day of ids. */
export const SLACK_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Local Slack bookkeeping, on the same SQLite file as the rest of the
 * workspace. Two tables, additive and idempotent, following the same
 * `CREATE TABLE IF NOT EXISTS` idiom as `WorkspaceStore`:
 *
 * - `slack_events` de-duplicates Slack retries by `event_id` (bounded to
 *   {@link SLACK_EVENT_RETENTION_MS}).
 * - `slack_threads` maps a Slack conversation + thread to the OpenDots
 *   conversation it continues, mirroring the `thread_bindings` idea.
 */
export class SlackStore {
  private db: DatabaseSync;
  constructor(
    path = ':memory:',
    private retentionMs = SLACK_EVENT_RETENTION_MS,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS slack_events(event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS slack_threads(channel_id TEXT NOT NULL, thread_ts TEXT NOT NULL, thread_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(channel_id, thread_ts));`);
  }
  close() {
    this.db.close();
  }
  /** True the first time this Slack event id is seen; false for a retry. */
  claim(eventId: string, now = Date.now()): boolean {
    const inserted =
      this.db
        .prepare(
          'INSERT OR IGNORE INTO slack_events(event_id, received_at) VALUES (?, ?)',
        )
        .run(eventId, now).changes > 0;
    if (inserted)
      this.db
        .prepare('DELETE FROM slack_events WHERE received_at < ?')
        .run(now - this.retentionMs);
    return inserted;
  }
  threadFor(channelId: string, threadTs: string): string | undefined {
    const row = this.db
      .prepare(
        'SELECT thread_id FROM slack_threads WHERE channel_id=? AND thread_ts=?',
      )
      .get(channelId, threadTs);
    return typeof row?.thread_id === 'string' ? row.thread_id : undefined;
  }
  bindThread(
    channelId: string,
    threadTs: string,
    threadId: string,
    now = Date.now(),
  ): void {
    this.db
      .prepare(
        'INSERT INTO slack_threads(channel_id, thread_ts, thread_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, thread_ts) DO UPDATE SET thread_id=excluded.thread_id',
      )
      .run(channelId, threadTs, threadId, now);
  }
}
