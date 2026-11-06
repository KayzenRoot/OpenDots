import { expect, it } from 'vitest';
import { validateRuntimeScope } from '../src/server/runtime-scope.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { setupStatus } from '../src/server/platform-config.js';
it('blocks unbound cross-Dot run and inspector routes before reaching the agent', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const dot = store.dots()[0];
  store.bindThread('thread-a', dot.id, 'A');
  expect(() =>
    validateRuntimeScope(
      new Request(`http://localhost/api/copilotkit/agent/${dot.id}/run`, {
        method: 'POST',
      }),
      store,
      { threadId: 'other-owner' },
    ),
  ).toThrow();
  expect(() =>
    validateRuntimeScope(
      new Request('http://localhost/api/copilotkit/inspect/threads/foreign'),
      store,
      null,
    ),
  ).toThrow();
  expect(() =>
    validateRuntimeScope(
      new Request(`http://localhost/api/copilotkit/agent/${dot.id}/run`, {
        method: 'POST',
      }),
      store,
      { threadId: 'thread-a' },
    ),
  ).not.toThrow();
  store.close();
});
it('reports setup honestly without an Intelligence key or agent fallback', () => {
  const status = setupStatus({
    baseUrl: '',
    voiceName: 'marin',
    slackUsers: [],
    runtimeUrl: '',
  });
  expect(status.intelligence).toBe(false);
  expect(status.voice).toBe(false);
  expect(status.slack).toBe('not_configured');
  // Only the model configuration is missing; no Intelligence key is required.
  expect(status.missing).toEqual(['OPENAI_API_KEY', 'OPENAI_MODEL']);
});
it('rejects stop scope bypasses and misleading prefixes while allowing canonical owned routes', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const dot = store.dots()[0];
  store.bindThread('bound', dot.id, 'Bound');
  for (const path of [
    `/agent/${dot.id}/stop/foreign`,
    '/threads/bound/threads/foreign/messages',
    `/agent/${dot.id}/agent/foreign/run`,
    '/prefix/info',
    '/threads//bound/messages',
    '/threads/bound%2Fthreads%2Fforeign/messages',
  ]) {
    expect(() =>
      validateRuntimeScope(
        new Request(`http://localhost/api/copilotkit${path}`, {
          method: 'POST',
        }),
        store,
        { threadId: 'bound' },
      ),
    ).toThrow();
  }
  expect(() =>
    validateRuntimeScope(
      new Request(
        `http://localhost/api/copilotkit/agent/${dot.id}/stop/bound`,
        { method: 'POST' },
      ),
      store,
      {},
    ),
  ).not.toThrow();
  expect(() =>
    validateRuntimeScope(
      new Request('http://localhost/api/copilotkit/threads/bound/messages'),
      store,
      null,
    ),
  ).not.toThrow();
  store.close();
});
it('allows the local thread backend routes and still denies Intelligence-only routes', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const dot = store.dots()[0];
  store.bindThread('bound', dot.id, 'Bound');
  const allow = (path: string, method: string, body: unknown = {}) =>
    validateRuntimeScope(
      new Request(`http://localhost/api/copilotkit${path}`, { method }),
      store,
      body,
    );
  expect(() => allow('/threads/clear', 'POST')).not.toThrow();
  expect(() => allow('/threads/bound/messages', 'GET')).not.toThrow();
  expect(() => allow('/threads/bound/events', 'GET')).not.toThrow();
  expect(() => allow('/threads/bound/state', 'GET')).not.toThrow();
  for (const path of [
    '/threads/subscribe',
    '/threads/inspector-metadata',
    '/threads/bound/inspector-learning',
    '/transcribe',
    '/cpk-debug-events',
    '/annotate',
  ])
    expect(() => allow(path, 'POST')).toThrow();
  store.close();
});
