import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { ModelConfigStore } from '../src/server/model-config.js';
import { modelRoutes } from '../src/server/model-routes.js';

const setup = (provider: typeof fetch) => {
  const d = mkdtempSync(join(tmpdir(), 'od-route-'));
  const store = new ModelConfigStore(
    join(d, 'app.sqlite'),
    join(d, 'master.key'),
  );
  const app = new Hono().route('/api', modelRoutes(store, provider));
  return { app, store };
};
const body = {
  baseUrl: 'https://provider.example/v1',
  model: 'm',
  apiKey: 'sk-live-abcdefgh',
};
const json = (b: unknown) => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(b),
});

describe('model routes', () => {
  it('saves only after the provider accepts the key', async () => {
    const ok = (async () =>
      new Response('{}', { status: 200 })) as typeof fetch;
    const { app, store } = setup(ok);
    const res = await app.request('/api/model', json(body));
    expect(res.status).toBe(200);
    expect(store.get()?.apiKey).toBe('sk-live-abcdefgh');
  });

  it('refuses to persist a key the provider rejects', async () => {
    const denied = (async () =>
      new Response('no', { status: 401 })) as typeof fetch;
    const { app, store } = setup(denied);
    const res = await app.request('/api/model', json(body));
    expect(res.status).toBe(422);
    expect(store.get()).toBeNull();
  });

  it('never returns the key from GET', async () => {
    const ok = (async () =>
      new Response('{}', { status: 200 })) as typeof fetch;
    const { app } = setup(ok);
    await app.request('/api/model', json(body));
    const text = await (await app.request('/api/model')).text();
    expect(text).not.toContain('sk-live-abcdefgh');
    expect(text).toContain('"hasKey":true');
  });

  it('reports an unreachable provider without leaking the cause', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED 10.0.0.5:443 secret-detail');
    }) as typeof fetch;
    const { app } = setup(down);
    const res = await app.request('/api/model/test', {
      ...json(body),
      method: 'POST',
    });
    const text = await res.text();
    expect(res.status).toBe(422);
    expect(text).not.toContain('10.0.0.5');
    expect(text).not.toContain('secret-detail');
  });

  it('rejects malformed input before contacting the provider', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch;
    const { app } = setup(spy);
    const res = await app.request(
      '/api/model',
      json({ baseUrl: 'not-a-url', model: '', apiKey: 'x' }),
    );
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});

describe('gateway routing headers', () => {
  it('sends the runtime routing header when probing, so a real key is not misread as bad', async () => {
    let seen: Record<string, string> = {};
    const spy = (async (_url: unknown, init?: RequestInit) => {
      seen = Object.fromEntries(
        Object.entries(init?.headers as Record<string, string>),
      );
      return seen['x-opencode-session']
        ? new Response('{}', { status: 200 })
        : new Response('bad', { status: 400 });
    }) as typeof fetch;
    const d = mkdtempSync(join(tmpdir(), 'od-hdr-'));
    const store = new ModelConfigStore(
      join(d, 'app.sqlite'),
      join(d, 'master.key'),
    );
    const app = new Hono().route(
      '/api',
      modelRoutes(store, spy, { 'x-opencode-session': 'opendots-test' }),
    );
    const res = await app.request('/api/model', json(body));
    expect(seen['x-opencode-session']).toBe('opendots-test');
    expect(res.status).toBe(200);
  });
});
