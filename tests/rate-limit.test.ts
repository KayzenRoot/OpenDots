import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter, clientKey } from '../src/server/rate-limit.js';

/** Controllable clock so window behaviour is deterministic. */
function clock(start = 0) {
  let value = start;
  return { now: () => value, advance: (ms: number) => (value += ms) };
}

describe('FixedWindowLimiter', () => {
  it('allows up to the limit and then refuses', () => {
    const limiter = new FixedWindowLimiter(3, 1000, clock().now);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    const refused = limiter.check('a');
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
  });

  it('never advises a zero-second retry, which would invite a retry storm', () => {
    const limiter = new FixedWindowLimiter(1, 5000, clock().now);
    limiter.check('a');
    const refused = limiter.check('a');
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('resets once the window elapses', () => {
    const c = clock();
    const limiter = new FixedWindowLimiter(1, 1000, c.now);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    c.advance(1001);
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('counts each key separately, so one noisy client cannot lock out another', () => {
    const limiter = new FixedWindowLimiter(1, 1000, clock().now);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('forgets expired windows so memory tracks live traffic', () => {
    const c = clock();
    const limiter = new FixedWindowLimiter(5, 1000, c.now);
    for (let i = 0; i < 50; i++) limiter.check(`key-${i}`);
    expect(limiter.size).toBe(50);
    c.advance(1001);
    limiter.check('later');
    expect(limiter.size).toBe(1);
  });

  it('rejects a nonsensical configuration instead of silently disabling itself', () => {
    expect(() => new FixedWindowLimiter(0, 1000)).toThrow('at least 1');
    expect(() => new FixedWindowLimiter(1, 0)).toThrow('positive');
  });
});

describe('clientKey', () => {
  it('uses the first forwarded hop', () => {
    expect(
      clientKey(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })),
    ).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip and then to a constant', () => {
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe(
      '198.51.100.2',
    );
    expect(clientKey(new Headers())).toBe('unknown');
  });
});

describe('blocked (inspection without consumption)', () => {
  it('reports a blocked key without charging an attempt', () => {
    const limiter = new FixedWindowLimiter(2, 1000, clock().now);
    expect(limiter.blocked('a')).toBe(false);
    limiter.check('a');
    expect(limiter.blocked('a')).toBe(false);
    limiter.check('a');
    expect(limiter.blocked('a')).toBe(true);
    // Repeated inspection must not extend the block.
    expect(limiter.blocked('a')).toBe(true);
    expect(limiter.blocked('a')).toBe(true);
  });

  it('leaves unrelated keys alone', () => {
    const limiter = new FixedWindowLimiter(1, 1000, clock().now);
    limiter.check('a');
    expect(limiter.blocked('a')).toBe(true);
    expect(limiter.blocked('b')).toBe(false);
  });
});
