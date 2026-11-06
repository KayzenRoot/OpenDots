import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { Pool } from 'pg';
import { createPool, migrate } from '../src/server/pg.js';
import { LearningStore } from '../src/server/learning-store.js';

const databaseUrl = process.env.NEXBOT_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('LearningStore (PostgreSQL)', () => {
  let pool: Pool;
  let store: LearningStore;
  // Skills are keyed by Dot id, so tests inside this file use a private id
  // prefix and clean up only their own rows. This avoids truncating the shared
  // `skills` table while other Postgres test files run in parallel.
  const dotA = 'ls-dot-a';
  const dotB = 'ls-dot-b';
  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM skills WHERE dot_id LIKE 'ls-%'");
    store = new LearningStore(pool);
  });
  afterEach(async () => {
    await pool.query("DELETE FROM skills WHERE dot_id LIKE 'ls-%'");
  });

  it('inserts a skill at revision 1 and reads it back', async () => {
    const created = await store.upsertSkill(dotA, {
      name: 'evidence-review',
      body: '# Evidence\n\nCompare sources.',
    });
    expect(created).toMatchObject({
      dotId: dotA,
      name: 'evidence-review',
      revision: 1,
      enabled: true,
    });
    expect(await store.getSkill(dotA, 'evidence-review')).toMatchObject({
      id: created.id,
      revision: 1,
    });
    expect(await store.getSkill(dotA, 'missing')).toBeNull();
    expect(await store.listSkills(dotA)).toHaveLength(1);
  });

  it('upserts by name, bumping the revision and preserving enabled', async () => {
    await store.upsertSkill(dotA, { name: 'notes', body: 'v1' });
    await store.setSkillEnabled(dotA, 'notes', false);
    const updated = await store.upsertSkill(dotA, {
      name: 'notes',
      body: 'v2',
    });
    expect(updated.revision).toBe(2);
    expect(updated.body).toBe('v2');
    // A content refresh must not silently re-enable a disabled skill.
    expect(updated.enabled).toBe(false);
    const third = await store.upsertSkill(dotA, { name: 'notes', body: 'v3' });
    expect(third.revision).toBe(3);
    expect(await store.listSkills(dotA)).toHaveLength(1);
  });

  it('filters the deliverable set to enabled skills in deterministic order', async () => {
    await store.upsertSkill(dotA, { name: 'zeta', body: 'Z' });
    await store.upsertSkill(dotA, { name: 'alpha', body: 'A' });
    await store.upsertSkill(dotA, {
      name: 'disabled',
      body: 'D',
      enabled: false,
    });
    const delivered = await store.deliverableSkills(dotA);
    expect(delivered.map((entry) => entry.name)).toEqual(['alpha', 'zeta']);
    await store.setSkillEnabled(dotA, 'alpha', false);
    expect((await store.deliverableSkills(dotA)).map((s) => s.name)).toEqual([
      'zeta',
    ]);
  });

  it('derives the catalog description from the stored body', async () => {
    await store.upsertSkill(dotA, {
      name: 'evidence-review',
      body: '---\nname: evidence-review\ndescription: Review evidence first.\n---\nCompare sources.',
    });
    const [delivered] = await store.deliverableSkills(dotA);
    expect(delivered.description).toBe('Review evidence first.');
    expect(delivered.body).toContain('Compare sources.');
  });

  it('deletes a skill and reports whether a row was removed', async () => {
    await store.upsertSkill(dotA, { name: 'notes', body: 'v1' });
    expect(await store.deleteSkill(dotA, 'notes')).toBe(true);
    expect(await store.deleteSkill(dotA, 'notes')).toBe(false);
    expect(await store.getSkill(dotA, 'notes')).toBeNull();
  });

  it('keeps per-Dot skill sets isolated', async () => {
    await store.upsertSkill(dotA, { name: 'shared-name', body: 'A' });
    await store.upsertSkill(dotB, { name: 'shared-name', body: 'B' });
    await store.upsertSkill(dotB, { name: 'only-b', body: 'B2' });
    expect((await store.deliverableSkills(dotA)).map((s) => s.name)).toEqual([
      'shared-name',
    ]);
    expect((await store.deliverableSkills(dotB)).map((s) => s.name)).toEqual([
      'only-b',
      'shared-name',
    ]);
    expect((await store.getSkill(dotA, 'shared-name'))?.body).toBe('A');
    expect((await store.getSkill(dotB, 'shared-name'))?.body).toBe('B');
  });

  it('writes a hand-authored skill as approved', async () => {
    const created = await store.upsertSkill(dotA, {
      name: 'notes',
      body: 'v1',
    });
    expect(created.status).toBe('approved');
    expect(created.rejectionReason).toBeNull();
    expect((await store.deliverableSkills(dotA)).map((s) => s.name)).toEqual([
      'notes',
    ]);
  });

  it('delivers a proposal only after approval, and not while disabled', async () => {
    const proposed = await store.proposeSkill(dotA, {
      name: 'suggested',
      body: 'Found in a conversation.',
    });
    expect(proposed).toMatchObject({ status: 'proposed', enabled: true });
    expect(await store.listProposals(dotA)).toHaveLength(1);
    // A proposal is never delivered, even though it is enabled.
    expect(await store.deliverableSkills(dotA)).toEqual([]);

    const approved = await store.approveSkill(dotA, 'suggested');
    expect(approved).toMatchObject({ status: 'approved' });
    expect(await store.listProposals(dotA)).toHaveLength(0);
    expect((await store.deliverableSkills(dotA)).map((s) => s.name)).toEqual([
      'suggested',
    ]);

    await store.setSkillEnabled(dotA, 'suggested', false);
    expect(await store.deliverableSkills(dotA)).toEqual([]);
  });

  it('remembers a rejection with a reason, and an upsert clears it', async () => {
    await store.proposeSkill(dotA, { name: 'noisy', body: 'Too specific.' });
    const rejected = await store.rejectSkill(dotA, 'noisy', 'Too specific.');
    expect(rejected).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Too specific.',
    });
    expect(await store.listProposals(dotA)).toHaveLength(0);
    expect(await store.deliverableSkills(dotA)).toEqual([]);

    const rewritten = await store.upsertSkill(dotA, {
      name: 'noisy',
      body: 'Now a durable rule.',
    });
    expect(rewritten).toMatchObject({
      status: 'approved',
      rejectionReason: null,
      revision: 2,
    });
  });

  it('drops a proposal whose name is already taken', async () => {
    await store.upsertSkill(dotA, { name: 'taken', body: 'Human authored.' });
    expect(
      await store.proposeSkill(dotA, { name: 'taken', body: 'Model idea.' }),
    ).toBeNull();
    expect((await store.getSkill(dotA, 'taken'))?.body).toBe('Human authored.');
  });
});
