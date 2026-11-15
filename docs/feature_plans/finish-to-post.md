# finish-to-post — B21: the post step after every finish

**Branch:** `finish-to-post` (from `main`)
**Build step:** B21 — covers **LOG-7** (Finish → analysis → offer to post with a flair) in full.
**Depends on:** B18 (the analysis screen Finish already lands on; `workout_analyses.id` is the
workout id) and B20 (`posts` + `flairs` tables with RLS, the Home feed that shows own posts, the
client-generated post id and `unique (workout_id)` built for exactly this step).

## Step definition of done (from the Build order)

After the analysis, a Post step with flair selection, skippable, creating a workout post that
links the workout and its analysis. **The flow always runs after finish and can be skipped at
the post step.**

## Scope readings settled up front

- **"Always runs" means the sequence is always offered, not that it cannot be escaped.** Finish
  always lands on the analysis in *finish mode*, whose primary action leads to the Post step;
  the Post step always offers Skip. The phone's Back gesture can still leave the analysis early —
  that is an implicit skip, and no flow on a phone can prevent it. The route tests pin the
  sanctioned path: finish → analysis → Next → Post step → (Post | Skip).
- **"Links the workout and its analysis" needs no new column.** `posts.workout_id` links the
  workout, and the analysis's primary key *is* the workout id (B18 G4), so the post reaches both
  through one id. An explicit FK to `workout_analyses` was weighed and rejected (G3 below).
- **Offline finishes post too — the queued-post decision (left to this planner by the B20
  handoff) is settled as: queue it.** Finishing in airplane mode is a core, tested path of this
  app, and the post offer is one-shot at finish; an online-only Post button would be dead
  exactly when the app's defining strength is being used, with no re-entry point ever. B20 built
  the idempotency pieces for this (client-generated `posts.id`, `unique (workout_id)`), and the
  outbox already has the precedent of a non-training table with its own push phase
  (`user_settings`, B15). Grilled at G1.
- **No visibility picker, no caption box.** The step scope names *flair selection* only. The
  post's `visibility` defaults to the workout's own `visibility` (B20's G7 note: this keeps the
  two states from diverging), read from the device workout row. Changing either visibility is a
  privacy-settings concern (B26); captions were never in any scope sentence.
- **No server migration.** `posts`, `flairs`, their RLS and the `unique (workout_id)` constraint
  shipped in B20 and were probed live. B21 is app-side only.

## The flow

1. **`finish()` in `active-workout.tsx`** keeps replacing to the analysis, now with a flag:
   `/analysis/[id]?post=1`. Only a fresh finish carries the flag — the saved-workout screen's
   Analysis button and deep links never do, so old workouts are not re-offered (one post per
   workout is the B20 schema rule; a re-offer surface would fight it).
2. **The analysis screen in finish mode** (`post=1`) adds a primary **Next** button (above
   "View workout", which stays). Next pushes `/post-workout/[id]`. Pushed, not replaced, so Back
   from the Post step returns to the analysis — reading your numbers again before posting is
   reasonable, and the analysis's own Back still lands on the Workout tab as today.
3. **The Post step** (`frontend/src/app/post-workout/[id].tsx`, declared in the signed-in
   guard): the workout's title/date line, a flair chip picker rendering the device `flairs`
   rows ordered by `position` (never hard-coded names — SOC-3 holds; the lowest-position flair
   is preselected), a primary **Post** button and a ghost **Skip** button.
   - **Post** calls `createWorkoutPost` (below), then replaces to Home — where the lifter's own
     post appears (B20 G6 put own posts in the feed for exactly this loop). Offline, the post is
     queued and Home shows its offline message; the post appears on the next connection.
   - **Skip** replaces to the Workout tab, creating nothing.
   - **Guards:** workout missing/foreign/unfinished → the standard "isn't on this phone" empty
     state with Back. A post already existing for this workout (re-entered flow, multi-device) →
     a short "Already posted" state with a button to Home. Flairs table empty (never synced —
     sign-in requires a connection and the first sync pulls them, so this is near-unreachable) →
     Post disabled with one line saying flairs haven't synced; Skip always works, so the flow's
     DoD survives even this state.

## Creating the post (`frontend/src/social/createPost.ts`)

`createWorkoutPost(db, userId, workoutId, flairId)`:

- Reads the workout row (must exist, be the user's, and be finished); refuses otherwise.
- Refuses when a local post for this workout already exists (`unique` on the device table too —
  the check and the constraint agree).
- In **one transaction**: inserts the device `posts` row — id from `lib/ids.ts` (the app's one
  client-id home, random v4 from expo-crypto), `visibility` copied from the workout row,
  `created_at` = now — and enqueues the outbox line with the existing `enqueueTx(tx, 'posts',
  id, now)`. Same-transaction enqueue is the outbox's standing rule: a saved post is never
  missing from the queue. `writeLocal` is not reusable here (it is `SyncedTable`-typed and
  applies the touch-the-root rule, which posts don't want), so this module owns its own small
  transaction — the B15 `user_settings` arrangement.
- After the transaction commits, call the exported `notifyLocalWrite(db, ['posts'])` — verified:
  it takes `OutboxTable`, and the engine's listener syncs on any table — so a connected phone
  uploads within the debounce window with no explicit sync call from the screen (B18 G11:
  screens have no engine handle, and still don't).
- `hasPostForWorkout(db, workoutId)` — the Post step's "already posted?" read. The screen also
  disables Post while the call runs; the device `unique (workout_id)` backstops a double-tap
  that slips past both.

## Data model impact (device only)

**Schema V8** (`frontend/src/db/schema.ts`, `MIGRATIONS` gains one entry), two tables:

```sql
create table flairs (          -- pull-only mirror of the server's founder-curated rows
  id           text primary key not null,
  name         text not null,
  position     integer not null,
  upvotes_only integer not null
);
create table posts (           -- the lifter's OWN posts, written at the Post step, push-only
  id         text primary key not null,
  user_id    text not null,
  flair_id   text not null,
  workout_id text not null unique,
  visibility text not null,
  created_at text not null,
  updated_at text not null
);
create index posts_workout_idx on posts (workout_id);
```

Mirror conventions as established (no device FKs/CHECKs beyond the precedent; text timestamps).
Neither table joins `SyncedTable` — the compiler keeps refusing generic uploads/pulls of them:

- **`flairs` is pull-only, replace-all.** The server table has no `updated_at` (B20 kept it
  bare), so no cursor: each pull calls a new `pullFlairs()` transport method (select all — four
  rows today) and replaces the device table in one transaction. The step runs **last** in
  `pullChanges`, after every cursor pass, so a failure costs only the flairs refresh (earlier
  cursors are already saved; the next sync retries). A failed read leaves the old rows — stale
  flairs beat no flairs.
- **`posts` is push-only.** `OutboxTable` widens to `SyncedTable | 'user_settings' | 'posts'`
  (plain text in storage — no stored-data change). `pushOutbox` gains a **posts phase** modeled
  on `pushUserSettingsPhase`, ordered **after the training passes** in the same run: a queued
  post's workout FK is satisfied because the workout uploads first, and a training-push failure
  throws before the posts phase, so a post can never arrive before its workout. The phase reads
  each pending device row, calls `transport.pushPost(row)` (an upsert keyed on `id`, sent
  without `updated_at` like every upload — retries are idempotent; RLS's `owns_workout` insert
  check passes because the workout just landed, and B20 shipped both the insert and update
  policies the upsert's conflict path needs), and acknowledges with the standard watermark rule
  (`pendingRows`/`acknowledge` are already `OutboxTable`-typed — verified, no signature
  changes). `PushResult` gains a `posts` count.
- **Refusal handling in the posts phase:** a `23505` unique violation on `workout_id` (another
  device posted this workout first) is mapped by `pushPost` to a typed "already posted" error;
  the phase deletes the local row and clears its lines — the workout has its post, the queue
  must not wedge. Any other refusal follows the standard policy: stop, keep the lines, retry
  next sync.
- **Deletion hygiene (poison-row prevention):** deleting a workout locally (B14 path) also
  deletes its device post row and drops its pending `posts` outbox lines (`dropLinesTx`) in the
  same transaction — the exact place B18 already deletes the local analysis row
  (`deleteLocalRowsTx`'s workouts branch), since the device has no FK cascade. Server-side the
  B20 cascade removes the post; the fake transport's delete cascade mirrors it so tests can
  prove the clean queue. Without this, a queued post for a deleted workout would be refused
  forever and block the posts phase behind it.

**Not done:** no pull of posts (the feed reads the server; "already posted?" only matters on
the finishing device, in the one-shot flow), no `SYNC_ORDER` change, no tombstones for posts
(they die with their workout), no server schema change.

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/db/schema.ts` (+ test) | edit — V8: device `flairs` + `posts` tables |
| `frontend/src/db/dao.ts` (+ test) | edit — `PostRow`, `FlairRow` types + the mirror-table column lists; workout local-delete also removes its post row and outbox lines |
| `frontend/src/sync/outbox.ts` | edit — `OutboxTable` gains `'posts'` (type only) |
| `frontend/src/sync/push.ts` (+ test) | edit — posts phase after the training passes; `PushResult.posts` |
| `frontend/src/sync/pull.ts` (+ test) | edit — flairs replace-all step; `PullResult` count |
| `frontend/src/sync/transport.ts`, `supabaseTransport.ts` | edit — `pushPost`, `pullFlairs`; 23505 → typed already-posted error |
| `frontend/src/test-utils/fakeTransport.ts` | edit — in-memory `posts` (unique workout_id enforced) + seeded `flairs` |
| `frontend/src/social/createPost.ts` (+ test) | new — `createWorkoutPost`, `hasPostForWorkout` |
| `frontend/src/db/flairs.ts` (+ test) | new — read device flairs by position; replace-all writer (or folded into dao.ts — builder's call, one home either way) |
| `frontend/src/app/post-workout/[id].tsx` | new — the Post step screen |
| `frontend/src/app/analysis/[id].tsx` | edit — finish mode (`post=1`): Next button |
| `frontend/src/app/active-workout.tsx` | edit — finish() carries `post=1` |
| `frontend/src/app/_layout.tsx` | edit — declare the route in the signed-in guard |
| `frontend/src/__tests__/post-workout.test.tsx` | new — route/flow tests (never in `src/app/`) |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) — device tables; finish → analysis → post path |

Builder footguns (precedent B09–B20): regenerate typed routes with `npx expo start --offline`
(~150 s) **before** `tsc --noEmit` → lint → Jest — this step adds a route. No migration to
apply or rename this time. The screen modules take `db` and read flairs locally; nothing in the
flow touches the network directly — the outbox and the engine's triggers do all the talking.

## How the definitions of done become observably true

All Jest, fake transport/fake clients, never the live project:

- **"The flow always runs after finish"** — a flow test drives the logger's Finish and asserts
  the analysis renders with Next; tapping Next renders the Post step with the seeded flair
  chips (names from rows, not literals — asserted with a flair name no code mentions).
- **"Can be skipped at the post step"** — Skip creates no device row, no outbox line, and lands
  on the Workout tab; re-finishing another workout offers the flow again.
- **"Creating a workout post that links the workout and its analysis"** — Post writes one device
  row whose `workout_id` is the finished workout's id (= its analysis's id) and one outbox
  line; a sync run against the fake pushes it after the workout and the fake server holds
  exactly one post with that `workout_id` and the chosen flair.
- **Offline (the queued-post decision)** — finish and Post with the fake transport dead: row +
  line persist (and survive a simulated relaunch — they are in SQLite); transport healed → one
  sync → the post is on the fake server exactly once; a second sync changes nothing.
- **Idempotency / refusals** — pushing the same post twice leaves one row; a 23505 from the
  fake (other-device post seeded) drops the local row and clears the line without throwing;
  deleting a workout with a queued post leaves no row, no line, and the next push is clean.
- **Defaulted visibility** — a followers-only workout yields a followers-only post row.
- **LOG-7's own DoD** is the first two bullets together; the live half is Tristen's device run
  (finish on the phone → post → the post visible on a second account's Home), which flips
  Built → Done.

## Out of scope (and where it lands)

- Post visibility picker, caption/text on posts — B26 (privacy/settings) / never asked.
- Image and progress-pic posts, media limits — B22.
- Votes, comments, `upvotes_only` enforcement — B23.
- Share cards and OS share sheet after posting — B28 (it depends on this step).
- Re-offering a post from old saved workouts, deleting/editing a post, changing its flair —
  later SOC steps; today a post is made in the finish flow or not at all.
- Pulling posts to the device / multi-device post state — no reader exists.

## Risks a reviewer should weigh

1. **The posts push phase is new sync machinery.** It widens `OutboxTable` a second time and
   adds a third phase shape (insert-like upsert with FK ordering and a mapped unique-violation).
   The ordering argument — training passes throw before the phase runs, so a post can't precede
   its workout — must stay true if `pushOutbox`'s structure ever changes; the test pinning
   "workout push fails → no post push" is the guard.
2. **Flow interruption windows.** Kill the app between Post and the push: covered (row + line in
   SQLite). Kill between finish and the Post step: the flow is gone — the workout is finished,
   analysable, but was never offered again. Accepted: re-offering collides with one-post-per-
   workout and the no-re-entry reading; the lifter lost an offer, not data.
3. **The near-unreachable empty-flairs state** (post step before any sync ever) ships as a
   disabled Post with an explanatory line. If sign-up-then-airplane-mode turns out to be a real
   path, the fix is seeding flairs at first sign-in, not hard-coding names.

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session at full severity; checkable claims
verified in the repo (transport/push/outbox/engine sources, B18/B20 plan files, device schema).

- **G1 — "Queueing posts widens the sync surface for a social feature; why not online-only with
  a retry toast?"** Worked through both. Online-only fails the product shape, not just polish:
  the offer is one-shot at finish, finishes happen offline by design (the PRD's basement-gym
  case), and "retry" has nowhere to live once the flow is left — the offer would be
  permanently lost for every offline finish. The machinery cost was measured against the repo,
  not guessed: `OutboxTable` was built to widen (text column, B15 precedent), the phase shape
  exists (`pushUserSettingsPhase`), and B20 explicitly minted the client id and
  `unique (workout_id)` so a queued post is idempotent. Settled: queue, with the deletion
  hygiene and 23505 mapping as the two anti-wedge obligations.
- **G2 — "Is the flairs mirror speculative? Four rows could be fetched when the screen opens."**
  A live fetch is dead offline, which is the exact case G1 just paid for; caching the last
  fetch in kv-store is a second storage mechanism for table rows (worse than the mirror
  pattern the schema already has). The mirror is four rows, replace-all, no cursor — the
  cheapest spelling that keeps SOC-3's "data, not code" true offline. Kept.
- **G3 — "Should the post link the analysis explicitly (FK to `workout_analyses`)?"** No: the
  analysis's key *is* the workout id (B18 G4), so `posts.workout_id` already names it; an FK
  would also make a post refusable when the analysis row hasn't been computed yet (the
  offline-finish case — the analysis request needs the server), coupling the post to a row
  that arrives later. The scope's "links the workout and its analysis" is satisfied by one id
  reaching both; recorded so B23+ readers don't add the column.
- **G4 — "Next-button flow vs. auto-advancing vs. post step inline on the analysis."**
  Auto-advance steals the analysis from the lifter (ANA-1 says finish *opens its analysis* —
  it must be readable, not a splash screen). Inline chips on the analysis muddy a screen three
  steps already share (B18 numbers, B19 muscle map) and make "skipped" unobservable. The
  pushed screen keeps each step testable and Back-navigable. Kept, with the "always = always
  offered" reading stated up front.
- **G5 — "Posting a private workout makes a post nobody can see — should the flow skip it?"**
  The DoD says the flow always runs, and today no UI can even set a workout private (default
  'public', picker lands with B26). The inherited visibility means the post is exactly as
  visible as the workout — B20 G7's intended invariant. When B26 ships visibility controls, it
  owns the question; one line here records it.
- **G6 — "Why does Skip land on the Workout tab but Post on Home?"** Each lands where the
  result is: a skip ends the logging loop (tab), a post's result is a feed item (Home, where
  own posts show — the B20 G6 loop this step closes). Asymmetric on purpose; one-line change
  if device feel disagrees.
- **G8 — "Can `createWorkoutPost` ride `writeLocal` instead of owning a transaction?"** No —
  checked: `writeLocal` is generic over `SyncedTable` (posts deliberately isn't one) and
  applies the touch-the-root re-stamp that belongs to training rows only. The settled shape is
  the B15 one: an own small transaction using the shared `enqueueTx`, then the exported
  `notifyLocalWrite` — both verified to accept `'posts'` once `OutboxTable` widens, so no
  dao signature changes at all.
- **G9 — "A flairs-refresh failure aborting the whole pull would be a tail wagging a dog."**
  Caught in grilling: the draft didn't say *where* in `pullChanges` the step runs. Settled:
  last, after every cursor pass has saved its bookmark, so the blast radius of a failed
  four-row read is nil (the engine logs, the next sync retries, stale rows serve meanwhile).
- **G10 — "What stops a double-tap on Post from queueing two posts?"** Three layers, none new
  machinery: the button disables while the write runs; `createWorkoutPost` re-checks
  `hasPostForWorkout` inside its transaction; the device table's `unique (workout_id)` makes
  the second insert throw rather than write. The server's own unique is the final backstop.
- **G7 — facts checked in the repo:** (a) `finish()` replaces to `/analysis/[id]`; the screen
  re-reads on focus and is keyed by id — a `post` param rides `useLocalSearchParams` with no
  rework. (b) `OutboxTable` is already `SyncedTable | 'user_settings'`; outbox stores `tbl` as
  text. (c) `pushOutbox` runs delete passes → training passes → settings phase and throws on
  the first failure — the posts phase slots after settings with the FK-ordering guarantee
  described. (d) Device `workouts` rows carry `visibility` (dao + schema) — the default copy
  is a local read. (e) Server `flairs` has no `updated_at` — replace-all, not cursor, is
  forced, matching the plan. (f) `notifyLocalWrite(db, tables: readonly OutboxTable[])` is
  exported and the engine's listener ignores the table name — any notify requests a sync.
  (g) `lib/ids.ts` is the client-id home (random v4, expo-crypto). (h) Device schema is at V7
  (`MIGRATIONS` has seven entries) — this step's migration is V8 as planned. (i) B20's RLS
  gives posts owner insert **and** update policies, both checking `owns_workout` — the upsert's
  conflict path is covered.
- **Scope verdict (planner):** right as written. The queued-post machinery is the one place this plan
  spends beyond the obvious, and it is spent on the step's own DoD being true for offline
  finishes — the alternative quietly made LOG-7 online-only. Nothing else widened; the
  visibility picker and captions explicitly refused.

## Deviations during the build (builder run)

- **Flair refresh failure is recorded, not thrown.** G9 put the flairs step last; the builder
  found a throw there would still mark the whole pull failed and make the engine skip the B18
  analysis requests. So `pullChanges` catches it into `PullResult.flairsError` (count 0, old rows
  kept) and the engine logs it — the "blast radius nil" G9 intended.
- **An empty flair answer is ignored** (old rows kept), not written as "no flairs": the server
  always has flairs, so empty can only be a broken read, and an empty list would disable Post.
- **Tombstone hygiene too.** The plan's deletion hygiene named only the local delete path (B14).
  A workout deleted on *another* device (the pull's tombstone pass) leaves the same poison row, so
  `applyTombstone` also calls `deleteWorkoutPostsTx`. Same helper, both paths.
- **`unknown-flair` refusal.** `createWorkoutPost` also refuses a flair not on the phone's list —
  the server's flair FK would refuse it forever and wedge the queue.
- **Device schema V8 has no `posts_workout_idx`.** The `unique (workout_id)` constraint already
  creates an index that serves the "already posted?" lookup; review flagged the second as
  redundant, and V8 had not shipped, so it was dropped before commit.
- **`flairs` and `posts` joined `MirrorRowByTable` / `TABLE_COLUMNS`** (not `SyncedTable`), so
  the schema test pins their columns and `getRowsByIds('posts')` serves the push phase; the
  generic upload and bookmarked-download paths still refuse both at compile time.
- **One helper for "forget this post":** `dao.deletePostsTx` (post rows + their outbox lines),
  used by the workout-delete paths and by the push phase's 23505 drop (review: duplicated code).
- **Kept as the plan said:** Next pushes the Post step; Post → Home, Skip → Workout tab; the
  posts phase runs after the settings phase (so a failing settings upload also holds posts back —
  noted in `pushPostsPhase`).
