import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Pool } from 'pg';
import { generateMasterKey, open, seal } from './secret-box.js';

export interface ModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * Stores the operator-chosen model provider. The API key is sealed with a master
 * key kept in a separate file (never in the same database), so a copy of the
 * SQLite file alone does not expose the key.
 */
export class ModelConfigStore {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;

  constructor(databasePath: string, keyPath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.key = loadOrCreateKey(keyPath);
    this.db = new DatabaseSync(databasePath);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS model_config (id INTEGER PRIMARY KEY CHECK(id=1), base_url TEXT NOT NULL, model TEXT NOT NULL, api_key_sealed TEXT NOT NULL, updated_at TEXT NOT NULL);',
    );
  }

  get(): ModelConfig | null {
    const row = this.db
      .prepare(
        'SELECT base_url, model, api_key_sealed FROM model_config WHERE id = 1',
      )
      .get() as
      { base_url: string; model: string; api_key_sealed: string } | undefined;
    if (!row) return null;
    return {
      baseUrl: row.base_url,
      model: row.model,
      apiKey: open(row.api_key_sealed, this.key),
    };
  }

  /** Public view: never includes the key, only whether one is stored. */
  describe(): { baseUrl: string; model: string; hasKey: boolean } | null {
    const row = this.db
      .prepare('SELECT base_url, model FROM model_config WHERE id = 1')
      .get() as { base_url: string; model: string } | undefined;
    return row
      ? { baseUrl: row.base_url, model: row.model, hasKey: true }
      : null;
  }

  save(config: ModelConfig): void {
    this.db
      .prepare(
        'INSERT INTO model_config (id, base_url, model, api_key_sealed, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url, model=excluded.model, api_key_sealed=excluded.api_key_sealed, updated_at=excluded.updated_at',
      )
      .run(
        config.baseUrl,
        config.model,
        seal(config.apiKey, this.key),
        new Date().toISOString(),
      );
  }
}

/**
 * Per-Dot model overrides (WORK-030). The global `ModelConfigStore` row stays
 * the default; a row here points one Dot at a different provider combination
 * and its own sealed credential. Overrides live in the Postgres `dot_model_config`
 * table while `dots` lives in SQLite, so there can be no foreign key: `save`
 * validates that the Dot exists through an application-layer callback instead.
 * The key is sealed with the same master key file as the global store, so a
 * copy of the database alone still does not expose any provider key.
 */
export class DotModelConfigStore {
  private readonly pool: Pool;
  private readonly key: Buffer;

  constructor(
    pool: Pool,
    keyPath: string,
    private readonly dotExists: (dotId: string) => boolean,
    private readonly fallback?: Pick<ModelConfigStore, 'get'>,
  ) {
    this.pool = pool;
    this.key = loadOrCreateKey(keyPath);
  }

  /** The Dot's own override, or null when it inherits the global provider. */
  async get(dotId: string): Promise<ModelConfig | null> {
    const result = await this.pool.query<{
      base_url: string;
      model: string;
      api_key_sealed: string;
    }>(
      'SELECT base_url, model, api_key_sealed FROM dot_model_config WHERE dot_id = $1',
      [dotId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      baseUrl: row.base_url,
      model: row.model,
      apiKey: open(row.api_key_sealed, this.key),
    };
  }

  /** Public view of the override: never the key, only that one is stored. */
  async describe(dotId: string): Promise<{
    baseUrl: string;
    model: string;
    hasKey: boolean;
  } | null> {
    const result = await this.pool.query<{
      base_url: string;
      model: string;
    }>('SELECT base_url, model FROM dot_model_config WHERE dot_id = $1', [
      dotId,
    ]);
    const row = result.rows[0];
    return row
      ? { baseUrl: row.base_url, model: row.model, hasKey: true }
      : null;
  }

  async save(dotId: string, config: ModelConfig): Promise<void> {
    if (!this.dotExists(dotId)) throw new Error('Dot not found.');
    await this.pool.query(
      `INSERT INTO dot_model_config (dot_id, base_url, model, api_key_sealed, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT(dot_id) DO UPDATE SET base_url=excluded.base_url, model=excluded.model, api_key_sealed=excluded.api_key_sealed, updated_at=now()`,
      [dotId, config.baseUrl, config.model, seal(config.apiKey, this.key)],
    );
  }

  /** Removing an override is idempotent: the Dot inherits the global provider. */
  async delete(dotId: string): Promise<void> {
    await this.pool.query('DELETE FROM dot_model_config WHERE dot_id = $1', [
      dotId,
    ]);
  }

  /** Effective config: the Dot's override, else the global provider, else null. */
  async resolve(dotId: string): Promise<ModelConfig | null> {
    return (await this.get(dotId)) ?? this.fallback?.get() ?? null;
  }
}

function loadOrCreateKey(path: string): Buffer {
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error('Master key file is corrupt.');
    return key;
  }
  mkdirSync(dirname(path), { recursive: true });
  const key = generateMasterKey();
  writeFileSync(path, key.toString('base64'), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignores POSIX modes; the file lives in the per-user data dir.
  }
  return key;
}
