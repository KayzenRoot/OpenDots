import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Pool } from 'pg';
import { EventType } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { chat } from '@tanstack/ai';
import { DotAgent } from '../src/server/dot-agent.js';
import { completion } from './fixtures/model-stream.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { LearningStore } from '../src/server/learning-store.js';
import { createPool, migrate } from '../src/server/pg.js';

vi.mock('@tanstack/ai', { spy: true });
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const config = {
  apiKey: 'fixture',
  model: 'fixture',
  baseUrl: 'https://unused.invalid',
  runtimeUrl: '',
  voiceName: 'marin',
  slackUsers: [],
};

// A Dot with local delivery enabled but no learning store is the seam: the
// local tool surface exists only when skills were actually read, and no hosted
// skill service is ever contacted.
it('never contacts a hosted service and exposes no skill tools without a local store', async () => {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  try {
    const dot = workspace.dots()[0];
    workspace.updateDot(dot.id, {
      ...dot,
      learningContainerId: 'research',
      skillDeliveryEnabled: true,
    });
    workspace.bindThread('thread', dot.id, 'Learning');
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        completion({ role: 'assistant', content: 'Ready to review evidence.' }),
      );
    const agent = new DotAgent(store, workspace, config, dot.id);
    const events = await lastValueFrom(
      agent
        .run({
          threadId: 'thread',
          runId: 'run',
          messages: [
            { id: 'message', role: 'user', content: 'Review the evidence.' },
          ],
          state: {},
          tools: [],
          context: [],
          forwardedProps: {},
        })
        .pipe(toArray()),
    );
    expect(JSON.stringify(events)).toContain('Ready to review evidence.');
    expect(chat).toHaveBeenCalledTimes(1);
    // Exactly one network call: the model adapter. No skill snapshot fetch.
    expect(network).toHaveBeenCalledTimes(1);
    expect(String(network.mock.calls[0][0])).toContain(
      'https://unused.invalid',
    );
    const request = String(network.mock.calls[0][1]?.body);
    expect(request).toContain('read_space_page');
    expect(request).not.toContain('copilotkit_load_skill');
    expect(request).not.toContain('copilotkit_read_skill_file');
    expect(
      events.some((event) => event.type === EventType.TOOL_CALL_RESULT),
    ).toBe(false);
  } finally {
    workspace.close();
    store.close();
  }
});

const databaseUrl = process.env.NEXBOT_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('local skill delivery (PostgreSQL)', () => {
  let pool: Pool;
  let learning: LearningStore;
  // Each test seeds skills for workspace-generated Dot ids (random UUIDs), so
  // cleanup removes only those rows instead of truncating the shared table.
  const seededDots = new Set<string>();
  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  afterEach(async () => {
    if (seededDots.size)
      await pool.query('DELETE FROM skills WHERE dot_id = ANY($1)', [
        [...seededDots],
      ]);
    seededDots.clear();
  });

  function fixture(skillDeliveryEnabled: boolean) {
    const store = new Store(':memory:');
    const workspace = new WorkspaceStore(':memory:', 'owner');
    const dot = workspace.dots()[0];
    workspace.updateDot(dot.id, {
      ...dot,
      learningContainerId: 'research',
      skillDeliveryEnabled,
    });
    workspace.bindThread('thread', dot.id, 'Learning');
    const agent = new DotAgent(
      store,
      workspace,
      config,
      dot.id,
      false,
      undefined,
      learning,
    );
    return { store, workspace, dot, agent };
  }

  const run = (agent: DotAgent) =>
    lastValueFrom(
      agent
        .run({
          threadId: 'thread',
          runId: 'run',
          messages: [{ id: 'message', role: 'user', content: 'Review.' }],
          state: {},
          tools: [],
          context: [],
          forwardedProps: {},
        })
        .pipe(toArray()),
    );

  it('delivers the enabled local skills as a catalog and model tools', async () => {
    learning = new LearningStore(pool);
    const f = fixture(true);
    try {
      seededDots.add(f.dot.id);
      await learning.upsertSkill(f.dot.id, {
        name: 'evidence-review',
        body: '---\nname: evidence-review\ndescription: Review evidence before making claims.\n---\nCompare sources.',
      });
      await learning.upsertSkill(f.dot.id, {
        name: 'disabled-skill',
        body: 'Never delivered.',
        enabled: false,
      });
      const network = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          completion({ role: 'assistant', content: 'Ready.' }),
        );
      await run(f.agent);
      const request = String(network.mock.calls[0][1]?.body);
      expect(request).toContain('copilotkit_learned_skills');
      expect(request).toContain('evidence-review');
      expect(request).toContain('Review evidence before making claims.');
      expect(request).toContain('copilotkit_load_skill');
      expect(request).toContain('copilotkit_read_skill_file');
      // Disabled skills stay out of the catalog and the tool surface.
      expect(request).not.toContain('disabled-skill');
    } finally {
      f.workspace.close();
      f.store.close();
    }
  });

  it('delivers nothing when the Dot has no enabled skills', async () => {
    learning = new LearningStore(pool);
    const f = fixture(true);
    try {
      const network = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          completion({ role: 'assistant', content: 'Ready.' }),
        );
      await run(f.agent);
      const request = String(network.mock.calls[0][1]?.body);
      expect(request).not.toContain('copilotkit_learned_skills');
      expect(request).not.toContain('copilotkit_load_skill');
      expect(request).not.toContain('copilotkit_read_skill_file');
    } finally {
      f.workspace.close();
      f.store.close();
    }
  });

  it('never leaks one Dot’s skills to another', async () => {
    learning = new LearningStore(pool);
    const f = fixture(true);
    const other = f.workspace.createDot(
      f.dot.spaceId,
      'Other',
      'Another role.',
      true,
      true,
    );
    f.workspace.updateDot(other.id, {
      ...other,
      learningContainerId: 'other-set',
      skillDeliveryEnabled: true,
    });
    try {
      seededDots.add(f.dot.id).add(other.id);
      await learning.upsertSkill(f.dot.id, { name: 'dot-a-skill', body: 'A' });
      await learning.upsertSkill(other.id, {
        name: 'dot-b-skill',
        body: 'B',
      });
      const network = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          completion({ role: 'assistant', content: 'Ready.' }),
        );
      await run(f.agent);
      const request = String(network.mock.calls[0][1]?.body);
      expect(request).toContain('dot-a-skill');
      expect(request).not.toContain('dot-b-skill');
    } finally {
      f.workspace.close();
      f.store.close();
    }
  });

  it('delivers nothing when skill delivery is disabled for the Dot', async () => {
    learning = new LearningStore(pool);
    const f = fixture(false);
    try {
      seededDots.add(f.dot.id);
      await learning.upsertSkill(f.dot.id, {
        name: 'evidence-review',
        body: 'Should not be delivered.',
      });
      const network = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          completion({ role: 'assistant', content: 'Ready.' }),
        );
      await run(f.agent);
      const request = String(network.mock.calls[0][1]?.body);
      expect(request).not.toContain('evidence-review');
      expect(request).not.toContain('copilotkit_load_skill');
      expect(request).not.toContain('copilotkit_read_skill_file');
    } finally {
      f.workspace.close();
      f.store.close();
    }
  });
});
