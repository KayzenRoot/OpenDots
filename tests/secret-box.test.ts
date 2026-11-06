import { describe, expect, it } from 'vitest';
import { generateMasterKey, open, seal } from '../src/server/secret-box.js';

describe('secret-box', () => {
  it('round-trips a provider key', () => {
    const key = generateMasterKey();
    const sealed = seal('sk-test-1234567890', key);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('sk-test');
    expect(open(sealed, key)).toBe('sk-test-1234567890');
  });

  it('uses a fresh IV, so equal plaintexts seal differently', () => {
    const key = generateMasterKey();
    expect(seal('same', key)).not.toBe(seal('same', key));
  });

  it('rejects a wrong key with a generic error', () => {
    const sealed = seal('secret', generateMasterKey());
    expect(() => open(sealed, generateMasterKey())).toThrow(
      'Secret could not be opened.',
    );
  });

  it('rejects any tampered byte (GCM authentication)', () => {
    const key = generateMasterKey();
    const sealed = seal('secret', key);
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3], 'base64url');
    body[0] ^= 0x01;
    parts[3] = body.toString('base64url');
    expect(() => open(parts.join('.'), key)).toThrow(
      'Secret could not be opened.',
    );
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => seal('x', Buffer.alloc(16))).toThrow('32 bytes');
  });

  it('refuses unknown envelope versions', () => {
    expect(() => open('v9.a.b.c', generateMasterKey())).toThrow('Unrecognised');
  });
});
