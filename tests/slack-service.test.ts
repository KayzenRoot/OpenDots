import { afterEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { SlackStore } from '../src/server/slack-store.js';
import { SlackService } from '../src/server/slack-service.js';
import { verifySlackSignature } from '../src/server/slack-signature.js';
import type {
  SlackEvent,
  SlackEventEnvelope,
} from '../src/server/slack-channel.js';

const SECRET = 'fake-signing-secret-for-tests';
const TOKEN = 'xoxb-fake-token-for-tests';
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
  vi.restoreAllMocks();
});

function sign(timestamp: string, body: string, secret = SECRET) {
  return `v0=${createHmac('sha256', secret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;
}

interface FixtureOptions {
  paused?: boolean;
  config?: Partial<{
    slackChannel: string;
    slackTeam: string;
    slackUsers: string[];
    slackBotToken: string;
    slackSigningSecret: string;
  }>;
}

function fixture(options: FixtureOptions = {}) {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const events = new SlackStore(':memory:');
  cleanup.push(() => {
    store.close();
    workspace.close();
    events.close();
  });
  const turn = vi.fn(
    async (
      _threadId: string,
      _prompt: string,
      _signal: AbortSignal,
      _metadata?: Record<string, unknown>,
    ) => 'The reply',
  );
  const transport = vi.fn<typeof fetch>(async (url) => {
    const api = String(url).split('/').pop();
    if (api === 'auth.test')
      return Response.json({ ok: true, user_id: 'U_BOT' });
    if (api === 'conversations.list')
      return Response.json({
        ok: true,
        channels: [{ id: 'C123', name: 'support' }],
        response_metadata: { next_cursor: '' },
      });
    return Response.json({ ok: true, ts: '1.2' });
  });
  const report = vi.fn();
  const service = new SlackService({
    config: {
      slackChannel: 'support',
      slackTeam: 'T123',
      slackUsers: ['U123'],
      slackBotToken: TOKEN,
      slackSigningSecret: SECRET,
      ...options.config,
    },
    workspace,
    events,
    paused: () => options.paused ?? false,
    turn,
    transport,
    report,
    turnTimeoutMs: 1000,
  });
  const posts = () =>
    transport.mock.calls
      .filter(([url]) => String(url).endsWith('chat.postMessage'))
      .map(
        ([, init]) => JSON.parse(String(init?.body)) as Record<string, string>,
      );
  return { service, turn, transport, report, workspace, events, posts };
}

function callback(
  event: Partial<SlackEvent> = {},
  extra: Partial<SlackEventEnvelope> = {},
): SlackEventEnvelope {
  return {
    type: 'event_callback',
    event_id: 'Ev1',
    team_id: 'T123',
    event: {
      type: 'app_mention',
      user: 'U123',
      text: '<@U_BOT> Help',
      ts: '100.1',
      channel: 'C123',
      ...event,
    },
    ...extra,
  };
}

it('accepts a valid signature and rejects wrong, stale and tampered requests', () => {
  const body = '{"type":"url_verification","challenge":"c"}';
  const timestamp = '1700000000';
  const now = 1_700_000_000_000;
  const good = sign(timestamp, body);
  expect(
    verifySlackSignature({
      signingSecret: SECRET,
      timestamp,
      signature: good,
      body,
      now,
    }),
  ).toBe(true);
  expect(
    verifySlackSignature({
      signingSecret: SECRET,
      timestamp,
      signature: sign(timestamp, body, 'different-secret'),
      body,
      now,
    }),
  ).toBe(false);
  const staleTimestamp = '1699999699';
  expect(
    verifySlackSignature({
      signingSecret: SECRET,
      timestamp: staleTimestamp,
      signature: sign(staleTimestamp, body),
      body,
      now,
    }),
  ).toBe(false);
  expect(
    verifySlackSignature({
      signingSecret: SECRET,
      timestamp,
      signature: good,
      body: `${body} `,
      now,
    }),
  ).toBe(false);
  expect(
    verifySlackSignature({
      signingSecret: undefined,
      timestamp,
      signature: good,
      body,
      now,
    }),
  ).toBe(false);
  expect(
    verifySlackSignature({
      signingSecret: SECRET,
      timestamp,
      signature: 'v0=short',
      body,
      now,
    }),
  ).toBe(false);
});

it('reports not_configured, setup_required, online and activation_failed honestly', async () => {
  const none = fixture({
    config: { slackChannel: undefined, slackTeam: undefined, slackUsers: [] },
  });
  expect(none.service.status()).toBe('not_configured');
  const partial = fixture({ config: { slackTeam: undefined, slackUsers: [] } });
  expect(partial.service.status()).toBe('setup_required');
  const noTokens = fixture({
    config: { slackBotToken: undefined, slackSigningSecret: undefined },
  });
  expect(noTokens.service.status()).toBe('setup_required');
  const ready = fixture();
  expect(ready.service.status()).toBe('setup_required');
  await ready.service.start();
  expect(ready.service.status()).toBe('online');
  const broken = fixture();
  broken.transport.mockImplementation(async () =>
    Response.json({ ok: false, error: 'invalid_auth' }),
  );
  await expect(broken.service.start()).rejects.toThrow();
  expect(broken.service.status()).toBe('activation_failed');
  expect(broken.service.activationFailed()).toBe(true);
});

it('accepts a channel id directly but resolves a channel name through conversations.list', async () => {
  const byId = fixture({ config: { slackChannel: 'C0EXAMPLE123' } });
  await byId.service.start();
  expect(
    byId.transport.mock.calls.some(([url]) =>
      String(url).endsWith('conversations.list'),
    ),
  ).toBe(false);
  expect(byId.service.status()).toBe('online');
  const byName = fixture();
  await byName.service.start();
  expect(
    byName.transport.mock.calls.filter(([url]) =>
      String(url).endsWith('conversations.list'),
    ),
  ).toHaveLength(1);
  expect(byName.service.status()).toBe('online');
});

it('runs an allowlisted mention once and ignores a retry with the same event id', async () => {
  const f = fixture();
  await f.service.start();
  await f.service.handleEvent(callback());
  await f.service.handleEvent(callback());
  expect(f.turn).toHaveBeenCalledTimes(1);
  expect(f.turn).toHaveBeenCalledWith(
    expect.any(String),
    'Help',
    expect.anything(),
    expect.objectContaining({
      nexbotSource: 'slack_mention',
      slackChannel: 'C123',
      slackThreadTs: '100.1',
    }),
  );
  expect(f.posts()).toEqual([
    { channel: 'C123', text: 'The reply', thread_ts: '100.1' },
  ]);
  expect(f.workspace.conversations()[0].ownerId).toBe('owner');
});

it('answers a mention, then only subscribed follow-ups continue the same conversation', async () => {
  const f = fixture();
  await f.service.start();
  // Not yet subscribed: a plain message in an unknown thread is ignored.
  await f.service.handleEvent(
    callback({ type: 'message', text: 'first' }, { event_id: 'EvA' }),
  );
  expect(f.turn).not.toHaveBeenCalled();
  await f.service.handleEvent(callback({}, { event_id: 'EvM' }));
  expect(f.turn).toHaveBeenCalledTimes(1);
  const threadId = f.turn.mock.calls[0][0];
  await f.service.handleEvent(
    callback(
      { type: 'message', text: 'more', ts: '100.2', thread_ts: '100.1' },
      { event_id: 'EvB' },
    ),
  );
  expect(f.turn).toHaveBeenCalledTimes(2);
  expect(f.turn.mock.calls[1][0]).toBe(threadId);
  expect(f.posts()).toHaveLength(2);
});

it('ignores nonhuman actors, foreign teams, non-allowlisted users and message changes', async () => {
  const f = fixture();
  await f.service.start();
  for (const [event, extra] of [
    [{}, { team_id: 'T999' }],
    [{ user: 'U999' }, {}],
    [{ user: undefined }, {}],
    [{ bot_id: 'B1' }, {}],
    [{ user: 'U_BOT' }, {}],
    [{ subtype: 'bot_message' }, {}],
    [{ subtype: 'message_changed' }, {}],
    [{ subtype: 'message_deleted' }, {}],
    [{ edited: { user: 'U123' } }, {}],
    [{ type: 'reaction_added' }, {}],
    [{ channel: 'C999' }, {}],
  ] as const)
    await f.service.handleEvent(
      callback(
        event as Partial<SlackEvent>,
        extra as Partial<SlackEventEnvelope>,
      ),
    );
  expect(f.turn).not.toHaveBeenCalled();
  expect(f.posts()).toHaveLength(0);
});

it('posts a pause notice instead of running when the workspace is paused', async () => {
  const f = fixture({ paused: true });
  await f.service.start();
  await f.service.handleEvent(callback());
  expect(f.turn).not.toHaveBeenCalled();
  expect(f.posts()).toHaveLength(1);
  expect(f.posts()[0].text).toMatch(/paused/i);
});

it('isolates a failed run and posts a sanitised error reply', async () => {
  const f = fixture();
  await f.service.start();
  f.turn.mockRejectedValue(new Error('SECRET provider details'));
  await f.service.handleEvent(callback());
  expect(f.posts()).toHaveLength(1);
  expect(JSON.stringify(f.posts())).not.toContain('SECRET');
  expect(f.report).toHaveBeenCalled();
  expect(JSON.stringify(f.report.mock.calls)).not.toContain('SECRET');
});

it('surfaces both failures without secrets when the error reply also fails', async () => {
  const f = fixture();
  await f.service.start();
  f.turn.mockRejectedValue(new Error('SECRET run details'));
  f.transport.mockImplementation(async (url) =>
    String(url).endsWith('chat.postMessage')
      ? Response.json({ ok: false, error: 'channel_not_found' })
      : Response.json({ ok: true }),
  );
  await expect(f.service.handleEvent(callback())).rejects.toBeInstanceOf(
    AggregateError,
  );
  expect(JSON.stringify(f.report.mock.calls)).not.toContain('SECRET');
});

it('surfaces a failed pause notice safely and never runs', async () => {
  const f = fixture({ paused: true });
  await f.service.start();
  f.transport.mockImplementation(async () =>
    Response.json({ ok: false, error: 'channel_not_found' }),
  );
  await expect(f.service.handleEvent(callback())).rejects.toThrow(
    'Slack notice failed: Error',
  );
  expect(f.turn).not.toHaveBeenCalled();
  expect(JSON.stringify(f.report.mock.calls)).not.toContain('SECRET');
});

it('still answers a mention when persisting the thread mapping fails', async () => {
  const f = fixture();
  await f.service.start();
  vi.spyOn(f.events, 'bindThread').mockImplementation(() => {
    throw new Error('SECRET write');
  });
  await f.service.handleEvent(callback());
  expect(f.turn).toHaveBeenCalledTimes(1);
  expect(f.posts()[0].text).toBe('The reply');
  expect(JSON.stringify(f.report.mock.calls)).not.toContain('SECRET');
});

it('never runs a message event when the subscription lookup is unreadable', async () => {
  const f = fixture();
  await f.service.start();
  vi.spyOn(f.events, 'threadFor').mockImplementation(() => {
    throw new Error('SECRET read');
  });
  await expect(
    f.service.handleEvent(
      callback({ type: 'message' }, { event_id: 'EvLookup' }),
    ),
  ).rejects.toThrow('Slack subscription lookup failed: Error');
  expect(f.turn).not.toHaveBeenCalled();
  expect(JSON.stringify(f.report.mock.calls)).not.toContain('SECRET');
});

it('stays inert until activation resolves the configured channel', async () => {
  const f = fixture();
  await f.service.handleEvent(callback());
  expect(f.turn).not.toHaveBeenCalled();
  expect(f.posts()).toHaveLength(0);
});
