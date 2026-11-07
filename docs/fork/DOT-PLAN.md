# Dot plan — nexlabs sectors

Six Dots, one per sector from the external review, plus the default. Each Dot has
its own instructions, permissions and (from WORK-030) optionally its own model
override pointing at a 9Router profile.

## The Dots

| Dot               | Role                                                           | Permissions       | 9Router profile                          | Status                                     |
| ----------------- | -------------------------------------------------------------- | ----------------- | ---------------------------------------- | ------------------------------------------ |
| **Dot** (default) | Everyday conversation, first contact with the product          | memory + research | `nexbot-default`                         | created                                    |
| **Rotina**        | Daily tasks, reminders, lists, follow-ups. Short and practical | memory            | `nexbot-routine` (free/fast)             | created                                    |
| **Documentação**  | Writes and organises documentation, clear Portuguese           | memory            | `nexbot-docs` (mid-tier)                 | created                                    |
| **Planejamento**  | Goals, comparing options, plans with steps and deadlines       | memory + research | `nexbot-research` (with fallback)        | created                                    |
| **Produção**      | Code, commands, error diagnosis, technical execution           | research          | `nexbot-coding`                          | created                                    |
| **Financeiro**    | Numbers, budgets, audit. Prepares analysis, never decides      | memory + research | `nexbot-audit` (strongest, no downgrade) | created                                    |
| **Design**        | Creative work                                                  | research          | needs an **image provider**              | **not created** — blocked on that decision |

Every Dot is created with learning **off** by default. Turn it on per Dot in the
Skills section once you trust its output.

## Model overrides

The Dots were created inheriting the global provider (OpenCode Go /
`deepseek-v4.1-flash`). To point a Dot at a different 9Router profile:

1. Create the profile in 9Router (e.g. `nexbot-audit`).
2. Open the Dot's dialog → **Model** → set the base URL to the 9Router endpoint
   and the model to the profile name → **Test connection** → **Save**.
3. The header shows `set`, not `inherited`, and new turns use it immediately —
   no restart.

## Not done yet

- **Image provider** for the Design Dot: the app has no image generation
  integration, so that Dot would be text-only today.
- **9Router profiles**: they exist in the plan, not in the router. Until they
  are created, every Dot uses `nexbot-default`.
