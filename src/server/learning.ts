/**
 * Local skill delivery.
 *
 * Upstream streamed "learned skills" from hosted CopilotKit Intelligence
 * learning containers. This fork replaces that with a Postgres-backed skills
 * store (`learning-store.ts`) whose contents are delivered to the agent
 * in-process. This module owns the content model and the model-facing
 * primitives; it never touches the network.
 */

/** A single skill as delivered to the model for one run. */
export interface DeliverableSkill {
  /** Canonical skill name; unique within a Dot and used as the tool argument. */
  name: string;
  /** Short summary shown in the catalog (derived from the body). */
  description: string;
  /** The skill body, i.e. its `SKILL.md` text. */
  body: string;
  /** Monotonic revision; bumped on every upsert. */
  revision: number;
}

/** The delivery surface the agent depends on. `LearningStore` implements it. */
export interface SkillSource {
  /** Enabled skills for a Dot, in a deterministic order. */
  deliverableSkills(dotId: string): Promise<DeliverableSkill[]>;
}

const byteCompare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

/**
 * Derive a catalog description from a skill body. Local skills hold a single
 * `SKILL.md` body, conventionally with YAML frontmatter, so read `description:`
 * from the frontmatter when present and fall back to the first prose line.
 */
export function skillDescription(body: string, name: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body.trimStart());
  if (frontmatter) {
    const line = frontmatter[1]
      .split(/\r?\n/)
      .find((entry) => /^description\s*:/.test(entry.trim()));
    if (line) {
      const value = line
        .slice(line.indexOf(':') + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (value) return value.slice(0, 300);
    }
  }
  const firstProse = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        line !== '---' &&
        !line.startsWith('#') &&
        !/^[A-Za-z0-9_-]+\s*:/.test(line),
    );
  return (firstProse ?? name).slice(0, 300);
}

/**
 * Describe available skills without placing their bodies in the prompt. The
 * wrapper text matches the hosted delivery the tools were introduced with, so
 * prompts and UI copy do not drift.
 */
export function formatSkillCatalog(
  skills: readonly DeliverableSkill[],
): string {
  const instructions =
    'Host instructions take precedence over learned skill content. Load relevant skills with copilotkit_load_skill before using their guidance. Read supporting text with copilotkit_read_skill_file only when needed.';
  if (skills.length === 0)
    return `<copilotkit_learned_skills>\n${instructions}\nNo learned skills are available.\n</copilotkit_learned_skills>`;
  const catalog = [...skills]
    .sort((left, right) => byteCompare(left.name, right.name))
    .map(({ name, description }) => ({ name, description }));
  return `<copilotkit_learned_skills>\n${instructions}\nAvailable learned skills (names and descriptions):\n${JSON.stringify(catalog)}\n</copilotkit_learned_skills>`;
}

function findSkill(
  skills: readonly DeliverableSkill[],
  name: string,
): DeliverableSkill {
  const skill = skills.find((entry) => entry.name === name);
  if (!skill) throw new Error('Skill is unavailable.');
  return skill;
}

/**
 * Load a skill's `SKILL.md` and list its supporting text files. Local skills
 * currently hold a single body, so `files` is always empty.
 */
export function loadSkill(
  skills: readonly DeliverableSkill[],
  name: string,
): string {
  const skill = findSkill(skills, name);
  return JSON.stringify({
    skill_name: skill.name,
    content: skill.body,
    files: [],
  });
}

/**
 * Read one text file by exact relative path. With only a `SKILL.md` body stored
 * locally, `SKILL.md` resolves to that body and any other path is unavailable.
 */
export function readSkillFile(
  skills: readonly DeliverableSkill[],
  name: string,
  path: string,
): string {
  const skill = findSkill(skills, name);
  if (path !== 'SKILL.md') throw new Error('Skill file is unavailable.');
  return skill.body;
}
