import { Pool, type PoolConfig } from 'pg';

/**
 * Ordered, append-only migration steps. Each entry is applied exactly once,
 * in its own transaction, and recorded in `schema_migrations`. Never reorder,
 * rewrite, or delete a step that has shipped: add a new step instead.
 */
const migrations: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    dot_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS thread_runs (
    id BIGSERIAL PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    parent_run_id TEXT,
    events JSONB NOT NULL,
    messages JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (thread_id, run_id)
  );
  CREATE INDEX IF NOT EXISTS thread_runs_thread_created_idx
    ON thread_runs (thread_id, created_at);
  CREATE TABLE IF NOT EXISTS thread_state (
    thread_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    dot_id TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS skills_dot_idx ON skills (dot_id);
  `,
  // Version 2: the local skills store upserts by (dot_id, name), so a skill
  // name must be unique within a Dot. This also makes the deliverable set and
  // catalog order deterministic. The `skills` table shipped in version 1 with
  // no writer, so no de-duplication is needed before the unique index.
  `
  CREATE UNIQUE INDEX IF NOT EXISTS skills_dot_name_idx ON skills (dot_id, name);
  `,
  // Version 3: a model-authored skill is untrusted until a human approves it,
  // so approval is a distinct status rather than `enabled = false`. Existing
  // rows are treated as approved. `rejection_reason` remembers why a proposal
  // was rejected so a later reflection pass can skip re-proposing it;
  // `updated_at` carries the rejection timestamp.
  `
  ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
      CHECK (status IN ('approved', 'proposed', 'rejected'));
  ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
  `,
  // Version 4: the learning pass (WORK-021). Skills carry provenance so the
  // editor can say where a proposal came from. `learning_state` marks each
  // conversation with the message count already analysed, so the same
  // messages are never sent to the model twice. `learning_passes` records one
  // row per reflection pass; the hourly per-Dot limit is a count over this
  // table, so it survives a restart instead of resetting to zero.
  `
  ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
      CHECK (source IN ('manual', 'learning'));
  ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS conversation_id TEXT;
  ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS model TEXT;
  CREATE TABLE IF NOT EXISTS learning_state (
    thread_id TEXT PRIMARY KEY,
    dot_id TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    learned_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS learning_state_dot_idx
    ON learning_state (dot_id);
  CREATE TABLE IF NOT EXISTS learning_passes (
    id BIGSERIAL PRIMARY KEY,
    dot_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS learning_passes_dot_created_idx
    ON learning_passes (dot_id, created_at);
  `,
];

/** Build a bounded connection pool. The connection string is never logged. */
export function createPool(
  databaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Pool {
  const config: PoolConfig = {
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  };
  const ssl = sslConfig(databaseUrl, env);
  if (ssl) config.ssl = ssl;
  return new Pool(config);
}

function sslConfig(
  databaseUrl: string,
  env: NodeJS.ProcessEnv,
): PoolConfig['ssl'] | undefined {
  let mode = env.PGSSLMODE?.trim().toLowerCase();
  if (!mode) {
    try {
      mode = new URL(databaseUrl).searchParams.get('sslmode')?.toLowerCase();
    } catch {
      mode = undefined;
    }
  }
  if (!mode || mode === 'disable') return undefined;
  // `prefer`/`allow` fall back to plaintext, which the driver already does.
  if (mode === 'prefer' || mode === 'allow') return undefined;
  if (mode === 'verify-full' || mode === 'verify-ca')
    return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/**
 * Stable session advisory-lock key. Concurrent migrators (for example test
 * files sharing one database) must serialize: applying a step is idempotent
 * only when no other session is racing the same `CREATE ...` statement.
 */
const MIGRATION_LOCK_KEY = 4_281_970_001;

/** Apply every unapplied migration step. Idempotent and safe to run on boot. */
export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const applied = new Set(
      (
        await client.query<{ version: number }>(
          'SELECT version FROM schema_migrations',
        )
      ).rows.map((row) => row.version),
    );
    for (const [index, sql] of migrations.entries()) {
      const version = index + 1;
      if (applied.has(version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    // Release before returning the connection to the pool; if this fails the
    // lock is dropped when the session closes.
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => {});
    client.release();
  }
}
