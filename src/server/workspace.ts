import { ComputerStore } from './computer-store.js';
import { ConnectionStore } from './connection-store.js';
import { Pages } from './pages.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateLearningSettings } from '../shared/learning.js';
import type { CallReceipt, Conversation, Dot, Space } from '../shared/types.js';
export class WorkspaceStore {
  private db: DatabaseSync;
  readonly pages: Pages;
  readonly computers: ComputerStore;
  readonly connections: ConnectionStore;
  constructor(
    path: string,
    readonly ownerId: string,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS dots(id TEXT PRIMARY KEY, spaceId TEXT NOT NULL, name TEXT NOT NULL, instructions TEXT NOT NULL, researchAllowed INTEGER NOT NULL, memoryAllowed INTEGER NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS thread_bindings(id TEXT PRIMARY KEY, dotId TEXT NOT NULL, ownerId TEXT NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS task_threads(taskId TEXT PRIMARY KEY, threadId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, threadId TEXT NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER, status TEXT NOT NULL, transcript TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS captures(threadId TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    // `learningContainerId` is a legacy hosted-Intelligence identifier. It is
    // retained so existing data keeps meaning, but it is now display-only: local
    // skills are keyed by Dot id in the Postgres `skills` table, and delivery is
    // gated solely by `skillDeliveryEnabled`. Never treat it as a hosted id.
    for (const [table, column, definition] of [
      ['dots', 'learningContainerId', 'TEXT'],
      ['dots', 'skillDeliveryEnabled', 'INTEGER NOT NULL DEFAULT 0'],
      // Work order WORK-021: the learning pass is opt-in per Dot and off by
      // default, so existing Dots keep costing nothing until enabled.
      ['dots', 'learningEnabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['dots', 'appsAllowed', 'INTEGER NOT NULL DEFAULT 0'],
      ['dots', 'composioToolkits', "TEXT NOT NULL DEFAULT '[]'"],
      ['dots', 'composioSessionId', 'TEXT'],
      ['dots', 'composioPolicyHash', 'TEXT'],
      ['thread_bindings', 'learningContainerId', 'TEXT'],
    ]) {
      if (
        !this.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((field) => field.name === column)
      )
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    // Migrate only once: restarting must never restore a revoked grant.
    if (
      !this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='dot_spaces'",
        )
        .get()
    ) {
      this.db.exec(`BEGIN;
        CREATE TABLE dot_spaces(dotId TEXT NOT NULL, spaceId TEXT NOT NULL, PRIMARY KEY(dotId, spaceId));
        INSERT INTO dot_spaces SELECT id, spaceId FROM dots;
        COMMIT;`);
    }
    this.computers = new ComputerStore(this.db);
    this.connections = new ConnectionStore(this.db);
    this.pages = new Pages(this.db, (id) =>
      this.spaces().some((space) => space.id === id),
    );
    if (
      !this.db
        .prepare('PRAGMA table_info(calls)')
        .all()
        .some((column) => column.name === 'anchorMessageId')
    )
      this.db.exec('ALTER TABLE calls ADD COLUMN anchorMessageId TEXT');
    if (!this.spaces().length) {
      const space = this.createSpace(
        'Everyday',
        'A little space for your day.',
      );
      this.createDot(
        space.id,
        'Dot',
        'Be thoughtful, practical, and concise. Help the user think clearly and follow through.',
        true,
        true,
      );
    }
  }
  close() {
    this.db.close();
  }
  spaces(): Space[] {
    return this.db
      .prepare('SELECT * FROM spaces ORDER BY createdAt')
      .all() as unknown as Space[];
  }
  createSpace(name: string, description: string): Space {
    const space = {
      id: randomUUID(),
      name,
      description,
      createdAt: Date.now(),
    };
    this.db
      .prepare('INSERT INTO spaces VALUES (?, ?, ?, ?)')
      .run(space.id, name, description, space.createdAt);
    return space;
  }
  dots(): Dot[] {
    return this.db
      .prepare('SELECT * FROM dots ORDER BY createdAt')
      .all()
      .map((row) => ({
        ...row,
        spaceIds: this.db
          .prepare(
            'SELECT spaceId FROM dot_spaces WHERE dotId=? ORDER BY spaceId',
          )
          .all(String(row.id))
          .map((grant) => String(grant.spaceId)),
        researchAllowed: !!row.researchAllowed,
        memoryAllowed: !!row.memoryAllowed,
        appsAllowed: !!row.appsAllowed,
        composioToolkits: JSON.parse(String(row.composioToolkits ?? '[]')),
        skillDeliveryEnabled: !!row.skillDeliveryEnabled,
        learningEnabled: !!row.learningEnabled,
      })) as unknown as Dot[];
  }
  dot(id: string) {
    return this.dots().find((dot) => dot.id === id);
  }
  createDot(
    spaceId: string,
    name: string,
    instructions: string,
    researchAllowed: boolean,
    memoryAllowed: boolean,
    spaceIds: string[] = [spaceId],
    learningContainerId: string | null = null,
    skillDeliveryEnabled = false,
    appsAllowed = false,
    composioToolkits: string[] = [],
    learningEnabled = false,
  ): Dot {
    this.validateSpaceAccess(spaceId, spaceIds);
    validateLearningSettings(learningContainerId, skillDeliveryEnabled);
    const dot: Dot = {
      id: randomUUID(),
      spaceId,
      spaceIds: [...new Set(spaceIds)].sort(),
      name,
      instructions,
      researchAllowed,
      memoryAllowed,
      appsAllowed,
      composioToolkits: [...new Set(composioToolkits)].sort(),
      composioSessionId: null,
      composioPolicyHash: null,
      learningContainerId,
      skillDeliveryEnabled,
      learningEnabled,
      createdAt: Date.now(),
    };
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO dots (id, spaceId, name, instructions, researchAllowed, memoryAllowed, createdAt, learningContainerId, skillDeliveryEnabled, appsAllowed, composioToolkits, learningEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          dot.id,
          spaceId,
          name,
          instructions,
          +researchAllowed,
          +memoryAllowed,
          dot.createdAt,
          learningContainerId,
          +skillDeliveryEnabled,
          +appsAllowed,
          JSON.stringify(dot.composioToolkits),
          +learningEnabled,
        );
      for (const id of dot.spaceIds)
        this.db.prepare('INSERT INTO dot_spaces VALUES (?, ?)').run(dot.id, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return dot;
  }
  canAccessSpace(dotId: string, spaceId: string) {
    return !!this.db
      .prepare('SELECT 1 FROM dot_spaces WHERE dotId=? AND spaceId=?')
      .get(dotId, spaceId);
  }
  /**
   * Why this Dot cannot be deleted right now, or undefined when it can.
   *
   * Conversations are the one hard dependency: they are the owner's chat
   * history (locally bound and stored in Postgres), and deleting a Dot must
   * never cascade them away silently. Scheduled tasks, voice calls and
   * connected-tool actions all run inside conversations, so the conversation
   * check covers them too. Spaces and pages are shared artifacts and are
   * never a blocker.
   */
  dotDeletionBlocker(id: string): string | undefined {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM thread_bindings WHERE dotId=?')
      .get(id) as { count: number | string | bigint };
    const count = Number(row.count);
    if (count > 0)
      return count === 1
        ? 'This Dot still has 1 conversation. Delete the conversation first; deleting a Dot never removes conversations.'
        : `This Dot still has ${count} conversations. Delete them first; deleting a Dot never removes conversations.`;
    return undefined;
  }
  /**
   * Remove a Dot and its Dot-specific workspace data. Spaces, pages and other
   * Dots are never touched. Returns false when the Dot does not exist.
   */
  deleteDot(id: string): boolean {
    if (!this.dot(id)) return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Page-chat reservations and links reference this Dot only; the pages
      // themselves stay and a new page conversation can be opened later.
      for (const statement of [
        'DELETE FROM page_threads WHERE dotId=?',
        'DELETE FROM mcp_approvals WHERE dotId=?',
        'DELETE FROM mcp_connections WHERE dotId=?',
        'DELETE FROM computer_permissions WHERE dotId=?',
        'DELETE FROM computer_audit WHERE dotId=?',
        'DELETE FROM dot_spaces WHERE dotId=?',
        'DELETE FROM dots WHERE id=?',
      ])
        this.db.prepare(statement).run(id);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private validateSpaceAccess(defaultSpace: string, spaceIds: string[]) {
    if (
      !spaceIds.includes(defaultSpace) ||
      spaceIds.some((id) => !this.spaces().some((space) => space.id === id))
    )
      throw new Error('Space access must include a valid default destination.');
  }
  updateDot(
    id: string,
    patch: Pick<
      Dot,
      | 'name'
      | 'instructions'
      | 'researchAllowed'
      | 'memoryAllowed'
      | 'appsAllowed'
      | 'composioToolkits'
    > & {
      spaceId?: string;
      spaceIds?: string[];
      learningContainerId?: string | null;
      skillDeliveryEnabled?: boolean;
      learningEnabled?: boolean;
    },
  ): Dot {
    const current = this.dot(id);
    if (!current) throw new Error('Dot not found.');
    const defaultSpace = patch.spaceId ?? current.spaceId;
    const spaceIds = patch.spaceIds ?? current.spaceIds;
    this.validateSpaceAccess(defaultSpace, spaceIds);
    const learningContainerId =
      patch.learningContainerId === undefined
        ? (current.learningContainerId ?? null)
        : patch.learningContainerId;
    const skillDeliveryEnabled =
      patch.skillDeliveryEnabled ?? current.skillDeliveryEnabled ?? false;
    const learningEnabled =
      patch.learningEnabled ?? current.learningEnabled ?? false;
    validateLearningSettings(learningContainerId, skillDeliveryEnabled);
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'UPDATE dots SET name=?, instructions=?, researchAllowed=?, memoryAllowed=?, learningContainerId=?, skillDeliveryEnabled=?, appsAllowed=?, composioToolkits=?, learningEnabled=? WHERE id=?',
        )
        .run(
          patch.name,
          patch.instructions,
          +patch.researchAllowed,
          +patch.memoryAllowed,
          learningContainerId,
          +skillDeliveryEnabled,
          +patch.appsAllowed,
          JSON.stringify([...new Set(patch.composioToolkits)].sort()),
          +learningEnabled,
          id,
        );
      this.db
        .prepare('UPDATE dots SET spaceId=? WHERE id=?')
        .run(defaultSpace, id);
      this.db.prepare('DELETE FROM dot_spaces WHERE dotId=?').run(id);
      for (const space of new Set(spaceIds))
        this.db.prepare('INSERT INTO dot_spaces VALUES (?, ?)').run(id, space);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.dot(id)!;
  }
  /**
   * Turn the automatic learning pass on or off for one Dot. Kept as a narrow
   * operation so the Skills section can toggle it without resubmitting the
   * whole Dot form.
   */
  setLearningEnabled(id: string, enabled: boolean): Dot {
    if (!this.dot(id)) throw new Error('Dot not found.');
    this.db
      .prepare('UPDATE dots SET learningEnabled=? WHERE id=?')
      .run(+enabled, id);
    return this.dot(id)!;
  }
  saveComposioSession(id: string, sessionId: string, policyHash: string) {
    this.db
      .prepare(
        'UPDATE dots SET composioSessionId=?, composioPolicyHash=? WHERE id=?',
      )
      .run(sessionId, policyHash, id);
  }
  conversations(): Conversation[] {
    return this.db
      .prepare(
        'SELECT * FROM thread_bindings WHERE ownerId=? ORDER BY createdAt DESC',
      )
      .all(this.ownerId) as unknown as Conversation[];
  }
  bindThread(id: string, dotId: string, title: string): Conversation {
    const dot = this.dot(dotId);
    if (!dot) throw new Error('Dot not found.');
    // The frozen `learningContainerId` is a legacy display value copied from the
    // Dot for continuity; it no longer drives delivery (skills are Dot-scoped).
    const value: Conversation = {
      id,
      dotId,
      ownerId: this.ownerId,
      title,
      createdAt: Date.now(),
      learningContainerId: dot.learningContainerId ?? null,
    };
    this.db
      .prepare(
        'INSERT INTO thread_bindings (id, dotId, ownerId, title, createdAt, learningContainerId) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        dotId,
        this.ownerId,
        title,
        value.createdAt,
        value.learningContainerId ?? null,
      );
    return value;
  }
  requireThread(id: string, dotId?: string): Conversation {
    const thread = this.conversations().find((thread) => thread.id === id);
    if (!thread || (dotId && thread.dotId !== dotId))
      throw new Error('Conversation does not belong to this Dot and owner.');
    return thread;
  }
  conversation(id: string): Conversation | undefined {
    return this.conversations().find((thread) => thread.id === id);
  }
  /**
   * Permanently remove a conversation and everything tied to it in the local
   * workspace database. Saved pages are kept, but detached from the thread so
   * no stale source reference remains.
   *
   * @returns true when the thread existed and was removed; false when it was
   * already gone, which makes retried or concurrent deletes idempotent.
   */
  deleteThread(threadId: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existed =
        this.db.prepare('DELETE FROM thread_bindings WHERE id=?').run(threadId)
          .changes > 0;
      this.db
        .prepare('DELETE FROM task_threads WHERE threadId=?')
        .run(threadId);
      this.db.prepare('DELETE FROM calls WHERE threadId=?').run(threadId);
      this.db.prepare('DELETE FROM captures WHERE threadId=?').run(threadId);
      this.db
        .prepare('DELETE FROM page_threads WHERE threadId=?')
        .run(threadId);
      this.db
        .prepare('DELETE FROM page_reviews WHERE threadId=?')
        .run(threadId);
      this.connections.deleteThreadData(threadId);
      // Pages are durable artifacts: keep them, drop the now-stale source link.
      this.db
        .prepare('UPDATE pages SET sourceThreadId=NULL WHERE sourceThreadId=?')
        .run(threadId);
      this.db.exec('COMMIT');
      return existed;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  bindTask(taskId: string, threadId: string) {
    this.requireThread(threadId);
    this.db
      .prepare('INSERT INTO task_threads VALUES (?, ?)')
      .run(taskId, threadId);
  }
  taskThread(taskId: string): string | undefined {
    const row = this.db
      .prepare('SELECT threadId FROM task_threads WHERE taskId=?')
      .get(taskId);
    return typeof row?.threadId === 'string' ? row.threadId : undefined;
  }
  calls(threadId?: string): CallReceipt[] {
    if (threadId) this.requireThread(threadId);
    return this.db
      .prepare(
        `SELECT * FROM calls ${threadId ? 'WHERE threadId=?' : ''} ORDER BY startedAt DESC`,
      )
      .all(...(threadId ? [threadId] : [])) as unknown as CallReceipt[];
  }
  createCall(threadId: string): CallReceipt {
    this.requireThread(threadId);
    const call: CallReceipt = {
      id: randomUUID(),
      threadId,
      startedAt: Date.now(),
      endedAt: null,
      status: 'connecting',
      transcript: '',
      error: null,
    };
    this.db
      .prepare(
        'INSERT INTO calls(id, threadId, startedAt, endedAt, status, transcript, error) VALUES (?, ?, ?, NULL, ?, ?, NULL)',
      )
      .run(call.id, threadId, call.startedAt, call.status, '');
    return call;
  }
  call(id: string): CallReceipt {
    const call = this.calls().find((call) => call.id === id);
    if (!call) throw new Error('Call not found.');
    this.requireThread(call.threadId);
    return call;
  }
  setCall(
    id: string,
    status: CallReceipt['status'],
    transcript: string,
    error: string | null = null,
  ) {
    const call = this.call(id);
    if (call.endedAt) return call;
    this.db
      .prepare(
        'UPDATE calls SET status=?, transcript=?, error=?, endedAt=? WHERE id=?',
      )
      .run(
        status,
        transcript,
        error,
        status === 'ended' || status === 'failed' ? Date.now() : null,
        id,
      );
    return this.call(id);
  }
  saveLateTranscript(id: string, transcript: string) {
    this.call(id);
    return (
      this.db
        .prepare(
          "UPDATE calls SET transcript=? WHERE id=? AND transcript='' AND endedAt IS NOT NULL",
        )
        .run(transcript, id).changes > 0
    );
  }
  anchorCall(id: string, anchor: string | undefined) {
    this.call(id);
    this.db
      .prepare('UPDATE calls SET anchorMessageId=? WHERE id=?')
      .run(anchor ?? null, id);
  }
  setCallError(id: string, error: string | null) {
    this.call(id);
    this.db.prepare('UPDATE calls SET error=? WHERE id=?').run(error, id);
  }
  saveCapture(threadId: string, value: unknown) {
    this.requireThread(threadId);
    this.db
      .prepare(
        'INSERT INTO captures VALUES (?, ?) ON CONFLICT(threadId) DO UPDATE SET value=excluded.value',
      )
      .run(threadId, JSON.stringify(value));
  }
  capture(threadId: string): unknown {
    this.requireThread(threadId);
    const row = this.db
      .prepare('SELECT value FROM captures WHERE threadId=?')
      .get(threadId);
    return typeof row?.value === 'string' ? JSON.parse(row.value) : null;
  }
}
