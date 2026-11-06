import type { Message } from '@ag-ui/client';
import { chat } from '@tanstack/ai';
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible';
import { skillDescription } from './learning.js';
import {
  conversationGate,
  proposalBody,
  reflect,
  transcriptTurns,
  type ReflectionModel,
  type SkillProposal,
} from './learning-reflect.js';
import type { ProposalProvenance, SkillRecord } from './learning-store.js';

/**
 * Orchestration of the automatic learning pass (WORK-021).
 *
 * The pass runs after a run is persisted, never mid-conversation. It is
 * per-Dot opt-in, skipped while the workspace is paused, debounced per
 * conversation, bounded per Dot per hour, and marks the analysed snapshot so
 * the same messages are never sent to the model twice. Every failure is logged
 * and swallowed: the agent runtime and the conversation always continue.
 *
 * The reflection decision itself is pure and lives in `learning-reflect.ts`;
 * this module only adds storage, gating and the provider call.
 */

/** Repeated triggers for one conversation within this window are ignored. */
export const LEARNING_DEBOUNCE_MS = 60_000;
/** Hard bound on reflection passes per Dot per hour; excess passes stop. */
export const LEARNING_PASSES_PER_HOUR = 6;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MODEL_TIMEOUT_MS = 60_000;

/**
 * The storage the pass needs. `LearningStore` implements it structurally; a
 * test double can too, so orchestration is testable without a database.
 */
export interface LearningPassStore {
  listSkills(dotId: string): Promise<SkillRecord[]>;
  proposeSkill(
    dotId: string,
    input: { name: string; body: string },
    provenance?: ProposalProvenance,
  ): Promise<SkillRecord | null>;
  learningState(threadId: string): Promise<{ messageCount: number } | null>;
  markLearned(
    threadId: string,
    dotId: string,
    messageCount: number,
  ): Promise<void>;
  recordPass(dotId: string, threadId: string): Promise<void>;
  countPassesSince(dotId: string, since: Date): Promise<number>;
}

export interface LearningPassOptions {
  store: LearningPassStore;
  conversations: { getMessages(threadId: string): Promise<Message[]> };
  /** Per-Dot opt-in. Read on every pass so a toggle takes effect immediately. */
  enabled(dotId: string): boolean | Promise<boolean>;
  /** The workspace pause switch; a paused workspace runs no passes. */
  paused(): boolean;
  model: ReflectionModel;
  now?: () => number;
  debounceMs?: number;
  passesPerHour?: number;
  maxProposals?: number;
  log?: (message: string) => void;
}

export type LearningPassOutcome =
  | { status: 'paused' }
  | { status: 'disabled' }
  | { status: 'in_flight' }
  | { status: 'debounced' }
  | { status: 'too_short'; messages: number; characters: number }
  | { status: 'unchanged' }
  | { status: 'rate_limited'; passes: number }
  | {
      status: 'ran';
      proposed: number;
      created: number;
      problem?: 'model_failed' | 'malformed_response';
    }
  | { status: 'failed' };

export interface LearningModelConfig {
  model?: string;
  apiKey?: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * The provider call, built exactly like `DotAgent` builds its adapter: same
 * model, key, base URL, API shape and gateway routing headers. The config is
 * read on every call so changing model settings is picked up.
 */
export function learningModel(config: LearningModelConfig): ReflectionModel {
  return {
    get model() {
      return config.model?.trim() || 'unconfigured';
    },
    async call({ systemPrompt, userPrompt }) {
      const model = config.model?.trim();
      const apiKey = config.apiKey?.trim();
      if (!model || !apiKey)
        throw new Error('Model configuration is required.');
      const adapter = openaiCompatibleText(model, {
        apiKey,
        baseURL: config.baseUrl || 'https://api.openai.com/v1',
        api: 'chat-completions',
        maxRetries: 1,
        ...(config.extraHeaders ? { defaultHeaders: config.extraHeaders } : {}),
      });
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        config.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS,
      );
      try {
        return await chat({
          adapter,
          messages: [{ role: 'user', content: userPrompt }],
          systemPrompts: [systemPrompt],
          stream: false,
          modelOptions: { max_completion_tokens: 1600 },
          abortController: controller,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// The default diagnostic sink. Messages are fixed strings; no conversation
// content or provider detail is included.
const DEFAULT_LOG = (message: string) =>
  console.error(`Learning pass: ${message}`);

type NormalizedOptions = LearningPassOptions & {
  now: () => number;
  debounceMs: number;
  passesPerHour: number;
  log: (message: string) => void;
};

/**
 * Decides whether a persisted run should trigger a learning pass, then runs
 * the reflection and writes proposals. Never throws.
 */
export class LearningService {
  private readonly inFlight = new Set<string>();
  private readonly lastAttemptAt = new Map<string, number>();
  private readonly options: NormalizedOptions;

  constructor(options: LearningPassOptions) {
    this.options = {
      ...options,
      now: options.now ?? Date.now,
      debounceMs: options.debounceMs ?? LEARNING_DEBOUNCE_MS,
      passesPerHour: options.passesPerHour ?? LEARNING_PASSES_PER_HOUR,
      log: options.log ?? DEFAULT_LOG,
    };
  }

  /** Fire-and-forget entry point for the run-completion hook. */
  maybeLearn(threadId: string, dotId: string): void {
    void this.learn(threadId, dotId);
  }

  /**
   * One guarded attempt. Returns why it stopped so tests and diagnostics can
   * see the gate that fired, and never rejects.
   */
  async learn(threadId: string, dotId: string): Promise<LearningPassOutcome> {
    const { paused, enabled, now, debounceMs, log } = this.options;
    try {
      if (paused()) return { status: 'paused' };
      if (!(await enabled(dotId))) return { status: 'disabled' };
      if (this.inFlight.has(threadId)) return { status: 'in_flight' };
      const at = now();
      const last = this.lastAttemptAt.get(threadId);
      if (last !== undefined && at - last < debounceMs)
        return { status: 'debounced' };
      this.inFlight.add(threadId);
      this.lastAttemptAt.set(threadId, at);
      try {
        return await this.run(threadId, dotId, at);
      } finally {
        this.inFlight.delete(threadId);
      }
    } catch {
      log('The learning pass failed and was ignored.');
      return { status: 'failed' };
    }
  }

  private async run(
    threadId: string,
    dotId: string,
    at: number,
  ): Promise<LearningPassOutcome> {
    const { store, conversations, model, passesPerHour, maxProposals, log } =
      this.options;
    const turns = transcriptTurns(await conversations.getMessages(threadId));
    const gate = conversationGate(turns);
    // Below the threshold nothing is proposed and no model call is made.
    if (!gate.eligible)
      return {
        status: 'too_short',
        messages: gate.messages,
        characters: gate.characters,
      };
    const state = await store.learningState(threadId);
    if (state && state.messageCount >= turns.length)
      return { status: 'unchanged' };
    const passes = await store.countPassesSince(dotId, new Date(at - HOUR_MS));
    // Exceeding the cap stops the pass; it is never queued for later.
    if (passes >= passesPerHour) return { status: 'rate_limited', passes };
    const skills = await store.listSkills(dotId);
    const existing = skills.map((skill) => ({
      name: skill.name,
      description: skillDescription(skill.body, skill.name),
    }));
    const rejections = skills
      .filter((skill) => skill.status === 'rejected')
      .map((skill) => ({
        name: skill.name,
        reason: skill.rejectionReason ?? '',
      }));
    // Counted before the model call so a failing provider cannot outspend the
    // hourly limit.
    await store.recordPass(dotId, threadId);
    const outcome = await reflect(
      { turns, existing, rejections },
      {
        model,
        ...(maxProposals === undefined ? {} : { maxProposals }),
        log,
      },
    );
    let created = 0;
    for (const proposal of outcome.proposals)
      created += await this.write(dotId, threadId, proposal);
    try {
      await store.markLearned(threadId, dotId, turns.length);
    } catch {
      log('Recording the learning pass marker failed.');
    }
    return {
      status: 'ran',
      proposed: outcome.proposals.length,
      created,
      ...(outcome.problem ? { problem: outcome.problem } : {}),
    };
  }

  /** One proposal write; a database failure drops that proposal only. */
  private async write(
    dotId: string,
    threadId: string,
    proposal: SkillProposal,
  ): Promise<number> {
    try {
      const stored = await this.options.store.proposeSkill(
        dotId,
        { name: proposal.name, body: proposalBody(proposal) },
        { conversationId: threadId, model: this.options.model.model },
      );
      return stored ? 1 : 0;
    } catch {
      this.options.log('Storing a learning proposal failed.');
      return 0;
    }
  }
}
