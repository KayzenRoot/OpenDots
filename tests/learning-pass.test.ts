import { describe, expect, it } from 'vitest';
import type { Message } from '@ag-ui/client';
import {
  LearningService,
  LEARNING_DEBOUNCE_MS,
  type LearningPassOptions,
  type LearningPassStore,
} from '../src/server/learning-pass.js';
import type {
  ProposalProvenance,
  SkillRecord,
  SkillStatus,
} from '../src/server/learning-store.js';
import type {
  ReflectionModel,
  ReflectionPrompt,
} from '../src/server/learning-reflect.js';

const iso = new Date(0).toISOString();

const skillRecord = (
  dotId: string,
  name: string,
  status: SkillStatus,
  body = 'A durable rule.',
): SkillRecord => ({
  id: `${dotId}:${name}`,
  dotId,
  name,
  body,
  revision: 1,
  enabled: true,
  status,
  rejectionReason: status === 'rejected' ? 'Too specific.' : null,
  source: status === 'approved' ? 'manual' : 'learning',
  conversationId: status === 'approved' ? null : 'thread-old',
  model: status === 'approved' ? null : 'test-model',
  createdAt: iso,
  updatedAt: iso,
});

/**
 * A memory implementation of the pass's storage contract. It is a
 * collaborator double, not a mock of the module under test: the service runs
 * for real against it.
 */
class MemoryStore implements LearningPassStore {
  readonly skills: SkillRecord[] = [];
  readonly states = new Map<string, { messageCount: number }>();
  readonly passes: { dotId: string; threadId: string; at: number }[] = [];
  failProposalWrites = false;
  failReads = false;
  constructor(private readonly clock: { value: number }) {}
  async listSkills(dotId: string) {
    if (this.failReads) throw new Error('database down');
    return this.skills.filter((skill) => skill.dotId === dotId);
  }
  async proposeSkill(
    dotId: string,
    input: { name: string; body: string },
    provenance?: ProposalProvenance,
  ) {
    if (this.failProposalWrites) throw new Error('database down');
    if (
      this.skills.some(
        (skill) => skill.dotId === dotId && skill.name === input.name,
      )
    )
      return null;
    const row: SkillRecord = {
      ...skillRecord(dotId, input.name, 'proposed', input.body),
      conversationId: provenance?.conversationId ?? null,
      model: provenance?.model ?? null,
    };
    this.skills.push(row);
    return row;
  }
  async learningState(threadId: string) {
    return this.states.get(threadId) ?? null;
  }
  async markLearned(threadId: string, _dotId: string, messageCount: number) {
    this.states.set(threadId, { messageCount });
  }
  async recordPass(dotId: string, threadId: string) {
    this.passes.push({ dotId, threadId, at: this.clock.value });
  }
  async countPassesSince(dotId: string, since: Date) {
    return this.passes.filter(
      (pass) => pass.dotId === dotId && new Date(pass.at) >= since,
    ).length;
  }
}

/** Alternate user/assistant messages whose total text is `count * size`. */
const conversation = (count: number, size: number): Message[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: 'x'.repeat(size),
  })) as unknown as Message[];

const validReply = (names: string[]) =>
  JSON.stringify(
    names.map((name) => ({
      name,
      description: `${name} summary`,
      body: `# ${name}\n\nApply this rule.`,
    })),
  );

function setup(overrides: Partial<LearningPassOptions> = {}) {
  const clock = { value: 1_000_000 };
  const store = new MemoryStore(clock);
  const threads = new Map<string, Message[]>();
  threads.set('thread-a', conversation(6, 140));
  const prompts: ReflectionPrompt[] = [];
  const diagnostics: string[] = [];
  const { model: suppliedModel, ...rest } = overrides;
  // Record every prompt, including when a test supplies its own reply.
  const model: ReflectionModel = {
    model: 'test-model',
    call: async (prompt) => {
      prompts.push(prompt);
      return suppliedModel
        ? await suppliedModel.call(prompt)
        : validReply(['house-style']);
    },
  };
  const service = new LearningService({
    store,
    conversations: {
      getMessages: async (threadId) => threads.get(threadId) ?? [],
    },
    enabled: (dotId) => dotId === 'dot-a',
    paused: () => false,
    model,
    now: () => clock.value,
    debounceMs: LEARNING_DEBOUNCE_MS,
    passesPerHour: 6,
    log: (message) => diagnostics.push(message),
    ...rest,
  });
  return { clock, store, threads, prompts, diagnostics, service, model };
}

describe('learning pass gating', () => {
  it('does nothing for a Dot that has not opted in', async () => {
    const { service, prompts, store } = setup();
    expect(await service.learn('thread-a', 'dot-b')).toEqual({
      status: 'disabled',
    });
    expect(prompts).toEqual([]);
    expect(store.passes).toEqual([]);
  });

  it('does nothing while the workspace is paused', async () => {
    const { service, prompts, store } = setup({ paused: () => true });
    expect(await service.learn('thread-a', 'dot-a')).toEqual({
      status: 'paused',
    });
    expect(prompts).toEqual([]);
    expect(store.passes).toEqual([]);
  });

  it('skips a conversation below the message threshold without a model call', async () => {
    const { service, threads, prompts, store } = setup();
    threads.set('thread-a', conversation(5, 400));
    const outcome = await service.learn('thread-a', 'dot-a');
    expect(outcome).toMatchObject({ status: 'too_short', messages: 5 });
    expect(prompts).toEqual([]);
    expect(store.passes).toEqual([]);
  });

  it('skips a conversation below the character threshold without a model call', async () => {
    const { service, threads, prompts, store } = setup();
    threads.set('thread-a', conversation(6, 133)); // 798 characters
    const outcome = await service.learn('thread-a', 'dot-a');
    expect(outcome).toMatchObject({
      status: 'too_short',
      messages: 6,
      characters: 798,
    });
    expect(prompts).toEqual([]);
    expect(store.passes).toEqual([]);
  });

  it('runs exactly at six messages and 800 characters', async () => {
    const { service, threads, prompts, store } = setup();
    // 5 turns of 133 and one of 135 sums to 800.
    const messages = conversation(5, 133);
    messages.push({ id: 'last', role: 'assistant', content: 'x'.repeat(135) });
    threads.set('thread-a', messages as unknown as Message[]);
    const outcome = await service.learn('thread-a', 'dot-a');
    expect(outcome).toMatchObject({ status: 'ran', created: 1 });
    expect(prompts).toHaveLength(1);
    expect(store.passes).toHaveLength(1);
  });
});

describe('learning pass debounce and re-analysis', () => {
  it('debounces repeated triggers for one conversation', async () => {
    const { service, threads, prompts, clock, store } = setup();
    await service.learn('thread-a', 'dot-a');
    expect(prompts).toHaveLength(1);

    // More messages, but the same conversation inside the debounce window.
    threads.set('thread-a', conversation(8, 140));
    clock.value += 1_000;
    expect(await service.learn('thread-a', 'dot-a')).toEqual({
      status: 'debounced',
    });
    expect(prompts).toHaveLength(1);

    clock.value += LEARNING_DEBOUNCE_MS;
    expect(await service.learn('thread-a', 'dot-a')).toMatchObject({
      status: 'ran',
    });
    expect(prompts).toHaveLength(2);
    // Two different conversations are not debounced against each other.
    threads.set('thread-b', conversation(6, 140));
    expect(await service.learn('thread-b', 'dot-a')).toMatchObject({
      status: 'ran',
    });
    expect(store.passes.map((pass) => pass.threadId)).toEqual([
      'thread-a',
      'thread-a',
      'thread-b',
    ]);
  });

  it('never re-analyses the same conversation snapshot', async () => {
    const { service, prompts, clock, store } = setup();
    await service.learn('thread-a', 'dot-a');
    clock.value += LEARNING_DEBOUNCE_MS * 2;
    expect(await service.learn('thread-a', 'dot-a')).toEqual({
      status: 'unchanged',
    });
    expect(prompts).toHaveLength(1);
    expect(store.states.get('thread-a')).toEqual({ messageCount: 6 });
  });
});

describe('learning pass limits', () => {
  it('stops instead of queueing past the hourly cap for a Dot', async () => {
    const { service, threads, prompts, clock } = setup({ passesPerHour: 2 });
    for (const threadId of ['thread-a', 'thread-b', 'thread-c']) {
      threads.set(threadId, conversation(6, 140));
      clock.value += LEARNING_DEBOUNCE_MS;
    }
    expect(await service.learn('thread-a', 'dot-a')).toMatchObject({
      status: 'ran',
    });
    expect(await service.learn('thread-b', 'dot-a')).toMatchObject({
      status: 'ran',
    });
    const third = await service.learn('thread-c', 'dot-a');
    expect(third).toMatchObject({ status: 'rate_limited', passes: 2 });
    expect(prompts).toHaveLength(2);
  });

  it('applies the per-pass proposal cap', async () => {
    const store = new MemoryStore({ value: 0 });
    const service = new LearningService({
      store,
      conversations: {
        getMessages: async () => conversation(6, 140),
      },
      enabled: () => true,
      paused: () => false,
      model: {
        model: 'test-model',
        call: async () => validReply(['one', 'two', 'three', 'four']),
      },
      now: () => 0,
      maxProposals: 3,
    });
    expect(await service.learn('thread', 'dot')).toMatchObject({
      status: 'ran',
      created: 3,
    });
    expect(store.skills.map((skill) => skill.name)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });
});

describe('learning pass output', () => {
  it('writes proposals as proposed with provenance', async () => {
    const { service, store } = setup();
    await service.learn('thread-a', 'dot-a');
    expect(store.skills).toHaveLength(1);
    expect(store.skills[0]).toMatchObject({
      name: 'house-style',
      status: 'proposed',
      source: 'learning',
      conversationId: 'thread-a',
      model: 'test-model',
    });
    expect(store.skills[0].body).toContain(
      'description: "house-style summary"',
    );
  });

  it('does not re-propose an existing skill or a remembered rejection', async () => {
    const { service, store, prompts } = setup({
      model: {
        model: 'test-model',
        call: async () => validReply(['taken', 'rejected-before', 'fresh']),
      },
    });
    store.skills.push(
      skillRecord('dot-a', 'taken', 'approved'),
      skillRecord('dot-a', 'rejected-before', 'rejected'),
    );
    await service.learn('thread-a', 'dot-a');
    expect(store.skills.map((skill) => skill.name)).toEqual([
      'taken',
      'rejected-before',
      'fresh',
    ]);
    expect(prompts[0].systemPrompt).toContain('taken');
    expect(prompts[0].systemPrompt).toContain('rejected-before');
  });

  it('records a clean zero-proposal pass without writing anything', async () => {
    const { service, store, prompts } = setup({
      model: { model: 'test-model', call: async () => '[]' },
    });
    expect(await service.learn('thread-a', 'dot-a')).toMatchObject({
      status: 'ran',
      proposed: 0,
      created: 0,
    });
    expect(store.skills).toEqual([]);
    expect(store.states.get('thread-a')).toEqual({ messageCount: 6 });
    expect(prompts).toHaveLength(1);
  });

  it('records a malformed response as zero proposals and keeps going', async () => {
    const { service, store, diagnostics } = setup({
      model: { model: 'test-model', call: async () => 'not json' },
    });
    const outcome = await service.learn('thread-a', 'dot-a');
    expect(outcome).toMatchObject({
      status: 'ran',
      proposed: 0,
      created: 0,
      problem: 'malformed_response',
    });
    expect(store.skills).toEqual([]);
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

describe('learning pass failure isolation', () => {
  it('swallows a database failure while writing a proposal', async () => {
    const { service, store, diagnostics } = setup();
    store.failProposalWrites = true;
    const outcome = await service.learn('thread-a', 'dot-a');
    // The pass ran; the write failure is logged, not thrown.
    expect(outcome).toMatchObject({ status: 'ran', created: 0 });
    expect(diagnostics.length).toBeGreaterThan(0);
    // The marker is written so a broken write path cannot retry forever.
    expect(store.states.get('thread-a')).toEqual({ messageCount: 6 });
  });

  it('returns a failed outcome instead of rejecting when a read fails', async () => {
    const { service, store, diagnostics } = setup();
    store.failReads = true;
    await expect(service.learn('thread-a', 'dot-a')).resolves.toEqual({
      status: 'failed',
    });
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('never rejects from the fire-and-forget entry point', async () => {
    const { service, store } = setup();
    store.failReads = true;
    expect(() => service.maybeLearn('thread-a', 'dot-a')).not.toThrow();
    // Let the queued promise settle before the test ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
