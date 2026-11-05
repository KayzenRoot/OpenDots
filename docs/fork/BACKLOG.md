# Backlog

Work orders WORK-000 through WORK-010, deferred features, the mapping of
upstream community issues this fork resolves, and known limitations. Status uses
the shared legend (DONE / IN PROGRESS / PLANNED / ACCEPTED).

## 1. Work orders

### WORK-000 — Baseline (DONE)

- **Objective:** record the reproducible baseline of the fork at upstream HEAD
  `d4214aff10f066911f3253cb3cb870764cd51a9f` before changes.
- **Status:** DONE.
- **Result:** typecheck PASS, lint PASS, build PASS, `npm test` 348/351 (3
  telemetry timeouts, explained in [TEST-PLAN.md](./TEST-PLAN.md) §3).
- **Evidence:** `baseline-typecheck.log`, `baseline-lint.log`.

### WORK-001 — Documentation (IN PROGRESS)

- **Objective:** produce the canonical fork documentation set in `docs/fork/`.
- **Status:** IN PROGRESS — this document set is the deliverable; it must be
  re-checked against implementation as WORK-003..WORK-009 land.
- **Deliverables:** `OVERVIEW.md`, `REQUIREMENTS.md`, `SCOPE.md`,
  `ARCHITECTURE.md`, `DATA-MODEL.md`, `API-CONTRACTS.md`, `SECURITY.md`,
  `TEST-PLAN.md`, `DEPLOYMENT.md`, `BACKLOG.md`, `DEFINITION-OF-DONE.md`,
  `DECISIONS.md`, `FEATURE-PARITY.md`, `CHECKPOINT.md`, `README.md`.

### WORK-002 — Issue/PR migration (PLANNED)

- **Objective:** migrate upstream issues and PRs to the fork's tracker,
  preserving authorship and provenance where the platform allows, and record the
  authorship limitations (ADR-0010).
- **Status:** PLANNED.
- **Notes:** GitHub does not preserve original author identity when issues are
  recreated in another repository. The migration must state, on each imported
  item, that it was imported from `CopilotKit/OpenDots` and link the original.
  Do not rewrite issue text to imply original authorship by the fork.

### WORK-003 — Postgres conversation store + runner (PLANNED)

- **Objective:** implement `src/server/pg.ts` (pool + idempotent versioned
  migrations), `src/server/conversation-store.ts`
  (`PostgresConversationStore`, satisfying the `PageIntelligence` seam), and
  `src/server/agent-runner.ts` (`PostgresAgentRunner extends AgentRunner
implements LocalThreadEndpointRunner`).
- **Status:** PLANNED.
- **Depends on:** nothing.
- **Deliverables:** schema in [DATA-MODEL.md](./DATA-MODEL.md) §1; tests in
  [TEST-PLAN.md](./TEST-PLAN.md) §5.1–5.2.

### WORK-004 — SSE runtime wiring + telemetry removal (PLANNED)

- **Objective:** construct `CopilotRuntime` in SSE mode with the local runner
  (`intelligence: undefined`, `channels: undefined`); replace the
  `IntelligenceAgent` server path in `src/server/headless.ts` with `HttpAgent`
  (`@ag-ui/client`); remove the `z.literal('intelligence')` gate; remove
  CopilotKit telemetry and all outbound calls to CopilotKit hosts; drop the
  `intelligenceKey` requirement from `src/server/platform-config.ts` and
  `compose.yml`.
- **Status:** PLANNED.
- **Depends on:** WORK-003 (a runner is required for SSE mode).
- **Deliverables:** `runtime-sse-wiring.test.ts`, `headless-httpagent.test.ts`,
  `no-copilotkit-egress.test.ts`.

### WORK-005 — Self-hosted Slack (PLANNED)

- **Objective:** rewrite `src/server/slack-channel.ts` to use the Slack Web API
  - Events API (signing-secret verified), registered as Hono routes
    (`POST /api/slack/events`), invoking the same local agent runner.
- **Status:** PLANNED.
- **Depends on:** WORK-003/WORK-004 (must run the local runner, not a managed
  channel).
- **Deliverables:** `slack-signature.test.ts`, `slack-identity-allowlist.test.ts`,
  `slack-run-local-agent.test.ts`.

### WORK-006 — Local learning/skills store (PLANNED)

- **Objective:** implement `src/server/learning-store.ts` and the `skills` table;
  replace hosted learning containers and `getLearnedSkillsSnapshots`; drive it
  from the Dot `learningContainerId`/`skillDeliveryEnabled` settings and the
  rewritten `learningSelector`.
- **Status:** PLANNED.
- **Depends on:** WORK-003.
- **Deliverables:** `learning-store.test.ts`,
  `learning-replaces-containers.test.ts`.

### WORK-007 — LLM provider configuration (PLANNED)

- **Objective:** make an OpenAI-compatible endpoint the documented, first-class
  model configuration (`OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_MODEL`), with
  first-run guidance for Ollama/LM Studio/vLLM/OpenRouter/Groq/Together, and
  remove the upstream narrative that a CopilotKit model is required.
- **Status:** PLANNED.
- **Addresses:** upstream #118, #100, #58, #87.

### WORK-008 — VPS deployment (PLANNED)

- **Objective:** add the Postgres service to `compose.yml`; add
  `/api/health` and `/api/ready`; finalize the env template; document and
  validate HTTPS/reverse-proxy topology, restart policies, volumes, backup and
  restore for both stores, upgrade and rollback, and firewall guidance (see
  [DEPLOYMENT.md](./DEPLOYMENT.md)).
- **Status:** PLANNED.
- **Depends on:** WORK-003/WORK-004.
- **Deliverables:** `health-ready.test.ts`; scripted compose smoke test.

### WORK-009 — Tests + evidence (PLANNED)

- **Objective:** implement the new tests in [TEST-PLAN.md](./TEST-PLAN.md) §5,
  the agent-latency benchmark (§6), and capture reproducible evidence artifacts
  (§7), including the Postgres migration apply/rollback and compose smoke runs.
- **Status:** PLANNED.
- **Depends on:** WORK-003..WORK-008 as applicable.

### WORK-010 — Security review + audit (PLANNED)

- **Objective:** review the new attack surface (Postgres, Slack webhook, health
  endpoints), run a dependency-vulnerability pass with no unresolved
  HIGH/CRITICAL findings, review DB role/TLS/at-rest posture, add rate-limiting
  guidance or implementation, and review indirect prompt-injection risk.
- **Status:** PLANNED.
- **Depends on:** WORK-004..WORK-008.
- **Gate:** per [DEFINITION-OF-DONE.md](./DEFINITION-OF-DONE.md), release
  requires no unresolved HIGH/CRITICAL finding.

## 2. Deferred features

See [SCOPE.md](./SCOPE.md) §3 for the full list and revisit triggers. Summary:
conversation retention enforcement, Postgres at-rest encryption, Slack
interactive components, multi-Dot shared conversations, deep reasoning-model
reliability, and voice provider portability.

## 3. Upstream community issues this fork resolves

Real upstream issue numbers. Where upstream provided a title it is quoted;
where only a number was recorded, the title is marked as not recorded rather
than invented.

| Upstream issue | Title / subject                                                | How this fork resolves it                                                                                          |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| #171           | Hosted Intelligence realtime plane returns 404 on all WS paths | The hosted realtime plane is removed (WORK-004); the runtime is SSE mode with a local runner.                      |
| #127           | Intelligence conversation creation fails HTTP 500/503          | Conversation creation is local (`PostgresConversationStore`) with no hosted call (WORK-003).                       |
| #123           | Intelligence 503 selecting/creating a project                  | No CopilotKit project is selected or required (WORK-004, ADR-0002).                                                |
| #74            | Conversations require CopilotKit's cloud; add a local option   | Local Postgres conversations are the default (WORK-003, ADR-0003).                                                 |
| #87            | Remove requirement for any cloud API or cloud model            | Only an owner-selected OpenAI-compatible endpoint is required (WORK-007).                                          |
| #118           | OpenAI only?                                                   | Any OpenAI-compatible base URL is supported (WORK-007).                                                            |
| #100           | Add Ollama configuration to first-run setup                    | Ollama is documented as a first-class provider (WORK-007).                                                         |
| #58            | Reasoning models fail every turn                               | Addressed by provider flexibility and the `AGENT_RUN_TIMEOUT_MS` control; residual risk tracked in deferred items. |
| #42            | Not open sourced                                               | This fork keeps and builds on the MIT source; broader upstream licensing is upstream's decision.                   |
| #83            | (title not recorded)                                           | Removed CopilotKit-hosted dependency surface.                                                                      |
| #84            | (title not recorded)                                           | Removed CopilotKit-hosted dependency surface.                                                                      |
| #88            | (title not recorded)                                           | Removed CopilotKit-hosted dependency surface.                                                                      |
| #108           | (title not recorded)                                           | Removed CopilotKit-hosted dependency surface.                                                                      |
| #41            | (title not recorded)                                           | Removed CopilotKit-hosted dependency surface.                                                                      |
| #46            | (title not recorded)                                           | Removed CopilotKit-hosted dependency surface.                                                                      |
| #149           | (title not recorded)                                           | Self-hosted storage/runner parity.                                                                                 |
| #151           | (title not recorded)                                           | Self-hosted storage/runner parity.                                                                                 |
| #173           | (title not recorded)                                           | Self-hosted storage/runner parity.                                                                                 |
| #177           | (title not recorded)                                           | Self-hosted storage/runner parity.                                                                                 |
| #59            | (title not recorded)                                           | Provider/configuration flexibility.                                                                                |
| #70            | (title not recorded)                                           | Provider/configuration flexibility.                                                                                |
| #69            | (title not recorded)                                           | Provider/configuration flexibility.                                                                                |
| #68            | (title not recorded)                                           | Provider/configuration flexibility.                                                                                |
| #57            | (title not recorded)                                           | Provider/configuration flexibility.                                                                                |
| #54            | (title not recorded)                                           | Provider/configuration flexibility.                                                                                |
| #125           | (title not recorded)                                           | Self-hosted Slack (WORK-005).                                                                                      |
| #147           | (title not recorded)                                           | Self-hosted Slack (WORK-005).                                                                                      |
| #111           | (title not recorded)                                           | Self-hosted learning/skills (WORK-006).                                                                            |

Each imported issue is tracked for authorship provenance under WORK-002, with
the limitation recorded in ADR-0010.

## 4. Known limitations

1. **Telemetry-suite flake on Windows hosts.** 3 `tests/telemetry.test.ts`
   subprocess tests time out at ~5.0 s locally; they pass on Linux CI. See
   [TEST-PLAN.md](./TEST-PLAN.md) §3.
2. **No guarantee against upstream drift.** Upstream `main` may add new
   CopilotKit-hosted surfaces; the fork re-audits the seam table
   ([ARCHITECTURE.md](./ARCHITECTURE.md) §4) on each upstream merge.
3. **Two datastores, no shared transaction.** SQLite and Postgres cannot be
   committed atomically; a crash between writes can leave a dangling
   conversation binding. The restore reconciliation in
   [DEPLOYMENT.md](./DEPLOYMENT.md) §8.2 handles the recovery case; a
   consistency checker is PLANNED (WORK-003/008).
4. **No multi-user enforcement.** Single-owner by design; upstream `SECURITY.md`
   already scopes this.
5. **No application-level rate limiting** on agent runs/tool calls; mitigation is
   at the reverse proxy (WORK-010).
6. **MCP token at rest** in SQLite is plaintext (WORK-010).
7. **Retention policy unenforced** for `thread_events` (deferred).
8. **Epoch-ms timestamps** in Postgres instead of `timestamptz` — a fidelity
   choice recorded in [DATA-MODEL.md](./DATA-MODEL.md) §1.1, revisable by ADR.
