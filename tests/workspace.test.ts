import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { WorkspaceStore } from '../src/server/workspace.js';
it('persists spaces, specialist permissions, and canonical thread ownership', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const space = store.createSpace('Design', 'Design decisions');
  const dot = store.createDot(space.id, 'Scout', 'Be concise', false, true);
  store.bindThread('thread-1', dot.id, 'Design research');
  expect(store.requireThread('thread-1', dot.id).ownerId).toBe('owner');
  expect(() => store.requireThread('thread-1', 'another-dot')).toThrow();
  expect(() => store.requireThread('unknown')).toThrow();
  expect(store.dot(dot.id)?.researchAllowed).toBe(false);
  store.close();
});
it('rejects a dot in a nonexistent space and does not rebind an existing thread', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  expect(() => store.createDot('missing', 'Dot', 'Help', true, true)).toThrow();
  const dots = store.dots();
  store.bindThread('one', dots[0].id, 'First');
  expect(() => store.bindThread('one', dots[0].id, 'Second')).toThrow();
  store.close();
});

it('migrates legacy Space ownership once and never restores revoked access on restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexbot-access-'));
  const path = join(dir, 'workspace.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE dots(id TEXT PRIMARY KEY, spaceId TEXT NOT NULL, name TEXT NOT NULL, instructions TEXT NOT NULL, researchAllowed INTEGER NOT NULL, memoryAllowed INTEGER NOT NULL, createdAt INTEGER NOT NULL);
      INSERT INTO spaces VALUES ('old', 'Original', '', 1), ('new', 'New', '', 2);
      INSERT INTO dots VALUES ('dot', 'old', 'Dot', 'Help', 1, 1, 1);`);
    legacy.close();
    const ws = new WorkspaceStore(path, 'owner');
    const dot = ws.dot('dot')!;
    expect(dot.spaceIds).toEqual(['old']);
    expect(ws.canAccessSpace('dot', 'new')).toBe(false);
    expect(() =>
      ws.updateDot('dot', { ...dot, spaceIds: ['missing'] }),
    ).toThrow();
    expect(ws.dot('dot')?.spaceIds).toEqual(['old']);
    ws.bindThread('existing-thread', 'dot', 'Keep me');
    ws.updateDot('dot', { ...dot, spaceId: 'new', spaceIds: ['new'] });
    ws.close();
    const reopened = new WorkspaceStore(path, 'owner');
    expect(reopened.dot('dot')?.spaceIds).toEqual(['new']);
    expect(reopened.canAccessSpace('dot', 'old')).toBe(false);
    expect(reopened.requireThread('existing-thread').dotId).toBe('dot');
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it('refuses to delete a Dot that still has conversations and removes a spent Dot without touching other Dots or shared Spaces', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const shared = store.createSpace('Shared', 'Shared pages');
  const other = store.createSpace('Other', 'Untouched');
  const doomed = store.createDot(shared.id, 'Scout', 'Be concise', false, true);
  const keeper = store.createDot(other.id, 'Keeper', 'Stay', true, false, [
    shared.id,
    other.id,
  ]);
  store.bindThread('thread-1', doomed.id, 'Design research');
  store.pages.create(shared.id, { title: 'Shared page', content: 'Body' });
  store.computers.patch(doomed.id, { enabled: true, browser: true });
  store.connections.create(
    doomed.id,
    { name: 'GitHub', url: 'https://example.com/mcp' },
    [],
  );
  store.computers.patch(keeper.id, { enabled: true });
  store.connections.create(
    keeper.id,
    { name: 'Calendar', url: 'https://example.com/cal' },
    [],
  );

  // The conversation is the hard dependency: refuse and say what to do.
  const blocker = store.dotDeletionBlocker(doomed.id);
  expect(blocker).toContain('1 conversation');
  expect(store.dot(doomed.id)).toBeTruthy();

  // Once the conversation is gone the Dot can be deleted.
  expect(store.deleteThread('thread-1')).toBe(true);
  expect(store.dotDeletionBlocker(doomed.id)).toBeUndefined();
  expect(store.deleteDot(doomed.id)).toBe(true);
  expect(store.dot(doomed.id)).toBeUndefined();

  // The shared Space and its pages survive; the other Dot is untouched.
  expect(store.spaces().map((space) => space.name)).toEqual(
    expect.arrayContaining(['Shared', 'Other']),
  );
  expect(store.pages.list(shared.id)).toHaveLength(1);
  expect(store.dot(keeper.id)).toBeTruthy();
  expect(store.computers.permissions(keeper.id).enabled).toBe(true);
  expect(store.connections.list(keeper.id)).toHaveLength(1);
  expect(store.connections.list(doomed.id)).toHaveLength(0);
  expect(store.computers.permissions(doomed.id).enabled).toBe(false);
  expect(store.deleteDot('missing')).toBe(false);
  store.close();
});
it('deletes a conversation with its local links, detaches saved pages, and is idempotent', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const space = store.createSpace('Design', 'Design decisions');
  const dot = store.createDot(space.id, 'Scout', 'Be concise', false, true);
  store.bindThread('thread-1', dot.id, 'Design research');
  store.pages.create(
    space.id,
    { title: 'From chat', content: 'Text' },
    'thread-1',
  );
  store.pages.reserveThread('page-x', dot.id, 'thread-1');
  store.createCall('thread-1');
  store.saveCapture('thread-1', { brief: true });
  store.bindTask('task-1', 'thread-1');
  const source = store.pages.list(space.id)[0];
  expect(source.sourceThreadId).toBe('thread-1');

  expect(store.deleteThread('thread-1')).toBe(true);
  expect(store.conversation('thread-1')).toBeUndefined();
  expect(store.deleteThread('thread-1')).toBe(false);
  expect(store.deleteThread('never-bound')).toBe(false);
  // Saved pages stay, but no longer point at the deleted conversation.
  expect(store.pages.list(space.id).map((page) => page.title)).toEqual([
    'From chat',
  ]);
  expect(store.pages.list(space.id)[0].sourceThreadId).toBeNull();
  expect(store.pages.thread('page-x', dot.id)).toBeUndefined();
  expect(store.calls().filter((call) => call.threadId === 'thread-1')).toEqual(
    [],
  );
  // The binding is gone, so thread-scoped reads refuse the deleted id.
  expect(() => store.capture('thread-1')).toThrow(
    'Conversation does not belong',
  );
  expect(store.taskThread('task-1')).toBeUndefined();
  store.close();
});
