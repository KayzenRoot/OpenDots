# API Contracts

All owner-facing HTTP routes are served by the Hono app in `src/server/app.ts`
and the route modules it mounts. The agent runtime is served under
`/api/copilotkit/*`. This document records the surface, the auth model, and the
request/response shapes. Routes marked PLANNED are designed here and assigned a
work order.

## 1. Authentication and request guards

Applied to every `/api/*` request by middleware in `src/server/app.ts`:

| Guard                     | Behaviour                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner bearer token        | When `OWNER_TOKEN` is set, the `Authorization: Bearer <token>` value is compared to it with `timingSafeEqual` (constant-time). Failure → `401 {"error":"Enter your owner access token to unlock NexBot."}`. |
| Host allowlist (no token) | If no `OWNER_TOKEN` is configured, the request hostname must be `localhost`, `127.0.0.1`, `[::1]`, or a hostname from `APP_ORIGIN`. Otherwise → `403 {"error":"Unrecognized host."}`.                       |
| Origin allowlist          | If an `Origin` header is present, it must be in `APP_ORIGIN` (or, when unset, equal to the request origin). Otherwise → `403 {"error":"Cross-origin requests are not allowed."}`.                           |
| Fetch metadata            | `sec-fetch-site: cross-site` → `403 {"error":"Cross-site requests are not allowed."}`.                                                                                                                      |
| Body limit                | `/api/*` bodies are capped at 1,000,000 bytes → `413 {"error":"Request is too large."}`.                                                                                                                    |
| Content type              | Non-`GET`/`HEAD` requests must send `content-type: application/json` → otherwise `415 {"error":"Use application/json."}`.                                                                                   |
| Cache                     | `/api/*` responses are `Cache-Control: no-store`.                                                                                                                                                           |
| Startup guard             | Binding to a non-loopback `HOST` requires an `OWNER_TOKEN` of at least 24 characters (`src/server/index.ts` throws otherwise).                                                                              |

Origin resolution: `resolveAppOrigins` (`src/server/app-origin.ts`) splits
`APP_ORIGIN` on commas; in development it defaults to
`http://localhost:5173` and `http://127.0.0.1:5173`.

Response headers set at the server root (`src/server/index.ts`):
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a
`Content-Security-Policy` including `frame-ancestors 'none'` and a `connect-src`
that permits `'self'` plus the configured realtime origin (the Intelligence WS
origin upstream; this becomes unnecessary once the hosted realtime plane is
removed — WORK-004).

### Runtime scope validation

`validateRuntimeScope` (`src/server/runtime-scope.ts`) runs for `/api/copilotkit/*`
before dispatch. It:

- Matches the **whole** path (the SDK accepts suffix matches; accepting prefixes
  here would validate a thread different from the one dispatched).
- Rejects any unrecognized path and any route not in the allowlist below.
- Rejects the reserved suffixes `clear`, `info`, `inspector-metadata`,
  `inspector-learning`, `transcribe`, `cpk-debug-events`, `annotate` on
  `/threads/:id`.
- Rejects IDs containing `/`, `\`, or whitespace.
- Requires every `agentId` (path, body, or query) to be an existing Dot, and
  requires the path `agentId` and any body/query `agentId` to agree.
- Requires every referenced `threadId` to be owned by the workspace
  (`workspace.requireThread`), and requires path/body/query `threadId` to agree.
- Rejects on failure with `403 {"error":"This runtime route is not enabled in NexBot."}`.

## 2. Workspace, pages, computers, connections

### 2.1 Workspace and settings

| Method   | Path                             | Purpose                                                                                                                                                                                |
| -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/workspace`                 | `{ spaces, dots, conversations, setup, calls }`                                                                                                                                        |
| `POST`   | `/api/spaces`                    | Create a Space `{ name (≤60), description (≤500) }` → 201                                                                                                                              |
| `POST`   | `/api/dots`                      | Create a Dot/specialist `{ name, instructions, researchAllowed, memoryAllowed, appsAllowed, composioToolkits, learningContainerId?, skillDeliveryEnabled?, spaceIds?, spaceId }` → 201 |
| `PUT`    | `/api/dots/:id`                  | Update a Dot (same strict schema)                                                                                                                                                      |
| `POST`   | `/api/conversations`             | `{ dotId, title (≤120) }` → 201; `503` if setup incomplete                                                                                                                             |
| `GET`    | `/api/conversations/:id/capture` | Ephemeral thread capture                                                                                                                                                               |
| `GET`    | `/api/state`                     | `{ settings, tasks, memories, mode, configured }`                                                                                                                                      |
| `PATCH`  | `/api/settings`                  | `{ name?, paused?, researchAllowed?, memoryAllowed?, appsAllowed? }`                                                                                                                   |
| `POST`   | `/api/tasks`                     | `{ prompt (3–4000), intervalSeconds? (60..31536000), threadId }` → 201                                                                                                                 |
| `GET`    | `/api/tasks/:id`                 | Task detail (runs + events)                                                                                                                                                            |
| `POST`   | `/api/tasks/:id/actions`         | `{ action: 'run' \| 'pause' \| 'cancel' }`                                                                                                                                             |
| `PUT`    | `/api/tasks/:id/schedule`        | `{ intervalSeconds: number \| null }`                                                                                                                                                  |
| `POST`   | `/api/memories`                  | `{ text (1–2000) }` → 201                                                                                                                                                              |
| `PUT`    | `/api/memories/:id`              | Update a memory                                                                                                                                                                        |
| `DELETE` | `/api/memories/:id`              | Delete a memory                                                                                                                                                                        |
| `POST`   | `/api/setup-telemetry`           | Local setup event `{ kind: 'step_viewed' \| 'setup_abandoned', step }` (validated against server state)                                                                                |

Setup status is **not** a separate route: it is returned as `setup` inside
`GET /api/workspace`, computed by `setupStatus` (`src/server/platform-config.ts`
→ `{ intelligence, model, browser, voice, composio, slack, missing }`). After
WORK-004 the `intelligence` field and the `INTELLIGENCE_API_KEY` entry in
`missing` are removed.

### 2.2 Pages

| Method   | Path                                               | Purpose                                                            |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `GET`    | `/api/spaces/:spaceId/pages`                       | List pages in a Space                                              |
| `GET`    | `/api/spaces/:spaceId/pages/:id`                   | Get a page (with revision)                                         |
| `POST`   | `/api/spaces/:spaceId/pages`                       | Create page `{ title (≤160), content (≤100000), parentId? }` → 201 |
| `PATCH`  | `/api/spaces/:spaceId/pages/:id`                   | Patch page (requires `expectedRevision`; revision check)           |
| `DELETE` | `/api/spaces/:spaceId/pages/:id`                   | Delete page                                                        |
| `POST`   | `/api/spaces/:spaceId/pages/:id/conversation`      | Bind a Dot conversation to a page `{ dotId }`                      |
| `POST`   | `/api/conversations/:id/page`                      | Save conversation to a page `{ title, parentId }`                  |
| `GET`    | `/api/conversations/:id/page-context`              | `{ id, spaceId, title }` or `null`                                 |
| `GET`    | `/api/conversations/:id/reviewed-page/:toolCallId` | Page review receipt (or `{ deleted }`)                             |
| `POST`   | `/api/conversations/:id/reviewed-page`             | Create a reviewed page draft → 201                                 |

### 2.3 Computers (optional; requires `COMPUTER_SUPERVISOR_URL` + tokens)

| Method  | Path                                 | Purpose                                                         |
| ------- | ------------------------------------ | --------------------------------------------------------------- |
| `GET`   | `/api/dots/:id/computer`             | Status                                                          |
| `PATCH` | `/api/dots/:id/computer/permissions` | Update permissions (owner-only)                                 |
| `POST`  | `/api/dots/:id/computer/start`       | Start the Dot's computer                                        |
| `POST`  | `/api/dots/:id/computer/stop`        | Stop it                                                         |
| `POST`  | `/api/dots/:id/computer/take`        | Human takes control                                             |
| `POST`  | `/api/dots/:id/computer/release`     | Human releases control                                          |
| `POST`  | `/api/dots/:id/computer/actions`     | `{ action, input }` — forwarded to the supervisor (owner actor) |

Error mapping: `404` Dot not found; `403` permission disabled or
non-owner human control; `409` computer not started or no active control
request; `400` unknown action; `503` supervisor unavailable.

### 2.4 Connections (MCP) and approvals

| Method   | Path                                                      | Purpose                                                                            |
| -------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET`    | `/api/dots/:id/connections`                               | List MCP connections for a Dot                                                     |
| `POST`   | `/api/dots/:id/connections`                               | Add `{ name (≤40), url (http(s), no embedded credentials), token? (≤4096) }` → 201 |
| `POST`   | `/api/connections/:id/refresh`                            | Re-list tools from the MCP server                                                  |
| `PATCH`  | `/api/connections/:id/tools/:name`                        | `{ enabled?, requiresApproval? }`                                                  |
| `DELETE` | `/api/connections/:id`                                    | Remove a connection                                                                |
| `GET`    | `/api/conversations/:id/connection-approvals/:approvalId` | Pending approval detail (own thread only, 1-hour TTL, tool still enabled)          |
| `GET`    | `/api/conversations/:id/connection-actions/:toolCallId`   | Stored action result                                                               |
| `POST`   | `/api/conversations/:id/connection-actions`               | Approve and run a stored request `{ toolCallId, ... }`                             |

The approval path runs **only** its own stored connection, tool, and arguments —
never arguments supplied with the approval. `APPROVAL_TTL_MS` bounds the window.

### 2.5 Voice (optional)

| Method | Path                           | Purpose                                                                                              |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `POST` | `/api/voice/calls`             | `{ threadId, sdp (≤100000) }` → 201 call record                                                      |
| `GET`  | `/api/voice/calls/:id`         | Call status                                                                                          |
| `POST` | `/api/voice/calls/:id/active`  | Mark active                                                                                          |
| `POST` | `/api/voice/calls/:id/compute` | `{ toolCallId, request, transcript }` → `{ text }` (routes through the same permission-scoped agent) |
| `POST` | `/api/voice/calls/:id/end`     | `{ transcript (≤20000), anchorMessageId? }` → persist receipt                                        |

## 3. Agent runtime: `/api/copilotkit/*`

Mounted by `app.all('/copilotkit/*', (c) => platform.handle(c.req.raw))` inside
`src/server/workspace-routes.ts`; dispatched by `Platform.handle`
(`src/server/platform.ts`) through the CopilotKit Hono handler
(`createCopilotHonoHandler`, `basePath: '/api/copilotkit'`, `cors: { origin: [] }`).

### 3.1 AG-UI endpoints

| Method | Path                                            | Purpose                                                                                                                                                                                                                           |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/copilotkit/info`                          | Runtime/agent discovery; returns runtime mode and agents. Upstream returns `mode: 'intelligence'`; after WORK-004 the `z.literal('intelligence')` gate is removed and server turns read agents without requiring a hosted WS URL. |
| `POST` | `/api/copilotkit/agent/:agentId/run`            | Start an AG-UI run for a Dot in a thread (`threadId` in body). Streams AG-UI events.                                                                                                                                              |
| `POST` | `/api/copilotkit/agent/:agentId/connect`        | Connect to an in-flight run.                                                                                                                                                                                                      |
| `POST` | `/api/copilotkit/agent/:agentId/suggest`        | Run suggestions.                                                                                                                                                                                                                  |
| `POST` | `/api/copilotkit/agent/:agentId/stop/:threadId` | Abort an in-flight run.                                                                                                                                                                                                           |
| `POST` | `/api/copilotkit/threads/subscribe`             | Subscribe to thread updates.                                                                                                                                                                                                      |

Server-side turns (`src/server/headless.ts`, used by voice compute and scheduled
tasks) call `/api/copilotkit/run` with the owner bearer header via `HttpAgent`
from `@ag-ui/client` (PLANNED — WORK-004).

### 3.2 Thread REST endpoints served by the local runner

These are the endpoints `useThreads()` and the thread UI depend on. In the fork
they are served locally because `PostgresAgentRunner` implements
`LocalThreadEndpointRunner` (see [ARCHITECTURE.md](./ARCHITECTURE.md) §5).

| Method   | Path                                         | Purpose                               |
| -------- | -------------------------------------------- | ------------------------------------- |
| `GET`    | `/api/copilotkit/threads`                    | List threads (conversation list)      |
| `GET`    | `/api/copilotkit/threads/:threadId/messages` | Thread messages (`getThreadMessages`) |
| `GET`    | `/api/copilotkit/threads/:threadId/events`   | Streamed events (`getThreadEvents`)   |
| `GET`    | `/api/copilotkit/threads/:threadId/state`    | Current state (`getThreadState`)      |
| `POST`   | `/api/copilotkit/threads/:threadId/archive`  | Archive a thread                      |
| `PATCH`  | `/api/copilotkit/threads/:threadId`          | Rename/metadata                       |
| `DELETE` | `/api/copilotkit/threads/:threadId`          | Delete a thread (`clearThreads`)      |

Response shapes are the runtime's existing REST contract; the replacement store
returns equivalent payloads so the client is unchanged.

### 3.3 Runtime error shape

`Platform.handle` returns `503 {"error":"Setup required: …"}` when the runtime is
not ready, and `403 {"error":"<scope message>"}` on scope failure. Generic
`onError` returns `500 {"error":"The server could not complete this request. Check
server logs and database access."}` and logs only `error.name`.

## 4. New routes introduced by the fork

### 4.1 Slack Events API webhook (PLANNED — WORK-005)

| Method | Path                | Purpose                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/slack/events` | Slack Events API receiver. Verifies the `X-Slack-Signature` HMAC-SHA256 against the signing secret over `v0:<timestamp>:<raw body>` and rejects stale timestamps; answers Slack's `url_verification` challenge; ignores events from anyone but the allowlisted owner/workspace; dispatches eligible messages to the local agent runner. |

Constraints: the raw request body is needed for signature verification, so this
route must read the body before JSON parsing and is exempt from the generic
JSON content-type requirement (its own verifier applies).

### 4.2 Health and readiness (PLANNED — WORK-008)

| Method | Path          | Purpose                                                                                                                                                    |
| ------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health` | Liveness: `200 {"ok":true}` when the process is serving. No auth, no datastore access.                                                                     |
| `GET`  | `/api/ready`  | Readiness: reports `{ ok, sqlite, postgres, setup }`. `503` until SQLite is reachable, Postgres is reachable and migrated, and required config is present. |

The browser service already exposes `GET /health` → `{"ok":true}`
(`src/browser/index.ts:130`), and its only other route is
`POST /browse { url }` gated by `BROWSER_SECRET` (timing-safe) with a
`bodyLimit` of 16,384 bytes and an internal busy guard (`429` when busy). The app
server has no health route upstream; adding it is part of WORK-008.

### 4.3 Error shape for owner routes

Owner routes return `{"error": "<message>"}` with an appropriate status; Zod
validation failures map to `400`. `src/server/workspace-routes.ts` maps known
error prefixes to `400`/`404`/`503`; `src/server/connection-routes.ts` and
`src/server/computer-routes.ts` map their own domain errors.
