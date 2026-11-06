import {
  AgentRunner,
  finalizeRunEvents,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
  type LocalThreadEndpointRecord,
  type LocalThreadEndpointRunner,
} from '@copilotkit/runtime/v2';
import {
  EventType,
  compactEvents,
  type AbstractAgent,
  type BaseEvent,
  type Message,
} from '@ag-ui/client';
import { ReplaySubject, type Observable } from 'rxjs';
import type {
  ConversationRecord,
  ConversationStorage,
  StoredRun,
} from './conversation-store.js';

/**
 * In-process concurrency state. It is intentionally NOT persisted: only
 * threads, runs, and state live in Postgres. Mirrors the in-memory runner's
 * per-thread bookkeeping exactly.
 */
interface LiveThread {
  subject: ReplaySubject<BaseEvent> | null;
  isRunning: boolean;
  currentRunId: string | null;
  agent: AbstractAgent | null;
  runSubject: ReplaySubject<BaseEvent> | null;
  stopRequested: boolean;
  activeFinalize: { stopRequested: boolean } | null;
  currentEvents: BaseEvent[] | null;
}

interface ThreadCache {
  events: BaseEvent[];
  messages: Message[];
}

/** What the run-completion hook needs to decide whether to learn. */
export interface PersistedRunInfo {
  threadId: string;
  runId: string;
  agentId: string;
}

export interface PostgresAgentRunnerOptions {
  ownerId: string;
  organizationId?: string;
  /**
   * Called after a run is committed, for the learning pass. It must not throw
   * or block the run: errors are logged and the run always completes.
   */
  onRunPersisted?: (info: PersistedRunInfo) => void | Promise<void>;
}

const messageIdOf = (event: BaseEvent): string | undefined => {
  const value = (event as { messageId?: unknown }).messageId;
  return typeof value === 'string' ? value : undefined;
};

const runStartedInput = (event: BaseEvent) =>
  (event as { type: EventType.RUN_STARTED; input?: unknown }).input as
    { messages?: Message[] } | undefined;

function logFailure(operation: string, error: unknown): void {
  // Never surface message content or SQL detail: name and operation only.
  console.error(
    `${operation} failed: ${error instanceof Error ? error.name : 'Error'}`,
  );
}

/**
 * Persists threads and runs in PostgreSQL while implementing the runtime's
 * `LocalThreadEndpointRunner` contract, so the SSE runtime serves the client's
 * thread REST endpoints locally with no CopilotKit hosted service.
 *
 * The `listThreads`/`getThreadMessages`/`getThreadEvents`/`getThreadState`
 * members are synchronous in the interface, so this runner keeps an in-process
 * mirror that `preloadAll()` fills from Postgres at startup and every run
 * refreshes. Postgres remains the durable source of truth.
 */
export class PostgresAgentRunner
  extends AgentRunner
  implements LocalThreadEndpointRunner
{
  readonly ɵsupportsLocalThreadEndpoints = true;
  private readonly live = new Map<string, LiveThread>();
  private readonly threadRecords = new Map<string, LocalThreadEndpointRecord>();
  private readonly cache = new Map<string, ThreadCache>();
  private readonly ownerId: string;
  private readonly organizationId: string;
  private readonly onRunPersisted?: PostgresAgentRunnerOptions['onRunPersisted'];

  constructor(
    private readonly conversations: ConversationStorage,
    options: PostgresAgentRunnerOptions,
  ) {
    super();
    this.ownerId = options.ownerId;
    this.organizationId = options.organizationId ?? '';
    this.onRunPersisted = options.onRunPersisted;
  }

  /** Load the synchronous mirror from Postgres. Call once before serving. */
  async preloadAll(): Promise<void> {
    const records = await this.conversations.listThreadRecords(
      this.organizationId,
      this.ownerId,
    );
    for (const record of records) {
      this.threadRecords.set(record.id, record);
      this.primeCache(record.id, await this.conversations.listRuns(record.id));
    }
  }

  /** Refresh the thread list mirror, e.g. after the app creates a conversation. */
  async refreshThreadCache(): Promise<void> {
    const records = await this.conversations.listThreadRecords(
      this.organizationId,
      this.ownerId,
    );
    for (const record of records) this.threadRecords.set(record.id, record);
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const store = this.liveThread(request.threadId);
    if (store.isRunning || store.stopRequested)
      throw new Error('Thread already running');
    store.isRunning = true;
    store.currentRunId = request.input.runId;
    store.agent = request.agent;
    store.stopRequested = false;
    const finalizeControl = { stopRequested: false };
    store.activeFinalize = finalizeControl;
    const seenMessageIds = new Set<string>();
    const currentRunEvents: BaseEvent[] = [];
    store.currentEvents = currentRunEvents;
    const nextSubject = new ReplaySubject<BaseEvent>(Infinity);
    store.subject = nextSubject;
    const runSubject = new ReplaySubject<BaseEvent>(Infinity);
    store.runSubject = runSubject;
    void this.execute(
      request,
      store,
      finalizeControl,
      currentRunEvents,
      seenMessageIds,
      nextSubject,
      runSubject,
    );
    return runSubject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const connectionSubject = new ReplaySubject<BaseEvent>(Infinity);
    void (async () => {
      try {
        const runs = await this.conversations.listRuns(request.threadId);
        this.primeCache(request.threadId, runs);
        const historic = runs.flatMap((run) => run.events);
        const compacted = compactEvents(historic);
        const emittedMessageIds = new Set<string>();
        for (const event of compacted) {
          connectionSubject.next(event);
          const messageId = messageIdOf(event);
          if (messageId) emittedMessageIds.add(messageId);
        }
        const store = this.live.get(request.threadId);
        if (store?.subject && (store.isRunning || store.stopRequested)) {
          store.subject.subscribe({
            next: (event) => {
              const messageId = messageIdOf(event);
              if (messageId && emittedMessageIds.has(messageId)) return;
              connectionSubject.next(event);
            },
            complete: () => connectionSubject.complete(),
            error: (error) => connectionSubject.error(error),
          });
        } else connectionSubject.complete();
      } catch (error) {
        connectionSubject.error(error);
      }
    })();
    return connectionSubject.asObservable();
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return Promise.resolve(this.live.get(request.threadId)?.isRunning ?? false);
  }

  async stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const store = this.live.get(request.threadId);
    if (!store || !store.isRunning) return false;
    if (request.runId !== undefined && store.currentRunId !== request.runId)
      return false;
    if (store.stopRequested) return false;
    store.stopRequested = true;
    store.isRunning = false;
    const finalizeControl = store.activeFinalize;
    if (finalizeControl) finalizeControl.stopRequested = true;
    const agent = store.agent;
    if (!agent) {
      store.stopRequested = false;
      store.isRunning = false;
      if (finalizeControl) finalizeControl.stopRequested = false;
      return false;
    }
    try {
      agent.abortRun();
      return true;
    } catch (error) {
      logFailure('Aborting agent run', error);
      store.stopRequested = false;
      store.isRunning = true;
      if (finalizeControl) finalizeControl.stopRequested = false;
      return false;
    }
  }

  listThreads(): LocalThreadEndpointRecord[] {
    return [...this.threadRecords.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  getThreadMessages(threadId: string): Message[] {
    return [...(this.cache.get(threadId)?.messages ?? [])];
  }

  getThreadEvents(threadId: string): BaseEvent[] {
    const events = this.cache.get(threadId)?.events;
    return events?.length ? compactEvents(events) : [];
  }

  getThreadState(threadId: string): Record<string, unknown> | null {
    const events = this.getThreadEvents(threadId);
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.type === EventType.STATE_SNAPSHOT) {
        const snapshot = (event as { snapshot?: unknown }).snapshot;
        if (
          snapshot &&
          typeof snapshot === 'object' &&
          !Array.isArray(snapshot)
        )
          return { ...(snapshot as Record<string, unknown>) };
        return null;
      }
    }
    return null;
  }

  clearThreads(): void {
    this.cache.clear();
    this.threadRecords.clear();
    this.conversations.clearAllThreads().catch((error) => {
      logFailure('Clearing threads', error);
    });
  }

  private liveThread(threadId: string): LiveThread {
    const existing = this.live.get(threadId);
    if (existing) return existing;
    const created: LiveThread = {
      subject: null,
      isRunning: false,
      currentRunId: null,
      agent: null,
      runSubject: null,
      stopRequested: false,
      activeFinalize: null,
      currentEvents: null,
    };
    this.live.set(threadId, created);
    return created;
  }

  private primeCache(threadId: string, runs: StoredRun[]): void {
    let messages: Message[] = [];
    const events: BaseEvent[] = [];
    for (const run of runs) {
      events.push(...run.events);
      if (run.messages.length) messages = run.messages;
    }
    this.cache.set(threadId, { events, messages });
  }

  private async execute(
    request: AgentRunnerRunRequest,
    store: LiveThread,
    finalizeControl: { stopRequested: boolean },
    currentRunEvents: BaseEvent[],
    seenMessageIds: Set<string>,
    nextSubject: ReplaySubject<BaseEvent>,
    runSubject: ReplaySubject<BaseEvent>,
  ): Promise<void> {
    const threadId = request.threadId;
    const agentId = request.agent.agentId ?? 'default';
    let parentRunId: string | null = null;
    const historicMessageIds = new Set<string>();
    try {
      const runs = await this.conversations.listRuns(threadId);
      this.primeCache(threadId, runs);
      parentRunId = runs.at(-1)?.runId ?? null;
      for (const run of runs) {
        for (const event of run.events) {
          const messageId = messageIdOf(event);
          if (messageId) historicMessageIds.add(messageId);
          if (event.type === EventType.RUN_STARTED)
            for (const message of runStartedInput(event)?.messages ?? [])
              historicMessageIds.add(message.id);
        }
      }
      const record =
        (await this.conversations.getThread(threadId)) ??
        (await this.conversations.getOrCreateThread({
          id: threadId,
          dotId: agentId,
          ownerId: this.ownerId,
          title: 'Conversation',
        }));
      this.noteThreadRecord(record);
    } catch (error) {
      logFailure('Loading thread history', error);
    }
    const finalize = (options: { interruptionMessage?: string }) =>
      this.finalize(
        request,
        store,
        finalizeControl,
        currentRunEvents,
        nextSubject,
        runSubject,
        parentRunId,
        options.interruptionMessage,
      );
    try {
      await request.agent.runAgent(request.input, {
        onEvent: ({ event }) => {
          let processedEvent = event;
          if (event.type === EventType.RUN_STARTED) {
            const runStarted = event as {
              type: EventType.RUN_STARTED;
              input?: { messages?: Message[] } & Record<string, unknown>;
            };
            if (!runStarted.input) {
              const messages = request.input.messages?.filter(
                (message) => !historicMessageIds.has(message.id),
              );
              runStarted.input = {
                ...request.input,
                ...(messages !== undefined ? { messages } : {}),
              };
            }
            processedEvent = event;
          }
          runSubject.next(processedEvent);
          nextSubject.next(processedEvent);
          currentRunEvents.push(processedEvent);
        },
        onNewMessage: ({ message }) => {
          seenMessageIds.add(message.id);
        },
        onRunStartedEvent: () => {
          for (const message of request.input.messages ?? [])
            if (!seenMessageIds.has(message.id)) seenMessageIds.add(message.id);
        },
      });
      await finalize({});
    } catch (error) {
      await finalize({
        interruptionMessage:
          error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async finalize(
    request: AgentRunnerRunRequest,
    store: LiveThread,
    finalizeControl: { stopRequested: boolean },
    currentRunEvents: BaseEvent[],
    nextSubject: ReplaySubject<BaseEvent>,
    runSubject: ReplaySubject<BaseEvent>,
    parentRunId: string | null,
    interruptionMessage?: string,
  ): Promise<void> {
    const isError = interruptionMessage !== undefined;
    const preFinalizeEventCount = currentRunEvents.length;
    const appended = finalizeRunEvents(currentRunEvents, {
      stopRequested: finalizeControl.stopRequested,
      ...(isError ? { interruptionMessage } : {}),
    });
    for (const event of appended) {
      runSubject.next(event);
      nextSubject.next(event);
    }
    const ownsThread = store.currentRunId === request.input.runId;
    if (ownsThread && (!isError || preFinalizeEventCount > 0)) {
      const compacted = compactEvents(currentRunEvents);
      const messages = Array.isArray(request.agent.messages)
        ? [...request.agent.messages]
        : [];
      try {
        await this.conversations.appendRun({
          threadId: request.threadId,
          runId: request.input.runId,
          agentId: request.agent.agentId ?? 'default',
          parentRunId,
          events: compacted,
          messages,
        });
        this.appendCache(request.threadId, compacted, messages);
        await this.notifyPersisted({
          threadId: request.threadId,
          runId: request.input.runId,
          agentId: request.agent.agentId ?? 'default',
        });
      } catch (error) {
        logFailure('Persisting thread run', error);
      }
    }
    if (ownsThread) {
      store.currentEvents = null;
      store.currentRunId = null;
      store.agent = null;
      store.runSubject = null;
      store.stopRequested = false;
      store.isRunning = false;
      store.activeFinalize = null;
    }
    runSubject.complete();
    nextSubject.complete();
    if (store.subject === nextSubject) store.subject = null;
  }

  /**
   * Offer the committed run to the learning hook. The hook is not allowed to
   * break a run: a failure is logged here, under its own operation name, and
   * the run keeps completing normally.
   */
  private async notifyPersisted(info: PersistedRunInfo): Promise<void> {
    if (!this.onRunPersisted) return;
    try {
      await this.onRunPersisted(info);
    } catch (error) {
      logFailure('Post-run hook', error);
    }
  }

  private appendCache(
    threadId: string,
    events: BaseEvent[],
    messages: Message[],
  ): void {
    const cache = this.cache.get(threadId) ?? { events: [], messages: [] };
    cache.events = [...cache.events, ...events];
    if (messages.length) cache.messages = [...messages];
    this.cache.set(threadId, cache);
  }

  private noteThreadRecord(record: ConversationRecord): void {
    this.threadRecords.set(record.id, {
      id: record.id,
      name: record.title,
      agentId: record.dotId,
      organizationId: this.organizationId,
      createdById: record.ownerId,
      archived: record.archived,
      createdAt: new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt).toISOString(),
    });
  }
}
