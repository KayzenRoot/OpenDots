import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { WorkspaceStore } from '../src/server/workspace.js';
import { LEARNING_PASSES_PER_HOUR } from '../src/server/learning-pass.js';
import { skillRoutes, type SkillCatalog } from '../src/server/skill-routes.js';
import type {
  SkillRecord,
  SkillStatus,
  UpsertSkillInput,
} from '../src/server/learning-store.js';

/**
 * An in-memory `SkillCatalog` that stores rows per Dot, mirroring the Postgres
 * store's contract. It lets the whole HTTP contract (validation, isolation,
 * idempotency, status transitions) be verified without a live database.
 * `seed` is a test-only shortcut for planting a proposal.
 */
class MemoryCatalog implements SkillCatalog {
  private rows = new Map<string, SkillRecord>();
  /** Number of passes recorded per Dot; a test seeds it directly. */
  readonly passes = new Map<string, number>();
  private key(dotId: string, name: string) {
    return `${dotId}\u0000${name}`;
  }
  private list(dotId: string) {
    return [...this.rows.values()]
      .filter((row) => row.dotId === dotId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }
  async listSkills(dotId: string) {
    return this.list(dotId);
  }
  async listProposals(dotId: string) {
    return this.list(dotId).filter((row) => row.status === 'proposed');
  }
  async getSkill(dotId: string, name: string) {
    return this.rows.get(this.key(dotId, name)) ?? null;
  }
  async upsertSkill(dotId: string, input: UpsertSkillInput) {
    const existing = this.rows.get(this.key(dotId, input.name));
    const now = new Date().toISOString();
    const record: SkillRecord = existing
      ? {
          ...existing,
          body: input.body,
          revision: existing.revision + 1,
          status: 'approved',
          rejectionReason: null,
          source: 'manual',
          conversationId: null,
          model: null,
          updatedAt: now,
        }
      : {
          id: `${dotId}:${input.name}`,
          dotId,
          name: input.name,
          body: input.body,
          revision: 1,
          enabled: input.enabled ?? true,
          status: 'approved',
          rejectionReason: null,
          source: 'manual',
          conversationId: null,
          model: null,
          createdAt: now,
          updatedAt: now,
        };
    this.rows.set(this.key(dotId, input.name), record);
    return record;
  }
  async setSkillEnabled(dotId: string, name: string, enabled: boolean) {
    const existing = this.rows.get(this.key(dotId, name));
    if (!existing) return null;
    const next = { ...existing, enabled, updatedAt: new Date().toISOString() };
    this.rows.set(this.key(dotId, name), next);
    return next;
  }
  async approveSkill(dotId: string, name: string) {
    const existing = this.rows.get(this.key(dotId, name));
    if (!existing) return null;
    const next: SkillRecord = {
      ...existing,
      status: 'approved',
      rejectionReason: null,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(this.key(dotId, name), next);
    return next;
  }
  async rejectSkill(dotId: string, name: string, reason: string) {
    const existing = this.rows.get(this.key(dotId, name));
    if (!existing) return null;
    const next: SkillRecord = {
      ...existing,
      status: 'rejected',
      rejectionReason: reason,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(this.key(dotId, name), next);
    return next;
  }
  async deleteSkill(dotId: string, name: string) {
    return this.rows.delete(this.key(dotId, name));
  }
  async countPassesSince(dotId: string) {
    return this.passes.get(dotId) ?? 0;
  }
  /** Test helper: plant a row with an explicit status. */
  seed(
    dotId: string,
    name: string,
    body: string,
    status: SkillStatus = 'proposed',
  ) {
    const now = new Date().toISOString();
    this.rows.set(this.key(dotId, name), {
      id: `${dotId}:${name}`,
      dotId,
      name,
      body,
      revision: 1,
      enabled: true,
      status,
      rejectionReason: null,
      source: status === 'approved' ? 'manual' : 'learning',
      conversationId: status === 'approved' ? null : 'thread-1',
      model: status === 'approved' ? null : 'test-model',
      createdAt: now,
      updatedAt: now,
    });
  }
}

const setup = () => {
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const spaceId = workspace.spaces()[0].id;
  const dotA = workspace.createDot(spaceId, 'A', '', true, true).id;
  const dotB = workspace.createDot(spaceId, 'B', '', true, true).id;
  const catalog = new MemoryCatalog();
  const app = new Hono().route('/api', skillRoutes(workspace, catalog));
  return {
    app,
    catalog,
    dotA,
    dotB,
    workspace,
    close: () => workspace.close(),
  };
};

const request = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const json = async (response: Response) => response.json();

describe('skill routes', () => {
  it('requires a Dot that exists', async () => {
    const f = setup();
    try {
      expect((await f.app.request('/api/skills')).status).toBe(400);
      expect((await f.app.request('/api/skills?dotId=missing')).status).toBe(
        404,
      );
      expect(
        (
          await f.app.request(
            '/api/skills/notes',
            request('PUT', { body: 'x' }),
          )
        ).status,
      ).toBe(400);
    } finally {
      f.close();
    }
  });

  it('never lets one Dot see or change another Dot’s skills', async () => {
    const f = setup();
    try {
      const put = await f.app.request(
        `/api/skills/shared?dotId=${f.dotA}`,
        request('PUT', { body: 'A body' }),
      );
      expect(put.status).toBe(201);

      // Invisible through Dot B.
      const listB = await json(
        await f.app.request(`/api/skills?dotId=${f.dotB}`),
      );
      expect(listB.skills).toEqual([]);
      expect(listB.proposals).toEqual([]);
      expect(
        (await f.app.request(`/api/skills/shared?dotId=${f.dotB}`)).status,
      ).toBe(404);

      // Immutable through Dot B.
      expect(
        (
          await f.app.request(
            `/api/skills/shared?dotId=${f.dotB}`,
            request('PATCH', { action: 'disable' }),
          )
        ).status,
      ).toBe(404);
      const removed = await json(
        await f.app.request(
          `/api/skills/shared?dotId=${f.dotB}`,
          request('DELETE'),
        ),
      );
      expect(removed).toEqual({ ok: true, deleted: false });
      expect(await f.catalog.getSkill(f.dotA, 'shared')).toMatchObject({
        body: 'A body',
        enabled: true,
      });

      // A skill of the same name under B is a separate row.
      await f.app.request(
        `/api/skills/shared?dotId=${f.dotB}`,
        request('PUT', { body: 'B body' }),
      );
      expect(await f.catalog.getSkill(f.dotA, 'shared')).toMatchObject({
        body: 'A body',
      });
      expect(await f.catalog.getSkill(f.dotB, 'shared')).toMatchObject({
        body: 'B body',
      });
    } finally {
      f.close();
    }
  });

  it('caps the body at 32 KB', async () => {
    const f = setup();
    try {
      const big = await f.app.request(
        `/api/skills/big?dotId=${f.dotA}`,
        request('PUT', { body: 'a'.repeat(32 * 1024 + 1) }),
      );
      expect(big.status).toBe(400);
      const atLimit = await f.app.request(
        `/api/skills/limit?dotId=${f.dotA}`,
        request('PUT', { body: 'a'.repeat(32 * 1024) }),
      );
      expect(atLimit.status).toBe(201);
    } finally {
      f.close();
    }
  });

  it('validates the name as a safe identifier', async () => {
    const f = setup();
    try {
      for (const name of ['Bad_Name', '-leading', 'UPPER', 'a'.repeat(65)]) {
        const res = await f.app.request(
          `/api/skills/${encodeURIComponent(name)}?dotId=${f.dotA}`,
          request('PUT', { body: 'x' }),
        );
        expect(res.status, name).toBe(400);
      }
      for (const name of ['ok', 'a-1', 'a'.repeat(64)]) {
        const res = await f.app.request(
          `/api/skills/${name}?dotId=${f.dotA}`,
          request('PUT', { body: 'x' }),
        );
        expect(res.status, name).toBe(201);
      }
    } finally {
      f.close();
    }
  });

  it('rejects an unknown action or field instead of ignoring it', async () => {
    const f = setup();
    try {
      await f.app.request(
        `/api/skills/notes?dotId=${f.dotA}`,
        request('PUT', { body: 'x' }),
      );
      expect(
        (
          await f.app.request(
            `/api/skills/notes?dotId=${f.dotA}`,
            request('PATCH', { action: 'archive' }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await f.app.request(
            `/api/skills/notes?dotId=${f.dotA}`,
            request('PATCH', { action: 'enable', extra: true }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await f.app.request(
            `/api/skills/notes?dotId=${f.dotA}`,
            request('PUT', { body: 'x', extra: true }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await f.app.request(
            `/api/skills/notes?dotId=${f.dotA}`,
            request('PUT', {}),
          )
        ).status,
      ).toBe(400);
    } finally {
      f.close();
    }
  });

  it('requires a reason to reject and remembers it', async () => {
    const f = setup();
    try {
      f.catalog.seed(f.dotA, 'suggested', 'Do a thing.');
      expect(
        (
          await f.app.request(
            `/api/skills/suggested?dotId=${f.dotA}`,
            request('PATCH', { action: 'reject' }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await f.app.request(
            `/api/skills/suggested?dotId=${f.dotA}`,
            request('PATCH', { action: 'reject', reason: '   ' }),
          )
        ).status,
      ).toBe(400);
      const rejected = await json(
        await f.app.request(
          `/api/skills/suggested?dotId=${f.dotA}`,
          request('PATCH', { action: 'reject', reason: 'Too specific.' }),
        ),
      );
      expect(rejected).toMatchObject({
        status: 'rejected',
        rejectionReason: 'Too specific.',
      });
    } finally {
      f.close();
    }
  });

  it('separates approved skills from proposals and moves them on approval', async () => {
    const f = setup();
    try {
      await f.app.request(
        `/api/skills/manuel?dotId=${f.dotA}`,
        request('PUT', { body: 'Approved by hand.' }),
      );
      f.catalog.seed(f.dotA, 'suggested', 'A proposal body.');
      const before = await json(
        await f.app.request(`/api/skills?dotId=${f.dotA}`),
      );
      expect(before.skills.map((s: SkillRecord) => s.name)).toEqual(['manuel']);
      expect(before.proposals.map((s: SkillRecord) => s.name)).toEqual([
        'suggested',
      ]);
      expect(before.skills[0].description).toBe('Approved by hand.');
      await f.app.request(
        `/api/skills/suggested?dotId=${f.dotA}`,
        request('PATCH', { action: 'approve' }),
      );
      const after = await json(
        await f.app.request(`/api/skills?dotId=${f.dotA}`),
      );
      expect(after.skills.map((s: SkillRecord) => s.name)).toEqual([
        'manuel',
        'suggested',
      ]);
      expect(after.proposals).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('returns one skill with its full body and 404s when absent', async () => {
    const f = setup();
    try {
      await f.app.request(
        `/api/skills/full?dotId=${f.dotA}`,
        request('PUT', { body: 'Line one.\nLine two.' }),
      );
      const found = await json(
        await f.app.request(`/api/skills/full?dotId=${f.dotA}`),
      );
      expect(found.body).toBe('Line one.\nLine two.');
      expect(
        (await f.app.request(`/api/skills/full?dotId=${f.dotB}`)).status,
      ).toBe(404);
    } finally {
      f.close();
    }
  });

  it('toggles enabled and reports a missing skill on patch', async () => {
    const f = setup();
    try {
      await f.app.request(
        `/api/skills/toggle?dotId=${f.dotA}`,
        request('PUT', { body: 'x' }),
      );
      const disabled = await json(
        await f.app.request(
          `/api/skills/toggle?dotId=${f.dotA}`,
          request('PATCH', { action: 'disable' }),
        ),
      );
      expect(disabled.enabled).toBe(false);
      const enabled = await json(
        await f.app.request(
          `/api/skills/toggle?dotId=${f.dotA}`,
          request('PATCH', { action: 'enable' }),
        ),
      );
      expect(enabled.enabled).toBe(true);
      expect(
        (
          await f.app.request(
            `/api/skills/absent?dotId=${f.dotA}`,
            request('PATCH', { action: 'enable' }),
          )
        ).status,
      ).toBe(404);
    } finally {
      f.close();
    }
  });

  it('delete is idempotent', async () => {
    const f = setup();
    try {
      await f.app.request(
        `/api/skills/gone?dotId=${f.dotA}`,
        request('PUT', { body: 'x' }),
      );
      const first = await json(
        await f.app.request(
          `/api/skills/gone?dotId=${f.dotA}`,
          request('DELETE'),
        ),
      );
      expect(first).toEqual({ ok: true, deleted: true });
      const second = await f.app.request(
        `/api/skills/gone?dotId=${f.dotA}`,
        request('DELETE'),
      );
      expect(second.status).toBe(200);
      expect(await json(second)).toEqual({ ok: true, deleted: false });
    } finally {
      f.close();
    }
  });

  it('exposes and toggles automatic learning per Dot', async () => {
    const f = setup();
    try {
      const initial = await json(
        await f.app.request(`/api/learning?dotId=${f.dotA}`),
      );
      expect(initial).toEqual({
        enabled: false,
        passesLastHour: 0,
        passesPerHour: LEARNING_PASSES_PER_HOUR,
      });

      f.catalog.passes.set(f.dotA, 2);
      const enabled = await json(
        await f.app.request(
          `/api/learning?dotId=${f.dotA}`,
          request('PATCH', { enabled: true }),
        ),
      );
      expect(enabled).toEqual({
        enabled: true,
        passesLastHour: 2,
        passesPerHour: LEARNING_PASSES_PER_HOUR,
      });
      expect(f.workspace.dot(f.dotA)?.learningEnabled).toBe(true);
      expect(f.workspace.dot(f.dotB)?.learningEnabled).toBe(false);

      const disabled = await json(
        await f.app.request(
          `/api/learning?dotId=${f.dotA}`,
          request('PATCH', { enabled: false }),
        ),
      );
      expect(disabled.enabled).toBe(false);
      expect(f.workspace.dot(f.dotA)?.learningEnabled).toBe(false);
    } finally {
      f.close();
    }
  });

  it('validates the learning toggle strictly and requires a Dot', async () => {
    const f = setup();
    try {
      for (const body of [{ enabled: 'yes' }, { enabled: true, extra: 1 }, {}])
        expect(
          (
            await f.app.request(
              `/api/learning?dotId=${f.dotA}`,
              request('PATCH', body),
            )
          ).status,
          JSON.stringify(body),
        ).toBe(400);
      expect((await f.app.request('/api/learning')).status).toBe(400);
      expect((await f.app.request('/api/learning?dotId=missing')).status).toBe(
        404,
      );
    } finally {
      f.close();
    }
  });

  it('reports where a proposal came from', async () => {
    const f = setup();
    try {
      f.catalog.seed(f.dotA, 'suggested', 'A proposal body.');
      const payload = await json(
        await f.app.request(`/api/skills?dotId=${f.dotA}`),
      );
      expect(payload.proposals[0]).toMatchObject({
        name: 'suggested',
        status: 'proposed',
        source: 'learning',
        conversationId: 'thread-1',
        model: 'test-model',
      });
      expect(typeof payload.proposals[0].createdAt).toBe('string');
    } finally {
      f.close();
    }
  });

  it('bumps the revision on update', async () => {
    const f = setup();
    try {
      const created = await json(
        await f.app.request(
          `/api/skills/rev?dotId=${f.dotA}`,
          request('PUT', { body: 'v1' }),
        ),
      );
      expect(created.revision).toBe(1);
      const updated = await json(
        await f.app.request(
          `/api/skills/rev?dotId=${f.dotA}`,
          request('PUT', { body: 'v2' }),
        ),
      );
      expect(updated.revision).toBe(2);
    } finally {
      f.close();
    }
  });
});
