import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { fetchLatest, type UpdateCheck } from './update.js';

const require_ = createRequire(import.meta.url);
const runningVersion: string =
  require_('../../package.json').version ?? '0.0.0';

/**
 * The check is cached: a UI poll every minute must not turn into a GitHub API
 * call every minute. One outbound check per hour is plenty for a channel whose
 * releases are a few per month.
 */
export class UpdateChecker {
  private last?: UpdateCheck;
  private checkedAt = 0;
  constructor(
    private readonly fetcher: typeof fetch,
    private readonly token?: string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 60 * 60 * 1000,
  ) {}

  async check(): Promise<UpdateCheck> {
    if (this.last && this.now() - this.checkedAt < this.ttlMs) return this.last;
    const result = await fetchLatest(runningVersion, this.fetcher, this.token);
    this.last = result;
    this.checkedAt = this.now();
    return result;
  }

  get currentVersion(): string {
    return runningVersion;
  }
}

export function updateRoutes(checker: UpdateChecker) {
  const app = new Hono();

  // Report-only by design: the app never downloads or installs anything. The
  // operator reads the note, downloads the installer from the release page and
  // runs it — the same path as the first install, so the upgrade is confirmed
  // by a person, which is the v1 position given there is no code signature yet.
  app.get('/update', async (c) => {
    try {
      const result = await checker.check();
      return c.json({ ...result, error: undefined });
    } catch (error) {
      return c.json({
        current: checker.currentVersion,
        available: false,
        checkedAt: new Date().toISOString(),
        error:
          error instanceof Error ? error.message : 'The update check failed.',
      });
    }
  });

  return app;
}
