import { webSearchProvider } from './parallel.js';
import { createShutdown } from './shutdown.js';
import { reportChannelFailure, safeFailure } from './slack-channel.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { createApp } from './app.js';
import { resolveAppOrigins } from './app-origin.js';
import { WorkspaceStore } from './workspace.js';
import { Platform } from './platform.js';
import { ConversationStore } from './conversation-store.js';
import { LearningStore } from './learning-store.js';
import { SlackStore } from './slack-store.js';
import { ModelConfigStore } from './model-config.js';
import { dirname, join } from 'node:path';
import { createPool, migrate } from './pg.js';
import {
  agentRunTimeoutMsFromEnv,
  extraHeadersFromEnv,
  type PlatformConfig,
} from './platform-config.js';
// This fork sends nothing to CopilotKit. The MIT runtime and client packages
// carry an opt-out telemetry path that defaults to posting to
// telemetry.copilotkit.ai; disabling it here is effective because Node reads
// process.env at run time. Must be set before any runtime is constructed.
process.env.COPILOTKIT_TELEMETRY_DISABLED = 'true';
process.env.DO_NOT_TRACK = '1';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4310);
const ownerToken = process.env.OWNER_TOKEN;
if (
  !['127.0.0.1', '::1', 'localhost'].includes(host) &&
  (!ownerToken || ownerToken.length < 24)
)
  throw new Error(
    'External binding requires an OWNER_TOKEN of at least 24 characters.',
  );
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Conversation storage requires PostgreSQL; stopping.',
  );
  process.exit(1);
}
const database = process.env.DATABASE_PATH ?? 'data/opendots.sqlite';
const store = new Store(database);
const workspace = new WorkspaceStore(
  database,
  process.env.OWNER_ID ?? 'opendots-owner',
);
const config: PlatformConfig = {
  databaseUrl,
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  extraHeaders: extraHeadersFromEnv(process.env),
  agentRunTimeoutMs: agentRunTimeoutMsFromEnv(process.env),
  webSearchProvider: webSearchProvider(process.env.WEB_SEARCH_PROVIDER),
  parallelApiKey: process.env.PARALLEL_API_KEY,
  browserUrl: process.env.BROWSER_URL,
  browserSecret: process.env.BROWSER_SECRET,
  composioApiKey: process.env.COMPOSIO_API_KEY || undefined,
  computerSupervisorUrl: process.env.COMPUTER_SUPERVISOR_URL,
  computerSupervisorToken: process.env.COMPUTER_SUPERVISOR_TOKEN,
  computerToken: process.env.COMPUTER_TOKEN,
  computerNamespace: process.env.COMPUTER_NAMESPACE,
  voiceKey: process.env.VOICE_API_KEY,
  voiceModel: process.env.VOICE_MODEL,
  voiceName: process.env.VOICE_NAME ?? 'marin',
  slackChannel: process.env.SLACK_CHANNEL_NAME,
  slackTeam: process.env.SLACK_TEAM_ID,
  slackUsers: (process.env.SLACK_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  slackDotId: process.env.SLACK_DOT_ID || undefined,
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
  runtimeUrl: `http://${host === '::1' ? '[::1]' : '127.0.0.1'}:${port}/api/copilotkit`,
  ownerToken,
};
const pool = createPool(databaseUrl);
try {
  await migrate(pool);
} catch (error) {
  // Never print the connection string or SQL detail: they can carry secrets.
  console.error(
    `Database migration failed (${
      error instanceof Error ? error.name : 'Error'
    }). Check DATABASE_URL and that PostgreSQL is reachable; stopping.`,
  );
  process.exit(1);
}
const conversations = new ConversationStore(pool);
const learning = new LearningStore(pool);
const slackEvents = new SlackStore(database);
// The model provider saved from the in-app settings wins over the environment.
// It is sealed on disk; the key is opened only here, into the runtime config.
const modelConfig = new ModelConfigStore(
  database,
  process.env.MASTER_KEY_PATH ?? join(dirname(database), 'master.key'),
);
const saved = modelConfig.get();
if (saved) {
  config.baseUrl = saved.baseUrl;
  config.model = saved.model;
  config.apiKey = saved.apiKey;
}
const platform = new Platform(
  store,
  workspace,
  config,
  conversations,
  slackEvents,
  learning,
  modelConfig,
);
try {
  await platform.runner?.preloadAll();
} catch (error) {
  console.error(
    `Could not preload conversations (${
      error instanceof Error ? error.name : 'Error'
    }); the thread list starts empty until the next refresh.`,
  );
}
const researchConfig = {
  mode: 'live' as const,
  apiKey: config.apiKey,
  model: config.model,
  baseUrl: config.baseUrl,
  webSearchProvider: config.webSearchProvider,
  parallelApiKey: config.parallelApiKey,
  browserUrl: config.browserUrl,
  browserSecret: config.browserSecret,
  extraHeaders: config.extraHeaders,
};
const runner = new Runner(
  store,
  researchConfig,
  async (claim, _memories, signal, progress) => {
    const threadId = workspace.taskThread(claim.id);
    if (!threadId)
      throw new Error(
        'This legacy task has no conversation. Create a new scheduled task from a conversation.',
      );
    progress('Running this task in its conversation.');
    const text = await platform.turn(threadId, claim.prompt, signal, {
      opendotsSource: 'scheduled_task',
    });
    return { text, sources: [], sample: false };
  },
  config.agentRunTimeoutMs,
);
const app = createApp({
  store,
  runner,
  config: researchConfig,
  ownerToken,
  origin: resolveAppOrigins(process.env.APP_ORIGIN, process.env.NODE_ENV),
  platform,
});
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  );
  await next();
});
app.get('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
app.use('/*', serveStatic({ root: './dist/client' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));
const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`OpenDots listening on http://${host}:${info.port}`);
  runner.start();
  void platform
    .start()
    .catch((error) =>
      reportChannelFailure('Startup task failed', [safeFailure(error)]),
    );
});
const shutdown = createShutdown({
  stopRunner: () => runner.stop(),
  stopPlatform: async () => {
    await platform.stop();
    await pool.end();
  },
  closeServer: () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
  exit: (code) => process.exit(code),
  report: (operation, error) =>
    reportChannelFailure(operation, [safeFailure(error)]),
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
