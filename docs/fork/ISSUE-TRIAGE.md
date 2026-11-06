# Triage of the inherited backlog

Reference: `main` at `085f16b`. 29 upstream issues and 45 upstream PRs are open
here, migrated from `CopilotKit/OpenDots`. Most were written against the hosted
Intelligence design that this fork removed, so a large part of the backlog is
already moot — closing it is not discarding work, it is recording that the
premise changed.

Nothing is closed yet. This document is the recommendation.

## Issues — close because the fork already fixed it (7)

These describe failures of the hosted CopilotKit Intelligence plane. That plane no
longer exists here: conversations are stored in PostgreSQL and the runtime runs
locally.

| #   | Why it is resolved                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------- |
| #37 | "Conversations require CopilotKit's cloud: add a local option" — the local option is the only option now |
| #40 | "Remove requirement for any Cloud API or Cloud model" — done; any OpenAI-compatible endpoint works       |
| #46 | "OpenAI only?" — no: base URL + model + key are configurable in the app                                  |
| #47 | Intelligence returns 503 when selecting a project — that step is gone                                    |
| #49 | Intelligence conversation creation 500/503 — the store is local                                          |
| #55 | Hosted realtime plane 404 on every WS path — SSE mode, no gateway                                        |
| #57 | Docs: Dot chat on LLMTR through OpenAI-compatible settings — the in-app provider setup covers it         |

## Issues — close as not actionable (8)

| #   | Reason                                                                                            |
| --- | ------------------------------------------------------------------------------------------------- |
| #17 | Title is empty ("Product"); nothing to act on                                                     |
| #39 | "Агенты" with no body; not actionable                                                             |
| #44 | "BAITA"; no content                                                                               |
| #16 | "Not open sourced." — it is MIT and public                                                        |
| #38 | "OpenDots on FeltDB" — unrelated third-party request                                              |
| #52 | A marketing request for free hosting and a README link                                            |
| #45 | Renovate's Dependency Dashboard — the bot driving it was upstream's, and the fork does not run it |
| #51 | Adopt Knip with staged non-blocking CI — already the state: CI runs Knip report-only              |

## Issues — close as not planned, with a pointer (3)

| #   | Pointer                                                                                          |
| --- | ------------------------------------------------------------------------------------------------ |
| #15 | A2A contacts / decision inbox — the delegation decision is #108; this design is superseded by it |
| #36 | Dots delegating to each other — same, #108                                                       |
| #41 | "Plugins and wider control" — too vague to scope; needs a concrete proposal                      |

## Issues — keep, these are real bugs (8)

Present in the code and worth fixing, in rough order of impact:

| #   | Bug                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #23 | Reasoning models fail every turn: tools + `reasoning_effort` rejected on `/v1/chat/completions`. Directly limits which models can be used — matters because the default is a reasoning model |
| #19 | `npm run dev` is POSIX-only; the Windows fallback 403s on every save. Affects this machine                                                                                                   |
| #24 | New conversation hangs on "Connecting to your conversation"                                                                                                                                  |
| #22 | Approving a Dot revision creates a duplicate page; edits skip existing pages                                                                                                                 |
| #48 | Space library keeps pages deleted in another tab                                                                                                                                             |
| #33 | Long page titles clipped in the editor                                                                                                                                                       |
| #34 | Page conversation panel overflows horizontally                                                                                                                                               |
| #35 | Small UI issues: Enter on home composer, unlabeled page chat input                                                                                                                           |

## Issues — keep as features aligned with the roadmap (3)

| #   | Feature                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| #53 | Delete specialist Dots — basic lifecycle gap                                                                                               |
| #56 | Delete a chat thread — basic lifecycle gap                                                                                                 |
| #43 | Ollama in first-run setup — partially covered: setting the base URL to a local Ollama already works; what is missing is a first-run preset |

## PRs — close, verified harmful (2)

| #    | Why                             |
| ---- | ------------------------------- |
| #100 | `@copilotkit/core` 1.84.1       |
| #101 | `@copilotkit/react-core` 1.84.1 |

Both were tested here: upgrading to 1.84.1 changes the AG-UI message types and
breaks `typecheck` in `Chat.tsx`. The runtime integration is validated against
1.75.0, so this upgrade needs its own change with the type migration, not a
dependency bump.

## PRs — close, already done here (3)

| #   | Why                                                                         |
| --- | --------------------------------------------------------------------------- |
| #98 | zod 4.6.7 — already pinned in this fork (it was the fix for a DoS advisory) |
| #73 | i18n pt-BR — shipped independently, with 572 keys and compile-time parity   |
| #68 | Inspector metadata polling — the inspector is no longer part of the runtime |

## PRs — close, conflicts with this fork's identity (2)

| #    | Why                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------- |
| #96  | Points readers to OpenBot "where OpenDots now lives" — wrong for a fork that continues independently |
| #102 | Same: leads with OpenDots as a skin in OpenBot                                                       |

## PRs — close, out of scope (3)

| #   | Why                                                                                |
| --- | ---------------------------------------------------------------------------------- |
| #66 | Sendblue iMessage/SMS — third-party paid channel                                   |
| #61 | iMessage via a local macOS bridge — macOS-only, this product targets Windows/Linux |
| #59 | ChatGPT plan inference (draft) — a provider/terms question, not a fork feature     |

## PRs — keep, small and useful (6)

| #   | What                                                       |
| --- | ---------------------------------------------------------- |
| #84 | Log MCP client close errors instead of swallowing them     |
| #85 | Reduce `dots()` N+1 queries to one batch                   |
| #87 | Trim `WEB_SEARCH_PROVIDER`                                 |
| #89 | Block only the IPv4 documentation /24s, not the whole /16s |
| #58 | Keep recurring tasks scheduled after a failed run          |
| #76 | Reconcile external page deletions without losing drafts    |

## PRs — review individually, larger (14)

#95 (UI/UX sweep), #92 (thread deletion), #90 (goals and reminders), #88 (Ollama
first-run), #86 (delete Dots), #83, #82, #81 (docs and Composio), #75 (Dokploy),
#72 (MCP OAuth), #71, #70 (command palette), #69 (page history and trash), #63,
#64 (Gemini tool calls), #65 (reasoning models, draft), #60 (env schemas), #74.

These may be useful but each needs a review against the rewritten runtime; several
were written against code this fork replaced.

## PRs — close, routine dependency bumps (7)

#97, #99, #80, #79, #78, #77, #67.

Low value while the branch is being stabilised, and a proper automated updater
belongs in the CI work rather than as 7 stale branches.

## Summary

| Action                               | Issues | PRs    |
| ------------------------------------ | ------ | ------ |
| Close — resolved by the fork         | 7      | —      |
| Close — not actionable / not planned | 11     | 10     |
| Close — routine or superseded        | —      | 10     |
| Keep — real bugs                     | 8      | —      |
| Keep — features                      | 3      | —      |
| Keep — small useful patches          | —      | 6      |
| Review individually                  | —      | 14     |
| **Total open now**                   | **29** | **45** |
| **Proposed to close**                | **18** | **20** |
| **Proposed to keep**                 | **11** | **20** |

The highest-value fixes are #23 (reasoning models), #19 (Windows dev is broken)
and #24 (hang on new conversation) — those are defects a customer will hit in the
first hour.
