# Definition of Done

Acceptance criteria for fork readiness. Each item is a checkbox with the
verification method and current status. Release is **not** declared until every
`[ ]` item is `[x]` and the two blocking conditions at the end are satisfied.

Legend: `[x]` met, `[ ]` not yet met, `[~]` partially met.

## 1. Fork and provenance

- [x] **Fork exists** at `https://github.com/KayzenRoot/OpenDots`.
  - Verify: `git remote -v` shows `origin` as the KayzenRoot repository.
  - Status: DONE.
- [x] **History preserved** from upstream (GitHub fork; upstream commits
      reachable; upstream HEAD `d4214aff10f066911f3253cb3cb870764cd51a9f`).
  - Verify: upstream SHA present in history; upstream commit graph intact.
  - Status: DONE.
- [x] **Upstream license retained** — `LICENSE` (MIT, Copyright (c) Atai Barkai)
      unchanged.
  - Status: DONE.
- [ ] **Issues/PRs migrated** with provenance and authorship limitations
      recorded. — WORK-002. Status: PLANNED.

## 2. Decoupling

- [ ] **No mandatory CopilotKit key or hosted service.**
  - Verify: with a clean `.env` containing no `CPK_INTELLIGENCE_API_KEY` /
    `INTELLIGENCE_API_KEY`, the app starts and completes a chat turn;
    `grep -r` finds no required reference; no outbound request to a CopilotKit
    host (WORK-004 egress test).
  - Status: PLANNED — WORK-004. Upstream still requires Intelligence.
- [ ] **Runs fully on owner infrastructure** (Postgres, backend, agent runtime).
  - Verify: deployment uses only owner Postgres, owner app, owner model
    endpoint. Status: PLANNED — WORK-003/004/008.
- [ ] **Telemetry to CopilotKit removed** (no `telemetry.copilotkit.ai`,
      `CPK_TELEMETRY_ID`, `COPILOTKIT_TELEMETRY_*` at runtime). Status: PLANNED —
      WORK-004.
- [ ] **Parity features reimplemented self-hosted**: Slack (WORK-005) and local
      skills store (WORK-006). Status: PLANNED.

## 3. Build and static checks

- [x] **`npm run typecheck` passes clean.** — baseline.
- [x] **`npm run lint` passes clean.** — baseline.
- [ ] **`npm run check-format` passes.** — verify before release.
- [ ] **`npm run build` passes** and produces `dist/client`,
      `dist/server/{server,browser,shared}`. — baseline build passed; re-verify the
      layout after WORK-003/004.
- [ ] **`npm run knip` reports no new dead exports** introduced by the fork
      (report-only upstream, but no regression). — verify before release.

## 4. Tests

- [ ] **`npm test` passes.**
  - Baseline: 348/351, 3 predocumented host flake failures in
    `tests/telemetry.test.ts`. Target: no _unexplained_ failures; the 3 flake
    failures are either passing on the release host/CI or explicitly accepted
    with the explanation in `TEST-PLAN.md`.
  - Status: PARTIAL — baseline recorded; new tests pending WORK-009.
- [ ] **New decoupled-runtime tests pass**: Postgres store, agent runner, SSE
      wiring, no-CopilotKit-egress, Slack, learning store, health/readiness.
      Status: PLANNED — WORK-009.
- [ ] **Agent-latency benchmark recorded** with a documented budget (TTFE/TTFM
      p50/p95, persistence overhead). Status: PLANNED — WORK-009.

## 5. Data and migrations

- [ ] **Migrations work on a clean install** (empty Postgres → full schema,
      `schema_migrations` recorded). Status: PLANNED — WORK-003.
- [ ] **Migrations work on an existing database** and are idempotent (second
      apply is a no-op). Status: PLANNED — WORK-003.
- [ ] **Failed migration leaves the last good version** (transactional apply).
      Status: PLANNED — WORK-003.
- [ ] **Postgres stores conversations only; SQLite stores the rest**, per the
      accepted data-model split. Status: PLANNED — WORK-003.

## 6. Auth and permissions

- [ ] **Owner auth tested**: missing/wrong token → 401; correct token → 200.
      Status: DONE (upstream `app.test.ts`); re-verify after WORK-004.
- [ ] **Origin/host allowlist tested**: cross-origin and cross-site rejected;
      `APP_ORIGIN` honored. Status: DONE (upstream); re-verify.
- [ ] **Runtime scope tested**: a request cannot address another Dot's thread.
      Status: DONE (upstream `runtime-scope.test.ts`); extend for new local thread
      routes in WORK-004.
- [ ] **Tool/approval boundaries tested**: approval runs only its own stored
      request, within TTL, only while the tool is enabled. Status: DONE (upstream);
      re-verify.

## 7. Deployment

- [ ] **Docker starts the stack** (`docker compose up`) with app + Postgres.
      Status: PLANNED — WORK-008.
- [ ] **Health checks pass** (`/api/health` 200; `/api/ready` 200 only when DBs
      are reachable and migrated). Status: PLANNED — WORK-008.
- [ ] **Data survives restart** (SQLite + Postgres volumes). Status: PLANNED —
      WORK-008.
- [ ] **Backup/restore validated for both stores** as one consistent pair, with
      reconciliation. Status: PLANNED — WORK-008.
- [ ] **HTTPS via reverse proxy**; app, Postgres, browser, and supervisor not
      publicly exposed. Status: PLANNED — WORK-008.
- [ ] **Upgrade and rollback documented and exercised.** Status: PLANNED —
      WORK-008.

## 8. Security

- [ ] **No unresolved HIGH/CRITICAL security findings.** Status: PLANNED —
      WORK-010 (blocking).
- [ ] **Dependency-vulnerability pass complete** with no unresolved
      HIGH/CRITICAL. Status: PLANNED — WORK-010.
- [ ] **New attack surface reviewed** (Postgres, Slack webhook, health
      endpoints). Status: PLANNED — WORK-010.
- [ ] **Rate-limiting decision recorded and applied** (app or proxy). Status:
      PLANNED — WORK-010.
- [ ] **Secret handling reviewed** (no secret in logs; MCP token at rest
      decision). Status: PARTIAL — `safeFailure` exists; at-rest review PLANNED.

## 9. Documentation

- [ ] **Docs complete**: `docs/fork/` contains OVERVIEW, REQUIREMENTS, SCOPE,
      ARCHITECTURE, DATA-MODEL, API-CONTRACTS, SECURITY, TEST-PLAN, DEPLOYMENT,
      BACKLOG, DEFINITION-OF-DONE, DECISIONS, FEATURE-PARITY, CHECKPOINT, README.
      Status: IN PROGRESS — set authored under WORK-001; must track implementation.
- [ ] **Parity matrix complete**: every row of
      [FEATURE-PARITY.md](./FEATURE-PARITY.md) has an implementation status and a
      verification method that exists. Status: IN PROGRESS.
- [ ] **Decisions ledger complete**: ADR-0001..ADR-0010 recorded with context,
      decision, consequences, alternatives. Status: DONE (see
      [DECISIONS.md](./DECISIONS.md)); extend as new decisions arise.

## 10. Evidence and checkpoint

- [ ] **Evidence updated** for every work order: command output logs, test
      summaries, migration output, compose smoke, benchmark. Status: PARTIAL —
      baseline logs recorded; decoupling evidence PLANNED — WORK-009.
- [ ] **Checkpoint updated** to reflect actual status (no claim marked DONE
      without evidence). Status: IN PROGRESS — [CHECKPOINT.md](./CHECKPOINT.md).

## 11. Blocking conditions

Release is blocked while **either** of the following is true:

1. Any item above in Section 2 (Decoupling), Section 8 (Security), or the
   backup/restore item in Section 7 is unmet.
2. Any claim in the documentation set is DONE without a reproducible evidence
   artifact.
