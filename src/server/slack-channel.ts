import type { PlatformConfig } from './platform-config.js';

/**
 * Slack integration policy helpers.
 *
 * The managed channels service was removed; Slack is now a self-hosted
 * Events API webhook (see `slack-service.ts`). The failure sanitisation below
 * is retained verbatim because shutdown and startup error reporting imports it.
 * The allowlist/operation helpers encode the same decisions the old channel
 * handlers made, against raw Slack payloads.
 */

export type Report = (operation: string, errors: string[]) => void;

/** The Slack tenant/user allowlist, read from `SLACK_TEAM_ID`/`SLACK_USER_IDS`. */
export type SlackAllowlist = Pick<PlatformConfig, 'slackTeam' | 'slackUsers'>;

/** The subset of a Slack event object this policy reads. */
export interface SlackEvent {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
  edited?: unknown;
  event_ts?: string;
}

/** The Events API envelope, reduced to the fields this integration uses. */
export interface SlackEventEnvelope {
  type?: string;
  event_id?: string;
  team_id?: string;
  api_app_id?: string;
  challenge?: string;
  event?: SlackEvent;
}

// Never pass provider messages/stacks to logs or Slack: they can contain credentials.
export function safeFailure(error: unknown): string {
  const name =
    error instanceof Error &&
    ['Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(error.name)
      ? error.name
      : 'Error';
  const status =
    error !== null && typeof error === 'object' && 'status' in error
      ? error.status
      : undefined;
  return typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? `${name} (HTTP ${status})`
    : name;
}

export const reportChannelFailure: Report = (operation, errors) =>
  console.error(`${operation}: ${errors.join('; ')}`);

export type SlackOperation = 'created' | 'updated' | 'deleted';

/**
 * Map a Slack event onto the created/updated/deleted operation the old channel
 * handlers used. Only a genuinely new message counts as `created`; Slack sends
 * an edit as a `message_changed` subtype and a deletion as `message_deleted`.
 * An absent subtype defaults to `created`, matching the old absent-operation
 * default.
 */
export function slackOperation(event: SlackEvent): SlackOperation {
  if (event.subtype === 'message_deleted') return 'deleted';
  if (event.subtype === 'message_changed' || event.edited !== undefined)
    return 'updated';
  if (event.subtype === undefined || event.subtype === 'thread_broadcast')
    return 'created';
  return 'updated';
}

/**
 * The allowlisted acting Slack user id for this envelope, or `null` when the
 * event is not an allowlisted human message from the configured workspace.
 *
 * Never trust a Slack-supplied id: the team must match `SLACK_TEAM_ID`, the
 * acting user must be in `SLACK_USER_IDS`, bot/app actors are rejected, and
 * (when known) the app's own bot user is rejected.
 */
export function slackActorId(
  envelope: SlackEventEnvelope,
  config: SlackAllowlist,
  botUserId?: string,
): string | null {
  const event = envelope.event;
  if (!config.slackTeam || envelope.team_id !== config.slackTeam) return null;
  if (!event || typeof event.user !== 'string' || !event.user) return null;
  if (event.bot_id || (event.subtype ?? '').includes('bot')) return null;
  if (botUserId && event.user === botUserId) return null;
  if (!config.slackUsers.includes(event.user)) return null;
  return event.user;
}

/** The Slack conversation/thread a turn belongs to. */
export function slackConversation(event: SlackEvent): {
  channel: string;
  threadTs: string;
} | null {
  const channel = event.channel;
  const ts = event.thread_ts ?? event.ts;
  if (typeof channel !== 'string' || !channel || typeof ts !== 'string' || !ts)
    return null;
  return { channel, threadTs: ts };
}

/** Strip a leading Slack bot mention so the agent receives plain text. */
export function slackPrompt(event: SlackEvent): string {
  return (event.text ?? '').replace(/<@[^>]+>/g, ' ').trim();
}
