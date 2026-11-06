import { timingSafeEqual } from 'node:crypto';

export interface TelegramSecretTokenInput {
  /** `TELEGRAM_WEBHOOK_SECRET`; absent means the route cannot authenticate. */
  expected: string | undefined;
  /** The `X-Telegram-Bot-Api-Secret-Token` header. */
  supplied: string | undefined;
}

/**
 * Verify a Telegram webhook request against the shared secret token.
 *
 * Unlike Slack, Telegram does not sign the body: the operator sets a secret
 * token when registering the webhook (`setWebhook`'s `secret_token`, 1-256
 * characters of `A-Za-z0-9_-`) and Telegram echoes it back in the
 * `X-Telegram-Bot-Api-Secret-Token` header on every delivery. The comparison
 * is constant time. An absent expected value returns false for every request,
 * so a deployment without `TELEGRAM_WEBHOOK_SECRET` rejects everything rather
 * than trusting unauthenticated webhooks.
 */
export function verifyTelegramSecretToken(
  input: TelegramSecretTokenInput,
): boolean {
  const { expected, supplied } = input;
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  // `timingSafeEqual` throws on length mismatch; the length is public webhook
  // metadata, so an early length check leaks nothing secret.
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
