export type DotModelApi = 'auto' | 'chat-completions' | 'responses';

/**
 * `DOT_MODEL_API`. `auto` routes model families whose names identify a
 * reasoning model to the Responses API; every other model keeps Chat
 * Completions, which is the behaviour the app had before this setting existed.
 * The override exists because a name is not proof of provider capabilities.
 */
export function dotModelApiFromEnv(
  env: Record<string, string | undefined>,
): DotModelApi {
  const value = env.DOT_MODEL_API?.trim() || 'auto';
  if (value === 'auto' || value === 'chat-completions' || value === 'responses')
    return value;
  throw new Error('DOT_MODEL_API must be auto, chat-completions or responses.');
}

/**
 * Reasoning models reject Chat Completions requests that combine function
 * tools with reasoning, while the Responses API accepts both. Only model names
 * that identify the family are listed: a false positive would move a working
 * model to another API, so unmatched names stay on Chat Completions unless the
 * operator selects Responses explicitly.
 */
export function isReasoningModel(model: string): boolean {
  return (
    /^o[1-9]\d*(-|$)/i.test(model) ||
    /^gpt-6([.-]|$)/i.test(model) ||
    /^deepseek-(v4|r1|reasoner)/i.test(model)
  );
}

export type ResolvedModelApi = 'chat-completions' | 'responses';

export function resolveModelApi(
  model: string,
  configured: DotModelApi = 'auto',
): ResolvedModelApi {
  if (configured !== 'auto') return configured;
  return isReasoningModel(model) ? 'responses' : 'chat-completions';
}

/**
 * Provider parameters for one Dot turn. Chat Completions keeps the existing
 * `max_completion_tokens` budget exactly. Responses counts reasoning and
 * visible output against `max_output_tokens`, is stateless (`store: false`),
 * and asks for encrypted reasoning so a later turn can replay it.
 */
export function modelOptionsFor(
  api: ResolvedModelApi,
): Record<string, unknown> {
  return api === 'responses'
    ? {
        max_output_tokens: 2200,
        store: false,
        include: ['reasoning.encrypted_content'],
      }
    : { max_completion_tokens: 2200 };
}
