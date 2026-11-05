# Test Plan

Testing strategy for the decoupled fork, the recorded baseline, how to run
everything, and the new tests the decoupling requires. Status uses the shared
legend.

## 1. Strategy

| Layer        | Scope                                                           | Tooling                                           | Where                                                                                                                                |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Unit         | Pure functions, schemas, stores, route handlers in isolation    | Vitest                                            | `tests/*.test.ts`                                                                                                                    |
| Component    | React components rendered in isolation                          | Vitest + `react-test-renderer`                    | `tests/*.test.tsx`                                                                                                                   |
| Integration  | Hono app + stores + services wired together (SQLite `:memory:`) | Vitest                                            | `tests/app.test.ts`, `tests/workspace.test.ts`, `tests/page-service.test.ts`, `tests/connection*.test.ts`, `tests/computer*.test.ts` |
| End-to-end   | Real HTTP routes and process behaviour                          | Vitest with real `serve`/`fetch` and subprocesses | `tests/telemetry.test.ts`, `tests/headless*.test.ts`, `tests/slack-channel*.test.ts`                                                 |
| Build/static | Types, lint, dead code, formatting                              | `tsc --noEmit`, ESLint, knip, Prettier            | `npm run typecheck\|lint\|knip\|check-format`                                                                                        |

Baseline: **56 test files** in `tests/`, all Vitest. Fixtures live in
`tests/fixtures/`.

## 2. How to run

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src tests vite.config.ts
npm test               # cross-env DO_NOT_TRACK=1 vitest run
npm run build          # vite build && tsc -p tsconfig.server.json
npm run knip           # report-only dead-code check
npm run knip:production
npm run check-format   # prettier --check
```

CI (`.github/workflows/ci.yml`) runs, in order: knip (report only), knip
production (report only), `check-format`, `lint`, `typecheck`, `test`, `build`,
on Node 24, with a 15-minute timeout.

## 3. Recorded baseline (WORK-000)

Platform: this Windows host, Node 26.4.0, npm 11.17.0.

| Command             | Result               | Evidence                 |
| ------------------- | -------------------- | ------------------------ |
| `npm run typecheck` | PASS (clean)         | `baseline-typecheck.log` |
| `npm run lint`      | PASS (clean)         | `baseline-lint.log`      |
| `npm test`          | 348/351 pass, 3 fail | see below                |
| `npm run build`     | PASS                 | —                        |

### Baseline failures and explanation

All 3 failures are in `tests/telemetry.test.ts`, each reported as
`Test timed out in 5000ms` at ~5.0s.

- **Cause:** those tests `execFile('node', ['--import', 'tsx', ...])`, spawning a
  Node subprocess that takes 4.0–5.0 s to boot on this host, against Vitest's
  default `testTimeout` of 5000 ms. Sibling tests in the same file pass at
  4.0–4.5 s.
- **Classification:** pre-existing host timing flake, not a logic defect. The
  same suite passes on Linux CI.
- **Fork action:** do not mask it by raising the timeout globally. WORK-009
  either (a) confirms it passes on Linux CI unchanged, or (b) if a deterministic
  fix is wanted, raises `testTimeout` only for the subprocess-booting tests, with
  a comment explaining why. Any such change must be recorded in
  [CHECKPOINT.md](./CHECKPOINT.md).

## 4. Existing coverage of the retained surface

The baseline suite already tests the upstream behaviour the fork retains, so it
doubles as the parity regression net:

| Area                                | Representative files                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth/origin/scope                   | `app.test.ts`, `app-origin.test.ts`, `runtime-scope.test.ts`, `security.test.ts`                                                                              |
| Workspace, Dots, Spaces             | `workspace.test.ts`, `library.test.ts`                                                                                                                        |
| Pages, reviews, snapshots, autosave | `pages.test.ts`, `page-routes.test.ts`, `page-service.test.ts`, `page-review*.test.tsx`, `page-snapshots.test.ts`, `autosave.test.ts`                         |
| Conversations ↔ pages               | `page-conversation-deletion.test.ts`, `page-chat-request.test.ts`, `page-context.test.ts`, `page-load-latest.test.tsx`                                        |
| MCP connections/approvals           | `connections.test.ts`, `connection-card.test.tsx`                                                                                                             |
| Computers                           | `computer.test.ts`, `computer-routes.test.ts`, `computer-deployment.test.js`, `computer-card.test.tsx`                                                        |
| Tasks/runner                        | `runner.test.ts`, `agent-run-timeout.test.ts`, `store.test.ts`                                                                                                |
| Voice                               | `voice.test.ts`, `use-voice.test.ts`, `use-voice-control-poll.test.ts`, `transcript.test.tsx`                                                                 |
| Slack (upstream shape)              | `slack-channel.test.ts`, `slack-channel-wiring.test.ts`, `dot-agent-channel.test.ts`                                                                          |
| Learning (upstream shape)           | `learning.test.ts`, `learning-delivery.test.ts`                                                                                                               |
| Headless/server turns               | `headless.test.ts`, `headless-runtime.test.ts`                                                                                                                |
| Setup/telemetry                     | `setup.test.ts`, `setup-telemetry.test.ts`, `telemetry.test.ts`, `intelligence-key.test.ts`                                                                   |
| Client components                   | `chat-composer.test.ts`, `chat-run-error.test.tsx`, `controls.test.tsx`, `markdown.test.ts`, `dark-theme.test.ts`, `poll-notice.test.ts`, `transport.test.ts` |

Several of these encode upstream-only behaviour and will need updating as part
of the work orders (`intelligence-key.test.ts`, the `intelligence` assertions in
`setup.test.ts`, the managed-channel tests in `slack-channel*.test.ts`). Tests
must be changed deliberately, not deleted: each change is recorded in
[CHECKPOINT.md](./CHECKPOINT.md).

## 5. New tests required (PLANNED)

### 5.1 PostgreSQL store (WORK-003)

| Test                                     | Verifies                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg-migrations.test.ts`                  | Migrations apply idempotently on a clean DB and on an already-migrated DB; `schema_migrations` is recorded once per version; a failed migration leaves the last good version.   |
| `conversation-store.test.ts`             | `createThread`/`getOrCreateThread`/`getThreadMessages` satisfy the `PageIntelligence` seam; message `seq` ordering; content parts vs string; cascade delete; per-owner scoping. |
| `conversation-store-idempotency.test.ts` | Re-running an append with the same `(conversation_id, seq)` does not duplicate; concurrent appends keep `seq` monotonic.                                                        |

### 5.2 Agent runner + local thread endpoints (WORK-003/004)

| Test                           | Verifies                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-runner.test.ts`         | `PostgresAgentRunner` implements `AgentRunner` (`run`, `connect`, `isRunning`, `stop`) and `LocalThreadEndpointRunner` (`listThreads`, `getThreadMessages`, `getThreadEvents`, `getThreadState`, `clearThreads`, `ɵsupportsLocalThreadEndpoints: true`); `supportsLocalThreadEndpoints` returns true. |
| `runtime-sse-wiring.test.ts`   | The runtime is constructed in SSE mode (`runner` set, `intelligence`/`channels` undefined); `GET /api/copilotkit/info` no longer requires `intelligence.wsUrl`; `useThreads()`-equivalent REST calls return the local conversation list.                                                              |
| `headless-httpagent.test.ts`   | Server-side/voice/scheduled turns use `HttpAgent` against `/api/copilotkit/run` with the owner bearer; no `z.literal('intelligence')` gate; run error surfaces as a turn error.                                                                                                                       |
| `no-copilotkit-egress.test.ts` | With the app running a turn, no request is made to any CopilotKit host (assert on intercepted fetch/DNS or block the host and assert success).                                                                                                                                                        |

### 5.3 Slack self-hosted (WORK-005)

| Test                               | Verifies                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slack-signature.test.ts`          | Valid signature accepted; wrong signature, wrong signing secret, and stale timestamp rejected; `url_verification` challenge answered.                                |
| `slack-identity-allowlist.test.ts` | Events from a non-allowlisted team/user are ignored; only `created` operations trigger a run; owner mapping is explicit.                                             |
| `slack-run-local-agent.test.ts`    | An eligible message invokes the local agent runner (not a managed channel), posts one reply, and posts one error reply on failure without leaking provider messages. |

### 5.4 Learning store (WORK-006)

| Test                                   | Verifies                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `learning-store.test.ts`               | Skill create/revise; `delivery_enabled` gating; per-Dot and per-scope isolation; snapshot query only includes enabled skills.         |
| `learning-replaces-containers.test.ts` | The Dot `learningContainerId`/`skillDeliveryEnabled` settings drive local skills; no hosted `getLearnedSkillsSnapshots` call is made. |

### 5.5 Health/readiness and deployment (WORK-008)

| Test                                   | Verifies                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health-ready.test.ts`                 | `/api/health` returns 200 with no datastore access; `/api/ready` returns 200 only when SQLite and Postgres are reachable and migrated, 503 otherwise. |
| `compose-smoke` (scripted, not Vitest) | `docker compose up` starts app + Postgres; app passes `/api/health`; data persists across `restart`; backup/restore round-trips both stores.          |

## 6. Benchmark plan for agent turn latency

Goal: quantify the cost of decoupling versus upstream Intelligence mode, and
guard against regressions.

- **Harness:** a Vitest benchmark (`tests/fixtures/` for prompts) or a scripted
  harness that drives `/api/copilotkit/agent/:dotId/run` against a local
  OpenAI-compatible stub model, so measurements are not dominated by provider
  network variance.
- **Metric 1 — time to first SSE event (TTFE):** from request send to first AG-UI
  event received, p50/p95 over ≥50 runs.
- **Metric 2 — time to final message (TTFM):** from request send to run
  completion, p50/p95.
- **Metric 3 — persistence overhead:** `TTFM` with Postgres persistence enabled
  minus `TTFM` with persistence disabled, isolating the per-run write cost of
  `conversations`/`messages`/`thread_runs`/`thread_events`/`thread_state`.
- **Metric 4 — conversation-list read:** `GET /api/copilotkit/threads` and
  `GET /threads/:id/messages` at 10 / 100 / 1000 conversations, p50/p95, to
  confirm indexes in [DATA-MODEL.md](./DATA-MODEL.md) are effective.
- **Method:** warm the pool, discard the first 5 runs, report p50/p95/σ, and
  record host, Node version, Postgres version, and stub model in the evidence.
- **Budget:** record the measured numbers in WORK-009 evidence; treat a
  regression >20% in TTFE or TTFM versus the recorded baseline as a release
  blocker pending explanation.

## 7. Evidence and artifacts (WORK-009)

Per work order, capture and retain:

- Command output logs (`baseline-typecheck.log`, `baseline-lint.log`, and the
  post-change equivalents).
- `npm test` summary with pass/fail counts and the named failing tests.
- `npm run build` success with the `dist/` layout check.
- Migration apply/rollback output on a clean database.
- Docker Compose smoke output (start, health, restart persistence,
  backup/restore).
- Benchmark results for Section 6.

Evidence files must be reproducible from a documented command; no evidence is
invented. Anything not yet produced is marked PLANNED in
[CHECKPOINT.md](./CHECKPOINT.md).
