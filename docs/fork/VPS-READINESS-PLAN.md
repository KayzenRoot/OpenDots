# Plan: reaching VPS readiness

Reference commit for all of this: **`66938ac`**. Pin that or a later tag when
deploying; do not install by tracking `main`.

This plan turns an external review of the repository into ordered work. Two of
its findings were verified against the code rather than assumed:

- **The model is global.** `model_config` is `CHECK (id = 1)` — one base URL, one
  model, one key for every Dot. A finance Dot and a routine Dot cannot use
  different models, so a router can only apply one combo.
- **There is no Telegram channel.** `src/server/` has no Telegram module. Slack is
  the only external channel implemented and verified.

## Work order

| ID       | Work                           | Blocks                          | Depends on    |
| -------- | ------------------------------ | ------------------------------- | ------------- |
| WORK-022 | Auto-update                    | production distribution         | code signing  |
| WORK-030 | Model per Dot                  | sector profiles, 9Router combos | —             |
| WORK-031 | Telegram channel               | "talk to it from Telegram"      | —             |
| WORK-032 | Agent delegation (design only) | multi-team topology             | decision      |
| WORK-033 | VPS staging deploy             | production                      | 030, 031, 022 |
| WORK-034 | Admin access hardening         | production                      | infra         |

Order: **022 → 030 → 031 → 033**. WORK-032 is a design decision, not a build
task, and WORK-034 is infrastructure that runs alongside 033.

## WORK-030 — Model per Dot

Today `ModelConfigStore` stores exactly one row. A sector map is impossible until
this changes.

**Design:** keep the global row as the default, and add a nullable per-Dot
override. Resolution order: Dot override → global. A Dot override stores its own
`base_url`, `model` and a sealed key, so a sector can point at a different router
combo _and_ a different credential.

- Migration: `dot_model_config(dot_id PRIMARY KEY, base_url, model, api_key_sealed, updated_at)`.
- The key is sealed with the same `secret-box` already used for the global key.
- `GET/PUT/DELETE /api/model/dot/:dotId` mirrors the existing global routes,
  including the test-before-save rule: a key the provider rejects is not stored.
- `DotAgent` resolves through the Dot first. A test must prove two Dots resolve to
  two different models in one process.
- The UI shows the effective model per Dot, and whether it is inherited or set.

This is the prerequisite for the sector→profile map below.

## WORK-031 — Telegram channel

Follow the Slack integration's shape, because it already solved these problems
in this codebase: `src/server/slack-signature.ts`, `slack-service.ts`,
`slack-store.ts`.

**Contract**

| Item        | Value                                                                        |
| ----------- | ---------------------------------------------------------------------------- |
| Route       | `POST /api/telegram/webhook`                                                 |
| Auth        | `X-Telegram-Bot-Api-Secret-Token` compared in constant time                  |
| Idempotency | `update_id` recorded before processing; a repeat is acknowledged and dropped |
| Allowlist   | `TELEGRAM_OWNER_ID` — a single user; anyone else is ignored                  |
| Rate limit  | reuse `rate-limit.ts`, per client                                            |
| Mapping     | `telegram_chats(chat_id, thread_id, dot_id, nexbot_thread_id)`               |
| Agent       | the same local runner path as Slack; no second execution path                |
| Reply       | Bot API `sendMessage`, chunked under the 4096-character limit                |
| Failure     | sanitised through `safeFailure`, never leaking provider text                 |

**Commands:** `/start`, `/status`, `/pausar`, `/retomar`, `/setor <dot>`.
`/setor` is only meaningful once WORK-030 lands.

**Env:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_ID`,
optional `TELEGRAM_DOT_ID`.

**Non-negotiables, each tested:** message text is untrusted data and never becomes
a system instruction; the webhook is signature-gated and rate-limited because it
is public; media is not downloaded until a later work order, and a media-only
message gets a clear "not supported yet" reply rather than silence.

**WhatsApp:** official Cloud API only, and only if Telegram proves insufficient.
Unofficial bridges risk a ban on the number and are explicitly out of scope.

## WORK-032 — Agent delegation (decision first)

The review asks whether "several teams" means agents delegating to each other.
That is a product decision, not an implementation detail, so it is written down
before anything is built:

- **Option A — no delegation.** Each Dot is a specialist; you route by talking to
  the right Dot. Simple, auditable, no new failure modes. This is what exists.
- **Option B — explicit delegation.** A Dot can hand a task to another Dot and
  receive the result. Needs a permission model (which Dot may call which), a
  depth limit, cost accounting per hop, and a trace so a delegated answer is
  attributable.
- **Option C — a supervisor per sector.** A Dot that plans and dispatches to
  specialists in its Space. Most powerful, hardest to audit.

Recommendation: **A now, B later**, because B's cost and audit requirements are
real and C multiplies them. The decision should be recorded in
[DECISIONS.md](./DECISIONS.md) before code exists.

## WORK-033 — VPS staging

Not before 030 and 031 are merged and green.

**Topology**

```
Internet
  ├─ bot.nexlabs.company   → POST /api/telegram/webhook   (public, signature-gated)
  └─ nexbot.nexlabs.company → UI/API                      (Cloudflare Access / Tailscale)
VPS
  ├─ Caddy :443 → Nexbot 127.0.0.1:4310
  ├─ Nexbot + Postgres 17 + SQLite + Playwright browser
  └─ 9Router on loopback  ←  dedicated API key
```

The admin UI must not be public. Only the webhook path is internet-facing, and it
is protected by the secret token, the allowlist and the rate limiter.

**9Router:** `OPENAI_BASE_URL=http://<docker-gateway>:20128/v1`,
`OPENAI_MODEL=nexbot-default`, a **dedicated** API key (never the global one).
`OPENAI_EXTRA_HEADERS` is not needed — 9Router handles routing itself. Do not use
`127.0.0.1` from inside the container: it is the host's loopback. Use a fixed
Docker network plus a listener on the host gateway, or `network_mode: host`.

**Sector → profile** (only possible after WORK-030)

| Sector        | Profile                                                      |
| ------------- | ------------------------------------------------------------ |
| Design        | vision/image + creative (needs an image provider configured) |
| Production    | coding, execution, tests                                     |
| Planning      | research, with fallback                                      |
| Finance       | highest quality, human approval, never downgraded            |
| Documentation | mid-tier / free                                              |
| Routine       | free / lowest cost                                           |

## WORK-034 — Access hardening

- Only 80/443 public; 9Router and any code-server stay on loopback.
- Admin behind Cloudflare Access, Tailscale or a VPN.
- Secrets 0600, outside Git; `OWNER_TOKEN` strong and rotated.
- Backups of Postgres, SQLite, volumes **and** `.env`, off-site, with a tested
  restore. The restore path has been exercised locally, not against this VPS.

## Capacity

The review measured 2 vCPU / 11 GB / 177 GB free. Minimum for app + Postgres is
about 2 vCPU / 2 GB; the browser adds ~1 GB; each computer defaults to ~2 GB.

| Scenario                                         | Sizing                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| app + Postgres + browser, one operator           | current VPS is adequate                                                    |
| several Dots plus computers running concurrently | **8 vCPU / 32 GB**, or move computers to a second host                     |
| staying at 11 GB                                 | `COMPUTER_MEMORY_BYTES=1GB`, cap concurrent computers, no 24/7 code-server |

2 vCPU is the real bottleneck once more than one computer runs.

## Security requirements before any agent touches real work

1. Human approval for payments, deletions, sends, deploys and financial changes.
   The approval flow exists for pages and MCP; it must cover these too.
2. Computers under gVisor, no Docker socket in the app, CPU/RAM limits, and an
   egress allowlist.
3. `requiresApproval` on sensitive MCP tools.
4. Telegram and web content are untrusted and never become system instructions —
   the learning pass already applies this rule to transcripts; the channel must
   apply it too.
5. Kill switch and per-Dot pause.
6. Audit of conversations, tool calls, approvals and cost.
7. LGPD: retention, minimisation, PII handling, encryption at rest, deletion on
   request, and a DPA with each model provider.
8. Backup and a **tested** restore before the first real conversation.

## What this plan does not claim

Nothing here has been deployed. The VPS numbers come from the review and are
reproduced, not re-measured here. Auto-update (WORK-022) is still blocked on code
signing, and no work order above is done yet.
