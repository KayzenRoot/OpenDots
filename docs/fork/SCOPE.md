# Scope

This document defines what the fork delivers, what it explicitly does not, what
is deferred and why, and the three accepted scope decisions.

## 1. In scope

### 1.1 CopilotKit decoupling (the core of the fork)

- Replace the hosted `CopilotKitIntelligence` thread/memory/learning store with
  a self-hosted PostgreSQL conversation store
  (`src/server/conversation-store.ts`, `src/server/pg.ts`).
- Replace the hosted `IntelligenceAgentRunner` realtime gateway with a local
  runner (`src/server/agent-runner.ts`) that runs agents locally and persists
  threads/messages/events/state in PostgreSQL.
- Move the runtime from **Intelligence mode** to **SSE mode**
  (`CopilotSseRuntime`) — MIT, no API key.
- Replace the hosted `IntelligenceAgent` server-side path
  (`src/server/headless.ts`) with `HttpAgent` (`@ag-ui/client`, MIT v0.0.59)
  speaking the open AG-UI protocol to our own `/api/copilotkit/run`.
- Reimplement the Slack channel self-hosted (rewrite
  `src/server/slack-channel.ts` against the Slack Web API + Events API).
- Reimplement learning/skills locally (`src/server/learning-store.ts`),
  replacing hosted learning containers and `getLearnedSkillsSnapshots`.
- Remove CopilotKit telemetry (`https://telemetry.copilotkit.ai/ingest`,
  `CPK_TELEMETRY_ID`, `COPILOTKIT_TELEMETRY_*`) and any outbound call to a
  CopilotKit host.

### 1.2 Retained application surface (keeping parity)

- Spaces, Pages, document editing (TipTap), page reviews and revisions.
- Specialist agents (Dots) with instructions and per-tool permissions.
- Persistent conversations, memory, and conversation→page saves.
- Human approval workflows for MCP tools.
- Browser, terminal, and file access via persisted computers (OpenBot).
- MCP and external integrations (Composio, streamable-HTTP MCP).
- Background execution and scheduling (tasks, runs, events).
- Optional voice (OpenAI Realtime).
- Owner authentication, origin allowlisting, and runtime-scope validation.
- Logging/recovery surfaces already present (see
  [FEATURE-PARITY.md](./FEATURE-PARITY.md)).

### 1.3 Operational deliverables

- Docker Compose topology for app + Postgres (+ optional browser /
  computer supervisor).
- Idempotent, versioned Postgres migrations.
- Health/readiness endpoint.
- Backup/restore for Postgres and SQLite; upgrade/rollback procedures.
- Test plan, evaluation harness, and evidence artifacts for the decoupled
  runtime.
- This documentation set and the upstream issue/PR migration record.

## 2. Out of scope

| Item                                                                                 | Reason                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rewriting the client UI (`App.tsx`, `Chat.tsx`, page editor)                         | The client is served by local REST thread endpoints; a rewrite adds risk with no user-visible benefit. See FR-004.                                              |
| Removing all `@copilotkit/*` packages                                                | `@copilotkit/runtime` and `@copilotkit/react-core` are MIT, local-only, need no key, and call no CopilotKit host. Removing them would be a rewrite. (ADR-0002.) |
| Multi-tenant hosting, per-user accounts, SSO                                         | Upstream is a single-owner template; owner `SECURITY.md` already scopes multi-user as future work.                                                              |
| Migrating existing app state (`spaces`, `pages`, `tasks`, …) from SQLite to Postgres | Accepted decision: Postgres is for conversations only. (ADR-0003.) A full migration is a separate effort with much larger blast radius.                         |
| Managed/hosted deployment as a service                                               | The fork is self-hosted by the owner.                                                                                                                           |
| Full excision of the upstream README's CopilotKit setup narrative                    | Out of scope for this doc set; handled as documentation edits during WORK-002/WORK-007.                                                                         |
| New agent capabilities or product features                                           | The fork's purpose is decoupling and parity, not new features.                                                                                                  |

## 3. Deferred items

| Item                                                         | Why deferred                                                                                                                              | Trigger to revisit                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Automatic conversation archival/retention policy enforcement | Schema supports it (see [DATA-MODEL.md](./DATA-MODEL.md)); policy needs owner input on retention windows.                                 | After WORK-003 ships and usage data exists    |
| Postgres row-level encryption at rest                        | Requires KMS/key-management decisions not yet made; disk-level encryption suffices for the target single-owner VPS.                       | WORK-010 findings or a compliance requirement |
| Slack interactive components (buttons/modals)                | The self-hosted Slack integration starts with events + Web API replies; interactivity is additive.                                        | WORK-005 core complete                        |
| Multi-Dot shared conversations                               | Upstream threads are bound to one Dot; changing this changes the runtime scope model.                                                     | Out of scope unless upstream changes          |
| Reasoning-model turn reliability (upstream #58)              | Mitigated by allowing any OpenAI-compatible model and by the `AGENT_RUN_TIMEOUT_MS` control; deeper fix depends on the AG-UI/agent stack. | If reproducible after WORK-004                |
| Voice provider portability (currently OpenAI Realtime)       | Voice is optional; a second provider needs a provider abstraction.                                                                        | Owner request                                 |

## 4. Accepted scope decisions

These are decisions the repo owner has made. Each is recorded as an ADR with
status **Accepted**.

### Decision 1 — Replace hosted CopilotKit services; keep MIT local libraries

- **Decision:** Replace `CopilotKitIntelligence`, `IntelligenceAgentRunner`, the
  runtime Intelligence mode, `IntelligenceAgent`, `@copilotkit/channels`, hosted
  learning containers, and CopilotKit telemetry. Retain `@copilotkit/runtime`
  and `@copilotkit/react-core` (MIT, local-only).
- **Why:** The host-dependent pieces require accounts/keys and make outbound
  calls; the retained libraries are MIT and protocol-level. This is a surgical
  decoupling, not a full excision. Recorded as ADR-0002.
- **Status:** Accepted.

### Decision 2 — PostgreSQL for conversations only

- **Decision:** PostgreSQL stores conversations (threads, messages, runs,
  events, state) and the learning/skills store. All other application state
  remains in the existing SQLite database.
- **Why:** Contained blast radius. The conversation tables need
  concurrency/scale characteristics Postgres provides; the rest of the app's
  state is fine on `node:sqlite`. Two datastores is an accepted cost.
  Recorded as ADR-0003.
- **Status:** Accepted.

### Decision 3 — Reimplement both Intelligence-only features self-hosted

- **Decision:** Both Intelligence-only features are reimplemented, not dropped:
  (a) the Slack channel, and (b) the local learning/skills store.
- **Why:** Dropping them would be a feature regression versus upstream. The
  fork requires parity. Recorded as ADR-0005 and ADR-0006.
- **Status:** Accepted.

## 5. Scope boundaries in one line each

- We remove **requirement** of CopilotKit, not CopilotKit code that is MIT and
  local.
- We keep the **client** untouched; we replace the **server runtime**, **storage**,
  **Slack**, **learning**, and **telemetry**.
- We move **conversations** to Postgres; we leave **everything else** on SQLite.
