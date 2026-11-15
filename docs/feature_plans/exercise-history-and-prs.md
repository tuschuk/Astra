# exercise-history-and-prs — B13: PR persistence, the fuller "last time" panel, per-exercise history

**Branch:** `exercise-history-and-prs` (from `main`)
**Build step:** B13 — covers **LOG-4** (full per-exercise history and automatic PR detection;
classification math shipped in B06, this step ships persistence + the history screen) and
**LOG-5** ("last time" while logging; the one-liner shipped in B09, this step ships the fuller
panel with PRs).
**Depends on:** B09 (logger screens, `history.ts` read model) and B06 (`@training-math`:
`classifyPrs`, `recordsFromSets`, `PrKind`), and through them B07 (device SQLite + sync) and
B08 (the active-workout store, whose `finish` this step extends).

## Step definition of done (from the Build order)

A qualifying set flags the right PR kind; a volume-only improvement never does; the previous
session's sets show while logging.

## Scope check

The step scope is right as written and this plan stays inside it. One reading is settled up
front: "PR detection on finish" means detection runs when a workout is **finished**, not live
per logged set — a mid-set badge would be detection-before-finish and is not built here.
Standing inputs honored: B10 settled **no separate rep-record book for bodyweight movements**
(the three existing `PrKind`s only — a weightless set is never a PR candidate; Tristen can
overrule before merge); B06's G9 settled that a SQL enum matching `PrKind` is required schema
vocabulary, not a forbidden mirrored copy of math.

## What this step builds

1. **`personal_records` on the server** — one row per *record book* (user × exercise × kind,
   plus the rep count for rep-max books): the current best only, not an event log. Owner-only
   RLS. A matching mirror table on the device (schema V4) synced through the existing
   outbox/pull machinery.
2. **PR detection on finish** — `finish()` recomputes the finished exercises' record books from
   full local history through `@training-math` and writes improved rows **in the same
   transaction** as the workout tree, so a killed app can never sync a workout while losing its
   PRs. Rows are client-computed first and synced up, per the step scope.
3. **The fuller "last time" panel** (LOG-5) — the entry card's last-time line grows into a small
   panel: previous session's sets (as today) plus the lifter's current PRs for that exercise and
   a link to the history screen.
4. **Per-exercise history screen** (LOG-4) — every past session of one exercise with its sets,
   newest first, with current PRs at the top. Reads local SQLite only — fully offline.
5. **PR flags on the saved workout** — sets that are the source of a current record get a small
   PR badge (kind-labelled) on the saved-workout screen, which is where finish lands. This is
   what makes "flags a PR of the right type" *observable* on screen, not only in a table.

## Data model

### Server migration — `backend/supabase/migrations/<version>_personal_records.sql`

The builder applies it live with `mcp__supabase__apply_migration`, then renames the file to the
version Supabase recorded (`list_migrations`), per the pipeline convention.

```sql
create type public.pr_kind as enum ('true1rm', 'repMax', 'e1rm');  -- exactly PrKind's strings

create table public.personal_records (
  id            uuid primary key,          -- client-generated, deterministic (see ids below)
  user_id       uuid not null references public.profiles (id) on delete cascade,
  exercise_id   uuid not null references public.exercises (id) on delete cascade,
  kind          public.pr_kind not null,
  -- Which rep count's book, for rep maxes only (2 and up; a single is the true-1RM book, B06 G8).
  reps          smallint check (reps >= 2),
  value_kg      numeric(8, 3) not null check (value_kg > 0),
  source_set_id uuid not null references public.sets (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((kind = 'repMax') = (reps is not null))
);

create index personal_records_user_exercise_idx
  on public.personal_records (user_id, exercise_id);
-- One row per book. Deterministic ids make this unhittable by correct clients; it documents
-- and enforces the invariant against buggy ones. coalesce because reps is null off-repMax.
create unique index personal_records_book_idx
  on public.personal_records (user_id, exercise_id, kind, coalesce(reps, 0));
```

Plus: `moddatetime` trigger on `updated_at` (same as every synced table); RLS enabled with
owner-only `select` / `insert` / `update` / `delete` (`user_id = (select auth.uid())`), and the
write policies additionally require `private.owns_set(source_set_id)` — a new
`private.`-schema SECURITY DEFINER helper (`exists (select 1 from sets join workout_exercises …
where sets.id = sid and private.owns_workout(workout_id))`) so a row can never cite someone
else's set as proof. Owner-only read matches the step scope ("owner RLS"); when B25 shows PRs
on public profiles it widens the select policy then, deliberately not now.

**Keep-best trigger (the server-side backstop):** a `before update` trigger on
`personal_records` that, when the incoming `value_kg` is **lower** than the stored one, keeps
the stored `value_kg`, `reps`-book identity and `source_set_id` (the row still gets a fresh
`updated_at` from `moddatetime`, so other devices pull the correction down). It must **never
raise** — a raised error would make the client's push fail forever (the B07 poison-row trap);
silently keeping the best lets the upsert succeed and the next pull repair the device. Why it
exists: the client's monotonic guard (below) only consults *local* rows, so a fresh device that
finishes a workout before its first pull completes would push a lower value over the server's
record — the one scenario deterministic ids + LWW cannot survive alone. In B13 "never lower" is
correct by definition (no edit/delete path exists). **B14 must rework this trigger** when it
builds legitimate demotion (e.g. drop it in favor of recompute through a server function, or
gate lowering on a flag) — recorded here and in that step's dependency on this one.

**FK choices:** `source_set_id … on delete cascade` — a record is its proof; when B14 deletes
the set (or its workout, cascading), the server-side row goes with it and B14's recompute
promotes the next best (exactly B14's stated DoD). `exercise_id … on delete cascade` — PRs for
a deleted custom exercise are meaningless. No delete path exists until B14, so neither fires
in B13.

**Why current-best rows, not an event log:** the scope's column list (user, exercise, kind,
value, source set) describes current bests; B14's "promote the next best" and YOU-3/B25/B30's
"PRs by exercise" all want current bests; an append-only PR-event feed is speculative until a
feature reads it (B18's "new PRs in this session" diffs before/after itself).

### Deterministic row ids

`id = uuidv5(PR_RECORD_NAMESPACE, `${userId}:${exerciseId}:${kind}:${reps ?? ''}`)` using the
repo's one `uuidv5` implementation (`frontend/src/library/uuidv5.ts`, which already exports the
generic function). `PR_RECORD_NAMESPACE` is a new fixed UUID constant beside the PR persistence
code. Why: the row's identity *is* the book. Two devices that improve the same book offline
compute the same id, so their pushes upsert the same row (last-write-wins, the B07 convention)
instead of colliding on the unique index — a random-id design would make that collision a 4xx
the push retries forever (the B07 poison-row risk).

The recipe (and `uuidv5`) lives in `frontend/` even though a future *server-side* PR writer
would need it from Deno, where the deploy bundler can't reach (the B06 home argument). Settled:
no server-side PR write exists or is planned — B14's recompute is client-side, B18 only reads —
so moving code for a hypothetical consumer loses to "add nothing speculative". The tripwire is
recorded: the day a server function must write PR rows, `uuidv5` and this recipe move to
`_shared` first.

### Device mirror — schema V4 (`frontend/src/db/schema.ts`)

```sql
create table personal_records (
  id            text primary key not null,
  user_id       text not null,
  exercise_id   text not null,
  kind          text not null,
  reps          integer,
  value_kg      real not null,
  source_set_id text not null,
  created_at    text not null,
  updated_at    text not null
);
create index personal_records_user_exercise_idx on personal_records (user_id, exercise_id);
```

No device-side FKs (matches the mirror's precedent: only the workout tree's internal cascades
are declared) and no CHECKs (server-only, per the B07 rule). `MIGRATIONS` gains V4;
`SCHEMA_VERSION` becomes 4.

## PR detection on finish — the algorithm

New module `frontend/src/workout/prs.ts` (orchestration only — every rule about *what counts as
a PR* stays in `@training-math`; this module runs queries and builds rows):

On `finish()`, for each distinct exercise in the finishing workout (entries whose
`exercise_id` is null — a deleted custom, unreachable until B31 — are skipped; no book to
attribute):

1. **Fold full local history** — every set of the user's **finished** workouts containing that
   exercise (the `ended_at is not null` filter automatically excludes both the workout being
   finished, which is still a draft at read time, and any leftover stray drafts — the B08
   deferral), **then the finishing workout's own sets appended from the store's snapshot in
   logged order** — through the math module's source-tracking fold (below). Result: the
   complete record books, each with the set that holds it. A builder note, because both wrong
   variants are one `where` clause away: querying `ended_at is not null` *without* appending
   the snapshot loses today's sets; querying all workouts double-counts them and picks up stray
   drafts.
2. **Read the stored `personal_records` rows** for (user, exercise).
3. **Upsert only improvements**: a book whose folded value beats the stored row's (or that has
   no stored row) becomes a row write; a fold result *below* a stored value is never written in
   B13. This monotonic rule is load-bearing three ways: (a) it **seeds** books from pre-B13
   history the first time an exercise is finished after this ships (sourced from the historical
   set, so old dev data doesn't flag today's lighter set as a PR); (b) it makes a fresh device
   with a not-yet-complete pull unable to *lower* server records; (c) two devices improving the
   same book converge on the max regardless of push order. The one hole — a fresh device with
   *no* local row and incomplete pull — is what the server-side keep-best trigger closes (see
   Data model). B14's edit/delete recompute is the step that gets a force-write-downward mode;
   noted there, not built here.

The improved rows are handed to `finish()`, which writes workout tree + PR rows + their outbox
lines in **one transaction** (the DAO's `writeLocalTree` grows an optional `personal_records`
row list; `rootWorkoutIds` already returns `[]` for non-tree tables, so no touch-the-root — a
PR row has no parent workout and syncs on its own `updated_at`). Reads (steps 1–2) run just
before the transaction inside the store's serialized `mutate`, where nothing else can write.

**Value rounding:** folded values are rounded to 3 decimals (the column's scale) before compare
and write — via `roundToIncrement(value, 0.001)` from `@training-math` — so a pulled
`numeric(8,3)` value never looks "beaten" by its own unrounded float on the next finish.

### The math-module addition (its one home)

`recordsFromSets` folds a history but discards *which set* holds each record — persistence
needs the source. `prs.ts` **in `@training-math`** gains a source-tracking fold, e.g.
`recordBooks<Ref>(sets: readonly (PrCandidateSet & { ref: Ref })[]): RecordBook<Ref>[]` with
`RecordBook = { kind; reps?; valueKg; ref }`, reusing the existing `classifyPrs` internally so
there is exactly one set of PR rules; `recordsFromSets` is reimplemented over it (one fold in
the repo). Ties keep the earlier set (the ε rule already says a tie never beats). Tests beside
it, as the module's mirror rule requires. Pure TS, Deno-clean, like everything else there.

Writing this in the app instead would mean re-implementing "apply events to records" outside
the math module — the mirrored-copy bug by another name.

## Reads and screens

- **`currentPrs(db, userId, exerciseId)`** (in `frontend/src/workout/prs.ts`): the stored rows
  for one exercise, parameterized, user-filtered (the B07 rule). The panel, the history screen
  and the saved-workout badges all read this one function.
- **`exerciseSessions(db, userId, exerciseId, limit = 50)`** (in
  `frontend/src/workout/history.ts`, beside its siblings): the user's finished workouts
  containing at least one logged set of the exercise, newest first, each with that exercise's
  sets in order — `lastSessionSets` generalized from "newest one" to "newest N". Limit 50 with
  no pagination machinery (the B09 precedent: `PAST_WORKOUT_LIMIT = 100`).
- **Entry card panel** (`EntryCard.tsx`): under the exercise name, the existing last-time line
  plus one muted PR line (current bests via `format.ts` helpers, weights through
  `displayWeight` in the user's unit — e.g. `PRs: 1RM 225 lb · e1RM 243.1 lb · 5RM 205 lb`) and
  a "History" link. Both read once on mount like the last-time line today; **stored records
  cannot change mid-workout** (detection runs only at finish), so no refresh machinery. An
  exercise with no rows shows no PR line — not an error state.
- **History screen** (`frontend/src/app/exercise-history/[exerciseId].tsx`, declared in the
  root stack's signed-in guard like `workout/[id]`): exercise name as title; a "Current PRs"
  block (same `format.ts` text); then the sessions list — date header per session, sets
  rendered with the existing set-formatting helpers (`formatSet`/drop-set grouping from B11
  stays honored). Reached from the entry card's History link; route tests live in
  `src/__tests__/` (expo-router registers `*.test.tsx` under `src/app/` as routes).
- **Saved-workout badges** (`workout/[id].tsx`): after loading the workout, load
  `currentPrs` for its exercises; a set whose id matches a record's `source_set_id` gets a
  small badge naming the kind (e.g. `PR · 5RM`). Right after finish these are exactly the PRs
  the session just earned; on older workouts a badge means "this set still holds the record",
  which is the honest reading of current-best rows.

## Sync wiring

All existing machinery, one more table:

- `dao.ts`: `PersonalRecordRow` (its `kind` typed as `PrKind` imported from `@training-math`),
  `RowByTable`, `TABLE_COLUMNS`, and `SYNC_ORDER` gains `personal_records` **after `sets`**
  (its FK target — parents before children holds). `writeLocalTree` accepts the optional PR
  rows (above).
- `transport.ts` + `supabaseTransport.ts` + the fake: `upsert` already takes any synced table;
  add `pullPersonalRecords(userId, after, limit)` (same shape as `pullWorkouts`; `numeric`
  columns arrive as numbers exactly as `sets.weight_kg` already does).
- `pull.ts`: third cursor (`pull_cursor:personal_records`), pulled after the workout trees
  (standalone pass, page loop identical to exercises'); `PullResult` gains the count. The
  no-overwrite-pending-changes and overlap rules apply unchanged.
- `push.ts`: the `pushed` record gains the key; `PUSH_PASSES` derives from `SYNC_ORDER`
  untouched. A PR row pushed in the same sync as its source set lands after it (table order),
  so the server FK is satisfied.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_personal_records.sql` | new — enum, table, indexes, `private.owns_set`, RLS, keep-best trigger (applied live, renamed to recorded version) |
| `backend/supabase/functions/_shared/training-math/prs.ts` (+ test) | edit — source-tracking `recordBooks` fold; `recordsFromSets` reimplemented over it |
| `backend/supabase/functions/_shared/training-math/index.ts` | edit — re-export the new fold and its types |
| `frontend/src/db/schema.ts` (+ test) | edit — V4 migration |
| `frontend/src/db/dao.ts` (+ test) | edit — `PersonalRecordRow`, `TABLE_COLUMNS`, `SYNC_ORDER`, `writeLocalTree` PR rows |
| `frontend/src/sync/transport.ts`, `supabaseTransport.ts`, `test-utils/fakeTransport.ts` | edit — `pullPersonalRecords`; fake serves PR rows |
| `frontend/src/sync/pull.ts`, `push.ts` (+ tests) | edit — third cursor + pull pass; result records |
| `frontend/src/workout/prs.ts` (+ test) | new — `PR_RECORD_NAMESPACE`, deterministic ids, recompute-on-finish row builder, `currentPrs` |
| `frontend/src/workout/activeWorkout.ts` (+ test) | edit — `finish()` computes PR rows, writes them atomically with the tree |
| `frontend/src/workout/history.ts` (+ test) | edit — `exerciseSessions` |
| `frontend/src/workout/format.ts` (+ test) | edit — PR text helpers (unit display via `displayWeight`) |
| `frontend/src/components/workout/EntryCard.tsx` (+ test) | edit — PR line + History link in the last-time panel |
| `frontend/src/app/exercise-history/[exerciseId].tsx` | new — the history screen |
| `frontend/src/app/workout/[id].tsx` | edit — PR badges on source sets |
| `frontend/src/app/_layout.tsx` | edit — declare the new route in the signed-in guard |
| `frontend/src/__tests__/exercise-history.test.tsx` (new), `saved-workout.test.tsx`, `logger-flow.test.tsx` | route + flow tests |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) — new table/enum/RLS; finish→PR path, panel, history screen |

Builder footgun (B06–B12 precedent): regenerate typed routes with `npx expo start --offline`
(~100 s) **before** `tsc --noEmit`, lint, then Jest — this step adds a route, so the stale
`.expo/types/router.d.ts` trap applies for certain.

## How each definition of done becomes observably true

- **Step DoD "a qualifying set flags the right PR kind"** — store test on the node driver:
  finish a workout with a heavier single → `personal_records` holds a `true1rm` row (and an
  `e1rm` row — distinct books, B06) with `source_set_id` = that set; a heavier 5 → `repMax`
  with `reps = 5`. The flow/route tests show the badge on the saved workout — on screen, not
  just in SQL.
- **Step DoD "a volume-only improvement never does"** — finishing a session repeating the
  stored best weight × reps for more sets writes **no** rows (asserted on the table, end to
  end, on top of B06's classifier-level proof).
- **Step DoD "the previous session's sets show while logging"** — held since B09 (entry-card
  test); the panel test re-asserts it alongside the PR line.
- **LOG-4** — history screen renders every past session of a fixture exercise with its sets;
  detection proofs above; persistence survives relaunch by construction (SQLite) and syncs
  (push/pull tests with the fake transport: PR rows land exactly once, retry-safe; a pull
  brings another device's rows down).
- **LOG-5** — the panel shows last-time sets *and* current PRs per exercise in the active
  workout; Jest-proven; the on-device look remains Tristen's Built→Done check.

## Testing (beyond the inline notes above)

All Jest, node SQLite driver, fake transport — never the real Supabase project. Key fixtures:
first-ever set flags (empty books); warm-up-only session writes nothing; weightless
(bodyweight) sets write nothing; seeding — pre-B13 history with a 100 kg best, today 80 kg →
rows appear valued 100 sourced from the *historical* set, and no badge claims today's set;
monotonic guard — stored 100, fold says 90 → no write; deterministic id stability (same book →
same id, different books → different ids); fold source-tracking ties keep the earlier set;
`exerciseSessions` excludes drafts and other users; migration V4 upgrades a V3 file preserving
rows. The live migration gets probed at Gate 2 (insert as two users, RLS cross-checks,
`owns_set` refusal, and the keep-best trigger: an update with a lower `value_kg` keeps the
stored value yet succeeds), per pipeline convention.

## Out of scope (and where it lands)

- **Recompute after edit/delete** (demotion, promotion, force-write-down) — B14, which extends
  `prs.ts`'s monotonic rule with a forced mode, reuses the same fold, **and must rework the
  keep-best trigger**, which otherwise silently refuses B14's legitimate demotions.
- **Server-side recomputation / analysis "new PRs"** — B18's edge function; the server stays a
  passive store of client-computed rows until then.
- **PRs on profiles (YOU-3/B25), exercise cards (LIB-4/B30), Tool Kit prefill (TK-6/B43),
  feed badges (B20)** — they read this table later; the select policy widens in B25.
- **Live mid-set PR detection / in-logger badges** — detection is "on finish" per the scope.
- **Bodyweight rep-record books** — settled out in B10 (standing input; Tristen can overrule).
- **PR-event history log** — speculative until a reader exists.
- **Pagination of the history screen** — limit 50, the B09 precedent.

## Risks a reviewer should weigh

1. **`finish()` grows a second responsibility.** The workout tree and PR rows commit in one
   transaction via an extended `writeLocalTree`. Wrong wiring here could break the NFR-3
   kill-safety guarantee that B08's tests pin — those tests must stay green untouched, and the
   extension is additive (an optional row list, no change to the tree path).
2. **Monotonic upsert plus the keep-best trigger are the correctness linchpin.** Seeding,
   multi-device convergence and partial-pull safety hang on "never write a lower value" at two
   layers: the client guard (which a fresh device with no local row walks straight past) and
   the server trigger (which closes exactly that hole, and must fail *silently* or it becomes
   a poison row that wedges the push forever). The tests and the Gate 2 probe pin both layers;
   a reviewer should check the trigger keeps the source columns in step with the kept value,
   not just the number.
3. **The unique index vs. upsert-by-id.** A buggy client that generated a *different* id for an
   existing book would hit the unique index and wedge its own push (poison row, the known B07
   limit). Deterministic ids make this unreachable from this codebase; the index is kept as the
   server-side invariant anyway. Reviewer should confirm the id recipe is stable (string
   building, no locale/float formatting surprises).

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session (headless: the planner worked the
question tree at full severity and verified every checkable claim in the repo; Gate 1 is where
Tristen overrules). Questions that changed or sharpened the plan:

- **"Current-best rows or an event log?"** Current bests (argument in Data model). The scope's
  own column list settles it; an event log is speculative with no reader.
- **"Random ids like workouts, or deterministic?"** Deterministic uuidv5 — the only design in
  which the unique-book invariant and idempotent upsert-by-id cannot collide (Risk 3). Reuses
  the repo's one uuidv5 home.
- **"Where does seeding pre-B13 history happen?"** Nowhere special — the recompute-from-full-
  history fold *is* the seeder, the first time an exercise is finished. No backfill job, no
  upgrade hook. Gap accepted: an exercise's PR line is empty until its first post-B13 finish —
  at launch there are no pre-B13 users, so this only affects dev data.
- **"Why recompute from full history every finish instead of classifying against stored
  rows?"** Self-healing (a lost write or pre-B13 history is repaired on the next finish of that
  exercise) for the price of one indexed local query per finished exercise — tens to hundreds
  of rows. Classify-against-stored would be faster and permanently wrong after any gap.
- **"Can a recompute on a fresh device wipe server records?"** This was the grilling's
  sharpest catch, in two stages. First pass: the client monotonic guard. Second pass found the
  hole in the first: a fresh device with *no local row yet* (sign-in, finish a workout before
  the first pull completes) walks straight past a guard that compares against local rows, and
  pushes a lower value onto the deterministic id. Hence the server keep-best trigger — silent,
  never raising (a raise would be a forever-failing push, the B07 poison-row trap), with the
  pull bringing the kept value back to the device. Correct by definition in B13; B14 reworks it.
- **"Where exactly do 'today's sets' come from in the fold, given the workout is still a draft
  at read time?"** From the store's snapshot, appended after the finished-history query — the
  `ended_at is not null` filter alone would lose them, and an unfiltered query would
  double-count them and pick up stray drafts. Spelled out in the algorithm because both wrong
  variants are one `where` clause away.
- **"The id recipe is in `frontend/` — doesn't the B06 bundler argument demand `_shared`?"**
  Only once a server-side writer exists, and none does or is planned (B14 recomputes on the
  client; B18 reads). "Add nothing speculative" wins; the tripwire for moving it is recorded in
  the ids section.
- **"A badge on an old workout disappears when the record is beaten — is that dishonest?"** No:
  current-best rows can only honestly badge "this set still holds the record". Right after
  finish — the DoD's moment — the badges are exactly the session's new PRs. A permanent
  "was a PR when logged" marker needs the event log this plan deliberately doesn't build.
- **"Does the fold belong in the app or the math module?"** Math module — tracking sources is
  record-book *semantics*; an app-side re-implementation of "apply events to records" is the
  mirrored copy CLAUDE.md forbids. `recordsFromSets` is rebuilt over the new fold so one fold
  exists.
- **"Same transaction as finish, or write-after?"** Same transaction. The crash window of a
  second transaction is small but the fix is one optional parameter on `writeLocalTree`; a
  synced workout with silently missing PR rows would fail the step DoD unobservably.
- **"Value rounding — why 3 decimals in the app?"** `numeric(8,3)` rounds on the server; an
  unrounded local float would "beat" its own pulled value by ~1e-4 forever, rewriting rows on
  every finish. Rounding through `roundToIncrement` keeps the math in the math module.
- **"Owner-only select vs. B25's public profile PRs?"** Owner-only now — the step scope says
  owner RLS; widening visibility is a product decision B25 makes with the profile privacy
  model in hand (PR values derive from workouts, which already have visibility settings B25
  must honor).
- **"Why `on delete cascade` on `source_set_id` instead of `set null`?"** `set null` keeps a
  value whose proof is gone — a stale claim until recompute; cascade deletes the claim, and
  B14's recompute-promote (its literal DoD) restores the next best. Until B14 no delete path
  exists, so the choice costs nothing now and matches B14's plan.
- **"Does the panel need refresh machinery?"** No — stored records change only at finish, and
  the panel lives in the pre-finish screen. Read-once-on-mount, like the last-time line.
- **Scope verdict:** right as written. The saved-workout badge is the minimal on-screen surface
  that makes "flags a PR" observable (the DoD's own wording) and is read-only over this step's
  table — included; everything else that *reads* PRs stays with its own step.

## Build deviations (builder run, Nov 14, 2026)

1. **Migration version:** applied live as `personal_records`. Supabase recorded
   `20261115035806`, and the file is named to match. The builder ran a Gate-2-style live probe in
   one rolled-back DO block, with synthetic users and nothing left behind:
   - An insert by the owner was accepted.
   - Citing another user's set was refused (42501).
   - Inserting as another user was refused (42501).
   - A second row for the same book was refused (23505).
   - A repMax row without reps was refused (23514).
   - A lower upsert kept value 100 and the original source set.
   - A higher upsert took 120.123 and the new source set.
   - User B saw, updated and deleted 0 of user A's rows.
   - Deleting the source set cascaded the row away.

   The security advisors reported no lints.
2. **Two extra server indexes** beyond the plan: `(user_id, updated_at, id)` for the pull
   bookmark and `(source_set_id)` for the cascade. The keep-best trigger also pins `kind` and
   `exercise_id` along with value / reps / source. That is harmless, because the deterministic
   id fixes both.
3. **The math module exports two more helpers** (review fix):
   - `beatsRecord`, the classifier's ε rule. The never-lower compare reuses it instead of
     inventing a tolerance.
   - `compareRecordBooks`, the one record ordering, used by `recordBooks` and `currentPrs`. The
     first draft had a copy of it in the app.
4. **History screen session header:** the workout's title with its date beneath, or the date
   alone when untitled. The plan said "date header per session".
5. **Saved-workout badge on a drop set** collects the records of every segment of that drop set
   onto its one row.
6. **Test placement:** the store-level finish proofs, the push/pull/keep-best sync proofs and
   the rollback proof live in `workout/prs.test.ts` and `db/dao.test.ts`, not
   `activeWorkout.test.ts` / `pull.test.ts`. `push.test.ts` only gained the new count key. The
   fake server mirrors the keep-best trigger.
7. **Known, not fixed — server-side ties:** the trigger fires only when the incoming value is
   *lower*. So an equal value pushed from a second device replaces `source_set_id`: the last
   write decides which set holds the badge, and the value never changes. The fold's "earlier set
   keeps a tie" holds only within one device. Left for B14, which reworks this trigger anyway
   (DEFERRED.md).
8. **Review (mattpocock-skills:code-review, both axes):** Spec found no missing requirements and
   no correctness defects. Standards found no hard violations. Fixed: the duplicated ordering
   rule and the `beats` alias. Left as they are (judgement calls):
   - "e1RM" is the only estimate wording on screen, with no citation shown. Whether a computed
     e1RM counts as a "performance claim" is Tristen's call.
   - Small duplications: the distinct-exercise-id helper, and the `back()` and set-row JSX
     shared by the saved-workout and history screens.
   - Hand-written per-table count objects in push/pull.
