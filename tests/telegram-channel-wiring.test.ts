import { afterEach, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { SlackStore } from '../src/server/slack-store.js';
import { TelegramStore } from '../src/server/telegram-store.js';
import { Platform } from '../src/server/platform.js';
import { Runner } from '../src/server/runner.js';

const SECRET = 'fake-webhook-secret-for-tests';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((close) => close()));

function fixture(
  config: {
    telegramWebhookSecret?: string;
    telegramBotToken?: string;
    telegramOwnerId?: string;
  } = {},
) {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const slackEvents = new SlackStore(':memory:');
  const telegramUpdates = new TelegramStore(':memory:');
  cleanup.push(() => {
    store.close();
    workspace.close();
    slackEvents.close();
    telegramUpdates.close();
  });
  const platform = new Platform(
    store,
    workspace,
    {
      baseUrl: 'https://example.com',
      voiceName: 'marin',
      runtimeUrl: '',
      slackUsers: [],
      telegramBotToken: '123456:fake-token',
      telegramWebhookSecret: SECRET,
      telegramOwnerId: '111111111',
      // Explicit undefined clears a field; an absent one keeps the default.
      ...config,
    },
    undefined,
    slackEvents,
    undefined,
    undefined,
    undefined,
    telegramUpdates,
  );
  const app = createApp({
    store,
    runner: new Runner(store, {
      mode: 'live' as const,
      baseUrl: 'https://example.com',
    }),
    config: { mode: 'live' as const, baseUrl: 'https://example.com' },
    platform,
    ownerToken: 'owner-token',
  });
  return { app, platform };
}

const post = (body: string, headers: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body,
});

const OWNER_UPDATE = JSON.stringify({
  update_id: 1,
  message: {
    message_id: 1,
    from: { id: 999999, is_bot: false },
    chat: { id: -100, type: 'private' },
    text: 'Hello',
    date: 1,
  },
});

it('serves the webhook before the owner middleware, authenticated by the secret token', async () => {
  const { app } = fixture();
  // No owner token is sent: the shared secret token is the authentication.
  const ok = await app.request(
    'http://localhost/api/telegram/webhook',
    post(OWNER_UPDATE, { 'x-telegram-bot-api-secret-token': SECRET }),
  );
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: true });
  // A wrong header is rejected with the same body a missing one gets.
  const wrong = await app.request(
    'http://localhost/api/telegram/webhook',
    post(OWNER_UPDATE, { 'x-telegram-bot-api-secret-token': 'nope' }),
  );
  expect(wrong.status).toBe(401);
  expect(await wrong.json()).toEqual({ error: 'Unauthorized.' });
  // Other /api routes still demand the owner token.
  expect((await app.request('http://localhost/api/state')).status).toBe(401);
  expect(
    (
      await app.request('http://localhost/api/state', {
        headers: { Authorization: 'Bearer owner-token' },
      })
    ).status,
  ).toBe(200);
});

it('answers 401 on everything when no webhook secret is configured', async () => {
  const { app } = fixture({
    telegramWebhookSecret: undefined,
    telegramBotToken: undefined,
    telegramOwnerId: undefined,
  });
  const attempts: Record<string, string>[] = [
    {},
    { 'x-telegram-bot-api-secret-token': SECRET },
    { 'x-telegram-bot-api-secret-token': 'guessed' },
  ];
  for (const headers of attempts) {
    const response = await app.request(
      'http://localhost/api/telegram/webhook',
      post(OWNER_UPDATE, headers),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized.' });
  }
});

it('caps the public webhook per client before anything else runs', async () => {
  const { app } = fixture();
  const request = () =>
    app.request(
      'http://localhost/api/telegram/webhook',
      post(OWNER_UPDATE, { 'x-telegram-bot-api-secret-token': SECRET }),
    );
  let limited = false;
  for (let i = 0; i < 125 && !limited; i += 1) {
    const response = await request();
    if (response.status === 429) {
      limited = true;
      expect(response.headers.get('Retry-After')).toBeTruthy();
    }
  }
  expect(limited).toBe(true);
});

it('reports the Telegram setup state from the service', () => {
  const { platform } = fixture();
  // Declared but not yet activated: honest setup_required.
  expect(platform.telegram.status()).toBe('setup_required');
  const none = fixture({
    telegramBotToken: undefined,
    telegramWebhookSecret: undefined,
    telegramOwnerId: undefined,
  });
  expect(none.platform.telegram.status()).toBe('not_configured');
});
