# Decisions (ADRs)

Decision ledger for the decoupled fork. Date for all entries: **2026-11-05**.
Each entry: ID, title, status, context, decision, consequences, alternatives
considered.

Status values: Accepted, Superseded, Deprecated.

---

## ADR-0001 — Fork strategy: GitHub fork preserving upstream relationship

- **Status:** Accepted.
- **Context:** NexBot is MIT-licensed (Copyright (c) Atai Barkai). The owner
  needs to change the runtime's reliance on CopilotKit-hosted services while
  keeping the ability to pull upstream fixes. A clean-room rewrite would discard
  history and attribution and make future merges impractical.
- **Decision:** Continue as a GitHub fork (`KayzenRoot/OpenDots`) of
  `CopilotKit/OpenDots`, preserving upstream commit history and the upstream
  `LICENSE`. Upstream HEAD at fork time: `d4214aff10f066911f3253cb3cb870764cd51a9f`.
- **Consequences:** Upstream commits can be merged; MIT attribution is
  preserved; the fork's own commits are clearly downstream. Divergence must be
  managed deliberately (the seam table in
  [ARCHITECTURE.md](./ARCHITECTURE.md) §4 is the contract to re-audit on
  merges).
- **Alternatives:** (a) clean-room rewrite — rejected: loses history and
  attribution, high cost; (b) vendoring upstream as a submodule — rejected:
  poorer fork/PR workflow; (c) staying on upstream and only configuring —
  rejected: cannot remove the hosted dependency.

---

## ADR-0002 — Decouple hosted services but retain MIT local libraries

- **Status:** Accepted.
- **Context:** The upstream CopilotKit surface mixes hosted/proprietary pieces
  (`CopilotKitIntelligence`, `IntelligenceAgentRunner`, runtime Intelligence
  mode, `IntelligenceAgent`, `@copilotkit/channels`, hosted learning containers,
  telemetry) with MIT, local-only libraries (`@copilotkit/runtime`,
  `@copilotkit/react-core`).
- **Decision:** Replace the hosted pieces; **retain** `@copilotkit/runtime` and
  `@copilotkit/react-core` (MIT, v1.75.0) as local-only libraries. They drive
  the open AG-UI protocol against our own endpoint, require no account/key, and
  make no call to a CopilotKit host.
- **Consequences:** A surgical decoupling rather than a full excision. The
  decoupling contract is the seam table. `@copilotkit/*` appears in
  `package.json` but is not a hosted dependency.
- **Alternatives:** (a) full excision of all `@copilotkit/*` — rejected: forces
  rewriting the client and protocol plumbing with no security or operational
  benefit; (b) leave everything and only document — rejected: fails the core
  requirement.

---

## ADR-0003 — PostgreSQL for conversations only

- **Status:** Accepted.
- **Context:** Conversations need concurrent, durable, append-heavy persistence
  and local REST thread endpoints. The rest of the application (workspace,
  pages, tasks, memories, MCP, computers, settings) is fine on the existing
  `node:sqlite` store and moving it all increases blast radius.
- **Decision:** PostgreSQL stores conversations only: `conversations`,
  `messages`, `thread_runs`, `thread_events`, `thread_state`, plus the `skills`
  store and `schema_migrations`. All other state remains in SQLite
  (`data/nexbot.sqlite`).
- **Consequences:** Two datastores, joined by application-level IDs only (see
  [DATA-MODEL.md](./DATA-MODEL.md) §2.1). No shared transaction; backups and
  restores must be paired. Contained blast radius for the migration.
- **Alternatives:** (a) everything in Postgres — rejected: larger migration,
  more risk; (b) everything in SQLite — rejected: concurrency/scale and a
  credible local thread backend are better served by Postgres; (c) SQLite for
  threads too — the hosted store's replacement should use a real server DB.

---

## ADR-0004 — SSE runtime mode with LocalThreadEndpointRunner instead of Intelligence mode

- **Status:** Accepted.
- **Context:** Upstream constructs `CopilotRuntime` in Intelligence mode (needs
  `intelligence:` and a key) and uses a hosted realtime runner. The client's
  `useThreads()` depends on runtime REST thread endpoints.
- **Decision:** Use `CopilotRuntime` in **SSE mode** (`CopilotSseRuntime`):
  options take `runner?: AgentRunner` and `intelligence?: undefined` /
  `channels?: undefined`. Implement `PostgresAgentRunner extends AgentRunner
implements LocalThreadEndpointRunner` (with `ɵsupportsLocalThreadEndpoints:
true`). Server-side turns use `HttpAgent` (`@ag-ui/client`) against our own
  `/api/copilotkit/run`, and the `z.literal('intelligence')` gate is removed.
- **Consequences:** MIT runtime mode, no key. The REST thread endpoints the
  client needs are served locally, so the client is unchanged. Evidence and
  rationale in [ARCHITECTURE.md](./ARCHITECTURE.md) §5.
- **Alternatives:** (a) keep Intelligence mode — rejected: requires the hosted
  service; (b) a non-CopilotKit runtime — rejected: larger change; SSE mode
  already provides the needed contract; (c) rewrite the client to not use thread
  REST endpoints — rejected: unnecessary risk.

---

## ADR-0005 — Reimplement Slack self-hosted

- **Status:** Accepted.
- **Context:** Upstream Slack uses `@copilotkit/channels` `createChannel`, which
  requires Intelligence mode. Dropping Slack would be a parity regression.
- **Decision:** Rewrite `src/server/slack-channel.ts` to use the Slack Web API
  (bot token) plus a Slack Events API receiver with HMAC signing-secret
  verification, registered as its own Hono route (`/api/slack/events`), invoking
  the same local agent runner. Preserve explicit team + user allowlisting.
- **Consequences:** New webhook attack surface to secure and review (WORK-010);
  needs a public HTTPS endpoint. Full parity for the Slack channel without a
  hosted product.
- **Alternatives:** (a) drop Slack — rejected: parity loss; (b) keep managed
  channel — rejected: requires the hosted service.

---

## ADR-0006 — Reimplement learning locally

- **Status:** Accepted.
- **Context:** Upstream learning uses hosted learning containers and
  `getLearnedSkillsSnapshots`, gated by `learnedSkills: { containers, apiKey,
apiUrl }`. Skills are per-Dot data the owner can store locally.
- **Decision:** Implement `src/server/learning-store.ts` and the `skills` table:
  per-Dot skills with revisions and a delivery enabled/disabled flag, scoped by
  the conversation's `learning_container_id`/per-Dot key. Replace the hosted
  snapshot fetch; rewrite `learningSelector`.
- **Consequences:** Local, inspectable, owner-owned learning. Delivery semantics
  must be preserved and tested ([TEST-PLAN.md](./TEST-PLAN.md) §5.4).
- **Alternatives:** (a) drop learning — rejected: parity loss; (b) keep hosted
  containers — rejected: requires the hosted service.

---

## ADR-0007 — Self-hosted auth with owner token

- **Status:** Accepted.
- **Context:** The application is single-owner. Upstream already implements a
  timing-safe bearer `OWNER_TOKEN`, origin/host allowlisting, `sec-fetch-site`
  rejection, and runtime-scope validation.
- **Decision:** Retain and rely on the owner-token model. No per-user accounts,
  SSO, or multi-tenant identity in this fork.
- **Consequences:** Single-owner only, as upstream `SECURITY.md` already scopes.
  The owner token is the sole gate; rate limiting is external (proxy) or a
  WORK-010 item.
- **Alternatives:** (a) add an identity provider — rejected: out of scope,
  larger security surface; (b) rely on network isolation only — rejected: the
  app can be exposed behind a proxy.

---

## ADR-0008 — Remove CopilotKit telemetry

- **Status:** Accepted.
- **Context:** Upstream sends telemetry to `https://telemetry.copilotkit.ai/ingest`
  with `CPK_TELEMETRY_ID` / `COPILOTKIT_TELEMETRY_*`, plus setup reporting.
- **Decision:** Remove CopilotKit telemetry entirely. No outbound call to any
  CopilotKit host at runtime. Local setup status is retained for the app's own
  UI/behaviour, but it does not leave the owner's infrastructure.
- **Consequences:** No usage reporting leaves the server; `setup-telemetry.ts`
  must be trimmed of the hosted telemetry client; `compose.yml` and
  `.env.example` drop the related variables.
- **Alternatives:** (a) keep telemetry opt-out — rejected: the fork's guarantee
  is "no outbound CopilotKit call", so opt-in residue is removed; (b) keep but
  redirect — rejected: nothing to redirect to.

---

## ADR-0009 — Deployment via Docker Compose on owner VPS

- **Status:** Accepted.
- **Context:** Upstream ships a `Dockerfile` and Compose files for app and
  browser, plus a separate computer-supervisor topology. The owner wants a
  self-hosted VPS deployment with no hosted account.
- **Decision:** Deploy with Docker Compose on an owner-controlled VPS: app +
  Postgres core, optional browser profile, optional computer supervisor
  (separate compose file). TLS at a reverse proxy; only `:443` public. Backup
  and restore for both datastores as one pair.
- **Consequences:** See [DEPLOYMENT.md](./DEPLOYMENT.md). Requires WORK-008
  (Postgres service, health endpoints, validated backup/restore).
- **Alternatives:** (a) bare-metal systemd — rejected: already containerized and
  the browser/computer isolation depends on containers; (b) a managed PaaS —
  rejected: the point is owner-controlled infrastructure; (c) Kubernetes —
  rejected: overkill for a single-owner app.

---

## ADR-0010 — Issue/PR migration approach and authorship limitations

- **Status:** Accepted.
- **Context:** The fork should carry over relevant upstream issues/PRs so the
  work is traceable to the community problems it resolves.
- **Decision:** Import the relevant upstream issues/PRs into the fork's tracker
  (WORK-002), keeping the original issue number in the title/body and linking
  the upstream URL. Because GitHub does not preserve original author identity
  when an issue is recreated in another repository, each imported item must
  state that it was imported from `CopilotKit/OpenDots` and must not imply the
  importer wrote the original report.
- **Consequences:** Provenance is explicit; authorship is attributed to the
  upstream reporter and the original URL, with the platform limitation stated.
  The mapping is recorded in [BACKLOG.md](./BACKLOG.md) §3.
- **Alternatives:** (a) do not migrate, only reference by URL — weaker
  traceability; (b) migrate silently — rejected: misattributes authorship;
  (c) rewrite issue text — rejected: destroys provenance.
