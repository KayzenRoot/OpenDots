import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createPool, migrate } from '../src/server/pg.js';
import { ConversationStore } from '../src/server/conversation-store.js';

const databaseUrl = process.env.OPENDOTS_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('ConversationStore (PostgreSQL)', () => {
  let pool: Pool;
  let store: ConversationStore;
  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(
      // `skills` is intentionally excluded: local skill tests own their rows and
      // must not be truncated by an unrelated file running in parallel.
      'TRUNCATE conversations, thread_runs, thread_state RESTART IDENTITY CASCADE',
    );
    store = new ConversationStore(pool);
  });

  const thread = (id = 'thread-1') => ({
    id,
    dotId: 'dot-1',
    ownerId: 'owner-1',
    title: 'First thought',
  });

  it('creates, reads, lists, and rejects duplicate threads', async () => {
    const created = await store.createThread(thread());
    expect(created).toMatchObject({ id: 'thread-1', dotId: 'dot-1' });
    expect(await store.threadExists('thread-1')).toBe(true);
    expect(await store.threadExists('missing')).toBe(false);
    expect(await store.getThread('missing')).toBeNull();
    await expect(store.createThread(thread())).rejects.toThrow();
    const records = await store.listThreadRecords('org', 'owner-1');
    expect(records).toEqual([
      expect.objectContaining({
        id: 'thread-1',
        name: 'First thought',
        agentId: 'dot-1',
        organizationId: 'org',
        createdById: 'owner-1',
        archived: false,
      }),
    ]);
    expect((await store.listThreadRecords('org', 'someone-else')).length).toBe(
      0,
    );
  });

  it('getOrCreateThread is idempotent and keeps the original title', async () => {
    await store.createThread(thread());
    const again = await store.getOrCreateThread({
      ...thread(),
      title: 'Renamed',
    });
    expect(again.title).toBe('First thought');
    const fresh = await store.getOrCreateThread(thread('thread-2'));
    expect(fresh.id).toBe('thread-2');
  });

  it('renames, archives, and deletes', async () => {
    await store.createThread(thread());
    await store.renameThread('thread-1', 'Renamed');
    expect((await store.getThread('thread-1'))?.title).toBe('Renamed');
    await store.archiveThread('thread-1');
    expect((await store.getThread('thread-1'))?.archived).toBe(true);
    await store.deleteThread('thread-1');
    expect(await store.getThread('thread-1')).toBeNull();
  });

  it('appends runs and returns the latest non-empty message snapshot', async () => {
    await store.createThread(thread());
    await store.appendRun({
      threadId: 'thread-1',
      runId: 'run-1',
      agentId: 'dot-1',
      parentRunId: null,
      events: [{ type: 'RUN_STARTED' }] as never,
      messages: [{ id: 'm1', role: 'user', content: 'One' }],
    });
    await store.appendRun({
      threadId: 'thread-1',
      runId: 'run-2',
      agentId: 'dot-1',
      parentRunId: 'run-1',
      events: [{ type: 'RUN_FINISHED' }] as never,
      messages: [],
    });
    const runs = await store.listRuns('thread-1');
    expect(runs.map((run) => run.runId)).toEqual(['run-1', 'run-2']);
    expect(runs[1].parentRunId).toBe('run-1');
    expect(await store.getMessages('thread-1')).toEqual([
      { id: 'm1', role: 'user', content: 'One' },
    ]);
    // Duplicate (threadId, runId) is ignored, not fatal.
    await store.appendRun({
      threadId: 'thread-1',
      runId: 'run-1',
      agentId: 'dot-1',
      parentRunId: null,
      events: [],
      messages: [],
    });
    expect(await store.listRuns('thread-1')).toHaveLength(2);
  });

  it('stores and clears state and thread history', async () => {
    await store.createThread(thread());
    await store.saveState('thread-1', { count: 3 });
    expect(await store.getState('thread-1')).toEqual({ count: 3 });
    await store.clearThread('thread-1');
    expect(await store.getState('thread-1')).toBeNull();
    expect(await store.getMessages('thread-1')).toEqual([]);
    await store.appendRun({
      threadId: 'thread-1',
      runId: 'run-1',
      agentId: 'dot-1',
      parentRunId: null,
      events: [],
      messages: [{ id: 'm1', role: 'user', content: 'One' }],
    });
    await store.clearAllThreads();
    expect(await store.getThread('thread-1')).toBeNull();
    expect(await store.listRuns('thread-1')).toEqual([]);
  });

  it('cascades run deletion when the conversation is deleted', async () => {
    await store.createThread(thread());
    await store.appendRun({
      threadId: 'thread-1',
      runId: 'run-1',
      agentId: 'dot-1',
      parentRunId: null,
      events: [],
      messages: [{ id: 'm1', role: 'user', content: 'One' }],
    });
    await store.deleteThread('thread-1');
    expect(await store.listRuns('thread-1')).toEqual([]);
  });
});
