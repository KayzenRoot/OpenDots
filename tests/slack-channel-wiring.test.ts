import { afterEach, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { SlackStore } from '../src/server/slack-store.js';
import { Platform } from '../src/server/platform.js';
import { Runner } from '../src/server/runner.js';

const SECRET = 'fake-signing-secret-for-tests';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((close) => close()));

function fixture() {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const slackEvents = new SlackStore(':memory:');
  cleanup.push(() => {
    store.close();
    workspace.close();
    slackEvents.close();
  });
  const platform = new Platform(
    store,
    workspace,
    {
      baseUrl: 'https://example.com',
      voiceName: 'marin',
      runtimeUrl: '',
      slackChannel: 'support',
      slackTeam: 'T123',
      slackUsers: ['U123'],
      slackBotToken: 'xoxb-fake-token-for-tests',
      slackSigningSecret: SECRET,
    },
    undefined,
    slackEvents,
  );
  const config = { mode: 'live' as const, baseUrl: 'https://example.com' };
  const app = createApp({
    store,
    runner: new Runner(store, config),
    config,
    platform,
    ownerToken: 'owner-token',
  });
  return { app, platform };
}

const signature = (timestamp: string, body: string) =>
  `v0=${createHmac('sha256', SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;

const post = (body: string, headers: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body,
});

it('serves the Events API route before the owner middleware, authenticated by the signature', async () => {
  const { app } = fixture();
  const body = JSON.stringify({
    type: 'url_verification',
    challenge: 'challenge-value',
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  // No owner token is sent: the Slack signature is the authentication.
  const ok = await app.request(
    'http://localhost/api/slack/events',
    post(body, {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature(timestamp, body),
    }),
  );
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ challenge: 'challenge-value' });
  // A wrong signature is rejected, so the route cannot be abused.
  const bad = await app.request(
    'http://localhost/api/slack/events',
    post(body, {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': 'v0=deadbeef',
    }),
  );
  expect(bad.status).toBe(401);
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

it('rejects an unsigned or stale Events API delivery with 401', async () => {
  const { app } = fixture();
  const body = JSON.stringify({ type: 'event_callback', event_id: 'Ev1' });
  expect(
    (await app.request('http://localhost/api/slack/events', post(body, {})))
      .status,
  ).toBe(401);
  const stale = String(Math.floor(Date.now() / 1000) - 3600);
  expect(
    (
      await app.request(
        'http://localhost/api/slack/events',
        post(body, {
          'x-slack-request-timestamp': stale,
          'x-slack-signature': signature(stale, body),
        }),
      )
    ).status,
  ).toBe(401);
});

it('reports the Slack setup state from the service without a channel object', () => {
  const { platform } = fixture();
  // Declared but not yet activated: honest setup_required, no channel object.
  expect(platform.setup().slack).toBe('setup_required');
  expect(platform.slack.status()).toBe('setup_required');
  expect(platform.setup().intelligence).toBe(false);
});
