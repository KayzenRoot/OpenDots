import { describe, expect, it } from 'vitest';
import { extraHeadersFromEnv } from '../src/server/platform-config.js';

describe('extraHeadersFromEnv', () => {
  it('returns undefined when unset or blank', () => {
    expect(extraHeadersFromEnv({})).toBeUndefined();
    expect(
      extraHeadersFromEnv({ OPENAI_EXTRA_HEADERS: '   ' }),
    ).toBeUndefined();
    expect(extraHeadersFromEnv({ OPENAI_EXTRA_HEADERS: '{}' })).toBeUndefined();
  });

  it('parses a JSON object of string values', () => {
    expect(
      extraHeadersFromEnv({
        OPENAI_EXTRA_HEADERS: '{"x-opencode-session":"abc-123"}',
      }),
    ).toEqual({ 'x-opencode-session': 'abc-123' });
  });

  it('rejects malformed JSON and non-objects', () => {
    expect(() =>
      extraHeadersFromEnv({ OPENAI_EXTRA_HEADERS: '{nope' }),
    ).toThrow(/valid JSON/);
    expect(() =>
      extraHeadersFromEnv({ OPENAI_EXTRA_HEADERS: '["a"]' }),
    ).toThrow(/JSON object/);
  });

  it('rejects non-string values', () => {
    expect(() =>
      extraHeadersFromEnv({ OPENAI_EXTRA_HEADERS: '{"x-session":1}' }),
    ).toThrow(/must be a string/);
  });

  it('rejects header names that could not be sent safely', () => {
    expect(() =>
      extraHeadersFromEnv({ OPENAI_EXTRA_HEADERS: '{"bad name":"v"}' }),
    ).toThrow(/invalid header name/);
    expect(() =>
      extraHeadersFromEnv({ OPENAI_EXTRA_HEADERS: '{"x-a\\r\\nX-Evil":"v"}' }),
    ).toThrow(/invalid header name/);
  });

  it('rejects values containing newlines', () => {
    expect(() =>
      extraHeadersFromEnv({
        OPENAI_EXTRA_HEADERS: '{"x-a":"v\\r\\nX-Evil: 1"}',
      }),
    ).toThrow(/must not contain newlines/);
  });
});
