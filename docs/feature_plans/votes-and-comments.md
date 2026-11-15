# votes-and-comments — B23: votes with a net score, and comments

**Branch:** `votes-and-comments` (from `main`)
**Build step:** B23 — covers **SOC-4** (up/down votes with net score; Physique Check is
upvote-only) and **SOC-5** (comments), both in full.
**Depends on:** B20 (`posts` + `flairs` with `upvotes_only` already on the flair row, the Home
feed and `PostCard`, `private.workout_visible` as the one visibility home) and through it B22's
post kinds (votes and comments apply to every kind of post alike).

## Step definition of done (from the Build order)

`votes` (one per user per post, net score view) and `comments` tables with RLS; no downvote
control on Physique Check posts and a database check that rejects one. **Scores tally correctly
and a downvote on a Physique Check post is refused by the API.**

## Scope readings settled up front

- **UI is in scope.** Both covered features are listed non-partial and their DoDs are UI-facing
  ("no downvote control *exists*", "users *can comment* … and *see* others' comments"), and the
  step scope itself says "no downvote control on Physique Check posts". So B23 ships the vote
  controls on the feed card and a comments screen, not just tables.
- **Votes and comments are online-only, both reads and writes** — the product call the B22
  handoff left to this planner, settled as: you can only vote on or comment about a post you are
  looking at, and posts are only ever on screen when the feed loaded, which needs a connection.
  There is no offline moment where the action is possible, so an outbox/mirror (the B21
  machinery) would be spent on a state that cannot occur. Writes are optimistic in the UI and
  revert with a message on refusal. This does not touch the offline-first rule, which is about
  logging and the Tool Kit. Grilled at G1.
- **"A database check that rejects one" is a trigger, not a CHECK constraint.** The refusal must
  read `flairs.upvotes_only` through the post row (handoff standing input: data, never a
  hard-coded flair name), and a Postgres CHECK cannot contain a subquery. A `before insert or
  update` trigger on `votes` is the honest spelling of the same enforcement. Grilled at G2.
- **Vote and comment visibility follows the post's, through the post row — one home.** A new
  `private.can_view_post(pid)` definer helper mirrors the existing `private.can_view_workout`
  exactly: `exists (select 1 from posts p where p.id = pid and private.workout_visible(p.user_id,
  p.visibility))`. Every votes/comments policy that asks "may the current user see this post?"
  calls it; the visibility rule itself stays spelled once in `workout_visible`.
- **Comment length is capped on the server and mirrored in one app module**, the
  B22 `mediaLimits.ts` precedent: a CHECK in the migration and
  `frontend/src/social/commentLimits.ts`, each commented to change with the other.

## Data model (one migration: `votes`, `comments`, the score view, the triggers)

### `votes` — one row per user per post

```sql
create table public.votes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),   -- up or down, nothing else
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, user_id)                           -- one vote per user per post
);
```

The composite primary key *is* the one-vote rule. Changing your mind is an update (up → down)
or a delete (unvote); the app's `castVote` upserts on the key, so a retried tap lands on the
same row. Standard `moddatetime` trigger on `updated_at`. An index on `post_id` comes free with
the PK (it is the leading column); no second index until a measured need.

### `comments` — flat, in conversation order

```sql
create table public.comments (
  id         uuid primary key default gen_random_uuid(),  -- server-generated: comments are
                                                          -- online-only, so no client id needed
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Mirrored by COMMENT_MAX_CHARS in frontend/src/social/commentLimits.ts — change together.
  -- The btrim guard refuses whitespace-only bodies: a blank bubble is not a comment (G11).
  body       text not null check (char_length(body) between 1 and 500 and btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_post_created_idx on public.comments (post_id, created_at, id);
```

Flat (no `parent_id` — threading is a feature nobody has asked for), oldest-first (a
conversation reads top to bottom). 500 characters: comments are conversation, not essays, and
raising a cap later is a safe migration while lowering one is not. `gen_random_uuid()` default
where B20's posts deliberately had none: that decision existed for offline retries, which
comments don't have.

### The net score view (named in the step scope)

```sql
create view public.post_scores
  with (security_invoker = true) as
  select p.id as post_id,
         coalesce(v.score, 0)::int   as score,
         coalesce(c.comments, 0)::int as comment_count
  from public.posts p
  left join (select post_id, sum(value) as score    from public.votes    group by post_id) v
    on v.post_id = p.id
  left join (select post_id, count(*)   as comments from public.comments group by post_id) c
    on c.post_id = p.id;
```

`security_invoker` so the posts/votes/comments RLS of the *viewer* applies — the view adds no
new reading power and the Supabase security advisor stays quiet (a definer view would warn).
Built on `posts` so every visible post has a row (score 0, not absent), and so PostgREST can
infer the posts → post_scores embed from the base table's key. `comment_count` rides in the
same view deliberately: the feed card needs it, and counting via an embedded `comments(count)`
aggregate would bet on PostgREST aggregate support being enabled on the live project — the view
is the spelling that cannot be configuration-dependent. Flagged as the one borderline scope
reading (G3): the scope sentence names a "net score view", and this is that view with one extra
column serving the same card.

### RLS

```sql
-- votes: seeing a post means seeing its score truthfully, so every viewer of the
-- post sees all its votes — the tally is the same number for everyone.
create policy "votes visible with their post"   on public.votes for select
  to authenticated using (private.can_view_post(post_id));
create policy "users vote as themselves"        on public.votes for insert
  to authenticated with check (user_id = (select auth.uid()) and private.can_view_post(post_id));
create policy "users change their own votes"    on public.votes for update
  to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.can_view_post(post_id));
create policy "users remove their own votes"    on public.votes for delete
  to authenticated using (user_id = (select auth.uid()));

-- comments: same shape. Insert requires the commenter to be able to see the post
-- ("comment on any VISIBLE post" — SOC-5); no update policy at all (no edit UI; RLS
-- refuses updates by default), delete own (removing your own words is table stakes).
create policy "comments visible with their post" on public.comments for select
  to authenticated using (private.can_view_post(post_id));
create policy "users comment as themselves"      on public.comments for insert
  to authenticated with check (user_id = (select auth.uid()) and private.can_view_post(post_id));
create policy "users delete their own comments"  on public.comments for delete
  to authenticated using (user_id = (select auth.uid()));
```

Two deliberate boundaries, recorded for B27 (moderation): a comment or vote by someone who has
since blocked the viewer still shows (filtering *content authors* by block/mute is exactly
B27's scope sentence); and a post's author cannot delete other people's comments on their post
(founder removal lands with B27's service-role function).

### The upvote-only enforcement (the step's named database check)

```sql
create or replace function private.vote_allowed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.value = -1 and exists (
    select 1 from public.posts p
    join public.flairs f on f.id = p.flair_id
    where p.id = new.post_id and f.upvotes_only
  ) then
    raise exception 'This post takes upvotes only';
  end if;
  return new;
end $$;

create trigger votes_upvote_only
  before insert or update on public.votes
  for each row execute function private.vote_allowed();
```

Reads `upvotes_only` through posts → flairs — no flair name anywhere in the rule, so a future
upvote-only flair needs no code change (the handoff's standing input). `security definer` like
the existing `private.*` helpers, so the check consults the true rows, not RLS-filtered ones.
The refusal reaches the app as SQLSTATE `P0001`, which `castVote` maps to a calm message.

One companion guard closes the back door the trigger alone leaves open: an owner updating a
post's `flair_id` *to* an upvotes-only flair while downvotes exist would smuggle downvotes onto
a Physique Check post. Nothing in the app changes a post's flair today, so the guard simply
refuses:

```sql
create or replace function private.flair_change_allowed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.flair_id <> old.flair_id
     and exists (select 1 from public.flairs f where f.id = new.flair_id and f.upvotes_only)
     and exists (select 1 from public.votes v where v.post_id = new.id and v.value = -1) then
    raise exception 'This flair takes upvotes only and the post has downvotes';
  end if;
  return new;
end $$;

create trigger posts_flair_guard
  before update of flair_id on public.posts
  for each row execute function private.flair_change_allowed();
```

Migration applied live via MCP, file renamed to the recorded version (builder prompt covers
this since B11). **No device schema change, no dao change, no sync change** — votes and
comments never touch SQLite or the outbox.

## App modules (all take the Supabase client as a parameter; tests use fakes)

### `frontend/src/social/votes.ts` (+ test)

- `castVote(client, me, postId, value)` — upsert on `(post_id, user_id)` with
  `onConflict: 'post_id,user_id'`. Maps SQLSTATE `P0001` to a typed `upvotes-only` refusal (the
  card reverts its optimistic state and shows the message) and an RLS refusal (post no longer
  visible) to a generic one.
- `clearVote(client, me, postId)` — delete my vote row (tapping the active arrow again).
- `voteDelta(oldValue, newValue)` — the pure optimistic-score math (e.g. up → down is −2),
  unit-tested; the card applies it instantly and reverts on refusal. The *display* number is
  still always the server's on the next feed load — the client never becomes a second home of
  the tally.

### `frontend/src/social/comments.ts` (+ test)

- `loadComments(client, postId)` — `comments` with `author:profiles(id,username,display_name)`,
  ordered `created_at asc, id asc`, limit 200 (a launch-scale post has tens; keyset paging of
  comments is a recorded follow-up, not speculative machinery now). When exactly 200 arrive the
  screen shows one "More comments exist" line (G12) — honesty without paging machinery. Typed at
  the seam like `RawFeedPost`.
- `addComment(client, me, postId, body)` — validates through `commentLimits` first (no doomed
  request), inserts, returns the server row (`.select().single()`) so the screen appends the
  real thing.

### `frontend/src/social/commentLimits.ts` (+ test)

`COMMENT_MAX_CHARS = 500` (mirrors the CHECK — commented to change together, the
`mediaLimits.ts` precedent) and `commentBodyError(body)` → the one refusal sentence (empty or
whitespace-only after trimming, or over-cap — mirroring the CHECK's two clauses), used by both
the composer's disabled state and `addComment`.

### `frontend/src/social/feed.ts` (edit, + test)

- `FEED_SELECT` gains: `upvotes_only` on the flair embed (the card's "render a downvote
  control?" fact, straight from the row); `scores:post_scores(score,comment_count)`;
  `my_vote:votes(value)`.
- `loadFeedPage` gains the viewer id and filters the aliased embed `.eq('my_vote.user_id', me)`
  — the one PostgREST way to embed "my vote" without pulling every vote row.
- `RawFeedPost` / `FeedPost` gain `flair.upvotesOnly`, `score`, `commentCount`,
  `myVote: 1 | -1 | null`, shaped in `toFeedPost` (a missing scores embed shapes to 0 — a
  broken reply renders a quiet card, never a crash).

## Screens and components

| Piece | Change |
|---|---|
| `components/social/PostCard.tsx` (edit, + test) | A footer row: upvote arrow, the net score, downvote arrow — the downvote simply not rendered when `flair.upvotesOnly` (data-driven; no flair name in code) — and a comment affordance ("n comments" / "Comment") opening the comments screen. Arrows reflect `myVote`, apply `voteDelta` optimistically, revert with the message on refusal. Vote/comment handlers arrive as props (the card stays presentational, like `photoSource`). |
| `app/post-comments/[id].tsx` (new) | The comments screen for one post, pushed from the card: the list oldest-first (author line via `personLabels` + `LetterAvatar`, body, date), a composer at the bottom (`maxLength` from `commentLimits`, counter near the cap, Send disabled while invalid or in flight), the new comment appended from the server's reply. Offline / failed load → the feed's "needs a connection" message with Retry. Declared in the signed-in guard in `_layout.tsx`. |
| `app/(tabs)/index.tsx` (edit) | Passes the viewer id to `loadFeedPage` and the vote/comment handlers to the cards. |
| `frontend/src/__tests__/post-comments.test.tsx` (new) | Route tests (never in `src/app/` — expo-router rule). |

## Offline / sync / privacy / rules check

- **Offline-first:** untouched where it applies (logging, Tool Kit). Votes/comments are
  online-only by the G1 decision; the screens degrade to the same message the feed already uses.
- **One home:** visibility via `workout_visible` through `can_view_post` — zero new spellings;
  the tally lives in the database view, the client only ever adjusts a displayed number
  optimistically; the comment cap has one server CHECK and one app mirror.
- **RLS, never client-side:** votes and comments carry their policies from birth; hiding the
  downvote control is UX — the trigger is the enforcement (the step DoD's own wording).
- **Physique Check / privacy:** enforced from `flairs.upvotes_only` as data; no new exposure —
  votes and comments are exactly as visible as the post they hang on.
- **Nothing speculative:** no comment threading, no votes on comments, no realtime, no
  hot-score math (B24 builds its ranked view on these tables), no keyset paging of comments at
  launch scale, no notification hooks (B47).
- **No AI, no numeric product claims:** none involved.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_votes_comments.sql` | new — `votes`, `comments`, `post_scores` view, `can_view_post`, both triggers, RLS |
| `frontend/src/social/votes.ts` (+ test) | new |
| `frontend/src/social/comments.ts` (+ test) | new |
| `frontend/src/social/commentLimits.ts` (+ test) | new |
| `frontend/src/social/feed.ts` (+ test) | edit — embeds, viewer id, shaping |
| `frontend/src/components/social/PostCard.tsx` (+ test) | edit — vote footer, comment affordance |
| `frontend/src/app/(tabs)/index.tsx` | edit — wiring |
| `frontend/src/app/post-comments/[id].tsx` | new — comments screen |
| `frontend/src/app/_layout.tsx` | edit — route in the signed-in guard |
| `frontend/src/__tests__/post-comments.test.tsx` | new — route tests |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) |

Builder footguns (precedent B09–B22): this step adds a route — regenerate typed routes with
`npx expo start --offline` (~150 s) **before** `tsc --noEmit` → lint → Jest. Apply the
migration live via MCP, then rename the file to the version `list_migrations` records. The
embed filter must reference the *alias* (`my_vote.user_id`), not `votes.user_id`. The
`post_scores` embed arrives as an object or a one-element array depending on how PostgREST
reads the view's key — shape both at the seam and pin it with the Gate 2 live read, since the
fake client cannot prove PostgREST's inference.

## How the definitions of done become observably true

- **"Scores tally correctly" (step DoD + SOC-4):** unit tests pin `voteDelta` and the
  `toFeedPost` shaping; the card test seeds votes through the fake and asserts the printed
  score. Live, Gate 2 probes as seeded users: up + up + down on one post → the view reads 1;
  changing a vote up → down moves the score by 2; unvoting restores it; a user's second vote
  replaces (never duplicates) their first — the PK makes a wrong tally structurally impossible.
- **"A downvote on a Physique Check post is refused by the API" (step DoD):** Gate 2 probes a
  `value = -1` insert *and* an up→down update on a `physique-check` post as a real user — both
  raise. Both probes exist because `castVote`'s upsert has two arms (`insert … on conflict do
  update`) and the trigger must hold on each. The same refusal is pinned in Jest through the
  fake's trigger simulation, and `castVote` maps it to the typed error.
- **The aliased-embed filter and the view embed are proven live, not assumed:** a Gate 2 read of
  the feed query as a real user asserts `my_vote` returns at most the viewer's own row on a post
  holding several users' votes, and that the `post_scores` embed arrives at all — the two
  PostgREST behaviors the fake client cannot vouch for.
- **"No downvote control exists on Physique Check posts" (SOC-4):** PostCard test renders a
  post whose flair row has `upvotes_only: true` (under a name no code mentions, proving it is
  data-driven) and asserts no downvote control is in the tree, while an ordinary flair renders
  both arrows.
- **SOC-5 "comment on any visible post and see others' comments":** route test — load a post's
  comments seeded from two users (both render, oldest first, right names), type past the cap
  (Send disabled, the one refusal sentence), send a valid one (appears from the fake server's
  reply). Live, Gate 2 probes: A comments on B's public post and B reads it; a comment on a
  followers-only post is invisible to a stranger but visible to a follower; a 501-char body is
  refused by the CHECK; an update to someone's comment is refused (no policy); C's comment on a
  post whose author C has blocked is refused (`can_view_post` → `workout_visible` → block).

## Out of scope (and where it lands)

- Ranked/hot sort and flair filtering — **B24** (it builds its own view on these tables).
- Reporting, muting, founder removal, filtering blocked users' comments/votes out of view —
  **B27**.
- Notifications for votes and comments — **B47**.
- Comment editing and threading, votes on comments, comment keyset paging — later SOC steps,
  on evidence of need.
- Vote/comment counts on a profile, Marketplace votes (MKT-2 follows "the post pattern") —
  **B25** / **B41**.

## Risks a reviewer should read first

1. **The `post_scores` embed is the one novel PostgREST surface.** Embedding a
   `security_invoker` view hangs on PostgREST inferring the posts → view relationship from the
   base table. It is the documented behavior, the fake pins the app-side shape either way, and
   the fallback is mechanical (two extra filtered embeds or a second query by post ids), but
   only Gate 2's live read proves it. The builder must not silently switch strategy — if the
   embed fails live, the fallback goes in this file as a deviation.
2. **Online-only votes and comments (G1)** is a product call made by this plan: an airplane-mode
   lifter cannot vote on a card they can see in a stale list — except there is no stale list
   (the feed renders only from a live load). If the feed ever gains a cache, this decision must
   be revisited *then*, not pre-paid now.
3. **The trigger pair is the enforcement story.** The votes trigger is the step's named check;
   the posts-side flair guard closes the retag back door. Both are `security definer` plpgsql —
   small, but the kind of code where a wrong `search_path` or a missed `update` case quietly
   voids the DoD; the Gate 2 probes exercise insert *and* update paths on purpose.

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session at full severity; checkable claims
verified against the repo (migrations, `feed.ts`, `PostCard.tsx`, `index.tsx`, the B20–B22 plan
files and handoff).

- **G1 — "Online-only social writes: you built an outbox for posts in B21, why not votes?"**
  Because the precondition differs, not the appetite: a post is created at *finish*, which
  happens offline by design; a vote/comment is created at the *feed*, which exists only online.
  The handoff left this open as "a product call" and this is it, with the revisit trigger
  named (risk 2): any future feed cache reopens it. The cost avoided is real — two more
  `OutboxTable` widenings, pull mirrors for other people's votes, and conflict rules for a
  tally the server owns.
- **G2 — "The step scope says *database check*; a trigger is not a CHECK constraint — are you
  narrowing?"** No — a CHECK cannot read another table (Postgres forbids subqueries in CHECK;
  smuggling one behind a function in a CHECK is the documented-fragile spelling: not
  re-validated on flair changes, dump/restore hazards). The scope's own standing input
  ("a trigger or CHECK joining posts → flairs", per the handoff) already blessed the trigger.
  The DoD sentence — refused by the API — is what the trigger makes true.
- **G3 — "`comment_count` in the net score view is scope creep."** Weighed against the
  alternatives: an embedded `comments(count)` aggregate depends on PostgREST aggregate support
  being enabled on the live project (not provable from the repo; betting the card on it is the
  speculative choice), and a second view just for a count is two surfaces where one serves.
  The column rides in the scope-named view, flagged here so Gate 1 decides with eyes open.
  Striking it = the card shows "Comment" with no count; one line in this file.
- **G4 — "Why may every viewer see individual vote rows, not just the sum?"** Because the sum
  must be the same number for everyone who sees the post, and `security_invoker` means the
  view can only sum what the viewer may select. Restricting votes to owner-only would make
  every score read as "my vote and nothing else". Individual votes are not sensitive under the
  privacy rule (progress pics, body data, recovery data); who-upvoted-what is ordinary social
  data (Reddit shows tallies; the app's UI still only ever *shows* the sum). Revisit only if a
  product decision wants anonymous voting.
- **G5 — "An optimistic score is a second home of the tally."** It is a *delta on a displayed
  number*, not a computed tally: `voteDelta` knows only old-vote → new-vote arithmetic, the
  server's view remains the single source, and every feed load replaces the displayed number
  wholesale. The alternative — waiting for a round-trip on every arrow tap — is worse UX for
  zero correctness gain (the revert path shows the truth on refusal).
- **G6 — "500 characters: who decided?"** This plan, as a starting posture: raising a text cap
  is a safe one-line migration; lowering one strands existing rows. The number is spelled in
  exactly two places (CHECK + `commentLimits.ts`), commented to change together — the
  `mediaLimits` precedent. Overruling it is a one-line Gate 1 edit.
- **G7 — "Does the comments screen need the post at the top?"** Wanted, not needed: SOC-5's DoD
  is about comments, the card already showed the post, and rendering a full PostCard inside the
  comments route would drag the vote wiring into a second screen. Settled: comments + composer
  only, post context is the card the lifter just tapped. A richer post-detail screen is a later
  step's call (B20 already deferred tapping through to the workout).
- **G8 — "The flair guard trigger protects against an update no UI can make — speculative?"**
  It guards an *invariant*, not a feature: the DoD says no downvotes on Physique Check posts,
  and without the guard that statement is false the day any flair retag path appears (B27's
  moderation tooling is already on the horizon). Ten lines, probed at Gate 2 alongside the main
  trigger. The B22 precedent (`posts_image_in_own_folder`) settled that closing schema back
  doors at birth is this repo's style.
- **G9 — "`limit 200` on comments with no paging — B13's history got the same shortcut and it
  is still on the deferred list."** Accepted and recorded the same way: at launch scale a post
  has tens of comments; the ordering (`created_at asc, id asc`) and the index already match
  the keyset shape, so adding paging later is additive. The follow-up lands in DEFERRED at the
  Document step, like B13's.
- **G10 — facts checked in the repo:** (a) `flairs.upvotes_only` exists and is seeded true for
  `physique-check` only (B20 migration, lines 33–51). (b) `private.workout_visible(owner, vis)`
  and the definer-helper pattern (`can_view_workout`, `owns_workout`, `set search_path = ''`)
  exist in the training migration — `can_view_post` mirrors them. (c) `FEED_SELECT` embeds
  flair/author/workout and `loadFeedPage` has no viewer parameter yet; `index.tsx` calls it in
  two places that both have `me` in scope. (d) `PostCard` takes `post: FeedPost` plus optional
  props — adding handler props follows the existing `photoSource` pattern. (e) No `votes`,
  `comments` table, no view, and no `post-comments` route exist anywhere today; nothing
  collides. (f) `personLabels`, `LetterAvatar`, `EmptyState`, the feed's offline message, and
  the `throwIfError` seam all exist for reuse. (g) `moddatetime` trigger spelling matches the
  posts migration. (h) B24's scope ("hot score in a Postgres view") builds *beside* this view,
  not on top of it — nothing here pre-shapes it.
- **G11 — "Whitespace-only comments pass `char_length between 1 and 500`."** Caught in
  grilling: a body of spaces is a blank bubble, not a comment. Settled: `btrim(body) <> ''`
  added to the CHECK, `commentBodyError` trims before judging — server and mirror still change
  together, one refusal sentence covers empty and blank alike.
- **G12 — "`limit 200` with no indicator would silently hide a 201st comment — that falsifies
  'see others' comments'."** Settled: when a full 200 arrive, the screen says "More comments
  exist" — one conditional line, no paging machinery; real keyset paging stays a recorded
  follow-up (the order and index already match its shape).
- **G13 — "Voting on your own post?"** Allowed — no rule speaks against it and refusing it
  would be a policy nobody asked for. The app never auto-upvotes the author's own post (writing
  rows the user didn't ask for is not this app's style); a decision, not an omission.
- **Scope verdict:** right as written. One flagged reading (`comment_count` in the view, G3),
  one product call the handoff explicitly delegated (online-only, G1), one invariant guard
  beyond the letter of the scope (the flair-change trigger, G8, ten lines). Nothing narrowed;
  threading, comment votes, paging and moderation explicitly refused.
