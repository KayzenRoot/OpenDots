import { afterEach, expect, it } from 'vitest';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { Platform } from '../src/server/platform.js';
import { Runner } from '../src/server/runner.js';
import { createApp } from '../src/server/app.js';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
function fixture(ownerToken?: string) {
  const store = new Store(':memory:');
  const ws = new WorkspaceStore(':memory:', 'owner');
  cleanup.push(() => {
    store.close();
    ws.close();
  });
  const config = { mode: 'live' as const, baseUrl: 'https://example.com' };
  const platform = new Platform(store, ws, {
    baseUrl: config.baseUrl,
    voiceName: 'marin',
    slackUsers: [],
    runtimeUrl: '',
  });
  return {
    ws,
    platform,
    app: createApp({
      store,
      runner: new Runner(store, config),
      config,
      platform,
      ownerToken,
    }),
  };
}
const auth = (token?: string) => ({
  method: 'DELETE',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
});

it('requires the owner token to delete a conversation', async () => {
  const { ws, app } = fixture('owner-secret');
  const dot = ws.dots()[0];
  ws.bindThread('thread-1', dot.id, 'Design research');
  expect((await app.request('/api/threads/thread-1', auth())).status).toBe(401);
  expect(
    (await app.request('/api/threads/thread-1', auth('wrong'))).status,
  ).toBe(401);
  expect(ws.conversation('thread-1')).toBeTruthy();
});

it('deletes a conversation locally, keeps its saved pages, and is idempotent', async () => {
  const { ws, platform, app } = fixture();
  const dot = ws.dots()[0];
  const space = ws.spaces()[0].id;
  ws.bindThread('thread-1', dot.id, 'Design research');
  ws.bindThread('thread-2', dot.id, 'Keep me');
  ws.pages.create(space, { title: 'From chat', content: 'Text' }, 'thread-1');
  ws.createCall('thread-1');
  ws.saveCapture('thread-1', { brief: true });
  ws.bindTask('task-1', 'thread-1');

  const gone = await app.request('/api/threads/thread-1', auth());
  expect(gone.status).toBe(204);
  expect(ws.conversation('thread-1')).toBeUndefined();
  expect(ws.conversation('thread-2')).toBeTruthy();
  // Saved pages are durable artifacts: kept, with the source link dropped.
  const pages = ws.pages.list(space);
  expect(pages).toHaveLength(1);
  expect(pages[0].sourceThreadId).toBeNull();
  expect(ws.calls().some((call) => call.threadId === 'thread-1')).toBe(false);
  expect(ws.taskThread('task-1')).toBeUndefined();
  expect(platform.conversations).toBeUndefined();

  // Retried or racing deletes stay successful instead of erroring.
  expect((await app.request('/api/threads/thread-1', auth())).status).toBe(204);
  expect((await app.request('/api/threads/never-bound', auth())).status).toBe(
    204,
  );
  const state = await app.request('/api/workspace');
  const conversations = (await state.json()).conversations as { id: string }[];
  expect(conversations.map((thread) => thread.id)).toEqual(['thread-2']);
});

it('requires the owner token, refuses the last Dot and Dots with conversations, then deletes cleanly', async () => {
  const { ws, app } = fixture('owner-secret');
  const only = ws.dots()[0];
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer owner-secret',
  };
  // Wrong token first: the route sits behind the owner middleware.
  expect(
    (
      await app.request(`/api/dots/${only.id}`, {
        method: 'DELETE',
        headers: { ...headers, Authorization: 'Bearer nope' },
      })
    ).status,
  ).toBe(401);
  // The last remaining Dot cannot be deleted.
  const last = await app.request(`/api/dots/${only.id}`, auth('owner-secret'));
  expect(last.status).toBe(409);
  expect(((await last.json()) as { error: string }).error).toContain(
    'at least one Dot',
  );
  expect(
    (await app.request('/api/dots/missing', auth('owner-secret'))).status,
  ).toBe(404);

  // A Dot with a conversation is refused with a message that says what to do.
  const other = ws.spaces()[0].id;
  const second = await app.request(
    '/api/dots',
    requestAs('owner-secret', {
      spaceId: other,
      spaceIds: [other],
      name: 'Scout',
      instructions: 'Be concise.',
      researchAllowed: false,
      memoryAllowed: false,
    }),
  );
  expect(second.status).toBe(201);
  const scout = (await second.json()) as { id: string };
  ws.bindThread('thread-1', scout.id, 'Research');
  const blocked = await app.request(
    `/api/dots/${scout.id}`,
    auth('owner-secret'),
  );
  expect(blocked.status).toBe(409);
  const blockedBody = (await blocked.json()) as { error: string };
  expect(blockedBody.error).toContain('conversation');
  expect(ws.dot(scout.id)).toBeTruthy();

  // After the conversation is gone, deletion succeeds and the Dot is gone
  // while the other Dot, its conversation and the shared Space remain.
  expect(
    (await app.request('/api/threads/thread-1', auth('owner-secret'))).status,
  ).toBe(204);
  const done = await app.request(`/api/dots/${scout.id}`, auth('owner-secret'));
  expect(done.status).toBe(200);
  expect(ws.dot(scout.id)).toBeUndefined();
  expect(ws.dot(only.id)).toBeTruthy();
  expect(ws.spaces()).toHaveLength(1);
  expect(ws.conversations().map((thread) => thread.id)).toEqual([]);
});

it('deleting one Dot or conversation never touches another Dot or conversation', async () => {
  const { ws, app } = fixture();
  const space = ws.spaces()[0].id;
  const a = ws.dots()[0];
  const b = await app.request(
    '/api/dots',
    requestAs(undefined, {
      spaceId: space,
      spaceIds: [space],
      name: 'Scout',
      instructions: 'Be concise.',
      researchAllowed: false,
      memoryAllowed: false,
    }),
  );
  const dotB = (await b.json()) as { id: string };
  ws.bindThread('thread-a', a.id, 'A chat');
  ws.bindThread('thread-b', dotB.id, 'B chat');
  expect((await app.request('/api/threads/thread-a', auth())).status).toBe(204);
  expect(ws.conversation('thread-b')).toBeTruthy();
  expect(ws.deleteThread('thread-b')).toBe(true);
  expect((await app.request(`/api/dots/${dotB.id}`, auth())).status).toBe(200);
  expect(ws.dot(a.id)).toBeTruthy();
  expect(ws.dot(dotB.id)).toBeUndefined();
});

function requestAs(token: string | undefined, body: unknown) {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}
