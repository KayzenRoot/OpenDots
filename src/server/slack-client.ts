/** A Slack Web API failure carrying only a safe status, never the token. */
export class SlackApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const API_BASE = 'https://slack.com/api/';
/** Bound channel pagination so one activation cannot walk an unbounded list. */
const MAX_CHANNEL_PAGES = 10;

/**
 * Minimal Slack Web API client over `fetch`. No Slack SDK is used. The bot
 * token travels only in the `Authorization` header, never in a URL or log.
 */
export class SlackClient {
  constructor(
    private token: string | undefined,
    private transport: typeof fetch = fetch,
  ) {}
  private async call(
    api: string,
    params: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.token)
      throw new SlackApiError('Slack bot token is not configured.');
    const response = await this.transport(`${API_BASE}${api}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(params),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new SlackApiError(
        `Slack API ${api} returned HTTP ${response.status}.`,
        response.status,
      );
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      error?: unknown;
    } | null;
    if (!body || body.ok !== true)
      throw new SlackApiError(
        `Slack API ${api} failed${
          typeof body?.error === 'string' && /^[a-z_]+$/.test(body.error)
            ? `: ${body.error}`
            : ''
        }.`,
      );
    return body;
  }
  /** Confirm the token works and learn the app's own bot user id. */
  async authTest(): Promise<{ userId?: string }> {
    const body = await this.call('auth.test');
    return typeof body.user_id === 'string' ? { userId: body.user_id } : {};
  }
  /** Public/private channel ids whose names can be matched against config. */
  async listChannels(): Promise<Array<{ id: string; name: string }>> {
    const channels: Array<{ id: string; name: string }> = [];
    let cursor = '';
    for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
      const body = await this.call('conversations.list', {
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        limit: '200',
        ...(cursor ? { cursor } : {}),
      });
      const list = Array.isArray(body.channels) ? body.channels : [];
      for (const entry of list) {
        if (
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { id?: unknown }).id === 'string' &&
          typeof (entry as { name?: unknown }).name === 'string'
        )
          channels.push({
            id: (entry as { id: string }).id,
            name: (entry as { name: string }).name,
          });
      }
      const next = (
        body.response_metadata as { next_cursor?: unknown } | undefined
      )?.next_cursor;
      if (typeof next !== 'string' || !next) break;
      cursor = next;
    }
    return channels;
  }
  /** Post a message, optionally threading it under an existing reply. */
  async postMessage(input: {
    channel: string;
    text: string;
    threadTs?: string;
  }): Promise<void> {
    await this.call('chat.postMessage', {
      channel: input.channel,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    });
  }
}
