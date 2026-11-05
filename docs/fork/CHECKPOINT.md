# Checkpoint

Status snapshot for the decoupled fork. Date: **2026-11-05**.

## 1. Identity

| Item                   | Value                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Upstream               | `CopilotKit/OpenDots` (MIT, default branch `main`)                                                                             |
| Upstream HEAD recorded | `d4214aff10f066911f3253cb3cb870764cd51a9f`                                                                                     |
| Destination fork       | `https://github.com/KayzenRoot/OpenDots`                                                                                       |
| Local working tree     | `D:\Projects\opendots-clone\work\fork`                                                                                         |
| `origin` remote        | `https://github.com/KayzenRoot/OpenDots.git`                                                                                   |
| License                | Retained upstream MIT (`LICENSE`, Copyright (c) Atai Barkai)                                                                   |
| Stack                  | Single npm package; TypeScript, ESM, Node >= 24; React 19 + Vite client; Hono on `@hono/node-server`; SQLite via `node:sqlite` |

Repository facts at this checkpoint, measured from the tree:

- Tracked files: **207**.
- Commits: **127 across all refs** (73 reachable from `HEAD`). The recorded
  baseline figure of 127 counts all refs including upstream history; `HEAD`
  alone is 73.
- Test files: **56** (Vitest) in `tests/`.
- LOC: baseline record states ~11.5k in `src/`; measured at this checkpoint is
  **13,639** lines across `src/**/*.ts{,x}` (client 6,870; server 5,906; shared
  343; browser 275; build 245). The difference is a measurement-scope detail,
  not a code change; the measured figure is what the tree contains now.

## 2. Baseline results (WORK-000, recorded)

Host: Windows, Node 26.4.0, npm 11.17.0.

| Command             | Result               | Evidence                 |
| ------------------- | -------------------- | ------------------------ |
| `npm run typecheck` | PASS (clean)         | `baseline-typecheck.log` |
| `npm run lint`      | PASS (clean)         | `baseline-lint.log`      |
| `npm test`          | 348/351 pass; 3 fail | see below                |
| `npm run build`     | PASS                 | —                        |

3 failures, all `tests/telemetry.test.ts`, each `Test timed out in 5000ms`
(~5.0s). Cause: subprocess `execFile('node', ['--import','tsx', ...])` takes
4.0–5.0s on this host vs Vitest's 5000ms `testTimeout`; siblings pass at
4.0–4.5s. Pre-existing host timing flake; passes on Linux CI. Not a logic
defect. See [TEST-PLAN.md](./TEST-PLAN.md) §3.

CI (`.github/workflows/ci.yml`) runs knip (report-only), knip production
(report-only), check-format, lint, typecheck, test, build on Node 24. Not run in
this checkpoint (WORK-009 will record CI evidence).

## 3. Current phase

**Phase: planning / decoupling not yet implemented.**

The documentation set (WORK-001) and the baseline (WORK-000) are the only
completed pieces. All implementation work orders (WORK-003 onward) are PLANNED
or IN PROGRESS as noted below. This checkpoint deliberately marks implementation
items as not done: no decoupling code has been written or verified in this
repository at this time.

## 4. Work order status

| Work order | Objective                              | Status                                                |
| ---------- | -------------------------------------- | ----------------------------------------------------- |
| WORK-000   | Baseline (typecheck/lint/test/build)   | **DONE**                                              |
| WORK-001   | Documentation set in `docs/fork/`      | **IN PROGRESS** (authored; must track implementation) |
| WORK-002   | Issue/PR migration                     | PLANNED                                               |
| WORK-003   | Postgres conversation store + runner   | PLANNED                                               |
| WORK-004   | SSE runtime wiring + telemetry removal | PLANNED                                               |
| WORK-005   | Self-hosted Slack                      | PLANNED                                               |
| WORK-006   | Local learning/skills store            | PLANNED                                               |
| WORK-007   | LLM provider configuration             | PLANNED                                               |
| WORK-008   | VPS deployment                         | PLANNED                                               |
| WORK-009   | Tests + evidence                       | PLANNED                                               |
| WORK-010   | Security review + audit                | PLANNED                                               |

No implementation work order is claimed DONE. Where this document set describes
new modules (`src/server/pg.ts`, `conversation-store.ts`, `agent-runner.ts`,
`learning-store.ts`) or a rewritten `src/server/slack-channel.ts`, those are
**designed targets**, not existing code.

### What exists today (DONE, upstream-retained)

- `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- `npm test` passes except the 3 predocumented telemetry timeouts.
- Auth (owner token, `APP_ORIGIN`, `sec-fetch-site`), runtime-scope validation,
  page/document editing, approval workflows, MCP and Composio integrations,
  computers, browser isolation, voice, scheduling, and shutdown handling are all
  present and tested (see [FEATURE-PARITY.md](./FEATURE-PARITY.md)).
- Browser service `/health` exists; the app server has no health endpoint yet.

### What does not exist yet (must be built)

- PostgreSQL store, runner, migrations (`pg.ts`, `conversation-store.ts`,
  `agent-runner.ts`).
- SSE-mode runtime wiring; `HttpAgent` server turns; telemetry removal.
- Self-hosted Slack receiver; local skills store.
- App health/readiness endpoints; Postgres compose service; validated
  backup/restore.
- Docker images built and a compose smoke pass.

## 5. Blockers and risks

| #   | Blocker / risk                                                  | Impact                                            | Mitigation                                                                |
| --- | --------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| B1  | Implementation work orders are not started                      | The fork does not yet satisfy "no CopilotKit key" | Sequence WORK-003 → 004 → 005/006 → 008 → 009 → 010                       |
| B2  | Windows-host telemetry flake                                    | Local `npm test` not fully green                  | Do not mask globally; confirm on Linux CI; document per `TEST-PLAN.md` §3 |
| B3  | No Postgres service in `compose.yml` yet                        | Cannot validate deployment/backups                | WORK-008 adds it before any deployment claim                              |
| B4  | Backups span two stores with no shared transaction              | Restore can produce dangling references           | Paired backup/restore + reconciliation (DEPLOYMENT.md §8)                 |
| B5  | New attack surface (Slack webhook, Postgres, health) unreviewed | Security gate unmet                               | WORK-010 before release; blocking per DEFINITION-OF-DONE §11              |
| B6  | Upstream drift could reintroduce hosted surfaces                | Seam table could go stale                         | Re-audit the seam table on each upstream merge                            |

## 6. Next actions

1. Start WORK-003 (Postgres store + runner) with the schema in
   [DATA-MODEL.md](./DATA-MODEL.md) and the tests in
   [TEST-PLAN.md](./TEST-PLAN.md) §5.1–5.2.
2. Then WORK-004 (SSE wiring + telemetry removal).
3. Then WORK-005 and WORK-006 (Slack, learning) in parallel.
4. Then WORK-007, WORK-008, WORK-009, WORK-010.
5. Update this checkpoint and
   [DEFINITION-OF-DONE.md](./DEFINITION-OF-DONE.md) as each item flips, with an
   evidence artifact for every DONE.
