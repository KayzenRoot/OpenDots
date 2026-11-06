import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  skillDescription,
  type DeliverableSkill,
  type SkillSource,
} from './learning.js';

/**
 * Approval state of a skill. `proposed` is the untrusted status a model-authored
 * skill is created with: it is stored but never delivered until a human
 * approves it. `rejected` remembers a refusal so the reflection pass can skip
 * re-proposing it. Only `approved` (and enabled) skills are delivered.
 */
export type SkillStatus = 'approved' | 'proposed' | 'rejected';

/**
 * Where a skill came from. `manual` is a human writing it in the editor;
 * `learning` is a proposal produced by the reflection pass. The distinction is
 * shown in the editor so a proposal is never mistaken for a deliberate rule.
 */
export type SkillOrigin = 'manual' | 'learning';

/** A persisted skill row. */
export interface SkillRecord {
  id: string;
  dotId: string;
  name: string;
  body: string;
  revision: number;
  enabled: boolean;
  status: SkillStatus;
  /** Why a rejection happened; null unless `status` is `rejected`. */
  rejectionReason: string | null;
  source: SkillOrigin;
  /** The conversation a proposal was learned from; null for manual skills. */
  conversationId: string | null;
  /** Model label recorded when the pass suggested this skill. */
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSkillInput {
  name: string;
  body: string;
  /** Defaults to true on first insert; updates keep the current value. */
  enabled?: boolean;
}

/** Where a model-suggested skill came from. */
export interface ProposalProvenance {
  conversationId: string;
  /** Model label, for the editor's "what suggested this" line. */
  model?: string;
}

/** A conversation's learning marker: which snapshot was already analysed. */
export interface ConversationLearningState {
  threadId: string;
  dotId: string;
  messageCount: number;
  learnedAt: string;
}

const skillColumns = `id, dot_id AS "dotId", name, body, revision, enabled,
  status, rejection_reason AS "rejectionReason", source,
  conversation_id AS "conversationId", model,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

/**
 * Deterministic delivery order: by name, then id as a stable tiebreaker. The
 * `(dot_id, name)` unique index makes name alone effectively unique, but the
 * explicit tiebreaker keeps the order total even if that ever changes.
 */
const deliveryOrder = 'ORDER BY name ASC, id ASC';

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const record = (row: SkillRecord): SkillRecord => ({
  ...row,
  revision: Number(row.revision),
  status: row.status ?? 'approved',
  rejectionReason: row.rejectionReason ?? null,
  source: row.source ?? 'manual',
  conversationId: row.conversationId ?? null,
  model: row.model ?? null,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/**
 * Local skills storage over the Postgres `skills` table. Skills are keyed by
 * `dot_id`, so one Dot's skills never appear for another. Every statement is
 * parameterised. Mirrors `ConversationStore`'s structure and style.
 */
export class LearningStore implements SkillSource {
  constructor(private readonly pool: Pool) {}

  /**
   * Every row for a Dot, any status, in delivery order. The editor splits this
   * into approved skills and proposals; delivery filtering lives in
   * `deliverableSkills`.
   */
  async listSkills(dotId: string): Promise<SkillRecord[]> {
    const { rows } = await this.pool.query<SkillRecord>(
      `SELECT ${skillColumns} FROM skills WHERE dot_id = $1 ${deliveryOrder}`,
      [dotId],
    );
    return rows.map(record);
  }

  /** Only the pending proposals for a Dot, in delivery order. */
  async listProposals(dotId: string): Promise<SkillRecord[]> {
    const { rows } = await this.pool.query<SkillRecord>(
      `SELECT ${skillColumns} FROM skills
       WHERE dot_id = $1 AND status = 'proposed' ${deliveryOrder}`,
      [dotId],
    );
    return rows.map(record);
  }

  async getSkill(dotId: string, name: string): Promise<SkillRecord | null> {
    const { rows } = await this.pool.query<SkillRecord>(
      `SELECT ${skillColumns} FROM skills WHERE dot_id = $1 AND name = $2`,
      [dotId, name],
    );
    return rows[0] ? record(rows[0]) : null;
  }

  /**
   * Insert a skill, or bump the revision of the existing `(dot_id, name)`. An
   * update replaces the body and bumps `revision`, but preserves `enabled` so a
   * content refresh cannot silently re-enable a disabled skill. Writing a skill
   * by hand is an approval, so the row is always `approved` and any previous
   * rejection is cleared.
   */
  async upsertSkill(
    dotId: string,
    input: UpsertSkillInput,
  ): Promise<SkillRecord> {
    const { rows } = await this.pool.query<SkillRecord>(
      `INSERT INTO skills
         (id, dot_id, name, body, revision, enabled, status, source)
       VALUES ($1, $2, $3, $4, 1, $5, 'approved', 'manual')
       ON CONFLICT (dot_id, name) DO UPDATE SET
         body = EXCLUDED.body,
         revision = skills.revision + 1,
         status = 'approved',
         rejection_reason = NULL,
         source = 'manual',
         conversation_id = NULL,
         model = NULL,
         updated_at = now()
       RETURNING ${skillColumns}`,
      [randomUUID(), dotId, input.name, input.body, input.enabled ?? true],
    );
    return record(rows[0]);
  }

  /**
   * Record a model-suggested skill. It is stored as `proposed`, which is never
   * delivered until `approveSkill` runs. A name that already exists for the Dot
   * is a duplicate and is dropped (returns null) so a proposal cannot overwrite
   * an approved skill.
   */
  async proposeSkill(
    dotId: string,
    input: UpsertSkillInput,
    provenance?: ProposalProvenance,
  ): Promise<SkillRecord | null> {
    const { rows } = await this.pool.query<SkillRecord>(
      `INSERT INTO skills
         (id, dot_id, name, body, revision, enabled, status, source,
          conversation_id, model)
       VALUES ($1, $2, $3, $4, 1, true, 'proposed', 'learning', $5, $6)
       ON CONFLICT (dot_id, name) DO NOTHING
       RETURNING ${skillColumns}`,
      [
        randomUUID(),
        dotId,
        input.name,
        input.body,
        provenance?.conversationId ?? null,
        provenance?.model ?? null,
      ],
    );
    return rows[0] ? record(rows[0]) : null;
  }

  /** Approve a proposal, making it deliverable. Returns null when absent. */
  async approveSkill(dotId: string, name: string): Promise<SkillRecord | null> {
    const { rows } = await this.pool.query<SkillRecord>(
      `UPDATE skills
       SET status = 'approved', rejection_reason = NULL, updated_at = now()
       WHERE dot_id = $1 AND name = $2 RETURNING ${skillColumns}`,
      [dotId, name],
    );
    return rows[0] ? record(rows[0]) : null;
  }

  /**
   * Reject a proposal with a reason, remembered so a later reflection pass can
   * skip re-proposing it. Returns null when the skill does not exist.
   */
  async rejectSkill(
    dotId: string,
    name: string,
    reason: string,
  ): Promise<SkillRecord | null> {
    const { rows } = await this.pool.query<SkillRecord>(
      `UPDATE skills
       SET status = 'rejected', rejection_reason = $3, updated_at = now()
       WHERE dot_id = $1 AND name = $2 RETURNING ${skillColumns}`,
      [dotId, name, reason],
    );
    return rows[0] ? record(rows[0]) : null;
  }

  /** Enable or disable a skill. Returns null when the skill does not exist. */
  async setSkillEnabled(
    dotId: string,
    name: string,
    enabled: boolean,
  ): Promise<SkillRecord | null> {
    const { rows } = await this.pool.query<SkillRecord>(
      `UPDATE skills SET enabled = $3, updated_at = now()
       WHERE dot_id = $1 AND name = $2 RETURNING ${skillColumns}`,
      [dotId, name, enabled],
    );
    return rows[0] ? record(rows[0]) : null;
  }

  /** Delete a skill. Returns whether a row was removed. */
  async deleteSkill(dotId: string, name: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM skills WHERE dot_id = $1 AND name = $2',
      [dotId, name],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Skills the agent may load: only `approved` AND `enabled`, in deterministic
   * order. A proposal is never delivered, even while enabled.
   */
  async deliverableSkills(dotId: string): Promise<DeliverableSkill[]> {
    const { rows } = await this.pool.query<SkillRecord>(
      `SELECT ${skillColumns} FROM skills
       WHERE dot_id = $1 AND status = 'approved' AND enabled = true
       ${deliveryOrder}`,
      [dotId],
    );
    return rows.map((row) => ({
      name: row.name,
      description: skillDescription(row.body, row.name),
      body: row.body,
      revision: Number(row.revision),
    }));
  }

  /**
   * The learning marker for one conversation, or null when it has never been
   * analysed. The reflection pass compares `messageCount` with the conversation
   * so the same messages are never sent to the model twice.
   */
  async learningState(
    threadId: string,
  ): Promise<ConversationLearningState | null> {
    const { rows } = await this.pool.query<{
      threadId: string;
      dotId: string;
      messageCount: number;
      learnedAt: string | Date;
    }>(
      `SELECT thread_id AS "threadId", dot_id AS "dotId",
              message_count AS "messageCount", learned_at AS "learnedAt"
       FROM learning_state WHERE thread_id = $1`,
      [threadId],
    );
    const row = rows[0];
    return row
      ? {
          threadId: row.threadId,
          dotId: row.dotId,
          messageCount: Number(row.messageCount),
          learnedAt: iso(row.learnedAt),
        }
      : null;
  }

  /** Record that a conversation snapshot was analysed. */
  async markLearned(
    threadId: string,
    dotId: string,
    messageCount: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO learning_state (thread_id, dot_id, message_count, learned_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (thread_id) DO UPDATE SET
         dot_id = EXCLUDED.dot_id,
         message_count = EXCLUDED.message_count,
         learned_at = now()`,
      [threadId, dotId, messageCount],
    );
  }

  /**
   * Record one reflection pass. Written before the model is called so the
   * hourly limit bounds spending even when a pass later fails.
   */
  async recordPass(dotId: string, threadId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO learning_passes (dot_id, thread_id) VALUES ($1, $2)',
      [dotId, threadId],
    );
  }

  /** Passes for a Dot since `since`, used for the per-hour cap. */
  async countPassesSince(dotId: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM learning_passes
       WHERE dot_id = $1 AND created_at >= $2`,
      [dotId, since],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
