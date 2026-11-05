# Fork Documentation Index

Canonical engineering documentation for the decoupled, self-hosted fork of
CopilotKit/OpenDots maintained at
`https://github.com/KayzenRoot/OpenDots`.

- Upstream: `CopilotKit/OpenDots` (MIT), default branch `main`,
  upstream HEAD `d4214aff10f066911f3253cb3cb870764cd51a9f`.
- This fork retains the upstream `LICENSE` (MIT, Copyright (c) Atai Barkai).
- Documentation date: 2026-11-05.

This `docs/fork/` tree is the audit-facing document set. It is separate from
the upstream docs in `docs/*.md` (`SETUP.md`, `COMPUTERS.md`, `CONNECTIONS.md`,
`TELEMETRY.md`, `SETUP-TELEMETRY.md`, `knip.md`, `demos/`), which are retained
unchanged and may be referenced for upstream behaviour that this fork keeps.

| File                                             | Description                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OVERVIEW.md](./OVERVIEW.md)                     | What OpenDots is, what this fork is, what changed, who it is for, and the deployment story.                                                        |
| [REQUIREMENTS.md](./REQUIREMENTS.md)             | Functional and non-functional requirements, including the hard "no mandatory CopilotKit key" and full owner-infrastructure requirements.           |
| [SCOPE.md](./SCOPE.md)                           | In scope, out of scope, deferred items with reasons, and the three accepted scope decisions.                                                       |
| [ARCHITECTURE.md](./ARCHITECTURE.md)             | Component diagram, chat-turn request flow, server module map, decoupling seam table, why SSE mode + local thread endpoints suffice, build layout.  |
| [DATA-MODEL.md](./DATA-MODEL.md)                 | PostgreSQL conversation schema (tables, columns, keys, indexes, retention) plus the SQLite tables that stay local.                                 |
| [API-CONTRACTS.md](./API-CONTRACTS.md)           | `/api/*` HTTP surface, `/api/copilotkit/*` agent runtime (AG-UI + thread REST), Slack webhook, health/readiness, and auth.                         |
| [SECURITY.md](./SECURITY.md)                     | Fork-specific threat model, auth, permission boundaries, isolation, secret handling, SSRF/command-injection posture, and what is not yet hardened. |
| [TEST-PLAN.md](./TEST-PLAN.md)                   | Unit/integration/e2e strategy, how to run, the 56-file baseline, the baseline flake explanation, new required tests, benchmarks.                   |
| [DEPLOYMENT.md](./DEPLOYMENT.md)                 | VPS deployment and recovery: resources, Docker Compose topology, env template, HTTPS, health, volumes, backup/restore, upgrade/rollback.           |
| [BACKLOG.md](./BACKLOG.md)                       | Work orders WORK-000..WORK-010, deferred features, resolved upstream issues, known limitations.                                                    |
| [DEFINITION-OF-DONE.md](./DEFINITION-OF-DONE.md) | Acceptance criteria checklist for fork readiness.                                                                                                  |
| [DECISIONS.md](./DECISIONS.md)                   | Decision ledger / ADRs ADR-0001..ADR-0010.                                                                                                         |
| [FEATURE-PARITY.md](./FEATURE-PARITY.md)         | Feature matrix: upstream implementation vs CopilotKit dependency vs replacement vs verification vs limitations.                                    |
| [CHECKPOINT.md](./CHECKPOINT.md)                 | Status snapshot: upstream SHA, destination repo, baseline results, phase, completed/remaining work orders, blockers.                               |

## Status legend

Used consistently across this document set:

- **DONE** — implemented and verified in this repository at the recorded
  checkpoint.
- **IN PROGRESS** — implementation started, not complete.
- **PLANNED** — designed and assigned a work-order ID, not yet implemented.
- **ACCEPTED** — a decision the repo owner has made, with rationale recorded.

## Reading order

For an audit review: [CHECKPOINT.md](./CHECKPOINT.md) →
[DEFINITION-OF-DONE.md](./DEFINITION-OF-DONE.md) →
[FEATURE-PARITY.md](./FEATURE-PARITY.md) →
[BACKLOG.md](./BACKLOG.md) → the remaining documents as needed.

For an engineer joining the fork: [OVERVIEW.md](./OVERVIEW.md) →
[ARCHITECTURE.md](./ARCHITECTURE.md) → [DATA-MODEL.md](./DATA-MODEL.md) →
[API-CONTRACTS.md](./API-CONTRACTS.md) →
[DEPLOYMENT.md](./DEPLOYMENT.md).
