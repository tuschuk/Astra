# custom-exercises (B31)

Covers **LIB-5** (custom exercises become private cards with the same data — whole). Depends on
B29 (library filters + detail screen) and B07 (device store + sync engine).

Step scope: create, edit and delete a private exercise (`owner_id`, synced; RLS already isolates
it); it appears in the library and logger and collects history and PRs.
Step DoD: **another user cannot read it through the API.**

## What exists (verified before planning)

Server (`backend/supabase/migrations/…_training.sql`, `…_exercises_slug.sql`,
`…_fix_exercise_delete.sql`, `…_personal_records.sql`, `…_sync_tombstones.sql`):

- `public.exercises` already carries `owner_id uuid references profiles on delete cascade`,
  `exercises_owner_idx`, and **all four policies**: select (`owner_id is null or owner_id =
  auth.uid()`), insert, update, **and delete** (the handoff asked to verify the delete policy —
  it exists, training.sql lines 68–71). Customs must have `slug` **null**
  (`exercises_slug_for_library_only`); `name` has a server CHECK of 1–80 characters.
- `workout_exercises.exercise_id` is nullable with **`on delete set null`** — deleting an
  exercise orphans history slots rather than blocking or cascading them.
- `personal_records.exercise_id` is **`on delete cascade`** — deleting an exercise destroys its
  PR rows on the server.
- `sync_tombstones` covers **only** `workouts` and `personal_records` (CHECK on `tbl`; the
  trigger reads `old.user_id`, which `exercises` doesn't even have). There is **no channel that
  tells another device an exercise row stopped existing.**

Device (`frontend/src/db/`, `frontend/src/sync/`):

- The local `exercises` mirror has every server column including `owner_id` and `slug` (V1).
  `ExerciseRow` is typed in `dao.ts`; `writeLocal('exercises', …)` already works and already
  refuses `owner_id null` rows. `exercises` is first in `SYNC_ORDER`; push upserts and deletes
  are generic over `SyncedTable`; pull (`pullStandalone('exercises', …)`) brings every exercise
  RLS lets the user see — customs sync down today without any new code.
- The transport is `TABLE_COLUMNS`-driven (`columnsOf`), so a new column added there travels in
  both directions with no transport change.
- Ids: library rows use `libraryExerciseId(slug)` (uuidv5); new rows mint v4 via `lib/ids.ts`
  (`newUuid`, expo-crypto) — the B08 pattern.

UI:

- The Library tab (`app/(tabs)/library.tsx`) reads the **bundled catalog**, not `astra.db`
  (recorded gap, unchanged by this step). The logger's `ExercisePicker` also searches
  `ALL_EXERCISES` (bundled) — the handoff's "verify" is answered: it does **not** read the
  device table. Both logging screens map a pick to a device id with
  `libraryExerciseId(slug)` and call `store.addExercise(id)`.
- The detail route `app/exercise/[id].tsx` resolves **catalog slugs only**; unknown id → "not in
  the library" state. `ExerciseHistorySection` takes any device exercise id and draws PRs +
  sessions; `workout/history.ts` (`exerciseInfo`), `analysis/analysis.ts` and
  `workout/activeWorkout.ts` already read exercise names/existence from the device table
  filtered by `(owner_id is null or owner_id = ?)` — customs work there the moment the row
  exists. PR detection (B13) keys on exercise id and needs nothing.

## The one real decision: what "delete" does

The handoff assigns this step the choice ("decide delete vs soft-delete given
`workout_exercises` rows that reference the custom"). **Decision: delete is a soft delete** — a
`deleted_at` stamp on the row, synced like any other edit. Reasoning, so nobody relitigates it:

Hard delete is the path that looks already-built (delete policy, `DELETE_PASSES`,
`deleteLocalRowsTx`) but it hides three wedges and a UX loss:

1. **Queue wedge via PRs.** Finish a workout that sets a PR on a custom, then delete the custom
   before sync: the push sends deletes first, the server cascades the PR rows away, and the
   still-queued PR **upsert** then hits a foreign-key violation — the push stops on failure, so
   the queue is wedged forever (the B07 known-limit class, but *caused* by our own UI).
2. **Queue wedge via slots.** The server sets `workout_exercises.exercise_id` null; the device
   mirror would not (no local FK on `exercise_id`). Any later edit of an old workout re-pushes
   its slots with the dangling id — foreign-key violation, same permanent wedge.
3. **No cross-device story.** Exercises have no tombstones, so a deleted custom survives
   forever on a second device (and can be logged against, re-triggering wedge 2 from there).
   Closing that means widening `sync_tombstones`' CHECK, a second trigger function keyed on
   `owner_id`, and a new client tombstone arm — real machinery for a row type the launch
   reality (one phone per lifter) barely exercises.
4. **History loses its name.** Every past session of the movement reads "Deleted exercise",
   which is why B09 deferred an exercise-name snapshot on `workout_exercises` "to the first
   step that makes an exercise deletable" — hard delete drags that whole column (server +
   device + logger write path + every reader) into this step.

Soft delete is one nullable column and zero new machinery: the delete is an **update**, so it
rides the existing upsert push, the existing pull, and the existing conflict rules; it
propagates to other devices for free; history and PR rows keep a live name forever; nothing can
dangle; and the **name snapshot goes back to `docs/DEFERRED.md`** (its only remaining triggers
are account deletion — where the whole account's data goes anyway — and a founder retiring a
library exercise, which is a content-migration event, not an app path). The lifter-visible
behaviour is exactly "delete": the exercise vanishes from the library and the picker
everywhere. What they keep is their logged history — which is the right product behaviour for a
training log (the same reason `on delete set null` was chosen server-side: "a user's logged
sets are never collateral damage").

Honest costs, accepted and recorded: the row (a name, two labels) persists until account
deletion; a deleted custom's PRs still exist and still show in the profile's PR list (they are
real lifts; hiding them is a product call for later); there is no undelete UI (re-creating the
name is a new row — fine).

## Approach

### 1. Migration — server and device

**Server** (new migration, `backend/supabase/migrations/<ts>_exercises_soft_delete.sql`;
builder applies via MCP and renames to the version Supabase records, the B11 discipline):

```sql
alter table public.exercises
  add column deleted_at timestamptz;

-- Only a user's custom can be deleted; the shared library can never carry the stamp.
alter table public.exercises
  add constraint exercises_deleted_customs_only
    check (deleted_at is null or owner_id is not null);
```

No policy changes: the owner-update policy already lets exactly the right person set the stamp,
and the select policy keeps the row readable to its owner (history needs it) and invisible to
everyone else. RLS is enforced in the database, never client-side — unchanged.

**Device** (`frontend/src/db/schema.ts`, version 11):

```sql
alter table exercises add column deleted_at text;
```

`ExerciseRow` gains `deleted_at: string | null`; `TABLE_COLUMNS.exercises` gains
`'deleted_at'` — which alone makes push and pull carry it (transport is column-table-driven).
The seed (`seedLocal.ts`) names its columns explicitly, so library rows keep `deleted_at` null
with no change beyond its insert column list, if any; the fake transport and sync tests gain
the column where they spell rows out.

### 2. One home for custom-exercise logic — `frontend/src/library/customExercises.ts`

All reads and writes of custom rows, so the deleted-filter can never be forgotten at a call
site:

- `createCustomExercise(db, userId, input)` — validates, mints `newUuid()`, writes via
  `writeLocal('exercises', …)` with `owner_id = userId`, `slug = null`, `deleted_at = null`.
- `updateCustomExercise(db, userId, id, input)` — reads the row, refuses if missing / not
  owned / deleted, writes the changed fields via `writeLocal`.
- `deleteCustomExercise(db, userId, id)` — same guards, then `writeLocal` with
  `deleted_at = now`. (An upsert outbox line — the server sees an update.)
- `listCustomExercises(db, userId)` — `owner_id = ? and deleted_at is null`, ordered by name.
- `getCustomExercise(db, userId, id)` — one live custom, or null.
- `filterCustomExercises(rows, { query, body, muscle, equipment })` — pure. Name match is a
  case-insensitive substring (customs have no aliases); `muscle` matches `primary_muscle`
  exactly; `equipment` matches exactly; **any active `body` region yields no customs** (they
  have no region — honest, not silently ignored).

Input shape: `{ name: string; equipment: Equipment | null; primaryMuscle: MuscleKey | null }`.
`primary_muscle` stores the `MuscleKey` key (`'chest'`), displayed through `MUSCLE_NAMES`;
`equipment` stores the catalog's `Equipment` string as-is. Free-text server columns, so no
migration is implied by the vocabulary — but constraining the form to the existing twelve
muscles and six equipment kinds is what lets the Library filters match customs at all.

Validation lives with the other field limits in **`@training-math` `limits.ts`** (the B12
precedent, one home — verified: `backend/supabase/functions/_shared/training-math/limits.ts`,
hand-mirrored CHECKs with code-point counting): add `MAX_EXERCISE_NAME_LENGTH = 80` and
`assertValidExerciseName(name)` (trimmed, 1–80 characters, counted the server's way like the
file's other text rules, mirroring `exercises.name`'s CHECK in `…_training.sql`), used by the
form before any write — the B07 poison-row lesson (the device repeats no server CHECK in SQL,
so the one UI write path validates first). `updateCustomExercise` refusing deleted rows is what
keeps an edit from ever resurrecting a deleted custom (writeLocal is an upsert); pinned in a
test.

### 3. Library tab — "Your exercises" (`app/(tabs)/library.tsx`)

The smaller honest step the handoff names, not the long-deferred catalog→device switch:

- The screen gains `useAppDatabase()` + `useAuth()` (the `ExerciseHistorySection` pattern) and
  loads the lifter's customs with `useFocusEffect` (the repo's established refresh pattern —
  returning from the detail screen after a delete must drop the card) and again after the
  form's own create.
- Between the count line and the catalog cards: a **"Your exercises"** section — a header row
  (SectionLabel + a **"New exercise"** button, always visible so creation is discoverable at
  zero customs) and one card per custom matching the current search + filters
  (`filterCustomExercises`). Custom cards reuse the catalog card's layout with a "Custom" pill
  in place of the region dot; tapping opens `/exercise/<uuid>`.
- The catalog list, count line, chips and search behave exactly as today (their tests move only
  where the header grew).

### 4. Create / edit form — `components/library/CustomExerciseForm.tsx`

One modal component, two modes (create / edit), used by the Library tab (create) and the custom
detail screen (edit): name field (required, validated against the shared limit, save disabled
until valid), an equipment chip row (the six kinds, optional, tap-again clears — the B29 chip
pattern), a muscle chip row (the twelve, optional). Save calls the module's create/update;
Cancel discards. Works entirely offline (writes are local; sync carries them later).

### 5. Logger picker — customs in `ExercisePicker`

The picker's list becomes a union of catalog matches and the lifter's live customs (customs
after library matches, labelled by their equipment like library rows). Mechanics:

- `ExercisePicker` gains a `customExercises: readonly PickerExercise[]` prop (the two logging
  screens load them via the module; the picker stays a dumb component, as today).
- `onPick` hands back `{ deviceId: string; name: string }` instead of an `ExerciseDef` — the
  picker resolves `libraryExerciseId(slug)` for catalog rows and passes the uuid straight
  through for customs. Both callers (`app/active-workout.tsx`, `app/edit-workout/[id].tsx`)
  drop their own `libraryExerciseId` call and pass `picked.deviceId` to `store.addExercise`.
  (The store already validates the id exists in the device table with the owner filter —
  customs pass.)

### 6. The custom's card — `app/exercise/[id].tsx` grows a second branch

The route keeps its slug behaviour untouched. When `exerciseById(id)` finds nothing, the screen
now tries the device table (`getCustomExercise`) before giving up:

- **Found:** render the custom's card — name, "Custom" pill, equipment pill, muscle label
  (via `MUSCLE_NAMES`), then **Edit** and **Delete** buttons, then the same "Your history"
  `ExerciseHistorySection` with `exerciseId =` the row's uuid. No coaching steps or tips —
  there is nothing authored to show, and inventing content would violate the no-AI rule.
  Edit opens the form prefilled; Delete confirms (the `confirmDeleteWorkout` Alert pattern)
  then soft-deletes and navigates back.
- **Not found** (stale link, someone else's uuid — the device read is owner-filtered): the
  existing "not in the library" state.

This settles B30's open note: `exercise-history/[exerciseId]` stays the logger's deep link for
every exercise, and a custom's *card* is the detail route keyed by uuid — the two routes do not
collapse. No new route file, so no typed-routes churn (the builder still follows the recorded
check order: `npx expo start --offline` → tsc → lint → Jest).

### 7. Sync — nothing new to build, one behaviour to pin

Create/edit/delete are `writeLocal` upserts on a `SyncedTable`; the existing engine pushes them
(exercises first in `SYNC_ORDER`), the existing pull brings them to other devices, the
pending-local-shadow rule protects offline edits. Tests pin: a custom created offline lands on
the (fake) server exactly once after reconnect; a soft delete pushed up arrives as an update
with `deleted_at` set; a pulled soft-deleted row disappears from `listCustomExercises`.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<ts>_exercises_soft_delete.sql` | new — `deleted_at` + customs-only CHECK |
| `frontend/src/db/schema.ts` | V11 device migration; schema test |
| `frontend/src/db/dao.ts` | `ExerciseRow.deleted_at`; `TABLE_COLUMNS.exercises` |
| `backend/supabase/functions/_shared/training-math/limits.ts` (+ test) | exercise-name limit (mirrors the server CHECK, same-commit rule) |
| `frontend/src/library/customExercises.ts` (+ `.test.ts`) | new — §2, the one home |
| `frontend/src/components/library/CustomExerciseForm.tsx` (+ test) | new — §4 |
| `frontend/src/app/(tabs)/library.tsx` | §3 — section, button, DB wiring |
| `frontend/src/components/workout/ExercisePicker.tsx` (+ test) | §5 — customs prop, `onPick` payload |
| `frontend/src/app/active-workout.tsx`, `app/edit-workout/[id].tsx` | §5 — new pick payload |
| `frontend/src/app/exercise/[id].tsx` | §6 — custom branch, Edit/Delete |
| `frontend/src/__tests__/screens.test.tsx`, `exercise-detail.test.tsx`, sync/fake-transport tests | updated for the above |
| `docs/DEFERRED.md` | name-snapshot item returned with the soft-delete rationale; B31 follow-ups |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | Document step — column; create/edit/delete paths, customs in picker/library/detail |

## Data model impact

One nullable column + CHECK on `public.exercises` (server), one device migration (V11). No new
tables, no policy changes, no new indexes (the owner index already serves every custom read).

## How each definition of done becomes observably true

- **Step DoD ("another user cannot read it through the API")** — the policies are already live;
  this step's Gate 2 **live probe** (the B27/B28 two-throwaway-users precedent) names it:
  as user A, insert a custom over PostgREST; as user B, (a) `GET /rest/v1/exercises?id=eq.<id>`
  → `[]`, (b) the unfiltered exercises select → library + B's own rows only, (c) `PATCH` /
  `DELETE` on A's row → 0 rows affected. If no user token is at hand, the same three checks run
  in SQL as two simulated users (`request.jwt.claims`, the way the B02/B27 probes did) — the
  policies under test are identical either way. Also pinned structurally in Jest: the create path can
  only write `owner_id = userId` (no code path writes anyone else's id).
- **LIB-5 "gets a card"** — `exercise-detail` tests: a device custom renders name, pills,
  Edit/Delete and the history section at its uuid; Library tests: the custom appears under
  "Your exercises", matches search/filters, opens the card.
- **LIB-5 "collects history/PRs"** — already true by construction (id-keyed PR detection and
  `ExerciseHistorySection`); pinned by a test that logs sets against a custom id and sees its
  sessions and PR line on the card — and nothing about the paths special-cases library ids.
- **LIB-5 "invisible to other users"** — the live probe above; plus RLS is already exercised in
  the B02-series SQL probes.
- **Create/edit/delete offline** — module + sync tests: all three succeed with a throwing
  transport and land exactly once after it heals (the B07 DoD pattern).

Device verification (Built → Done, Tristen): create a custom in airplane mode, log it, see it
in the picker and library, its card with history/PRs; edit the name; delete it → gone from
library and picker, history still names it; reconnect → row in Supabase with `deleted_at` set.

## Out of scope (this branch)

- **Muscle-map shading for customs** — the map consumes per-pattern intensity tables; a single
  `primary_muscle` label is not an intensity table. The B19 note stands; a later LIB step can
  grow the authoring. (The label still powers the Library muscle filter.)
- **Creating a custom from inside the picker** — valuable mid-workout, but it drags the form
  into the logger; deferred, noted in DEFERRED.
- **Undelete / permanent purge UI**; hiding a deleted custom's PRs from the profile list —
  product calls for later, recorded above.
- **Exercise-name snapshot on `workout_exercises`** — returned to DEFERRED (soft delete removes
  its trigger; see the decision section).
- **Library tab reading the catalog from `astra.db`** — the recorded gap stays; this step adds
  a device-read *section*, it does not move the catalog.
- **Exercise tombstones** — not needed under soft delete.

## Risks a reviewer should weigh

1. **The soft-delete filter is a scattered invariant by nature.** Every surface that lists
   exercises must exclude `deleted_at` rows. Mitigation: no screen queries the table directly —
   `customExercises.ts` is the single read home and the only new read sites are the three
   surfaces this step builds. The pre-existing readers (`exerciseInfo`, analysis names,
   `addExercise`'s existence check) deliberately do **not** filter: history must keep naming
   deleted customs, and that asymmetry is documented in the module comment.
2. **The picker payload change touches both logging screens.** `onPick` moving from
   `ExerciseDef` to `{ deviceId, name }` is a small refactor across three files with existing
   tests; a slip would mis-key new slots. Mitigated by the store's own id-existence check
   (refuses an unknown id) and the picker tests asserting the exact id for both row kinds.
3. **A new synced column ripples through test fakes.** `TABLE_COLUMNS` drives the real
   transport, but the fake transport and several sync/screen tests spell exercise rows out and
   will need the column added; a missed one fails loudly (good) but could tempt a lazy `as`
   cast (bad). The builder should let the `ExerciseRow` type drive the fixes.

## Grilling record (settled decisions)

Conducted by the planner session (autonomous pipeline; the session plays both sides at full
severity per CLAUDE.md "Autonomous sessions"). What changed or was settled:

- **"Soft delete isn't what the scope word 'delete' says."** The handoff explicitly hands this
  step the delete-vs-soft-delete decision; the lifter-visible behaviour is delete. The wedge
  analysis (PR-cascade FK violation against a queued PR upsert; dangling slot ids on re-push;
  no tombstone channel) is concrete, not hypothetical — each is reachable from the UI this
  step ships in one offline session. Settled: soft delete, reasons recorded in the plan body.
- **"Why not hard delete + local cascade mirror (null slots, drop PR rows/lines)?"** It works
  single-device but leaves wedge 3 (cross-device) open, loses history names (dragging the
  snapshot column in), and is ~4× the moving parts for strictly worse product behaviour.
  Rejected on cost *and* outcome, not cost alone.
- **"Is the `deleted_at` CHECK speculative?"** No — it encodes "the shared library can never be
  deleted through any path", the same invariant the slug CHECK encodes for identity. One line,
  enforced where RLS lives.
- **"Is the muscle/equipment picker scope creep?"** It is what makes LIB-5's "same data" and
  the Library's filters true for customs, using vocabulary that already exists
  (`MuscleKey`, `Equipment`) and free-text columns that already exist. A name-only form was
  the draft; it was widened to these two optional fields *because* the filters otherwise
  silently never match customs. Intensity tables / coaching content stay out.
- **"Should the Library section search/filter customs or just list them?"** Filter them — an
  unfiltered section contradicts the screen's whole contract. The region rule (customs never
  match an active region chip) was chosen over "always show" as the honest reading, and is
  pinned in a test.
- **"Why does `onPick` change shape instead of adding a second callback?"** Two callbacks
  would fork the add-exercise path in both logging screens; one payload with the device id
  removes the screens' uuidv5 knowledge entirely (they shouldn't have had it — the picker is
  the thing that knows what was picked).
- **"Does the custom card belong on `exercise/[id]` or `exercise-history/[exerciseId]`?"**
  The detail route — LIB-5 says *card*, and the card is where Edit/Delete and the pills live;
  the history screen stays the logger's thin deep link (B30's settled reading). The two
  resolution domains (slug, uuid) cannot collide: slugs have no hyphens, and the device read
  is attempted only after the catalog misses.
- **"What stops a custom named 'Bench Press' confusing PRs/history with the library row?"**
  Nothing needs to — identity is the id everywhere (PR books, history, picker); names are
  display only. Duplicate names are allowed, as they are between a user's own customs.
- **"New dependency?"** None. **New route?** None. **Server function changes?** None.
- **"A draft workout can reference a custom the lifter deletes mid-workout."** A settled
  non-issue under soft delete: the row still exists, name resolution doesn't filter deleted
  rows, finish and the server foreign keys succeed. (Under hard delete this was wedge 2 —
  another point for soft.)
- **"An app version without V11 keeps showing deleted customs"** (its `TABLE_COLUMNS` never
  selects `deleted_at`). Accepted: nothing has shipped; the only installs are dev builds that
  update with the code. Not worth a defensive default.
- **"How does the Library tab hear about a delete made on the detail screen?"**
  `useFocusEffect` — the pattern 23 screens already use — rather than a shared store or event;
  customs are a tiny read and the tab refocus is the exact moment the list can have changed.
