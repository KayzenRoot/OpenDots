import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEXBOT_VERSION } from '../src/server/version.js';

// The server bundle cannot resolve package.json from its output directory, so
// the version is a constant. This test is what keeps the constant and
// package.json from drifting apart.
describe('NEXBOT_VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      version: string;
    };
    expect(NEXBOT_VERSION).toBe(pkg.version);
  });
});
