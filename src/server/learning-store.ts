import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  skillDescription,
  type DeliverableSkill,
  type SkillSource,
} from './learning.js';

/** A persisted skill row. */
export interface SkillRecord {
  id: string;
  dotId: string;
  name: string;
  body: string;
  revision: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSkillInput {
  name: string;
  body: string;
  /** Defaults to true on first insert; updates keep the current value. */
  enabled?: boolean;
}

const skillColumns = `id, dot_id AS "dotId", name, body, revision, enabled,
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

  /** Every skill for a Dot, including disabled ones, in delivery order. */
  async listSkills(dotId: string): Promise<SkillRecord[]> {
    const { rows } = await this.pool.query<SkillRecord>(
      `SELECT ${skillColumns} FROM skills WHERE dot_id = $1 ${deliveryOrder}`,
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
   * content refresh cannot silently re-enable a disabled skill.
   */
  async upsertSkill(
    dotId: string,
    input: UpsertSkillInput,
  ): Promise<SkillRecord> {
    const { rows } = await this.pool.query<SkillRecord>(
      `INSERT INTO skills (id, dot_id, name, body, revision, enabled)
       VALUES ($1, $2, $3, $4, 1, $5)
       ON CONFLICT (dot_id, name) DO UPDATE SET
         body = EXCLUDED.body,
         revision = skills.revision + 1,
         updated_at = now()
       RETURNING ${skillColumns}`,
      [randomUUID(), dotId, input.name, input.body, input.enabled ?? true],
    );
    return record(rows[0]);
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

  /** Enabled skills for a Dot, in deterministic order. */
  async deliverableSkills(dotId: string): Promise<DeliverableSkill[]> {
    const { rows } = await this.pool.query<SkillRecord>(
      `SELECT ${skillColumns} FROM skills
       WHERE dot_id = $1 AND enabled = true ${deliveryOrder}`,
      [dotId],
    );
    return rows.map((row) => ({
      name: row.name,
      description: skillDescription(row.body, row.name),
      body: row.body,
      revision: Number(row.revision),
    }));
  }
}
