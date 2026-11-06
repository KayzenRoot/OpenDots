# Production readiness

Status: **NOT READY** to sell. This page is the honest gate list.

Verified working today, with evidence: the self-hosted runtime, PostgreSQL
conversations, the in-app model provider setup, Slack end to end, backup and
restore, the Docker stack, and the install/watchdog scripts on Windows.

The gap is not features — it is the operational and legal layer that a paid
deployment needs.

## Blockers

| #   | Item                                                  | Why it blocks                                                                                                                | Owner                                                                 |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | VPS deploy with a real domain and HTTPS               | It runs on one machine today; Slack points at a temporary tunnel that dies                                                   | You: rent the VPS, point DNS. Then `deployment/Caddyfile` + the guide |
| 2   | Scheduled, off-site backup                            | `backup.sh` exists and a restore round-trip passed, but nothing runs it on a schedule and no copy leaves the machine         | Automated locally where possible; off-site needs your storage         |
| 3   | Independent penetration test                          | An internal audit is not a substitute before selling to third parties                                                        | You: hire it                                                          |
| 4   | Rotate exposed credentials                            | The OpenCode Go key and a `thk_live_…` key appeared in session tool output                                                   | You: provider dashboards                                              |
| 5   | Sign the Windows installer                            | Unsigned `.exe` triggers SmartScreen warnings and blocks installs                                                            | You: buy a code-signing certificate                                   |
| 6   | Decide the container runtime for customers            | Docker Desktop is free only below 250 employees **and** USD 10M revenue; above that it is a paid seat                        | You: business decision                                                |
| 7   | Resolve or accept the remaining dependency advisories | 26 high remain, almost all transitive from `@copilotkit/*` 1.75.0; 1.84.1 breaks typecheck and must be its own tested change | Your call: upgrade with risk, or accept in writing                    |

## Already done, no action needed

- **In-app provider setup.** The operator chooses base URL, model and key inside
  the app; the key is tested before it is stored and sealed with AES-256-GCM
  under a master key kept in a separate file. No more editing `.env` and
  restarting.
- **Environment footgun closed.** An exported `OPENAI_*` no longer overrides
  `.env.local`; `start.ps1` and `install.ps1` clear those variables first. This
  was caught in production-shaped testing and had already silently pointed a
  stack at the wrong provider.
- **Health watchdog.** Restarts the stack after a real outage, one restart per
  outage, installed at logon beside the app.
- **Security posture tests.** Fail if a route starts leaking secrets or moves
  above the owner middleware; also hardened the settings store against unknown
  keys.
- **CSP and session auth** verified live: `connect-src 'self'`,
  `frame-ancestors 'none'`, owner-token required, Postgres unpublished.

## Recommended before the first paying customer

1. ~~Rate limiting~~ **DONE**: the webhook is capped at 120 requests/minute per
   client and failed token attempts at 40/minute, both with Retry-After. A
   multi-replica deployment would still need a shared limiter.
2. **Monitoring**: external uptime check against `/api/ready`, log shipping, and
   an alert on the watchdog log.
3. **Documentation truth.** Upstream `docs/SETUP.md` still says CopilotKit
   Intelligence is required for conversations, which is false in this fork.
4. **Legal**: terms of service, privacy policy, and a support agreement. If you
   access a customer's server remotely, that is processing their data and needs
   a contract (LGPD). Keep the MIT licence and upstream attribution.

## Product gaps, deliberately deferred

- **Skills editor.** Skills live in PostgreSQL but there is no UI to manage them.
- ~~Configurable voice~~ **DONE**: `VOICE_BASE_URL` selects a non-OpenAI realtime
  gateway; it defaults to OpenAI so nothing changes for an existing install.
- **Multi-user auth.** One owner token per installation by design.

## On the visual work

The dark theme is produced by a build-time PostCSS transform, not by a token
block, so palette changes go through `src/build/dark-theme.ts`. The current
layer (glass surfaces, gradient depth, living mascot) is scoped to
`:root[data-theme='dark']` and leaves the light theme untouched. A full redesign
should start by making the transform accept an explicit palette.
