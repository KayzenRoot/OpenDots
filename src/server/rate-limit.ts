/**
 * In-process fixed-window rate limiter.
 *
 * Deliberately small and dependency-free. It protects a single-node deployment,
 * which is what this stack is: the reverse proxy and the app run on the same
 * host and the app binds to loopback. A multi-replica deployment would need a
 * shared store instead, and that limitation is stated in the docs rather than
 * hidden behind a class name.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds the caller should wait before retrying; 0 when allowed. */
  retryAfterSeconds: number;
  /** Requests still available in the current window. */
  remaining: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (max < 1) throw new Error('Rate limit max must be at least 1.');
    if (windowMs < 1) throw new Error('Rate limit window must be positive.');
  }

  check(key: string): RateLimitDecision {
    const now = this.now();
    this.prune(now);
    const current = this.hits.get(key);
    if (!current || now >= current.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0, remaining: this.max - 1 };
    }
    if (current.count >= this.max) {
      return {
        allowed: false,
        // Never report 0: Retry-After: 0 invites an immediate retry storm.
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.resetAt - now) / 1000),
        ),
        remaining: 0,
      };
    }
    current.count += 1;
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: this.max - current.count,
    };
  }

  /** Drop expired windows so memory stays bounded by live traffic only. */
  private prune(now: number): void {
    for (const [key, window] of this.hits)
      if (now >= window.resetAt) this.hits.delete(key);
  }

  /**
   * Report whether a key is currently over the limit without consuming an
   * attempt. Lets a caller gate on failures it has already counted, so ordinary
   * successful traffic is never charged against the allowance.
   */
  blocked(key: string): boolean {
    const now = this.now();
    const current = this.hits.get(key);
    return !!current && now < current.resetAt && current.count >= this.max;
  }

  get size(): number {
    return this.hits.size;
  }
}

/**
 * Best-effort client identity. The stack runs behind its own reverse proxy, and
 * the app port is bound to loopback, so `x-forwarded-for` cannot be reached by
 * an untrusted client: only the proxy can reach the app at all. The first entry
 * is the original client as recorded by that proxy.
 */
export function clientKey(
  headers: Headers | { get(name: string): string | null },
): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
