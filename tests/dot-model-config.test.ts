import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Pool } from 'pg';
import { Hono } from 'hono';
import type { RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import {
  DotModelConfigStore,
  ModelConfigStore,
} from '../src/server/model-config.js';
import { dotModelRoutes } from '../src/server/dot-model-routes.js';
import { createPool, migrate } from '../src/server/pg.js';
import { Platform } from '../src/server/platform.js';
import type { PlatformConfig } from '../src/server/platform-config.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { completion } from './fixtures/model-stream.js';
import { MemoryConversations } from './fixtures/memory-conversations.js';

const databaseUrl = process.env.NEXBOT_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

const globalConfig = {
  baseUrl: 'https://global.example/v1',
  model: 'global-model',
  apiKey: 'sk-global-123456',
};
const override = {
  baseUrl: 'https://override.example/v1',
  model: 'override-model',
  apiKey: 'sk-override-12345',
};
const put = (b: unknown) => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(b),
});
const okFetcher = (async () =>
  new Response('{}', { status: 200 })) as typeof fetch;

describePostgres('per-Dot model configuration (WORK-030)', () => {
  let pool: Pool;
  let store: Store;
  let workspace: WorkspaceStore;
  let globalStore: ModelConfigStore;
  let dots: DotModelConfigStore;
  let dir: string;

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'od-dot-model-'));
    store = new Store(':memory:');
    workspace = new WorkspaceStore(':memory:', 'owner');
    globalStore = new ModelConfigStore(
      join(dir, 'app.sqlite'),
      join(dir, 'master.key'),
    );
    // The per-Dot store shares the global master key file and validates Dot
    // existence at the application layer, exactly as index.ts wires it.
    dots = new DotModelConfigStore(
      pool,
      join(dir, 'master.key'),
      (dotId) => !!workspace.dot(dotId),
      globalStore,
    );
  });
  afterEach(async () => {
    // Only this suite writes dot_model_config, so clearing the table here
    // cannot disturb another test file running in parallel.
    await pool.query('DELETE FROM dot_model_config');
    store.close();
    workspace.close();
    vi.restoreAllMocks();
  });
  const routeApp = (fetcher: typeof fetch = okFetcher) =>
    new Hono().route(
      '/api',
      dotModelRoutes(dots, workspace, globalStore, fetcher),
    );

  it('applies the v5 migration cleanly on a database that already has v1-4 applied', async () => {
    // The live test database carries versions 1-4; migrating again must be a
    // no-op for them and leave the new table in place.
    await expect(migrate(pool)).resolves.toBeUndefined();
    const applied = await pool.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(applied.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'dot_model_config' ORDER BY ordinal_position",
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'dot_id',
      'base_url',
      'model',
      'api_key_sealed',
      'updated_at',
    ]);
  });

  it('resolves the Dot override ahead of the global provider and null without either', async () => {
    const dot = workspace.dots()[0];
    expect(await dots.resolve(dot.id)).toBeNull();
    globalStore.save(globalConfig);
    expect(await dots.resolve(dot.id)).toEqual(globalConfig);
    await dots.save(dot.id, override);
    expect(await dots.resolve(dot.id)).toEqual(override);
    expect(await dots.get(dot.id)).toEqual(override);
    expect(await dots.describe(dot.id)).toEqual({
      baseUrl: override.baseUrl,
      model: override.model,
      hasKey: true,
    });
  });

  it('a Dot without an override inherits the global config', async () => {
    globalStore.save(globalConfig);
    const dot = workspace.dots()[0];
    expect(await dots.get(dot.id)).toBeNull();
    expect(await dots.describe(dot.id)).toBeNull();
    expect(await dots.resolve(dot.id)).toMatchObject({
      baseUrl: globalConfig.baseUrl,
      model: globalConfig.model,
    });
  });

  it('keeps the per-Dot key sealed at rest and out of the public view', async () => {
    const dot = workspace.dots()[0];
    await dots.save(dot.id, override);
    const row = await pool.query(
      'SELECT api_key_sealed FROM dot_model_config WHERE dot_id = $1',
      [dot.id],
    );
    expect(JSON.stringify(row.rows)).not.toContain(override.apiKey);
    const pub = JSON.stringify(await dots.describe(dot.id));
    expect(pub).not.toContain(override.apiKey);
    expect((await dots.get(dot.id))?.apiKey).toBe(override.apiKey);
  });

  it('refuses to save an override for a Dot that does not exist', async () => {
    await expect(dots.save('no-such-dot', override)).rejects.toThrow(
      'Dot not found.',
    );
    const rows = await pool.query('SELECT 1 FROM dot_model_config');
    expect(rows.rows).toEqual([]);
  });

  it('two Dots in one process resolve to two different models', async () => {
    globalStore.save(globalConfig);
    const dotA = workspace.dots()[0];
    const dotB = workspace.createDot(
      dotA.spaceId,
      'Finance',
      'Finance.',
      true,
      true,
    );
    workspace.bindThread('thread-a', dotA.id, 'A');
    workspace.bindThread('thread-b', dotB.id, 'B');
    await dots.save(dotA.id, override);
    const platform = new Platform(
      store,
      workspace,
      {
        apiKey: 'unused',
        model: 'unused',
        baseUrl: 'https://unused.invalid/v1',
        runtimeUrl: '',
        voiceName: 'marin',
        slackUsers: [],
      } satisfies PlatformConfig,
      new MemoryConversations(),
      undefined,
      undefined,
      globalStore,
      dots,
    );
    const agents = await platform.agents();
    const seen: Array<{ url: string; model: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      seen.push({
        url: String(url),
        model: String(JSON.parse(String(init?.body)).model),
      });
      return completion({ role: 'assistant', content: 'Ok.' });
    });
    const input = (threadId: string): RunAgentInput => ({
      threadId,
      runId: 'run',
      state: {},
      context: [],
      messages: [{ id: 'user', role: 'user', content: 'Say OK.' }],
      tools: [],
      forwardedProps: {},
    });
    await lastValueFrom(agents[dotA.id].run(input('thread-a')).pipe(toArray()));
    await lastValueFrom(agents[dotB.id].run(input('thread-b')).pipe(toArray()));
    expect(seen).toEqual([
      {
        url: 'https://override.example/v1/chat/completions',
        model: 'override-model',
      },
      {
        url: 'https://global.example/v1/chat/completions',
        model: 'global-model',
      },
    ]);
  });

  it('saves a per-Dot override only after the provider accepts the key', async () => {
    const dot = workspace.dots()[0];
    const res = await routeApp().request(
      `/api/model/dot/${dot.id}`,
      put(override),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      saved: true,
      model: override.model,
      hasKey: true,
      inherited: false,
    });
    expect(await dots.get(dot.id)).toEqual(override);
  });

  it('refuses to persist a per-Dot key the provider rejects', async () => {
    const denied = (async () =>
      new Response('no', { status: 401 })) as typeof fetch;
    const dot = workspace.dots()[0];
    const res = await routeApp(denied).request(
      `/api/model/dot/${dot.id}`,
      put(override),
    );
    expect(res.status).toBe(422);
    expect(await dots.get(dot.id)).toBeNull();
    expect(await dots.describe(dot.id)).toBeNull();
  });

  it('never returns the key from GET', async () => {
    const dot = workspace.dots()[0];
    const app = routeApp();
    await app.request(`/api/model/dot/${dot.id}`, put(override));
    const text = await (await app.request(`/api/model/dot/${dot.id}`)).text();
    expect(text).not.toContain(override.apiKey);
    expect(text).toContain('"hasKey":true');
    expect(text).toContain('"inherited":false');
  });

  it('keeps Dots isolated: Dot B can neither read nor write Dot A override', async () => {
    globalStore.save(globalConfig);
    const dotA = workspace.dots()[0];
    const dotB = workspace.createDot(
      dotA.spaceId,
      'Routine',
      'Routine.',
      true,
      true,
    );
    const app = routeApp();
    await app.request(`/api/model/dot/${dotA.id}`, put(override));
    // Reading B shows the inherited global, never anything of A's override.
    const read = await (await app.request(`/api/model/dot/${dotB.id}`)).json();
    expect(read).toMatchObject({
      model: globalConfig.model,
      inherited: true,
    });
    expect(JSON.stringify(read)).not.toContain(override.model);
    expect(JSON.stringify(read)).not.toContain(override.apiKey);
    // Writing B lands on B only; A keeps its own override.
    const routine = {
      baseUrl: 'https://routine.example/v1',
      model: 'routine-model',
      apiKey: 'sk-routine-12345',
    };
    await app.request(`/api/model/dot/${dotB.id}`, put(routine));
    expect((await dots.get(dotB.id))?.model).toBe(routine.model);
    expect((await dots.get(dotA.id))?.model).toBe(override.model);
    // Removing B's override leaves A's override untouched.
    await app.request(`/api/model/dot/${dotB.id}`, { method: 'DELETE' });
    expect(await dots.get(dotB.id)).toBeNull();
    expect((await dots.get(dotA.id))?.model).toBe(override.model);
  });

  it('removing the override restores inheritance and is idempotent', async () => {
    globalStore.save(globalConfig);
    const dot = workspace.dots()[0];
    const app = routeApp();
    await dots.save(dot.id, override);
    expect(
      await (await app.request(`/api/model/dot/${dot.id}`)).json(),
    ).toMatchObject({ inherited: false });
    expect(
      (await app.request(`/api/model/dot/${dot.id}`, { method: 'DELETE' }))
        .status,
    ).toBe(200);
    expect(
      await (await app.request(`/api/model/dot/${dot.id}`)).json(),
    ).toMatchObject({ model: globalConfig.model, inherited: true });
    // A second DELETE changes nothing.
    expect(
      (await app.request(`/api/model/dot/${dot.id}`, { method: 'DELETE' }))
        .status,
    ).toBe(200);
    expect(await dots.get(dot.id)).toBeNull();
  });

  it('probes a candidate without saving it', async () => {
    const dot = workspace.dots()[0];
    const res = await routeApp().request(`/api/model/dot/${dot.id}/test`, {
      ...put(override),
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await dots.get(dot.id)).toBeNull();
  });

  it('answers 404 for a Dot that does not exist on every route', async () => {
    const app = routeApp();
    const url = '/api/model/dot/no-such-dot';
    expect((await app.request(url)).status).toBe(404);
    expect((await app.request(url, put(override))).status).toBe(404);
    expect((await app.request(url, { method: 'DELETE' })).status).toBe(404);
    expect(
      (await app.request(`${url}/test`, { ...put(override), method: 'POST' }))
        .status,
    ).toBe(404);
  });

  it('rejects malformed input before contacting the provider', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch;
    const dot = workspace.dots()[0];
    const res = await routeApp(spy).request(
      `/api/model/dot/${dot.id}`,
      put({ baseUrl: 'not-a-url', model: '', apiKey: 'x' }),
    );
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});
