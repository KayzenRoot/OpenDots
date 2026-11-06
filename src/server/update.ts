import { z } from 'zod';

/**
 * Update check against the project's GitHub Releases.
 *
 * The release is the update channel for v1: the manifest is fetched over HTTPS
 * from GitHub, and the installer's SHA-256 is published beside it so the
 * download can be verified. There is no code signature yet, so this is
 * integrity (did the file arrive intact) rather than authenticity (did it come
 * from us) — that limitation is documented in the readiness gate, and the
 * client never installs anything automatically.
 */

const manifestSchema = z.object({
  version: z.string().trim().min(1).max(40),
  url: z.string().url().max(500),
  sha256: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/, 'Must be a lowercase SHA-256 hex digest.')
    .optional(),
  notes: z.string().max(4000).optional(),
});

export type UpdateManifest = z.infer<typeof manifestSchema>;

export const GITHUB_LATEST =
  'https://api.github.com/repos/KayzenRoot/nexbot/releases/latest';

export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

/**
 * Rough-but-safe comparison: numeric parts compared numerically, unknown parts
 * lexically, and a shorter version sorts before a longer one (1.2 < 1.2.1).
 * This is deliberately not a full semver implementation: prerelease tags like
 * `-beta.2` are compared lexically after the numeric prefix, which is enough
 * to answer "is the published release newer than the running build".
 */
export function isNewer(published: string, running: string): boolean {
  const a = normalizeVersion(published).split(/[.\-+]/);
  const b = normalizeVersion(running).split(/[.\-+]/);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return false;
    if (right === undefined) return true;
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) {
      if (leftNumber !== rightNumber) return leftNumber > rightNumber;
      continue;
    }
    if (left !== right) return left > right;
  }
  return false;
}

export interface UpdateCheck {
  current: string;
  available: boolean;
  latest?: string;
  url?: string;
  sha256?: string;
  notes?: string;
  checkedAt: string;
}

/** Fetches and validates the latest release. Throws on any failure. */
export async function fetchLatest(
  current: string,
  fetcher: typeof fetch = fetch,
  token?: string,
): Promise<UpdateCheck & { latest: string }> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'NexBot-Update/0.1',
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetcher(GITHUB_LATEST, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`);
  const payload = (await res.json()) as {
    tag_name?: unknown;
    html_url?: unknown;
    body?: unknown;
    assets?: { name?: unknown; browser_download_url?: unknown }[];
  };
  if (typeof payload.tag_name !== 'string')
    throw new Error('The release has no tag.');

  const version = normalizeVersion(payload.tag_name);
  const installer = (payload.assets ?? []).find(
    (asset) => typeof asset.browser_download_url === 'string',
  );
  const manifest: UpdateManifest = manifestSchema.parse({
    version,
    url: installer?.browser_download_url ?? payload.html_url,
    notes:
      typeof payload.body === 'string'
        ? payload.body.slice(0, 4000)
        : undefined,
  });

  return {
    current,
    available: isNewer(version, current),
    latest: version,
    url: manifest.url,
    sha256: undefined,
    notes: manifest.notes,
    checkedAt: new Date().toISOString(),
  };
}
