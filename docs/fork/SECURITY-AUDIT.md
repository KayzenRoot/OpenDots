# Security audit (WORK-010)

Date: 2026-11-05. Scope: branch `fork/decouple-and-harden` at the commit that
introduced `5b23a9e`, plus the running Compose stack (`nexbot-app`,
`nexbot-postgres`) on the operator host.

Method: source review of every new security-relevant module, `npm audit` on the
full and production trees, live probes against the running deployment, and a
backup/restore round-trip on real data. No penetration test of the VPS was
possible (no VPS access in this session).

## Verdict

**CORRECTION REQUIRED** — not because of an unresolved critical defect (none is
open), but because the deployment has never run on the target VPS and several
acceptance criteria in [DEFINITION-OF-DONE.md](./DEFINITION-OF-DONE.md) remain
unverified in production conditions. Gate blockers are listed at the end.

## Findings

| ID  | Severity | Status       | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | High     | **Fixed**    | `deployment/restore.sh` could not replace the SQLite file. The app service drops all capabilities, so the restore helper ran as root but could not unlink a file owned by `node`; after `chown` it could not `chmod` either. Restore failed and left the app crash-looping on a root-owned database (`attempt to write a readonly database`). Fixed by granting only `DAC_OVERRIDE` + `CHOWN` to that one-shot container and ordering `chmod` before `chown`. Found by the round-trip test, not by review. |
| F2  | Critical | **Fixed**    | `dompurify` ≤ 3.4.16 — sanitiser bypass (GHSA-cg2g-xh64-v4q7) plus two related advisories. It sanitises rendered markdown, so this was reachable with untrusted agent or page content. Pinned to `^3.4.17` via `overrides`.                                                                                                                                                                                                                                                                                |
| F3  | High     | **Fixed**    | `zod` < 4.6.6 — memory exhaustion while validating oversized collections (GHSA-mrhx-c7xc-m3w5). Root cause of most transitive high findings. Bumped to 4.6.7.                                                                                                                                                                                                                                                                                                                                              |
| F4  | High     | **Fixed**    | `@modelcontextprotocol/sdk` 1.31.0 advisories (session-unbound experimental tasks, oversized single-request handling). Bumped to 1.32.2.                                                                                                                                                                                                                                                                                                                                                                   |
| F5  | Moderate | **Accepted** | `@hono/node-server` `serveStatic` decodes the request path a second time. 2.1.6 is the latest published version, so no fix exists yet. Exposure is bounded: the static root is a fixed `./dist/client`, the process runs non-root with all capabilities dropped, and no user-controlled path selects a file. Track upstream.                                                                                                                                                                               |
| F6  | High     | **Accepted** | `@graphql-tools/utils` prototype pollution, reached through `@copilotkit/runtime-client-gql`. The fork runs the runtime in SSE mode and never issues GraphQL requests, so the path is not exercised. It is also not removable without dropping the MIT runtime packages (see [DECISIONS.md](./DECISIONS.md)).                                                                                                                                                                                              |
| F7  | High     | **Accepted** | `body-parser` denial of service. Belongs to the Express adapter shipped inside `@copilotkit/runtime`; this deployment is Hono-only and never mounts it.                                                                                                                                                                                                                                                                                                                                                    |
| F8  | Moderate | **Accepted** | `fast-uri` and `@vitest/mocker` advisories. `fast-uri` sits under tooling; `@vitest/mocker` is a dev-only test runner and is not shipped in the production image (`npm ci --omit=dev`).                                                                                                                                                                                                                                                                                                                    |

Production dependency audit after remediation: **0 critical, 26 high, 6 moderate,
6 low** (was 1 critical / 27 high / 6 moderate / 6 low of 40 total). Every
remaining high is transitive and falls into F5–F7.

## Controls verified

- **Owner authentication.** External binding refuses to start without
  `OWNER_TOKEN` of at least 24 characters. Every `/api` route except
  `/api/health`, `/api/ready` and `/api/slack/events` requires it.
- **Slack webhook authentication.** HMAC-SHA256 over `v0:{timestamp}:{body}`,
  compared with `timingSafeEqual`; the length check precedes the comparison and
  only reveals a fixed public format. Requests outside a five-minute window are
  rejected. The handler reads the raw body with `c.req.text()` and verifies
  **before** `JSON.parse`. With no signing secret the route answers 401.
  Verified live: unsigned request → 401, correctly signed event → 200.
- **Authorisation after authentication.** A signed event still has to match
  `SLACK_TEAM_ID` and an explicit `SLACK_USER_IDS` entry, and must come from a
  human actor in the configured channel. Bot and self messages are ignored.
  Handler failures are logged through `safeFailure`, which strips provider
  messages and stacks.
- **Runtime scope.** `validateRuntimeScope` blocks cross-Dot access and denies
  routes the local runtime does not serve, before delegating to the SDK handler.
- **Network exposure.** Postgres publishes no port and is reachable only on the
  internal network. The app publishes on loopback only. The computer supervisor
  is the sole service that mounts the Docker socket.
- **Container hardening.** `cap_drop: ALL`, `no-new-privileges`, `init: true`,
  non-root `node` user, resource limits on app and Postgres.
- **Secret handling.** Credentials live in `.env` / `compose.env`, both outside
  version control. The repository was scanned for `xoxb-`, `oc_sk_` and the
  signing secret; only a literal `xoxb-fake-token-for-tests` fixture matches.
- **Telemetry.** No request to any `copilotkit.ai` host was observed from the
  built client in a real browser, and the server hard-disables the SDK's
  outbound telemetry path.
- **Readiness disclosure.** `/api/ready` returns only `ok` plus the _names_ of
  missing configuration; it never returns values or the full setup object.

## Residual risks (not defects, but accepted)

1. ~~No application-level rate limiting~~ **Addressed**: the public webhook is
   capped per client and failed token attempts are capped too, both with a real
   Retry-After. The limiter is in-process, so a multi-replica deployment needs a
   shared store; the proxy should still impose its own limits.
2. **Prompt-injected authority.** Page, web, MCP and Slack content reach the
   model as untrusted input. Tool permissions limit the blast radius, but no
   prompt-injection classifier is in place.
3. **Voice is pinned to `api.openai.com`** (`src/server/voice.ts`). Chat is
   provider-agnostic; voice is not, and should be disabled on a deployment that
   must avoid third-party model hosts entirely.
4. **The bundled CopilotKit web-inspector still contains its telemetry URL
   constant.** No request to it was observed, but it is not provably dead code.
5. **Ephemeral Request URL.** The live Slack app points at a temporary tunnel.
   Production must update the manifest to the VPS domain, otherwise events stop
   when the tunnel closes.
6. **`COMPOSE_PROJECT_NAME` is inherited from the host.** It was `hive-v102` on
   this machine; every command here passes `-p nexbot`. A deployment that
   omits it could join an unrelated project.

## Not verified

- Any behaviour on the actual VPS: TLS issuance, firewall, restart policy,
  backup/restore under production load.
- Slack retry/redelivery behaviour (Slack's own retries).
- Multi-user authorisation: the product is single-owner by design and the
  upstream security policy already states that Space membership and Slack
  identity mapping need more enforcement before multi-user use.

## Gate decision

The critical and high findings introduced by this fork are fixed. The verdict
stays **CORRECTION REQUIRED** because the deployment half of the acceptance
criteria is unproven: no VPS run, no production TLS, no restore under
production conditions. Close those, then re-run this audit.
