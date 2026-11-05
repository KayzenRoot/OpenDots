import { z } from 'zod';

/**
 * Reinterpreted for local delivery: this is no longer a hosted Intelligence
 * container id but a legacy, display-only label for a Dot's skill set. Skills
 * themselves live in the local Postgres `skills` table, keyed by Dot id.
 */
export const learningContainerIdSchema = z
  .string()
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use 1–64 lowercase letters, numbers, and single hyphens.',
  )
  .nullable();

export function validateLearningSettings(
  containerId: string | null,
  delivery: boolean,
) {
  if (!learningContainerIdSchema.safeParse(containerId).success)
    throw new Error(
      'Skill set ID must use 1–64 lowercase letters, numbers, and single hyphens.',
    );
  if (delivery && !containerId)
    throw new Error('Dot skill delivery requires a local skill set ID.');
}
