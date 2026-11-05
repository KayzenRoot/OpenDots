import type { Message } from '@ag-ui/client';
import type { LocalThreadEndpointRecord } from '@copilotkit/runtime/v2';
import type {
  ConversationRecord,
  ConversationStorage,
  StoredRun,
  StoredRunInput,
  ThreadInit,
} from '../../src/server/conversation-store.js';

const now = () => new Date().toISOString();

/** In-memory ConversationStorage double for unit tests that must not need Postgres. */
export class MemoryConversations implements ConversationStorage {
  async ping(): Promise<void> {}
  private readonly threads = new Map<string, ConversationRecord>();
  private readonly runs = new Map<string, StoredRun[]>();
  private readonly states = new Map<string, Record<string, unknown>>();
  private nextRunId = 1;

  async createThread(input: ThreadInit): Promise<ConversationRecord> {
    if (this.threads.has(input.id)) throw new Error('Conversation exists.');
    const record: ConversationRecord = {
      id: input.id,
      dotId: input.dotId,
      ownerId: input.ownerId,
      title: input.title,
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    this.threads.set(input.id, record);
    return { ...record };
  }

  async getOrCreateThread(input: ThreadInit): Promise<ConversationRecord> {
    const existing = this.threads.get(input.id);
    if (existing) return { ...existing };
    return this.createThread(input);
  }

  async threadExists(threadId: string): Promise<boolean> {
    return this.threads.has(threadId);
  }

  async getThread(threadId: string): Promise<ConversationRecord | null> {
    const record = this.threads.get(threadId);
    return record ? { ...record } : null;
  }

  async listThreadRecords(
    organizationId: string,
    createdById: string,
  ): Promise<LocalThreadEndpointRecord[]> {
    return [...this.threads.values()]
      .filter((thread) => thread.ownerId === createdById)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((thread) => ({
        id: thread.id,
        name: thread.title,
        agentId: thread.dotId,
        organizationId,
        createdById: thread.ownerId,
        archived: thread.archived,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      }));
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (thread) this.threads.set(threadId, { ...thread, title });
  }

  async archiveThread(threadId: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (thread) this.threads.set(threadId, { ...thread, archived: true });
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads.delete(threadId);
    this.runs.delete(threadId);
    this.states.delete(threadId);
  }

  async appendRun(input: StoredRunInput): Promise<void> {
    const runs = this.runs.get(input.threadId) ?? [];
    if (runs.some((run) => run.runId === input.runId)) return;
    runs.push({
      id: this.nextRunId++,
      threadId: input.threadId,
      runId: input.runId,
      agentId: input.agentId,
      parentRunId: input.parentRunId,
      events: input.events,
      messages: input.messages,
      createdAt: now(),
    });
    this.runs.set(input.threadId, runs);
  }

  async listRuns(threadId: string): Promise<StoredRun[]> {
    return (this.runs.get(threadId) ?? []).map((run) => ({ ...run }));
  }

  async getMessages(threadId: string): Promise<Message[]> {
    const runs = this.runs.get(threadId) ?? [];
    for (let index = runs.length - 1; index >= 0; index--)
      if (runs[index].messages.length) return [...runs[index].messages];
    return [];
  }

  async saveState(
    threadId: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    this.states.set(threadId, state);
  }

  async getState(threadId: string): Promise<Record<string, unknown> | null> {
    return this.states.get(threadId) ?? null;
  }

  async clearThread(threadId: string): Promise<void> {
    this.runs.delete(threadId);
    this.states.delete(threadId);
  }

  async clearAllThreads(): Promise<void> {
    this.runs.clear();
    this.states.clear();
    this.threads.clear();
  }
}
