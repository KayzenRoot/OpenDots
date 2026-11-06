# Overview

## What NexBot is

NexBot is a self-hosted personal-agent application template. It presents a
single-owner workspace ("Spaces" containing documents and "Dots" – specialist
agents), a chat surface, document editing, background/scheduled execution,
optional voice, optional persistent per-Dot computers, optional MCP
integrations, and optional Slack. It is a single npm package (no monorepo),
TypeScript/ESM, requiring Node >= 24.

Upstream, the application is built as a template around CopilotKit's hosted
product surface: `CopilotKitIntelligence` for thread/message persistence and
memory, hosted realtime agent execution, hosted Slack "channels", hosted
learning containers, and CopilotKit telemetry. Upstream README and
`package.json` describe it as "A self-hosted personal-agent template with
CopilotKit Intelligence, Threads, and Channels."

## What this fork is

This fork, `https://github.com/KayzenRoot/nexbot`, is an **independent,
decoupled** continuation of upstream. It keeps the application and its
open-protocol runtime, and it **removes the mandatory dependency on
CopilotKit-hosted services and API keys**. After this fork's work is complete,
the application runs entirely on owner-controlled infrastructure: the
application server, a PostgreSQL database owned by the operator, and an
owner-selected OpenAI-compatible model endpoint.

The fork is not a rewrite. The user interface is unchanged. Specifically, the
client's conversation-list behaviour (`useThreads()` and the ThreadList UI)
depends on runtime REST thread endpoints; this fork keeps those endpoints by
implementing them locally, so the client needs no rewrite (see
[ARCHITECTURE.md](./ARCHITECTURE.md)).

This fork is built to be maintainable against upstream: it is a GitHub fork
that preserves upstream history and attribution, and the upstream `LICENSE`
(MIT, Copyright (c) Atai Barkai) is retained in full.

## What changed vs upstream

| Area                 | Upstream                                                                | This fork                                                                  |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Conversation storage | Hosted `CopilotKitIntelligence` threads/messages                        | Self-hosted PostgreSQL (`PostgresConversationStore`)                       |
| Agent execution      | Hosted `IntelligenceAgentRunner` realtime WS gateway                    | Local `PostgresAgentRunner` implementing `LocalThreadEndpointRunner`       |
| Runtime mode         | `CopilotRuntime` Intelligence mode (needs `intelligence:` + key)        | `CopilotRuntime` SSE mode (`CopilotSseRuntime`), MIT, no key               |
| Server-side turns    | `IntelligenceAgent` (`@copilotkit/core`) over `info.intelligence.wsUrl` | `HttpAgent` (`@ag-ui/client`) over open AG-UI to own `/api/copilotkit/run` |
| Slack                | Managed `@copilotkit/channels` `createChannel`                          | Self-hosted Slack Web API + Events API integration                         |
| Learning/skills      | Hosted learning containers, `getLearnedSkillsSnapshots`                 | Local PostgreSQL skills store (`learning-store.ts`)                        |
| Telemetry            | CopilotKit ingest + `CPK_TELEMETRY_ID`                                  | Removed; no outbound call to any CopilotKit host                           |
| Required secrets     | `CPK_INTELLIGENCE_API_KEY` / `INTELLIGENCE_API_KEY`                     | None for CopilotKit; only an OpenAI-compatible model endpoint              |

**Retained deliberately:** `@copilotkit/runtime` and `@copilotkit/react-core`
(MIT, v1.75.0) stay as local-only libraries. They drive the open AG-UI protocol
against our own endpoint, require no account and no key, and make no call to a
CopilotKit host. See ADR-0002 in [DECISIONS.md](./DECISIONS.md).

## Who it is for

- A single owner/operator who wants a personal agent workspace on their own
  server (VPS or home machine) without an account with, or a key from, any
  hosted agent platform.
- An operator who wants to point the agent runtime at any OpenAI-compatible
  endpoint: OpenAI, Ollama, LM Studio, vLLM, OpenRouter, Groq, Together, etc.
- An auditor or maintainer who needs a precise, evidence-backed record of what
  was decoupled, why, and how it is verified.

It is explicitly **not** a multi-tenant SaaS, and upstream `SECURITY.md`
already states the prototype is single-owner. Multi-user enforcement is out of
scope (see [SCOPE.md](./SCOPE.md)).

## Deployment story

The target deployment is Docker Compose on an owner-controlled VPS:

- **app** — Hono server on `@hono/node-server` serving the built React client
  from `dist/client` and the API on port `4310`.
- **Postgres** — owner-managed database for conversations only.
- **browser** (optional profile) — isolated read-only Playwright service on
  `4311`, needed only for `WEB_SEARCH_PROVIDER=browser`.
- **computer supervisor** (optional, separate compose file) — the only
  component that mounts the Docker socket; pinned to OpenBot commit
  `b6932d31a8d6e7896c15139dfc27a6c6911deb27`.

No CopilotKit account, project selection, or API key is needed. The only
mandatory third-party credential is an OpenAI-compatible model endpoint
(`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`). All other integrations
(voice, web search, Composio, Slack, computers, browser) are optional. See
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Document set

Start at [README.md](./README.md) for the full index. The current status of
every claim in this document, including what is implemented versus planned, is
in [CHECKPOINT.md](./CHECKPOINT.md) and
[DEFINITION-OF-DONE.md](./DEFINITION-OF-DONE.md).
