# Security

Fork-specific security posture for the decoupled NexBot fork. This document
supplements, and does not replace, the upstream `SECURITY.md` (retained in the
repository root). Where upstream's intended boundary still applies, it is
restated; where the fork changes the exposure, it is called out. Each item is
explicit about whether it is hardened today or not yet hardened.

## 1. Threat model summary

| Actor / asset                             | Threat                                                                 | Current posture                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Owner browser → app                       | Unauthorized API access                                                | Owner bearer token + origin/host allowlist + `sec-fetch-site` (hardened upstream, retained)                           |
| Cross-Dot requests                        | A client addressing another Dot's thread                               | `validateRuntimeScope` path/ID/ownership validation (hardened, retained)                                              |
| Model/tool output                         | Prompt injection escalating to permission changes or command execution | Output treated as untrusted data; tools are permission-gated (invariant retained; hardening incomplete — see §7)      |
| Agent research browsing                   | SSRF to private/internal networks                                      | DNS-pinned, redirect-blocked, public-address-only fetcher (hardened, retained)                                        |
| External content (fetched pages, uploads) | Injection into prompts                                                 | Explicitly labelled untrusted in agent instructions (retained)                                                        |
| Slack workspace                           | Spoofed actor / unsigned webhook                                       | Allowlisted team + user ids; self-hosted receiver must verify the Slack signing secret (PLANNED — WORK-005)           |
| VPS host                                  | Container escape / privilege escalation                                | `no-new-privileges`, `cap_drop: ALL`, non-root `node` user, read-only browser container (hardened upstream, retained) |
| Docker socket                             | Container control from the app                                         | Only the computer supervisor mounts the socket (retained; see §5)                                                     |
| Datastores                                | Data loss / unauthorized read                                          | SQLite file perms; Postgres to be secured in WORK-008/010 (see §9)                                                    |
| CopilotKit cloud                          | Outbound data exfiltration to a host                                   | Removed entirely (PLANNED — WORK-004)                                                                                 |

## 2. Authentication

- **Owner token.** When `OWNER_TOKEN` is set, every `/api/*` request must carry
  `Authorization: Bearer <token>`, compared with `timingSafeEqual` (constant
  time). Binding to a non-loopback `HOST` refuses to start without a token of at
  least 24 characters (`src/server/index.ts`).
- **Host/origin allowlist.** Without a token, only loopback hostnames are
  accepted. With `APP_ORIGIN`, only listed origins are accepted; an unexpected
  `Origin` or `sec-fetch-site: cross-site` is rejected (`src/server/app.ts`,
  `src/server/app-origin.ts`).
- **No multi-user identity.** There is no per-user account system. The workspace
  is single-owner. `SECURITY.md` upstream states Space membership, Slack
  identity mapping, and voice delegation need more enforcement before
  multi-user use. **Not hardened:** this fork does not add multi-user
  enforcement (out of scope; see [SCOPE.md](./SCOPE.md)).

## 3. Agent and tool permission boundaries

- Dots carry `researchAllowed`, `memoryAllowed`, `appsAllowed`, and
  `composioToolkits`; each restricts the tools the agent may invoke.
- MCP tools are per-tool `enabled` / `requiresApproval`. Approval-gated calls
  run only their own stored connection/tool/arguments, within the conversation
  that requested them, within `APPROVAL_TTL_MS`, and only while the tool is
  still enabled (`src/server/connection-routes.ts`).
- Computer actions are gated by computer permissions; human control is
  owner-only (`src/server/computer-service.ts`, `src/server/computer-routes.ts`).
- Page writes use revision checks (`expectedRevision`), preventing lost-update
  and replay of stale drafts.
- **Not hardened:** there is no application-level rate limiting on agent runs
  or tool calls (only a browser busy guard and a six-compute-turn voice limit).
  A single owner can still exhaust provider quota. Recommended in WORK-010.

## 4. Browser service isolation

- The browser service (`src/browser/index.ts`) is a separate Hono app requiring
  `BROWSER_SECRET` (≥24 chars), timing-safe compared; it returns `401`
  otherwise. Its only functional route is `POST /browse`.
- It enforces an uncompromising SSRF posture: `validateUrl`
  (`src/browser/security.ts`) allows only `http`/`https`, rejects embedded
  credentials, restricts ports to 80/443, rejects loopback/`.local`, resolves
  DNS itself, and rejects any private/special address (RFC1918, link-local,
  CGNAT, multicast, IPv6 ULA/link-local etc.). Requests are DNS-pinned to the
  validated IP (`src/browser/transport.ts`), so a TOCTOU DNS rebind cannot
  redirect the connection.
- Redirects are **rejected before Playwright sees the Location header**;
  `set-cookie` and other hop headers are stripped; responses are capped at
  5 MB and 10 s; requests run in a `javaScriptEnabled: false` context with
  service workers blocked and downloads disabled; a single-flight busy guard
  returns `429`.
- Deployment: the browser container is `read_only`, `cap_drop: ALL`,
  `no-new-privileges`, `shm_size: 256mb`, on an **internal** network, and must
  never be publicly exposed. `WEB_SEARCH_PROVIDER=browser` is the only feature
  that needs it.

## 5. Docker socket exposure

- The application container does **not** mount the Docker socket.
- Only the computer supervisor mounts it, in the separate
  `compose.computers.yml` topology; the supervisor is pinned to OpenBot commit
  `b6932d31a8d6e7896c15139dfc27a6c6911deb27`.
- The app talks to the supervisor over HTTP with
  `COMPUTER_SUPERVISOR_URL`/`COMPUTER_SUPERVISOR_TOKEN`, and per-computer
  requests are authenticated with an HMAC (`createHmac('sha256', COMPUTER_TOKEN)`
  over `nexbot-computer:<id>`, `src/server/computer-service.ts`).
- **Not hardened:** the supervisor's own container sandboxing and image trust
  are upstream OpenBot concerns, not re-reviewed here.

## 6. Secret handling

- Secrets are server-side environment variables (`.env` is loaded via
  `--env-file-if-exists`; never committed — `.gitignore`).
- Provider errors are sanitized before logging or posting to Slack:
  `safeFailure` (`src/server/slack-channel.ts`) reduces any error to a safe
  name plus an integer HTTP status, so credentials in provider messages cannot
  leak into logs (`reportChannelFailure`).
- `.env.example` lists every secret but no real values; `compose.yml` requires
  `OWNER_TOKEN` via `${OWNER_TOKEN:?...}` and passes other secrets from the
  host environment.
- **Not hardened:** no secret rotation tooling, no vault integration, no
  encryption of MCP `token` values at rest in SQLite (stored as text in
  `mcp_connections.token`).

## 7. SSRF and command injection

- **SSRF:** the research browser path is hardened (§4). MCP connection URLs are
  validated as `http(s)` with no embedded credentials
  (`connectionInput`, `src/server/connections.ts`), but an owner-configured MCP
  endpoint may still point at an internal address — this is accepted because
  the owner configures it, and it must be reviewed in WORK-010.
- **Command injection:** the server does not build shell commands from model
  output. Computer actions are a fixed action enum forwarded to the supervisor;
  unknown actions are rejected (`400`). Page and memory writes are bounded
  strings. Research is read-only.
- **Not hardened:** agent/tool output is not executed, but it _is_ rendered
  (Markdown) and fed back into the model. Rendering and content-security
  policy reduce but do not eliminate indirect prompt-injection risk. No
  systematic injection testing exists yet (WORK-010).

## 8. File access restrictions

- Page documents are the only agent-writable files; they live in SQLite and are
  written through page tools with revision checks. There is no general-purpose
  filesystem tool exposed to the agent in this fork's retained surface.
- Computer filesystem access, when enabled, happens inside the per-Dot
  computer container, not on the host, and is bounded by computer permissions.
- **Not hardened:** the app's own process has read/write access to
  `data/nexbot.sqlite`; container filesystem hardening relies on the compose
  settings in §5, not on an application sandbox.

## 9. Rate limiting

- Present: browser single-flight (`429` when busy, 40 s deadline), voice
  six-compute-turn cap, `AGENT_RUN_TIMEOUT_MS` and turn time limits,
  `bodyLimit` on `/api/*` (1 MB) and the browser (16 KB).
- **Not hardened:** no per-IP/per-token request rate limiting on `/api/*`, no
  agent-run concurrency cap at the HTTP layer, no login throttling. The owner
  token is the only gate. Recommended in WORK-010 and can be added at the
  reverse proxy (see [DEPLOYMENT.md](./DEPLOYMENT.md)).

## 10. Database security and backups

- **SQLite:** `node:sqlite` `DatabaseSync`, WAL mode, `busy_timeout=5000`. File
  permissions depend on the container user (`node`) and volume ownership.
  Backed up as a file (see [DEPLOYMENT.md](./DEPLOYMENT.md)).
- **Postgres (PLANNED):** must use a dedicated role, a strong password, and
  network isolation so only the app reaches it. The pool (`src/server/pg.ts`)
  uses parameterized queries; no string-concatenated SQL from request data.
  Migrations run with a minimal-privilege role. **Not hardened:** connection
  TLS mode, at-rest encryption, and role hardening are specified in WORK-008 and
  reviewed in WORK-010.
- **Recovery unit:** the two stores share conversation IDs (see
  [DATA-MODEL.md](./DATA-MODEL.md) §2.1). Backups of Postgres and SQLite must be
  taken and restored as one consistent pair, or references will dangle.

## 11. Dependency vulnerabilities

- The project pins versions and uses `renovate.json` for updates; CI runs knip
  in report-only mode. `package.json` carries an `undici` override
  (`^6.29.0`).
- **Not hardened:** there is no automated `npm audit` gate in CI and no SBOM.
  WORK-010 requires a dependency-vulnerability pass before release, with no
  unresolved HIGH/CRITICAL findings (per
  [DEFINITION-OF-DONE.md](./DEFINITION-OF-DONE.md)).

## 12. Untrusted agent/tool output

- Page text, fetched pages, memory, and model output are treated as untrusted
  data, never as authorization to change permissions (`SECURITY.md`, retained).
- The research brief prompt explicitly instructs the model that source pages
  and memories are untrusted data and never instructions, and forbids claiming
  actions it cannot take (`src/server/research.ts`).
- Voice `ask_compute` results are the only source of truth for the voice
  agent; it is instructed never to claim work happened without a tool result
  (`src/server/voice.ts`).
- **Not hardened:** there is no output sanitizer for tool results beyond
  Markdown rendering and the existing CSP; indirect injection remains a
  residual risk.

## 13. CopilotKit-specific exposure removed (PLANNED — WORK-004)

- Removal of `CopilotKitIntelligence`, the hosted realtime WS plane, the hosted
  Slack channel, hosted learning containers, and CopilotKit telemetry removes
  all outbound calls to CopilotKit hosts and the requirement for
  `CPK_INTELLIGENCE_API_KEY` / `INTELLIGENCE_API_KEY`.
- Until WORK-004 lands, the upstream exposure remains: the app can be
  configured to send conversation data to CopilotKit's hosted services. This is
  the single most important security reason for the fork.

## 14. Reporting

Follow the upstream `SECURITY.md` reporting guidance: use the repository's
private vulnerability reporting feature when available; otherwise open an issue
requesting a private channel without exploit details, credentials, private
URLs, or personal data. No SLA or bounty is offered.
