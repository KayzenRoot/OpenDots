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

const databaseUrl = process.env.OPENDOTS_TEST_DATABASE_URL;
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
});
