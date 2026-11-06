import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
