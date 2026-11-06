import { describe, expect, it, vi } from 'vitest';
import {
  fetchLatest,
  isNewer,
  normalizeVersion,
} from '../src/server/update.js';
import { UpdateChecker } from '../src/server/update-routes.js';

const base = {
  tag_name: 'v0.2.0',
  html_url: 'https://github.com/KayzenRoot/nexbot/releases/tag/v0.2.0',
  body: 'Notes',
  assets: [
    {
      name: 'NexBot-Setup.exe',
      browser_download_url:
        'https://github.com/KayzenRoot/nexbot/releases/download/v0.2.0/NexBot-Setup.exe',
    },
  ],
};

const github = (payload: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(payload), { status })) as typeof fetch;

describe('isNewer', () => {
  it('compares numerically, so 0.10.0 is newer than 0.9.9', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.9.9', '0.10.0')).toBe(false);
  });

  it('treats equal versions as not newer', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
  });

  it('treats a shorter version as older (1.2 < 1.2.1)', () => {
    expect(isNewer('1.2.1', '1.2')).toBe(true);
  });

  it('ignores a leading v on either side', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.2.0', 'v0.1.0')).toBe(true);
  });
});

describe('normalizeVersion', () => {
  it('strips a leading v and whitespace', () => {
    expect(normalizeVersion(' v1.2.3 ')).toBe('1.2.3');
  });
});

describe('fetchLatest', () => {
  it('returns the latest version, download URL and availability', async () => {
    const check = await fetchLatest('0.1.0', github(base));
    expect(check.latest).toBe('0.2.0');
    expect(check.available).toBe(true);
    expect(check.url).toContain('releases/download/v0.2.0/NexBot-Setup.exe');
    expect(check.notes).toBe('Notes');
  });

  it('does not treat the running version as an update', async () => {
    const check = await fetchLatest('0.2.0', github(base));
    expect(check.available).toBe(false);
  });

  it('refuses a release without a tag', async () => {
    await expect(
      fetchLatest('0.1.0', github({ no_tag: true })),
    ).rejects.toThrow(/no tag/);
  });

  it('surfaces the HTTP status instead of a raw body', async () => {
    await expect(fetchLatest('0.1.0', github({}, 403))).rejects.toThrow(
      'HTTP 403',
    );
  });

  it('does not include the release body when it is not a string', async () => {
    const check = await fetchLatest('0.1.0', github({ ...base, body: 42 }));
    expect(check.notes).toBeUndefined();
  });
});

describe('UpdateChecker', () => {
  it('caches the check so a UI poll does not hit GitHub every minute', async () => {
    const fetcher = vi.fn(github(base));
    let now = 1000;
    const checker = new UpdateChecker(fetcher, undefined, () => now, 60_000);
    await checker.check();
    await checker.check();
    await checker.check();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 60_001;
    await checker.check();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports the running version alongside the latest', async () => {
    const checker = new UpdateChecker(github(base), undefined, () => 1000, 1);
    const check = await checker.check();
    expect(check.current).toBe('0.1.0');
  });
});
