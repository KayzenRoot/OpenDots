import { createHmac, timingSafeEqual } from 'node:crypto';

/** Slack rejects/replays requests outside a five-minute window. */
export const SLACK_MAX_SKEW_MS = 5 * 60 * 1000;

export interface SlackSignatureInput {
  /** `SLACK_SIGNING_SECRET`; empty means the route cannot authenticate. */
  signingSecret: string | undefined;
  /** The `x-slack-request-timestamp` header. */
  timestamp: string | undefined;
  /** The `x-slack-signature` header, e.g. `v0=abcdef...`. */
  signature: string | undefined;
  /** The exact, unparsed request body. */
  body: string;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Verify a Slack Events API request signature.
 *
 * The signing secret is never logged and is only ever used as an HMAC key. The
 * comparison is constant time and the timestamp must be within
 * {@link SLACK_MAX_SKEW_MS}, which is the replay protection Slack documents.
 * The body must be verified before it is parsed.
 */
export function verifySlackSignature(input: SlackSignatureInput): boolean {
  const { signingSecret, timestamp, signature, body } = input;
  if (!signingSecret || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const now = input.now ?? Date.now();
  const sentAt = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > SLACK_MAX_SKEW_MS)
    return false;
  const expected = `v0=${createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(signature);
  // `timingSafeEqual` throws on length mismatch; the signature length is a fixed
  // public format, so an early length check leaks nothing secret.
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
