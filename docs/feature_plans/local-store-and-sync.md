# local-store-and-sync — B07: On-device SQLite store and sync engine (FND-3; NFR-1, NFR-3 part)

**Branch:** `local-store-and-sync` (from `main`)
**Build step:** B07 — covers FND-3 (whole: device store + sync engine; the schema half landed in
B02), NFR-1 (partial: the offline *substrate*; the logger and Tool Kit screens that use it are
B09/B16) and NFR-3 (partial: durable transactional writes; the active-workout store that rides
them is B08).
**Depends on:** B05 (supabase-js client + session), B03 (catalog, `slugify`,
`LIBRARY_EXERCISE_NAMESPACE`), B04 (slug/uuidv5 identity contract, seeded `exercises` table).

## Step definition of done (from the Build order)

Jest with a fake transport proves a workout written offline lands exactly once after reconnect,
and a retried push creates no duplicates.

## What this step builds

Four things, all headless (no UI beyond root-layout wiring):

1. **A device SQLite database** (expo-sqlite) mirroring the four server training tables —
   `exercises`, `workouts`, `workout_exercises`, `sets` — plus two sync-bookkeeping tables of its
   own (`outbox`, `sync_state`).
2. **The library seeded into it on first launch** from the bundled catalog, under the same
   uuidv5 ids the server rows carry — which requires **moving `uuidv5` out of
   `automation/scripts/generate-library-seed.ts` into `frontend/src/library/`** (per
   `docs/DEFERRED.md`; the generator then imports it — the copy in `automation/` is deleted,
   never duplicated).
3. **An outbox-based sync engine**: every local change is recorded in an outbox in the same
   SQLite transaction as the change itself; a push drains the outbox to Supabase as idempotent
   upserts keyed on the client-generated UUIDs; a pull brings the user's own rows (and library
   changes) down incrementally.
4. **Reconnect/foreground/startup triggers** that run the engine, so syncing needs no user
   action (NFR-1: log in airplane mode, sync on reconnect).

## Approach

### 1. Dependencies (frontend)

- `expo-sqlite` (installed with `npx expo install` so the SDK-58-matched version is picked) —
  the device store the architecture names.
- `expo-network` (same install path) — network-state listener for the reconnect trigger.
  Chosen over `@react-native-community/netinfo` because it is the Expo-native module and we
  need only "did a usable connection appear".

Nothing else. No uuid package (v5 is moved in-repo, §3; nothing in this step mints *new* ids —
fixtures hardcode theirs, and v4 minting arrives with B08's active-workout store via
`expo-crypto`).

### 2. Device database — `frontend/src/db/`

**Driver seam.** `driver.ts` defines a minimal `SqlDriver` interface (`execAsync`, `runAsync`,
`getAllAsync`, `getFirstAsync`, `withTransactionAsync`) with two implementations:

- `expoDriver.ts` — thin wrapper over `expo-sqlite`'s async API; the app uses this.
- a **test driver over `node:sqlite`** (`src/test-utils/nodeSqliteDriver.ts`) — Node 22.14 (this
  machine's Jest runtime, verified) ships `DatabaseSync`, so every schema and DAO test runs
  against **real SQLite** with zero new dependencies. The experimental-feature warning is
  dev-only noise. Fallback if jest-expo's environment fights the builtin: `better-sqlite3` as a
  devDependency behind the same driver interface — interface unchanged, one file swapped.

**Schema.** `schema.ts` holds the DDL and a migration runner keyed on `PRAGMA user_version`
(version 1 creates everything; later steps append numbered migrations). Local tables mirror the
server columns by name (snake_case), so push/pull serialization is a column-name pass-through,
not a mapping layer:

- `exercises(id text pk, owner_id text, name text, primary_muscle text, equipment text, slug
  text, created_at text, updated_at text)`
- `workouts(id text pk, user_id text, title text, notes text, started_at text, ended_at text,
  visibility text, created_at text, updated_at text)`
- `workout_exercises(id text pk, workout_id text references workouts(id) on delete cascade,
  exercise_id text, position integer, notes text, superset_group integer, created_at text,
  updated_at text)`
- `sets(id text pk, workout_exercise_id text references workout_exercises(id) on delete
  cascade, position integer, reps integer, weight_kg real, rpe real, is_warmup integer,
  drop_set_position integer, duration_seconds integer, created_at text, updated_at text)`
- `outbox(id integer primary key autoincrement, tbl text not null, row_id text not null,
  queued_at text not null)` — deliberately **not** unique on `(tbl, row_id)`: see §4.
- `sync_state(key text primary key, value text)` — pull cursors, schema bookkeeping.

`PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`. WAL + transactional writes are the
NFR-3 substrate: a row the DAO has committed survives a force-kill; expo-sqlite/SQLite's
durability does the rest. Timestamps are stored as the ISO-8601 strings Postgres returns —
lexicographic order equals time order, so cursor comparisons are plain string compares.
Constraints that matter for honesty (`check` clauses, enum vocab) live on the **server**; the
local mirror trusts its own DAOs and does not duplicate every server CHECK (the server remains
the enforcement point; a local CHECK drift would be a second home for rules).

**DAO.** `dao.ts` exposes typed row shapes (one interface per table, matching column names) and
two operations this step needs: `upsertRows(tbl, rows)` (pull-side apply, no outbox) and
`writeLocal(tbl, rows)` (user-change-side: upsert **and** enqueue to outbox **and bump + enqueue
the root workout** for child rows, all in one transaction — §5's touch-the-root invariant).
B08 builds the active-workout store on `writeLocal`.

### 3. uuidv5 moves into the library module — `frontend/src/library/uuidv5.ts`

Per `docs/DEFERRED.md`, this is a **move, not a copy**:

- New `frontend/src/library/uuidv5.ts`: RFC 4122 UUIDv5 over a **pure-TypeScript SHA-1**
  (`Uint8Array` throughout — React Native/Hermes has no `Buffer` and no `node:crypto`; a pure
  function is synchronous, dependency-free and runs identically under Node for the generator).
  Exports `uuidv5(namespaceUuid, name)` and the convenience
  `libraryExerciseId(slug) = uuidv5(LIBRARY_EXERCISE_NAMESPACE, slug)`.
  SHA-1 here is an identifier hash mandated by RFC 4122, not a security boundary.
- `automation/scripts/generate-library-seed.ts` **deletes** its local `uuidv5`/`createHash`
  implementation and imports from `../../frontend/src/library/uuidv5` (it already imports the
  catalog from there; tsx resolves it the same way). Its RFC-vector self-check stays as a
  belt-and-braces guard at generation time.
- **Parity proof:** Jest asserts the RFC 4122 test vector
  (`uuidv5(DNS-namespace, 'www.example.com') = 2ed6657d-…`) *and* that
  `libraryExerciseId('bench_press')` equals the id literal committed in
  `20261114120100_library_seed.sql`. The builder additionally regenerates the seed to a scratch
  file and diffs it byte-for-byte against the committed migration — the proof the move changed
  nothing. The committed migration itself is never touched (applied migrations are immutable).

### 4. Outbox — `frontend/src/sync/outbox.ts`

- Every `writeLocal` appends `(tbl, row_id, queued_at)` in the same transaction as the row
  write. The outbox stores **references, not payloads**: push reads the row's *current* state,
  so ten edits to one set coalesce into one upsert naturally.
- Appending (rather than one-row-per-key) is what makes the ack race safe: push captures
  `MAX(outbox.id)` per row when it reads the snapshot, and on success deletes only entries with
  `id <=` that mark. An edit that lands mid-flight inserts a higher id and survives to the next
  push. No row-level locking, no lost updates.
- This step's outbox knows one operation: upsert. **Deletes are B14** (edit/delete workouts);
  when B14 arrives it adds an `op` column and tombstone handling — reserving the column now
  would be dead schema (no consumer, "add nothing speculative").

### 5. Push — `frontend/src/sync/push.ts` + transport seam

`transport.ts` defines `SyncTransport` — the interface the step DoD's *fake transport*
implements:

```ts
interface SyncTransport {
  upsert(tbl: SyncedTable, rows: Row[]): Promise<void>;           // throws on failure
  pullWorkouts(userId, cursor, limit): Promise<WorkoutPage>;       // §6
  pullWorkoutChildren(workoutIds): Promise<{ entries, sets }>;
  pullExercises(cursor, limit): Promise<ExercisePage>;
}
```

`supabaseTransport.ts` implements it over the existing `getSupabase()` client:
`.from(tbl).upsert(rows)` is PostgREST `INSERT ... ON CONFLICT (pk) DO UPDATE` — the idempotent
upsert the schema was designed for (client-generated UUID keys). RLS holds throughout: pushes
run as the signed-in user, and `user_id`/ownership columns come from the session.

Push algorithm (one serialized run at a time):

1. Read distinct pending rows per table, with each row's `MAX(outbox.id)` watermark.
2. Push in **dependency order** — `exercises`, `workouts`, `workout_exercises`, `sets` — so a
   child never arrives before its parent (server FKs). Batches of ≤ 500 rows.
3. On batch success, delete outbox entries up to each row's watermark. On any failure, stop;
   everything still pending stays queued and the next trigger retries. **Exactly-once on the
   server is the primary key's doing**, not the engine's: a retried push of the same rows hits
   `ON CONFLICT DO UPDATE` and changes nothing.
4. Rows deleted locally between enqueue and push (not possible in B07's API, possible in B14)
   would push nothing — the snapshot read simply finds no row; the entry is dropped.

Serialization of pushed rows: the mirrored column names go straight into the upsert payload.
`created_at`/`updated_at` travel too — on first insert the server takes them (preserving the
true offline logging time); on conflict-update the server's `moddatetime` trigger re-stamps
`updated_at` with server time. See §7 for what that means for conflicts.

### 6. Pull — `frontend/src/sync/pull.ts`

Scope: **the user's own workout tree + the exercise catalog**, nothing social.

- **Touch-the-root invariant** (established by `writeLocal`, §2): any local change to a
  `workout_exercises` or `sets` row also bumps its root `workouts.updated_at` and enqueues the
  workout. Consequence: *a workout's server `updated_at` moves whenever anything in its tree
  changed*, so one cursor on `workouts` finds every changed tree — no per-child cursors, no
  nested PostgREST `!inner` filters.
- Workouts: keyset pagination on `(updated_at, id)` — `user_id = eq(me)`, ordered
  `updated_at asc, id asc`, pages of 500, cursor stored in `sync_state`. Keyset (not plain
  `updated_at >`) so equal timestamps can never straddle a page boundary and be skipped.
- For each page's workout ids: fetch all their `workout_exercises` and `sets` by
  `workout_id in (...)` / `workout_exercise_id in (...)` and upsert the whole tree locally
  (parents before children, one transaction per page).
- Exercises: its own `(updated_at, id)` cursor, no user filter — RLS already scopes the read to
  `owner_id is null or owner_id = me`, which is exactly the set we want. This is how founder
  library edits reach devices (§8).
- **Pending-local-shadow rule:** pull never overwrites a row that has outbox entries — the
  local unsynced edit wins locally until it pushes, then the normal flow reconciles. Without
  this, a pull racing a pending push would silently revert the user's offline edit.
- Cursor advances only after its page's transaction commits, so a crash mid-pull re-pulls
  idempotently (upserts) rather than losing rows.
- **Two robustness details:** (a) each pull resumes from a small overlap window *behind* the
  stored cursor (`moddatetime` stamps transaction-start time, so a slow commit can land a row
  slightly "in the past" of an already-advanced cursor; the overlap re-reads that margin, and
  upserts make the re-read free); (b) children fetches chunk their `in (...)` id lists to
  ~100 ids per request so a large page never builds a URL PostgREST refuses.

### 7. Conflict policy — what "last-write-wins by `updated_at`" means here

Stated plainly so nobody discovers it later: the server is the merge point.

- Within one device (the overwhelmingly common case), the outbox preserves edit order and LWW
  is exact.
- Across devices, the **later push wins**: pushes are unconditional upserts, and the server's
  existing `moddatetime` trigger stamps `updated_at` on every update — server-authoritative,
  monotonic, immune to device clock skew, and the pull cursors depend on exactly that
  monotonicity. A push-time guard (`DO UPDATE ... WHERE excluded.updated_at >= t.updated_at`)
  is not expressible through PostgREST upserts, and trading `moddatetime` for
  client-supplied timestamps would let one skewed phone clock wedge a row permanently.
- The theoretical gap: device A edits offline at 09:00, device B edits the same row at 10:00
  and syncs; A reconnects at 11:00 and its 09:00 edit overwrites B's. Push-order LWW, not
  edit-order. This is a deliberate, recorded interpretation of the scope line — exact
  edit-time LWW needs a server-side stale-write-rejection trigger, which is the documented
  upgrade path **if** multi-device editing ever becomes real. Launch reality: one phone per
  lifter; B08's active workout is single-device by nature.

### 8. Library seeding on first launch — `frontend/src/library/seedLocal.ts`

- At database open, inside one transaction: `INSERT OR IGNORE` all 151 catalog exercises into
  the local `exercises` table — `id = libraryExerciseId(slug)`, slug, name, primary muscle,
  equipment, `owner_id` null, `created_at`/`updated_at` set to a fixed epoch constant (so a
  seeded row is always older than any server pull and never shadows one).
- `INSERT OR IGNORE`, not upsert, on purpose: the **server is the system of record** once rows
  exist; founder library edits flow server → pull → local update. A local always-upsert would
  re-impose the bundled (possibly older) catalog over fresher pulled rows on every launch.
- Seeded rows are **never enqueued to the outbox** — they aren't local changes, and RLS would
  rightly refuse a client writing `owner_id is null` rows anyway.
- No version bookkeeping: `INSERT OR IGNORE` of 151 rows is idempotent and costs milliseconds;
  a changed catalog in an app update inserts only genuinely new slugs, and content changes to
  existing rows arrive via the pull (the regenerated seed migration updates the server first —
  the B04 content-migration discipline, unchanged).

### 9. Engine and triggers — `frontend/src/sync/engine.ts`, `useSync.ts`

- `SyncEngine` owns one `syncNow()` — push, then pull — **serialized** (a run in flight absorbs
  new requests into a single queued follow-up; no concurrent runs, no re-entrancy).
- Triggers, all debounced into `syncNow()`: (a) sign-in / app start with a session; (b) app
  returns to foreground (reusing the `AppStateLike` seam `lib/supabase.ts` already defined);
  (c) network becomes reachable (`expo-network`'s `addNetworkStateListener`); (d) a local write
  (the DAO notifies the engine after each committed `writeLocal`).
- Failures are silent-but-logged and *stateless*: nothing is marked failed, the outbox simply
  still has entries, and the next trigger retries. No retry timer, no backoff machinery — the
  four triggers fire often enough in real phone use, and a timer would be speculative
  machinery (revisit only if evidence shows syncs stalling with the app open).
- Wiring: a `useSync(session)` hook mounted once in `src/app/_layout.tsx`'s `RootNavigator` —
  opens the database (which seeds, §8), builds the engine with the real driver + transport,
  starts/stops listeners with the session. Signed out = no engine (nothing to sync; the
  database stays, keyed to come back when the user signs in — single-account device assumption,
  same as supabase-js's own session store).

### 10. Auth session store swap (DEFERRED item, riding along deliberately)

`docs/DEFERRED.md` (B05 follow-up) asks B07 to consider swapping the Supabase session store
from AsyncStorage to `expo-sqlite/kv-store` — an API-compatible drop-in. With expo-sqlite now a
dependency, the swap removes `@react-native-async-storage/async-storage` entirely: one import
line in `lib/supabase.ts`, delete the dependency, re-point the Jest mock (jest.setup.js mocks
the storage module; AuthProvider tests inject fakes and never touch real storage). One storage
engine on the device instead of two. **Severable:** if it fights the builder (e.g. kv-store
needs a native rebuild the test env lacks), it is dropped back to DEFERRED in one commit revert
without touching the rest of this step — recorded either way in this file.

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/db/driver.ts` | new — `SqlDriver` interface |
| `frontend/src/db/expoDriver.ts` | new — expo-sqlite implementation |
| `frontend/src/db/schema.ts` | new — DDL, `PRAGMA user_version` migration runner |
| `frontend/src/db/database.ts` | new — open + migrate + seed, the app's one database handle |
| `frontend/src/db/dao.ts` | new — typed rows, `upsertRows`, `writeLocal` (txn: row + outbox + touch-root) |
| `frontend/src/db/*.test.ts` | new — schema, DAO, atomicity tests on node:sqlite |
| `frontend/src/test-utils/nodeSqliteDriver.ts` | new — test driver over `node:sqlite` |
| `frontend/src/library/uuidv5.ts` (+ `.test.ts`) | new — pure-TS SHA-1 + UUIDv5, RFC vector + seed-parity tests |
| `frontend/src/library/seedLocal.ts` (+ `.test.ts`) | new — first-launch `INSERT OR IGNORE` seed |
| `automation/scripts/generate-library-seed.ts` | edit — delete local uuidv5, import from `frontend/src/library/uuidv5` |
| `frontend/src/sync/outbox.ts` | new — enqueue/snapshot/ack-delete |
| `frontend/src/sync/transport.ts` | new — `SyncTransport` interface + row serialization types |
| `frontend/src/sync/supabaseTransport.ts` | new — real implementation over `getSupabase()` |
| `frontend/src/sync/push.ts`, `pull.ts`, `engine.ts` | new — §5, §6, §9 |
| `frontend/src/sync/useSync.ts` | new — root-layout hook |
| `frontend/src/sync/*.test.ts` | new — fake-transport DoD tests, pull/shadow/cursor tests, engine serialization tests |
| `frontend/src/test-utils/fakeTransport.ts` | new — in-memory "server": upsert-by-pk maps + failure injection |
| `frontend/src/app/_layout.tsx` | edit — mount `useSync` in `RootNavigator` |
| `frontend/src/lib/supabase.ts` + `jest.setup.js` + `frontend/package.json` | edit — §10 kv-store swap (severable) |
| `frontend/package.json` | edit — add `expo-sqlite`, `expo-network` |
| `docs/diagrams/app-flow.md` | edit (Document step) — device store, outbox, sync paths; marked "engine live, no UI consumer until B08/B09" |
| `docs/diagrams/database-erd.md` | edit (Document step) — note that the device mirror exists; **no server schema change** |
| `docs/BUILD_LIST.md` | **not touched** — status flips happen at Gate 2 |

## Data model impact

**No server migrations.** The B02 schema was built for exactly this engine (client UUID keys,
no-default `id` columns, `moddatetime`); B07 consumes it unchanged. New *device* schema as in
§2 — documented in the app-flow diagram; the ERD gains only a note that a device mirror exists
(the ERD draws the server database).

## How each definition of done becomes observably true

- **Step DoD** — `sync/push.test.ts` (fake transport + real local SQLite): a full workout tree
  written through `writeLocal` while the transport throws (airplane mode) stays local with
  outbox entries; transport heals; `syncNow()` lands exactly one workout, its entries and sets
  in the fake server's by-id maps; calling `syncNow()` again (and a forced second push of the
  same snapshot) leaves counts identical — retried push, no duplicates. A partial-failure case
  (transport fails after the workouts batch) retries to the same end state.
- **FND-3** — same tests prove the engine half; the schema half was B02/B04. The literal
  airplane-mode-on-a-phone observation is Tristen's device run (Built → Done), as ever.
- **NFR-1 (this step's part)** — the substrate above; the Tool Kit needs no sync at all
  (pure math, B06) and the logger UI arrives in B09 already on top of this store.
- **NFR-3 (this step's part)** — `dao.test.ts` proves `writeLocal` is atomic (row + outbox
  land or neither does, asserted by failing mid-transaction) on real SQLite with WAL; B08's
  simulated-kill test is the full proof on its own step.
- **uuidv5 move** — RFC 4122 vector test; `libraryExerciseId('bench_press')` equals the
  committed migration's literal; builder regenerates the seed and diffs byte-for-byte; `grep`
  confirms exactly one `uuidv5` implementation exists in the repo.

## Out of scope (this branch)

- **Deletes/tombstones** — B14 (edit/delete workouts) adds the outbox `op` column and delete
  propagation; B07's API offers no delete.
- **Active-workout domain store, resume-on-launch, repeat-set** — B08, on top of `writeLocal`.
- **Any logger/Tool Kit UI** — B09/B16.
- **Custom-exercise CRUD** — B31 (the engine is table-generic; B31 adds the screens and rules).
- **Minting v4 UUIDs** — B08 (expo-crypto); B07 fixtures hardcode ids.
- **Realtime subscriptions, social pulls (feed, others' workouts)** — B20+; this engine syncs
  the user's own data only.
- **Edit-time LWW / stale-write-rejection trigger** — documented upgrade path in §7, built only
  if multi-device conflicts become real.
- **Sync status UI, conflict surfacing, backoff timers** — no consumer, no evidence ("add
  nothing speculative").

## Risks a reviewer should weigh

1. **The touch-the-root invariant is load-bearing** (§6): if any future write path adds a child
   row without bumping its workout, other devices never pull it. It lives in exactly one place
   (`writeLocal`) and B08+ must write through the DAO, never raw SQL — called out in the DAO's
   doc comment. The alternative (per-child cursors with PostgREST `!inner` embedded filters)
   is recorded in the grilling notes if this ever proves too fragile.
2. **node:sqlite as the Jest driver** is experimental in Node 22 (works on this machine,
   verified `DatabaseSync` loads). If it misbehaves under jest-expo, the fallback is
   `better-sqlite3` behind the unchanged driver interface — a one-file, zero-design-change
   swap, but the builder should hit it early so the surprise is cheap.
3. **Push-order vs edit-order LWW** (§7) is an interpretation of the scope's "last-write-wins
   by `updated_at`" — exact edit-time LWW is impossible with PostgREST upserts + `moddatetime`
   without new server machinery. If Gate 1 disagrees, the alternative is a small migration
   (stale-write-rejection trigger) and the plan changes before code.

## Grilling decisions (settled before code)

Run via `mattpocock-skills:grilling`; headless pipeline run, so the planner played both sides
at full severity. Questions that changed or sharpened the plan:

- **"Why is pull in this step at all? The DoD only mentions push."** The step *scope* names it
  ("pull of the user's own rows; last-write-wins by `updated_at`") — the DoD sentence is the
  test bar, not the scope. Pull stays, with its own tests.
- **"The outbox-with-watermark design is more machinery than a `dirty` flag per row — why?"**
  A dirty flag can't survive the ack race (edit lands while its push is in flight; the ack
  clears the flag and the edit is lost forever, silently). The watermark delete is ~5 lines and
  is the difference between "no lost updates" and "rare silent data loss" — exactly the bug
  class FND-3's DoD forbids.
- **"Why reference-outbox instead of payload-outbox?"** Payload outboxes replay every
  intermediate state (N pushes for N edits) and can resurrect stale payloads after partial
  failures. Reading current row state at push time coalesces for free and the retried-push
  test stays trivial to reason about.
- **"Touch-the-root couples children to the workout row — a set edit pushes two rows."** Yes,
  and that's the price of a one-cursor pull with no nested PostgREST filters and no per-child
  cursors. Two extra columns of bandwidth per edit vs. three cursors and `!inner` embed
  queries that are hard to verify under RLS — the invariant wins. Recorded as risk #1.
- **"Is the kv-store swap (§10) scope creep?"** It's the DEFERRED list explicitly addressed to
  B07, it *removes* a dependency, and it's severable. It rides, flagged, and gets dropped back
  to DEFERRED rather than fought over if it resists.
- **"Why seed with `INSERT OR IGNORE` instead of upsert?"** An always-upsert would re-impose
  the bundled catalog over fresher server-pulled rows on every launch — the bundled catalog is
  the *birth* state, the server is the *living* state (B04's content-migration discipline).
  First drafted as always-upsert; changed by this question.
- **"Seeded rows must never hit the outbox"** — made explicit in §8 after asking what RLS does
  to a pushed `owner_id is null` row (refuses it; and 151 poison-pill outbox entries would wedge
  the push forever since push stops on failure). The seed path and the write path are separate
  DAO functions on purpose.
- **"What happens when a pull and a pending push race?"** The pending-local-shadow rule (§6):
  pull skips rows with outbox entries. Without it the engine reverts offline edits it hasn't
  pushed yet — the second silent-data-loss bug this plan explicitly closes.
- **"Keyset pagination — speculative?"** No: plain `updated_at > cursor` pagination *drops
  rows* whenever equal timestamps straddle a page (bulk pulls after reinstall make equal
  timestamps common — a whole seed's worth share one migration timestamp). Correctness, not
  tuning.
- **"Why no retry/backoff timer?"** Four natural triggers already cover real phone use; a
  timer is machinery with no observed need ("add nothing speculative"). Revisited only on
  evidence of syncs stalling with the app open.
- **"Single account per device is assumed — what if user B signs in on user A's phone?"**
  Real, accepted, recorded: local rows are keyed by `user_id`, pulls filter by the session
  user, pushes carry each row's own `user_id` and RLS refuses cross-writes — so nothing leaks
  *to the server*; but user A's rows remain in the device file and would be *visible to a DAO
  query that forgot to filter*. B07 has no reading UI; the rule "every query the UI ever runs
  filters by the signed-in user_id" is recorded here for B08/B09, and wiping the local DB on
  *account switch* (not sign-out — signing back in must not re-download history over cell
  data) is deferred to the step that builds account switching, with the hazard named.
- **"A slow server commit can land a row behind an already-advanced pull cursor."** True —
  timestamp cursors always have this race. Settled with the §6 overlap window (re-pulling a
  margin is free under idempotent upserts) rather than heavier machinery like logical
  replication or sequence columns.
- **"Does a no-op workout upsert actually bump the server row?"** Touch-the-root depends on
  it: yes — PostgREST's `DO UPDATE` runs even when values are identical, so `moddatetime`
  fires and `updated_at` moves. The push-echo this causes (next pull re-downloads rows this
  device just pushed) is accepted as harmless idempotent traffic.
- **"Why not sync through a server function instead of PostgREST upserts?"** An edge function
  could do conditional LWW — but it's new server machinery the current DoD doesn't need, it
  bypasses the generated API the architecture prefers, and RLS + PK upserts already give
  idempotency. The §7 trigger is the cheaper upgrade if edit-time LWW is ever demanded.
