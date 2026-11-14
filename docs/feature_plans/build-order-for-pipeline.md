# build-order-for-pipeline

Tooling + docs, not app code. Audits `docs/BUILD_LIST.md` against what is actually on `main`
(Nov 14, 2026) and rewrites the build order as an explicit, dependency-ordered table that the n8n
pipeline's item picker (`automation/scripts/pipeline.mjs next`) consumes directly.

## Problem

- The picker takes the first `Not started` row in *document order*. The document is grouped by PRD
  category (FND, LOG, TK, ANA, …), so document order ≠ build order: it would pick FND-3 next, then
  LOG-1 "start workout … or next session of a saved program" (which needs PRG-3, a Phase 2 item).
- Items don't map 1:1 to branches. Some are too big for one run (LOG-2 + set types), some too
  small (LOG-6 is a column that already exists plus a toggle), some are half-done across two
  branches (FND-2 schema is live, auth screens aren't), and some are blocked on outside decisions
  (video service, Strength Level licence, gym data, deload rules, food database).
- Statuses are stale in places (FND-2, LIB-1, LIB-7 notes reference branches that are now merged).

## Approach

1. **Audit statuses** in the feature tables against `main`: FND-1/FND-4 Built, FND-2 In progress
   (schema live, auth pending), LIB-7 Built (videos pending), LIB-1 In progress, everything else
   Not started. Keep every feature row (PRD traceability + definition of done); fix the notes.
2. **Add a `## Build order` section** to `docs/BUILD_LIST.md`: one ordered table of *steps*. A
   step is one planner+builder run = one branch. Columns:
   `Step | Title | Covers | Branch | Status | Depends on | Scope and step definition of done`.
   - `Covers` lists the feature IDs the step advances (a feature may span steps; a step may
     bundle features). `(part)` marks a partial.
   - `Status` ∈ {`Done`, `Built`, `In progress`, `Not started`, `Blocked`}. `Blocked` = waits on a
     decision only Tristen can make; the scope cell names it.
   - `Depends on` = step IDs that must be `Built` or `Done` first.
   - Steps already shipped (ui-foundation, supabase-schema, launch-library-seed, library-db-seed)
     are rows too, so the table is the complete history and the queue in one place.
3. **Teach the picker** (`pipeline.mjs`): parse only the Build order section; pick the first
   `Not started` step whose dependencies are all `Built`/`Done`; skip `Blocked` and unmet-dep
   steps with a stderr note; join `Covers` to the feature rows so the emitted JSON carries each
   covered feature's title, phase and definition of done. Keep the JSON keys n8n already reads
   (`id`, `feature`, `branch`); add `covers`, `dependsOn`, `scope`. Branch comes from the table,
   not from a slug function. Extend `check` self-tests for section scoping, dependency skipping,
   Blocked skipping, and the join.
4. **Update the prompts** so planner/builder speak in steps ("your step covers these features;
   their definitions of done are…"), **PIPELINE.md**, `automation/README.md`, the board's Gate 2
   text, and the one CLAUDE.md sentence that says what the pipeline picks from.

## Build-order design rules

- Phase order holds (P0 → P1 → P2) except where a P1 item is a trivial rider on a P0 step and the
  column already exists (LOG-10 RPE toggle rides on set types; SOC-9 flair filter rides on the
  sort toggle). Each pull-forward is named in the row.
- Dependencies first: auth → shared training math → SQLite/sync → logger core → set types →
  history/PRs → analysis → feed → post flow → … Nothing references a feature that lands later.
- A step is sized for one headless build: roughly one screen or one schema domain plus its tests.
- Blocked steps stay in their natural position so the order is honest, but the picker skips them.
- Steps that depend on a Blocked step (PR verification needs video) are Not started and simply
  never become eligible until the blocker clears — no separate bookkeeping.
- NFR-11 (both-platform parity) is not a step: it is Tristen's device verification that flips
  Built → Done, noted above the table.

## Out of scope

- Any app or schema change (diagrams stay untouched).
- Pipeline v2 features (cron, parallel worktrees, notifications, auto-flipping status) — still
  in DEFERRED.
- Re-planning individual features; each step's planner run does that.

## Testing

`node automation/scripts/pipeline.mjs check` (self-tests, extended) and a dry parse of the real
build list (`next` cannot run on a dirty tree; a `--dry-run` flag is added that parses and prints
the pick without writing state or checking git).

## Grilling record

Run via `mattpocock-skills:grilling` in an autonomous session (Tristen absent): each frontier
question was answered from the specs; anything that needs Tristen is in the session report.

- **Two statuses (step + feature) will drift.** Accepted, with a guard: a new `lint` subcommand
  validates the real list (Covers IDs exist, every non-Done feature is covered by some step, deps
  point at earlier steps, branches unique); `next` runs it first and refuses on errors.
- **Blocked: status, not pseudo-step.** Downstream steps list the blocked step in Depends on and
  stay ineligible until it clears — no extra bookkeeping.
- **Branch from a column.** No slug function; plan file name = branch; plain kebab names like the
  existing plan files.
- **P1 riders on P0 steps** (LOG-10 RPE toggle, SOC-9 flair filter) are allowed only when the
  column already exists or it is one query clause, and the row says so. Phases set order, not cut
  lines (PROJECT_OVERVIEW).
- **Logger step was too big** for one headless build → split into `active-workout-store` (domain
  model + SQLite persistence + tests) and `logger-screen` (UI on top).
- **Re-pick hazard:** a step whose branch exists unmerged still reads Not started on main. `next`
  now refuses if any step is In progress or the picked step's branch already exists (local or
  origin) — exit 2 with the reason.
- **`--dry-run`** is the preview path for this session and for Tristen; not speculative.
- **Board:** only Gate 2 wording changes; the JSON keys n8n reads (`id`, `feature`, `branch`) are
  kept. Live board needs a re-import unless the MCP update succeeds.

## Deviations during implementation

- The board's Gate 1 text changed too (not only Gate 2): it now names the step and its covered
  features so Tristen sees what he is approving. Keys the board reads are unchanged.
- CLAUDE.md: the whole "Autonomous pipeline" paragraph was rewritten in step vocabulary rather than
  one sentence; still under the 200-line cap (144 lines).
- External-blockers table rows now name the Blocked step each blocker gates.
- Review fixes (two-axis `mattpocock-skills:code-review`): parsing gathered into one
  `parseBuildList`; lint also validates feature-row statuses; B10's DoD reworded so it no longer
  references PR detection that lands in B13; B52/B53 split GYM-3/6/9 as partials because verified
  rows only exist after B53; B07 now depends on B03/B04 and B20 on B09 (the table order already
  implied both, the column was dishonest); B22's circular reference to B26 removed; Covers gaps
  closed (B26 YOU-4, B54 NFR-5, B55 NFR-9, B33 LIB-7 as partials); B47 notes why a P0 feature's
  notifications part completes in Phase 2.
