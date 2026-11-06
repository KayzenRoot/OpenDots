import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Telegram retries a timed-out delivery for a while; keep a bounded day of ids. */
export const TELEGRAM_UPDATE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Local Telegram bookkeeping, on the same SQLite file as the rest of the
 * workspace. Two tables, additive and idempotent, following the same
 * `CREATE TABLE IF NOT EXISTS` idiom as `WorkspaceStore` and `SlackStore`:
 *
 * - `telegram_updates` de-duplicates Telegram timeout retries by `update_id`
 *   (bounded to {@link TELEGRAM_UPDATE_RETENTION_MS}). The id is recorded
 *   before processing, so a redelivery can never run the agent twice.
 * - `telegram_chats` maps a Telegram chat to the NexBot conversation it
 *   continues and the Dot that answers it — one conversation and one Dot per
 *   chat. `thread_id` is the Telegram side (the forum topic id to reply into,
 *   empty when the chat has no topics); `nexbot_thread_id` is the NexBot side.
 */
export class TelegramStore {
  private db: DatabaseSync;
  constructor(
    path = ':memory:',
    private retentionMs = TELEGRAM_UPDATE_RETENTION_MS,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS telegram_updates(update_id INTEGER PRIMARY KEY, received_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS telegram_chats(chat_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, dot_id TEXT NOT NULL, nexbot_thread_id TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  }
  close() {
    this.db.close();
  }
  /** True the first time this Telegram update id is seen; false for a retry. */
  claim(updateId: number, now = Date.now()): boolean {
    const inserted =
      this.db
        .prepare(
          'INSERT OR IGNORE INTO telegram_updates(update_id, received_at) VALUES (?, ?)',
        )
        .run(updateId, now).changes > 0;
    if (inserted)
      this.db
        .prepare('DELETE FROM telegram_updates WHERE received_at < ?')
        .run(now - this.retentionMs);
    return inserted;
  }
  chatFor(
    chatId: string,
  ): { threadId: string; dotId: string; nexbotThreadId: string } | undefined {
    const row = this.db
      .prepare(
        'SELECT thread_id, dot_id, nexbot_thread_id FROM telegram_chats WHERE chat_id=?',
      )
      .get(chatId);
    return row &&
      typeof row.thread_id === 'string' &&
      typeof row.dot_id === 'string' &&
      typeof row.nexbot_thread_id === 'string'
      ? {
          threadId: row.thread_id,
          dotId: row.dot_id,
          nexbotThreadId: row.nexbot_thread_id,
        }
      : undefined;
  }
  bindChat(
    chatId: string,
    threadId: string,
    dotId: string,
    nexbotThreadId: string,
    now = Date.now(),
  ): void {
    this.db
      .prepare(
        'INSERT INTO telegram_chats(chat_id, thread_id, dot_id, nexbot_thread_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET thread_id=excluded.thread_id, dot_id=excluded.dot_id, nexbot_thread_id=excluded.nexbot_thread_id',
      )
      .run(chatId, threadId, dotId, nexbotThreadId, now);
  }
}
