import { expect, it } from 'vitest';
import { Platform } from '../src/server/platform.js';
import {
  setupStatus,
  type PlatformConfig,
} from '../src/server/platform-config.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { MemoryConversations } from './fixtures/memory-conversations.js';

const configured: PlatformConfig = {
  databaseUrl: 'postgres://example.test/nexbot',
  apiKey: 'fixture',
  model: 'fixture',
  baseUrl: 'https://example.com',
  runtimeUrl: '',
  voiceName: 'marin',
  slackUsers: [],
};

it('requires no CopilotKit Intelligence key anywhere in the platform config', () => {
  expect(setupStatus(configured).missing).toEqual([]);
  expect(setupStatus(configured).intelligence).toBe(true);
  // Storage is what drives conversation readiness, not a hosted key.
  expect(
    setupStatus({ ...configured, databaseUrl: undefined }).intelligence,
  ).toBe(false);
  expect(
    Object.keys(configured).some((key) =>
      key.toLowerCase().includes('intelligence'),
    ),
  ).toBe(false);
});

it('serves the runtime without any Intelligence key when conversation storage exists', async () => {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  try {
    const platform = new Platform(
      store,
      workspace,
      configured,
      new MemoryConversations(),
    );
    const response = await platform.handle(
      new Request('http://127.0.0.1/api/copilotkit/info'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: 'sse',
      agents: { [workspace.dots()[0].id]: expect.any(Object) },
      // The local thread backend is what the client's useThreads relies on.
      threadEndpoints: { list: true, inspect: true, mutations: false },
    });
  } finally {
    store.close();
    workspace.close();
  }
});

it('returns 503 for the runtime only when conversation storage is absent', async () => {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  try {
    const platform = new Platform(store, workspace, configured);
    const response = await platform.handle(
      new Request('http://127.0.0.1/api/copilotkit/info'),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Conversation storage is not configured.',
    });
  } finally {
    store.close();
    workspace.close();
  }
});
