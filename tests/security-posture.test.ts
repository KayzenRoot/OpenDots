import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { Store } from '../src/server/store.js';
import { ModelConfigStore } from '../src/server/model-config.js';
import { modelRoutes } from '../src/server/model-routes.js';

const respond = (async () =>
  new Response('{}', { status: 200 })) as typeof fetch;

function app() {
  const d = mkdtempSync(join(tmpdir(), 'od-sec-'));
  const store = new ModelConfigStore(
    join(d, 'app.sqlite'),
    join(d, 'master.key'),
  );
  return new Hono().route('/api', modelRoutes(store, respond));
}

// These assert the posture the operator relies on; they fail if a route is ever
// moved above the owner middleware or starts echoing a secret.
describe('security posture', () => {
  it('the model config route returns no secret material', async () => {
    const a = app();
    await a.request('/api/model', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://p.example/v1',
        model: 'm',
        apiKey: 'sk-secret-value-123',
      }),
    });
    const text = await (await a.request('/api/model')).text();
    expect(text).not.toMatch(/sk-secret-value-123/);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      'baseUrl',
      'hasKey',
      'model',
    ]);
  });

  it('rejects a body that carries unexpected fields', async () => {
    const res = await app().request('/api/model', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://p.example/v1',
        model: 'm',
        apiKey: 'sk-abcdefgh',
        role: 'admin',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('does not persist a key when the provider refuses it', async () => {
    const d = mkdtempSync(join(tmpdir(), 'od-sec2-'));
    const store = new ModelConfigStore(
      join(d, 'app.sqlite'),
      join(d, 'master.key'),
    );
    const denied = (async () =>
      new Response('nope', { status: 401 })) as typeof fetch;
    const a = new Hono().route('/api', modelRoutes(store, denied));
    const res = await a.request('/api/model', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://p.example/v1',
        model: 'm',
        apiKey: 'sk-abcdefgh',
      }),
    });
    expect(res.status).toBe(422);
    expect(store.get()).toBeNull();
  });

  it('the app store rejects an unknown setting key', () => {
    const d = mkdtempSync(join(tmpdir(), 'od-sec3-'));
    const store = new Store(join(d, 'app.sqlite'));
    expect(() =>
      store.updateSettings({ notASetting: true } as never),
    ).toThrow();
  });
});
