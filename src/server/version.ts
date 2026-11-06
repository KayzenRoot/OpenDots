/**
 * The running version, reported by /api/update.
 *
 * Kept as a constant because the server bundle cannot resolve package.json
 * reliably from its output directory. tests/version.test.ts asserts this stays
 * equal to package.json, so the two cannot drift silently.
 */
export const NEXBOT_VERSION = '0.1.0';
