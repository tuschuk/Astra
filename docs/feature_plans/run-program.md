# run-program (B35)

Covers **PRG-3** (whole: "running a program, each tap of Workout opens the correct next session
with targets prefilled, advancing week by week") and completes **LOG-1** ("the Workout button
starts a blank workout, and starts the correct prefilled next session when a program is active" —
the blank half shipped in B08/B09; the program half is this step). Depends on B34 (the program
tables, `programs/programs.ts`, `readProgramTree`) and B09 (the Workout tab and logger over the
B08 store).

Step scope: `program_runs` (active program, position) synced and cached in SQLite; the Workout
button starts the next session prefilled with targets, advancing week by week, offline.
Step DoD: **each tap of Workout opens the correct next session with its targets.**

The scope is right as written; nothing in it needs widening or narrowing. One wording note:
"the Workout button" is read as the Workout tab's primary start action (the B09 screen), which
becomes "start the next session" while a run is active — not a new global button.

## What exists (verified before planning)

- **Programs (B34):** four author-only tables, mirrored on the device (schema V12, no local FKs),
  pushed by the generic machinery and pulled by per-table standalone passes
  (`transport.pullProgramRows`, parents first). `programs/programs.ts` is the one home;
  `readProgramTree(db, userId, programId)` returns the live tree ordered `(position, id)` at every
  level with exercise names resolved (null/unresolvable → "Deleted exercise") — the read this
  step's prefill was built to share. Weeks and workouts are never reordered (only exercise slots
  move); weeks are unnamed ("Week N" by order); removal is a soft delete that stamps only the
  removed node.
- **The logger (B08/B09/B12/B13):** `startActiveWorkout(db, userId, options)` is the only way a
  workout begins (refuses while one is unfinished; the tab already offers Resume/Discard);
  `activeWorkoutSession.ts` holds the one store slot screens share; the store has `addExercise`,
  `logSet`, `setTitle`, `setEntryNotes`, and `finish()` runs through `draftPolicy.finish`, which
  already gathers PR rows and commits workout + entries + sets + records atomically via
  `writeLocalTree`. The device repeats no server CHECKs; `@training-math` `limits.ts` governs.
- **Sync:** `SYNC_ORDER`/`TABLE_COLUMNS`/`RowByTable` in `dao.ts` drive push generically;
  `pull.ts` has `pullStandalone` with per-table `CURSOR_KEYS`; `PullResult` counts per table.
  Device schema is at V12 (`SCHEMA_VERSION` pinned in `schema.test.ts`).
- **Workout tab (`app/(tabs)/workout.tsx`):** "Start from a program" is a disabled ghost button;
  "Start empty workout", Resume/Discard, Your programs, Tool Kit tiles, past workouts.
- `export-data` reads `workouts` with `'*'`, so a new workouts column rides the export for free;
  its program-tables gap is a recorded DEFERRED item. "Repeat" in the app is repeat-last-*set*
  only — there is no whole-workout copy path that could smuggle a program link.

## Settled decisions

### (a) `program_runs` — one new synced table; runs end, they are never deleted

New migration `backend/supabase/migrations/<ts>_program_runs.sql` (builder applies via MCP and
renames to the version Supabase records — the B11 discipline):

```sql
create table public.program_runs (
  id                    uuid primary key,              -- client-generated
  user_id               uuid not null references public.profiles (id) on delete cascade,
  program_id            uuid not null references public.programs (id) on delete cascade,
  -- Where the run is: the server `position` values (not 1-based display numbers) of the next
  -- session's week and workout. See (b) for why positions and not an id.
  next_week_position    smallint not null check (next_week_position >= 0),
  next_workout_position smallint not null check (next_workout_position >= 0),
  started_at            timestamptz not null,
  ended_at              timestamptz check (ended_at is null or ended_at >= started_at),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index program_runs_user_idx on public.program_runs (user_id, updated_at);
create index program_runs_program_idx on public.program_runs (program_id);
```

`moddatetime` trigger; RLS on with **owner-only policies for all four verbs**
(`user_id = auth.uid()` — the table carries its own `user_id`, so no `private.*` helper chain is
needed; B37's coach-assigns-a-run is its own migration and policy change).

The `ended_at >= started_at` CHECK is itself a cross-device poison-row hazard: a run started on
phone A can be stopped on phone B whose clock sits behind A's. So the module clamps
`ended_at = max(now, started_at)` at **every** site that stamps it — stop, the auto-end inside
`startProgramRun`, and run completion — the B08 clock-anomaly clamp, applied uniformly.

**No `deleted_at`.** A run is never deleted, it *ends*: stopping a run, finishing its last
session, and switching programs all stamp `ended_at`. Ended rows are the run history B37/B40 can
read later, and an UPDATE rides the existing upsert push/standalone pull exactly as B34's soft
deletes do — nothing is ever absent, so nothing needs a tombstone or a stamp.

**No server-side "one active run per user" constraint.** The handoff floated a partial unique
index on `(user_id) where ended_at is null`; it is rejected here as a poison-row trap: two phones
starting runs offline would both insert an active run, and the second upsert to arrive would
violate the index and wedge that phone's push forever (the B07 recorded limit — push stops at the
first refused batch; only the posts path maps a 23505 specially). Instead, one-active is enforced
where it can't wedge: **on the device**, `startProgramRun` stamps `ended_at` on every active run
it can see in the same `writeLocal` batch as the new row (one table → one atomic write), and
**every read resolves "the" active run as the newest `started_at`** (`ended_at is null`, tie-break
by id — the `loadActiveWorkout` newest-wins precedent). Two phones offline can thus converge to
two active rows; reads agree on the newest, and the next `startProgramRun` on either phone ends
both. Harmless, recorded.

### (b) The position is `(next_week_position, next_workout_position)`, not a workout id

The handoff asked the planner to weigh "week position + workout position" against "the next
`program_workout_id`" for surviving mid-run edits. Weighed:

- **An id pointer dangles with no recovery.** If the author removes the pointed-at workout (or
  its week — both are one tap in the B34 editor), the id no longer resolves in the live tree and
  the run has no idea where it was; recovering would need a stored position fallback anyway — two
  mechanisms.
- **Positions degrade gracefully, and B34 made them stable.** Weeks and workouts are never
  renumbered (only exercise slots move; B34 recorded "weeks and workouts keep their add order"),
  so a stored `(week.position, workout.position)` means the same thing until that exact node is
  removed — and when it is, the resolution rule below slides forward to the session that now
  stands where it stood, which is what a lifter mid-run would expect. Appending weeks or workouts
  (the only inserts B34 allows) lands at the tail and never shifts stored positions.
- 1-based display indices ("week 2") were rejected for the same reason ids were: removing week 1
  would silently renumber every later week and make the run repeat or skip sessions.

**Resolution rule** (the one function both the tab and prefill call,
`resolveNextSession(tree, run)`):

1. Take the live weeks with `position >= next_week_position`, in tree order.
2. In the first of them: if its position **equals** `next_week_position`, the next session is its
   first live workout with `position >= next_workout_position`; if that week has none past the
   pointer (or the exact week is gone — the pointer's week was deleted), fall to the **first**
   live workout of the next live week that has one (a stored workout position from a deleted week
   is meaningless inside a different week).
3. Skip weeks with no live workouts.
4. Nothing found → the run is complete (see (d)).

Deterministic, pure (takes the tree and the run row, returns a `ProgramWeekNode`/
`ProgramWorkoutNode` pair or "complete"), and unit-testable without a database.

### (c) Advancing happens inside `finish`, atomically, keyed by a durable link

**`workouts.program_workout_id`** — the same migration adds a nullable column:

```sql
alter table public.workouts add column program_workout_id uuid
  references public.program_workouts (id) on delete set null;
create index workouts_program_workout_idx on public.workouts (program_workout_id);
```

Why a column on `workouts` and not a field on the run: the finish that advances the run can
happen days after the start, after any number of app kills — the link must be as durable as the
draft itself, and an in-memory note dies with the process. On `workouts` it also gives history,
analysis and the feed the "Week 2 · Day 1" story later without another migration (the handoff
names exactly this reading). Existing policies cover the column (RLS is row-level); the FK is
existence-only, like `exercise_id` — the B34 grilling's precedent. `export-data` selects `*` from
`workouts`, so exports carry it with no function change. Device: V13 adds the column to the
mirror `workouts` table as a **bare column** (the B34 no-local-FK rule: a pulled workout may name
a program workout this phone hasn't pulled yet) plus the `program_runs` table, also FK-free.

**Advance mechanics:** `startActiveWorkout` gains a start-only option (`programWorkoutId`)
written into the new workout row. `draftPolicy.finish` — already the atomic home of
workout + sets + PRs — asks the run module for the advance rows and hands them to
`writeLocalTree`, whose accepted tables widen to include `program_runs`. One transaction: the
finished workout, its tree, its PRs and the advanced (or completed) run commit together, so a
kill can never log the session without moving the run (the B08 "finish is the load-bearing atom"
rule, extended).

`advanceRunOnFinish(db, userId, programWorkoutId, now) → ProgramRunRow[]` (in the run module):

- Loads the active run (newest, as in (a)); returns `[]` if none, or if the finished workout's
  program workout doesn't belong to the run's program (walk `program_workouts → program_weeks →
  program_id` on raw rows — deleted or not, the rows exist; soft delete keeps them), or if the
  run's program is gone. Finishing an off-program or stale-linked workout never moves a run.
- Computes the session **after the finished one**: the finished workout's own
  `(week.position, position)` — read even if since soft-deleted — then the first live session
  strictly after it ((b)'s rule with a strict bound). Advancing from the *finished* session, not
  from the stored pointer, makes the advance self-correcting: finishing Week 1 Day 1 twice points
  at Day 2 both times, and a run moved further by another device is simply overwritten by the
  lifter's latest actual finish (row-level LWW, the B14 class — one phone per lifter is launch
  reality; recorded).
- Next session found → run row with the new positions; none → run row with `ended_at = now`
  (clamped as in (a)).

`draftPolicy.finish` consults the run module **only when the workout row carries a non-null
`program_workout_id`** — a plain finish (every workout today) reads and writes exactly what it
does now, byte for byte.

Discarding a program-started workout advances nothing (the run only moves on finish — the lifter
can discard and tap Workout again for the same session). Deleting a *finished* program session
(B14) does not rewind the run; advancing is one-way, recorded as a product reading.

### (d) End of the last week: the run ends — no loop

The handoff's open product reading. Decision: **finishing the final session completes the run**
(`ended_at` stamped in the finish transaction); the Workout tab reverts to "Start empty workout"
+ "Start from a program", and starting the same program again is two taps away and begins at
Week 1. Looping silently to Week 1 was rejected: a program is a finite plan (N weeks of
progression by construction — B34's whole data model), and a loop misrepresents completion,
inflates "active" state forever, and forecloses nothing — a lifter who wants to repeat restarts.
A completion flourish (a "Program complete" card or analysis line) is deferred: nothing in PRG-3
or LOG-1 asks for it. Restarting (or re-running a stopped program) always begins at the first
live session — a run that ended is over, it has no resumable place. **Recorded for Tristen to
confirm or overrule.**

### (e) Prefill = exercises + targets through the store — no pre-logged sets

What "the next session with targets prefilled" opens as: a new workout whose **title** names the
session, with **every runnable slot's exercise already added in program order**, and **each
exercise's targets written on its entry** — through existing store operations only (the handoff's
standing direction: "through the store, not a new write path").

`startProgramSession(db, userId)` (see (f) for where it lives):

1. Resolve the active run and next session ((b)); throw a typed refusal if there is no run, the
   program is gone, or the run is complete (the tab won't offer the button then — a safety net).
2. `startSessionWorkout(db, userId, { programWorkoutId })` — the session slot, so the tab and
   logger share the store; the link is in the workout row from birth (c).
3. `setTitle("<program name> — Week N · <workout label>")`, truncated to the 100-char limit
   (`limits.ts` governs) — the session's name in history and the feed today, no analysis change.
   "Week N" is the display number (what the program page shows at that moment, B34's rule), not
   the stored position: prose for humans, and finished workouts keep the title they were born
   with even if the program is edited later.
4. For each slot in order: skip a slot whose exercise this phone can't use (null `exercise_id`,
   someone else's, or a hard-deleted row — the same predicate `addExercise` enforces; checked
   first, so no try/catch flow); otherwise `addExercise(exerciseId)` then
   `setEntryNotes(entryId, formatProgramTargets(slot, unit))` — e.g. "Target: 3 × 8 @ 225 lb ·
   RPE 8" with the weight in the lifter's display unit. The entry note renders in the logger
   today (B12), survives kills (it's a draft row), and the lifter can edit or clear it like any
   note.
5. Return the store; the caller routes to `/active-workout`.

**Pre-creating `target_sets` set rows was rejected** (both flavors the handoff floated). Sets
carrying the target values would count as *performed* on an untouched Finish — false volume, and
PR detection (B13 runs over finished sets) could mint PRs from weights never lifted; worse, the
logger has no inline set editor (the recorded B14 deferral), so every deviation from target would
be remove-then-relog. Empty set rows would inflate the analysis's set counts and render as dashes.
Targets-as-entry-notes costs zero new mechanism, zero false data, and leaves logging exactly as
the lifter knows it, with the prescription in view. If device use shows lifters want the entry
boxes seeded with target numbers, that is an `EntryCard` prop fed from the same slot data — a
later, additive change, recorded.

Prefill is a short sequence of store transactions, not one atom: a kill mid-prefill leaves a
partially prefilled draft, which Resume reopens and the lifter finishes or discards — nothing
wedges, nothing syncs early (drafts never sync). Accepted; recorded.

### (f) Module layout — one home for runs, and no import cycle

New **`frontend/src/programs/programRuns.ts`** — every read and write of `program_runs` (the
`programs.ts`/`customExercises.ts` discipline), importing only `dao`, `programs.ts`, `ids`,
`limits`:

- `startProgramRun(db, userId, programId, options?)` — requires a live program **with at least
  one live session** (an empty program is unrunnable; refused with a typed error the UI can
  show); points at the first live session's positions; stamps `ended_at` on every visible active
  run in the same `writeLocal` batch (a)).
- `stopProgramRun(db, userId, options?)` — stamps the active run's `ended_at`. No-op without one.
- `readActiveRun(db, userId)` → `{ run, program, tree, nextSession: { week, workout } } | null` —
  newest active run joined to its **live** program (a run whose program was deleted reads as
  null: no run UI, nothing offered; the dangling active row is harmless and is closed by the next
  `startProgramRun` — recorded); resolves (b); a complete-but-unstamped run (author deleted the
  remaining sessions mid-run) reads as `{ …, nextSession: null }` so the tab can say the program
  has no next session rather than offering a dead button.
- `resolveNextSession(tree, positions)` and `sessionAfter(tree, finished)` — pure, exported for
  tests.
- `advanceRunOnFinish(db, userId, programWorkoutId, now)` → rows for the finish transaction (c).

`activeWorkout.ts` (draftPolicy.finish) imports `programRuns.ts` — safe: `programRuns.ts` never
imports the workout modules. The prefill orchestration (e) — which *does* need
`activeWorkoutSession` — lives in its own **`frontend/src/workout/startProgramSession.ts`**, so
the cycle `activeWorkout → programRuns → activeWorkoutSession → activeWorkout` can't form. The
builder must keep this split.

Validation: positions through the existing `assertValidProgramPosition`; timestamps are
ISO-8601 like every row; no new `limits.ts` entries are needed (no new CHECKed user-typed value —
the title truncation reuses the workout-title limit).

### (g) Sync — one more `SyncedTable`, one standalone pull

- `dao.ts`: `ProgramRunRow`, `RowByTable.program_runs`, `TABLE_COLUMNS.program_runs`, and a
  **reordered `SYNC_ORDER`** — settled, not left to the builder. The old order pushed `workouts`
  before the program tables, so an authoring phone that built a program, ran a session and only
  then found signal would push a linked workout before the program workout it names — the
  server's FK refuses it and the queue wedges (the B07 poison-row class, reachable by one honest
  offline phone). New order:
  `exercises, programs, program_weeks, program_workouts, workouts, workout_exercises, sets,
  personal_records, program_exercises, program_runs`.
  Verified against every FK in `RowByTable`: each points at an earlier table
  (`program_exercises → exercises` ✓ and `→ program_workouts` ✓; `workouts →
  program_workouts` ✓; `personal_records → sets/exercises` ✓; `program_runs → programs` ✓).
  `PUSH_PASSES` (`[...SYNC_ORDER, 'workouts']`) keeps its re-touch pass; `DELETE_PASSES` (the
  reverse) still deletes `personal_records` before `sets`, program rows are never hard-deleted,
  and `workouts.program_workout_id` is `on delete set null` — so the delete phase is unaffected.
  `PROGRAM_TABLES` / `ProgramTable` stay as they are (they type the four-table tree logic in
  `programs.ts`; `program_runs` is not a tree table).
- `pull.ts`: `CURSOR_KEYS.program_runs`; a `pullStandalone` pass **after** the four program
  passes (parent-first within the family); `PullResult.program_runs` counter. An orphan run (its
  program uploaded by another phone between this sync's `programs` pass and its `program_runs`
  pass) waits unseen — `readActiveRun` requires the live program — until the next sync delivers
  the parent; transient, the B34-recorded shape.
- `transport.ts` / `supabaseTransport.ts` / `fakeTransport.ts`: `pullProgramRuns(userId, after,
  limit)` — the `pullPersonalRecords` shape (user-filtered, `(updated_at, id)` keyset). A
  separate method, not a widening of `pullProgramRows`'s `ProgramTable` generic.
- Push needs no new code (`SYNC_ORDER` drives it). `writeLocalTree`'s accepted-tables type widens
  to include `program_runs` (c).

### (h) Workout tab and the program picker

`app/(tabs)/workout.tsx` (reads `readActiveRun` in its existing `refresh`):

- **No active run, no workout in progress:** "Start empty workout" (primary) and **"Start from a
  program"** — the B34 placeholder, now enabled: opens the program picker.
- **Active run, no workout in progress:** a small run card — program name, "Next: Week N ·
  <workout label>" — with **"Start next session"** as the primary action
  (`startProgramSession` → `/active-workout`), "Start empty workout" beneath it (an off-program
  day never blocks logging; an empty workout carries no link and advances nothing), and **"Stop
  program"** (ghost, confirm dialog — the `confirmProgramRemoval` pattern). A run with
  `nextSession: null` shows the card with "This program has no next session" and Stop.
- **Workout in progress:** Resume/Discard exactly as today (the run card hides; one thing at a
  time).

**The picker is a modal sheet** (`components/programs/ProgramPickerSheet.tsx`, the
`ToolKitSheet`/picker pattern): the lifter's live programs via `listPrograms` (name + size line),
tap one → `startProgramRun` → sheet closes, tab now shows the run card. Programs with zero
workouts are listed but disabled with a "no workouts yet" hint (matching (f)'s refusal rather
than hiding the program confusingly). Empty state links to Your programs. A separate sheet was
chosen over a "Run" action on `app/programs.tsx` (that list's rows open the editor; overloading
them mixes editing and running) — one new leaf component, no route changes.

Switching programs is Stop → Start from a program (two taps); a dedicated "switch" flow adds
nothing (starting a new run auto-ends the old anyway, (a)).

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<ts>_program_runs.sql` | new — §(a) table, RLS, trigger, indexes; §(c) `workouts.program_workout_id` + index |
| `frontend/src/db/schema.ts` (+ `schema.test.ts`) | V13: `program_runs` table + `workouts` column (bare, no FKs); `SCHEMA_VERSION` 13 |
| `frontend/src/db/dao.ts` | `ProgramRunRow`; `WorkoutRow.program_workout_id`; `RowByTable` / `TABLE_COLUMNS`; the §(g) `SYNC_ORDER` reorder; `WorkoutTreeRows` gains an optional `program_runs` arm (and `writeLocalTree`'s table list with it) |
| `frontend/src/sync/push.ts` | `zeroCounts()` / `PushResult` gain `program_runs` (the counters are hand-listed) |
| `frontend/src/sync/pull.ts` | cursor key, standalone pass after the program tables, `PullResult.program_runs`, `pullStandalone`'s table union widened |
| `frontend/src/sync/transport.ts` / `supabaseTransport.ts` / `test-utils/fakeTransport.ts` | `pullProgramRuns` (the `pullPersonalRecords` shape) |
| `frontend/src/programs/programRuns.ts` (+ `.test.ts`) | new — §(f), the one home for runs |
| `frontend/src/workout/activeWorkout.ts` | start-only `programWorkoutId` option; `draftPolicy.finish` includes `advanceRunOnFinish` rows |
| `frontend/src/workout/startProgramSession.ts` (+ `.test.ts`) | new — §(e) prefill orchestration |
| `frontend/src/components/programs/ProgramPickerSheet.tsx` (+ test) | new — §(h) |
| `frontend/src/app/(tabs)/workout.tsx` (+ its test in `__tests__/`) | §(h): run card, enabled picker button, Stop |
| existing tests touching `WorkoutRow` fixtures / fake transport | add the new column / method (mechanical) |
| sync round-trip suites (`push`/`pull`/engine tests) | `program_runs` rows in the loops |
| `docs/diagrams/database-erd.md` | `program_runs`, the `workouts` column, RLS note |
| `docs/diagrams/app-flow.md` | Start-from-a-program path, the run card, advance-on-finish |
| `docs/DEFERRED.md` | add `program_runs` to the recorded export-data gap; B35 follow-ups |

Data model impact: one server migration (one new table + one nullable column on `workouts`),
device schema V13. No new dependency, no new server function, no realtime.

## How each definition of done becomes observably true

- **Step DoD ("each tap of Workout opens the correct next session with its targets")** — the
  headline Jest flow on real SQLite: seed a 2-week × 2-workout program with full and partial
  targets through `programs.ts`; `startProgramRun`; then four times over: `readActiveRun` names
  the expected session → `startProgramSession` → the snapshot holds the slots' exercises in
  order, each entry note carrying its targets, the title naming program/week/day, the workout row
  carrying `program_workout_id` → `finish()` → the run row points one session further. After the
  fourth finish the run is ended and `readActiveRun` is null. Offline by construction (no
  transport anywhere in the flow); the finish-advance atomicity is pinned with the
  fault-injecting driver (a failed finish leaves the run unmoved).
- **PRG-3** — the same flow is PRG-3's sentence verbatim, plus edit-mid-run tests: delete the
  pointed-at workout → the tab offers the session that now stands there; delete the rest of the
  program → `nextSession: null`; append a week mid-run → it is reached after the existing ones.
- **LOG-1 (completion)** — the Workout-tab screen test: with no run, "Start empty workout" works
  as today (regression) and "Start from a program" opens the picker; with a run, the primary
  action starts the prefilled session and routes to the logger; sync tests prove the run row
  round-trips (push → fresh device pulls → same active run resolves).
- **RLS** — Gate 2 live probe, the B34 two-user recipe over `program_runs` (select/insert/
  update/delete all four verbs as the other user → 0 rows / 42501) plus: user B cannot insert a
  run naming A's program (insert succeeds only under B's own `user_id` — then verify B *can*
  reference A's program id through the FK but reads nothing of it; existence-only, the recorded
  precedent), and a `workouts` update setting `program_workout_id` to a random uuid is refused by
  the FK. CHECK refusals: negative position, `ended_at < started_at`.
- Device verification (Built → Done, Tristen): build a 2-week program on the phone, start it from
  the Workout tab in airplane mode, see "Week 1 · Day 1" prefilled with targets, finish, tab now
  offers Day 2; kill the app mid-session and Resume; reconnect → the run row and linked workouts
  in Supabase; stop a program; finish the last session → run completes.

## Out of scope (this branch)

- **Coach-assigned runs** (B37 — its own RLS/policy change), **Save and Start from the
  Marketplace** (B40 — will call `startProgramRun`), **program visibility** (B39).
- **Jumping to an arbitrary session** (the tab offers exactly the next one — PRG-3's sentence),
  manual run-position editing, pausing/rescheduling, rest-day awareness, multiple concurrent runs.
- **"Week 2 · Day 1" labels in history / feed / analysis** beyond the prefilled title — the
  column now exists for a later reader; no analysis-engine change.
- **A completion flourish** when a run ends (§(d)); **seeding the entry input boxes** with target
  numbers (§(e) records the additive path).
- **`export-data`** still exports neither programs nor runs — the one recorded DEFERRED item
  widens to include `program_runs` (deletion is already complete via the `user_id` cascade).
- **Run history UI** (ended rows accumulate, readable later; nothing renders them yet).

## Risks a reviewer should weigh

1. **Rejecting the server-side one-active-run constraint (a)** trades an invariant for push
   safety: the database can hold several active runs per user and every reader must apply
   newest-wins. The mitigation is structural — `programRuns.ts` is the only reader/writer, and
   `startProgramRun` closes stragglers — but a future hand-written query that assumes "at most
   one" would be wrong. The ERD note must state the invariant lives in the module, not the
   schema.
2. **The advance writes from inside `draftPolicy.finish` (c)** couples the workout module to the
   run module (one-way). The import split in (f) is load-bearing: prefill must stay out of
   `programRuns.ts` or the cycle forms. If the builder hits a cycle anyway, the escape is passing
   `advanceRunOnFinish` into the policy as an injected dependency — not moving the advance out of
   the finish transaction (a kill between "finish" and "advance" would silently stall the run;
   the atomicity is the point).
3. **The `SYNC_ORDER` reorder (g) permutes the push order every table rides.** It is verified
   on paper (every FK backwards; delete phase unaffected) and the alternative — a linked workout
   that can out-run its program to the server and wedge an honest offline phone's queue — is a
   real poison row, not a theoretical one. But the blast radius is every push, so the round-trip
   push/pull suites must pass untouched and a new end-to-end test must pin the full offline
   flow: author a program, start a run, finish a session, then sync once through the fake
   transport — every row lands, in an order the fake's FK emulation accepts.
4. **Prefill is not atomic (e).** A kill mid-prefill leaves a partial draft; Resume shows it.
   Accepted over inventing a bulk write path the handoff explicitly steered away from.
5. **Mid-run edits resolve by position-slide (b).** A lifter who deletes Week 1 Day 2 *after
   finishing Day 1* is pointed at what now occupies Day 2's place — usually what they want, but
   "usually" is a product judgement; the alternatives (dangling id, or freezing the run) are
   strictly worse. The edit-mid-run tests pin the chosen behaviour so it is at least deliberate.

## Grilling record (settled decisions)

Conducted by the planner session itself (autonomous pipeline; both sides at full severity per
CLAUDE.md "Autonomous sessions"). What was attacked, and what it changed:

- **"Does `program_runs` need to be a synced table at all? The scope says 'synced and cached in
  SQLite' — but a run is one phone's state, like the active workout."** The scope sentence names
  sync, and it's right: a lifter who reinstalls or adds a phone must not lose their place in an
  8-week program (the active *workout* is hours-lived; a run is weeks-lived). Device-only was
  rejected on the scope's own text.
- **"Why not one run row per user (PK `user_id`, the `user_settings` shape)? No newest-wins
  ambiguity, trivially one-active."** It would need its own bespoke sync path (`user_settings`'s
  update-only push doesn't fit a row the device must create), erases run history B37/B40 can use,
  and still converges by LWW across phones — the same ambiguity in different clothes. The
  generic-machinery row with `ended_at` costs nothing extra and rides sync unchanged.
- **"The partial unique index is the textbook answer to one-active — you're rejecting a
  constraint the handoff suggested."** Weighed and rejected deliberately (§(a)): the constraint
  can be violated by two honest offline phones, and the generic push has no 23505 handling — it
  would wedge a device forever to enforce a rule whose violation is harmless and self-healing.
  Server constraints that honest clients can trip are poison-row factories (the B07 lesson).
- **"Position pair vs workout id — you picked the one the handoff listed second. Sure?"** Yes:
  the id dangles unrecoverably on the one edit B34's UI makes easy (remove a workout/week), while
  positions are stable by B34's own no-reorder decision and degrade to "the session now standing
  there". An id plus fallback positions is both mechanisms and the worst of each. Settled.
- **"Advance-inside-finish couples the logger to programs. Why not advance on the next tap
  instead — derive the position from the last finished linked workout?"** Deriving on read
  ("position = session after the newest finished workout with a link into this program") was
  seriously considered: it removes the stored position *and* the finish coupling. Rejected
  because it makes the run's position a query over the whole workout history whose meaning
  changes when linked workouts are deleted (B14) — deleting last week's session would *rewind*
  the run — and because "advancing is one-way on finish" is the behaviour PRG-3 describes. The
  stored pointer advanced atomically at finish is dumber and survives deletion correctly.
- **"Entry-note targets are a hack — the note field belongs to the lifter."** The note *is* the
  lifter's, and prefill writes it once at session start as the session's prescription — exactly
  what a coach scribbles on a program card. It renders today, syncs today, survives kills today,
  and the lifter can edit it. Every alternative (new entry columns, ephemeral UI state, pre-logged
  sets) costs a migration, dies on kill, or fabricates training data. The one real cost — a
  lifter's own note and the target share one field — is accepted and recorded; targets-in-boxes
  is the additive follow-up if device use demands it.
- **"Pre-logged target sets are how every program app works. You're sure skipping them?"** The
  apps that prefill planned sets have a per-set done/undone state; Astra's sets are performed
  facts (analysis, PRs, feed all read them as such), and the logger deliberately has no inline
  set editor yet. Pre-logging would make Finish-without-editing fabricate volume and possibly
  PRs. Re-examined and kept: no pre-created set rows, of either flavor.
- **"Does the empty workout still work during a run? LOG-1 says blank *and* program."** Yes —
  §(h) keeps "Start empty workout" visible under the run card; an unlinked workout advances
  nothing. Pinned in the tab's test.
- **"What if the author edits the program between tap and finish?"** The draft's entries are
  already copied rows — editing the program never mutates a started session. Advance reads the
  tree at finish time and slides accordingly ((c)); worst case the run ends or lands on a moved
  session, visible next tap. No action needed beyond the pinned tests.
- **"`SYNC_ORDER` reorder (risk 3) is the riskiest diff in the step — it touches every push."**
  It permutes only parent-before-child-safe segments (verified against every FK in
  `RowByTable`), the push tests' round-trip suites cover all nine tables, and the offline
  author-then-run flow gets a dedicated end-to-end test. The alternative — a workout that can
  out-run its program to the server — is a real wedge, not a theoretical one.
- **"The plan told the builder to 'verify' the `SYNC_ORDER` concern — a plan of record doesn't
  delegate its riskiest call."** Conceded and fixed: the facts were checked during planning
  (push's use of `PUSH_PASSES`, the second `workouts` re-touch pass, `DELETE_PASSES`'s reversal,
  every FK in `RowByTable`, the `set null` on the new column) and the reorder is now the settled
  §(g) decision; risk 3 keeps only the residual (blast radius → pinned by suites plus one new
  end-to-end offline test).
- **"The run table's own `ended_at >= started_at` CHECK is the same wedge class you rejected
  the unique index over."** True across devices with skewed clocks — so the clamp the plan had
  only at completion now applies at every `ended_at` stamp site (§(a)). The CHECK stays: with
  the clamp it is unreachable by honest clients, and it keeps garbage out.
- **"Does every plain finish now pay run reads?"** No — made explicit in §(c): the module is
  consulted only for a non-null `program_workout_id`; today's finishes are untouched.
- **"The prefilled title's week number renumbers if an earlier week is deleted mid-run."**
  Accepted knowingly (§(e)): titles are prose, they match what the program page showed when the
  session started, and old titles never rewrite.
- **"New route for the picker?"** No — a modal sheet component; zero routes, no
  `router.d.ts` churn beyond what exists.
- **"Anything speculative?"** Checked against the rule: no run history UI, no completion screen,
  no per-set targets, no realtime, no new deps. The one forward-looking cost is the
  `workouts.program_workout_id` column, which this step itself reads (advance) and writes — not
  speculative.
- **Scope check:** the step's scope sentence is implemented exactly — `program_runs` synced and
  cached; Workout button starts the next session prefilled with targets; advances week by week;
  offline. The only additions are what running requires at all: a way to start a run (the
  enabled placeholder button + picker), stop it, and the end-of-program rule the handoff asked
  this plan to decide.

## Build notes and deviations (builder run)

_Recorded by the builder; each deliberate departure from the plan above, and why._

- **Migration version.** Written as `…_program_runs.sql`, applied live through the MCP as
  `program_runs`; Supabase recorded version `20261115203159`, and the file carries that prefix.
  Live probe (rolled back; only one real profile exists, so "user B" was a synthetic uuid): B
  reads / updates / deletes 0 of A's runs; a run forged under A's id is refused (42501); a
  negative position and `ended_at < started_at` are refused by CHECKs (23514); a workout naming a
  random `program_workout_id` is refused by the FK (23503); one naming a real program workout is
  accepted. The plan's "B inserts a run under B's own id naming A's program" probe could not be run
  (B has no profile row, so the `user_id` FK refuses first) — the existence-only reading stands on
  the FK definition.
- **`advanceRunOnFinish` takes the session's `started_at`** (review finding, deliberate deviation
  from the §(c) signature). A session started under an earlier run of the same program — the
  lifter stopped and restarted it meanwhile, e.g. on another phone, while the draft waited —
  matched the program check and would have pushed the fresh run past Week 1 on finish, breaking
  "restarting always begins at the first live session". The advance now moves nothing when the
  finished session started before the run did. Pinned in both test files.
- **`stopProgramRun` ends every active run, not just the newest** (§(f) says "the active run's").
  With only the newest ended, an older straggler left by two offline phones would surface as "the"
  run after Stop. Ending all is what (a)'s "the next start ends both" already does for start.
- **`readActiveRun` returns `{ run, tree, nextSession }`** — the program is `tree.program`, not a
  separate field; `nextSession` is a `{ week, workout }` node pair or null, as planned.
- **`startProgramSession(db, userId, unit, options)`** — the lifter's display unit is a parameter
  (the §(e) target note shows weight in it; the module can't read a React hook).
- **`startActiveWorkout` refuses a `programWorkoutId` not on the phone** (not in the plan): the
  server FK would refuse such a workout at upload and wedge the queue — the same guard
  `addExercise` has for exercises. Tested.
- **One copy of the logger's exercise rule.** The prefill's skip check calls a new exported
  `canLogExercise` in `activeWorkout.ts`, which `addExercise` now uses too (review finding: the
  first draft copied the SQL).
- **The fake server checks nullable FKs** (`OPTIONAL_REF`: `workouts.program_workout_id →
  program_workouts`) and `program_runs → programs`, so the end-to-end offline test genuinely
  fails if the push order ever lets a linked workout out-run its program workout.
- **Tab detail:** with a run that has no next session, "Start empty workout" becomes the primary
  button (nothing else to tap). The picker reports the new run to the tab, which re-reads.
- **Not done, recorded in DEFERRED:** tied positions from two offline appends are ambiguous (first
  in `(position, id)` wins); the paged-table union is spelled in three files.
