# active-workout-store — B08: The in-progress workout domain store (NFR-3; LOG-1, LOG-2, NFR-2 part)

**Branch:** `active-workout-store` (from `main`)
**Build step:** B08 — covers NFR-3 (whole: the active-workout store and its simulated-kill test;
the atomic-write substrate was B07), LOG-1 (partial: the "start a blank workout" domain operation;
the Workout button and program prefill are B09/B35), LOG-2 (partial: the add-exercise and log-set
domain operations; the screen is B09), NFR-2 (partial: the repeat-last-set operation; the one-tap
UI is B09).
**Depends on:** B06 (`@training-math`: unit conversion, rounding, validation home), B07
(`frontend/src/db/` DAO + driver, `frontend/src/sync/` outbox/push/engine).

## Step definition of done (from the Build order)

Tests show a store rebuilt from SQLite after a simulated kill equals the one before; finish
produces rows the sync layer accepts.

## What this step builds

A headless domain store — no UI, no screens, no routes:

1. **The active-workout store** (`frontend/src/workout/activeWorkout.ts`): an in-progress
   workout as a typed object (workout + ordered exercises + ordered sets), where **every
   mutation is a committed SQLite transaction first** and the in-memory snapshot is rebuilt
   from what SQLite now holds. Mutations: start, add/remove/reorder exercise, log/update/remove
   set, repeat-last-set, finish, discard.
2. **Resume**: `loadActiveWorkout(db, userId)` rebuilds the store from the device database —
   the relaunch-after-kill path. (Who calls it on launch is B09's screen; the function and its
   proof are this step.)
3. **Draft-then-finish sync handoff**: while in progress, rows live in the mirror tables but
   are **not** in the outbox; `finish` stamps `ended_at` and enqueues the whole tree in one
   transaction — the literal "hands the workout to sync" of the step scope.
4. **Server-limit validation** in the one shared home: a small `limits.ts` added to
   `@training-math`, mirroring the server's CHECK constraints on `sets`, called before every
   write so a row the server would refuse can never reach the outbox (the poison-row rule
   recorded by B07 in `docs/HANDOFF.md` / `docs/DEFERRED.md`).
5. **v4 id minting** via `expo-crypto` (`frontend/src/lib/ids.ts`) — the first step that
   creates new rows on the device (B07 fixtures hardcoded ids).

## Approach

### 1. The central decision: drafts stay out of the outbox until finish

B07's `writeLocal` upserts + enqueues in one transaction — using it for every mid-workout
mutation would push half-finished workouts to the server continuously. This step deliberately
does **not** do that. In-progress rows are written with a new no-outbox DAO path; only `finish`
enqueues. Why:

- **The scope says so**: "finish writes `ended_at` and hands the workout to sync". Before
  finish, sync does not have the workout.
- **NFR-3 needs local durability, not server copies.** Force-kill, phone call, dead battery —
  in every one the device file survives, and that is what the DoD tests. A lost-or-destroyed
  phone is not in NFR-3.
- **Removal and reorder become trivially safe.** The outbox has no delete operation until B14
  (tombstones). If a mid-workout set had already been pushed, removing it locally could never
  reach the server — the removed set would resurrect in history, feed and analysis. Local-only
  drafts make remove/reorder plain local writes with nothing to un-push.
- **The server only ever sees finished workouts**, so B18 ("analysis runs when a finished
  workout syncs"), the feed and history never need an `ended_at is null` filter.
- **No half-abandoned workouts on the server** when someone starts a workout and walks away.

Interactions checked: the pull can never clobber a draft (the server has never seen the draft's
ids, so no pulled row can collide with one); the push can never see a draft (nothing is in the
outbox); the pending-local-shadow rule is not relied on for drafts at all.

### 2. DAO additions — `frontend/src/db/dao.ts`

Two new write paths beside `writeLocal` and `upsertRows` (file comment updated from "exactly
two ways" to name all the paths and when each is right):

- **`writeDraftRows(db, tbl, rows, { now })`** — upsert + stamp `updated_at`, **no outbox, no
  touch-the-root**. For in-progress-workout rows only. Touching the root is pointless pre-sync
  (nothing pulls or pushes a draft), and skipping it keeps a set-log to one row written.
  **Typed to the three workout-tree tables** (`workouts`, `workout_exercises`, `sets`) — the
  `exercises` table is excluded at the type level, so no draft path can ever bypass
  `writeLocal`'s library-exercise guard, by construction rather than by runtime check.
- **`writeLocalTree(db, { workouts, workout_exercises, sets }, { now })`** — a multi-table
  `writeLocal`: upserts every given row with `updated_at = now` and enqueues every one, in
  **one transaction**, then fires the `onLocalWrite` listeners (so the sync engine pushes
  soon after finish, exactly as it does after any `writeLocal`). The touch-the-root invariant
  holds trivially because the workout row itself is in the tree. Generic on purpose — B14's
  edit-past-workouts needs the same shape.

Three-transaction finish (`writeLocal` per table) was rejected: a crash between transactions
would enqueue the workout but not its sets, and the push would land a finished-looking empty
workout on the server for good. Finish must be atomic, so it needs the one-transaction tree
write.

All store reads and writes go through the DAO / driver executors — no raw SQL in the store
beyond parameterized selects of the workout tree (same precedent as `sync/push.ts`), and
**every query filters by the signed-in `user_id`** (the B07 rule; a previous account's rows
may still be in the file).

### 3. The store — `frontend/src/workout/activeWorkout.ts`

One deep module. Shapes:

```ts
interface ActiveEntry extends WorkoutExerciseRow { sets: SetRow[] }           // sets ordered by position
interface ActiveWorkoutSnapshot { workout: WorkoutRow; entries: ActiveEntry[] } // entries ordered by position
```

**Construction** (both return a store or null/throw; both filter by `userId`):

- `startActiveWorkout(db, userId, { clock?, mintId? })` — inserts a `workouts` row:
  `id = mintId()`, `started_at = clock()`, `ended_at = null`, `visibility = 'public'` (the
  server default; public-by-default account per the PRD), `title`/`notes` null. Refuses to
  start while an unfinished workout exists for this user (B09 decides resume-or-discard; the
  store never silently forks a second active workout).
- `loadActiveWorkout(db, userId, …)` — finds `workouts where user_id = ? and ended_at is null`,
  newest `started_at` first, loads its entries and sets, returns the store (or null). If more
  than one unended workout somehow exists (should be impossible through this API), the newest
  is the active one and the others are left untouched — surfaced to B09 rather than silently
  deleted.

**Mutations** — each validates, then commits one transaction via the draft path, then rebuilds
the snapshot by re-reading the tree from SQLite (SQLite is the source of truth; memory is a
cache — this is what makes the kill test honest, because the running store and a rebuilt store
read the same bytes). Mutations are serialized through an internal promise chain so two
overlapping calls cannot interleave their read-modify-write steps.

- `addExercise(exerciseId)` — verifies the exercise exists in the local `exercises` table
  (there is no local FK, and a bad id would be refused by the server's FK at push time — a
  poison row), appends a `workout_exercises` row at `position = entries.length`.
- `removeExercise(entryId)` — deletes the entry (local FK cascades its sets) and compacts the
  positions of the entries after it, in one transaction.
- `reorderExercise(entryId, newPosition)` — rewrites the positions between old and new slots,
  one transaction. Positions stay contiguous `0..n-1` (asserted in tests).
- `logSet(entryId, input)` — appends a `sets` row at the next position.
  `input: { reps?, weight?: { value, unit }, rpe?, isWarmup?, dropSetPosition?, durationSeconds? }`.
  **Unit-aware**: `weight` arrives in the user's entry unit; `lbToKg` (`@training-math`)
  converts, and the kg value is rounded to 2 decimals via `roundToIncrement(kg, 0.01)` —
  matching the server column `numeric(6, 2)` exactly, so the device value and the
  server-rounded value are identical and a later pull changes nothing. (Display stays
  exact-feeling: 225 lb → 102.06 kg stored → 225 lb displayed.) **RPE is rounded to 1
  decimal the same way** — its column is `numeric(3, 1)`, and an unrounded 9.55 would
  otherwise come back from the server as 9.5, the same device/server drift in miniature.
- `updateSet(setId, input)` — same validation and conversion, overwrites the row.
- `removeSet(setId)` — deletes and compacts set positions within its entry.
- `repeatLastSet(entryId)` — copies that entry's highest-position set (reps, weight_kg, rpe,
  is_warmup, drop_set_position, duration_seconds) into a new row: new id, next position, fresh
  timestamps. One call — NFR-2's store half; B09 puts it behind one tap.
- `finish({ clock? })` — refuses if already finished; `ended_at = max(clock(), started_at)`
  (clamped so a backwards device clock cannot trip the server's `ended_at >= started_at`
  CHECK); writes the workout row and enqueues the **entire tree** via `writeLocalTree` in one
  transaction. After finish the store is sealed: every mutation throws (editing a finished
  workout is B14). An empty workout (zero exercises, or sets with all-null performance
  fields) finishes without complaint — the server accepts it, and "offer discard instead of
  finishing an empty workout" is B09 UX policy, not domain law (the store never enforces
  rules the server doesn't). A kill after the finish transaction commits but before the sync
  listener fires loses nothing: the outbox rows are durable and the engine's start trigger
  pushes them on the next launch.
- `discard()` — pre-finish only: deletes the workout row (cascade removes entries and sets),
  purely local, nothing to un-sync. For B09's "abandon this workout" choice.
- `subscribe(listener)` / `getSnapshot()` — change notification + current snapshot, shaped for
  React's `useSyncExternalStore` without importing React here (No UI in this step).

Not included, deliberately: title/notes setters (no LOG-3/B12 consumer yet), program prefill
(B35), PR detection on finish (B13), any React hook or screen (B09).

### 4. Validation — `backend/supabase/functions/_shared/training-math/limits.ts`

The HANDOFF rule, verbatim: "validate before `writeLocal` through the shared training-math
`validate` module so a server-refused row never wedges the outbox." The device repeats none of
the server's CHECKs (B07, recorded limit); a draft that violated one would, at finish, enter
the outbox and block every upload behind it forever. So the store validates **at mutation
time** (the user hears about a bad value when they type it, not at finish) — and the rules
live in the one shared module, never in the store:

- New `limits.ts` in `@training-math` (same rules as every file there: pure TS, `.ts` imports,
  no I/O), exported via `index.ts`, mirroring the server's CHECKs on `sets` **exactly** —
  stricter would refuse rows the server accepts, looser would wedge the outbox:
  `assertValidSetFields({ reps?, weightKg?, rpe?, dropSetPosition?, durationSeconds?, position })`
  — reps a whole number ≥ 0; weight_kg ≥ 0 and < 10000 (`numeric(6,2)`); rpe 1–10;
  drop_set_position ≥ 1 whole; duration_seconds ≥ 0 whole; position ≥ 0 whole. Built on the
  existing `assert*` helpers in `validate.ts`; cites the migration
  (`20261114100100_training.sql`) line-by-line in its comment so drift is visible.
- Workout/entry field limits (title ≤ 100, notes ≤ 2000/1000) are **not** added now — B08 has
  no setter that writes them (nulls violate nothing). They land in this same file when B09/B12
  add the setters. Add nothing speculative.

This does not contradict `schema.ts`'s "server CHECKs deliberately not repeated" note: that
note forbids a *second rule home* (SQLite CHECK clauses drifting from SQL). `limits.ts` is the
single shared pre-flight home, imported by the store today and by any server function tomorrow.

### 5. Id minting — `frontend/src/lib/ids.ts`

`newUuid(): string` over `expo-crypto`'s `randomUUID()` (the HANDOFF-recorded choice; Hermes
has no reliable `crypto.randomUUID`). Installed with `npx expo install expo-crypto` so the
SDK-58-matched version is picked. The store takes `mintId` injectable (defaults to `newUuid`),
so tests mint deterministic ids and never touch the native module; `jest.setup.js` additionally
mocks `expo-crypto` with Node's `crypto.randomUUID` so importing the module under jest-expo is
safe either way.

### 6. The simulated-kill test (the step's headline proof)

`activeWorkout.test.ts`, on the real-SQLite node driver (B07's `createNodeSqliteDriver`):

1. Open a **file-backed** database in a temp directory (the node driver takes a path; `:memory:`
   cannot survive a connection swap, so a file is the honest medium), run `prepareDatabase`.
2. Build a store; start, add two exercises, log sets (kg and lb entries), repeat a set, reorder,
   remove a set — a realistic mid-workout state.
3. **Kill**: abandon the store and its driver without any close, flush or teardown — exactly
   what a force-killed process gets to do. Open a **new** driver on the same file (WAL mode, as
   the app runs), `prepareDatabase` again (migrations and seed are idempotent), and
   `loadActiveWorkout`.
4. Assert the rebuilt snapshot **deep-equals** the abandoned store's last snapshot — every
   exercise, set, position, timestamp and weight. That is the step DoD sentence, literally.

Also proven: a mutation whose transaction fails midway (fault-injecting driver, B07's dao-test
pattern) leaves both SQLite and the snapshot unchanged — atomicity at the store level, on top
of B07's dao-level proof.

### 7. The finish-to-sync test (the DoD's second sentence)

Same file, with B07's `fakeTransport` and the real `pushOutbox`:

- Before finish: outbox is empty (drafts are invisible to sync — asserted, not assumed).
- `finish()`: `ended_at` set; outbox now holds the workout, every entry and every set.
- `pushOutbox(db, fakeTransport)`: every row lands in the fake server's by-id maps exactly
  once, parents before children; a second push changes nothing (no duplicates). "Rows the sync
  layer accepts" is thus tested against the actual push path and row shapes, not a stub — and
  since the rows are the same `RowByTable` shapes `supabaseTransport` serializes, the real
  transport takes them by construction.
- Validation test: a set that would violate a server CHECK (rpe 11, negative reps, 5-digit
  weight) is refused by the store with a `RangeError` **before** any write — nothing in the
  tables, nothing in the outbox.

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/workout/activeWorkout.ts` | new — the store (§3) |
| `frontend/src/workout/activeWorkout.test.ts` | new — kill test (§6), finish/push test (§7), mutation/validation/resume/discard tests |
| `frontend/src/db/dao.ts` | edit — add `writeDraftRows`, `writeLocalTree`; update the file comment's write-path inventory |
| `frontend/src/db/dao.test.ts` | edit — tests for both new paths (atomicity, no-outbox for drafts, listener fire for tree) |
| `frontend/src/lib/ids.ts` (+ `.test.ts`) | new — `newUuid` over expo-crypto (§5) |
| `backend/supabase/functions/_shared/training-math/limits.ts` (+ `.test.ts`) | new — server-CHECK mirror for set fields (§4) |
| `backend/supabase/functions/_shared/training-math/index.ts` | edit — export `limits.ts` |
| `frontend/package.json` | edit — add `expo-crypto` (via `npx expo install`) |
| `frontend/jest.setup.js` | edit — mock `expo-crypto` |
| `docs/diagrams/app-flow.md` | edit (Document step) — active-workout data path: mutations → SQLite drafts → finish → outbox → push; marked "store live, no UI until B09" |
| `docs/diagrams/database-erd.md` | untouched or note-only — **no server schema change** |
| `docs/BUILD_LIST.md` | **not touched** — status flips happen at Gate 2 |

## Data model impact

**No server migration. No device schema migration.** Drafts live in the existing mirror tables
(`workouts.ended_at is null` *is* the draft state — no flag column, no draft table), and the
outbox already distinguishes "queued" from "not queued" by presence. The resume query scans the
user's workouts for `ended_at is null`; at one active workout per user that needs no new index.

## How each definition of done becomes observably true

- **Step DoD** — §6's rebuilt-store-deep-equals test and §7's finish-through-real-push test.
- **NFR-3 (completed by this step)** — B07 proved a committed transaction survives a kill
  (WAL + atomic row+outbox writes); B08 proves the full store rebuilds from those committed
  bytes after a simulated kill. The remaining literal device observation (force-kill the real
  app mid-workout) is Tristen's Built → Done run once B09 gives the store a screen.
- **LOG-1 (this step's part)** — `startActiveWorkout` creates a blank workout; the Workout
  button lands in B09, program prefill in B35.
- **LOG-2 (this step's part)** — `addExercise` + `logSet` build a multi-exercise session that
  `loadActiveWorkout` reopens with every set intact (the kill test asserts exactly this); the
  library-search UI is B09.
- **NFR-2 (this step's part)** — `repeatLastSet(entryId)` is one call that duplicates the
  previous set; B09 binds it to one tap.
- **Poison-row rule (HANDOFF)** — §7's validation test: a server-refusable set never reaches
  the tables or the outbox.

## Out of scope (this branch)

- **Any UI** — screens, hooks, the Workout button, one-tap affordances: B09.
- **Title and notes setters** (LOG-3) — B12; their `limits.ts` entries land with them.
- **Program-driven prefill** (LOG-1's other half) — B35.
- **PR detection on finish** (LOG-4) — B13 runs `classifyPrs` over the finished workout.
- **Editing or deleting finished workouts, delete/tombstone sync** — B14; the store seals at
  finish.
- **Superset/drop-set/timed-work semantics beyond pass-through columns** — B11 (the store
  writes the columns; B11 owns their behavior).
- **Rest timer / Tool Kit integration** — B16/B17.
- **Multi-device active workouts, account-switch wipe** — recorded B07 deferrals, unchanged.

## Risks a reviewer should weigh

1. **Drafts bypass the outbox (§1) — a deliberate reading of B07's "one write path" rule.**
   If some future step wants live in-progress sync (e.g. a "friend is lifting now" feature),
   this design defers that work: drafts would need either `writeLocal` per mutation plus B14's
   tombstones for removals, or a draft-visibility column. The trade was taken for correctness
   today (no un-deletable pushed sets, no half-workouts on the server) over a feature nobody
   has specced. The DAO file comment names the draft path's contract so no one mistakes it for
   the synced path.
2. **The finish transaction is the new load-bearing atom.** `writeLocalTree` must enqueue the
   whole tree in one transaction, or a crash at the wrong moment ships a finished workout with
   missing children (the exact bug class B07's touch-the-root re-queue closed for updates).
   The three-transaction alternative is rejected in §2; the builder must not "simplify" into
   it. The crash-mid-finish case is tested with the fault-injecting driver.
3. **`limits.ts` mirrors the server's CHECKs by hand.** If a future migration tightens a CHECK
   and `limits.ts` is not updated, poison rows return (looser-than-server). The file cites the
   source migration lines and sits in the one shared module so there is exactly one place to
   update; drift has no test that spans SQL and TS (nothing executes both), so it is a
   review-time discipline — called out in the file's comment and here.

## Grilling decisions (settled before code)

Run via `mattpocock-skills:grilling`; headless pipeline run, so the planner played both sides
at full severity. Questions that changed or sharpened the plan:

- **"Drafts-skip-the-outbox contradicts B07's 'writeLocal is the one write path' doc — which
  rule wins?"** The scope sentence wins ("finish … hands the workout to sync"), and the
  contradiction is resolved by *amending the DAO's contract*, not working around it: the draft
  path is a DAO function with its own documented contract, and the dao.ts file comment is
  updated in the same commit. The alternatives were worse: continuous `writeLocal` pushes
  in-progress workouts the server can never un-see (removal needs B14's tombstones; B18/B20
  would need finished-filters everywhere).
- **"Why do `removeSet`/`updateSet` exist? B09's DoD only names remove/reorder for
  exercises."** First drafted with them justified loosely ("natural UX"); the grilling forced
  the real argument: B09's screen will need set correction (a fat-fingered weight is the most
  common logging event there is), and **pre-finish is the only cheap time to build it** — after
  finish it becomes B14's recompute-PRs problem. Deferring set-removal to B14 would make the
  mid-workout typo un-fixable until deep in the build. They stay, with that recorded as the
  reason.
- **"Is `limits.ts` training math? Character limits on titles certainly aren't."** Sharpened
  the scope: `limits.ts` carries only the **set-field** rules (reps, weight, RPE, positions,
  durations — all training quantities) and explicitly not title/notes lengths, which have no
  B08 writer. The HANDOFF directive names this module as the home; the one-home rule's point is
  that the device's pre-flight and any future server-side use read the same file.
- **"LOG-6 says *exact* conversion with display-only rounding — but you round kg to 2 decimals
  at storage. Contradiction?"** No: the server column is `numeric(6,2)`, so Postgres rounds to
  2 decimals regardless of what the device sends. Storing unrounded kg locally would make the
  device and server disagree about every lb-entered weight (102.05827995 vs 102.06) — the
  pull-after-push would then "edit" every weight. Rounding at entry to the column's own
  precision keeps device == server byte-for-byte; 0.01 kg is far below any plate increment and
  survives round-trip display (225 lb → 102.06 kg → 225.0 lb). The *conversion* stays exact
  (`lbToKg`), the storage matches the column — recorded so nobody "fixes" it either direction.
- **"Why rebuild the snapshot from SQLite after every mutation instead of updating memory
  incrementally?"** Because the DoD is "rebuilt store equals the one before" — if memory is
  maintained independently, the test can pass while the running store and the file disagree
  (the bug NFR-3 exists to prevent). Re-reading one workout's tree is tens of rows; the cost
  argument is imaginary at this scale. Incremental updates are an optimization with a measured
  trigger, not a default.
- **"Why not `:memory:` for the kill test?"** An in-memory database dies with its connection —
  "reopen and rebuild" would be rebuilding from nothing, or from the same still-open handle,
  which proves nothing about durability. The file-backed temp database with a fresh connection
  is the smallest honest simulation of a process kill. (It also exercises `prepareDatabase`'s
  idempotency on a used file, for free.)
- **"`startActiveWorkout` refuses when a draft exists — why not auto-resume?"** Policy belongs
  to the screen (B09 may offer "resume or discard?"); the store's job is to make the illegal
  state (two active workouts) unrepresentable through its API. Returning the existing store
  silently would hide a UX decision inside the domain layer.
- **"What if the device clock goes backwards mid-workout?"** `finish` clamps
  `ended_at = max(now, started_at)` so the server's `ended_at >= started_at` CHECK can't turn a
  clock anomaly into a poison row. A zero-length workout is odd but syncs; a wedged outbox is
  data loss.
- **"expo-crypto is a new native dependency — could the ids come from Math.random or a
  timestamp?"** No: these are the primary keys the server upserts on; collision = silent row
  merge across users' workouts. RFC-4122 v4 from a CSPRNG is the floor, `expo-crypto` is the
  Expo-native way to get it, and the HANDOFF already records the choice. The injectable
  `mintId` keeps tests deterministic and the native module out of Jest.
- **"Two unended workouts — can the resume query's 'newest wins' hide data?"** The API makes
  the state unreachable (start refuses while one exists; finish and discard are the only
  exits), so the branch is defensive. Newest-wins with the others left intact (never deleted
  silently) means even a corrupted state loses nothing; B09 can surface leftovers later. The
  alternative — throwing on multiple drafts — would brick resume exactly when the user most
  needs it.
- **"Does the sync engine even notice a finish?"** Yes — `writeLocalTree` fires the same
  `onLocalWrite` listeners `writeLocal` does, and the engine's local-write trigger debounces
  into a push. Without that, a finished workout would sit until the next foreground/reconnect
  trigger. Made explicit in §2 after this question.
- **"Is `subscribe`/`getSnapshot` UI scope creep?"** It is the store's change-notification
  surface, React-free, and B09 cannot use the store without it (`useSyncExternalStore` needs
  exactly these two functions). Building the store without any way to observe it would just
  move two trivial functions into B09 and tempt B09 to poll. It stays.
- **"Weight gets rounded to its column's precision — what about RPE?"** Caught in grilling:
  `rpe` is `numeric(3, 1)`, so the same server-side rounding applies and the same fix does —
  RPE rounds to 0.1 at entry. Every numeric column a draft writes is now checked against its
  server precision; the others (`reps`, positions, `duration_seconds`) are integers and whole
  by validation already.
- **"Could `writeDraftRows` write a library exercise and dodge `writeLocal`'s guard?"** As
  first drafted, yes in principle (it was table-generic). Settled by typing both new DAO
  functions to the three workout-tree tables, so the illegal call fails to compile instead of
  relying on a runtime guard nobody tests.
- **"Should `finish` refuse an empty workout?"** No — the store mirrors the server exactly, in
  both directions: looser wedges the outbox, stricter makes the store a second rules home that
  will fight B09's UX. Empty-workout handling (offer discard) is recorded as a B09 concern.
