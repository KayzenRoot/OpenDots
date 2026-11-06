import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// AES-256-GCM envelope for secrets at rest (provider API keys).
// Format: v1.<iv>.<tag>.<ciphertext>, all base64url. The key is 32 random bytes
// kept in a separate file, never in the database that holds the ciphertext.

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function generateMasterKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function seal(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new Error('Master key must be 32 bytes.');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export function open(envelope: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new Error('Master key must be 32 bytes.');
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION)
    throw new Error('Unrecognised secret format.');
  const [, ivB64, tagB64, bodyB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const body = Buffer.from(bodyB64, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== 16)
    throw new Error('Malformed secret envelope.');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    // Do not reveal why: a wrong key and a tampered envelope look the same.
    throw new Error('Secret could not be opened.');
  }
}

/** Constant-time comparison for a short token check, without leaking length. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
