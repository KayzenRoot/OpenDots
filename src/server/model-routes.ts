import { Hono } from 'hono';
import { z } from 'zod';
import type { ModelConfigStore } from './model-config.js';

const configSchema = z
  .object({
    baseUrl: z.string().trim().url().max(300),
    model: z.string().trim().min(1).max(120),
    apiKey: z.string().trim().min(8).max(300),
  })
  .strict();

export interface ProbeConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Routing headers the gateway needs, e.g. OpenCode Go's x-opencode-session. */
  extraHeaders?: Record<string, string>;
}

/** Provider reachability: a one-token completion. Errors are reduced to a safe message. */
export async function probeProvider(
  config: ProbeConfig,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
  try {
    const res = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        // Without the gateway's routing header the request is refused with 400,
        // which would wrongly look like a bad key. Send the same headers as runtime.
        ...(config.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 4,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403)
      return { ok: false, reason: 'The provider rejected this key.' };
    if (res.status === 404)
      return {
        ok: false,
        reason:
          'Endpoint or model not found. Check the base URL and model name.',
      };
    return { ok: false, reason: `The provider answered HTTP ${res.status}.` };
  } catch {
    return {
      ok: false,
      reason:
        'Could not reach the provider. Check the base URL and your connection.',
    };
  }
}

export function modelRoutes(
  store: ModelConfigStore,
  fetcher: typeof fetch = fetch,
  extraHeaders: Record<string, string> = {},
) {
  const app = new Hono();

  // Never returns the key: only the endpoint, model and whether a key is stored.
  app.get('/model', (c) => c.json(store.describe() ?? { configured: false }));

  // Test first, then save. A key the provider rejects is never persisted.
  app.put('/model', async (c) => {
    const parsed = configSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Check the base URL, model and key.' }, 400);
    const probe = await probeProvider(
      { ...parsed.data, extraHeaders },
      fetcher,
    );
    if (!probe.ok) return c.json({ error: probe.reason }, 422);
    store.save(parsed.data);
    return c.json({
      saved: true,
      baseUrl: parsed.data.baseUrl,
      model: parsed.data.model,
      hasKey: true,
    });
  });

  // Test a candidate without saving it (the "Test connection" button).
  app.post('/model/test', async (c) => {
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
