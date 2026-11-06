import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { PlatformConfig } from './platform-config.js';
import { DEFAULT_AGENT_RUN_TIMEOUT_MS } from './platform-config.js';
import type { WorkspaceStore } from './workspace.js';
import { TelegramClient, chunkTelegramText } from './telegram-client.js';
import { TelegramStore } from './telegram-store.js';
import { verifyTelegramSecretToken } from './telegram-signature.js';
import {
  parseTelegramCommand,
  reportChannelFailure,
  safeFailure,
  telegramActor,
  telegramConversation,
  telegramPrompt,
  type Report,
  type TelegramUpdate,
} from './telegram-channel.js';

export type TelegramStatus =
  'not_configured' | 'setup_required' | 'online' | 'activation_failed';

export interface TelegramServiceDeps {
  config: Pick<
    PlatformConfig,
    | 'telegramBotToken'
    | 'telegramWebhookSecret'
    | 'telegramOwnerId'
    | 'telegramDotId'
  >;
  workspace: Pick<WorkspaceStore, 'dots' | 'dot' | 'bindThread'>;
  updates: Pick<TelegramStore, 'claim' | 'chatFor' | 'bindChat'>;
  /** Mirrors the workspace paused setting; a paused run posts a notice instead. */
  paused: () => boolean;
  /** `/pausar` and `/retomar` are the operator's channel-side kill switch. */
  setPaused: (paused: boolean) => void;
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

// Telegram replies are server-side strings for the single allowlisted operator,
// so they live here rather than in the client i18n dictionaries. The command
// surface (/pausar, /retomar, /setor) is Brazilian Portuguese by contract, so
// the replies are too; NexBot and Dot stay untranslated.
const START_MESSAGE =
  'Olá! Eu sou o NexBot. Envie uma mensagem para conversar com o seu Dot. Comandos: /status, /pausar, /retomar, /setor <dot>.';
const PAUSED_MESSAGE =
  'O NexBot está pausado. Retome-o no app antes de pedir que eu continue.';
const RUN_FAILED_MESSAGE =
  'Não consegui concluir esse pedido. Verifique o NexBot e envie uma nova mensagem quando quiser tentar de novo.';
const MEDIA_UNSUPPORTED_MESSAGE =
  'Ainda não consigo ler fotos, áudios ou outros anexos por aqui. Envie o conteúdo como texto.';
const PAUSED_ACK_MESSAGE = 'NexBot pausado. Use /retomar para voltar.';
const RESUMED_ACK_MESSAGE = 'NexBot retomado.';
const DEFAULT_CONVERSATION_TITLE = 'Telegram conversation';

function conversationTitle(text: string): string {
  return text.slice(0, 60) || DEFAULT_CONVERSATION_TITLE;
}

/**
 * Self-hosted Telegram channel alongside the Slack integration. Inbound
 * webhook updates are verified by {@link TelegramService.verify} and
 * dispatched here; outbound replies go through the Bot API. Construction
 * performs no I/O; activation happens in {@link TelegramService.start} and is
 * entirely optional.
 */
export class TelegramService {
  private readonly client: TelegramClient;
  private readonly report: Report;
  private readonly now: () => number;
  private readonly turnTimeoutMs: number;
  private activated = false;
  private failed = false;
  private botUsername?: string;
  constructor(private readonly deps: TelegramServiceDeps) {
    this.report = deps.report ?? reportChannelFailure;
    this.now = deps.now ?? Date.now;
    this.turnTimeoutMs = deps.turnTimeoutMs ?? DEFAULT_AGENT_RUN_TIMEOUT_MS;
    this.client = new TelegramClient(
      deps.config.telegramBotToken,
      deps.transport,
    );
  }
  private declared(): boolean {
    const { telegramBotToken, telegramWebhookSecret, telegramOwnerId } =
      this.deps.config;
    return !!(telegramBotToken && telegramWebhookSecret && telegramOwnerId);
  }
  activationFailed(): boolean {
    return this.failed;
  }
  status(): TelegramStatus {
    const { telegramBotToken, telegramWebhookSecret, telegramOwnerId } =
      this.deps.config;
    if (!(telegramBotToken || telegramWebhookSecret || telegramOwnerId))
      return 'not_configured';
    if (!this.declared()) return 'setup_required';
    if (this.failed) return 'activation_failed';
    return this.activated ? 'online' : 'setup_required';
  }
  /**
   * Confirm the bot token and fail fast on a `TELEGRAM_DOT_ID` that names no
   * existing Dot. A no-op when Telegram is not fully declared, so an
   * unconfigured deployment stays inert. Failure is recorded for
   * {@link TelegramService.status} and rethrown so startup can log it.
   */
  async start(): Promise<void> {
    if (!this.declared()) return;
    try {
      const me = await this.client.getMe();
      this.botUsername = me.username;
      const dotId = this.deps.config.telegramDotId;
      if (dotId && !this.deps.workspace.dot(dotId))
        throw new Error('TELEGRAM_DOT_ID does not identify an existing Dot.');
      this.activated = true;
      this.failed = false;
    } catch (error) {
      this.activated = false;
      this.failed = true;
      throw error;
    }
  }
  /**
   * There is no persistent Telegram connection to close: the webhook is
   * stateless and outbound calls are per-message. This only drops the
   * activation flag.
   */
  stop(): void {
    this.activated = false;
  }
  /**
   * Compare the `X-Telegram-Bot-Api-Secret-Token` header in constant time.
   * Without a configured secret every request fails, so an unconfigured
   * deployment answers 401 on everything.
   */
  verify(supplied: string | undefined): boolean {
    return verifyTelegramSecretToken({
      expected: this.deps.config.telegramWebhookSecret,
      supplied,
    });
  }
  /**
   * Record an update id before its turn is dispatched. Telegram retries a
   * delivery it could not ack in time, so the id must be on disk before the
   * agent runs; a repeat is acknowledged and dropped by the caller.
   */
  claimUpdate(updateId: number): boolean {
    return this.deps.updates.claim(updateId, this.now());
  }
  reportFailure(operation: string, error: unknown): void {
    this.report(operation, [safeFailure(error)]);
  }
  /**
   * Process one already-verified and already-claimed update. Returns once the
   * turn has been dispatched; the HTTP route acks Telegram first and calls
   * this out of band. Every rejection is safe to surface: raw Telegram or
   * provider text is sanitised before any log or reply.
   */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.declared()) return;
    // Never trust a Telegram-supplied id: only the allowlisted owner acts.
    if (!telegramActor(update, this.deps.config)) return;
    const message = update.message;
    // Edits, channel posts and callback queries are not new requests.
    if (!message) return;
    const target = telegramConversation(message);
    if (!target) return;
    const text = typeof message.text === 'string' ? message.text : '';
    if (!text.trim()) {
      // Media (photos, documents, voice) is not downloaded until a later work
      // order; answer clearly instead of staying silent.
      await this.post(target, MEDIA_UNSUPPORTED_MESSAGE);
      return;
    }
    const command = parseTelegramCommand(text);
    if (command) {
      await this.command(command, target);
      return;
    }
    let conversationId: string;
    try {
      conversationId = this.conversationFor(target, text);
    } catch (error) {
      this.report('Telegram conversation mapping failed', [safeFailure(error)]);
      return;
    }
    await this.run(conversationId, target, text, update.update_id ?? 0);
  }
  /**
   * The NexBot conversation for a Telegram chat, created and bound on first
   * message: one conversation and one Dot per chat. A failure to persist the
   * mapping is reported by the caller; the Dot itself is validated here so a
   * misconfigured `TELEGRAM_DOT_ID` cannot silently misroute turns.
   */
  private conversationFor(
    target: { chatId: string; messageThreadId?: string },
    text: string,
  ): string {
    const existing = this.deps.updates.chatFor(target.chatId);
    if (existing) return existing.nexbotThreadId;
    const dotId =
      this.deps.config.telegramDotId ?? this.deps.workspace.dots()[0]?.id;
    if (!dotId || !this.deps.workspace.dot(dotId))
      throw new Error('TELEGRAM_DOT_ID does not identify an existing Dot.');
    const conversationId = randomUUID();
    this.deps.workspace.bindThread(
      conversationId,
      dotId,
      conversationTitle(text),
    );
    this.deps.updates.bindChat(
      target.chatId,
      target.messageThreadId ?? '',
      dotId,
      conversationId,
      this.now(),
    );
    return conversationId;
  }
  private async command(
    command: { name: string; argument: string },
    target: { chatId: string; messageThreadId?: string },
  ): Promise<void> {
    switch (command.name) {
      case 'start':
        await this.post(target, START_MESSAGE);
        return;
      case 'status':
        await this.post(target, this.statusText(target));
        return;
      case 'pausar':
        this.deps.setPaused(true);
        await this.post(target, PAUSED_ACK_MESSAGE);
        return;
      case 'retomar':
        this.deps.setPaused(false);
        await this.post(target, RESUMED_ACK_MESSAGE);
        return;
      case 'setor':
        await this.setSector(command.argument, target);
        return;
      // An unknown command gets the same help as /start rather than running.
      default:
        await this.post(target, START_MESSAGE);
    }
  }
  private statusText(target: { chatId: string }): string {
    const state = this.deps.paused() ? 'pausado' : 'ativo';
    const mapping = this.deps.updates.chatFor(target.chatId);
    const dot = mapping ? this.deps.workspace.dot(mapping.dotId) : undefined;
    return dot
      ? `NexBot está ${state}. Este chat conversa com o Dot "${dot.name}".`
      : `NexBot está ${state}. Nenhum Dot vinculado a este chat ainda; envie uma mensagem para começar.`;
  }
  /** `/setor <dot>`: rebind this chat to another Dot, in a fresh conversation. */
  private async setSector(
    argument: string,
    target: { chatId: string; messageThreadId?: string },
  ): Promise<void> {
    const wanted = argument.trim();
    const dots = this.deps.workspace.dots();
    const names = dots.map((dot) => dot.name).join(', ') || 'nenhum';
    if (!wanted) {
      await this.post(target, `Use /setor <dot>. Dots disponíveis: ${names}.`);
      return;
    }
    const dot =
      dots.find((candidate) => candidate.id === wanted) ??
      dots.find(
        (candidate) => candidate.name.toLowerCase() === wanted.toLowerCase(),
      );
    if (!dot) {
      await this.post(
        target,
        `Não encontrei o Dot "${wanted.slice(0, 60)}". Dots disponíveis: ${names}.`,
      );
      return;
    }
    const conversationId = randomUUID();
    this.deps.workspace.bindThread(
      conversationId,
      dot.id,
      DEFAULT_CONVERSATION_TITLE,
    );
    this.deps.updates.bindChat(
      target.chatId,
      target.messageThreadId ?? '',
      dot.id,
      conversationId,
      this.now(),
    );
    await this.post(
      target,
      `Agora este chat conversa com o Dot "${dot.name}".`,
    );
  }
  private async run(
    conversationId: string,
    target: { chatId: string; messageThreadId?: string },
    text: string,
    updateId: number,
  ): Promise<void> {
    if (this.deps.paused()) {
      await this.post(target, PAUSED_MESSAGE);
      return;
    }
    let reply: string;
    try {
      reply = await this.deps.turn(
        conversationId,
        // The message text is untrusted data, framed as such; it never becomes
        // a system instruction.
        telegramPrompt(text),
        AbortSignal.timeout(this.turnTimeoutMs),
        {
          nexbotSource: 'telegram_message',
          telegramChat: target.chatId,
          telegramUpdateId: updateId,
        },
      );
    } catch (error) {
      const runError = safeFailure(error);
      try {
        await this.post(target, RUN_FAILED_MESSAGE);
      } catch (postError) {
        const replyError = safeFailure(postError);
        this.report('Telegram agent run and error reply failed', [
          runError,
          replyError,
        ]);
        throw new AggregateError(
          [
            new Error(`Agent run: ${runError}`),
            new Error(`Error reply: ${replyError}`),
          ],
          'Telegram agent run and error reply failed',
          // eslint-disable-next-line preserve-caught-error -- Retain only the safe cause; the provider may log thrown errors.
          { cause: safeFailure(postError) },
        );
      }
      this.report('Telegram agent run failed; error reply posted', [runError]);
      return;
    }
    await this.post(target, reply);
  }
  /**
   * Send a reply, chunked under the Bot API's 4096-character limit. A failure
   * is reported with a safe cause and rethrown; the route's out-of-band catch
   * keeps the process alive.
   */
  private async post(
    target: { chatId: string; messageThreadId?: string },
    text: string,
  ): Promise<void> {
    try {
      for (const part of chunkTelegramText(text))
        await this.client.sendMessage({
          chatId: target.chatId,
          text: part,
          threadId: target.messageThreadId,
        });
    } catch (error) {
      const safe = safeFailure(error);
      this.report('Telegram reply failed', [safe]);
      throw new Error(`Telegram reply failed: ${safe}`, {
        // eslint-disable-next-line preserve-caught-error -- Raw provider causes can expose credentials through logging.
        cause: safe,
      });
    }
  }
}

/**
 * `POST /api/telegram/webhook`. Registered before the app's origin/owner
 * middleware because Telegram cannot present an owner token: authentication
 * here is the shared secret token Telegram echoes in
 * `X-Telegram-Bot-Api-Secret-Token`. Nothing downstream trusts a Telegram id
 * before the `TELEGRAM_OWNER_ID` allowlist, and the update id is recorded
 * before the turn is dispatched so a timeout retry cannot run the agent twice.
 */
export function telegramRoutes(service: TelegramService) {
  const app = new Hono();
  app.post('/webhook', async (c) => {
    // Verify the shared secret before parsing anything.
    if (!service.verify(c.req.header('x-telegram-bot-api-secret-token')))
      return c.json({ error: 'Unauthorized.' }, 401);
    let update: TelegramUpdate | null = null;
    try {
      const parsed: unknown = JSON.parse(await c.req.text());
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as { update_id?: unknown }).update_id === 'number' &&
        Number.isSafeInteger((parsed as { update_id: number }).update_id)
      )
        update = parsed as TelegramUpdate;
    } catch {
      update = null;
    }
    const updateId = update?.update_id;
    if (
      !update ||
      typeof updateId !== 'number' ||
      !Number.isSafeInteger(updateId)
    )
      return c.json({ error: 'Invalid request.' }, 400);
    // Record the id synchronously, before the ack and before processing: a
    // Telegram timeout retry then lands on an already-claimed id and is
    // dropped instead of running the agent twice.
    if (!service.claimUpdate(updateId)) return c.json({ ok: true });
    // Acknowledge immediately and run the agent out of band; a failure here is
    // reported and must never crash the process.
    void service
      .handleUpdate(update)
      .catch((error) =>
        service.reportFailure('Telegram update processing failed', error),
      );
    return c.json({ ok: true });
  });
  return app;
}
