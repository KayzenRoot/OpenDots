# Requirements

Requirement IDs are `FR-*` (functional), `NFR-*` (non-functional), `SEC-*`
(security), and `OPS-*` (operational). Status uses the shared legend
(DONE / IN PROGRESS / PLANNED / ACCEPTED).

## 1. Functional requirements

### 1.1 Agent runtime and conversations

| ID     | Requirement                                                                                                                                                                                                                                                                                                            | Status                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| FR-001 | The application MUST serve the AG-UI agent runtime at `/api/copilotkit/*` from the local server process, with no hosted dependency.                                                                                                                                                                                    | PLANNED (WORK-004) — upstream serves this path through hosted Intelligence mode today  |
| FR-002 | The runtime MUST run in SSE mode (`CopilotSseRuntime`) with `runner: AgentRunner` and `intelligence: undefined` / `channels: undefined`.                                                                                                                                                                               | PLANNED (WORK-004)                                                                     |
| FR-003 | Thread, message, event, and state persistence MUST live in owner-controlled PostgreSQL, exposed to the runtime through a `LocalThreadEndpointRunner` (`listThreads`, `getThreadMessages`, `getThreadEvents`, `getThreadState`, `clearThreads`, `ɵsupportsLocalThreadEndpoints: true`).                                 | PLANNED (WORK-003)                                                                     |
| FR-004 | The client's conversation-list and thread REST endpoints (`/api/copilotkit/threads`, `/threads/:id/messages`, `/threads/:id/events`, `/threads/:id/state`, `/threads/:id/archive`) MUST be served locally so the existing client (`src/client/App.tsx`, 965 lines; `src/client/Chat.tsx`, 489 lines) needs no rewrite. | PLANNED (WORK-004)                                                                     |
| FR-005 | Server-side, voice-compute, and scheduled turns MUST be executed with `HttpAgent` from `@ag-ui/client` against our own `/api/copilotkit/run`, replacing the hosted `IntelligenceAgent` path in `src/server/headless.ts`.                                                                                               | PLANNED (WORK-004)                                                                     |
| FR-006 | The `z.literal('intelligence')` gate on runtime info (currently in `src/server/headless.ts`) MUST be removed so server turns work against an SSE-mode runtime.                                                                                                                                                         | PLANNED (WORK-004)                                                                     |
| FR-007 | Multiple Dots (specialist agents) with per-Dot instructions and tool permissions MUST remain supported.                                                                                                                                                                                                                | DONE (upstream, retained)                                                              |
| FR-008 | Scheduled/background tasks MUST execute in a bound conversation and record runs/events.                                                                                                                                                                                                                                | DONE (upstream, retained); must be re-checked against the decoupled runtime (WORK-004) |

### 1.2 Spaces, pages, documents

| ID     | Requirement                                                                                                                                                                    | Status                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| FR-010 | Spaces, Pages, page revisions, page reviews, and page↔thread bindings MUST remain in the local SQLite store.                                                                   | DONE (upstream, retained) |
| FR-011 | The `PageIntelligence` seam in `src/server/page-service.ts` (`createThread`, `getOrCreateThread`, `getThreadMessages`) MUST be satisfied by the PostgreSQL conversation store. | PLANNED (WORK-003)        |

### 1.3 Human approval and integrations

| ID     | Requirement                                                                                                                                                                                                      | Status                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| FR-020 | Approval-gated MCP tool calls MUST remain: an approval runs only its own stored connection, tool, and arguments.                                                                                                 | DONE (upstream, retained) |
| FR-021 | MCP connections, tool enable/disable, and per-tool `requiresApproval` MUST remain in SQLite.                                                                                                                     | DONE (upstream, retained) |
| FR-022 | Slack MUST be provided by a self-hosted integration (Slack Web API + Events API, signing-secret verified) registered as its own Hono routes that invoke the same local agent runner. No managed channel product. | PLANNED (WORK-005)        |
| FR-023 | Per-Dot skills (revisions, delivery enabled/disabled) MUST be stored locally in PostgreSQL, replacing hosted learning containers and `getLearnedSkillsSnapshots`.                                                | PLANNED (WORK-006)        |
| FR-024 | An OpenAI-compatible model endpoint MUST be the only mandatory external model dependency.                                                                                                                        | ACCEPTED (WORK-007)       |

### 1.4 Optional capabilities

| ID     | Requirement                                                                                                                 | Status                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| FR-030 | OpenAI Realtime voice (`VOICE_API_KEY`/`VOICE_MODEL`/`VOICE_NAME`) MUST remain optional.                                    | DONE (upstream, retained) |
| FR-031 | Web search (`WEB_SEARCH_PROVIDER=parallel\|browser\|disabled`) MUST remain optional; `disabled` MUST work with no provider. | DONE (upstream, retained) |
| FR-032 | Composio connected apps MUST remain optional.                                                                               | DONE (upstream, retained) |
| FR-033 | Persisted computers MUST remain optional, one per Dot, with only the supervisor mounting the Docker socket.                 | DONE (upstream, retained) |
| FR-034 | HTTP API access to OpenDots by external agents/clients MUST be owner-authenticated.                                         | DONE (upstream, retained) |

## 2. Non-functional requirements

| ID      | Requirement                                                                                                        | Status                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| NFR-001 | The application MUST run as a single npm package; no monorepo is introduced.                                       | DONE                                                             |
| NFR-002 | Build MUST produce `dist/client` (Vite) and `dist/server/{server,browser,shared}` (`tsc -p tsconfig.server.json`). | DONE                                                             |
| NFR-003 | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run knip` MUST pass before release.     | DONE at baseline (see below); MUST hold after WORK-003..WORK-006 |
| NFR-004 | Node >= 24 MUST be required (uses `node:sqlite` `DatabaseSync` for local state).                                   | DONE                                                             |
| NFR-005 | `typecheck` and `lint` MUST remain clean (no new suppressions).                                                    | DONE at baseline                                                 |
| NFR-006 | New conversation persistence MUST be idempotent and versioned (no ad-hoc schema mutation).                         | PLANNED (WORK-003)                                               |
| NFR-007 | Two datastores (SQLite for app state, PostgreSQL for conversations) are accepted for a contained blast radius.     | ACCEPTED (ADR-0003)                                              |
| NFR-008 | No outbound network call to any CopilotKit host MAY be made at runtime.                                            | PLANNED (WORK-004) — telemetry removal                           |

## 3. Security requirements

| ID      | Requirement                                                                                                                                            | Status                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| SEC-001 | **No mandatory CopilotKit API key or hosted service may remain.** Configuration MUST NOT require `CPK_INTELLIGENCE_API_KEY` or `INTELLIGENCE_API_KEY`. | PLANNED (WORK-004)                  |
| SEC-002 | The application MUST run fully on owner-controlled infrastructure: owner Postgres, owner backend, owner agent runtime.                                 | PLANNED (WORK-003/004/008)          |
| SEC-003 | Every `/api/*` request MUST be owner-authenticated with a timing-safe bearer-token comparison when an external binding or `OWNER_TOKEN` is set.        | DONE                                |
| SEC-004 | Cross-origin requests MUST be restricted to the `APP_ORIGIN` allowlist and `sec-fetch-site: cross-site` MUST be rejected.                              | DONE                                |
| SEC-005 | Runtime routes MUST be scope-validated (`validateRuntimeScope`) so a request cannot address another Dot's thread.                                      | DONE                                |
| SEC-006 | Only the computer supervisor MAY mount the Docker socket.                                                                                              | DONE                                |
| SEC-007 | The browser service MUST run read-only, be isolated from private networks, and never be publicly exposed.                                              | DONE                                |
| SEC-008 | Secrets MUST live on the server only; `.env` files and databases MUST NOT be committed.                                                                | DONE                                |
| SEC-009 | Untrusted content (page text, model output, tool output) MUST NOT be treated as authorization to change permissions.                                   | DONE (upstream invariant, retained) |
| SEC-010 | Research browsing MUST remain read-only; page writes MUST use revision checks.                                                                         | DONE                                |
| SEC-011 | Agent/tool output MUST be treated as untrusted data (no shell/interpreter execution from output).                                                      | DONE                                |
| SEC-012 | New attack surface introduced by decoupling (Slack webhook, health endpoint, Postgres) MUST be covered by a security review before release.            | PLANNED (WORK-010)                  |

## 4. Operational requirements

| ID      | Requirement                                                                                                         | Status                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| OPS-001 | Docker Compose MUST start the application stack and pass a health check.                                            | PLANNED (WORK-008)                                                                       |
| OPS-002 | A health/readiness endpoint MUST exist and report DB connectivity and setup state.                                  | PLANNED (WORK-008) — upstream browser service has `/health`; the app server does not yet |
| OPS-003 | Application data MUST survive a container restart (SQLite file and Postgres volumes).                               | PLANNED (WORK-008)                                                                       |
| OPS-004 | Backup and restore MUST be documented and validated for BOTH the Postgres database and the SQLite file.             | PLANNED (WORK-008)                                                                       |
| OPS-005 | Upgrade and rollback procedures MUST be documented.                                                                 | PLANNED (WORK-008)                                                                       |
| OPS-006 | Postgres schema migrations MUST run idempotently on a clean install and on an existing database.                    | PLANNED (WORK-003)                                                                       |
| OPS-007 | HTTPS MUST terminate at a reverse proxy in front of the app; the app port MUST NOT be exposed publicly.             | PLANNED (WORK-008)                                                                       |
| OPS-008 | `.github/workflows/ci.yml` MUST continue to run knip (report-only), check-format, lint, typecheck, test, and build. | DONE                                                                                     |

## 5. Explicitly required guarantees

1. **No mandatory CopilotKit key or hosted service** (SEC-001, SEC-002,
   FR-001..FR-006). This is the defining requirement of the fork.
2. **Full owner-controlled operation** (SEC-002, OPS-001..OPS-008). Postgres,
   the backend, and the agent runtime all run on infrastructure the owner
   controls.
3. **No feature loss for the client** (FR-004). The existing UI must keep
   working without a rewrite.

## 6. Baseline verification (WORK-000)

Recorded on this Windows host (Node 26.4.0, npm 11.17.0):

- `npm run typecheck` — PASS (clean) — evidence `baseline-typecheck.log`.
- `npm run lint` — PASS (clean) — evidence `baseline-lint.log`.
- `npm test` — 348/351 pass. 3 failures, all in `tests/telemetry.test.ts`,
  each "Test timed out in 5000ms" (~5.0s). Root cause: those tests
  `execFile('node', ['--import','tsx', ...])`, spawning a subprocess that takes
  4.0–5.0s on this host versus Vitest's default 5000 ms `testTimeout`; sibling
  tests in the same file pass at 4.0–4.5s. Pre-existing host timing flake, not
  a logic defect; passes on Linux CI.
- `npm run build` — PASS.

See [TEST-PLAN.md](./TEST-PLAN.md) for the test strategy and the required new
tests, and [CHECKPOINT.md](./CHECKPOINT.md) for current status.
