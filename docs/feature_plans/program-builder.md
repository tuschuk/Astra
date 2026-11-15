# program-builder (B34)

Covers **PRG-1** (build a custom program from library exercises with sets, reps and target load —
whole: "a complete program can be authored from any library (or custom) exercises") and **PRG-2**
(programs organized as workouts within weeks — whole: "the builder enforces the week → workout →
exercise structure and renders it on the program page"). Depends on B29 (and, in practice, on the
B07 sync engine and the B31 picker it builds on).

Step scope: `programs`, `program_weeks`, `program_workouts`, `program_exercises` tables with
author-only RLS; builder UI enforcing week → workout → exercise with sets, reps and target load
from library or custom exercises.
Step DoD: **a complete program authors and reopens intact.**

First Phase 2 step and the first new synced entity family since B07. Nothing program-shaped
exists anywhere: no tables, no device schema, no screens (the Workout tab's "Start from a
program" button is a disabled placeholder for B35).

## What exists (verified before planning)

- **Server:** the workout tree (`…_training.sql`) is the pattern: client-generated uuid PKs (no
  default on children of the offline path), `moddatetime` triggers, RLS through `private.*`
  SECURITY DEFINER helpers (`owns_workout`, `can_view_workout`) so the ownership rule lives once.
  `exercises` carries library rows (`owner_id` null, id = uuidv5 of slug) and customs
  (`owner_id = user`, soft-deleted via `deleted_at`, B31). `sync_tombstones` covers only
  `workouts` and `personal_records`.
- **Device:** `db/schema.ts` is at version 11. `db/dao.ts` is table-generic: `RowByTable` /
  `SyncedTable`, `SYNC_ORDER`, `TABLE_COLUMNS` drive `writeLocal` (upsert + outbox + notify) and
  the whole transport; adding a table there makes push and pull carry it. `sync/push.ts` iterates
  `SYNC_ORDER`; `sync/pull.ts` has two shapes: the workouts **tree pull** (one cursor + the
  touch-the-root rule + `reconcileTrees` for in-tree deletions) and `pullStandalone` (per-table
  `(updated_at, id)` cursor, RLS-scoped, used by `exercises`, `personal_records`,
  `workout_analyses`).
- **UI:** `ExercisePicker` (B31) already returns `{ deviceId, name }` for library *and* custom
  rows and takes the live customs from `useCustomExercises`. `limits.ts` in `@training-math` is
  the one home of hand-mirrored server CHECKs. `useDisplayUnit` + the units module handle kg⇄lb
  display. The B31 module pattern (`library/customExercises.ts`: one home for reads/writes so the
  `deleted_at` filter can't be forgotten) is the established shape for a new entity family.

## Settled decisions (the handoff hands B34 five; each is recorded here)

### (a) Server schema — four tables, no visibility column yet

New migration `backend/supabase/migrations/<ts>_programs.sql` (builder applies via MCP and
renames to the version Supabase records — the B11 discipline):

```sql
create table public.programs (
  id         uuid primary key,                 -- client-generated, like workouts.id
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  deleted_at timestamptz,                      -- soft delete; see (b)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index programs_user_idx on public.programs (user_id, updated_at);

create table public.program_weeks (
  id         uuid primary key,
  program_id uuid not null references public.programs (id) on delete cascade,
  position   smallint not null check (position >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index program_weeks_program_idx on public.program_weeks (program_id);

create table public.program_workouts (
  id              uuid primary key,
  program_week_id uuid not null references public.program_weeks (id) on delete cascade,
  name            text check (char_length(name) <= 100),   -- null → shown as "Workout N"
  position        smallint not null check (position >= 0),
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index program_workouts_week_idx on public.program_workouts (program_week_id);

create table public.program_exercises (
  id                 uuid primary key,
  program_workout_id uuid not null references public.program_workouts (id) on delete cascade,
  -- Nullable + set null, the workout_exercises precedent: if an exercise row is ever hard-
  -- deleted (account deletion, a founder content migration), the program slot survives.
  exercise_id        uuid references public.exercises (id) on delete set null,
  position           smallint not null check (position >= 0),
  target_sets        smallint not null check (target_sets >= 1),
  target_reps        integer check (target_reps >= 0),
  target_weight_kg   numeric(6, 2) check (target_weight_kg >= 0),
  target_rpe         numeric(3, 1) check (target_rpe between 1 and 10),
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index program_exercises_workout_idx on public.program_exercises (program_workout_id);
create index program_exercises_exercise_idx on public.program_exercises (exercise_id);
```

All four get `moddatetime` triggers and RLS with **author-only** policies for all four verbs.
The ownership rule lives once, in SECURITY DEFINER helpers chained like the workout tree's:

```sql
private.owns_program(pid)         -- programs.user_id = auth.uid()
private.week_program(week_id)     -- program_weeks → program_id
private.workout_week(pwid)        -- program_workouts → program_week_id
```

Children's policies compose them (`owns_program(week_program(program_week_id))`, etc.), so B39
widens **one** select rule per table, not four scattered ones.

**No `visibility` column now.** B39 (program visibility) is its own migration and must rewrite
the select policies anyway; a column with one value and no reader today is dead schema ("add
nothing speculative"). Author-only RLS *is* private-only, which is what the scope says to ship.
Recorded so B39 knows the column is deliberately absent.

Column decisions, mirroring the handoff's directions: `target_weight_kg` is **kg**
(`numeric(6,2)`, the `sets.weight_kg` twin, displayed through `useDisplayUnit`); `target_reps`,
`target_weight_kg` and `target_rpe` are **nullable** (a bodyweight movement has no load; RPE is
optional everywhere else in the app); `target_sets` is **required** (≥ 1 — a prescription without
a set count is unrenderable and unprefillable); `position` columns order siblings and are not
unique-constrained (the workout_exercises reason: offline reorder syncs row by row). Weeks have
no name — they render as "Week N" from position; a label ("Deload") has no PRD backing yet.
Programs have no description — B40's Marketplace page can add it by migration when something
reads it.

### (b) Sync — the four tables are `SyncedTable`s; deletes are soft deletes; pulls are standalone

Programs must author offline (the step is a logging-adjacent authoring surface; offline-first is
a hard rule), so all four tables join the generic machinery: `RowByTable`, `TABLE_COLUMNS`,
`SYNC_ORDER` (appended after `personal_records` — the only cross-family FK is
`program_exercises.exercise_id`, and `exercises` is already first), device schema **V12** with
the same columns; local FKs `on delete cascade` down the chain only — `exercise_id` is a **bare
nullable column on the device**, exactly like `workout_exercises.exercise_id` (a local FK could
fault a pull page on an overlap edge; the server's `set null` FK is the enforcement point).
`writeLocal` then queues every edit; push carries them with no new code.

**Pull: four `pullStandalone` passes, not a tree pull.** This is the big simplification over the
workouts family, and it is safe for a reason worth stating: the workouts tree pull plus
touch-the-root exists because workout children are visible to *other* users through their parent
workout's visibility, so children can't be pulled bare (an unfiltered pull would drag in other
people's rows) — one bookmark on the root plus whole-tree re-download was the answer. Program
tables are **author-only readable**, so an unfiltered RLS-scoped pull of each table returns
exactly the user's own rows — `pullExercises` already works this way. Each table gets its own
`(updated_at, id)` cursor (`CURSOR_KEYS` + transport methods), pulled parents-first
(`programs → program_weeks → program_workouts → program_exercises`), placed in `pullChanges`
**after the `workout_analyses` pass and before the tombstone pass** — so a child never lands
before its parent within a sync, and a custom exercise referenced by a pulled program row is
always already on the device (`exercises` pulls first of all). No touch-the-root analogue, no
`reconcileTrees` analogue, no second re-push pass for programs.

**Deletes are soft deletes** (`deleted_at` on every one of the four tables), the B31 decision
re-made for the same reasons, now with one more: standalone pulls cannot see an absent row, so a
hard delete would need either the `sync_tombstones` CHECK widened plus a new trigger function
(the existing one reads `old.user_id`, which three of these tables don't have — real server
machinery) or a tree-reconcile pass (the machinery the standalone choice just avoided). A soft
delete is an UPDATE: it rides the existing upsert push, the existing standalone pull, the
existing conflict rules, and reaches other devices for free. The weighed alternative (outbox
`delete` op + tombstone widening) is recorded as rejected: four tables' worth of trigger and
client machinery for a row class that is tiny, user-private and launch-scale rare.

**Removing a node stamps only that node.** A node is live iff its own `deleted_at` is null *and*
it is reached through live ancestors; every read traverses from the program down, filtering each
level, so stamping a removed week (not its workouts) is enough — nothing renders orphans, and
rows stay cheap. The remaining positions are **not** renumbered (order is `position asc`,
gaps are harmless, and renumbering would upsert every sibling on each removal).

Costs, named honestly: dead rows accumulate until account deletion (a program is a few hundred
bytes); every reader must filter `deleted_at`, which is why **all reads live in one module** (§
module); there is no undelete UI.

### (c) Exercise references — device ids straight from the B31 picker

`program_exercises.exercise_id` holds the device id the `ExercisePicker` already reports:
uuidv5(slug) for library rows (identical on the server by construction), the row's uuid for
customs. Customs push before program rows (`exercises` is first in `SYNC_ORDER`), so the server
FK can't be hit by ordering. A **soft-deleted custom** in an existing program keeps resolving its
name (B31's reason soft delete was chosen: readers don't filter deleted rows when *naming*
things); the picker already never offers deleted customs. A null `exercise_id` (hard-deleted
exercise — account deletion or founder retirement) renders as "Deleted exercise", the saved-
workout precedent.

### (d) Builder UI — a Programs entry on the Workout tab; three new routes

The program's authoring surface *is* its page at this step (author-only visibility — there is
nobody else to render it for). Structure is enforced **by construction**: exercises can only be
added inside a program workout, workouts only inside a week, weeks only inside a program —
there is no UI path that violates week → workout → exercise, which is PRG-2's builder half; the
program screen rendering the hierarchy is its render half.

- **`app/(tabs)/workout.tsx`** — a third action button, **"Your programs"** (always enabled),
  under "Start from a program" (which stays disabled until B35). One line plus a route push.
- **`app/programs.tsx`** — the lifter's live programs (name + a "N weeks · M workouts" line),
  newest first; **New program** opens a small name form (the `CustomExerciseForm` modal pattern:
  name field validated against the shared limit, Save disabled until valid), creates the program
  and pushes straight into its editor. Empty state explains what a program is. `useFocusEffect`
  refresh (the repo's pattern).
- **`app/program/[id].tsx`** — the program page/editor: editable name (autosaved, the B12
  pattern), weeks as sections ("Week 1…N") each listing its workouts (name or "Workout N", plus
  an exercise count); **Add week**, per-week **Add workout** and **Remove week** (confirm), per-
  workout **Remove** (confirm); tapping a workout opens its editor; **Delete program** (confirm,
  then back to the list). Unknown/foreign/deleted id → the standard not-found state.
- **`app/program-workout/[id].tsx`** — one workout's exercises: each row shows the exercise
  name and its targets ("3 × 8 @ 135 lb · RPE 8", weight through `useDisplayUnit`); **Add
  exercise** opens the B31 `ExercisePicker` (library + customs — PRG-1's "any library (or
  custom) exercises"); per row: edit targets in place (sets / reps / weight-in-display-unit /
  RPE boxes, numeric keyboards, the logger's input conventions), move up / move down (the B11
  entry-card precedent), remove. Weight input converts display unit → kg through the existing
  units module (`roundWeightKgForStorage`) — **no new conversion code**.

Three new routes registered in `app/_layout.tsx` under the signed-in guard. **Builder note:**
new routes mean the gitignored `.expo/types/router.d.ts` is stale — the recorded check order is
`npx expo start --offline` (~150 s) → `tsc --noEmit` → lint → Jest.

### (e) Gate 2 probe — two simulated users, rolled back

The B31 precedent, run over all four tables in one rolled-back SQL transaction with
`request.jwt.claims`: as user A, insert a full program tree (program → week → workout → exercise
referencing a library id); as user B, per table: select by id → 0 rows, unfiltered select → only
B's rows, update → 0 rows, delete → 0 rows; A still reads the tree intact. Also: a
`target_rpe` of 11 and an empty name are refused by the CHECKs.

## One home for program logic — `frontend/src/programs/programs.ts`

Every read and write of the four tables, so the `deleted_at` filter and validation can never be
forgotten at a call site (the `customExercises.ts` shape):

- `createProgram(db, userId, name)` → mints `newUuid()`, validates, `writeLocal`.
- `renameProgram`, `deleteProgram` (stamp), `listPrograms(db, userId)` (live, with week/workout
  counts), `getProgram`.
- `addWeek(db, userId, programId)` (position = max live + 1), `removeWeek` (stamp).
- `addProgramWorkout(db, userId, weekId, name?)`, `renameProgramWorkout`, `removeProgramWorkout`.
- `addProgramExercise(db, userId, workoutId, { exerciseId, targets })`,
  `updateProgramExercise` (targets), `moveProgramExercise` (swap positions with a sibling),
  `removeProgramExercise`.
- `readProgramTree(db, userId, programId)` → the whole live tree, each level ordered by
  `position asc, id asc` (deterministic across devices even when offline inserts tie on
  position), exercise names resolved from the device `exercises` table filtered by
  `owner_id is null or owner_id = ?` — the `exerciseInfo` pattern, the B07 "every UI query
  filters by the signed-in user" rule (deleted customs still name themselves; a null or
  unresolvable `exercise_id` yields the "Deleted exercise" marker) — the one read the two
  editor screens and B35's prefill will share.

Every write checks ownership (`user_id` on the program; children resolved to their program
first — a write against another user's or a deleted node is refused), validates through
`@training-math` `limits.ts`, and goes through `writeLocal` — offline by construction, synced by
the existing engine. Mutations after a `deleted_at` stamp are refused, so an edit can't
resurrect a deleted node (writeLocal is an upsert; the B31 lesson, pinned in a test).

New limits in `limits.ts` (hand-mirrored from the migration, same-commit rule, counted the
server's way): `MAX_PROGRAM_NAME_LENGTH = 100` + `assertValidProgramName` (1–100, trimmed),
`MAX_PROGRAM_WORKOUT_NAME_LENGTH = 100` + `assertValidProgramWorkoutName` (null fine),
`assertValidProgramTargets` (sets whole 1…32767; reps whole 0…2147483647 or null; weight ≥ 0 and
< 10000 after `roundWeightKgForStorage`, or null; RPE 1–10 after `roundRpeForStorage`, or null;
position whole 0…32767) — the poison-row discipline: the device repeats no CHECK in SQL, so the
one write path validates first.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<ts>_programs.sql` | new — §(a): four tables, helpers, RLS, triggers, indexes |
| `frontend/src/db/schema.ts` | V12: the four device tables + indexes; schema test |
| `frontend/src/db/dao.ts` | four row types; `RowByTable`, `SYNC_ORDER`, `TABLE_COLUMNS` |
| `frontend/src/sync/pull.ts` | four cursor keys + standalone passes (widen `pullStandalone`'s union); `PullResult` counters |
| `frontend/src/sync/transport.ts` / `supabaseTransport.ts` / `test-utils/fakeTransport.ts` | four RLS-scoped pull methods (the `pullExercises` shape) |
| `backend/supabase/functions/_shared/training-math/limits.ts` (+ test) | program limits — §module |
| `frontend/src/programs/programs.ts` (+ `.test.ts`) | new — the one home |
| `frontend/src/programs/usePrograms.ts` (or inline focus-effect reads) | focus-refreshed reads for the three screens |
| `frontend/src/app/(tabs)/workout.tsx` | "Your programs" button |
| `frontend/src/app/programs.tsx`, `app/program/[id].tsx`, `app/program-workout/[id].tsx` | new — §(d) |
| `frontend/src/components/programs/*` | form/card pieces as the builder carves them (name form reuses the B31 modal pattern) |
| `frontend/src/app/_layout.tsx` | register the three routes |
| `frontend/src/__tests__/programs-*.test.tsx` | route-file tests live in `__tests__` |
| sync tests (`push`/`pull`/engine) | program rows in the round-trip suites |
| `docs/diagrams/database-erd.md` | four tables, keys, RLS note |
| `docs/diagrams/app-flow.md` | the Programs branch and its outbox/pull data path |
| `docs/DEFERRED.md` | export-data gap + B34 follow-ups (see Out of scope) |

Data model impact: four server tables (one migration), device V12. No new dependency. No server
function changes (but see the export-data note below).

## How each definition of done becomes observably true

- **Step DoD ("a complete program authors and reopens intact")** — module test on real SQLite:
  author a program (2 weeks × 2 workouts × exercises with full and partial targets, one library
  + one custom exercise) through the module, re-open the database handle, `readProgramTree` →
  deep-equal. Sync test (fake transport): the same tree authored with the transport throwing
  lands on the fake server exactly once after it heals; a second device (fresh db, same fake)
  pulls and `readProgramTree` matches. Screen test: the editor renders what was authored after
  remount.
- **PRG-1** — the workout-editor screen test adds a library exercise and a custom through the
  picker, sets sets/reps/load, and both render with their names and targets; the module test
  pins targets' kg storage and optional fields.
- **PRG-2** — structure is enforced by construction (no API or UI path adds an exercise outside
  a workout or a workout outside a week — the module's signatures take the parent id, pinned by
  type and by ownership checks); the program screen test renders week sections containing
  workout rows (the "renders it on the program page" half).
- **Author-only RLS** — the Gate 2 probe in §(e); structurally, every module write can only
  carry the signed-in `user_id`.
- Device verification (Built → Done, Tristen): author a program in airplane mode, kill the app,
  reopen — intact; reconnect — rows in Supabase; the editor at phone width (week sections,
  target boxes, picker).

## Out of scope (this branch)

- **Running a program** (B35): `program_runs`, logger prefill, the Workout button's "Start from
  a program" (its disabled button is untouched). `readProgramTree` is deliberately the read B35
  will prefill from.
- **Visibility beyond the author** (B39): no `visibility` column (recorded in §(a)); Teams
  (B36/B37), Marketplace (B40/B41), program votes/comments.
- **Program description, week labels, copy/duplicate week, drag-to-reorder** (buttons move one
  step), undelete, renumbering — product calls for later; recorded above.
- **`export-data` does not yet export programs.** B32's function predates these tables; its DoD
  named workouts/sets/PRs. Widening it is a deliberate deferral (one redeploy, batched with the
  `_shared/http.ts` extraction already in DEFERRED) — recorded in `docs/DEFERRED.md` by this
  step. Account deletion is already complete: `programs.user_id` cascades from `profiles`.
- **Tombstones / hard delete for programs** — rejected in §(b).

## Risks a reviewer should weigh

1. **The standalone-pull choice rests on author-only RLS.** If B39 ever makes program children
   readable through a *visible* program (the workout-tree situation), bare unfiltered pulls of
   children would start dragging other authors' rows into the device mirror. B39 must either
   keep children's select author-only (readers of a shared program read through the API, not the
   sync mirror — the feed precedent: other people's data is read online, never mirrored) or
   revisit the pull shape. Recorded here and in the migration comments so B39 can't miss it.
2. **Soft-delete filtering is a scattered invariant by nature** — four tables' worth now.
   Mitigation is structural: no screen queries the tables directly; `programs/programs.ts` is
   the single read/write home (the B31 mitigation, which held).
3. **Interleaved-edit convergence.** Two devices editing one program offline converge by
   row-level LWW (the B07/B14 class): a week removed on one device while the other adds a
   workout into it yields a workout inside a deleted week — stamped-node-only deletion means the
   add is preserved but invisible unless the week is ever un-deleted. Accepted (one phone per
   lifter is launch reality; nothing dangles, nothing wedges, `readProgramTree` renders a
   consistent tree either way).
4. **Three new routes + a new synced family is a wide builder diff** (schema V12, dao, pull,
   transport, fakes, module, four screens, tests). The slices are each small and pattern-copied;
   the recorded check order (`expo start` → tsc → lint → Jest) and the type-driven ripple
   (`RowByTable` drives transport and fakes) keep it mechanical. The UI can degrade to plainer
   list rows without touching the data layer if time is tight — the DoD is authoring + reopening
   intact, not polish.

## Grilling record (settled decisions)

Conducted by the planner session itself (autonomous pipeline; both sides at full severity per
CLAUDE.md "Autonomous sessions"). What was attacked, and what it changed:

- **"Why four synced tables and not one `programs` row holding a JSON document?"** A JSON blob
  would make the whole feature one row — trivial sync, no tree machinery. Rejected on the step's
  own text (the scope *names* the four tables), on B35/B37/B39/B40 (runs point at a position
  *inside* a program; coaches assign; RLS and Marketplace search want rows, not blob parsing),
  and on the Rules (the relational shape is the PRD's data-model sketch). Not relitigatable
  without changing the Build order.
- **"Is `pullStandalone` for children actually safe, or a latent B20-class leak?"** Pinned down:
  it is safe **iff** children stay author-only readable. That's true at B34 (and is the step's
  scope); the hazard lands exactly at B39 and is recorded as risk 1 in both the plan and the
  migration's comments. The alternative (tree pull + touch-the-root + reconcile for programs)
  was costed: a second copy of the subtlest machinery in the repo, bought against no current
  need — rejected under "add nothing speculative", with the escape hatch named.
- **"Soft delete again — or is this cargo-culting B31?"** Re-derived, not copied: the B31 wedge
  arguments apply (a queued child upsert behind a parent hard-delete FK-faults and wedges the
  push), plus the new standalone-pull argument (no tombstone channel exists for three of the
  four tables and building one means a new trigger function keyed off a column they don't
  have). The one honest counterpoint — dead rows — is bounded and recorded.
- **"`target_sets` required but reps/load/RPE optional — why the asymmetry?"** A slot must say
  how many sets to render and prefill ("3 × ?" is a real prescription; "? × 8" is not); load is
  legitimately absent for bodyweight work and RPE is optional everywhere in Astra. The handoff's
  direction ("optional targets (reps / load / RPE nullable)") settles it.
- **"Why no `visibility` column when B39 is known to come?"** Adding it now would ship a column
  with one value, no reader, and a CHECK that B39 rewrites anyway; the RLS rewrite is B39's
  diff either way. "The planner records which" — recorded: not now.
- **"Stamp-only-the-node deletion leaves invisible descendants — is that a bug farm?"** The
  invariant ("live = own stamp null ∧ reached through live ancestors") is enforced by the only
  read path there is (`readProgramTree` and the list), and stamping subtrees would turn one
  removal into N upserts for no observable difference. Risk 3 names the one multi-device oddity.
- **"Positions: swap-with-sibling moves, no renumbering — won't gaps and ties accumulate?"**
  Order is `(position asc, id asc)`; gaps are invisible; a tie (two offline inserts at the same
  tail position) renders in the same stable order on every device and is harmless — the same
  stance the workout tree takes. Dense renumbering on every removal is N upserts of churn for
  aesthetics.
- **"A user can insert a `program_exercises` row naming someone ELSE's custom exercise id"**
  (the FK checks existence, not visibility). True — and exactly as true of
  `workout_exercises.exercise_id` since B02. It leaks nothing (the exercise row stays
  unreadable; the tree renders "Deleted exercise") and requires guessing a uuid. A `with check`
  visibility clause was considered and rejected: it duplicates the exercises select rule inside
  a second policy and is a constraint B40's save-a-program flow would have to relax. Precedent
  kept.
- **"Autosaved rename writes an outbox line per settle — chatty sync?"** No: the outbox stores
  references, not payloads (B07), so any number of renames coalesce into one upsert at the next
  push.
- **"Does the Workout tab need a whole Programs section?"** No — one always-enabled button fits
  the existing actions column; the list screen is the section. The tile/section idea from the
  handoff was considered and trimmed.
- **"Is `program-workout/[id]` a route too many? The editor could expand in place."** An
  accordion editing targets inside the program page puts three levels of editable list in one
  FlatList — the B29 header-crowding lesson at phone width. Two screens, each one level deep,
  is the cheaper UI and matches `exercise/[id]` conventions.
- **"Export gap: is deferring programs-in-export hiding a privacy/NFR-6 regression?"** Named in
  the plan rather than silently shipped; deletion (the rights-critical half) is complete via
  cascade; export completeness is one function redeploy already queued with a recorded
  companion. DEFERRED gets the item so Gate 2 can see it was deliberate.
- **"New dependency?"** None. **New server function?** None. **Realtime?** None — programs are
  single-author documents; sync triggers already cover reconnect/foreground/write.
- **Scope check:** the step's scope line is implemented exactly (four tables, author-only RLS,
  builder UI enforcing the hierarchy with sets/reps/target load from library or custom
  exercises); the only additions are what the hierarchy needs to be editable at all (names,
  positions, removal) and the recorded RPE option the handoff itself names. Nothing from B35+
  is reachable from this branch's UI.

## Build notes and deviations (builder run)

Recorded by the builder; each deliberate departure from the plan above, and why.

- **Migration applied live** as `20261115193156_programs.sql` (the version Supabase recorded),
  exactly the §(a) schema. Gate 2 probe run by the builder (rolled back): as user A a full tree
  (program → week → workout → slot on a library id) inserts; as user B every table reads 0 rows by
  id and unfiltered, updates and deletes 0 rows; B inserting a week or slot into A's program, or a
  program under A's id, is refused (42501); A still reads the tree intact; RPE 11, 0 sets and an
  empty name are refused (23514). `get_advisors` (security): no new findings.
- **No local foreign keys on the device program tables** (was: "local FKs on delete cascade down
  the chain"). Code review found the plan's claim "a child never lands before its parent within a
  sync" is false across separate per-table bookmarks: another phone can upload a new program and
  its week between this phone's programs pass and weeks pass. With a local FK that week's page is
  refused and the whole pull throws (skipping tombstones / settings / flairs that sync). Bare
  columns (the `personal_records` precedent) make the early child wait unseen — every read walks
  down from the program — until the next sync brings the parent. Nothing on the phone hard-deletes
  program rows, so the cascade bought nothing. Pinned by a test.
- **One transport method, `pullProgramRows(tbl, userId, after, limit)`**, instead of four
  (same behaviour: `programs` filtered by `user_id`, the children RLS-scoped; the fake emulates
  author-only reads by walking the parent chain).
- **`moveProgramExercise` renumbers the workout's live slots 0…n−1 and writes only the slots whose
  number changed** (was: swap positions with a sibling). A plain swap is a no-op on a tie — the
  very offline-insert tie the plan accepts — so the button would silently do nothing. In the
  common case it still writes exactly the two swapped slots.
- **`addProgramExercise` refuses an exercise id that isn't, on this phone, a library row or one of
  the lifter's live customs.** The grilling kept the server's existence-only FK precedent (no
  visibility CHECK) — unchanged. This is a phone-side poison-row guard: an id the server doesn't
  hold would fail its FK and wedge the upload queue. The picker only ever offers such ids.
- **Targets are edited with an explicit Save targets button** per slot (not autosave), and a newly
  added exercise starts at 3 sets (the required column needs a value).
- **An untouched weight box saves the stored kg unchanged** (review finding): the box shows the
  display-rounded number (100 kg → 220.5 lb), and writing that back would move a weight the lifter
  didn't touch (→ 100.02 kg).
- **`Button` gained an optional `accessibilityLabel`** so per-row buttons ("Remove Week 2") are
  distinguishable to screen readers and tests.
- **Code review:** run with this plan as spec (two axes). Fixed: the weight round-trip bug, the
  pull FK fault, DEFERRED / plan deviations not yet written, missing tests beside the new
  components (`ProgramExerciseCard.test.tsx`, `NewProgramForm.test.tsx`), an unused `maxLength`
  prop, the four soft-remove bodies (one `softRemove`), a duplicated row-type map. Left as
  judgement calls: error-message prefix matching (the existing `setErrorMessage` precedent), the
  two editor routes' similar load / refresh scaffolding, the three-level helper chain in the
  policies (the plan's composed-helpers design), hand-listed per-table counters.
