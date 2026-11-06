# Execution order to production

Reference: `main` after the triage closures. 18 issues and 28 PRs remain open,
plus the VPS work orders.

The order below is by **risk to a customer**, not by effort. A bug a customer hits
in the first hour costs more than a feature they never reach.

## Phase 0 — the app must not break on first use (now)

| Order | Item                                              | Why first                                                                                                          |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1     | **#23** reasoning models fail every turn          | The default model is a reasoning model. If this is broken, the product does not work for the default configuration |
| 2     | **#19** `npm run dev` is POSIX-only, Windows 403s | Development on Windows — this machine — is broken without it                                                       |
| 3     | **#24** new conversation hangs                    | First interaction a customer performs                                                                              |
| 4     | **#22** revision approval duplicates the page     | Silent data duplication; erodes trust faster than a visible error                                                  |

Exit criteria: a fresh install completes a conversation, approves a page revision
once, and does not duplicate anything. Verified by hand on Windows and in Docker.

## Phase 1 — the customer can rely on it

| Order | Item                                                         |
| ----- | ------------------------------------------------------------ |
| 5     | **#48** pages deleted in another tab linger                  |
| 6     | **#33** long page titles clipped                             |
| 7     | **#34** page panel overflows horizontally                    |
| 8     | **#35** small UI issues (Enter on composer, unlabeled input) |
| 9     | **PR #84** MCP close errors are swallowed                    |
| 10    | **PR #85** `dots()` N+1                                      |
| 11    | **PR #58** recurring tasks stop after a failure              |
| 12    | **PR #76** external page deletion reconciliation             |

Exit criteria: 30 minutes of normal use with no visual defect and no silent error.

## Phase 2 — the lifecycle gaps

| Order | Item                                                                            |
| ----- | ------------------------------------------------------------------------------- |
| 13    | **#53** delete a specialist Dot                                                 |
| 14    | **#56 / PR #92** delete a conversation                                          |
| 15    | **PR #87**, **PR #89** small correctness fixes                                  |
| 16    | **#43** Ollama preset in first-run (the base URL already works; this is polish) |

## Phase 3 — the VPS work orders

These are issues #105–#111 and they gate production:

| Order | Item                                    | Gate                                                     |
| ----- | --------------------------------------- | -------------------------------------------------------- |
| 17    | **WORK-030** (#106) model per Dot       | unblocks sector profiles and Telegram `/setor`           |
| 18    | **WORK-031** (#107) Telegram            | the channel the review requires                          |
| 19    | **WORK-033** (#109) staging on the VPS  | after 17 and 18                                          |
| 20    | **WORK-034** (#110) access and secrets  | alongside 19                                             |
| 21    | **WORK-022** (#111) auto-update         | **blocked on code signing**                              |
| 22    | **WORK-032** (#108) delegation decision | a decision, not a build; do it before anyone asks for it |

## Phase 4 — review individually (afterwards)

PRs #95, #90, #88, #86, #83, #82, #81, #75, #72, #71, #70, #69, #65, #64, #63,
#60, #74.

Each was written against code this fork replaced. Review them one at a time
against the current runtime, keep the idea, redo the patch if needed. Do not
merge them in a batch — that is how a rewritten runtime gets quietly reverted.

## What must be true before a paying customer

From `docs/fork/PRODUCTION-READINESS.md`, unchanged by this order:

1. VPS with a domain and HTTPS.
2. Off-site backup with a **tested** restore on that host.
3. Rotated credentials.
4. Signed installer.
5. A decision on the remaining dependency advisories.
6. External pentest.
7. Docker Desktop licensing decision.

Phases 0–2 make the application fit to use. Phases 3 and the list above make it
fit to sell.

## Honest note on sequencing

Phase 0 is not negotiable and should happen before any VPS work: installing on a
server a build whose default model fails every turn would waste the whole exercise
and produce a bad first impression for the pilot sector.

Phase 4 is deliberately last. Those PRs are ideas, not commitments, and reviewing
them against a stabilised runtime is cheaper than against a moving one.
