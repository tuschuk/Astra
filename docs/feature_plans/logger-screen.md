# logger-screen — B09: The logger screens over B08's store (LOG-1 part, LOG-2, LOG-5 part, NFR-2)

**Branch:** `logger-screen` (from `main`)
**Build step:** B09 — covers LOG-2 (whole: the add-exercise / log-set / save / reopen screens over
B08's operations), LOG-1 (partial: the Workout button that starts a blank workout; program prefill
is B35), LOG-5 (partial: "last time" sets shown per exercise from local history; the fuller panel
with PRs and the history screen are B13), NFR-2 (whole: `repeatLastSet` bound to exactly one tap).
**Depends on:** B08 (`frontend/src/workout/activeWorkout.ts` — the active-workout store), and
through it B07 (device SQLite + sync) and B06 (`@training-math`).

## Step definition of done (from the Build order)

A multi-exercise session can be logged, saved and reopened with every set intact, and repeating a
set is exactly one tap.

## Scope check

The step scope sentence does not mention "last time", but the step's Covers list includes LOG-5
(partial) with the DoD "each exercise in an active workout shows the sets from the previous
session of that exercise". These are reconcilable: the Covers list is the wider truth, and the
last-time line is one local query plus one line of UI inside the entry card this step builds
anyway. B09 ships the minimal honest version — the previous session's sets, read from the device
database — and B13 keeps the richer panel (PRs, full history screen). Noted rather than silently
widened.

## What this step builds

The first screens over the stack: the Workout tab becomes the logger's front door, a new
active-workout screen drives B08's store, and a read-only saved-workout screen shows the result.
No new domain logic — every write goes through `ActiveWorkoutStore`; every read is a
user-filtered query of the device database.

1. **Workout tab** (`frontend/src/app/(tabs)/workout.tsx`, rewritten): "Start empty workout"
   starts a blank workout via the store and opens the active-workout screen (LOG-1's button).
   When an unfinished workout exists on the device, the tab offers **Resume workout** (and
   Discard) instead — the B08 rule "offer resume-or-discard when `startActiveWorkout` refuses",
   handled before it can refuse. Below the actions: the user's past (finished) workouts, newest
   first, capped at the most recent 100 (full-history browsing is YOU-2/B25's job; the cap is
   one SQL `limit`, not pagination machinery), each opening the saved-workout screen. Workouts
   have no title until B12, so each row shows a date-derived label from `started_at` plus
   duration and exercise/set counts. "Start from a program" stays disabled (B35).
2. **Active-workout screen** (`frontend/src/app/active-workout.tsx`): the logger. Lists the
   workout's exercises in order; each entry card shows its logged sets, a reps/weight input row
   in the user's unit, a one-tap **Repeat** button (NFR-2), remove-set, remove-exercise and
   move-up/move-down controls, and the "last time" line (LOG-5 part). An **Add exercise** button
   opens a search over the library (name search, same `searchExercises` the Library tab uses)
   and appends the picked exercise. **Finish** seals the workout through the store (which hands
   it to sync) and replaces the screen with the saved workout. **Discard** (confirmed) deletes
   the draft. Finishing a workout with zero logged **sets** (exercises alone don't count)
   instead shows "Nothing logged yet" with exactly two choices — Discard workout / Keep
   lifting — the B08-recorded UX rule; no finish-anyway path in the UI.
3. **Saved-workout screen** (`frontend/src/app/workout/[id].tsx`): read-only view of one finished
   workout — date, exercises in order, every set with reps and weight in the user's unit. This is
   what "finish opens the saved workout" opens, and what the past-workout list opens. Editing is
   B14; analysis-on-finish is B18/B21.
4. **Session holder** (`frontend/src/workout/activeWorkoutSession.ts` + `useActiveWorkout.ts`):
   one module-level slot holding the current `ActiveWorkoutStore | null` so the tab and the
   active-workout screen see the same store instance, plus a hook that subscribes React to both
   the slot and the store's snapshot (`useSyncExternalStore` over B08's `subscribe`/
   `getSnapshot` — the surface B08 built for exactly this). The slot stores `{ userId, store }`
   and every access (`start` / `resume` / `current` / `clear`) takes the caller's signed-in
   `userId`; a mismatch clears the slot before proceeding — that is the whole account-change
   story, with no auth listener. Sign-out leaves the draft in SQLite (B07 keeps device data on
   sign-out), so signing back in offers resume.
5. **History read-model** (`frontend/src/workout/history.ts`): the step's queries, all
   parameterized, all filtered by the signed-in `user_id` (the B07 rule — the file can hold a
   previous account's rows):
   - `listPastWorkouts(db, userId)` — finished workouts newest-first (limit 100) with
     exercise/set counts for the tab's list;
   - `readWorkout(db, userId, workoutId)` — one finished workout's full tree with exercise
     names (joined from the local `exercises` table) for the saved-workout screen;
   - `lastSessionSets(db, userId, exerciseId, excludeWorkoutId)` — the sets of this exercise
     from the newest **finished** workout that contains it, excluding the active workout, for
     the last-time line. Returns null when the exercise has never been logged.
   Reads follow B08's precedent (parameterized selects via the DAO's `TABLE_COLUMNS` /
   `fromSqlRow`); writes never happen here.
6. **Display unit seam** (`frontend/src/settings/displayUnit.ts` — in `settings/` so B15,
   settings-and-units, edits its own folder): B09 needs a unit to display
   and parse weights but the unit *toggle* is B15 (`user_settings.unit` is not mirrored
   locally yet). One tiny module exports the unit the app uses — today the server default
   (`'lb'`, `user_settings.unit`'s column default) — so B15 has exactly one place to rewire to
   the synced setting. All conversion stays in `@training-math` (`displayWeight` out,
   `{ value, unit }` into the store, which converts and rounds); no math is added here.

## Approach details

### Navigation and store lifetime

- New routes `active-workout` and `workout/[id]` are declared in the root stack
  (`frontend/src/app/_layout.tsx`) inside the signed-in `Stack.Protected` guard, beside
  `(tabs)` — they need a session, and the active workout should fill the screen without the tab
  bar (mid-set logging is the most focused moment in the app).
- The Workout tab checks for an unfinished workout when it gains focus (`loadActiveWorkout` —
  the B08 deferral "call loadActiveWorkout on launch or when opening the tab" is satisfied at
  the tab, the only place that can act on it). Start and Resume both put the store in the
  session slot and push `/active-workout`; the active-workout screen itself also calls
  `loadActiveWorkout` if the slot is empty (deep-launch safety) and backs out to the tab if
  there is truly nothing active.
- After `finish()` the screen clears the slot and `router.replace`s to `/workout/[id]` — back
  from the saved workout lands on the tab, not the dead logger. After `discard()` it clears the
  slot and pops back. The store's `getStatus()` guards double-taps on Finish/Discard.
- The add-exercise search is an in-screen modal (React Native `Modal` wrapping the search list),
  not a route: no navigation state to hand off, no typed-route churn, and the search component
  (`ExercisePicker`) stays a plain component reusing `searchExercises` over `ALL_EXERCISES`
  from the catalog. Picking an exercise calls `store.addExercise(libraryExerciseId(def.id))` —
  the catalog's ids are slugs; `libraryExerciseId` turns one into the uuidv5 id seeded into the
  local `exercises` table, which the store verifies anyway. (Corrected at build: the plan first
  said the catalog ids *were* the uuidv5 ids.)

### The entry card (where LOG-2, LOG-5 and NFR-2 live)

`frontend/src/components/workout/EntryCard.tsx` (+ small pieces beside it):

- **Sets list**: each saved set as a row — set number, reps, weight shown via
  `displayWeight(kg, unit)`; a remove control per row. (Warm-up/RPE/drop-set/timed UI are
  B10/B11 — the columns pass through the store untouched.)
- **Input row**: reps and weight `TextInput`s (`keyboardType` numeric/decimal), a Log button
  calling `logSet(entryId, { reps, weight: { value, unit } })`. Weight may be left empty and
  saves null (the column is nullable; a dedicated bodyweight UX is B10). Reps likewise optional —
  the Log button enables once either field has a value. Comma decimals are normalized to dots
  before parsing. A store `RangeError` (e.g. weight ≥ 10 000) surfaces as an inline message, not
  a crash.
- **Repeat** (NFR-2): one button, enabled once the exercise has a set, whose single press calls
  `repeatLastSet(entryId)`. Nothing to type, nothing to confirm — exactly one tap. Disabled
  (not hidden) before the first set, so the affordance is learnable.
- **Last time** (LOG-5 part): one muted line under the exercise name — the previous session's
  sets (`3 × 8 @ 185 lb` style), from `lastSessionSets`, queried once when the entry appears
  and absent (not an error state) for a never-logged exercise. One query per entry against
  indexed local SQLite is tens of rows; and since it describes *finished* history, it cannot
  change mid-workout — no refresh machinery.
- **Reorder**: move-up/move-down buttons calling `reorderExercise`. Chosen over drag-and-drop:
  no new dependency ("add nothing speculative"), fully accessible, and the store API is
  position-based either way — a drag UI can replace the buttons later without touching the store.

### Testing (Jest + RNTL, per the repo's rules)

- `src/workout/history.test.ts` — on B07's node SQLite driver with seeded fixtures: list is
  newest-first and finished-only; another user's workouts never appear; `readWorkout` returns
  the full tree with names; `lastSessionSets` picks the newest finished workout containing the
  exercise, excludes the active workout, and returns null for a never-logged exercise.
- `src/workout/activeWorkoutSession.test.ts` — start/resume/clear: resume returns the same
  draft after a simulated relaunch (new store from the same file); clear empties the slot;
  subscribers fire on slot change.
- Component tests beside the components — `EntryCard.test.tsx`: a **single** `fireEvent.press`
  on Repeat produces a set equal to the previous one (NFR-2's DoD at the UI layer); logging,
  removing, invalid-input message. `ExercisePicker.test.tsx`: search narrows, pick returns the
  id.
- Route tests in `src/__tests__/` (expo-router would register `*.test.tsx` under `src/app/` as
  routes): the Workout tab shows Start when no draft exists, Resume when one does, and lists
  past workouts; the saved-workout screen renders every set of a fixture workout. Screens get
  the database by mocking `@/db/database` (`openAppDatabase` → the prepared node driver) — the
  repo's existing module-mock precedent, instead of inventing a prop-drilling layer for tests'
  sake; the router is stubbed as in `screens.test.tsx`.
- `src/__tests__/logger-flow.test.tsx` — the step DoD end-to-end in one test, against the real
  store on the node driver: start → add two exercises → log sets (lb entry) → one-tap repeat →
  finish → the saved-workout screen (fed by `readWorkout`) shows every set intact; then
  `loadActiveWorkout` returns null (nothing left active).
- All store/DB tests use the node driver and fakes — never the real Supabase project (repo rule);
  the sync side is already proven in B07/B08 and is not re-tested here.

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/app/(tabs)/workout.tsx` | rewrite — start/resume/discard actions + past-workout list (§1) |
| `frontend/src/app/active-workout.tsx` | new — the logger screen (§2) |
| `frontend/src/app/workout/[id].tsx` | new — read-only saved workout (§3) |
| `frontend/src/app/_layout.tsx` | edit — declare the two new routes in the signed-in guard |
| `frontend/src/workout/activeWorkoutSession.ts` (+ test) | new — the one store slot (§4) |
| `frontend/src/workout/useActiveWorkout.ts` | new — React subscription hook over slot + snapshot |
| `frontend/src/workout/history.ts` (+ test) | new — past-workout / tree / last-time queries (§5) |
| `frontend/src/settings/displayUnit.ts` | new — the unit seam B15 rewires (§6) |
| `frontend/src/components/workout/EntryCard.tsx` (+ test) | new — entry card: sets, input, repeat, last-time (§ entry card) |
| `frontend/src/components/workout/ExercisePicker.tsx` (+ test) | new — modal library search |
| `frontend/src/components/workout/WorkoutListItem.tsx` (+ test) | new — past-workout row for the tab |
| `frontend/src/__tests__/workout-tab.test.tsx`, `saved-workout.test.tsx`, `logger-flow.test.tsx` | new — route + DoD tests |
| `docs/diagrams/app-flow.md` | edit (Document step) — Workout tab → logger → finish → saved workout paths; store no longer "no UI" |
| `docs/diagrams/database-erd.md` | untouched — no schema change |
| `docs/BUILD_LIST.md` | not touched — status flips happen at Gate 2 |

## Data model impact

**None.** No server migration, no device schema change. Every read targets the existing mirror
tables; every write goes through B08's store. The DEFERRED item "exercise-name snapshot on
`workout_exercises` when the logger lands" is deliberately **not** taken: today no exercise can
disappear (the library is permanent, renames are content migrations, custom exercises don't
exist until B31), so a name-snapshot column has no observable behavior yet — it lands with B31,
the first step that makes an exercise deletable. Recorded here so the deferral moves rather
than silently drops.

## How each definition of done becomes observably true

- **Step DoD** — `logger-flow.test.tsx` (§ Testing) walks it literally: multi-exercise session
  logged, saved, reopened with every set intact; repeat is one `fireEvent.press`. Tristen's
  device run (airplane-mode log, force-kill, reconnect) is the Built → Done flip for this step
  and for FND-3/NFR-1/NFR-3's device checks, as already recorded in HANDOFF.
- **LOG-1 (this step's part)** — the Workout tab's "Start empty workout" button calls
  `startActiveWorkout` and opens the logger. Program prefill stays B35.
- **LOG-2 (completed by this step, pending device run)** — add-by-search, log sets with reps
  and weight in the user's unit, finish, reopen from the past-workout list with every set
  intact — all on screen, proven in the flow test.
- **LOG-5 (this step's part)** — each entry card shows the previous session's sets for that
  exercise, from the device database. B13 keeps the fuller panel + history screen.
- **NFR-2 (completed by this step, pending device run)** — the Repeat button's single press is
  the whole interaction; asserted in `EntryCard.test.tsx`.

## Out of scope (this branch)

- **Program start** (B35) — the button stays disabled.
- **Warm-up / RPE / bodyweight UX** (B10), **supersets, drop sets, timed work UI** (B11),
  **notes** (B12) — the logger shows plain reps × weight sets only; the columns ride through
  untouched.
- **PR detection, history screen, richer last-time** (B13).
- **Editing or deleting finished workouts** (B14) — the saved screen is read-only.
- **Unit toggle** (B15) — the unit seam ships, pinned to the server default.
- **Tool Kit** (B16/B17) — the tab's teaser row stays as is.
- **Analysis / post flow after finish** (B18/B20/B21) — finish opens the saved workout directly.
- **Surfacing leftover multiple drafts** (B08 deferral) — resume keeps taking the newest.
- **Rest timer, elapsed-time header** — nothing in the step scope asks for them.

## Risks a reviewer should weigh

1. **The session slot is module state shared across routes.** A singleton holding the live
   store is the simplest way for the tab, the logger and a deep launch to agree on one store
   instance (the alternative — a context provider in the root layout — is the same lifetime
   with more plumbing, since the slot must outlive tab unmounts). The risk is a stale store
   after sign-out/account switch: the slot is keyed by `user_id` and self-clears when the
   signed-in user changes, and every query under it is user-filtered anyway (B07 rule). The
   flow test and session tests cover start→finish→clear and relaunch-resume.
2. **Typed routes go stale.** Adding `active-workout` and `workout/[id]` changes expo-router's
   generated `.expo/types/router.d.ts`; `tsc --noEmit` fails against the stale file (bitten in
   B06, B07 and B08 — the builder prompt documents the `npx expo start` regeneration). The
   builder must regenerate before judging tsc, and Gate 2 re-runs it cold.
3. **The last-time query's definition of "previous session"** — newest *finished* workout
   containing the exercise, excluding the current draft. If it accidentally included drafts or
   another user's rows, it would leak exactly the data the B07 rules guard; the history tests
   pin both exclusions.

## Grilling decisions (settled before code)

Run via `mattpocock-skills:grilling`; headless pipeline run, so the planner played both sides at
full severity (B08 precedent). Questions that changed or sharpened the plan:

- **"The session slot 'self-clears when the user changes' — a module singleton has no auth
  subscription, so how?"** First drafted as an assertion; now a contract: the slot stores
  `{ userId, store }`, every access passes the caller's signed-in `userId`, and a mismatch
  clears the slot before proceeding. No auth listener, nothing to unsubscribe, and the B07
  account-switch deferral stays where it was (local rows are wiped only when account switching
  is built).
- **"What exactly is an 'empty' workout at finish, and does the alert offer finish-anyway?"**
  Empty = zero logged sets; exercises alone don't make history worth keeping. Two choices only
  (Discard workout / Keep lifting). Finish-empty stays possible through the store — B08 settled
  that the store never enforces rules the server doesn't — but no UI path invites it.
- **"Unbounded past-workout list — pagination, or let it grow?"** Neither: `limit 100`,
  newest first. FlatList virtualizes rendering; full-history browsing belongs to the profile
  (YOU-2, B25). Pagination now would be speculative machinery.
- **"Every workout's title is null until B12 — what does the list show?"** A date-derived label
  from `started_at`, plus duration and counts. No title editor sneaks in ahead of B12.
- **"Route screens call `openAppDatabase()` — how do tests inject the node driver?"** By
  mocking `@/db/database`, the repo's established pattern. A dependency-injection layer for
  routes would be new architecture for tests' benefit only.
- **"Is `src/workout/` the right home for the unit seam when B15 is settings-and-units?"**
  Moved to `src/settings/displayUnit.ts` so B15 rewires its own folder. The seam exports the
  server default (`'lb'`) today; all conversion stays in `@training-math`.
- **"N last-time queries per screen — cost? staleness?"** Tens of rows against indexed local
  SQLite, once per entry mount; finished history cannot change during a workout, so there is
  nothing to refresh. An aggregate prefetch would be optimization without a measured problem.
- **"Cheaper alternative: reuse the logger as a read-only saved-workout view?"** Rejected — a
  read-only mode threaded through the logger's input/repeat/reorder affordances is more code
  and more states than a small screen over `readWorkout`, and B14 (editing) will want that
  separation anyway.
- **"Double-taps: Start twice, Finish twice?"** The store already guards both (in-transaction
  start check; `getStatus()` seal after finish); the screens additionally disable buttons while
  an operation is pending. No new locking invented.
- **"Deep launch of `/active-workout` with an empty slot?"** The screen calls
  `loadActiveWorkout` itself and backs out to the tab when nothing is active — the slot is a
  cache, never the source of truth (SQLite is, per B08).
- **"Does B09 take the DEFERRED exercise-name-snapshot migration?"** No — no exercise can
  disappear until B31 makes customs deletable, so the column would have no observable behavior.
  Recorded in Data model impact so the deferral moves rather than drops.
- **"Reorder: why buttons and not drag?"** No new dependency, accessible by default, and the
  store API is position-based either way — a drag UI can replace the buttons without touching
  anything below the components.

## Build deviations (recorded by the builder)

What shipped differs from the plan above in these ways. All are additions or tightenings; none
changes the data model, the store, or a Rule.

1. **Catalog ids → library ids.** The catalog's `ExerciseDef.id` is the slug (`bench_press`),
   not the uuidv5 id; the logger converts with `libraryExerciseId()` before `addExercise`
   (corrected in §Navigation above).
2. **Session slot contract, as built.** `currentSessionWorkout(userId)` is a pure read — it
   returns the store only if the slot is this user's, and never mutates (it runs during React
   render via `useSyncExternalStore`, where changing module state and notifying is unsafe).
   `startSessionWorkout` / `resumeSessionWorkout` do the clearing of another user's slot.
   `clearSessionWorkout()` takes no `userId` — emptying the slot is always safe. The guarantee
   from the grilling ("a store belonging to another user is never handed out") holds.
3. **Extra modules.** `src/workout/format.ts` (set / last-time / date / duration / details text,
   reps-and-weight box parsing, friendly messages for the store's `RangeError`s — writing only;
   all weight math is `@training-math`'s `displayWeight`); `src/db/useAppDatabase.ts` (a hook
   over `openAppDatabase` shared by the three screens);
   `src/components/workout/confirmDiscardWorkout.ts` (the one "Discard this workout?" alert, used
   by the tab and the logger); `src/test-utils/loggerTestKit.tsx` (prepared DB, test clock,
   signed-in render).
4. **`exerciseName(db, userId, exerciseId)`** joined §5's three queries: the active workout's
   snapshot holds only exercise ids, so each entry card looks its name up (user-filtered, like
   the rest) together with its last-time sets, once on mount.
5. **"Last time" requires a logged set.** `lastSessionSets` picks the newest finished workout
   with at least one *set* of the exercise — a workout where it was added but never logged is
   skipped (it has nothing to show). If the exercise appeared twice in that workout, both
   entries' sets are returned in workout order.
6. **Pending state on the entry card too.** The grilling named Start/Finish double-taps; the
   review found a double-tap on "move down" would reorder twice. Each card now runs one store
   call at a time (ref guard + disabled buttons). Repeat stays a single tap.
7. **Discard on the Workout tab asks first** (the same confirmation as the logger's Discard),
   and the logger header shows "Started <date>". The saved-workout screen names a missing
   exercise "Deleted exercise" (unreachable until B31 makes customs deletable).
8. **The Workout smoke test moved** from `screens.test.tsx` to `workout-tab.test.tsx` — the tab
   now needs a session and a database.
9. **Typed-routes footgun, root cause:** running Jest rewrites the gitignored
   `.expo/types/router.d.ts` with a route list missing the auth and new routes; `expo lint` does
   not. Run `tsc` after regenerating with `expo start` and before Jest (recorded in DEFERRED).

## Review (mattpocock-skills:code-review, Standards + Spec axes)

- **Fixed:** Workout tab kept an old error after a successful refresh; the saved-workout screen
  could show the previous workout while a new id loaded (now keyed by id, no setState in the
  effect); entry-card double-taps (deviation 6); the duplicated details line, set count and
  discard alert (moved to `format.ts` / `confirmDiscardWorkout.ts`); an unused `exercises` prop
  on `ExercisePicker` (speculative, removed); `seal` renamed `endWorkout`; disabled icon opacity
  matched to Button's.
- **Left as is (judgement calls):** `leave()` / `back()` are the same two-line
  "back, or the Workout tab" in two screens; the 48 px set-number column and 18 px icon size are
  literals beside the theme tokens; `listPastWorkouts`' `limit` parameter (tests use it); queries
  that select sets/entries by ids already obtained from a `user_id`-filtered query.
