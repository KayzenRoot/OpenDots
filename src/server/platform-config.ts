import type { WebConfig } from './parallel.js';
import type { DotModelApi } from './model-api.js';
import type { SetupStatus } from '../shared/types.js';

export const DEFAULT_AGENT_RUN_TIMEOUT_MS = 90_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function agentRunTimeoutMsFromEnv(
  env: Record<string, string | undefined>,
): number {
  const raw = env.AGENT_RUN_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_AGENT_RUN_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS)
    throw new Error(
      `AGENT_RUN_TIMEOUT_MS must be an integer between 1 and ${MAX_TIMER_DELAY_MS}.`,
    );
  return value;
}

/**
 * Parse `OPENAI_EXTRA_HEADERS` (JSON object of string values). Header names are
 * restricted to the RFC 7230 token characters and values may not contain
 * newlines, so a value cannot smuggle a second header or request line.
 */
export function extraHeadersFromEnv(
  env: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const raw = env.OPENAI_EXTRA_HEADERS?.trim();
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('OPENAI_EXTRA_HEADERS must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(
      'OPENAI_EXTRA_HEADERS must be a JSON object of string values.',
    );
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!/^[A-Za-z0-9-]+$/.test(name))
      throw new Error(
        `OPENAI_EXTRA_HEADERS has an invalid header name: "${name}".`,
      );
    if (typeof value !== 'string')
      throw new Error(
        `OPENAI_EXTRA_HEADERS value for "${name}" must be a string.`,
      );
    if (/[\r\n]/.test(value))
      throw new Error(
        `OPENAI_EXTRA_HEADERS value for "${name}" must not contain newlines.`,
      );
    headers[name] = value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

export interface PlatformConfig extends WebConfig {
  databaseUrl?: string;
  model?: string;
  apiKey?: string;
  baseUrl: string;
  /** `DOT_MODEL_API`: Chat Completions, Responses, or `auto` by model name. */
  dotModelApi?: DotModelApi;
  agentRunTimeoutMs?: number;
  computerSupervisorUrl?: string;
  computerSupervisorToken?: string;
  computerToken?: string;
  computerNamespace?: string;
  browserUrl?: string;
  browserSecret?: string;
  composioApiKey?: string;
  /** `VOICE_BASE_URL`: realtime endpoint root, for non-OpenAI gateways. */
  voiceBaseUrl?: string;
  voiceKey?: string;
  voiceModel?: string;
  voiceName: string;
  slackChannel?: string;
  slackTeam?: string;
  slackUsers: string[];
  slackDotId?: string;
  /** `SLACK_BOT_TOKEN`: outbound Web API calls. */
  slackBotToken?: string;
  /** `SLACK_SIGNING_SECRET`: inbound Events API request verification. */
  slackSigningSecret?: string;
  /** `TELEGRAM_BOT_TOKEN`: outbound Bot API calls. */
  telegramBotToken?: string;
  /** `TELEGRAM_WEBHOOK_SECRET`: inbound webhook shared secret (setWebhook). */
  telegramWebhookSecret?: string;
  /** `TELEGRAM_OWNER_ID`: the single allowlisted Telegram user. */
  telegramOwnerId?: string;
  /** `TELEGRAM_DOT_ID`: Dot answering new Telegram chats; defaults to the first. */
  telegramDotId?: string;
  runtimeUrl: string;
  ownerToken?: string;
  /**
   * Extra headers sent to the model endpoint (`OPENAI_EXTRA_HEADERS`, JSON).
   * Some OpenAI-compatible gateways require routing headers, e.g. OpenCode Go
   * requires `x-opencode-session` on /chat/completions.
   */
  extraHeaders?: Record<string, string>;
}
export function setupStatus(
  config: PlatformConfig,
  slack = 'not_configured',
  activationFailed = false,
  conversationsConfigured = !!config.databaseUrl,
): SetupStatus {
  const missing = [
    !config.apiKey && 'OPENAI_API_KEY',
    !config.model && 'OPENAI_MODEL',
  ].filter((item): item is string => !!item);
  const declaredSlack = !!(
    config.slackChannel &&
    config.slackTeam &&
    config.slackUsers.length
  );
  slack = declaredSlack
    ? activationFailed && slack !== 'online'
      ? 'activation_failed'
      : slack
    : config.slackChannel || config.slackTeam || config.slackUsers.length
      ? 'setup_required'
      : 'not_configured';
  return {
    // Conversation storage is the successor to the hosted Intelligence service.
    intelligence: conversationsConfigured,
    model: !!(config.apiKey && config.model),
    browser: !!(config.browserUrl && config.browserSecret),
    voice: !!(config.voiceKey && config.voiceModel && !missing.length),
    composio: !!config.composioApiKey,
    slack,
    missing,
  };
}
