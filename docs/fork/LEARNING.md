# Automatic learning and the skills editor

Design for three related features. Written before implementation so the safety
rules are decided deliberately rather than discovered later.

## The goal

An agent should get better at your work over time. Today a Dot forgets
everything between conversations: you explain your conventions once and repeat
them forever. The target is that the system notices durable, reusable knowledge
in real conversations, proposes it as a **skill**, and — once you approve it —
feeds it back to the agent.

Three work orders:

| ID       | Feature                                      | Status            |
| -------- | -------------------------------------------- | ----------------- |
| WORK-020 | Skills editor (API + UI)                     | foundation, first |
| WORK-021 | Automatic skill proposals from conversations | the learning loop |
| WORK-022 | Auto-update for installed clients            | independent       |

## The decisions that shape everything

### 1. Automatic skills are never delivered without approval

A skill authored by a model from untrusted conversation content is untrusted
input that will later be injected into the agent's context. Treating it as
trusted would let a web page or a Slack message plant instructions that survive
into every future conversation of that Dot.

So the pipeline is:

```
conversation closes
   -> reflection pass (model) extracts candidate knowledge
   -> stored as a PROPOSAL  (status = proposed, never delivered)
   -> surfaces in the editor as "Suggested by Dot"
   -> you approve, edit or reject
   -> only then does deliverableSkills() include it
```

`deliverableSkills()` already filters on `enabled`; proposals must be a separate
status, not merely `enabled = false`, so a proposal is never one query away from
being delivered.

### 2. A skill is text, not code

A skill is a Markdown body with a name and a description. Agents cannot execute
skills; they read them, the way a new colleague reads a runbook. This keeps the
feature understandable and removes an entire class of risk (no generated code
runs inside the agent loop).

### 3. Proposals carry provenance

Each proposal records where it came from: the conversation, the Dot, the date,
and the model that suggested it. Without provenance you cannot judge a proposal,
and the editor becomes a list of anonymous claims.

### 4. Rejection is remembered

A rejected proposal must not be re-proposed every week. Store the rejection with
a reason so the reflection pass can skip it.

## WORK-020 — Skills editor

The storage layer exists (`LearningStore`: list, get, upsert, setEnabled,
delete, deliverable). What is missing is the surface.

**API** (behind the owner token, like every other `/api` route):

| Route                          | Purpose                                 |
| ------------------------------ | --------------------------------------- |
| `GET /api/skills?dotId=`       | list every skill and proposal for a Dot |
| `GET /api/skills/:name?dotId=` | one skill, full body                    |
| `PUT /api/skills/:name`        | create or update (bumps `revision`)     |
| `PATCH /api/skills/:name`      | enable, disable, approve, or reject     |
| `DELETE /api/skills/:name`     | remove                                  |

Constraints, each with a test:

- `dotId` is required and must exist. A Dot must never see another Dot's skills.
- the body is size-bounded (a skill is a prompt fragment, not a document);
- `name` is validated as an identifier so it can appear in a tool argument;
- only an approved + enabled skill is returned by `deliverableSkills()`;
- `DELETE` is idempotent.

**UI**: a Skills section per Dot, opened from the Dot's menu. List of approved
skills first, then proposals under a heading that says where they came from.
Editing is a plain Markdown body field with a preview, not a rich editor — the
content is for a model to read.

## WORK-021 — The learning loop

**When it runs.** After a conversation ends, and only when it is long enough to
carry knowledge (a two-line exchange teaches nothing). Debounced per Dot, and
never during a paused workspace.

**What the reflection pass receives.** The conversation transcript, the Dot's
existing skills (so it proposes something new rather than a duplicate), and the
recent rejections (so it stops re-proposing). Nothing else — no page content, no
other Dots' material.

**What it must produce.** Zero or more proposals, each a name, a description and
a Markdown body. Zero is a valid and expected answer: a model that always finds
something to propose is generating noise.

**Guardrails, all required:**

- the pass output is parsed strictly; a malformed response produces no proposals
  and is logged, never partially applied;
- a proposal that duplicates an existing skill name is dropped;
- proposals are rate-limited per Dot, so a busy day cannot flood the editor;
- the transcript is untrusted input to the reflection pass, and its output is
  untrusted to us — the two are never treated as the same trust level;
- disabling learning for a Dot stops the pass entirely.

**Cost control.** The pass uses the Dot's configured model. It is the operator's
model budget being spent, so it is off unless enabled for that Dot, and the
limit is visible in the editor.

## WORK-022 — Auto-update

Today every fix needs a new installer run by hand.

**Design**: the app checks a version endpoint, and the installer does the
upgrade. Not a self-modifying binary.

1. The release publishes a signed manifest: version, image digest, minimum
   supported version.
2. The client checks on a schedule, and only reports — never installs silently.
3. Upgrading pulls the image by digest and runs the same migration path already
   used at boot, then restarts. Migrations stay backwards compatible for one
   version, so a rollback is possible.
4. The operator is told what changed and can defer.

**Why not automatic**: this holds customer conversations. An unattended upgrade
that runs a migration is the one operation that can destroy data unattended.
The feature notifies and prepares; a person confirms.

**Signing** is a precondition: without a code-signing certificate the client
cannot verify the manifest came from us, and an unsigned update channel is worse
than none.

## Order of work

1. WORK-020 — the editor. Without it, proposals have nowhere to land, and
   automatic creation would be invisible and unreviewable.
2. WORK-021 — the loop, writing into the editor built in step 1.
3. WORK-022 — starts only once signing exists, because the alternative is an
   unverifiable update channel.

## What this is not

- **Not fine-tuning.** Models are not retrained; the agent reads better context.
- **Not memory.** A memory records a fact about you; a skill records how to do
  something. Both exist and stay separate — `memories` in SQLite, `skills` in
  PostgreSQL.
- **Not autonomous self-modification.** Every skill passes a human gate.
