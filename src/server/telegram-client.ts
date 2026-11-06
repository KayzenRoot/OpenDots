/**
 * A Telegram Bot API failure carrying only a safe description, never the
 * token. The token travels in the URL path (the Bot API's own design), so
 * error messages are built by hand and never include the request URL.
 */
export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const API_BASE = 'https://api.telegram.org/bot';

/** The Bot API rejects a `sendMessage` text longer than this. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Split a reply into Bot-API-sized messages. A newline just inside the limit
 * is preferred so paragraphs survive intact; a message without one is split at
 * the exact limit. Joining the chunks reproduces the original text.
 */
export function chunkTelegramText(
  text: string,
  limit = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const newline = rest.slice(0, limit).lastIndexOf('\n');
    const cut = newline > 0 ? newline + 1 : limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Minimal Telegram Bot API client over `fetch`. No Telegram SDK is used. The
 * bot token is part of the endpoint path, as the Bot API requires; it is never
 * logged and never appears in an error message.
 */
export class TelegramClient {
  constructor(
    private token: string | undefined,
    private transport: typeof fetch = fetch,
  ) {}
  private async call(
    api: string,
    params: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.token)
      throw new TelegramApiError('Telegram bot token is not configured.');
    const response = await this.transport(`${API_BASE}${this.token}/${api}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new TelegramApiError(
        `Telegram API ${api} returned HTTP ${response.status}.`,
        response.status,
      );
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      description?: unknown;
      error_code?: unknown;
    } | null;
    if (!body || body.ok !== true) {
      // Telegram descriptions are short human phrases ("Bad Request: chat not
      // found"). Keep one only when it is plainly bounded text, so a hostile
      // payload cannot smuggle arbitrary content into logs.
      const description =
        typeof body?.description === 'string' &&
        /^[A-Za-z0-9 .:_-]{1,200}$/.test(body.description)
          ? `: ${body.description}`
          : '';
      throw new TelegramApiError(
        `Telegram API ${api} failed${description}.`,
        typeof body?.error_code === 'number' ? body.error_code : undefined,
      );
    }
    return body;
  }
  /** Confirm the token works and learn the bot's own username. */
  async getMe(): Promise<{ username?: string }> {
    const body = await this.call('getMe');
    const result = body.result as { username?: unknown } | undefined;
    return result && typeof result.username === 'string'
      ? { username: result.username }
      : {};
  }
  /** Send one message part. Chunking is the service's responsibility. */
  async sendMessage(input: {
    chatId: string;
    text: string;
    threadId?: string;
  }): Promise<void> {
    await this.call('sendMessage', {
      chat_id: input.chatId,
      text: input.text,
      ...(input.threadId ? { message_thread_id: input.threadId } : {}),
    });
  }
}
