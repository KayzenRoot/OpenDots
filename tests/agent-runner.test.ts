import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Pool } from 'pg';
import { Observable, Subject, from, lastValueFrom, toArray } from 'rxjs';
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import { createPool, migrate } from '../src/server/pg.js';
import { ConversationStore } from '../src/server/conversation-store.js';
import { PostgresAgentRunner } from '../src/server/agent-runner.js';

const databaseUrl = process.env.NEXBOT_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

class TestAgent extends AbstractAgent {
  aborted = false;
  constructor(private readonly events: Observable<BaseEvent>) {
    super({ agentId: 'dot-1' });
  }
  run(): Observable<BaseEvent> {
    return this.events;
  }
  abortRun(): void {
    this.aborted = true;
    super.abortRun();
  }
}

const completedRun = (threadId: string, runId: string): BaseEvent[] =>
  [
    { type: EventType.RUN_STARTED, threadId, runId },
    { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Hello' },
    { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
    { type: EventType.STATE_SNAPSHOT, snapshot: { count: 1 } },
    { type: EventType.RUN_FINISHED, threadId, runId },
  ] as unknown as BaseEvent[];

const input = (threadId: string, runId: string): RunAgentInput => ({
  threadId,
  runId,
  messages: [{ id: 'user-1', role: 'user', content: 'Hi' }],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
});

const reducedRun = (threadId: string, runId: string): BaseEvent[] =>
  [
    { type: EventType.RUN_STARTED, threadId, runId },
    { type: EventType.STATE_SNAPSHOT, snapshot: { count: 1 } },
    {
      type: EventType.STATE_DELTA,
      delta: [{ op: 'add', path: '/extra', value: true }],
    },
    { type: EventType.RUN_FINISHED, threadId, runId },
  ] as unknown as BaseEvent[];

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

describePostgres('PostgresAgentRunner (PostgreSQL)', () => {
  let pool: Pool;
  let conversations: ConversationStore;
  let runner: PostgresAgentRunner;
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
    conversations = new ConversationStore(pool);
    runner = new PostgresAgentRunner(conversations, { ownerId: 'owner-1' });
  });

  it('persists a run and serves threads, messages, events, and state locally', async () => {
    const agent = new TestAgent(from(completedRun('t1', 'r1')));
    agent.addMessage({ id: 'user-1', role: 'user', content: 'Hi' });
    const events = await lastValueFrom(
      runner
        .run({ threadId: 't1', agent, input: input('t1', 'r1') })
        .pipe(toArray()),
    );
    expect(events.some((event) => event.type === EventType.RUN_FINISHED)).toBe(
      true,
    );
    await expect(conversations.listRuns('t1')).resolves.toHaveLength(1);
    expect(runner.listThreads()).toEqual([
      expect.objectContaining({ id: 't1', agentId: 'dot-1' }),
    ]);
    expect(runner.getThreadMessages('t1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'm1', role: 'assistant' }),
      ]),
    );
    expect(
      runner
        .getThreadEvents('t1')
        .some((e) => e.type === EventType.RUN_STARTED),
    ).toBe(true);
    expect(runner.getThreadState('t1')).toEqual({ count: 1 });
    expect(await runner.isRunning({ threadId: 't1' })).toBe(false);
  });

  it('reduces STATE_DELTA events into the thread state snapshot', async () => {
    const agent = new TestAgent(from(reducedRun('t6', 'r6')));
    agent.addMessage({ id: 'user-1', role: 'user', content: 'Hi' });
    await lastValueFrom(
      runner
        .run({ threadId: 't6', agent, input: input('t6', 'r6') })
        .pipe(toArray()),
    );
    expect(runner.getThreadState('t6')).toEqual({ count: 1, extra: true });
  });

  it('reloads the synchronous mirror from Postgres after a restart', async () => {
    const agent = new TestAgent(from(completedRun('t1', 'r1')));
    agent.addMessage({ id: 'user-1', role: 'user', content: 'Hi' });
    await lastValueFrom(
      runner
        .run({ threadId: 't1', agent, input: input('t1', 'r1') })
        .pipe(toArray()),
    );
    const restarted = new PostgresAgentRunner(conversations, {
      ownerId: 'owner-1',
    });
    expect(restarted.listThreads()).toEqual([]);
    await restarted.preloadAll();
    expect(restarted.listThreads().map((thread) => thread.id)).toEqual(['t1']);
    expect(restarted.getThreadMessages('t1').length).toBeGreaterThan(0);
  });

  it('throws on a concurrent run of the same thread', async () => {
    const subject = new Subject<BaseEvent>();
    const agent = new TestAgent(subject.asObservable());
    const collected = runner
      .run({ threadId: 't2', agent, input: input('t2', 'r2') })
      .pipe(toArray());
    expect(await runner.isRunning({ threadId: 't2' })).toBe(true);
    expect(() =>
      runner.run({
        threadId: 't2',
        agent: new TestAgent(subject.asObservable()),
        input: input('t2', 'r3'),
      }),
    ).toThrow('Thread already running');
    subject.next({ type: EventType.RUN_STARTED, threadId: 't2', runId: 'r2' });
    subject.next({ type: EventType.RUN_FINISHED, threadId: 't2', runId: 'r2' });
    subject.complete();
    await lastValueFrom(collected);
    expect(await runner.isRunning({ threadId: 't2' })).toBe(false);
  });

  it('stops a running thread by aborting its agent', async () => {
    const subject = new Subject<BaseEvent>();
    const agent = new TestAgent(subject.asObservable());
    const collected = runner
      .run({ threadId: 't3', agent, input: input('t3', 'r3') })
      .pipe(toArray());
    expect(await runner.isRunning({ threadId: 't3' })).toBe(true);
    // A mismatched runId must not stop a newer run.
    expect(await runner.stop({ threadId: 't3', runId: 'other' })).toBe(false);
    expect(await runner.stop({ threadId: 't3' })).toBe(true);
    expect(agent.aborted).toBe(true);
    subject.complete();
    await lastValueFrom(collected);
    expect(await runner.isRunning({ threadId: 't3' })).toBe(false);
  });

  it('connect replays persisted history and completes when nothing is live', async () => {
    const agent = new TestAgent(from(completedRun('t4', 'r4')));
    agent.addMessage({ id: 'user-1', role: 'user', content: 'Hi' });
    await lastValueFrom(
      runner
        .run({ threadId: 't4', agent, input: input('t4', 'r4') })
        .pipe(toArray()),
    );
    const replayed = await lastValueFrom(
      runner.connect({ threadId: 't4' }).pipe(toArray()),
    );
    expect(replayed.some((event) => event.type === EventType.RUN_STARTED)).toBe(
      true,
    );
    await tick();
  });

  it('offers a persisted run to the post-run hook and isolates its failures', async () => {
    const hook = vi.fn();
    const hooked = new PostgresAgentRunner(conversations, {
      ownerId: 'owner-1',
      onRunPersisted: hook,
    });
    const agent = new TestAgent(from(completedRun('t7', 'r7')));
    agent.addMessage({ id: 'user-1', role: 'user', content: 'Hi' });
    await lastValueFrom(
      hooked
        .run({ threadId: 't7', agent, input: input('t7', 'r7') })
        .pipe(toArray()),
    );
    expect(hook).toHaveBeenCalledWith({
      threadId: 't7',
      runId: 'r7',
      agentId: 'dot-1',
    });

    // A throwing hook must not turn a completed run into a failure.
    const failing = new PostgresAgentRunner(conversations, {
      ownerId: 'owner-1',
      onRunPersisted: () => {
        throw new Error('learning exploded');
      },
    });
    const failingAgent = new TestAgent(from(completedRun('t8', 'r8')));
    failingAgent.addMessage({ id: 'user-1', role: 'user', content: 'Hi' });
    const events = await lastValueFrom(
      failing
        .run({ threadId: 't8', agent: failingAgent, input: input('t8', 'r8') })
        .pipe(toArray()),
    );
    expect(events.some((event) => event.type === EventType.RUN_FINISHED)).toBe(
      true,
    );
    expect(await failing.isRunning({ threadId: 't8' })).toBe(false);
    await expect(conversations.listRuns('t8')).resolves.toHaveLength(1);
  });

  it('clearThreads removes persisted threads and the in-process mirror', async () => {
    const agent = new TestAgent(from(completedRun('t5', 'r5')));
    agent.addMessage({ id: 'user-1', role: 'user', content: 'Hi' });
    await lastValueFrom(
      runner
        .run({ threadId: 't5', agent, input: input('t5', 'r5') })
        .pipe(toArray()),
    );
    runner.clearThreads();
    await tick();
    expect(runner.getThreadMessages('t5')).toEqual([]);
    await expect(conversations.listRuns('t5')).resolves.toEqual([]);
  });
});
