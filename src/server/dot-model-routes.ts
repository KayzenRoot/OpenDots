import { Hono } from 'hono';
import { z } from 'zod';
import type { DotModelConfigStore, ModelConfigStore } from './model-config.js';
import { probeProvider } from './model-routes.js';
import type { WorkspaceStore } from './workspace.js';

const configSchema = z
  .object({
    baseUrl: z.string().trim().url().max(300),
    model: z.string().trim().min(1).max(120),
    apiKey: z.string().trim().min(8).max(300),
  })
  .strict();

/**
 * Per-Dot model overrides (WORK-030), mounted behind the owner middleware next
 * to the global model routes. Mirrors their test-before-save rule: a key the
 * provider rejects is never persisted. A Dot's override is reachable only by
 * its own id, so one Dot can never read or write another Dot's configuration.
 */
export function dotModelRoutes(
  dots: DotModelConfigStore,
  workspace: WorkspaceStore,
  globalConfig: Pick<ModelConfigStore, 'describe'>,
  fetcher: typeof fetch = fetch,
  extraHeaders: Record<string, string> = {},
) {
  const app = new Hono();
  const requireDot = (dotId: string) => workspace.dot(dotId) !== undefined;

  // The effective config for one Dot, and whether it is inherited. Never
  // returns the key: only the endpoint, model and whether a key is stored.
  app.get('/model/dot/:dotId', async (c) => {
    const dotId = c.req.param('dotId');
    if (!requireDot(dotId)) return c.json({ error: 'Dot not found.' }, 404);
    const override = await dots.describe(dotId);
    if (override) return c.json({ ...override, inherited: false });
    const inherited = globalConfig.describe();
    if (inherited) return c.json({ ...inherited, inherited: true });
    return c.json({ configured: false });
  });

  // Test first, then save, exactly like the global route. A key the provider
  // rejects is never persisted.
  app.put('/model/dot/:dotId', async (c) => {
    const dotId = c.req.param('dotId');
    if (!requireDot(dotId)) return c.json({ error: 'Dot not found.' }, 404);
    const parsed = configSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Check the base URL, model and key.' }, 400);
    const probe = await probeProvider(
      { ...parsed.data, extraHeaders },
      fetcher,
    );
    if (!probe.ok) return c.json({ error: probe.reason }, 422);
    await dots.save(dotId, parsed.data);
    return c.json({
      saved: true,
      baseUrl: parsed.data.baseUrl,
      model: parsed.data.model,
      hasKey: true,
      inherited: false,
    });
  });

  // Removing the override is idempotent: the Dot inherits the global provider.
  app.delete('/model/dot/:dotId', async (c) => {
    const dotId = c.req.param('dotId');
    if (!requireDot(dotId)) return c.json({ error: 'Dot not found.' }, 404);
    await dots.delete(dotId);
    return c.json({ ok: true });
  });

  // Probe a candidate without saving it (the "Test connection" button).
  app.post('/model/dot/:dotId/test', async (c) => {
    const dotId = c.req.param('dotId');
    if (!requireDot(dotId)) return c.json({ error: 'Dot not found.' }, 404);
    const parsed = configSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Check the base URL, model and key.' }, 400);
    const probe = await probeProvider(
      { ...parsed.data, extraHeaders },
      fetcher,
    );
    return probe.ok
      ? c.json({ ok: true })
      : c.json({ ok: false, error: probe.reason }, 422);
  });

  return app;
}
