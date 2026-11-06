import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ModelConfigStore } from '../src/server/model-config.js';

const dir = () => mkdtempSync(join(tmpdir(), 'od-model-'));

describe('ModelConfigStore', () => {
  it('returns null until configured', () => {
    const d = dir();
    const s = new ModelConfigStore(
      join(d, 'app.sqlite'),
      join(d, 'master.key'),
    );
    expect(s.get()).toBeNull();
    expect(s.describe()).toBeNull();
  });

  it('round-trips the key and never exposes it in the public view', () => {
    const d = dir();
    const s = new ModelConfigStore(
      join(d, 'app.sqlite'),
      join(d, 'master.key'),
    );
    s.save({
      baseUrl: 'https://opencode.ai/zen/go/v1',
      model: 'deepseek-v4.1-flash',
      apiKey: 'oc_sk_TESTKEY_123456',
    });
    expect(s.get()?.apiKey).toBe('oc_sk_TESTKEY_123456');
    const pub = JSON.stringify(s.describe());
    expect(pub).not.toContain('oc_sk_TESTKEY');
    expect(s.describe()?.hasKey).toBe(true);
  });

  it('keeps the key out of the database file', () => {
    const d = dir();
    const dbPath = join(d, 'app.sqlite');
    const s = new ModelConfigStore(dbPath, join(d, 'master.key'));
    s.save({
      baseUrl: 'https://x/v1',
      model: 'm',
      apiKey: 'oc_sk_PLAINTEXT_SHOULD_NOT_APPEAR',
    });
    const raw = readFileSync(dbPath).toString('latin1');
    expect(raw).not.toContain('oc_sk_PLAINTEXT_SHOULD_NOT_APPEAR');
  });

  it('cannot decrypt with a different master key file', () => {
    const d1 = dir();
    const d2 = dir();
    const db = join(d1, 'app.sqlite');
    new ModelConfigStore(db, join(d1, 'master.key')).save({
      baseUrl: 'u',
      model: 'm',
      apiKey: 'k',
    });
    const other = new ModelConfigStore(db, join(d2, 'master.key'));
    expect(() => other.get()).toThrow('Secret could not be opened.');
  });
});
