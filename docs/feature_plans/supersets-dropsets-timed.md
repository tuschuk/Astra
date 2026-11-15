# supersets-dropsets-timed — B11: Supersets, drop sets, timed work (LOG-11, LOG-12, LOG-13)

**Branch:** `supersets-dropsets-timed` (from `main`)
**Build step:** B11 — covers LOG-11 (whole: exercises grouped into a superset, logged and
displayed as one), LOG-12 (whole: a drop set records every drop and shows as one set in
history), LOG-13 (whole: timed / WOD-style work saves with a time or score; see the honest
feed note under Scope check).
**Depends on:** B09 (logger screens), and through it B08 (active-workout store), B07 (device
SQLite + sync) and B06 (`@training-math`). B10's entry-card layout (two input rows) is the
surface this step extends.

## Step definition of done (from the Build order)

Each type — superset, drop set, timed/WOD entry — logs, syncs, and displays as one unit in the
saved workout.

## Scope check

Two honesty notes, recorded rather than silently resolved:

1. **LOG-13's feature DoD mentions the feed** ("shows correctly in history and the feed"), but
   the feed does not exist until B20. The step's own DoD claims only the saved workout, and the
   Build order marks LOG-13 as fully covered here. This plan builds the data path and the
   history/saved display; the feed will print sets through the same `format.ts` helpers when
   B20 builds it, so nothing more will be owed *by the logging side* then. Gate 2 should flip
   LOG-13 with that note (or hold it at In progress until B20) — the session decides at the
   gate; the plan flags it so it is a decision, not an oversight.
2. **Named WODs ("Fran") are not loggable as such until custom exercises exist (B31).** A timed
   or scored entry in B11 attaches to a library exercise (plank, burpee, row…). That satisfies
   LOG-13's DoD — "a WOD *entry* saves with a time or score" — the entry exists and saves; the
   *name* a CrossFitter would give it arrives with custom exercises. Recorded so nobody reads
   B11 as shipping a WOD library.

## What already exists (found in Explore)

B02/B07/B08 deliberately built the columns and pass-through so B11 is mostly UX + semantics:

- **Schema, both sides:** `workout_exercises.superset_group` (smallint null, no CHECK),
  `sets.drop_set_position` (smallint, CHECK ≥ 1), `sets.duration_seconds` (integer, CHECK ≥ 0)
  exist in the server migration and the device mirror. The DAO's `TABLE_COLUMNS` carries all
  three, so store reads, history reads and sync push/pull already move them. `limits.ts`
  validates `drop_set_position` (whole, 1…32767) and `duration_seconds` (whole, ≥ 0).
- **Store:** `SetInput` already takes `dropSetPosition` and `durationSeconds`; `logSet`,
  `updateSet` and `repeatLastSet` save and copy them; `setInputFromRow` round-trips them.
  `addExercise` writes `superset_group: null`; nothing can set it to a number yet.
- **Drop-set numbering semantics are already decided by the shipped server migration** (its
  comment is the contract): *the top set is `null`, the follow-on drops are 1, 2, …*. The ERD's
  gloss ("null when not part of a drop set") is subtly wrong about the top set and gets
  corrected in the Document step.
- **No score column exists anywhere.** The step scope pre-authorizes "a score column by
  migration if needed".

What does not exist: any way to write `superset_group`, any UI for drops or timed work, any
display grouping, score storage, and tests for any of it.

## What this step builds

### 1. Score column — the step's one migration

LOG-13 says "a time or score". Time has a column; score has none, and none of the existing
columns can honestly hold "7 rounds + 12 reps" (an AMRAP score) — stuffing a score into `reps`
would make a WOD look like 350 reps of one movement. So:

- **Server:** new migration `backend/supabase/migrations/<timestamp>_sets_score.sql`:
  `alter table public.sets add column score text check (char_length(score) <= 100);`
  Nullable, text, length-capped like the other free-text columns. RLS is unchanged (row-level,
  already covers the new column). The builder applies it live via the Supabase MCP and updates
  `limits.ts` in the same commit (HANDOFF's standing instruction).
- **Why text, not numeric:** WOD scores are heterogeneous (rounds + reps, total reps, calories,
  meters). One text field is the smallest thing that makes every real score savable. Nothing
  parses it — the analysis engine is deterministic rules and simply ignores free text, exactly
  as it ignores notes. A structured score-type system (time/rounds/reps enums) would be
  speculative machinery with no consumer; score-based leaderboards are not in the PRD (gym
  leaderboards are PR-video based).
- **Device:** `frontend/src/db/schema.ts` gains `MIGRATIONS[1]` (V2):
  `alter table sets add column score text;` — append-only, per the file's own rule.
  `schema.test.ts`'s existing TABLE_COLUMNS-vs-schema sweep then covers it.
- **Mirror plumbing:** `SetRow.score: string | null` + `'score'` in `TABLE_COLUMNS.sets`
  (`dao.ts`) — that alone carries it through store reads, history reads and sync in both
  directions. `limits.ts`: `MAX_SET_SCORE_LENGTH = 100`, checked in `assertValidSetFields`
  (present-value-only, like the rest), and the hand-mirror comment gains the `score` line.
- **Store:** `SetInput.score?: string | null`; `setColumns` trims it and stores `''` as null;
  `setInputFromRow` and `repeatLastSet` carry it like every other field.

### 2. Supersets (LOG-11): two store operations + adjacent-run display

`superset_group`'s contract (from the schema comment): entries sharing the same number form a
superset. The store gains the only two writes the UI needs — **no raw
`setSupersetGroup(entryId, n)` escape hatch**, so group-number bookkeeping has one home:

- `linkWithPrevious(entryId)` — links the entry with the exercise *above* it (position − 1;
  throws for position 0). If the previous entry already has a group, the entry joins it (this
  is how tri-sets chain); otherwise a fresh group number — max existing group in this workout
  + 1, `assertValidSupersetGroup`-checked — is written to both rows. If the entry was in a
  different group and leaves exactly one member behind, that orphan's group is cleared too.
  All rows change in one transaction through the store's serialized `mutate`, same as every
  other write.
- `unlinkFromSuperset(entryId)` — clears the entry's group; if exactly one other member
  remains in that group, clears it too (a superset of one is not a superset). No-op when the
  entry has no group.
- `limits.ts` gains `assertValidSupersetGroup` (whole, 1…32767 — the smallint bound; the
  server has no CHECK, so this only prevents a poison row at the type's edge) and the mirror
  comment gains the `workout_exercises.superset_group` line. It lives in `limits.ts` because
  that file is the one home for "what the server will refuse".
- **Reorder and remove do not rewrite groups.** Display (below) only merges *adjacent* entries
  sharing a group, so moving a member away simply splits the visual unit until the lifter
  relinks — data preserved, no cascade logic, no surprise writes. Recorded as settled.

**Display.** A pure helper (in `format.ts`, beside the other display shapers) groups an ordered
entry list into runs: consecutive entries with the same non-null `superset_group`, runs of ≥ 2
render as one unit, singletons render as plain entries:

- **Logger** (`active-workout.tsx` + `EntryCard`): each card except the first gains a small
  **link toggle** ("Superset with previous exercise", accessibility-labelled), pressed when the
  card shares its group with the card above. Linked cards show a **Superset** badge; the screen
  passes each card its adjacency info — cards stay independent logging surfaces (you still log
  sets into each exercise separately; "logged as one" means grouped, labelled, and stored with
  one group number).
- **Saved workout** (`workout/[id].tsx`): an adjacent run renders as **one Card** labelled
  "Superset", containing each member exercise with its sets — the "displayed as one" unit.

### 3. Drop sets (LOG-12): one button, no new write path

With the shipped numbering (top = null, drops = 1, 2, …), logging a drop needs **no new store
method**: it is `logSet` with `dropSetPosition` = (last set's `drop_set_position` ?? 0) + 1 —
one row, one transaction, already validated. A pure helper `nextDropPosition(sets)` in
`activeWorkout.ts` (beside `setInputFromRow`, same reasoning: domain knowledge out of the
component) computes it.

- **Entry card:** a **Drop** button beside "Log set", enabled when the exercise has at least
  one set and the input boxes hold a loggable value (same `canLog` rule). It reads **exactly
  what Log set reads** — the full input payload, time/score included if typed — and adds
  `dropSetPosition`; no special-casing. The lifter's flow: log the top set, strip the weight,
  type the drop, tap Drop — repeat for each drop.
- **Display grouping:** a pure helper in `format.ts` walks an entry's sets in position order
  and chains a run where each set's `drop_set_position` continues its predecessor's
  (`(prev ?? 0) + 1` — i.e. a plain set followed by 1, 2, …). Anything that breaks the
  ascent (including a stray segment copied by Repeat) starts a new group, so display never
  crashes or mis-merges on odd data — it just shows the odd row as its own set.
  - **Logger:** drop segments render as continuation rows under their top set — indented,
    prefixed "↳", keeping their own remove control (mid-workout corrections stay per-segment;
    a removed middle drop leaves a gap the grouping rule tolerates). Only the top set row
    carries the set number and the W toggle (a half-warm-up drop set is not a state the UI
    offers; toggling W applies to the whole chain via one `updateSet` per segment, serialized).
  - **Saved workout:** one row per drop set — "Set n · 8 × 225 lb → 8 × 185 lb → 10 × 155 lb"
    (segments' load text joined by "→"; warm-up prefix from the top set; per-segment RPE kept
    inline). This is LOG-12's "shows them as one set in history".
- **Set numbering and counts:** displayed set numbers count *logical* sets (a 3-segment drop
  set is "Set 2", not "Sets 2–4") in both the logger and the saved screen, via the grouping
  helper. The tab's "12 sets" count stays the raw row count (B10 precedent: counts say what
  was done; a drop set did involve 3 efforts). Recorded as settled.

### 4. Timed / WOD work (LOG-13): a disclosure, not a mode

- **Entry card:** a **Timed** chip on the card (off by default, so the barbell path is
  untouched). It is a *disclosure*, not a mode: pressing it **reveals** a **Time** box and a
  **Score** text box (accessibility-labelled "Time for X" / "Score for X"); nothing is hidden
  or swapped, so every real combination stays loggable — reps + time ("100 burpees for time,
  7:32"), time + weight (weighted plank), score alone (AMRAP). Collapsing the disclosure
  clears its two boxes, so no invisible stale value ever rides into a logged set. "Log set"
  enables when reps, weight, time *or* score is present (an RPE alone is still not a set) and
  passes `durationSeconds` (parsed), `score` (trimmed) with the rest.
- **Parsing:** `parseDurationInput` in `format.ts`: `"90"` → 90 s, `"4:32"` → 272, `"1:02:30"`
  → 3750. Digits and colons only — no comma tolerance (a comma is a decimal convention, and
  "4,32" must not quietly mean 4:32); the box's placeholder reads "m:ss" so the convention is
  visible. Rejects anything else via the existing message pattern. Range (whole, ≥ 0) stays
  the store's job via `limits.ts`.
- **Display:** `formatDuration(seconds)` → "0:45", "4:32", "1:02:30"; `formatSet` widens to
  print, in order: warm-up prefix, then the core — reps × weight as today; a duration joins
  with " · " when both exist ("0:45 · 135 lb"), stands alone otherwise ("4:32") — then the
  RPE suffix, then the score (a score-only set prints just the score text, which also avoids
  colliding with the "—" empty-load placeholder; the joined separator is the format tests'
  one spelling to pin). The logger, the saved screen — and B20's feed later — all inherit it
  from the one function.
- **Last-time line:** `formatLastTime` includes `duration_seconds` in a set's identity and
  prints timed sets as their duration (today a timed set would show "—"). Drop segments stay
  individual sets in that one-line summary (grouping chains there would fight the existing
  run-grouping); scores are left out of the one-liner. Warm-up filtering unchanged.
- **Math:** no change needed, verified in Explore — `classifyPrs` ignores sets without reps ≥ 1
  and positive weight; `setVolumeKg` already counts 0 for them. Timed work adds no tonnage and
  no PRs, which is right (duration PRs are not in the PRD's closed PR list).

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<ts>_sets_score.sql` | new — `sets.score text check (char_length(score) <= 100)` (§1) |
| `backend/supabase/functions/_shared/training-math/limits.ts` (+ its test) | edit — `MAX_SET_SCORE_LENGTH` + score check in `assertValidSetFields`, `assertValidSupersetGroup`, mirror comments (§1–2) |
| `frontend/src/db/schema.ts` | edit — append V2 migration adding `sets.score` (§1) |
| `frontend/src/db/dao.ts` | edit — `SetRow.score`, `TABLE_COLUMNS.sets` (§1) |
| `frontend/src/workout/activeWorkout.ts` (+ test) | edit — `SetInput.score`, `setColumns`/`setInputFromRow`/repeat carry it; `linkWithPrevious`, `unlinkFromSuperset`; `nextDropPosition` (§1–3) |
| `frontend/src/workout/format.ts` (+ test) | edit — `parseDurationInput`, `formatDuration`, `formatSet`/`formatLastTime` widening, superset-run + drop-run grouping helpers (§2–4) |
| `frontend/src/components/workout/EntryCard.tsx` (+ test) | edit — Timed disclosure (Time + Score boxes), Drop button, drop continuation rows, superset link toggle + badge (§2–4) |
| `frontend/src/app/active-workout.tsx` | edit — pass adjacency/link info to cards (§2) |
| `frontend/src/app/workout/[id].tsx` | edit — superset run → one Card; drop run → one row; logical set numbers (§2–3) |
| `frontend/src/__tests__/saved-workout.test.tsx`, `logger-flow.test.tsx` | edit — grouping display + end-to-end (below) |
| `docs/diagrams/database-erd.md` | edit (Document step) — `sets.score`; correct `drop_set_position` gloss |
| `docs/diagrams/app-flow.md` | edit (Document step) — new card actions + store operations |
| `docs/BUILD_LIST.md` | untouched — status flips happen at Gate 2 |

## Data model impact

One additive, nullable column: `sets.score text` (CHECK length ≤ 100), server + device V2 +
`TABLE_COLUMNS` + `limits.ts`, all in one commit. Nothing else changes shape; `superset_group`,
`drop_set_position` and `duration_seconds` have existed since B02/B07 and already sync. The
device migration is append-only per `schema.ts`'s own rule; `schema.test.ts`'s sweep keeps the
mirror honest. Sync needs no changes — both transports are `TABLE_COLUMNS`-driven.

## How each definition of done becomes observably true

- **Step DoD** — `logger-flow.test.tsx` extends the real-store end-to-end flow: link two
  exercises into a superset, log a 3-segment drop set, log a timed entry (duration) and a
  scored entry (text score); finish; the saved screen shows the superset as one Card, the drop
  set as one row, the timed/scored sets with their time/score; the push test asserts the rows
  reach the fake server with `superset_group`, `drop_set_position`, `duration_seconds` and
  `score` intact (logs ✓ syncs ✓ displays as one unit ✓).
- **LOG-11** — `workout_exercises.superset_group` exists (B02). Store tests: link allocates one
  fresh group to both rows, chaining joins the existing group, unlink clears orphans, all
  atomic; card test: the toggle calls the store; saved-workout test: adjacent run renders one
  "Superset" Card.
- **LOG-12** — `sets.drop_set_position` exists (B02). Card test: Drop logs with
  `nextDropPosition`; format tests pin the grouping rule (ascending run, gap tolerance, stray
  segment isolation); saved-workout test: one chained row.
- **LOG-13** — `sets.duration_seconds` exists (B02); `sets.score` lands here. Card test: the Timed
  disclosure saves duration and/or score; format tests pin duration parsing and
  printing; saved screen shows both; the feed note in Scope check records the B20 hand-off.

## Testing (Jest, per repo rules — node SQLite driver + fakes, never real Supabase)

- `limits.test` additions: score length boundary (100 ok, 101 refused), superset group bounds.
- `activeWorkout.test.ts`: link/unlink transactional behavior incl. chain-join, orphan
  cleanup, position-0 refusal, group-number allocation after unlink churn; `nextDropPosition`;
  score round-trip through log/update/repeat; finish-push carries all four columns (the
  "syncs" clause).
- `format.test.ts`: duration parse/print; `formatSet` combination table; `formatLastTime`
  timed sets; both grouping helpers' edge cases.
- `EntryCard.test.tsx`: Timed disclosure reveal/collapse-clears + enablement rule; Drop
  button state + logged values (same payload as Log set, plus the drop position); drop rows
  render indented without own set numbers; W on a chain updates every segment.
- Route tests: saved screen superset Card + drop chain row + logical numbering.
- `schema.test.ts`: covered by the existing sweep once V2 lands (fresh file and v1→v2 upgrade
  paths both run in B07's harness).

## Out of scope (this branch)

- **Custom exercises / named WODs** (B31) and any WOD template library.
- **Feed display of WOD entries** (B20) — inherits `formatSet`; flagged in Scope check.
- **Workout/entry notes** (B12) — a score is not a note; notes stay B12's.
- **Rest timers / interval timers** (B16/B17 Tool Kit) — logging a duration, not measuring it.
- **Analysis of timed or scored work, duration PRs, score leaderboards** — no PRD basis; the
  PR list is closed (weight-based three kinds).
- **Structured score types** (time/rounds/reps enums) — speculative; one text field.
- **Drag-to-build supersets, reorder-moves-the-group** — link-with-previous covers building;
  groups survive reorder as data and re-merge when adjacent again.
- **Program-defined supersets** (B33+) — this step logs them, programs prescribe them later.

## Risks a reviewer should weigh

1. **The `score` column is this step's one irreversible-ish act** (a live additive migration).
   Text-with-length-cap is a one-way product reading of "score": display-only, never parsed.
   If Tristen wants comparable/rankable WOD scores later, that is a new column set and a PRD
   decision — this column stays the human-readable record. Reject at Gate 1 if score should
   instead wait for a structured design (then LOG-13 ships time-only here and the step DoD's
   "score" clause moves with it — that would be a scope change, hence this plan says so
   out loud).
2. **Superset integrity under reorder is deliberately loose.** Groups are not rewritten on
   move/remove; display merges only adjacent runs. A lifter can create data where two members
   of group 1 sit apart and render as plain entries. Alternative (cascade rewrites on every
   reorder/remove) is real complexity with new failure modes in the offline write path; the
   loose rule is one display function and zero extra writes. The W-chain and unlink orphan
   cleanup keep the common cases tidy.
3. **Drop-set grouping rides on position adjacency + ascending numbers**, with `repeatLastSet`
   able to mint a stray segment (it copies `drop_set_position` — B08 behavior, unchanged).
   The grouping rule isolates strays instead of mis-merging, and the format tests pin exactly
   that; but the logger will show a repeated drop segment as its own plain set, which may
   momentarily puzzle a lifter who taps Repeat after a drop chain. Changing Repeat to strip
   drop metadata would alter a shipped NFR-2 surface — left alone, recorded here.

## Grilling decisions (settled before code)

Run via `mattpocock-skills:grilling`; headless pipeline run, so the planner played both sides
at full severity (B08–B10 precedent). Questions that changed or sharpened the plan:

- **"Is the score migration needed, or scope creep ratified by a parenthetical?"** Needed:
  LOG-13's own DoD sentence says "a time or score", and no existing column holds
  "7 rounds + 12 reps" without lying (`reps` would make a WOD read as reps of one movement).
  The step scope pre-authorizes exactly this migration. Score lives on `sets` beside
  `duration_seconds` — one shape for "a result row" — not on `workout_exercises`.
- **"Timed *mode* swapping Reps → Time makes reps + time unloggable"** ("100 burpees for
  time, 7:32" has both) and creates parse-only-what's-visible subtlety. **Changed the plan:**
  the Timed chip is a disclosure that reveals Time + Score; nothing is hidden or swapped,
  collapsing clears the two boxes, and the Log enablement rule widens to "reps, weight, time
  or score present". This removed the mode state machine entirely.
- **"With no mode, what does Drop read?"** Exactly what Log set reads, plus the computed
  `dropSetPosition`. One payload, no special cases to test around.
- **"The W toggle on a drop chain is serialized per-segment writes — non-atomic. Toggle only
  the top set and derive the chain's look?"** No: `volume.ts` and `classifyPrs` read per-set
  `is_warmup`, so a display-only derivation would mislabel the drops in the math. Per-segment
  writes stay; each is atomic, a mid-way kill is visible on the card and recoverable by
  toggling again. Accepted edge, recorded in Risks.
- **"Why no `setSupersetGroup(entryId, n)` escape hatch?"** Group-number bookkeeping (fresh
  allocation, chain-join, orphan cleanup) must have one home or the UI re-implements it. The
  two named operations are the whole UI vocabulary; a raw setter would be the B10-rejected
  "second way to write" in new clothing.
- **"Can max+1 group allocation collide after unlink churn?"** No — max over groups present
  in this workout + 1 can't equal any existing group; `assertValidSupersetGroup` bounds it at
  the smallint edge.
- **"Reorder breaks a superset's adjacency — rewrite groups on every move/remove?"** No:
  display merges only adjacent runs, the data survives, relinking is two taps. Cascade
  rewrites would add multi-row writes to every reorder in the offline path for a case the
  lifter can see and fix. Recorded in Risks so Gate 1 can overrule cheaply.
- **"Comma tolerance in duration parsing?"** Dropped — a comma is a decimal convention and
  "4,32" must not quietly become 4:32. Digits and colons only; bare number = seconds;
  placeholder "m:ss" makes the convention visible.
- **"Repeat after a drop chain mints a stray segment — strip drop metadata in Repeat?"**
  No: Repeat's contract is "an exact copy" (NFR-2, shipped in B08). The grouping rule
  isolates the stray as its own plain row instead of mis-merging; format tests pin that.
  Recorded in Risks.
- **"Does the saved screen's merged Superset Card break set numbering?"** Numbering is
  logical (per the grouping helpers) and per-exercise within the merged Card; the helper is
  shared with the logger so the two screens can't drift.
- **"Text score invites junk."** So do notes (B12) — free text the user owns is not junk by
  definition. Nothing downstream parses scores; the 100-char CHECK plus `limits.ts` mirror
  keeps the poison-row rule intact.
- **"Score separator in `formatSet` can collide with the '—' empty-load placeholder."**
  Score-only sets print the score text alone (removing the main collision); the joined
  separator is pinned by the format tests as the one spelling.

## Deviations during build (recorded by the builder)

1. **Superset operations are a "hinge", and the unlink is `unlinkFromPrevious`, not
   `unlinkFromSuperset`.** The card's toggle means "this card is linked to the one above it", so
   the two store operations act on that boundary:
   - `linkWithPrevious` merges the run above with the run starting at this entry. The previous
     entry's number wins; if it has none, this entry's own; if neither has one, max + 1. So
     linking card 2 when cards 2–3 are already linked makes a tri-set (the plan's rule would have
     split 2 off from 3), and linking two supersets merges them.
   - `unlinkFromPrevious` splits the run at this entry. The lower part gets a fresh number; the
     plan's "remove just this one entry" would have left cards 1 and 3 of a tri-set sharing a
     number while no longer adjacent.
   - Any number held by only one entry is cleared (the plan's orphan rule, generalised).
   - Added after review: before either action the numbers are rewritten to match what is shown
     (`asShown`). A member moved away from its superset loses its number, and a number shared
     by two separate runs is split. Without this, linking could pull a far-away stray into a
     tri-set the lifter never built (review repro: `[A(1), C, B(1)]`, link B → A, C, B all one
     group). These writes happen only inside link/unlink; reorder and remove still never
     rewrite groups.
2. **Two batch store operations, `updateSets` and `removeSets`** (one transaction each), added
   after review.
   - The plan had the W toggle on a drop set as serialized per-segment `updateSet` calls; it is
     now atomic.
   - The plan gave each segment only its own remove. Removing just the top row left drop 1
     behind, which the grouping rule then attached to the *previous* set as its drop (it
     mis-merged, displayed and synced wrong). So the top row's remove now removes the whole
     drop set; each drop row keeps its own remove.
   - Risk 3's grilling note about non-atomic W writes no longer applies.
3. **Load before time in `formatSet`**: "100 reps · 7:32", "20 kg · 1:00". The plan's example
   read "0:45 · 135 lb". Reps × weight comes first everywhere else, so the time follows it.
4. **Drop grouping needs a strictly higher drop number, not exactly +1.** The plan wrote
   `(prev ?? 0) + 1` but also required that a removed middle drop leave a gap the rule
   tolerates. Exactly +1 would break the chain at the gap. Strictly increasing satisfies both
   the gap rule and isolating a Repeat-copied stray.
5. **Migration version.** The builder wrote the file as `20261115100000_sets_score.sql`; Supabase
   recorded the live apply as version `20261115024010` (same mismatch pattern as B05's signup
   gate). The builder's rename was declined by its permission layer; **renamed at Gate 2** to
   `20261115024010_sets_score.sql` (and B05's file to `20261114224613_…`), references updated.
6. **v1 → v2 upgrade test added** to `schema.test.ts`. The plan assumed B07's harness already
   ran an upgrade path; only fresh-file creation was covered.
