import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { skillDescription } from './learning.js';
import { LEARNING_PASSES_PER_HOUR } from './learning-pass.js';
import type { SkillRecord, UpsertSkillInput } from './learning-store.js';
import type { WorkspaceStore } from './workspace.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The storage surface these routes need. `LearningStore` implements it; a test
 * double satisfies the same shape, so the HTTP contract is verified without a
 * live database.
 */
export interface SkillCatalog {
  listSkills(dotId: string): Promise<SkillRecord[]>;
  listProposals(dotId: string): Promise<SkillRecord[]>;
  getSkill(dotId: string, name: string): Promise<SkillRecord | null>;
  upsertSkill(dotId: string, input: UpsertSkillInput): Promise<SkillRecord>;
  setSkillEnabled(
    dotId: string,
    name: string,
    enabled: boolean,
  ): Promise<SkillRecord | null>;
  approveSkill(dotId: string, name: string): Promise<SkillRecord | null>;
  rejectSkill(
    dotId: string,
    name: string,
    reason: string,
  ): Promise<SkillRecord | null>;
  deleteSkill(dotId: string, name: string): Promise<boolean>;
  /** Reflection passes used, for the hourly limit shown in the editor. */
  countPassesSince(dotId: string, since: Date): Promise<number>;
}

/**
 * Only Dot existence and the learning switch are needed; `WorkspaceStore`
 * satisfies both structurally.
 */
type DotLookup = Pick<WorkspaceStore, 'dot' | 'setLearningEnabled'>;

/** A skill name is passed to a model as a tool argument, so keep it narrow. */
const nameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** A skill is a prompt fragment, not a document. 32 KB is generous. */
const MAX_BODY_BYTES = 32 * 1024;

const bodySchema = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_BODY_BYTES, {
    message: 'A skill body must be at most 32 KB.',
  });

// `.strict()` everywhere: an unknown action or field is a 400, never a silent
// no-op that leaves the caller believing something happened.
const putSchema = z
  .object({ body: bodySchema, enabled: z.boolean().optional() })
  .strict();

const patchSchema = z
  .object({
    action: z.enum(['enable', 'disable', 'approve', 'reject']),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const learningToggleSchema = z.object({ enabled: z.boolean() }).strict();

/** A route failure with an HTTP status, distinct from an unexpected 500. */
class RouteError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}

/** The editor needs the derived description without re-implementing it. */
const view = (skill: SkillRecord) => ({
  ...skill,
  description: skillDescription(skill.body, skill.name),
});

/**
 * Per-Dot skill management behind the owner token. Every route takes the Dot
 * from the query string, so the store is always queried for exactly that Dot
 * and one Dot can never read or write another's skills.
 */
export function skillRoutes(workspace: DotLookup, learning: SkillCatalog) {
  const app = new Hono();

  const requireDot = (c: Context): string => {
    const dotId = c.req.query('dotId')?.trim();
    if (!dotId) throw new RouteError('Select a Dot.', 400);
    if (!workspace.dot(dotId)) throw new RouteError('Dot not found.', 404);
    return dotId;
  };

  const requireName = (c: Context): string => {
    const parsed = nameSchema.safeParse(c.req.param('name'));
    if (!parsed.success)
      throw new RouteError(
        'Skill names use lowercase letters, digits and dashes (max 64).',
        400,
      );
    return parsed.data;
  };

  /**
   * The automatic learning switch and its visible budget. Learning is off
   * unless enabled per Dot; the pass count makes the hourly limit concrete.
   */
  app.get('/learning', async (c) => {
    const dotId = requireDot(c);
    const used = await learning.countPassesSince(
      dotId,
      new Date(Date.now() - HOUR_MS),
    );
    return c.json({
      enabled: workspace.dot(dotId)?.learningEnabled === true,
      passesLastHour: used,
      passesPerHour: LEARNING_PASSES_PER_HOUR,
    });
  });

  // A narrow toggle for the Skills section, so it does not resubmit the whole
  // Dot form just to switch learning on.
  app.patch('/learning', async (c) => {
    const dotId = requireDot(c);
    const { enabled } = learningToggleSchema.parse(
      await c.req.json().catch(() => null),
    );
    const dot = workspace.setLearningEnabled(dotId, enabled);
    const used = await learning.countPassesSince(
      dotId,
      new Date(Date.now() - HOUR_MS),
    );
    return c.json({
      enabled: dot.learningEnabled === true,
      passesLastHour: used,
      passesPerHour: LEARNING_PASSES_PER_HOUR,
    });
  });

  // Approved skills first, proposals separated. Rejected rows are kept for the
  // reflection pass but are not shown in the editor.
  app.get('/skills', async (c) => {
    const dotId = requireDot(c);
    const skills = (await learning.listSkills(dotId)).filter(
      (skill) => skill.status === 'approved',
    );
    const proposals = await learning.listProposals(dotId);
    return c.json({ skills: skills.map(view), proposals: proposals.map(view) });
  });

  app.get('/skills/:name', async (c) => {
    const dotId = requireDot(c);
    const name = requireName(c);
    const skill = await learning.getSkill(dotId, name);
    return skill
      ? c.json(view(skill))
      : c.json({ error: 'Skill not found.' }, 404);
  });

  // Create or update: a human writing a skill is an approval, so this always
  // lands as `approved` and bumps the revision.
  app.put('/skills/:name', async (c) => {
    const dotId = requireDot(c);
    const name = requireName(c);
    const input = putSchema.parse(await c.req.json().catch(() => null));
    const saved = await learning.upsertSkill(dotId, { name, ...input });
    return c.json(view(saved), saved.revision === 1 ? 201 : 200);
  });

  app.patch('/skills/:name', async (c) => {
    const dotId = requireDot(c);
    const name = requireName(c);
    const { action, reason } = patchSchema.parse(
      await c.req.json().catch(() => null),
    );
    if (action === 'reject' && !reason)
      throw new RouteError('A rejection needs a reason.', 400);
    const updated =
      action === 'enable' || action === 'disable'
        ? await learning.setSkillEnabled(dotId, name, action === 'enable')
        : action === 'approve'
          ? await learning.approveSkill(dotId, name)
          : await learning.rejectSkill(dotId, name, reason!);
    return updated
      ? c.json(view(updated))
      : c.json({ error: 'Skill not found.' }, 404);
  });

  // Idempotent: deleting a skill that is already gone is not an error.
  app.delete('/skills/:name', async (c) => {
    const dotId = requireDot(c);
    const name = requireName(c);
    const deleted = await learning.deleteSkill(dotId, name);
    return c.json({ ok: true, deleted });
  });

  app.onError((error, c) => {
    if (error instanceof RouteError)
      return c.json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return c.json(
        { error: 'Check the skill name, body, action or learning switch.' },
        400,
      );
    console.error('Skill API failed:', error.name);
    return c.json(
      { error: 'The server could not complete this request.' },
      500,
    );
  });

  return app;
}
