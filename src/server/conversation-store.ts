import type { Pool } from 'pg';
import type { BaseEvent, Message } from '@ag-ui/client';
import type { LocalThreadEndpointRecord } from '@copilotkit/runtime/v2';

export interface ThreadInit {
  id: string;
  dotId: string;
  ownerId: string;
  title: string;
}

export interface ConversationRecord {
  id: string;
  dotId: string;
  ownerId: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredRun {
  id: number;
  threadId: string;
  runId: string;
  agentId: string;
  parentRunId: string | null;
  events: BaseEvent[];
  messages: Message[];
  createdAt: string;
}

export interface StoredRunInput {
  threadId: string;
  runId: string;
  agentId: string;
  parentRunId: string | null;
  events: BaseEvent[];
  messages: Message[];
}

/**
 * The storage surface the runner and platform depend on. Kept as an interface
 * so unit tests can inject an in-memory double instead of a live Postgres.
 */
export interface ConversationStorage {
  /** Resolves only when the database answers a trivial query. */
  ping(): Promise<void>;
  createThread(input: ThreadInit): Promise<ConversationRecord>;
  getOrCreateThread(input: ThreadInit): Promise<ConversationRecord>;
  threadExists(threadId: string): Promise<boolean>;
  getThread(threadId: string): Promise<ConversationRecord | null>;
  listThreadRecords(
    organizationId: string,
    createdById: string,
  ): Promise<LocalThreadEndpointRecord[]>;
  renameThread(threadId: string, title: string): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  appendRun(input: StoredRunInput): Promise<void>;
  listRuns(threadId: string): Promise<StoredRun[]>;
  saveState(threadId: string, state: Record<string, unknown>): Promise<void>;
  getState(threadId: string): Promise<Record<string, unknown> | null>;
  clearThread(threadId: string): Promise<void>;
  clearAllThreads(): Promise<void>;
  getMessages(threadId: string): Promise<Message[]>;
}

const conversationColumns = `id, dot_id AS "dotId", owner_id AS "ownerId",
  title, archived, created_at AS "createdAt", updated_at AS "updatedAt"`;

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** Durable conversation, run, and state storage. Every statement is parameterised. */
export class ConversationStore implements ConversationStorage {
  constructor(private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async createThread(input: ThreadInit): Promise<ConversationRecord> {
    const { rows } = await this.pool.query<ConversationRecord>(
      `INSERT INTO conversations (id, dot_id, owner_id, title)
       VALUES ($1, $2, $3, $4) RETURNING ${conversationColumns}`,
      [input.id, input.dotId, input.ownerId, input.title],
    );
    return rows[0];
  }

  async getOrCreateThread(input: ThreadInit): Promise<ConversationRecord> {
    const { rows } = await this.pool.query<ConversationRecord>(
      `INSERT INTO conversations (id, dot_id, owner_id, title)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET updated_at = now()
       RETURNING ${conversationColumns}`,
      [input.id, input.dotId, input.ownerId, input.title],
    );
    return rows[0];
  }

  async threadExists(threadId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'SELECT 1 FROM conversations WHERE id = $1',
      [threadId],
    );
    return (rowCount ?? 0) > 0;
  }

  async getThread(threadId: string): Promise<ConversationRecord | null> {
    const { rows } = await this.pool.query<ConversationRecord>(
      `SELECT ${conversationColumns} FROM conversations WHERE id = $1`,
      [threadId],
    );
    return rows[0] ?? null;
  }

  async listThreadRecords(
    organizationId: string,
    createdById: string,
  ): Promise<LocalThreadEndpointRecord[]> {
    const { rows } = await this.pool.query<ConversationRecord>(
      `SELECT ${conversationColumns} FROM conversations
       WHERE owner_id = $1 ORDER BY created_at DESC`,
      [createdById],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.title,
      agentId: row.dotId,
      organizationId,
      createdById: row.ownerId,
      archived: row.archived,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }));
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    await this.pool.query(
      'UPDATE conversations SET title = $2, updated_at = now() WHERE id = $1',
      [threadId, title],
    );
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.pool.query(
      'UPDATE conversations SET archived = true, updated_at = now() WHERE id = $1',
      [threadId],
    );
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.pool.query('DELETE FROM conversations WHERE id = $1', [
      threadId,
    ]);
  }

  async appendRun(input: StoredRunInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO thread_runs
         (thread_id, run_id, agent_id, parent_run_id, events, messages)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (thread_id, run_id) DO NOTHING`,
      [
        input.threadId,
        input.runId,
        input.agentId,
        input.parentRunId,
        JSON.stringify(input.events),
        JSON.stringify(input.messages),
      ],
    );
    await this.pool.query(
      'UPDATE conversations SET updated_at = now() WHERE id = $1',
      [input.threadId],
    );
  }

  async listRuns(threadId: string): Promise<StoredRun[]> {
    const { rows } = await this.pool.query<{
      id: string;
      threadId: string;
      runId: string;
      agentId: string;
      parentRunId: string | null;
      events: BaseEvent[];
      messages: Message[];
      createdAt: Date;
    }>(
      `SELECT id, thread_id AS "threadId", run_id AS "runId",
              agent_id AS "agentId", parent_run_id AS "parentRunId",
              events, messages, created_at AS "createdAt"
       FROM thread_runs WHERE thread_id = $1
       ORDER BY created_at ASC, id ASC`,
      [threadId],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      threadId: row.threadId,
      runId: row.runId,
      agentId: row.agentId,
      parentRunId: row.parentRunId,
      events: row.events ?? [],
      messages: row.messages ?? [],
      createdAt: iso(row.createdAt),
    }));
  }

  /** Latest non-empty message snapshot, mirroring the in-memory runner. */
  async getMessages(threadId: string): Promise<Message[]> {
    const { rows } = await this.pool.query<{ messages: Message[] }>(
      `SELECT messages FROM thread_runs
       WHERE thread_id = $1 AND jsonb_array_length(messages) > 0
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [threadId],
    );
    return rows[0]?.messages ?? [];
  }

  async saveState(
    threadId: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO thread_state (thread_id, state) VALUES ($1, $2::jsonb)
       ON CONFLICT (thread_id)
       DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [threadId, JSON.stringify(state)],
    );
  }

  async getState(threadId: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pool.query<{
      state: Record<string, unknown>;
    }>('SELECT state FROM thread_state WHERE thread_id = $1', [threadId]);
    return rows[0]?.state ?? null;
  }

  async clearThread(threadId: string): Promise<void> {
    await this.pool.query('DELETE FROM thread_runs WHERE thread_id = $1', [
      threadId,
    ]);
    await this.pool.query('DELETE FROM thread_state WHERE thread_id = $1', [
      threadId,
    ]);
  }

  async clearAllThreads(): Promise<void> {
    await this.pool.query('DELETE FROM thread_state');
    await this.pool.query('DELETE FROM thread_runs');
    await this.pool.query('DELETE FROM conversations');
  }
}
