import type { ModelConfigStore, DotModelConfigStore } from './model-config.js';
import { ComputerService } from './computer-service.js';
import { ConnectionService } from './connections.js';
import { PageService, type PageConversations } from './page-service.js';
import { randomUUID } from 'node:crypto';
import {
  CopilotRuntime,
  createCopilotHonoHandler,
  type CopilotHonoApp,
} from '@copilotkit/runtime/v2';
import { PostgresAgentRunner } from './agent-runner.js';
import type { ConversationStorage } from './conversation-store.js';
import { LearningService, learningModel } from './learning-pass.js';
import type { LearningStore } from './learning-store.js';
import { Store } from './store.js';
import { WorkspaceStore } from './workspace.js';
import { DotAgent } from './dot-agent.js';
import { runThreadTurn } from './headless.js';
import { setupStatus, type PlatformConfig } from './platform-config.js';
import { validateRuntimeScope } from './runtime-scope.js';
import { SetupTelemetry } from './setup-telemetry.js';
import { SlackService } from './slack-service.js';
import { SlackStore } from './slack-store.js';
import { TelegramService } from './telegram-service.js';
import { TelegramStore } from './telegram-store.js';

export class Platform {
  readonly setupTelemetry: SetupTelemetry;
  readonly pages: PageService;
  readonly computers: ComputerService;
  readonly connections: ConnectionService;
  readonly conversations?: ConversationStorage;
  readonly modelConfig?: ModelConfigStore;
  /** Per-Dot model overrides (WORK-030), when a database is configured. */
  readonly dotModelConfig?: DotModelConfigStore;
  /** Readiness probe: rejects unless conversation storage is configured and answers. */
  async ping(): Promise<void> {
    if (!this.conversations) throw new Error('Conversation storage is absent.');
    await this.conversations.ping();
  }
  readonly runner?: PostgresAgentRunner;
  readonly handler?: CopilotHonoApp;
  readonly slack: SlackService;
  readonly telegram: TelegramService;
  /** Postgres-backed per-Dot skills, when a database is configured. */
  readonly learning?: LearningStore;
  /** The automatic learning pass (WORK-021), when both stores are configured. */
  readonly learningPass?: LearningService;
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: PlatformConfig,
    conversations?: ConversationStorage,
    slackEvents?: SlackStore,
    learning?: LearningStore,
    modelConfig?: ModelConfigStore,
    dotModelConfig?: DotModelConfigStore,
    // Appended last so existing positional callers keep their meaning.
    telegramUpdates?: TelegramStore,
  ) {
    this.modelConfig = modelConfig;
    this.dotModelConfig = dotModelConfig;
    this.setupTelemetry = new SetupTelemetry(store);
    this.computers = new ComputerService(
      workspace,
      config,
      () => store.settings().paused,
    );
    this.connections = new ConnectionService(workspace.connections);
    this.conversations = conversations;
    this.learning = learning;
    this.pages = new PageService(workspace, () => this.pageConversations());
    this.slack = new SlackService({
      config,
      workspace,
      events: slackEvents ?? new SlackStore(':memory:'),
      paused: () => store.settings().paused,
      turn: (threadId, prompt, signal, metadata) =>
        this.turn(threadId, prompt, signal, metadata),
    });
    this.telegram = new TelegramService({
      config,
      workspace,
      updates: telegramUpdates ?? new TelegramStore(':memory:'),
      paused: () => store.settings().paused,
      // The channel-side kill switch flips the same workspace setting the
      // in-app Pause control uses, so every paused gate sees it.
      setPaused: (paused) => store.updateSettings({ paused }),
      turn: (threadId, prompt, signal, metadata) =>
        this.turn(threadId, prompt, signal, metadata),
    });
    if (!conversations) return;
    // Learning is opt-in per Dot and off by default; the service reads the
    // switch on every pass, so toggling it takes effect without a restart.
    if (learning)
      this.learningPass = new LearningService({
        store: learning,
        conversations,
        enabled: (dotId) => workspace.dot(dotId)?.learningEnabled === true,
        paused: () => store.settings().paused,
        model: learningModel(config),
      });
    const runner = new PostgresAgentRunner(conversations, {
      ownerId: workspace.ownerId,
      onRunPersisted: ({ threadId, agentId }) =>
        this.learningPass?.maybeLearn(threadId, agentId),
    });
    this.runner = runner;
    const runtime = new CopilotRuntime({
      agents: () => this.agents(),
      runner,
      licenseToken: undefined,
    });
    this.handler = createCopilotHonoHandler({
      runtime,
      basePath: '/api/copilotkit',
      cors: { origin: [] },
    });
  }
  /**
   * One DotAgent per Dot, built on demand (the runtime calls this per request,
   * so a saved per-Dot model override applies without a restart). The Dot's
   * model config is resolved here — override first, then the global provider —
   * and handed to the agent (WORK-030).
   */
  async agents(): Promise<Record<string, DotAgent>> {
    const entries = await Promise.all(
      this.workspace.dots().map(async (dot) => {
        const model = (await this.dotModelConfig?.resolve(dot.id)) ?? undefined;
        return [
          dot.id,
          new DotAgent(
            this.store,
            this.workspace,
            this.config,
            dot.id,
            false,
            this.setupTelemetry,
            this.learning,
            model,
          ),
        ] as const;
      }),
    );
    return Object.fromEntries(entries);
  }
  private pageConversations(): PageConversations {
    const conversations = this.conversations;
    if (!conversations)
      throw new Error('Conversation storage is not configured.');
    return {
      getOrCreateThread: (input) =>
        conversations.getOrCreateThread({
          id: input.threadId,
          dotId: input.agentId,
          ownerId: input.userId,
          title: input.name,
        }),
      getThreadMessages: async ({ threadId }) => ({
        messages: await conversations.getMessages(threadId),
      }),
    };
  }
  setup() {
    return setupStatus(
      this.config,
      this.slack.status(),
      this.slack.activationFailed(),
      !!this.conversations,
    );
  }
  requireReady() {
    const missing = this.setup().missing;
    if (missing.length)
      throw new Error(
        `Setup required: ${missing.join(', ')}. Conversations require the model configuration.`,
      );
  }
  async start() {
    this.setupTelemetry.start();
    // Activation is a no-op without Slack/Telegram env, so the app starts
    // normally. Each channel activates in turn; a failure is attributed to the
    // channels step and rethrown so startup logs it.
    try {
      await this.slack.start();
      await this.telegram.start();
    } catch (error) {
      this.setupTelemetry.capture({
        kind: 'setup_failed',
        step: 'settings',
        error_class: 'channel_start_failed',
      });
      throw error;
    }
  }
  async stop() {
    await this.setupTelemetry.stop();
    this.slack.stop();
    this.telegram.stop();
  }
  async createConversation(dotId: string, title: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    if (!this.conversations)
      throw new Error('Conversation storage is not configured.');
    const id = randomUUID();
    try {
      await this.conversations.createThread({
        id,
        dotId,
        ownerId: this.workspace.ownerId,
        title,
      });
    } catch {
      throw new Error(
        'Conversation storage could not create this conversation. Check the database connection and retry.',
      );
    }
    await this.runner?.refreshThreadCache().catch(() => {});
    return this.workspace.bindThread(id, dotId, title);
  }
  async history(threadId: string): Promise<string> {
    this.requireReady();
    this.workspace.requireThread(threadId);
    if (!this.conversations) return '';
    const messages = await this.conversations.getMessages(threadId);
    return messages
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .slice(-12)
      .map(
        (message) =>
          `${message.role}: ${typeof message.content === 'string' ? message.content : ''}`,
      )
      .join('\n')
      .slice(-12000);
  }
  async handle(request: Request): Promise<Response> {
    if (!this.handler)
      return Response.json(
        { error: 'Conversation storage is not configured.' },
        { status: 503 },
      );
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      body = await request
        .clone()
        .json()
        .catch(() => null);
    try {
      validateRuntimeScope(request, this.workspace, body);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Conversation scope denied.',
        },
        { status: 403 },
      );
    }
    return this.handler.fetch(request);
  }
  async turn(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    return runThreadTurn(
      this.config.runtimeUrl,
      this.config.ownerToken
        ? { Authorization: `Bearer ${this.config.ownerToken}` }
        : {},
      thread.dotId,
      threadId,
      prompt,
      signal,
      metadata,
    );
  }
}
