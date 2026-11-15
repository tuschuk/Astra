# workout-notes — B12: Notes on a set, an exercise or the whole workout (LOG-3)

**Branch:** `workout-notes` (from `main`)
**Build step:** B12 — covers LOG-3 (whole: "Notes at all three levels save with the workout and
show when it is reviewed").
**Depends on:** B09 (the logger and saved-workout screens), and through it B08 (the
active-workout store), B07 (device SQLite + sync), B06 (`@training-math`).

## Step definition of done (from the Build order)

Notes on a set (migration adds `sets.notes`), an exercise and the whole workout, editable in the
logger and shown on the saved workout. All three levels save, sync, and show on review.

## Scope check

Two things to say out loud, neither a silent change:

1. **The workout title rides along, by standing instruction.** The step scope names notes only,
   but `docs/HANDOFF.md`'s note for this planner says B08 deliberately left *title and notes*
   setters out of the store and their limits out of `limits.ts` ("title ≤ 100, workout notes
   ≤ 2000, entry notes ≤ 1000 per the server CHECKs) — B12 adds both", and B09's plan recorded
   "no title editor sneaks in ahead of B12" with the saved screen already rendering
   `workout.title ?? date label`. No other build-order step or feature row owns the title, so
   leaving it out of B12 would orphan it. This plan takes it: one `setTitle` store operation, one
   `limits.ts` rule, one `TextInput` in the logger header. Recorded here as a deliberate,
   HANDOFF-directed widening of the scope sentence — not scope the planner invented.
2. **`sets.notes` has no server CHECK yet, so this step picks its cap.** The existing free-text
   columns step down 2000 (workout) → 1000 (exercise); this plan caps a set note at **500**
   characters — commentary about one set, longer than a score (100) but shorter than an
   exercise note. The cap is this plan's decision of record; the migration and `limits.ts` cite
   each other either way, so changing it later is one pair of edits.

## What exists (explored)

- **Server** (`20261114100100_training.sql`): `workouts.title` CHECK ≤ 100, `workouts.notes`
  CHECK ≤ 2000, `workout_exercises.notes` CHECK ≤ 1000. `sets` has **no** notes column. RLS on
  all three tables is row-level (owner writes, visibility-based reads), so a new column on
  `sets` is covered with no policy change — same as B11's `score`.
- **Device** (`frontend/src/db/schema.ts`): V1 already mirrors `workouts.notes` and
  `workout_exercises.notes`; `sets` lacks `notes`. Migrations are append-only (`V2` added
  `score`); this step appends `V3`.
- **DAO** (`frontend/src/db/dao.ts`): `TABLE_COLUMNS` drives every upsert, select and push, so
  adding `'notes'` to the `sets` list (plus the `SetRow` type) makes the column flow through
  draft writes, finish-enqueue, push, pull and every read in `history.ts` with no further wiring.
- **Store** (`frontend/src/workout/activeWorkout.ts`): writes workout/entry/set rows through the
  draft path; `SetInput` → `setColumns` → `assertValidSetFields` is the one funnel for set
  values; `setInputFromRow` must round-trip every column or an edit wipes it (the B10 W-toggle
  rewrites sets from it). No title/notes setters exist (B08 left them for this step).
- **Screens**: the logger header (`app/active-workout.tsx`) shows "Workout / Started …" with no
  inputs; `EntryCard` shows name, last-time line, set rows, entry row; the saved screen
  (`app/workout/[id].tsx`) already prints `workout.title` when set and renders set rows through
  `formatSet`/`formatDropSet`.
- **Limits** (`backend/supabase/functions/_shared/training-math/limits.ts`): the one home for
  server-rule mirrors; already counts text the server's way (code points, private `scoreLength`).

## What this step builds

### 1. Data model — one server migration, one device migration

- **Server** `backend/supabase/migrations/<version>_sets_notes.sql`:
  `alter table public.sets add column notes text check (char_length(notes) <= 500);` plus a
  plain-language header comment (what a set note is, that nothing parses it, that RLS is
  unchanged, that the phone checks the same cap in `limits.ts` — the `sets_score.sql` template)
  and a `comment on column`. The builder applies it live via the Supabase MCP and **renames the
  file to the version Supabase records** (`list_migrations`), per the builder prompt and B11's
  Gate 2 record.
- **Device** `schema.ts`: append `V3 = alter table sets add column notes text;` and bump
  `SCHEMA_VERSION`. Existing installs at V2 migrate forward; `schema.test.ts` already asserts
  `TABLE_COLUMNS` matches the migrated schema, which forces the next bullet.
- **DAO**: `'notes'` joins `TABLE_COLUMNS.sets`; `SetRow` gains `notes: string | null`;
  `fromSqlRow` needs no change (text passes through).

### 2. Limits — the shared home grows four text rules

In `limits.ts` (exported via the `@training-math` index):

- Constants: `MAX_WORKOUT_TITLE_LENGTH = 100`, `MAX_WORKOUT_NOTES_LENGTH = 2000`,
  `MAX_ENTRY_NOTES_LENGTH = 1000`, `MAX_SET_NOTES_LENGTH = 500`.
- The private `scoreLength` generalizes to one code-point counter used by every text rule (the
  server's `char_length` counts an emoji once; JS `.length` counts it twice).
- `assertValidWorkoutTitle(title)`, `assertValidWorkoutNotes(notes)`,
  `assertValidEntryNotes(notes)` — throw `RangeError` past the cap, like everything else there.
- `SetFieldsToCheck` gains `notes?: string | null`, checked inside `assertValidSetFields` — so
  a set note rides the existing funnel and can never reach the outbox overlong.
- The file-top table of mirrored server rules gains the four lines, citing
  `20261114100100_training.sql` and the new `sets_notes` migration.

This is the HANDOFF-directed landing spot ("add their length limits to `@training-math`
`limits.ts`") — the one-home rule, not a second rules home: the store and any future server
function read the same file.

### 3. Store — three small setters, one input field

In `activeWorkout.ts` (every one a `mutate(...)` like the rest: validate → one draft-path
transaction → re-read snapshot; refused once the workout is finished or discarded):

- `setTitle(title: string | null)` — trims; empty becomes null; `assertValidWorkoutTitle`;
  rewrites the `workouts` row via `writeDraftRowsTx`.
- `setNotes(notes: string | null)` — same, with `assertValidWorkoutNotes`.
- `setEntryNotes(entryId: string, notes: string | null)` — same against the
  `workout_exercises` row, with `assertValidEntryNotes`.
- `SetInput` gains `notes?: string | null`; `setColumns` trims it (blank → null) and
  `assertValidSetFields` checks it; `setInputFromRow` returns it (so the W-toggle and any
  `updateSet` edit preserve an existing note).
- **`repeatLastSet` does not copy the note.** Reps, weight, RPE, warm-up, drop number, duration
  and score are the set's performance; a note is the lifter's remark about *that one set*
  ("elbow twinged on rep 3") — one tap silently duplicating remarks fabricates commentary. The
  repeat copies every column it does today and leaves `notes` null. Recorded in the store's
  comment and pinned by a test.

No new DAO paths: `writeDraftRowsTx` already accepts `workouts` and `workout_exercises` rows,
and `finish`'s `writeLocalTree` already enqueues whatever the rows then hold — notes sync with
the workout by construction.

### 4. Logger UI — editing at all three levels

One tiny shared hook carries the typing-to-store pattern for all three editors,
`frontend/src/workout/useAutosaveText.ts`: local state for the `TextInput`, a debounced save
(~750 ms after the last keystroke) through the given store setter, and a `flush()` that saves
pending text immediately and returns the save's promise. Saving as-you-type (not only on blur)
is the offline-first-honest choice: `onEndEditing` is not guaranteed to fire when the app is
killed or the screen unmounts, and a note typed mid-set must survive a force-kill like
everything else. The hook's full contract (each line grilling-settled, see below):

- a pending save fires through the setter only while `store.getStatus() === 'active'`; after
  finish or discard it is dropped silently — never a spurious "This workout is finished" error
  from a timer that outlived the workout;
- **unmount flushes rather than cancels** — leaving the screen mid-debounce still lands the
  text (fire the save, don't await it);
- a save that fails (`RangeError` past the cap) surfaces as the card/header's inline error;
  `maxLength` on each input makes that near-unreachable. (RN's `maxLength` counts UTF-16
  units, so for emoji it is *stricter* than the server's code-point count — the safe direction;
  `limits.ts` remains the real guard. Stated so nobody "fixes" the mismatch.)

- **Workout level** (`app/active-workout.tsx` header): a one-line **Title** input
  (placeholder "Workout title", `maxLength` 100) and a multiline **Notes** input (placeholder
  "Notes", `maxLength` 2000, auto-growing a few lines), under the "Started …" line. `onFinish`
  flushes both editors *before* `store.finish()` — a title typed and immediately followed by a
  Finish tap must land in the sealed workout (taps don't blur inputs here,
  `keyboardShouldPersistTaps="handled"`).
- **Exercise level** (`EntryCard`): under the name/last-time block, the entry's note when it has
  one, or a muted **Add note** text row; tapping either swaps in a multiline input
  (`maxLength` 1000) wired to `setEntryNotes` through the hook. A note cleared to blank saves as
  null and the row collapses back to "Add note". A plain text row, not a fifth header icon —
  the four-icon header is already flagged for Tristen's phone-width check.
- **Set level** (`EntryCard`): each logged set row (drop rows included) gains a small
  note-outline icon button; rows whose set has a note show it as a muted line under the row.
  Tapping the icon (or the note line) opens the inline editor (`maxLength` 500) for that set —
  the card holds one `editingSetId`, so at most one set editor is open per card. The save goes
  through `updateSet(setId, { ...setInputFromRow(current), notes })`, where `current` is the
  row looked up **fresh from `store.getSnapshot()` by `setId` at save time** — never a row
  captured when the editor opened, or a debounced note-save would write back a stale warm-up
  flag the lifter toggled while typing (the silent-revert bug the grilling caught; pinned by a
  component test). Notes are added *after* a set is logged — there is no note box in the entry
  row. One write path (`updateSet`), no extra entry-row state, and it matches when notes
  actually happen (the remark comes after the rep, not before).

### 5. Saved workout — showing all three levels (read-only)

`app/workout/[id].tsx`:

- Workout notes as a `Body` block under the details line (title already renders).
- An entry's note as a muted line under its exercise name.
- A set's note as a muted line under its set row; for a drop-set chain, each segment's note in
  segment order (prefixed so it reads as the drop's, e.g. "↳ …") — display-only composition in
  the screen, no `format.ts` change needed beyond what exists.

Editing stays out: changing a finished workout is B14. The columns ride `readWorkout` already
(TABLE_COLUMNS-driven), so the screen change is pure rendering.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_sets_notes.sql` | new — `sets.notes` text CHECK ≤ 500 (§1); applied live, file renamed to the recorded version |
| `frontend/src/db/schema.ts` | edit — append V3, bump `SCHEMA_VERSION` |
| `frontend/src/db/dao.ts` | edit — `SetRow.notes`, `TABLE_COLUMNS.sets` + `'notes'` |
| `backend/supabase/functions/_shared/training-math/limits.ts` (+ test) | edit — four text caps, shared counter, `SetFieldsToCheck.notes` (§2) |
| `backend/supabase/functions/_shared/training-math/index.ts` | edit — export the new names |
| `frontend/src/workout/activeWorkout.ts` (+ test) | edit — `setTitle`, `setNotes`, `setEntryNotes`, `SetInput.notes`, `setInputFromRow`, repeat-leaves-notes (§3) |
| `frontend/src/workout/useAutosaveText.ts` (+ test) | new — debounced autosave + flush hook (§4) |
| `frontend/src/app/active-workout.tsx` | edit — title + notes inputs in the header, flush-before-finish |
| `frontend/src/components/workout/EntryCard.tsx` (+ test) | edit — entry-note row + per-set note icon/editor/display |
| `frontend/src/app/workout/[id].tsx` | edit — render notes at all three levels |
| `frontend/src/__tests__/saved-workout.test.tsx` | edit — fixture workout with notes at all three levels shows them |
| `frontend/src/__tests__/logger-flow.test.tsx` | edit — the DoD walk gains notes (see Testing) |
| `docs/diagrams/database-erd.md` | edit (Document step) — `sets.notes` + its CHECK |
| `docs/diagrams/app-flow.md` | edit (Document step) — note editors and their data path |
| `docs/BUILD_LIST.md` | not touched — status flips happen at Gate 2 |

## Data model impact

One nullable text column on `sets`, server (CHECK ≤ 500) and device (no CHECK — the device
repeats no server CHECKs; `limits.ts` is the pre-flight). No RLS change: the existing row-level
policies on `sets` cover the column, and workout/exercise/set notes inherit the workout's
visibility — they are training commentary, not the PRD's sensitive classes (body data, progress
pics, recovery), so workout-level visibility is the right privacy boundary. No index: nothing
queries by note.

## Testing

- **`limits.test.ts`** — each cap at, under and over its boundary; code-point counting (an
  emoji-laden string near the cap passes here iff the server's `char_length` would);
  `assertValidSetFields` refuses a 501-character note.
- **`activeWorkout.test.ts`** — setters persist through the snapshot; blank trims to null;
  over-cap throws `RangeError` *before* any write; a killed-and-reloaded store
  (`loadActiveWorkout` on a fresh driver over the same file) still holds all three levels — the
  step's "save" proof; `finish` + `pushOutbox` against the fake transport lands notes on the
  fake server — the "sync" proof; `repeatLastSet` copies everything but the note;
  `updateSet` via `setInputFromRow` preserves an existing note; setters refuse after finish.
- **`useAutosaveText.test.ts`** — debounce saves once after typing settles; `flush` saves
  pending text immediately and its promise resolves after the save; a pending save is dropped
  once the store is no longer active (no error surfaces); unmount flushes rather than cancels;
  a save error is reported, not thrown into the component.
- **`EntryCard.test.tsx`** — add/edit/clear an exercise note; add a note to a logged set and see
  it under the row; clearing removes it; only one set editor opens at a time; **the stale-row
  test**: open a set's note editor, toggle that set's W flag, let the note save — the flag
  survives (the save read the current row, not the captured one).
- **`saved-workout.test.tsx`** — a fixture with notes at all three levels shows all three; a
  drop set's segment notes all appear.
- **`logger-flow.test.tsx`** — the end-to-end walk gains: set a title, a workout note, an
  exercise note and a set note mid-workout → finish → the saved screen shows all of them (LOG-3's
  DoD in one test).

All on the node SQLite driver and fake transport; the real Supabase project is never touched by
tests (repo rule).

## How the definitions of done become observably true

- **Step DoD / LOG-3** ("all three levels save, sync, and show on review"): *save* — the
  kill-and-reload store test; *sync* — the finish-to-fake-server push test plus the builder's
  live-migration probe at Gate 2; *show on review* — the saved-workout and flow tests render all
  three levels. Editable in the logger — the EntryCard and header editors, exercised in
  component tests. Device verification (typing on a real keyboard, autosave feel) is Tristen's
  Built → Done pass, as with every step.

## Out of scope (this branch)

- **Feed display of notes** (B20) and **post-workout analysis** (B18) — analysis ignores notes
  by design (the `sets_score.sql` precedent states it for score; same for notes).
- **Editing notes (or anything) on a finished workout** — B14; the saved screen stays read-only.
- **Notes on another user's workout in the feed/profile** — reads are already governed by
  workout visibility RLS; nothing additional here.
- **Rich text, mentions, photos in notes** — plain text only; nothing in the PRD asks for more.
- **Templating/program notes** (B35) and **per-set note prompts from programs** — not specced.

## Risks a reviewer should weigh

1. **The autosave hook is new UI machinery between keystroke and store.** If its debounce or
   flush mishandles an edge (unmount mid-debounce, Finish racing a pending save, a timer firing
   after finish/discard), a typed note silently fails to land or a dead store throws into the
   UI — the exact classes of loss and noise the offline-first rule and B09's error discipline
   forbid. Mitigations: the contract in §4 (status-checked saves, unmount-flush, awaited
   `flush()` before `store.finish()`), each line with its own test; the flow test types a note
   and finishes in the same breath. Read the hook and the flush path first — and the set-note
   save's fresh-row lookup (§4), the one place a stale closure could revert another edit.
2. **`setInputFromRow` and `repeatLastSet` now disagree about one column on purpose.** Repeat
   leaves notes behind; edit-round-trips keep them. If a future change "fixes" either to match
   the other, warm-up toggles would start wiping notes, or repeats would start duplicating them.
   Both behaviors are pinned by tests and named in the store's comments.
3. **Three hand-mirrored caps plus a brand-new one.** `limits.ts` gains four rules copied from
   SQL by hand, and `sets.notes`' 500 exists only because this plan says so — the migration and
   `limits.ts` must cite each other, and the builder must apply the migration live and rename
   the file to the recorded version (B11's lesson) or `supabase db push` breaks later. Drift has
   no cross-SQL/TS test (nothing executes both); it is review-time discipline, same as B08
   recorded.

## Grilling decisions (settled before code)

Run per the workflow's Grill step; headless pipeline run, so the planner attacked the plan at
full severity (B08/B09 precedent). What changed or got pinned:

- **"The scope says notes; where does a title editor come from?"** From HANDOFF's standing
  instruction to this planner and B09's "no title editor sneaks in ahead of B12". No other step
  owns it; the cost is one setter, one limit, one input. Taken, and declared in Scope check
  rather than smuggled.
- **"Why 500 for a set note and not 1000, 100, or no cap?"** A cap must exist (every free-text
  column has one; uncapped text is a storage/abuse hole), and no spec names one. 100 (score's
  cap) truncates real remarks ("left knee caved on rep 4, dropped 10 lb and it held…"); 1000
  equals the exercise cap and erases the hierarchy. 500 is a paragraph — enough for any set
  remark. The number is arbitrary within reason and cheap to change; what matters is that the
  migration and `limits.ts` state it together. Settled: 500.
- **"Notes in the entry row too, so a note can be typed before logging?"** Rejected as the
  primary path: it doubles the input-row state (which already carries warm-up, timed, score) and
  the remark nearly always postdates the rep. Edit-after-log through `updateSet` is one path
  that covers everything. If device use shows lifters wanting pre-typed notes, it is a UI-only
  addition later — `SetInput.notes` already exists for it.
- **"Should Repeat copy the note? It copies score."** Score is the set's *result*; a note is
  *commentary*. Duplicated results are plausible (same work, same score shape — and B11 already
  accepted Repeat copying the drop number as a known wrinkle); duplicated commentary is false
  record. Settled: Repeat copies performance columns only, pinned by a test either way so the
  disagreement with `setInputFromRow` is loud (Risk 2).
- **"Save-on-blur is simpler than a debounce hook — why the machinery?"** Because blur is not
  guaranteed: a force-kill mid-typing, a Finish tap with the keyboard up
  (`keyboardShouldPersistTaps="handled"` means the tap does not blur), or an unmount can all
  skip `onEndEditing`, and NFR-3's promise is that the in-progress workout survives the app
  dying. Debounce-plus-flush loses at most the last ~750 ms of typing on a kill. The hook is
  ~30 lines and shared by all three editors — less total code than three bespoke blur handlers
  plus the flush each would still need.
- **"Does `writeDraftRowsTx` even accept a `workouts` row — or does this need new DAO work?"**
  Checked during Explore: it is typed to the three workout-tree tables and the store already
  rewrites `workouts` rows (finish does). No DAO change; the plan says so explicitly so the
  builder doesn't invent one.
- **"Why no `format.ts` change?"** Notes are shown verbatim as their own lines, never folded
  into the one-line set text (`formatSet`'s job). Folding a 500-character note into "Set 3 ·
  5 × 225 @ RPE 8" would wreck the line everywhere it is reused (last-time, future feed). The
  saved screen composes rows; composition is the screen's job.
- **"Entry notes exist on the server since B02 — is any sync/pull work needed at all?"** No:
  both columns already ride `TABLE_COLUMNS` on the device; only `sets.notes` is new anywhere.
  The step's sync work is exactly one column in one list — stated so the builder doesn't go
  looking for more.
- **"Is a 2000-character multiline input in a FlatList header going to fight the keyboard?"**
  Possibly on-device (keyboard avoidance is already on Tristen's phone-width check list for
  B09–B11 items); functionally it is a plain controlled input and `keyboardShouldPersistTaps`
  is already set. UI polish beyond that is the device pass's call, not this branch's.
- **"A debounce timer can outlive the workout — what happens when it fires after finish or
  discard?"** First draft said only "flush before finish", which covers the editor being
  flushed but not a *different* editor's pending timer, and after discard the row is gone
  entirely. Settled: the hook drops a pending save unless `store.getStatus()` is `active`
  (silently — the text was either flushed already or belongs to a workout that no longer
  exists), and `flush()` returns a promise `onFinish` awaits. Both pinned in the hook's tests.
- **"What does unmount do with pending text — cancel the timer like a good React citizen?"**
  No: cancelling loses the text on plain back-navigation, the everyday case. Unmount flushes
  (fires the save without awaiting). The store outlives the screen in the session slot, so the
  save has somewhere to land; if the store went inactive meanwhile, the status check drops it.
- **"The set-note save spreads `setInputFromRow(set)` — which `set`, captured when?"** The
  grilling's sharpest catch: a row captured at editor-open time would, on a debounced save,
  write back a warm-up flag (or any field) the lifter changed while the editor was open — a
  silent revert. Settled: the save looks the row up fresh by `setId` from `store.getSnapshot()`
  at save time, and a component test toggles W mid-edit to prove the flag survives.
- **"N set rows × an autosave editor each — how much live state per card?"** One: the card
  holds a single `editingSetId`; rows render their note as text until tapped. No editor
  instance per row.
- **"RN `maxLength` counts UTF-16 units, the server counts code points — drift?"** Drift in the
  safe direction only: an emoji-heavy note hits the input cap *before* the server cap, so
  nothing over-cap can be typed, and `limits.ts` (code-point counting, like `scoreLength`
  today) is the guard that matters. Recorded so nobody swaps `maxLength` for a code-point
  counter in the UI and adds complexity for zero safety.
- **"Why not put workout notes on the saved screen as the editing surface (notes often come
  after finishing)?"** Because editing a finished workout is B14's tombstone/re-sync problem,
  and the scope sentence says "editable in the logger". The logger keeps the single
  draft-then-finish write model. When B14 lands, its edit surface inherits these same setters'
  validation through `limits.ts`.
