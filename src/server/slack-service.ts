import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { PlatformConfig } from './platform-config.js';
import { DEFAULT_AGENT_RUN_TIMEOUT_MS } from './platform-config.js';
import type { WorkspaceStore } from './workspace.js';
import { SlackClient } from './slack-client.js';
import { SlackStore } from './slack-store.js';
import { verifySlackSignature } from './slack-signature.js';
import {
  reportChannelFailure,
  safeFailure,
  slackActorId,
  slackConversation,
  slackOperation,
  slackPrompt,
  type Report,
  type SlackEvent,
  type SlackEventEnvelope,
} from './slack-channel.js';

export type SlackStatus =
  'not_configured' | 'setup_required' | 'online' | 'activation_failed';

export interface SlackServiceDeps {
  config: Pick<
    PlatformConfig,
    | 'slackChannel'
    | 'slackTeam'
    | 'slackUsers'
    | 'slackDotId'
    | 'slackBotToken'
    | 'slackSigningSecret'
  >;
  workspace: Pick<WorkspaceStore, 'dots' | 'dot' | 'bindThread'>;
  events: Pick<SlackStore, 'claim' | 'threadFor' | 'bindThread'>;
  /** Mirrors the workspace paused setting; a paused run posts a notice instead. */
  paused: () => boolean;
  /** Runs the same server-side turn path the app uses for scheduled/voice turns. */
  turn: (
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ) => Promise<string>;
  transport?: typeof fetch;
  report?: Report;
  now?: () => number;
  turnTimeoutMs?: number;
}

const PAUSED_MESSAGE =
  'NexBot is paused. Resume it in the app before asking me to continue.';
const RUN_FAILED_MESSAGE =
  'I couldn’t complete that request. Please check NexBot and send a new message when you’re ready to try again.';
/** Slack conversation IDs look like C0123ABCD (public), G… (group) or D… (DM). */
const SLACK_CONVERSATION_ID = /^[CGD][A-Z0-9]{6,}$/;

function conversationTitle(text: string): string {
  return text.slice(0, 60) || 'Slack conversation';
}

/**
 * Self-hosted Slack integration replacing the removed managed channels
 * service. Inbound Events API requests are verified by
 * {@link SlackService.verify} and dispatched here; outbound replies go through
 * the Slack Web API. Construction performs no I/O; activation happens in
 * {@link SlackService.start} and is entirely optional.
 */
export class SlackService {
  private readonly client: SlackClient;
  private readonly report: Report;
  private readonly now: () => number;
  private readonly turnTimeoutMs: number;
  private activated = false;
  private failed = false;
  private channelId?: string;
  private botUserId?: string;
  constructor(private readonly deps: SlackServiceDeps) {
    this.report = deps.report ?? reportChannelFailure;
    this.now = deps.now ?? Date.now;
    this.turnTimeoutMs = deps.turnTimeoutMs ?? DEFAULT_AGENT_RUN_TIMEOUT_MS;
    this.client = new SlackClient(deps.config.slackBotToken, deps.transport);
  }
  private anyDeclared(): boolean {
    const { slackChannel, slackTeam, slackUsers } = this.deps.config;
    return !!(slackChannel || slackTeam || slackUsers.length);
  }
  private declared(): boolean {
    const { slackChannel, slackTeam, slackUsers } = this.deps.config;
    return !!(slackChannel && slackTeam && slackUsers.length);
  }
  private configured(): boolean {
    return !!(
      this.deps.config.slackBotToken && this.deps.config.slackSigningSecret
    );
  }
  activationFailed(): boolean {
    return this.failed;
  }
  status(): SlackStatus {
    if (!this.anyDeclared()) return 'not_configured';
    if (!this.declared() || !this.configured()) return 'setup_required';
    if (this.failed) return 'activation_failed';
    return this.activated ? 'online' : 'setup_required';
  }
  /**
   * Confirm the bot token and resolve `SLACK_CHANNEL_NAME` to a conversation.
   * A no-op when Slack is not fully declared, so an unconfigured deployment
   * stays inert. Failure is recorded for {@link SlackService.status} and
   * rethrown so startup can log it.
   */
  async start(): Promise<void> {
    if (!this.declared() || !this.configured()) return;
    try {
      const { userId } = await this.client.authTest();
      this.botUserId = userId;
      const channelId = await this.resolveChannelId();
      if (!channelId)
        throw new Error('The configured Slack channel could not be resolved.');
      this.channelId = channelId;
      this.activated = true;
      this.failed = false;
    } catch (error) {
      this.activated = false;
      this.failed = true;
      throw error;
    }
  }
  /**
   * There is no persistent Slack connection to close: the webhook is stateless
   * and outbound calls are per-message. This only drops the activation flag.
   */
  stop(): void {
    this.activated = false;
  }
  private async resolveChannelId(): Promise<string | undefined> {
    const value = this.deps.config.slackChannel?.trim();
    if (!value) return undefined;
    // `SLACK_CHANNEL_NAME` is documented upstream as a channel name, not an id.
    // A conversation id is accepted directly; a name is matched through
    // `conversations.list` (see slack-client.ts). If a name cannot be found the
    // activation fails rather than guessing.
    if (SLACK_CONVERSATION_ID.test(value)) return value;
    const wanted = value.replace(/^#/, '');
    const channels = await this.client.listChannels();
    return channels.find((channel) => channel.name === wanted)?.id;
  }
  /** Constant-time Events API signature check; `raw` must be unparsed. */
  verify(
    raw: string,
    timestamp: string | undefined,
    signature: string | undefined,
  ): boolean {
    return verifySlackSignature({
      signingSecret: this.deps.config.slackSigningSecret,
      timestamp,
      signature,
      body: raw,
      now: this.now(),
    });
  }
  reportFailure(operation: string, error: unknown): void {
    this.report(operation, [safeFailure(error)]);
  }
  /**
   * Process one already-verified envelope. Returns once the turn has been
   * dispatched; the HTTP route acks Slack first and calls this out of band.
   */
  async handleEvent(envelope: SlackEventEnvelope): Promise<void> {
    if (envelope.type !== 'event_callback') return;
    if (!this.configured()) return;
    const event = envelope.event;
    if (!event) return;
    if (event.type !== 'app_mention' && event.type !== 'message') return;
    // Edited and deleted deliveries are not new requests.
    if (slackOperation(event) !== 'created') return;
    // Never trust Slack-supplied ids: team + explicit user allowlist.
    if (!slackActorId(envelope, this.deps.config, this.botUserId)) return;
    const target = slackConversation(event);
    if (!target) return;
    // Scope to the configured conversation. Without a resolved channel there is
    // no safe place to reply, so nothing runs.
    if (!this.channelId || target.channel !== this.channelId) return;
    // Idempotency per Slack event id: a retry must not run the agent twice.
    const eventId = envelope.event_id ?? `${target.channel}:${target.threadTs}`;
    if (!this.deps.events.claim(eventId, this.now())) return;
    const mention = event.type === 'app_mention';
    let threadId: string | undefined;
    if (mention) {
      try {
        threadId = this.ensureThread(target, slackPrompt(event));
      } catch (error) {
        this.report('Slack thread subscription failed; answering mention', [
          safeFailure(error),
        ]);
        return;
      }
    } else {
      threadId = this.subscribedThread(target);
    }
    if (!threadId) return;
    await this.run(threadId, event, target);
  }
  /** Existing mapping for a Slack thread, or `undefined` when not subscribed. */
  private subscribedThread(target: {
    channel: string;
    threadTs: string;
  }): string | undefined {
    try {
      return this.deps.events.threadFor(target.channel, target.threadTs);
    } catch (error) {
      const safe = safeFailure(error);
      this.report('Slack subscription lookup failed', [safe]);
      throw new Error(`Slack subscription lookup failed: ${safe}`, {
        // eslint-disable-next-line preserve-caught-error -- Raw provider causes can expose credentials through logging.
        cause: safe,
      });
    }
  }
  /**
   * The NexBot conversation for a Slack thread, created and bound on first
   * mention. A failure to persist the mapping is reported but still answered:
   * the conversation exists, only follow-up continuity is lost.
   */
  private ensureThread(
    target: { channel: string; threadTs: string },
    text: string,
  ): string {
    const existing = this.deps.events.threadFor(
      target.channel,
      target.threadTs,
    );
    if (existing) return existing;
    const dotId =
      this.deps.config.slackDotId ?? this.deps.workspace.dots()[0]?.id;
    if (!dotId || !this.deps.workspace.dot(dotId))
      throw new Error('SLACK_DOT_ID does not identify an existing Dot.');
    const threadId = randomUUID();
    this.deps.workspace.bindThread(threadId, dotId, conversationTitle(text));
    try {
      this.deps.events.bindThread(
        target.channel,
        target.threadTs,
        threadId,
        this.now(),
      );
    } catch (error) {
      this.report('Slack thread subscription failed', [safeFailure(error)]);
    }
    return threadId;
  }
  private async run(
    threadId: string,
    event: SlackEvent,
    target: { channel: string; threadTs: string },
  ): Promise<void> {
    if (this.deps.paused()) {
      await this.notice(target, PAUSED_MESSAGE);
      return;
    }
    let reply: string;
    try {
      reply = await this.deps.turn(
        threadId,
        slackPrompt(event),
        AbortSignal.timeout(this.turnTimeoutMs),
        {
          nexbotSource: 'slack_mention',
          slackChannel: target.channel,
          slackThreadTs: target.threadTs,
        },
      );
    } catch (error) {
      const runError = safeFailure(error);
      try {
        await this.post(target, RUN_FAILED_MESSAGE);
      } catch (postError) {
        const replyError = safeFailure(postError);
        this.report('Slack agent run and error reply failed', [
          runError,
          replyError,
        ]);
        throw new AggregateError(
          [
            new Error(`Agent run: ${runError}`),
            new Error(`Error reply: ${replyError}`),
          ],
          'Slack agent run and error reply failed',
          // eslint-disable-next-line preserve-caught-error -- Retain only the safe cause; the provider may log thrown errors.
          { cause: safeFailure(postError) },
        );
      }
      this.report('Slack agent run failed; error reply posted', [runError]);
      return;
    }
    await this.post(target, reply);
  }
  private async post(
    target: { channel: string; threadTs: string },
    text: string,
  ): Promise<void> {
    try {
      await this.client.postMessage({
        channel: target.channel,
        text,
        threadTs: target.threadTs,
      });
    } catch (error) {
      const safe = safeFailure(error);
      this.report('Slack reply failed', [safe]);
      throw new Error(`Slack reply failed: ${safe}`, {
        // eslint-disable-next-line preserve-caught-error -- Raw provider causes can expose credentials through logging.
        cause: safe,
      });
    }
  }
  private async notice(
    target: { channel: string; threadTs: string },
    text: string,
  ): Promise<void> {
    try {
      await this.client.postMessage({
        channel: target.channel,
        text,
        threadTs: target.threadTs,
      });
    } catch (error) {
      const safe = safeFailure(error);
      this.report('Slack notice failed', [safe]);
      throw new Error(`Slack notice failed: ${safe}`, {
        // eslint-disable-next-line preserve-caught-error -- Raw provider causes can expose credentials through logging.
        cause: safe,
      });
    }
  }
}

/**
 * `POST /api/slack/events`. Registered before the app's origin/owner middleware
 * because Slack cannot present an owner token: authentication here is the Slack
 * signing secret over the raw body. Nothing downstream trusts a Slack id
 * without the `SLACK_TEAM_ID` / `SLACK_USER_IDS` allowlist.
 */
export function slackRoutes(service: SlackService) {
  const app = new Hono();
  app.post('/events', async (c) => {
    // Verify the exact bytes before parsing them.
    const raw = await c.req.text();
    if (
      !service.verify(
        raw,
        c.req.header('x-slack-request-timestamp'),
        c.req.header('x-slack-signature'),
      )
    )
      return c.json({ error: 'Unauthorized.' }, 401);
    let envelope: SlackEventEnvelope | null = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object')
        envelope = parsed as SlackEventEnvelope;
    } catch {
      envelope = null;
    }
    if (!envelope) return c.json({ error: 'Invalid request.' }, 400);
    if (
      envelope.type === 'url_verification' &&
      typeof envelope.challenge === 'string'
    )
      return c.json({ challenge: envelope.challenge });
    // Slack retries a delivery it could not ack within three seconds. Acknowledge
    // immediately and run the agent out of band.
    void service
      .handleEvent(envelope)
      .catch((error) =>
        service.reportFailure('Slack event processing failed', error),
      );
    return c.json({ ok: true });
  });
  return app;
}
