# moderation-and-safety — B27: report, block, mute, policy, removal

**Branch:** `moderation-and-safety` (from `main`)
**Build step:** B27 — covers **SOC-8** (report a post/comment; block and mute) and **NFR-7**
(content policy, report queue, removal tools — founder-run at launch), both listed non-partial.
**Depends on:** B23 (votes/comments and their RLS — this step adds the author-level filtering
B23's plan explicitly recorded as B27's), and through it B20–B26 (posts, images, profiles,
per-post privacy). `blocks`, its auto-unfollow trigger and `private.blocked_either` exist since
the identity migration and already hide posts, workouts, PRs and images in both directions —
B27 adds the *controls*, the `mutes` table, author-level filtering of comments and votes, the
report queue, the policy document, and the founder's removal function.

## Step definition of done (from the Build order)

Report a post or comment into a `reports` table the founder can read; mute (`mutes` table) and
block from a profile; blocked and muted users' content filtered server-side; content policy
document in `docs/`; removal of content or accounts through a service-role edge function.
**A report lands in the queue, a blocked user's content disappears for the actor, and the
founder can remove a post.**

## Scope readings settled up front

- **Block and mute controls live on the profile; Report lives on the content.** The scope
  sentence places them exactly there ("mute and block *from a profile*", "report *a post or
  comment*"). So: the profile screen gets Mute/Unmute and Block/Unblock; a post card and a
  comment row each get a small overflow (⋯) opening the report sheet. No block/mute shortcut on
  cards at launch — one home per control.
- **Mute = "their content disappears for me, everywhere", spelled inside `workout_visible`.**
  The DoD's own words are "muted users' content disappears for the actor", and the one honest
  server-side spelling is the same one blocks already use: a clause in
  `private.workout_visible`, the single home of the visibility rule. That makes mute hide the
  muted lifter's posts, workouts, PR history and photos from the actor on every surface — feed,
  profile tabs, storage reads — with zero per-query filters to forget. Mute differs from block
  in exactly three ways: it is one-directional (the muted lifter's view of the actor never
  changes and they are never told), it does **not** sever follows (the point of mute is to stay
  following without seeing), and it will not cut DMs when DMs arrive (block will — B48).
  Grilled at G2; the "feed-only mute" alternative is weighed there.
- **Comments and votes are filtered by their author too, not just by their post.** Today a
  comment by someone who has blocked the actor (or whom the actor muted) still shows on a third
  person's post — B23's plan recorded closing this as B27's job. A new `private.author_visible`
  helper (own content always; otherwise no block in either direction and not muted by the
  viewer) joins the `votes` and `comments` select policies. Consequence accepted and grilled at
  G3: the net score and hot score a viewer sees are sums of the votes *that viewer may see*, so
  two viewers can see slightly different tallies once blocks/mutes exist between people.
- **"The founder" is a `moderators` table, not a hard-coded id and not a JWT claim.** The
  handoff's standing input requires a definition. Chosen: `public.moderators`, keyed by profile
  id, written only by migration/service-role (no app write policies), consulted by a
  `private.is_moderator()` definer helper (reports RLS) and by the removal function. Seeding
  Tristen's row is a **live operation at build time** (service-role insert via MCP), never a
  uuid committed to a migration file — a fresh project seeds its own founder. An
  `app_metadata` claim was rejected at G4: it needs the auth admin API to manage, can't be
  joined in RLS as cheaply, and a table row is visible, auditable data.
- **Reports are an audit queue, so target ids are plain uuids — no FK to the content.** If
  `reports.post_id` cascaded from `posts`, an author could erase every report about their post
  by deleting it, and the founder's removal of content would erase the very queue rows that
  prompted it. Instead a report stores `target_kind` ('post' | 'comment'), `target_id` (no FK),
  and `reported_user_id` (FK to profiles, **stamped by a trigger from the true content row**,
  never client-supplied). A report survives the content's deletion; both reporter's and
  reported lifter's reports vanish with their accounts (FK cascade), honouring NFR-6. Grilled
  at G5.
- **The founder reads the queue in the Supabase dashboard at launch.** NFR-7 says founder-run;
  the dashboard (service role) is the founder's tool. The `reports` select policy still admits
  `is_moderator()` so an in-app queue screen can come later without a migration. No founder UI
  in the app this step.
- **Removal is one edge function, `moderate`, in the exact B18 shape** (`handler.ts` pure +
  `index.ts` Deno wrapper, `verify_jwt` on, caller resolved from their token, service role used
  for exactly the privileged statements). Actions: `remove-post`, `remove-comment`,
  `remove-account`. Caller must be in `moderators`, else 403 — checked server-side, never in
  app code.
- **The content policy is `docs/CONTENT_POLICY.md`** — plain language, founder-run, no legal
  claims and no numeric claims, categories matching the report reasons one for one. The scope
  sentence says "document in `docs/`", so no in-app policy screen this step (recorded as a
  DEFERRED follow-up: surfacing it in-app and at sign-up makes "published" stronger).
- **SOC-8's "block also cuts DMs" cannot be observable before DMs exist.** B48's own DoD says
  "a block cuts messaging" and depends on B27. This step makes everything else in SOC-8 true;
  Gate 2 should flip SOC-8 to Built with a note that the DM clause is enforced at B48 (same
  pattern as NFR-5's split). The step is not narrowed — there is no DM to cut today.

## Data model (one migration: `mutes`, `moderators`, `reports`, policy edits)

### `mutes` — "I don't want to see this person's content; don't tell them"

```sql
create table public.mutes (
  muter_id   uuid not null references public.profiles (id) on delete cascade,
  muted_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);
alter table public.mutes enable row level security;
create policy "users manage their own mute list" on public.mutes for all
  to authenticated using (muter_id = (select auth.uid()))
  with check (muter_id = (select auth.uid()));
```

Blocks' exact shape minus the auto-unfollow trigger (mute keeps the follow) and minus the
reverse-direction index (every lookup is "whom have *I* muted" — the PK's leading column).

### The mute spelling, once, and the visibility edits

```sql
-- One home for "has the viewer muted this author?"
create or replace function private.muted_by_viewer(author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mutes m
                 where m.muter_id = (select auth.uid()) and m.muted_id = author)
$$;
```

`private.workout_visible` is re-created with one added clause in its non-owner branch —
`and not private.muted_by_viewer(owner)` beside the existing blocks check. Every caller
(workouts, posts, post-images storage, `can_view_post`, `can_view_workout`, B25's profile
reads) inherits mute with no further edits: the rule still has one home.

```sql
-- May the viewer see content AUTHORED by `author` on someone else's surface?
create or replace function private.author_visible(author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select author = (select auth.uid())
      or (not private.blocked_either(author, (select auth.uid()))
          and not private.muted_by_viewer(author))
$$;
```

The `votes` and `comments` **select** policies are dropped and re-created as
`private.can_view_post(post_id) and private.author_visible(user_id)`. Write policies are
untouched (you still write only as yourself, on posts you can see). `post_scores` and
`post_hot_scores` are `security_invoker`, so the filtered tallies flow through with **no view
change**; the hot view's "same for everyone" comment is re-worded with `comment on view`.

### `moderators` — who the founder is, as data

```sql
create table public.moderators (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.moderators enable row level security;
create policy "users see their own moderator row" on public.moderators for select
  to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies: rows are written by migration or service role only.

create or replace function private.is_moderator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.moderators md
                 where md.user_id = (select auth.uid()))
$$;
```

Seed (live operation at build time, recorded in the handoff — not in the migration file):
`insert into public.moderators (user_id) values ('<tristen''s profile id>');`

### `reports` — the queue

```sql
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  target_kind      text not null check (target_kind in ('post', 'comment')),
  target_id        uuid not null,            -- no FK: reports outlive their content (G5)
  -- Stamped by the trigger below from the true content row; never trusted from the client.
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  -- Mirrors docs/CONTENT_POLICY.md's categories and REPORT_REASONS in
  -- frontend/src/social/moderation.ts — change the three together.
  reason           text not null check (reason in
                     ('spam', 'harassment', 'nudity', 'not-training', 'impersonation', 'other')),
  details          text check (char_length(details) <= 500),
  status           text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at       timestamptz not null default now(),
  unique (reporter_id, target_kind, target_id)   -- a re-tap lands on the same report
);
create index reports_open_idx on public.reports (status, created_at);
alter table public.reports enable row level security;

-- You report as yourself, about content you can actually see. The exists() subqueries run as
-- the reporter, so each table's own select policy (visibility + author filtering) is the gate —
-- the rule is not spelled again here.
create policy "users report what they can see" on public.reports for insert
  to authenticated with check (
    reporter_id = (select auth.uid())
    and ((target_kind = 'post'    and exists (select 1 from public.posts    p where p.id = target_id))
      or (target_kind = 'comment' and exists (select 1 from public.comments c where c.id = target_id)))
  );
create policy "moderators read the queue" on public.reports for select
  to authenticated using (private.is_moderator());
-- No app update/delete policies: the founder works the queue via service role / the function.
```

A `before insert` definer trigger (`private.stamp_reported_user`) overwrites
`new.reported_user_id` with the true author read from `posts` / `comments` by `target_id`, and
raises "That content is gone" if the row no longer exists. Definer, because the author of a
since-hidden comment must still be stampable while the insert policy already proved visibility
at the reporter's rights.

### What removal does to data (the edge function's writes, service role)

- **remove-post:** read the post (image path, author) → delete the `posts` row (votes, comments
  cascade; the author's private `workouts` row is **deliberately untouched** — moderation
  removes the shared content, not the training log) → if it was a photo post, remove the
  storage object at `image_path` → mark that post's open reports `resolved`.
- **remove-comment:** delete the `comments` row → mark its open reports `resolved`.
- **remove-account:** `auth.admin.deleteUser(id)` (cascades `profiles` → every owned row:
  workouts, posts, votes, comments, follows, blocks, mutes, settings, body data, analyses,
  records — the FK graph all roots in `profiles`) → delete every storage object under
  `post-images/<id>/` and `avatars/<id>/`. No report bookkeeping is needed: every report
  *about* the account cascades away with `reported_user_id`, and the reports *by* it with
  `reporter_id`. Refuses to remove a moderator's own account or another moderator (a
  founder locking themselves out by typo is a real risk; self-serve deletion is NFR-6's step).

## The `moderate` edge function

`backend/supabase/functions/moderate/handler.ts` (pure decisions) + `index.ts` (Deno wiring,
B18 template: `verify_jwt` on, caller resolved via `auth.getUser`, one client as the caller —
only to identify them — and one service-role client handed to the handler as `deps`).

Request: `POST /functions/v1/moderate` with `{ "action": "remove-post" | "remove-comment" |
"remove-account", "targetId": "<uuid>" }`. Answers: `200 { removed: … }`; `400` bad body;
`401` no/invalid token; `403` caller not in `moderators`; `404` target not found; `405` not
POST; `500` database failure. The moderator check reads `moderators` with the service client —
RLS can't be fooled into it, and a non-moderator learns nothing but 403.

The founder calls it with their own signed-in JWT (curl / a scratch script at launch; an in-app
founder surface is a later step). `handler.ts` takes a `ModerateDeps` interface exactly like
`AnalyzeDeps`, so `backend/supabase/functions/tests/moderate.test.ts` drives every action and
refusal against fakes — no real project touched.

## App modules and UI

### `frontend/src/social/moderation.ts` (+ test)

All take the Supabase client as a parameter (the repo's seam); all **online-only** like every
social write since B23 — these actions are only reachable from content on screen, which needed
a connection to load. Refusals map to the feed's calm connection message.

- `muteUser` / `unmuteUser` / `blockUser` / `unblockUser` — inserts/deletes on `mutes` /
  `blocks` as the actor (23505 on a re-tap is treated as already-done, the `castVote`
  precedent).
- `relationTo(client, me, profileId)` → `{ blocking, muting }` — one read of the actor's own
  rows for the profile screen's button states.
- `reportPost` / `reportComment` — insert into `reports`; 23505 (already reported) maps to the
  same thank-you as success; the trigger's "content is gone" and RLS refusals map to one calm
  sentence.
- `REPORT_REASONS` — the reason slugs and their on-screen words, one home mirroring the CHECK
  and the policy document (commented to change together, the `mediaLimits` precedent).

### Screens and components

| Piece | Change |
|---|---|
| `frontend/src/components/social/ReportSheet.tsx` (new, + test) | One modal used for posts and comments: reason list (radio via `ChoiceChips`), optional details box (500 cap from `moderation.ts`), Submit → thank-you line → closes. States: picking, sending, thanked, refused. |
| `components/social/PostCard.tsx` (edit, + test) | A small ⋯ button on **other people's** cards (own cards keep the visibility chip instead) opening Report post → `ReportSheet`. Handler arrives as an optional prop like the vote handlers; without it the ⋯ doesn't render (tests, no session). |
| `app/post-comments/[id].tsx` (edit; tests in `src/__tests__/post-comments.test.tsx`) | A ⋯ on other people's comment rows → `ReportSheet` for that comment. |
| `components/profile/ProfileView.tsx` (edit, + test) | On other people's profiles: Mute/Unmute and Block/Unblock (block behind a confirm dialog naming what it does: "neither of you will see each other; follows are removed both ways"). Button states from `relationTo`, loaded with the header. A muted profile shows a quiet "You muted this lifter" line (their tabs are empty by RLS — the line says why). After block/unblock the profile reloads (counts, tabs and follow state all change under RLS). |
| `app/(tabs)/index.tsx` (edit) | Passes the report handler through to cards; a block/mute from a profile needs no feed wiring — the next feed load simply lacks the rows (RLS). |

### `docs/CONTENT_POLICY.md` (new)

Plain language, short: what Astra is for; the 18+ rule; what gets content removed (the six
report categories, one section each — spam, harassment, nudity/sexual content, non-training
content, impersonation, other illegal or dangerous content); that reporting is in the app and
review is by the founder; that removal and account closure are at the founder's judgement;
how to appeal (email); no medical or legal claims, no numeric claims. The report sheet's
categories and this document list the same six things in the same words.

## Offline / sync / privacy / rules check

- **Offline-first:** untouched where it applies (logging, Tool Kit). Block/mute/report are
  online-only social writes, the settled B23 posture; nothing new is mirrored to SQLite and the
  device schema does not change.
- **One home:** the mute rule lives in `muted_by_viewer`, consulted from `workout_visible`
  (owner-level) and `author_visible` (author-level); blocks stay spelled once in
  `blocked_either`; report reasons exist once in app code, mirrored by the CHECK and the policy
  doc with change-together comments; "who is a moderator" exists once, as rows.
- **RLS, never client-side:** disappearance of blocked/muted content is entirely policy-side;
  the app only *stops offering* actions (e.g. ⋯ on own cards) — the server would refuse them
  anyway. The founder path is service-role behind a server-side `moderators` check.
- **Nothing speculative:** no auto-moderation, no report rate limits beyond the uniqueness
  guard, no in-app founder queue, no appeal workflow, no notification to the reported, no
  roles beyond one table. Each is listed out of scope with its trigger.
- **No AI, no numeric product claims:** the policy document carries neither.
- **Training math:** untouched.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_moderation.sql` | new — `mutes`, `moderators`, `reports` + trigger, `muted_by_viewer`, `author_visible`, `workout_visible` re-create, votes/comments select-policy re-creates, hot-view comment |
| `backend/supabase/functions/moderate/handler.ts` | new — pure decisions, `ModerateDeps` |
| `backend/supabase/functions/moderate/index.ts` | new — Deno wiring, B18 template |
| `backend/supabase/functions/tests/moderate.test.ts` | new — every action and refusal on fakes |
| `frontend/src/social/moderation.ts` (+ test) | new |
| `frontend/src/components/social/ReportSheet.tsx` (+ test) | new |
| `frontend/src/components/social/PostCard.tsx` (+ test) | edit — ⋯ → report |
| `frontend/src/app/post-comments/[id].tsx` + `src/__tests__/post-comments.test.tsx` | edit — comment ⋯ → report |
| `frontend/src/components/profile/ProfileView.tsx` (+ test) | edit — mute/block controls, muted line |
| `frontend/src/app/(tabs)/index.tsx` | edit — report wiring |
| `docs/CONTENT_POLICY.md` | new |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) |

Builder footguns (precedent B09–B26): no new route, but still regenerate typed routes with
`npx expo start --offline` (~150 s) before `tsc` → lint → Jest if anything route-adjacent
moves. Apply the migration live via MCP, then rename the file to the version `list_migrations`
records. Deploy `moderate` via the MCP with `verify_jwt` on (B18 precedent). Seed the
`moderators` row live (Tristen's profile id from `profiles`) and record the statement in the
handoff. `create or replace` on `workout_visible` keeps every dependent policy pointing at the
new body — do not drop the function (policies depend on it; drop would cascade or refuse).

## How the definitions of done become observably true

- **"A report lands in the queue" (step DoD, SOC-8, NFR-7):** Jest pins `reportPost` /
  `reportComment` and the sheet's states against fakes. Live (builder/Gate 2, three seeded
  users): A reports B's post and a comment → two rows with `reported_user_id = B` stamped by
  the trigger; A re-reports → still one row each (unique); C (no moderator row) selects
  `reports` → zero rows; the seeded moderator reads both via the API; a report naming a deleted
  comment's id → refused with the trigger's message.
- **"A blocked user's content disappears for the actor" (step DoD, SOC-8):** already true for
  posts/workouts/images since B02 — re-proved live after the policy edits, plus the new part:
  B comments on C's public post; A blocks B → B's comment and vote vanish from A's read of C's
  post (comment list, score, comment count), while C still sees them. Mute probed the same
  way one-directionally: A mutes B → B's posts, workouts and comments vanish for A everywhere;
  B's view of A unchanged; B still follows A (no unfollow); unmute restores.
- **"The founder can remove a post" (step DoD, NFR-7):** handler tests drive all three actions
  and every refusal on fakes. Live: the non-moderator calls `moderate` → 403; the seeded
  moderator removes a reported photo post → row gone for everyone, votes/comments cascaded,
  storage object gone, the report flips to `resolved`; removes a comment → same; removes a
  throwaway seeded account → `auth.users` row gone, `profiles` cascade verified (workouts,
  posts, settings, body data all gone), both storage folders empty — the NFR-6 cascade probe
  the handoff asked for.
- **"A published policy exists" (NFR-7):** `docs/CONTENT_POLICY.md` in the repo, its six
  categories word-for-word the report sheet's six reasons (a Jest test pins `REPORT_REASONS`'s
  slugs against the CHECK's list spelled in the test, the mirror-pair pattern).
- **"Blocks table + auto-unfollow trigger exist" (SOC-8 DoD):** existed since B02; the Gate 2
  block probe re-confirms the follow rows vanish on block.

## Out of scope (and where it lands)

- **Block cutting DMs** — B48 (no DMs exist; B48's DoD owns it and depends on B27).
- **In-app founder queue / removal UI** — later step, on evidence the dashboard + function
  stop sufficing; the `is_moderator()` select policy already admits it without a migration.
- **In-app display of the content policy** (sign-up link, settings link) — DEFERRED note; the
  scope sentence puts the document in `docs/`.
- **Self-serve account deletion and data export** — NFR-6's own step (this step builds and
  probes the cascade it will reuse).
- **Deleting your own comment / post UI, author moderating their own thread** — B23's recorded
  follow-ups, unchanged.
- **Report notifications, reporter feedback loop, strikes, appeals workflow, rate limits,
  blocklist/mutelist management screens** — on evidence of need; the tables lose nothing by
  waiting (a block/mute is undone from the profile it was made on).
- **Hiding a blocked viewer from follower counts** (`follow_counts` ignores blocks — B25
  follow-up) — stays a product reading for Tristen; one `workout_visible`-style clause if
  wanted later, not silently bundled here.

## Risks a reviewer should read first

1. **Re-creating `private.workout_visible` touches every visibility decision in the product.**
   One added clause, but it sits under workouts, posts, storage policies, profile reads and
   both feed views. A mistake hides nothing (mute fails) or everything (feed goes blank). The
   builder must re-run the B02/B20 probe set as three users after applying — public /
   followers / private × block × mute — and the Jest fakes can't stand in for this (RLS lives
   only on the server).
2. **Per-viewer tallies (G3).** Filtering `votes` by `author_visible` makes a post's score and
   hot rank viewer-relative where blocks/mutes exist, and adds a definer-function call per vote
   row under the aggregating views — the B23-noted `post_scores` whole-table aggregation gets
   heavier. Launch-scale fine; the recorded rewrite (lateral per-post sums / counter columns)
   now has one more reason. If Gate 1 prefers universal tallies, the one-line alternative is
   filtering only `comments` by author and leaving `votes` policies alone — the plan says why
   the scope sentence ("comments **and votes**", B23's recorded handoff) chose filtering.
3. **`remove-account` is the first code path that deletes an `auth.users` row.** It leans on
   the FK cascade graph and two storage folder sweeps, and a founder typo could nuke a real
   account — hence the moderator-target refusal and the Gate 2 probe on a throwaway account
   only. The handler takes deps, so tests prove ordering (auth delete → storage sweep →
   reports), but only the live probe proves the cascade graph and that nothing orphans in
   storage or `sync_tombstones`.

## Grilling decisions (settled)

Grilled in the planner session at full severity (the `mattpocock-skills:grilling` posture);
checkable claims verified against the repo (identity/training/posts/votes migrations, B23's
plan and its recorded B27 handoffs, `PostCard.tsx`, `profile/[id].tsx`, the B18 function
shape).

- **G1 — "Does B27 need app UI at all? SOC-8's DoD reads like schema + queue."** Yes: SOC-8 is
  listed non-partial and its feature name is the user actions ("Report a post/comment; block
  and mute"); the scope sentence says "from a profile". A schema-only step would leave SOC-8
  unfinishable by any later step the Build order names. UI is in scope: report sheet, profile
  buttons, overflow affordances — and nothing more (no management screens).
- **G2 — "Mute inside `workout_visible` hides their *workouts* too — Twitter's mute only
  silences the feed. Overreach?"** Weighed both ways. Feed-only mute cannot be done
  policy-side without splitting the visibility rule into "feed context" vs "profile context",
  which RLS cannot see — it would have to be a client-side query filter, which the scope
  sentence ("filtered server-side") and CLAUDE.md's RLS rule both refuse. The DoD's words —
  "content disappears for the actor" — are exactly what the one-clause spelling delivers, it
  reuses the blocks machinery verbatim, and the actor can always unmute (the profile still
  loads; the muted line says why it's quiet). Settled: whole-content mute, one home. If product
  later wants feed-only mute, that is a different feature with its own server story.
- **G3 — "Filtering votes by author makes scores viewer-relative and contradicts B23's G4
  ('the tally is the same number for everyone') and the hot view's comment."** True, and
  chosen with eyes open: the step scope and B23's recorded handoff both say votes are filtered
  by block/mute in B27. The alternative (universal tallies, filter comments only) leaves a
  blocked harasser's votes counting on the actor's own posts — defensible, but it reads the
  scope sentence narrowly and someone has to own that reading; this plan doesn't. The
  mechanical cost is one clause in one policy; reverting is equally small, so Gate 1 can
  overrule cheaply (risk 2). The hot view's stale comment is re-worded in this migration.
- **G4 — "Why a `moderators` table over an `app_metadata` claim?"** A claim needs the auth
  admin API to grant/revoke, is invisible to SQL review, can't be read by `is_moderator()`
  without parsing the JWT in every policy, and rotates only on token refresh (a revoked
  moderator keeps power until re-login). A table row is grantable/revocable in one statement,
  joinable in RLS, auditable, and takes effect immediately. Rejected the claim; kept the table.
  Also rejected: reusing a profile column (mixes public identity with authority).
- **G5 — "No FK on `reports.target_id` gives up integrity — dangling ids, no dashboard join
  safety."** Deliberate: the queue is an audit log, and every FK choice was worse. Cascade
  erases reports exactly when they matter most (content deleted — by the author dodging the
  queue, or by the founder acting on it); `set null` fights the exactly-one-target CHECK and
  still loses the pointer. Dangling ids after removal are the *correct* record ("this was
  reported, it is gone"). `reported_user_id` (FK, trigger-stamped) keeps the queue joinable to
  a real account even then, and keeps NFR-6's cascade honest. The founder's dashboard query
  left-joins content by id and reads "gone" for what's gone.
- **G6 — "The report trigger is machinery; couldn't the client send `reported_user_id`?"** A
  forged author id would point the founder's queue at an innocent account — the one field
  whose integrity the queue exists to provide. Ten definer lines, same shape as B23's vote
  trigger; the insert policy still owns visibility (invoker-rights subqueries reusing each
  table's own select policy — no rule spelled twice).
- **G7 — "Six report reasons: who decided?"** This plan, as a starting posture mirroring the
  policy document's sections; `other` catches the rest, `details` carries specifics. Reasons
  are data in one app module + a CHECK; adding one later is a one-line migration + one line of
  copy + one policy section. Overruling the list is a Gate 1 edit.
- **G8 — "Account removal in the same function as post removal — scope?"** The scope sentence
  says "removal of content **or accounts** through a service-role edge function", singular
  function. One handler, three actions, shared auth/moderator gate; splitting would duplicate
  the wiring. The moderator-target refusal (can't remove a moderator) was added in grilling —
  the founder locking themselves out via typo was an unexamined failure mode.
- **G9 — "What does removal do on the author's own phone? Their local `posts` mirror still has
  the row."** True and accepted: own-post reads (Home, profile) are server reads, so the ghost
  row shows nowhere; nothing re-pushes it (post outbox lines were acknowledged long ago; B26's
  visibility updates are online-scoped). A removed *account* can't sync at all (token dead).
  Recorded as a DEFERRED note rather than machinery: a local sweep belongs to the step that
  builds post deletion UI, which owns mirror cleanup anyway.
- **G10 — "Blocking from the profile: does the screen survive the RLS ground shifting under
  it?"** Checked against `ProfileView`'s loaders: counts, tabs and follow state all re-read on
  reload; the plan has the screen reload after block/unblock rather than patch state by hand.
  The profiles row itself stays readable (B25 posture, unchanged), so the screen never 404s.
- **G11 — "Is `reports_open_idx` speculative?"** It is the founder's one queue query ("open,
  oldest first") and costs a line; kept. Conversely a `reports.target` index was cut — the
  removal function touches reports by `(target_kind, target_id)` rarely (one update per
  removal, seq scan fine at founder scale). Add on evidence.
- **G13 — "Report, then block — or lose the ability to report."** Caught in grilling: once A
  blocks or mutes B, B's content is invisible to A (`workout_visible`), and the reports insert
  policy's visibility subqueries then refuse a report of it — so the only workable order is
  report first, block after. Accepted as correct behaviour (you report what you can see; what
  you can't see can't harm you), not patched with special cases. The report sheet's thank-you
  line is the natural moment to go block from the profile; a combined report-and-block
  convenience is a later nicety, not machinery now.
- **G14 — "Whole-content mute hides a muted lifter's comments on the actor's OWN posts."** The
  sharpest edge of G2, spelled out: A mutes B; B comments on A's post; A never sees it, while
  everyone else does. That is what mute *means* ("I don't want to see this person") and exactly
  how the large networks behave; the alternative (mute except on my own content) would need a
  context RLS cannot see. Accepted, and the live probe covers it.
- **G15 — "Does unblock/unmute restore what was hidden?"** Yes, structurally: filtering never
  deletes — no vote, comment, post or follow row is touched by mute, and block severs only
  follows (the existing trigger). Deleting a `blocks`/`mutes` row restores every filtered read
  on the next query. Stated here so nobody "improves" filtering into deletion later.
- **G16 — "How does the founder actually call `moderate` at launch, with `verify_jwt` on?"**
  With their own session token: a scratch sign-in script (email + password → JWT → one POST) or
  the token from the app's session. Founder-grade friction, zero product surface, and the 403
  path means a leaked script is harmless without the founder's credentials. An in-app founder
  surface stays out of scope until the dashboard + script stop sufficing.
- **G12 — facts checked in the repo:** (a) `blocks`, `blocked_either`, the auto-unfollow
  trigger and `blocks_blocked_idx` exist in the identity migration; `workout_visible`'s
  non-owner branch is where the blocks clause sits — the mute clause lands beside it.
  (b) `votes` / `comments` select policies are exactly `can_view_post(post_id)` today — B23's
  plan lines them up for this step by name. (c) `post_scores` and `post_hot_scores` are both
  `security_invoker` — author filtering flows through without view edits; the "same for
  everyone" claim lives in the hot view's comment block and `comment on view`. (d) The B18
  shape (`handler.ts` deps interface + `index.ts` two-client wiring, tests in
  `functions/tests/`) is real and current. (e) `PostCard` takes optional handler props
  (`photoSource`, vote handlers) — the report handler follows the pattern; own-vs-other cards
  already branch on `viewerId` for the visibility chip, so the ⋯ placement has a seam.
  (f) `ProfileView` owns the header/tabs loaders; `profile/[id].tsx` is a thin wrapper — the
  buttons belong in `ProfileView`. (g) No `mutes`, `moderators`, `reports` table, no
  `moderate` function, no `ReportSheet` exist; nothing collides. (h) `ChoiceChips` moved to
  `components/ui/` in B26 — the report sheet reuses it from there. (i) Storage delete policy
  for own files exists (B22) but removal uses service role regardless — moderators delete
  *other people's* objects.
  (j) Avatars live at `avatars/<user_id>/…` (the B25 policies key on
  `(storage.foldername(name))[1]`), matching the sweep's folder assumption. (k) **Every** FK to
  `public.profiles` in every migration is `on delete cascade` (workouts, exercises.owner_id,
  posts, votes, comments, follows, blocks, settings, body data, analyses, records, tombstones),
  and `profiles.id` cascades from `auth.users` — the `remove-account` cascade claim is checked
  fact, not hope.
- **Scope verdict:** right as written, with two readings Gate 1 should eye: whole-content mute
  (G2) and per-viewer tallies (G3) — both argued from the scope's own words, both cheap to
  overrule. One addition beyond the letter: the moderator-target refusal in `remove-account`
  (G8), ten lines of self-protection. Nothing narrowed; DM-cutting explicitly lands at B48
  where the Build order already put it.
