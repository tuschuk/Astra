# posts-and-feed — B20: posts, flairs, follows UI, and the Home feed

**Branch:** `posts-and-feed` (from `main`)
**Build step:** B20 — covers **SOC-1** (Home feed of followed accounts, newest first),
**SOC-3** (one flair per post; flair list is data, not code), and the UI half of **SOC-7**
(one-way follows — the `follows` table + RLS have existed since B02; profile counts are B25's).
**Depends on:** B05 (auth — a signed-in user and the Supabase client), B09 (the logger — real
workouts exist to post), and through them B07's sync and B11/B12's set shapes that the feed must
print.

## Step definition of done (from the Build order)

`posts` and `flairs` tables (launch flairs as rows: WOD, Physique Check, New PR, Form Check),
one flair per post, RLS that honors blocks; workout post type; Home feed of followed users
newest first with pagination; follow and unfollow from a user card. **A followed user's workout
post appears on Home in reverse-chronological order and a stranger's does not.**

## Scope readings settled up front

- **B20 builds the pipes; B21 builds the faucet.** Post *creation* UI is explicitly B21
  (finish-to-post). In B20 no screen creates a post, so the step DoD is made observable by
  seeded rows: Jest seeds posts through the fake client, and Gate 2's live probe inserts posts
  by SQL as two real users and reads the feed as each. That is how every schema-before-UI step
  here has been proven (B02's RLS probes), and the DoD sentence is about *reading*, not writing.
- **"Follow and unfollow from a user card" needs a place where another user's card can appear.**
  Nothing in the app shows another user today, and the feed only shows people you *already*
  follow — a chicken-and-egg. The smallest surface that makes the follow action observable on a
  device is a **Find lifters** screen reached from Home: search profiles by name, each result a
  user card with a Follow/Following button. That is the one place the card lives in B20; the
  profile screen (B25) becomes the fuller surface later and reuses the same card. This is read
  as *inside* scope — the scope sentence names the action, and an action needs a surface — but
  it is the one borderline call, flagged for Gate 1 (G2).
- **Feed reads are server-side, with no outbox and no local mirror** (handoff standing input):
  other users' data is never mirrored on the device, so the feed is an online read. Offline,
  Home says so and everything else in the app still works. This does not touch the offline-first
  rule — that rule is about *logging and the Tool Kit*, which don't change here.
- **The feed prints sets through `format.ts`** (`formatSet` / `formatDropSet` / `supersetRuns` /
  `groupDropSets`), which closes LOG-13's "and the feed" clause and keeps the one-spelling rule.
  No formatting logic is written anywhere else.

## Data model (one migration: `posts` + `flairs`)

### `flairs` — the flair list as rows (SOC-3)

```sql
create table public.flairs (
  id       text primary key,          -- stable slug: 'wod', 'physique-check', 'new-pr', 'form-check'
  name     text not null,             -- what the chip shows: 'WOD', 'Physique Check', …
  position smallint not null unique,  -- display order in pickers and chips
  -- Physique Check posts take upvotes only (CLAUDE.md privacy rule). B23 builds votes and
  -- reads this column; putting it on the row now is what keeps B23 data-driven instead of
  -- hard-coding a flair name in the votes check.
  upvotes_only boolean not null default false
);
```

Seeded in the same migration: WOD, Physique Check (`upvotes_only = true`), New PR, Form Check.
RLS on, one policy: readable by `authenticated`. No client write policies at all — adding a
flair is a migration (extensible as *data*, exactly what SOC-3's DoD asks). A text-slug primary
key over a uuid: flair ids will be written into client code paths (B23's vote rule, B21's
picker defaults) and `'physique-check'` is self-describing in a way a uuid never is; the table
is founder-curated data, not user data, so slug stability is in our hands.

### `posts` — one feed item

```sql
create table public.posts (
  -- Client-generated, like workouts.id: B21 creates posts on the phone right after Finish,
  -- possibly offline, and a retried upload must land on the same row. No default on purpose.
  id         uuid primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  flair_id   text not null references public.flairs (id),          -- exactly one flair (SOC-3)
  -- The workout this post shares. Not null today: the workout post is B20's only post type.
  -- B22 (image posts) relaxes this with its own migration when a second type exists —
  -- building a `kind` discriminator now for types that don't exist would be speculative.
  workout_id uuid not null references public.workouts (id) on delete cascade,
  -- One post per workout: posting the same session twice is a double-post, and B21's
  -- finish-to-post flow needs "already posted?" to be answerable from the schema.
  unique (workout_id),
  visibility public.workout_visibility not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posts_user_created_idx on public.posts (user_id, created_at desc, id desc);
create index posts_flair_idx on public.posts (flair_id);
```

`on delete cascade` from `workouts`: deleting a workout deletes its post (Strava's model — the
activity is the substance, the post is its shadow). The `visibility` column reuses the existing
`workout_visibility` enum — same three values, same meaning, and PROJECT_OVERVIEW's decision
"any single post can be made private" needs it on the post row. No caption/text column: neither
B20 nor B21's scope mentions one; adding a column later is a one-line migration.

### RLS — the visibility rule stays in its one home

```sql
-- Read: the same rule workouts already live by, from the same helper. A block in either
-- direction hides the post; 'followers' needs the viewer to follow the author; owners
-- always see their own. private.workout_visible(owner, vis) takes only an owner and a
-- visibility, so it is the post rule too — no second spelling of the rule anywhere.
create policy "posts readable per their visibility"
  on public.posts for select to authenticated
  using (private.workout_visible(user_id, visibility));

-- Write: owners only, and a post may only share a workout the poster owns — otherwise any
-- user could publish someone else's (even private) workout id under their own name and
-- the feed's inner join would leak nothing but its existence; owns_workout closes it flat.
create policy "users post as themselves"
  on public.posts for insert to authenticated
  with check (user_id = (select auth.uid()) and private.owns_workout(workout_id));

create policy "users update their own posts"
  on public.posts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.owns_workout(workout_id));

create policy "users delete their own posts"
  on public.posts for delete to authenticated
  using (user_id = (select auth.uid()));
```

Plus the standard `moddatetime` trigger on `updated_at`. **No device schema change, no dao
change, no sync change:** posts are not mirrored, the outbox doesn't know them, `TABLE_COLUMNS`
is untouched. The migration is applied live via MCP and the file renamed to the recorded
version (builder prompt covers this since B11).

## The feed read (`frontend/src/social/feed.ts`)

A module that takes the `SupabaseClient` as an argument (the `createSupabaseTransport` pattern —
tests hand it a fake, nothing here touches the singleton):

1. **Who am I showing?** One query: `follows` where `follower_id = me` → followee ids. The feed
   authors are those ids **plus me** — your own post appearing on your own Home is how a lifter
   with zero follows ever sees the feed work (Strava does the same), and it makes B21's "post
   it → see it" loop closeable on one phone.
2. **The page query.** `posts` selected with PostgREST embeds, filtered
   `user_id in (followees + me)`, ordered `created_at desc, id desc`, page size 20:
   - `flair:flairs(id, name)` — the chip.
   - `author:profiles(id, username, display_name)` — the card header (avatar images are B25;
     the card shows an initial).
   - `workout:workouts!inner(id, title, notes, started_at, ended_at, workout_exercises(id,
     position, superset_group, exercise:exercises(name), sets(id, position, reps, weight_kg,
     rpe, is_warmup, drop_set_position, duration_seconds, score)))` — everything the card
     prints. The **inner** join is deliberate: workouts' own RLS filters the embed, so a post
     whose workout the viewer may not see (owner tightened the workout to private after
     posting) drops out of the feed entirely instead of rendering an empty husk. The workout
     visibility rule keeps working through its one home without the posts policy re-spelling it.
   - Pagination is keyset, not offset: after a page, the next page filters
     `created_at.lt."ts", and(created_at.eq."ts", id.lt.last_id)` — the `afterCursorFilter`
     pattern from `supabaseTransport.ts` pointed the other way. New posts arriving while
     scrolling never shift or duplicate a page.
3. **Shaping.** The raw embed is sorted (entries by `position`, sets by `position`) and mapped
   to a typed `FeedPost` the card renders. RLS does all gatekeeping; the module never filters
   "may I see this" client-side.

The step DoD falls straight out: followed user's post → their id is in the author list and RLS
passes → on Home, newest first. Stranger's post → their id is not in the author list → absent
(and even a hand-written query as the viewer gets nothing not public — RLS, probed at Gate 2).

## Follows and search (`frontend/src/social/follows.ts`)

Same injected-client pattern, three functions:

- `searchLifters(client, me, query)` — `profiles` where `username ilike %q%` or `display_name
  ilike %q%`, excluding me and anyone on my own block list (`blocks` where `blocker_id = me` is
  readable; filtering people I blocked out of my own search is UX, not security — RLS remains
  the enforcement everywhere it matters), limit 20, min 2 characters. The search term is
  sanitized before it is interpolated into the `.or()` filter string — PostgREST's filter
  syntax gives `,`, `(`, `)`, `%` and `_` meanings, so they are stripped/escaped and the
  remainder matched literally; a weird search returns few results, never a 400 (G9). Also
  returns which results I already follow (one `follows` query) so each card renders its true
  state.
- `follow(client, me, userId)` — insert into `follows`. RLS enforces follower = me and refuses
  when a block exists in either direction (`blocked_either`, live since B02); the module maps
  that refusal to a calm error, telling the blocked user nothing they don't already know.
- `unfollow(client, me, userId)` — delete my follow row.

## Screens and components

| Piece | What it does |
|---|---|
| `app/(tabs)/index.tsx` (rewrite) | Home: a FlatList of `PostCard`s, newest first; pull-to-refresh; infinite scroll calling the next keyset page; a "Find lifters" header action. Empty states: not following anyone → today's empty state plus a Find-lifters button; offline / request failed → "The feed needs a connection" with Retry (the rest of the app keeps working offline). |
| `components/social/PostCard.tsx` | One post: author line (initial avatar, display name, @username, post date via `format.ts`), flair chip, workout title (or `workoutDateLabel`), `workoutDetailsLabel` line, then the exercises — `supersetRuns` → cards, `groupDropSets` → one row per thought-of set, `formatDropSet`/`formatSet` in the **viewer's** display unit (`useDisplayUnit`). Workout notes shown; per-set notes left to the detail view that doesn't exist yet (a feed card is a summary, not the whole workout). Long workouts truncate after 4 exercises with "+ n more". Not tappable in B20 — another user's workout has no local row and no detail screen until a later step. |
| `components/social/UserCard.tsx` | A profile row: initial avatar, display name, @username, and a Follow/Following button that calls `follow`/`unfollow` optimistically (reverting with a message on refusal). The one card SOC-7's action lives on; B25 reuses it. |
| `app/find-lifters.tsx` | Search box (debounced) over `searchLifters`, results as `UserCard`s, reached from Home. Route test lives in `src/__tests__/` (expo-router rule). |
| `workout/format.ts` | Gains `postDateLabel(createdAt)` — "Today", "Yesterday", else `workoutDateLabel` — the feed's one new piece of spelling, in spelling's one home. |

New flair names are never hard-coded in the app: the chip renders `flair.name` from the
embedded row (SOC-3's "data, not code" holds end to end).

## Offline / sync / privacy / rules check

- **Offline-first:** untouched where it applies (logging, Tool Kit). The feed is an online
  read by standing instruction; offline Home degrades to a clear message, and nothing queues.
- **One home for training math / spelling:** no new math; all set text via `format.ts`; the
  visibility rule via `private.workout_visible` — zero new spellings of either.
- **RLS, never client-side:** posts carry their own policies from birth; the workout embed is
  filtered by workouts' existing RLS; blocks are honored inside `workout_visible` (step scope's
  "RLS that honors blocks").
- **Physique Check / privacy:** `flairs.upvotes_only` is the row-level fact B23's vote check
  will read; nothing in B20 precludes it. No sensitive data is newly exposed: the feed shows
  only what workout RLS already allowed.
- **Nothing speculative:** no realtime subscription (pull-to-refresh is the launch feed; the
  ranked sort, votes, comments are B23+), no `kind` column for post types that don't exist, no
  feed cache table.
- **No AI, no numeric product claims:** none involved.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_posts_flairs.sql` | new — `flairs` (+ seed rows), `posts`, RLS, trigger, indexes |
| `frontend/src/social/feed.ts` (+ `feed.test.ts`) | new — followee read, keyset page query, embed shaping |
| `frontend/src/social/follows.ts` (+ test) | new — `searchLifters`, `follow`, `unfollow` |
| `frontend/src/components/social/PostCard.tsx` (+ test) | new — the feed card, printing through `format.ts` |
| `frontend/src/components/social/UserCard.tsx` (+ test) | new — profile row + Follow/Following |
| `frontend/src/app/(tabs)/index.tsx` | rewrite — the feed list, refresh, pagination, empty/offline states |
| `frontend/src/app/find-lifters.tsx` | new — search screen |
| `frontend/src/__tests__/home-feed.test.tsx`, `__tests__/find-lifters.test.tsx` | new — route tests (never in `src/app/`) |
| `frontend/src/workout/format.ts` (+ test) | edit — `postDateLabel` |
| `docs/diagrams/database-erd.md` | edit (Document step) — `posts`, `flairs`, their RLS |
| `docs/diagrams/app-flow.md` | edit (Document step) — Home feed path, Find lifters |

Builder footguns (precedent B09–B19): regenerate typed routes with `npx expo start --offline`
(~150 s) **before** `tsc --noEmit` → lint → Jest — this step adds a route, so skipping it will
fail tsc. Apply the migration live via MCP, then rename the file to the version
`list_migrations` records. The feed/follows modules take the client as a parameter; tests use
hand-rolled fakes (the `fakeAuthClient`/`fakeTransport` style), never the live project. The
embed response comes back untyped from supabase-js (there are no generated DB types in this
repo): follow `supabaseTransport.ts`'s discipline — declare the expected row shapes as TS
types and cast once at the response seam, shaping/sorting into `FeedPost` right there; no
`any`, and no half-typed rows leaking into components (G11).

## How the definitions of done become observably true

- **Step DoD:** a route test renders Home with a fake client seeded with three users — me, a
  followee with two posts (older + newer), a stranger with one — and asserts: both followee
  posts render, **newer first**, and the stranger's never does. A second test pages: 25 seeded
  posts → first page of 20, scroll → the remaining 5, no duplicates across the boundary.
- **SOC-1:** the Home test above, plus the pull-to-refresh and offline-state tests.
- **SOC-3:** schema side — migration probed live at Gate 2 (a post with no flair or two flairs
  is impossible by shape: `flair_id not null` + one column); app side — the card's chip text
  comes from the embedded flair row, asserted with a flair name no code mentions.
- **SOC-7 (B20's part):** UserCard test — Follow inserts my follow row, the button flips to
  Following, Unfollow deletes it, a refused insert (block) reverts and explains; `follows`
  table + RLS already live (B02), re-probed at Gate 2 with the posts probes.
- **LOG-13's feed clause:** a PostCard test seeds a WOD-style workout (timed + scored sets,
  a drop set, a superset) and asserts the card prints exactly what `formatSet` /
  `formatDropSet` return — one spelling, now provably in the feed.
- **Gate 2 live probes (SQL via MCP, two seeded users):** follow A→B; B posts public → A's
  feed query returns it, stranger C's does not; B posts `followers` → A sees it, C doesn't even
  by direct select; C blocks B → C's feed and direct selects return nothing of B's; workout
  flipped private → the post drops from A's feed (inner join); insert post with someone else's
  workout_id → refused; second post for the same workout → refused (unique).

## Out of scope (and where it lands)

- Post creation UI, flair picker, post visibility picker — **B21** (finish-to-post).
- Votes, comments, the ranked sort, enforcement of `upvotes_only` — **B23**.
- Image/progress-pic posts, relaxing `posts.workout_id`, media limits — **B22**.
- Profiles, avatars, follower/following counts, the rest of SOC-7 — **B25**.
- Post detail screen / tapping through to another user's workout, muscle map on feed cards —
  a later social step; the card is a self-contained summary in B20.
- Realtime feed updates (ARCHITECTURE mentions Realtime for feeds) — speculative until a
  measured need; pull-to-refresh at launch.
- Deleting/reporting posts from the feed UI, mute (distinct from block) — later SOC steps.

## Risks a reviewer should weigh

1. **The embed query is the load-bearing novelty.** One PostgREST select with three nested
   levels (posts → workouts → entries → sets) and an inner-join visibility dependency. If
   supabase-js mis-builds it or RLS makes it crawl, the whole step wobbles. Mitigations: the
   shape is pinned by unit tests against a fake; Gate 2 probes it live against real RLS; page
   size 20 keeps the row count honest; the `posts_user_created_idx` matches the sort exactly.
2. **One post per workout (`unique (workout_id)`)** is a product rule being set in a schema
   step. It blocks "re-share my PR from last month" style reposts unless B21+ deletes and
   reposts. Settled as: a repost feature would be its own row-shape decision later; today the
   constraint is what makes finish-to-post idempotent. Gate 1 can strike the constraint with no
   other change to the plan.
3. **Find lifters is a scope reading, not a scope sentence.** It is the minimal surface for
   "follow and unfollow from a user card", but it *is* a new screen with search semantics
   (ilike, debounce, block filtering) that B20's DoD never names. If Gate 1 reads it as
   widening, the fallback is UserCards without search (e.g. a bare username entry) — the card
   and the follows module survive unchanged.

## Grilling decisions (settled)

Run in the planner session at full severity; every checkable claim verified in the repo.

- **G1 — "No creation UI means the DoD is proven by fixtures — isn't the step hollow?"** No:
  the DoD sentence is about what *Home shows*, and Home is real, the RLS is real, the live
  probes write real rows as real users. The alternative — pulling B21's post flow forward —
  was rejected as scope widening with a real cost (the finish flow touches the analysis screen
  B18 owns), and the Build order deliberately sequenced it after.
- **G2 — "Find lifters: where does scope end?"** Attacked hardest. Options weighed: (a) no
  surface — SOC-7's action unobservable on a device, DoD of the *step* still provable but the
  covered feature's UI half silently missing; (b) follow from the post author's header — only
  reaches people you already follow (can only unfollow) plus strangers never appear, circular;
  (c) a minimal search screen. Settled on (c) as the smallest honest surface, kept to one
  screen + one query, recorded as risk 3 so Gate 1 decides with eyes open.
- **G3 — "Why `workout_id not null` when B22 will relax it?"** Because today every post *is* a
  workout post, and a nullable column with no second type is a lie about the data. A
  `kind` discriminator was weighed and rejected the same way: it encodes B22's design before
  B22's planner has thought. Relaxing a constraint is a cheap, honest migration when the
  second type actually exists.
- **G4 — "Reusing the `workout_visibility` enum for posts smells like a pun."** Weighed a new
  `post_visibility` enum: identical values, two enums to keep aligned forever, and
  `workout_visible(owner, vis)` — the single home of the visibility rule — takes the existing
  enum. The name is slightly off (it is really *content* visibility); renaming the type is
  gratuitous churn on live data. Kept, noted here so the ERD can say so.
- **G5 — "Keyset pagination — is offset `range()` not cheaper?"** Offset breaks under the
  feed's own normal behavior: a new post while scrolling shifts every page, duplicating or
  skipping cards. The keyset filter is one `.or()` string already proven in this codebase
  (`afterCursorFilter`). Equal-timestamp ties are handled by the `id` tiebreak, not wished
  away.
- **G6 — "Own posts in the feed — scope says *followed* users."** Included deliberately
  (decision, not drift): a zero-follow user otherwise stares at an empty Home forever, B21's
  post-then-see loop needs it, and Strava does exactly this. The DoD's two assertions (followed
  appears, stranger doesn't) are unaffected. One line to remove if overruled.
- **G7 — "Inner-join on the workout: a post can exist that nobody's feed shows?"** Yes — post
  public, workout private → invisible everywhere but the owner's own feed. Judged correct, not
  a bug: the workout is the content; a visible shell around hidden content ("you can't see
  this workout") is worse. B21 should default post visibility = workout visibility so the
  states rarely diverge; noted for its planner.
- **G8 — "`unique (workout_id)` — who asked?"** See risk 2. Kept because idempotency for B21
  beats a repost feature nobody has designed; struck in one line at Gate 1 if overruled.
- **G9 — "What happens when someone searches for `50%,()`?"** Caught in grilling: the draft
  interpolated the raw search term into a PostgREST `.or()` filter, whose syntax reserves `,`,
  `(`, `)`, and where `%`/`_` are `like` wildcards. Settled: sanitize the term (strip the
  reserved characters, escape the wildcards) before interpolation and pin it with a test that
  searches for exactly that kind of garbage. Few results is fine; a 400 is not.
- **G10 — "`in (followees + me)` puts the whole follow list in the request — why not a
  server-side view?"** Weighed a `security_invoker` view (`posts ⋈ follows where follower =
  auth.uid()`): it moves the author filter into SQL and scales past any follow-list length,
  but PostgREST embedding across a view needs FK inference hints, it adds a second queryable
  surface to secure and explain, and at launch scale the in-list is a few hundred bytes.
  Settled: in-list now; the switch point is *measured* — if a real user's follow list makes
  the request URL long enough to matter (~thousands of followees), that evidence buys the
  view, per the add-nothing-speculative rule. Recorded so it isn't re-litigated per step.
- **G11 — "The embed response is untyped — where does the no-`any` rule go to die?"** At the
  same seam the sync transport already solved it: declare the expected server row shapes as
  types, cast once where the response enters, shape immediately into `FeedPost`. Builder
  footnote added.
- **G12 — facts checked in the repo:** (a) `private.workout_visible(owner, vis)` takes exactly
  `(uuid, workout_visibility)` — reusable for posts as claimed; `owns_workout(wid)` exists for
  the insert check. (b) `follows` RLS: insert requires follower = me **and** no block either
  direction; select shows rows I'm part of; delete allows either side — `follow`/`unfollow`
  need no new policy. (c) `profiles` select policy is `using (true)` for authenticated — search
  works without policy changes; username is citext, `ilike` applies. (d) `formatSet` handles
  score-only, timed, warm-up, RPE; `groupDropSets`/`supersetRuns` are generic over row picks —
  the card can feed them server-shaped rows that satisfy the same picks. (e) No `posts` or
  `flairs` table exists in any migration today; nothing collides. (f) `useDisplayUnit` is the
  viewer-unit hook the card needs; `EmptyState`, `Card`, `Screen`, theme tokens all exist.
- **Scope verdict:** right as written, with one flagged reading (Find lifters, G2/risk 3) and
  one deliberate inclusion (own posts, G6). Nothing else widened; nothing narrowed.
