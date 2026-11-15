# edit-delete-workouts — B14: edit and delete past workouts, PRs recomputed

**Branch:** `edit-delete-workouts` (from `main`)
**Build step:** B14 — covers **LOG-9** (edit or delete past workouts; PRs and trends recalculate),
in full.
**Depends on:** B13 (`personal_records`, the fold, the keep-best trigger), and through it
B07 (outbox sync), B08 (the active-workout store whose operations this step reuses), B09–B12
(the logger surface and its setters).

## Step definition of done (from the Build order)

Deleting the workout that holds a PR removes it and promotes the next best set.

## Scope check

The step scope is right as written: edit any past workout's exercises and sets; delete a
workout; PRs and history recomputed from the remaining data, locally and on the server. Three
readings are settled up front:

- **"Recomputed … on the server" means the server's tables end up corrected, not that the
  server recomputes.** The B13 plan of record says the server stays a passive store of
  client-computed rows until B18's first server function; recomputing in SQL would mirror the
  training math (forbidden), and a Deno recompute function is B18's machinery built early. The
  device recomputes and syncs the corrections up. Gate 1 can overrule this reading.
- **"Trends" (LOG-9's DoD) names nothing that exists yet.** No trends feature has shipped;
  every current reader (history screens, last-time panel, PR panel) derives from the raw
  `sets`/`personal_records` rows at read time, so an edit or delete corrects them by
  construction. Future trend features must keep deriving from raw rows — recorded here as the
  standing rule that keeps LOG-9 true later.
- **Editing a past workout's title and notes is in** ("edit any past workout's exercises and
  sets" plus B12's explicit deferral of finished-workout note editing to B14). Editing
  `started_at`/dates or `visibility` is out — no PRD feature asks for date editing, and
  visibility controls are B26's.

Standing inputs honored (HANDOFF/DEFERRED): the outbox gains delete handling; the keep-best
trigger question is resolved (see below — kept, deliberately, with demotion routed around it);
`improvedRecords` gets its forced-recompute counterpart; the server-side tie is decided; the
edit surface reuses the store's setters and `limits.ts` validation.

## The design in one paragraph

A finished workout is edited through the **same store operations the logger uses** — `createStore`
in `activeWorkout.ts` grows a small *write-policy* seam: the draft policy (today's behavior,
unchanged) writes through the draft path; the new **edit policy** writes every change through
the synced path (upsert + outbox + touch-the-root) and ends every operation's transaction with
a **PR recompute of the touched exercises**, so the device is never — even across a kill —
in a state where an edit is saved but its PR consequences are not. Deleting a workout is one
transaction: delete the local tree, recompute the affected exercises' books, queue one `delete`
outbox line for the workout (the server's FKs cascade the rest). Deletes travel to the server
through a new outbox `op` column and a push **delete phase** that runs before the upsert
passes; they travel to *other devices* through a new server-side `sync_tombstones` table
(filled by `AFTER DELETE` triggers on `workouts` and `personal_records`) plus tree
reconciliation in the pull. Legitimate PR demotions are expressed as **delete-then-insert** on
the same deterministic row id, which the keep-best trigger — kept unchanged — never sees as an
update, so it keeps protecting the one path it was built for (a fresh device's finish) without
blocking B14.

## Why the keep-best trigger is kept, not reworked

B13 recorded "B14 must rework the keep-best trigger". This plan **keeps it unchanged** and
routes demotions around it, because no trigger-side test can tell a legitimate demotion from
the stale-fresh-device push the trigger exists to stop:

- *"Allow lowering when the source set is unchanged"* fails the promotion-after-edit case
  (book 100 kg held by set S1; S1 edited to 60; S2 at 90 must take the book — different
  source, lower value, legitimate).
- *"Allow lowering when a flag says so"* is a flag any buggy or stale client could set — the
  protection would be decorative.

What distinguishes the two cases is **what the client has done**: a finish only ever raises
(`improvedRecords` is monotonic, unchanged), so upsert-as-update stays guarded by keep-best;
an edit/delete recompute *knowingly* demotes, and expresses it as `delete` + `insert` — the
trigger is `BEFORE UPDATE`, an insert after a delete never fires it. A fresh stale device can
never emit a PR delete (it only finishes), so the hole B13 closed stays closed.

**The tie decision (B13 deferral #7):** unchanged — the trigger keeps firing only on *lower*
values, so an equal value pushed from a second device may replace `source_set_id` (last write
wins, the value itself never changes; within one device the fold's earlier-set rule holds).
Making the server keep the older source on ties would break the legitimate
"source changed at an equal value" edit (two 100 kg sets; the record holder edited down; the
other must take the book). Cosmetic cross-device churn is the cheaper cost. Settled.

## Data model

### Server migration — `backend/supabase/migrations/<version>_sync_tombstones.sql`

Applied live with `mcp__supabase__apply_migration`, then the file renamed to the recorded
version (`list_migrations`), per pipeline convention. The keep-best trigger and all existing
tables are untouched.

```sql
-- Deletions, for other devices' downloads. A pull cannot see an absent row;
-- this table is the list of rows that stopped existing, written by triggers so
-- cascades are recorded too.
create table public.sync_tombstones (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  tbl        text not null check (tbl in ('workouts', 'personal_records')),
  row_id     uuid not null,
  deleted_at timestamptz not null default now()
);
create index sync_tombstones_user_idx on public.sync_tombstones (user_id, id);

alter table public.sync_tombstones enable row level security;
-- Owner-only read; no client write policies at all — only the triggers insert.
create policy "users read their own tombstones" … using (user_id = (select auth.uid()));

create or replace function private.record_tombstone() returns trigger
  language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.sync_tombstones (user_id, tbl, row_id)
  values (old.user_id, tg_table_name, old.id);
  return old;
end $$;

create trigger record_tombstone after delete on public.workouts
  for each row execute function private.record_tombstone();
create trigger record_tombstone after delete on public.personal_records
  for each row execute function private.record_tombstone();
```

Why only these two tables get tombstones: entry and set deletions are always *inside* a
changed workout, and the pull already re-downloads a changed workout's whole tree (the
touch-the-root rule) — reconciling that tree (below) removes them with no tombstone. A
workout's or a PR row's disappearance has no surviving parent to signal it. Postgres fires
row-level `AFTER DELETE` triggers for cascaded deletes too, so a PR row cascaded by
`source_set_id` is recorded without any client help. `user_id … on delete cascade` keeps an
account deletion from leaving tombstone litter. Tombstone retention is unbounded for now —
rows are a few dozen bytes and a retention job would be speculative (DEFERRED note).

Why a `bigint` identity cursor instead of the `(updated_at, id)` pattern: the identity is
server-assigned and strictly monotonic, so "everything after id N" needs no overlap rewind and
cannot skip at a page boundary — strictly simpler than the timestamp cursors, not an extra.

### Device schema V5 — `frontend/src/db/schema.ts`

```sql
alter table outbox add column op text not null default 'upsert';
```

`MIGRATIONS` gains V5; `SCHEMA_VERSION` becomes 5. Existing lines become `upsert` lines by the
default, which is exactly what they were. No device mirror of `sync_tombstones` — tombstones
are consumed during the pull, not stored (the `pull_cursor:tombstones` bookmark in
`sync_state` holds the last applied id).

## Sync: deletes travel up (push)

- **`outbox.ts`:** `enqueueTx` gains `op: 'upsert' | 'delete'` (defaulted to `'upsert'`, so
  every existing caller is untouched); `pendingRows(db, tbl, op)` filters and watermarks **per
  op** (`max(id)` over that op's lines only); `acknowledge` deletes only that op's lines up to
  each mark. Per-op watermarks are load-bearing: a demotion queues `delete` line *n* and
  `upsert` line *n + 1* for the same row id — clearing "everything ≤ n + 1" after the delete
  phase would silently swallow the re-insert, and the server would be left without the book.
- **`push.ts`:** one **delete phase** before the existing upsert passes, tables in *reverse*
  `SYNC_ORDER` (`personal_records`, `sets`, `workout_exercises`, `workouts`) — children's
  explicit deletes can never trail their parent's, and every recomputed PR upsert lands after
  the delete that justifies it, so the server sees `delete` then `insert`, never a lowered
  `update`. Then the upsert passes exactly as today — their existing "row missing locally →
  push nothing, clear the lines" behavior (written in B07 for exactly this day) silently
  retires stale upsert lines of deleted rows. `PushResult.pushed` gains a `deleted` count per
  table.
- **`transport.ts` / `supabaseTransport.ts`:** new `deleteRows(tbl, ids)` —
  `.delete().in('id', ids)`; deleting an id the server no longer has is a no-op, which makes
  retries and the cascade/explicit-delete overlap safe. New
  `pullTombstones(userId, afterId, limit)`.
- **Ordering guarantee stated for the builder:** a workout delete queues *only* the workout's
  delete line — the server cascade removes its entries, sets and the PR rows citing them, and
  the tombstone triggers record what the other devices need. Queuing child deletes would be
  redundant traffic and another ordering surface.

## Sync: deletes travel down (pull)

- **Tombstone pass, last** (after the exercises, workout-tree and `personal_records` passes),
  cursor `pull_cursor:tombstones` = last applied `id`, pages of `PULL_PAGE_SIZE` by `id`.
  Last, deliberately: a demoting device holds its re-created PR row with a *device-clock*
  `updated_at` until the PR pass delivers the server-stamped copy; running tombstones first
  could transiently delete the device's own re-creation (device clock behind the server's
  defeats the timestamp guard). With the PR pass first, the server copy — stamped *after* the
  tombstone — lands before the tombstone is judged, and the guard holds. Every crash-between-
  passes ordering still converges, because the re-created row stays ahead of the PR cursor
  until delivered: the PR pull pass is the restorer, the guard is best-effort defense.
  - `tbl = 'workouts'`: delete the local workout row — the device's FK cascades remove its
    entries and sets — and **clear every outbox line for the workout and its children** (their
    ids collected before the delete). Deletion wins over a pending local edit, deliberately:
    skipping the tombstone would let a pending title-edit line re-insert a *childless* workout
    row on the server (its sets are gone and their upsert lines would find no local rows).
    Resurrection is strictly worse than losing an edit to a workout someone deleted on another
    device. Settled.
  - `tbl = 'personal_records'`: delete the local row **unless** it has pending outbox lines
    (the standard your-unsent-change-wins rule — its own push will settle the server) **or**
    its `updated_at` is at or after the tombstone's `deleted_at`. The timestamp guard exists
    because deterministic ids get *re-created* (demote = delete + insert): a pull that saved
    the re-created, server-stamped row must not let the overlapping tombstone delete it. The
    guard is best-effort (a not-yet-pulled local row carries a device stamp); the pass
    ordering above makes the common case safe and the PR pull pass restores any loss.
- **Tree reconciliation in `pullWorkoutTrees`:** the pull already fetches the complete entry
  and set lists of every pulled workout; after upserting them, delete any *local* entry of
  those workouts (and local set of those entries) that the server's lists no longer contain —
  except rows with pending outbox lines (a set logged or edited offline against that workout
  must survive until pushed). This is what carries in-workout deletions (removed sets, removed
  exercises) to other devices with no per-row tombstones: the editing device's touch-the-root
  re-stamp makes every other device re-download and reconcile that workout. Implementation
  note for the builder: diff the id sets in JavaScript and delete in chunks — a single
  `not in (…)` over a page's thousands of ids would blow SQLite's bound-parameter limit.
- Local PR rows citing sets that reconciliation removed are left to the tombstone pass in the
  same pull — the server transaction that deleted those sets cascaded their PR rows and wrote
  `personal_records` tombstones.
- `PullResult` gains `tombstones` (applied count) and reconciliation delete counts folded into
  the per-table numbers (builder's choice on exact shape, tests pin it).

## PR recompute — the forced counterpart to `improvedRecords`

New in `frontend/src/workout/prs.ts` (orchestration only; **no change to `@training-math`** —
`recordBooks`, `beatsRecord`, `compareRecordBooks` and `roundToIncrement` already carry every
rule, and diffing fold results against stored rows is persistence, not math — the same split
B13 settled):

`recomputeRecords(tx, userId, exerciseIds, now)` → for each exercise: fold **all finished
history** through `recordBooks` (no snapshot appending — the edited workout *is* finished, so
the plain `ended_at is not null` query already includes it; contrast with finish, where the
workout is still a draft at read time), round through `roundToIncrement(…, 0.001)`, compare
with the stored rows, and return three lists:

- **new** — book folded, no stored row → local upsert + `upsert` outbox line;
- **changed, value not lower** — a raise, or an equal value with a new source set → local
  update + plain `upsert` line. Deliberately *not* delete+insert: a raise expressed as
  delete+insert would first *delete* a concurrently-set higher record from another device —
  exactly the clobber keep-best exists to arbitrate, and a plain update lets it (105 against a
  stored 110 is kept at 110; the equal-source case passes, since the trigger only blocks
  *lower* values);
- **changed, value lower** — the demotion → local update + **`delete` line then `upsert`
  line** (the choreography keep-best never sees as an update). Delete+insert is confined to
  the one case that cannot be expressed any other way, which also confines the multi-device
  clobber window (below) to demotions;
- **gone** — stored row whose book the fold no longer produces (the only 5-rep set deleted) →
  local delete + `delete` line.

Value comparisons in the diff are exact over both sides rounded to the column's 3 decimals;
`beatsRecord`'s ε stays where it is — deciding what *beats*, in the fold.

`improvedRecords` (the finish path) is untouched — its monotonic guard is what keeps the
keep-best story coherent. Both share the row-building helper (`rowIfImproved`'s core extracted,
`created_at` preserved from the existing row).

**Multi-device demotion race, accepted:** device B improves a book offline while device A's
edit demotes the same book; if B's push lands before A's delete phase, A's delete+insert
overwrites B's newer record. Raises and equal-source changes never clobber (they stay plain
upserts, arbitrated by keep-best — the choreography decision above), so the window is exactly
the demotions, where no update can be allowed through. The fold self-heals it on B's next
finish of that exercise (`improvedRecords` folds B's full local history, which still holds the
better set, and re-raises). Concurrent offline demote-and-improve of the *same book* is rare,
the damage is bounded and self-correcting, and the alternative is server-side recompute (B18
machinery early). Documented, not defended against.

## The edit store — reusing the logger's operations

`activeWorkout.ts` gains a small seam, not a fork: `createStore` takes a `WritePolicy` that
owns persistence —

- `draftPolicy` (default): exactly today's `writeDraftRowsTx` / `deleteDraftRowsTx` calls and
  per-op transactions. **Behavioral change: none.** B08/B13's suites must pass untouched —
  they are the proof the seam is a refactor.
- `editPolicy` (new, in `frontend/src/workout/editWorkout.ts`): wraps each operation's
  transaction; rows are written through a `writeLocalRowsTx` helper **extracted from
  `writeLocal`** (upsert + outbox `upsert` lines + the touch-the-root re-stamp — extracted,
  not copied, so the touch-the-root rule keeps one home); removed sets/entries are locally
  deleted + queued as `delete` lines + touch-the-root. The policy resolves each operation's
  touched `exercise_id`s **before** any delete runs (afterwards the rows are gone), and
  **ends the same transaction** with `recomputeRecords` over them and its outbox lines. One
  transaction per operation means a kill can never leave an edit saved without its PR
  consequences — the same shape of guarantee `finish()` gives (B08's NFR-3 ethos), extended
  to edits.

Because the operations themselves are shared, every edit goes through `setColumns` →
`assertValidSetFields` and the title/notes setters' `limits.ts` assertions — the "reuse the
store's setters and `limits.ts`" standing input is satisfied by construction, and a value the
server would refuse still cannot reach the outbox (the B07 poison-row rule).

`editWorkout.ts` exports:

- `openWorkoutForEdit(db, userId, workoutId)` → an `ActiveWorkoutStore` over the finished
  workout (null when missing/foreign/unfinished). Its `finish()` and `discard()` throw — an
  edited workout is already saved and already synced; the screen never calls them. Not held in
  the session slot (`activeWorkoutSession.ts` stays drafts-only); the edit screen owns it.
- `deleteWorkout(db, userId, workoutId)` → one transaction: read the workout's exercise ids,
  delete the local tree (device FKs cascade), run `recomputeRecords` over those exercises,
  apply its rows/lines, queue the workout's `delete` line. Refuses an unfinished workout
  (that is `discard`'s job) and another user's. Fires the `onLocalWrite` listeners so the
  engine pushes soon.

## Screens

- **Saved workout (`app/workout/[id].tsx`):** gains an **Edit** button (→
  `/edit-workout/[id]`) and a **Delete** button (confirm via `Alert`, like discard → 
  `deleteWorkout` → back to the Workout tab). The load effect moves to `useFocusEffect` so
  returning from the editor re-reads the workout and its badges (today's `useEffect` would
  show stale sets after an edit).
- **Edit screen (`app/edit-workout/[id].tsx`, new, declared in the signed-in stack):** the
  logger surface over the edit store — the same `EntryCard`, `ExercisePicker` and autosave
  title/notes boxes (they take any `ActiveWorkoutStore`), with Finish/Discard replaced by
  **Done** (back — nothing to commit, every change is already saved and queued) and
  **Delete workout** (confirm → drop the store, `deleteWorkout`, replace-navigate to the
  Workout tab — the store must not refresh against a workout that is gone). Done flushes the
  autosave registry first, like Finish does on the logger, so the last ~¾ s of a title or note
  isn't lost to the debounce. The `EntryCard` last-time panel keeps excluding the viewed
  workout by id, which is exactly right here too. Route tests live in `src/__tests__/`
  (expo-router registers `*.test.tsx` under `src/app/` as routes).
- **No session-slot involvement**: starting a *draft* workout while editing an old one stays
  possible and safe — different stores, different workouts, and SQLite serializes their
  transactions. Two simultaneous edit screens of the same workout are not guarded against
  (navigation makes it a non-path; same-device last-write-wins if forced). A pull that lands
  mid-edit can change rows the edit session hasn't touched without the snapshot noticing until
  the next operation re-reads — a stale *display*, never a lost write (touched rows are
  protected by their pending lines). Known limit, matching the no-refresh reading B13 settled
  for the PR panel.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_sync_tombstones.sql` | new — tombstone table, RLS, `record_tombstone` triggers on `workouts` + `personal_records` (applied live, renamed to recorded version) |
| `frontend/src/db/schema.ts` (+ test) | edit — V5: outbox `op` column |
| `frontend/src/sync/outbox.ts` (+ test) | edit — op-aware `enqueueTx` / `pendingRows` / `acknowledge` (per-op watermarks) |
| `frontend/src/db/dao.ts` (+ test) | edit — `writeLocalRowsTx` extracted from `writeLocal` (one home for touch-the-root); `enqueueTx` call sites take the `'upsert'` default |
| `frontend/src/sync/push.ts` (+ test) | edit — delete phase (reverse `SYNC_ORDER`) before upsert passes; `deleted` counts |
| `frontend/src/sync/transport.ts`, `supabaseTransport.ts` (+ test), `test-utils/fakeTransport.ts` | edit — `deleteRows`, `pullTombstones`; the fake server mirrors FK cascades and writes tombstones (it already mirrors keep-best) |
| `frontend/src/sync/pull.ts` (+ test) | edit — tombstone pass (first, own cursor) + tree reconciliation with the pending-rows guard |
| `frontend/src/sync/engine.ts` (+ test) | edit — result plumbing only, if its tests pin shapes |
| `frontend/src/workout/prs.ts` (+ test) | edit — `recomputeRecords` (new/changed/gone diff), shared row builder |
| `frontend/src/workout/activeWorkout.ts` (+ test) | edit — `WritePolicy` seam; draft behavior byte-identical |
| `frontend/src/workout/editWorkout.ts` (+ test) | new — `editPolicy`, `openWorkoutForEdit`, `deleteWorkout` |
| `frontend/src/app/edit-workout/[id].tsx` | new — the edit screen |
| `frontend/src/app/workout/[id].tsx` | edit — Edit/Delete buttons, focus-refetch |
| `frontend/src/app/_layout.tsx` | edit — declare the new route |
| `frontend/src/__tests__/edit-workout.test.tsx` (new), `saved-workout.test.tsx` | route + flow tests |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) — tombstone table/triggers; edit/delete paths, push delete phase, pull reconcile |

Builder footguns (precedent): regenerate typed routes with `npx expo start --offline` (~150 s)
**before** `tsc --noEmit` → lint → Jest — this step adds a route. Rename the migration file to
the version Supabase records after `apply_migration`.

## How each definition of done becomes observably true

- **Step DoD** — store-level test on the node driver: finish workout A (100 kg × 5 → `repMax`
  5 @ 100 citing A's set), finish workout B (90 kg × 5), `deleteWorkout(A)` → locally, the
  5-rep book now holds 90 citing B's set *in the same transaction's aftermath*; after a sync
  against the fake server, the server row shows the same (delete landed, insert followed);
  a second device's pull applies the tombstone + the new row. On screen: the flow test deletes
  A from the saved-workout screen and shows B's set wearing the `PR · 5RM` badge.
- **LOG-9 "editing … corrects all affected PRs"** — edit the record-holding set down →
  demotion lands locally and on the fake server (keep-best mirror not blocking it, because
  delete-then-insert); edit it up → raise; remove the only 5-rep set → book gone on both ends
  and on a second device.
- **LOG-9 "history"** — the saved-workout and exercise-history screens re-read raw rows; the
  flow test edits a set and sees the new value on both after return (focus-refetch).
- **"Locally and on the server"** — every proof above asserts both the device tables and the
  fake server's, and Gate 2 probes the real migration live (below).

## Testing (Jest, node SQLite driver, fake transport — never the real project)

Key fixtures beyond the DoD proofs: per-op watermarks (demotion's delete line acked without
swallowing its re-insert; an edit during an in-flight push survives per op); push phase order
(delete phase before upserts; recomputed PR insert never meets its old row); deleting a
never-pushed workout → the server never hears of it (delete no-op, stale upsert lines retired);
tree reconciliation removes server-deleted sets but spares rows with pending lines; workout
tombstone clears the local tree *and* its outbox lines, and wins over a pending title edit
(the settled rule); PR tombstone spares a locally newer or pending row (recreation guard);
edit validation — an over-limit RPE/notes edit throws before anything is saved (shared
`limits.ts` path); a thrown recompute rolls the whole edit back (same-transaction proof);
`exerciseSessions`/`listPastWorkouts` reflect deletions; V5 upgrades a V4 file preserving
outbox lines as `upsert`. **B08's and B13's suites pass unmodified** — the seam-is-a-refactor
proof. Gate 2 live probe: apply the migration; as a synthetic user delete a workout whose set
holds a PR → tombstones rows appear for the workout and the cascaded PR row; user B reads no
tombstones of A's; explicit demote choreography (delete then insert) leaves the lower value;
keep-best still blocks a plain lowered update; advisors clean.

## Out of scope (and where it lands)

- **Server-side recompute / authoritative PR arbitration** — B18+ when a server function
  exists; until then client-computed rows, with the documented multi-device demotion race.
- **Tombstone retention/cleanup** — speculative; DEFERRED note instead.
- **Editing `started_at`, visibility, or the feed's view of edits** — B26/B20.
- **Account-switch wipe, poison-row quarantine** — unchanged B07 deferrals.
- **Trends** — nothing exists to recompute; the derive-from-raw-rows rule above is the
  guarantee future steps inherit.
- **Undo for deletes** — the confirm dialog is the guard; an undo/trash can is speculative.

## Risks a reviewer should weigh

1. **The outbox op semantics and push phasing are the correctness linchpin.** Demotion is
   *only* correct because the delete phase precedes the upsert passes and watermarks are
   per-op. A coalescing bug (clearing both ops' lines on one ack, or upserting before
   deleting) doesn't error — it silently leaves the server's keep-best holding a value the
   lifter no longer owns. The choreography tests must pin line-level sequences, not just end
   states.
2. **The pull now deletes local data.** Tree reconciliation and tombstone application are the
   first code paths that destroy device rows on the server's word. The pending-lines guard
   (and the PR recreation timestamp guard) are what stand between them and destroying offline
   work; each guard needs its own adversarial test, and the workouts-delete-wins decision is
   deliberate and documented — a reviewer should confirm its outbox-line cleanup really
   strands nothing.
3. **The `WritePolicy` seam touches the kill-safety core.** The draft path must be behaviorally
   identical (B08/B13 suites unmodified are the proof), and the edit path's
   recompute-in-the-same-transaction claim is the whole reason a killed edit can't leave PRs
   stale — a second-transaction "optimization" would quietly reopen that window.

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session (headless: the question tree
worked at full severity; Gate 1 is where Tristen overrules). Questions that changed or
sharpened the plan:

- **"Rework the keep-best trigger, as B13 ordered?"** Examined and refused with an argument
  (its own section above): no server-side predicate separates legitimate demotion from the
  stale-device push, but the *operation shape* does — finishes only raise (update-guarded),
  recomputes demote via delete+insert (trigger never fires). The B13 instruction's intent —
  demotions must become possible — is met; the trigger text is not touched. The tie deferral
  is settled as last-write-wins (argued above).
- **"Soft-delete (`deleted_at`) instead of tombstones?"** Rejected: a soft delete keeps the
  lifter's "deleted" workout on the server indefinitely — NFR-6's deletion promises make that
  a lie — and every reader forever filters a flag. Hard delete + a minimal tombstone table
  confines the complexity to sync.
- **"Why not tombstone every table?"** Entries/sets deletions are always inside a re-stamped
  workout; the pull's re-download-whole-workout semantics already carry everything needed —
  reconciliation is a `where not in` plus the pending guard, cheaper than per-row tombstones
  and triggers on the two highest-churn tables.
- **"Reuse the logger via the store seam, or a separate edit store?"** The seam. A parallel
  edit store re-implements renumbering, superset relinking, validation and the serialized
  queue — the mirrored-copy bug in store form. The seam's cost is confined: one constructor
  parameter, draft behavior pinned by existing suites.
- **"Edits saved immediately, or buffered behind a Save button?"** Immediately. Buffering
  needs new draft machinery for already-synced rows (the draft path rightly refuses finished
  workouts), invents an unsaved-changes state the app has nowhere else, and dies badly on
  kill. Immediate writes ride the existing outbox; "Done" is just navigation. Each operation
  re-stamps the root, and the outbox's watermark design already coalesces an edit burst into
  one upload per row.
- **"Recompute per operation — isn't that wasteful?"** One indexed query over tens-to-hundreds
  of rows per touched exercise, on a phone, per user action — unmeasurable; and per-operation
  recompute in the same transaction is the only shape where a kill cannot strand wrong PRs.
  The alternative (recompute on Done/unmount) reopens exactly the window B08 exists to close.
- **"Does `recomputeRecords` belong in `@training-math`?"** No — same boundary B13 drew:
  the fold and the ε-rule are math and already live there; diffing fold output against stored
  rows into row writes and outbox ops is persistence orchestration. Nothing rule-shaped is
  added app-side.
- **"One uniform delete+insert choreography for every changed row?"** This round's sharpest
  catch, against the plan's own first draft: a *raise* expressed as delete+insert would delete
  a concurrently-set higher record from another device before inserting the lower raise — the
  exact clobber keep-best arbitrates, and a plain update survives it (105 against 110 keeps
  110). So delete+insert is confined to strict demotions; raises and equal-value source
  changes ride plain upserts and keep keep-best's protection. Uniformity lost, correctness
  won.
- **"Tombstone pass first or last?"** First was the draft; last is correct. A demoting device
  still holds its re-created row with a device-clock stamp until the PR pass delivers the
  server copy, and a device clock behind the server defeats the timestamp guard — tombstones
  first could transiently delete the device's own re-creation. Tombstones last, guard as
  defense, PR pull pass as restorer; every crash ordering shown to converge.
- **"What stops the pull's reconciliation from eating offline work?"** The pending-lines
  guard, tested adversarially (a set logged offline against an old workout survives the next
  pull). And reconciliation only ever touches children of workouts the server just served —
  a draft workout never appears there.
- **"A deleted workout's PR promotion on a device that dies before pushing?"** The server is
  left post-cascade with no promoted row until that device returns or any device next finishes
  that exercise (the fold re-seeds). Accepted: the same self-healing argument B13 recorded.
- **"Why does the workout tombstone beat a pending local edit, when pull's rule is
  edits-win?"** Because the losing alternative is resurrection: the pending line re-inserts a
  workout row whose children are unrecoverable (their rows are gone on both ends), producing a
  permanent empty husk. Edits-win protects data that still exists; here the data the edit
  decorates is gone. Decision recorded in the pull section.
- **Scope verdict:** right as written. The edit screen, delete action, recompute and its full
  sync round-trip are one inseparable correctness story; everything that merely *reads* PRs
  or workouts stays with its own step (B18 analysis, B20 feed, B25 profiles).
