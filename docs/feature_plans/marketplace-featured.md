# marketplace-featured (B41)

Covers **MKT-2** (featured section: most popular by week, month, year, all time — DoD: "All four
windows rank by popularity and update as votes change") and **MKT-3** (vote and comment on
programs — DoD: "Programs take up/down votes and comments exactly as feed posts do"). Depends on
B40 (the Marketplace tab, `social/marketplace.ts`, the program page) and B23 (the post pattern:
`votes`, `comments`, `commentLimits.ts`, the score views, the optimistic vote UI).

Step scope: program votes and comments following the post pattern; featured section ranked by
popularity over week, month, year and all time. Step DoD: **all four windows rank correctly and
update as votes change.**

Scope verdict: right as written. The one word needing a reading is MKT-3's "exactly as feed posts
do" — settled below (D1, D2): the mechanics are exact (one vote per lifter, up and down, replace
on change, 500-char comments through the same limits module, same optimistic UI, same refusal
style); the *gates* follow programs' own visibility rule, not posts' (there is no flair and no
`workout_visible` on a program). Nothing else widened or narrowed.

## What exists (verified before planning)

- **The post pattern (B23/B24), in full:** `votes (post_id, user_id, value in (-1,1))` with the
  composite PK as the one-vote rule, owner-only writes, reads through
  `private.can_view_post`; `comments` with the body CHECK (`char_length … between 1 and 500 and
  body ~ '\S'` after the B23 tightening) mirrored by `commentLimits.ts`; `post_scores`
  (security_invoker, score + comment_count); `post_hot_scores` (security_invoker, carries the
  feed's posts columns so the app reads *through the view* with embeds and `order=hot_score.desc`
  — the proven read-a-ranking-view shape). App side: `votes.ts` (`castVote` upsert on the PK,
  `clearVote`, pure `voteDelta`/`nextVote`), `comments.ts` (load oldest-first limit 200 +
  `more` flag, `addComment` validates then inserts and returns the server row),
  `commentLimits.ts`, `PostCard`'s private `PostFooter` (the optimistic arrows: local score,
  delta on tap, step-back revert on refusal, prop-change reset), `app/post-comments/[id].tsx`
  (list + composer + counter + report ⋯), `usePostListActions` (routes comment taps to
  `/post-comments/[id]`).
- **Programs' visibility rule has one home:** `private.program_visible(pid, owner, vis, deleted)`
  (B39) — author always; others only live rows via published / followers / team arms. The B34
  warning stands: child tables stay author-only; nothing here touches them.
- **The Marketplace surfaces (B40):** the tab (search + browse list, name + author cards, the
  "Featured this week" skeleton already removed for this step), `social/marketplace.ts`
  (`loadPublishedPrograms` with the two explicit shelf filters, `loadProgramPage` = row read +
  `program_payload` RPC, pure `programFacts`/`programFactsLine`), the program page
  (`app/marketplace-program/[id].tsx`: author, facts, breakdown, Save and Start). The browse
  read's discipline — RLS alone would include the caller's own private rows, so the client
  always also filters `visibility=eq.published`, `deleted_at=is.null` — applies to every new
  shelf read here.
- **Moderation (B27):** `reports.target_kind` is CHECKed to `('post','comment')`; the reporter
  policy and the author-stamp trigger branch on those two. Widening it is a real migration + a
  `moderate` edge-function change — not ordered by any B41 DoD (settled at D7).
- **Reusables:** `ChoiceChips` (`components/ui/`), `useFocusEffect` (program/team/profile
  screens re-read on focus), `personLabels`, `EmptyState`, `throwIfError`, the
  `fakeSocialClient` (branches per table; already imitates `post_scores`/`post_hot_scores` and
  the programs author embed — it gains the three new sources, G12's footgun).

## Settled decisions

### D1 — Separate `program_votes` / `program_comments` tables, not a polymorphic target

The handoff's default, confirmed: same shapes as `votes`/`comments`, keyed by `program_id`.
A polymorphic `target` column on the existing tables was rejected because it would widen the
post tables' RLS, triggers and score views with a second visibility rule (`program_visible` vs
`can_view_post`) — every policy would branch on target kind, and the B23 tables' contract
("exactly as visible as the post") would stop being one sentence. Two small tables, each wired
to its own one-home visibility helper, is the spelling where nothing is conditional.

### D2 — Gates: read where the program is visible; write only on the published shelf

- **Reads** (votes and comments): `private.can_view_program(pid)` — a definer helper mirroring
  `can_view_post`, calling `program_visible` through the program row. Whoever may see the
  program may see its votes and comments (the tally is the same number for everyone — B23's G4
  reasoning, unchanged).
- **Writes** (insert vote, change vote, insert comment): only on a **published, live** program
  (`private.program_published(pid)`), and only as yourself. This is the handoff's standing
  input, kept for two reasons: the Marketplace is the only surface that shows vote/comment
  controls, and a published-only write gate means a vote row can never attach to (and so never
  outlive or leak) a program the public shelf doesn't carry. A followers- or team-shared
  program reached by deep link (B40's G8) shows no social row (D6). Posts differ ("any visible
  post" is votable) — recorded as the deliberate non-exactness in MKT-3's reading; the
  *mechanics* stay exact.
- **Deletes** (unvote, remove own comment): owner-only, no program condition — parity with
  posts, and a lifter can always take their own row back even after an unpublish.
- **Downvotes are allowed.** Programs have no flair, so no `upvotes_only` arm and no trigger —
  "exactly as feed posts do" for an ordinary post is both arrows. The privacy rule's
  upvote-only clause names Physique Check posts, not programs. Recorded.
- Voting or commenting on **your own** published program is allowed (B23's G13: no rule speaks
  against it, and refusing it is a policy nobody asked for).

### D3 — One migration: tables, helpers, and one `program_scores` view

`backend/supabase/migrations/<ts>_program_votes_comments.sql` (applied via MCP, file renamed to
the recorded version — the B11 discipline):

```sql
-- May the caller see this program? Mirrors private.can_view_post; the rule
-- itself stays program_visible's (B39), its one home.
create or replace function private.can_view_program(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.programs p
    where p.id = pid
      and private.program_visible(p.id, p.user_id, p.visibility, p.deleted_at)
  )
$$;

-- Is this program on the public shelf (published and live)? The write gate.
create or replace function private.program_published(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.programs p
    where p.id = pid and p.visibility = 'published' and p.deleted_at is null
  )
$$;

create table public.program_votes (
  program_id uuid not null references public.programs (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (program_id, user_id)        -- one vote per lifter per program
);

create table public.program_comments (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Same rule as comments.body (B23 as tightened): 1–500 characters, not just
  -- whitespace. Mirrored by COMMENT_MAX_CHARS in commentLimits.ts — the SAME
  -- module as post comments; change the three together.
  body       text not null check (char_length(body) between 1 and 500 and body ~ '\S'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index program_comments_program_created_idx
  on public.program_comments (program_id, created_at, id);
create index program_comments_user_idx on public.program_comments (user_id);
```

Both tables get the standard `moddatetime` trigger and RLS per D2 (select via
`can_view_program`; insert/update with `user_id = auth.uid() and program_published(…)`; delete
own). `program_votes.user_id` stays unindexed like `votes.user_id` (the B23 D4 reading — the
advisor INFO class, indexed only if account deletion measures slow).

**The ranking view — the step DoD's one home:**

```sql
-- Popularity of every program the viewer may see, over four windows. One view,
-- security_invoker (the viewer's programs/votes/comments RLS applies — no new
-- reading power). Built on programs so every visible program has a row (score
-- 0, not absent). Carries the Marketplace read's own columns (the
-- post_hot_scores precedent: the column list is the contract) so the featured
-- shelf reads THROUGH the view with the author embed and orders by a score
-- column server-side. Windows are rolling: the last 7 / 30 / 365 days from
-- "now". score = all time; comment_count rides along for the program page.
create view public.program_scores
  with (security_invoker = true) as
  select p.id, p.user_id, p.name, p.visibility, p.created_at, p.deleted_at,
         coalesce(v.score, 0)::int        as score,
         coalesce(v.score_week, 0)::int   as score_week,
         coalesce(v.score_month, 0)::int  as score_month,
         coalesce(v.score_year, 0)::int   as score_year,
         coalesce(c.comments, 0)::int     as comment_count
  from public.programs p
  left join (
    select program_id,
           sum(value)                                                            as score,
           sum(value) filter (where created_at >= now() - interval '7 days')     as score_week,
           sum(value) filter (where created_at >= now() - interval '30 days')    as score_month,
           sum(value) filter (where created_at >= now() - interval '365 days')   as score_year
    from public.program_votes group by program_id
  ) v on v.program_id = p.id
  left join (
    select program_id, count(*) as comments
    from public.program_comments group by program_id
  ) c on c.program_id = p.id;

grant select on public.program_scores to authenticated;
```

Window readings recorded: "week / month / year" are **rolling windows** (7 / 30 / 365 days back
from now), not calendar units — the Reddit-style reading, stable at any moment, no timezone
question. A vote's `created_at` stamps when it was *cast*; a changed vote keeps its original
`created_at` (the row is updated in place), so an up→down flip moves every window's sum that
contains the row by 2 — which is exactly "updates as votes change". A vote cast long ago and
flipped today still counts in the old windows only; honest, recorded.

**No new device schema, no sync change, no `TABLE_COLUMNS` change** — program votes and
comments are online-only, exactly like post votes and comments (the B23 G1 reasoning transfers
whole: they are cast on a server-read surface that only exists with a connection). The step DoD
and both feature DoDs are online behaviours. Nothing for `export-data` now (votes/comments were
settled out of exports in B32; the standing program-tables gap is unchanged).

### D4 — App modules: extend `votes.ts` and `comments.ts` by parameterizing, never copy

- **`social/votes.ts` (edit):** the table/key pair becomes an internal parameter of the one
  upsert/delete implementation; exports gain `castProgramVote(client, me, programId, value)` and
  `clearProgramVote(client, me, programId)` (upsert `onConflict: 'program_id,user_id'`).
  `voteDelta`, `nextVote`, `VOTE_REFUSAL_MESSAGES` are shared as-is. Program refusals all map to
  `'failed'` — there is no upvote-only trigger on programs, so `P0001` is not given a meaning it
  doesn't have there. Existing exports and their behaviour unchanged (post tests stay green).
- **`social/comments.ts` (edit):** same move — the select string's key column and table become
  internal parameters; exports gain `loadProgramComments(client, programId)` (oldest-first,
  the same `COMMENTS_LIMIT` and `more` flag) and `addProgramComment(client, me, programId,
  body)`. `RawComment`/`PostComment`/`toPostComment` are shared (the author embed is
  identical); the one difference is the row's key column, which stays inside the module.
- **`social/commentLimits.ts`: untouched, imported.** The cap has one app home; the new CHECK
  gets a comment pointing at it (three places now change together: two CHECKs, one module).
- **`social/marketplace.ts` (edit):**
  - `FeaturedWindow = 'week' | 'month' | 'year' | 'all'` and
    `loadFeaturedPrograms(client, window, limit = FEATURED_LIMIT /* 10 */)` →
    `FeaturedProgram[]` (`MarketplaceProgram & { score: number }`): reads **`program_scores`**
    with the same author embed and the same two explicit shelf filters as the browse read
    (`eq visibility published`, `is deleted_at null` — the view deliberately carries those
    columns), ordered by the window's score column desc, then `created_at` desc, `id` desc
    (ties go to the newest), limited. The window → column mapping is one exported pure table.
  - `loadProgramPage` widened: it gains a **viewer parameter** (`me: string | null` — the B23
    precedent: `loadFeedPage` gained the viewer id for the same reason), and alongside the row
    and payload reads makes two more parallel reads — the program's `program_scores` row
    (score + comment_count; the same two-request shape B23's D1 settled for post scores) and
    the caller's **own** `program_votes` row (`.eq('user_id', me)`, `maybeSingle` — votes are
    readable by every viewer of the program, so RLS cannot do this narrowing; the filter is
    load-bearing). `me: null` skips the vote read and shapes `myVote: null`. `MarketplacePage`
    gains `score`, `commentCount`, `myVote: 1 | -1 | null`. A missing scores row shapes to
    zeros (a quiet card, never a crash — the B23 rule). The reads run unconditionally — no
    branching on visibility, though the social row only renders on published programs (G15).

### D5 — The vote control is extracted from `PostFooter`, not copied

`components/social/VoteControl.tsx` (+ test, new): the arrows-around-the-score block with its
optimistic logic, lifted from `PostCard`'s private `PostFooter` — local vote + score state, tap
→ `nextVote`/`voteDelta` applied at once, in-flight ref, step-back (−delta) revert with the
refusal line on failure, prop-change reset to the server's numbers during render. Props:
`score`, `myVote`, `showDownvote`, `onVote(next) → Promise<VoteResult>`. `PostFooter` keeps its
footer layout, re-share block and comment button and renders `VoteControl` for the arrows
(`showDownvote: !post.flair.upvotesOnly`); the program page renders the same control
(`showDownvote: true`). Moved JSX, not changed JSX — the existing `PostCard` tests pin the post
side (the B40 D7 extraction class). The alternative — copying the ~50-line optimistic block —
is the mirrored-copy bug class this repo bans.

### D6 — Screens

**`app/(tabs)/marketplace.tsx` (edit):** a **Featured** section between the search box and the
browse list (it renders only while the search box is blank — a search means the lifter is past
browsing): a heading, four `ChoiceChips` (Week · Month · Year · All time, defaulting to Week),
and the window's top programs as the existing card shape plus a score line ("▲ 12"). Cards tap
through to the program page (no arrows on cards — voting lives where the program is readable,
D2 recorded; a card is a doorway, not the content). The chips re-read on change; the whole tab
re-reads on focus (`useFocusEffect`, the program/team screens' precedent) so a vote cast on a
program page is reflected when the lifter comes back — this focus re-read plus the page's own
optimistic control is what "updates as votes change" means on screen (the handoff's B23 pattern:
no realtime, nothing speculative). Featured and browse are two reads with one failure voice:
either failing shows the tab's existing offline state once. An empty window ("no votes this
week") shows the ranked list anyway — with zero-vote programs ranked by recency, the honest
"most popular" of a quiet week; the section never blocks the browse list below it.

**`app/marketplace-program/[id].tsx` (edit):** under the facts line, a social row — the
`VoteControl` (score from the widened page read, the lifter's own vote lit) and a comments
button (`commentButtonLabel(commentCount)`, the B23 label helper, exported from `PostCard` —
reused, not copied) opening `/program-comments/[id]`. The row renders **only when
`summary.visibility === 'published'`** (D2: non-published programs reached by deep link show no
social surface; their votes would be refused by RLS anyway — the UI just doesn't offer the
doomed tap). Votes go through `castProgramVote`/`clearProgramVote` with the signed-in id; the
control's optimistic score is the page's display, reset by the next load (the server stays the
one home of the tally).

**`app/program-comments/[id].tsx` (new route, registered in `_layout.tsx`'s signed-in guard):**
the program's comments. To avoid a second ~150-line copy of the post comments screen, the list +
composer body is extracted to **`components/social/CommentsPane.tsx`** (+ test): props are the
already-loaded state plus `onSend` and optional per-comment report wiring; it owns the rows
(`LetterAvatar`, `personLabels`, date line), the "more exist" line, the composer with the
counter and the no-`maxLength` rule (B23 D3), Send's disabled/sending states and the failure
line. `app/post-comments/[id].tsx` becomes a thin wrapper (its load/send/report wiring and
screen chrome stay; behaviour pinned by its existing tests), and the program route is a second
thin wrapper wiring `loadProgramComments`/`addProgramComment` and **no report affordance** (D7).
Same offline message + Retry shape as the post screen.

### D7 — Program-comment reporting is deferred, recorded

`reports` stays `('post','comment')`. Widening it means a CHECK migration, two policy arms, the
author-stamp trigger, and a `moderate` edge-function redeploy — real scope no B41 DoD orders
(MKT-3's DoD is votes + comments working as posts' do; B23 itself shipped comments without
reporting and B27 added it). Deferred to a moderation follow-up, recorded in DEFERRED with the
precedent named; until then the founder's recourse for an abusive program comment is the
dashboard (service role deletes the row), which is the pre-B27 posture. The ⋯ simply doesn't
render on program comments (the pane's report wiring is optional by design).

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<ts>_program_votes_comments.sql` | new — D3: two tables, two helpers, RLS, `program_scores` view |
| `frontend/src/social/votes.ts` (+ test) | edit — D4: program vote arm via internal parameterization |
| `frontend/src/social/comments.ts` (+ test) | edit — D4: program comments arm, same shapes |
| `frontend/src/social/marketplace.ts` (+ test) | edit — D4: `loadFeaturedPrograms`, widened `loadProgramPage` |
| `frontend/src/components/social/VoteControl.tsx` (+ test) | new — D5: extracted optimistic vote control |
| `frontend/src/components/social/PostCard.tsx` (+ its test) | edit — D5: `PostFooter` renders `VoteControl`; `commentButtonLabel` stays exported |
| `frontend/src/components/social/CommentsPane.tsx` (+ test) | new — D6: extracted comments list + composer |
| `frontend/src/app/post-comments/[id].tsx` | edit — D6: thin wrapper over the pane (behaviour unchanged) |
| `frontend/src/app/program-comments/[id].tsx` | new — D6: program comments route |
| `frontend/src/app/(tabs)/marketplace.tsx` | edit — D6: featured section with window chips, focus re-read |
| `frontend/src/app/marketplace-program/[id].tsx` | edit — D6: social row (votes + comments button) |
| `frontend/src/app/_layout.tsx` | edit — the new route in the signed-in guard |
| `frontend/src/test-utils/fakeSocialClient.ts` | edit — `program_votes`, `program_comments`, `program_scores` sources (G12) |
| `frontend/src/__tests__/marketplace.test.tsx` | edit — featured section cases |
| `frontend/src/__tests__/marketplace-program.test.tsx` | edit — social row cases |
| `frontend/src/__tests__/program-comments.test.tsx` | new — route tests (expo-router rule: tests for `app/` routes live here) |
| `frontend/src/__tests__/post-comments.test.tsx` | stays green through the D6 extraction (no behaviour change) |
| `docs/diagrams/database-erd.md` | the two tables, two helpers, the view and its security_invoker note |
| `docs/diagrams/app-flow.md` | featured section + chips, program-page social row, program comments screen and their data paths |
| `docs/DEFERRED.md` | D7 reporting, cards-without-arrows, comment paging parity, the standing items |

Data model impact: two tables, two `private` helpers, one view — **no change to any existing
table, policy, trigger or view; no device schema (no V15), no sync change, no new dependency.**

Builder footguns (precedent B09–B40): new route → `npx expo start --offline` (~150 s) **before**
`tsc --noEmit` → lint → Jest (`--maxWorkers=50%` on timeout); apply the migration via MCP then
rename the file to the version `list_migrations` records; the fake client's `program_scores`
imitation must compute the window sums from its `program_votes` rows (the `fakeHotScore`
precedent — a labelled test-only mirror of the view's arithmetic, changed with the view);
`.maybeSingle()` for the my-vote read; the D5/D6 extractions must keep the existing post tests
green **unedited** except for import paths — a behaviour edit there is a deviation to record.

## How each definition of done becomes observably true

- **MKT-2 "All four windows rank by popularity"** — view test via Gate 2 SQL probe (rolled
  back): as postgres, plant votes with old `created_at` values (8 days, 40 days, 400 days back)
  plus fresh ones; assert a program with two recent upvotes ranks above one with a single recent
  upvote in `score_week`, and that the 8-day-old vote counts in `score_month`/`score_year`/
  `score` but **not** `score_week`, the 400-day-old one in `score` only. Module test: the fake's
  view rows order by the chosen column, ties newest first; the window→column map is pinned.
  Route test: chips switch the order of seeded fixtures.
- **MKT-2 "…and update as votes change"** — Gate 2 probe: change a planted vote up→down as its
  user and re-read the view — the affected windows move by 2 and the ranking flips where the
  margin was 1. On screen: the route test pins the focus re-read (navigate away, vote changes in
  the fake, navigate back → new order), and the page's `VoteControl` test pins the optimistic
  move + revert.
- **MKT-3 "up/down votes … exactly as feed posts do"** — module tests: upsert on
  `(program_id,user_id)` (a changed mind rewrites, never duplicates), clear deletes, refusals
  map to the failed sentence. Route test: both arrows render on a published program's page, tap
  moves the score at once, refusal reverts it. Gate 2 probes as two throwaway users (SQL +
  the B40 HTTP recipe): a vote on a published program lands; a vote on a private program is
  **refused** (and the vote row's absence can't leak the program); up→up→down across two users
  tallies to 1; a second vote by one user replaces the first; a non-author cannot read votes on
  a program they can't see.
- **MKT-3 "…and comments exactly as feed posts do"** — route test: seeded comments from two
  users render oldest-first with names; over-cap and blank drafts can't send (the same
  `commentLimits` sentences); a sent comment appears as the server saved it. Gate 2 probes: B
  comments on A's published program and A reads it; a comment on a private program is refused;
  a 501-char body and a whitespace-only body are refused by the CHECK; an update to someone
  else's comment is refused (no policy); **a non-author cannot read comments on a program they
  cannot see** (the handoff's named probe).
- **Step DoD ("all four windows rank correctly and update as votes change")** — the conjunction
  of the two MKT-2 bullets, proven in the same Gate 2 SQL session with the planted-timestamps
  method the handoff prescribes.
- **Device verification (Built → Done, Tristen):** account A publishes a program; B upvotes it
  from its page (arrow lights, score moves, survives leaving and reopening the page), comments
  on it, A reads the comment; the Marketplace tab's Featured section shows it under Week with
  its score, the chips switch windows, and after B's un-vote the score drops on next focus;
  airplane mode → the tab and the comments screen show the connection message.

## Out of scope (this branch)

- **Reporting/moderating program comments** — D7, deferred with the B23→B27 precedent named.
- **Vote arrows on browse/featured cards** — voting lives on the program page (D6, recorded).
- **`programs.description`** — still not ordered by any covered DoD; featured cards show name +
  author + score. The B40 D1 note ("lands with the first step that displays one") moves forward
  to whichever step designs richer cards.
- **Comment paging past 200, comment editing/threading, votes on comments** — the B23 parity
  deferrals, unchanged.
- **Realtime score updates / subscriptions** — "update as votes change" is satisfied by focus
  re-reads + optimistic UI (the handoff's stated reading); realtime is the speculative class.
- **Blocked-author filtering of the shelf** (B39/B40 standing option) and **featured-section
  editorial curation** (featured = ranked, not hand-picked) — on evidence / product call.
- **Notifications** for program votes/comments — B47.

## Risks a reviewer should read first

1. **The `program_scores` view is the step's novel server surface.** Reading *through* a
   ranking view with an author embed and `order=<score>.desc` is the `post_hot_scores` shape —
   but B24's live ranking probe is itself still on the deferred list, and B23 proved a view
   embed can fail (`PGRST200`, D1). The fallback is mechanical and pre-approved: read
   `id + scores` from the view, then the rows by id through the existing `MARKETPLACE_SELECT`
   (the B23 D1 two-request shape). The builder must record a deviation, not silently switch.
   The `filter (where …)` window sums and `now()` in a view body are only provable live —
   Gate 2's planted-timestamp probe is the proof, and the fake's mirror must be labelled.
2. **Two extractions edit working B23 surfaces** (D5 `PostFooter` → `VoteControl`, D6 comments
   screen → `CommentsPane`). Same class as B40's D7: moved JSX, not changed JSX; the existing
   `PostCard` and `post-comments` tests must pass unedited (import paths aside). Any behaviour
   drift there is a deviation. The rejected alternative — copying either block — is the
   mirrored-copy bug class.
3. **The write gate is narrower than posts' (D2: published-only).** If a reviewer reads MKT-3's
   "exactly" as "votable wherever visible", the change is one clause (`program_published` →
   `can_view_program` in three policies) plus showing the social row on non-published pages —
   but then a vote row on a followers-only program outlives its audience and the featured view
   must still never surface it (it does not: the shelf filters are explicit). The plan's
   reading follows the handoff's standing input; Gate 1 should confirm it with eyes open.
4. **Vote timestamps vs. changed votes.** A flipped vote keeps its original `created_at`
   (update in place), so old votes flipped today move old windows, not this week's. The
   alternative — re-stamping `created_at` on every change — would let one lifter bump a
   program into "this week" forever by toggling. Current spelling is the honest one; recorded
   so nobody "fixes" it into the gameable one.

## Grilling record (settled decisions)

Conducted by the planner session (autonomous pipeline, both sides at full severity). What was
attacked and what changed:

- **G1 — "One view or two? The post pattern has `post_scores` AND `post_hot_scores`; you merged
  them — why?"** The post pair exists because B23 and B24 shipped separately and hot needed the
  feed's column contract. Here both consumers arrive in one step, the featured ranking *is* the
  score (sums, no decay formula), and the page's score/comment_count read is a row of the same
  view. One view = one surface to secure, probe and imitate in the fake. Kept. (If B42+ ever
  wants a decayed "hot programs" ranking, it builds its own view beside this one, the B24 way.)
- **G2 — "Four window columns is a wide view — why not `created_at >= $1` with a parameter?"**
  Views take no parameters; a definer RPC per window is a new gated surface for what four
  `filter` clauses express declaratively under the viewer's own RLS. Four columns, each a
  one-line clause, is the cheapest honest spelling. Kept.
- **G3 — "Rolling 7/30/365-day windows — 'month' means 30 days now?"** Settled as rolling
  (D3): calendar windows ("this March") empty out on the 1st and need timezone answers the PRD
  never gives. "Most popular this month" = the last 30 days is the common product reading
  (Reddit's top-of-month is rolling too). Recorded in the migration comment and this file;
  overruling is a one-line interval edit at Gate 1.
- **G4 — "Does the featured section belong on the tab while searching?"** No — it renders only
  with a blank query (D6): a lifter typing a name is past browsing, and interleaving a ranked
  shelf with search results would make the result list lie about order. One conditional.
- **G5 — "`FEATURED_LIMIT = 10` — who decided?"** This plan, as a starting posture (the B23
  G6 class): a featured shelf is a short list by nature, four windows × a long list is a wall.
  One exported constant; Gate 1 can reset it in one line.
- **G6 — "Why extend `votes.ts`/`comments.ts` instead of new `programVotes.ts` modules?"** The
  implementations differ by a table name and a key column — two new files would duplicate the
  upsert/refusal/shape logic they exist to keep in one place (the mirrored-copy class, in
  module form). Internal parameterization keeps one implementation, two thin exported arms, and
  the existing post exports byte-identical in behaviour. The seam is pinned by the existing
  tests staying green.
- **G7 — "The `CommentsPane` extraction drags B23's screen into this diff — cheaper to copy the
  screen once and extract at the third copy?"** The repo's own 'third copy' rule was weighed:
  this IS the second copy, and the candidate copy is ~150 lines of stateful UI (composer rules,
  counter, send states, failure lines) — exactly the block where a drifted copy shows users two
  different truths. B40 set the precedent at two copies (`ProgramPayloadView`, extracted for
  the second consumer, not the third). Extraction kept; its cost is bounded by risk 2's
  tests-stay-green rule.
- **G8 — "Published-only writes: a lifter upvotes a program, the author unpublishes — the vote
  is stuck (can't flip it, down-arrow errors)."** True and accepted: the page hides the social
  row on non-published programs (D6), so no control offers the doomed write; the lifter can
  still *remove* their vote through any future surface (delete is ungated, D2) — though today
  no surface lists your program votes. The stuck state is invisible-by-construction and
  self-heals on re-publish. Recorded rather than widened.
- **G9 — "The focus re-read claims 'updates as votes change' — but a second user's vote while
  I stare at the tab never appears."** Correct, and it is the handoff's own stated standard
  ("re-reading on focus / after a vote — the B23 pattern; no realtime, nothing speculative").
  The DoD's "update as votes change" is about the *ranking reflecting the vote table*, proven
  at Gate 2 by re-reading after changes — not about push delivery. Recorded so the DoD reading
  is explicit.
- **G10 — "The view carries `deleted_at` and `visibility` — doesn't security_invoker already
  hide what must be hidden?"** No: RLS alone would include the *caller's own* private and
  deleted programs (the author arm) — the exact B40 risk-1 lesson. The columns exist so the
  client's two explicit shelf filters work on the view read too; the module test pins them.
  Attacked from the other side ("so a caller CAN read their own private program's scores
  through the view?") — yes, by the same right they read the row itself; nothing new leaks
  (invoker RLS on votes/comments gates the underlying rows the same way).
- **G11 — "`commentButtonLabel` imported from `PostCard` by a marketplace screen — wrong
  home?"** It is already exported and tested there; moving it is churn in B23's file for
  taste. If a third consumer appears it moves to a labels module (the repo's third-copy rule).
  Kept as an import.
- **G12 — facts checked in the repo:** `can_view_post` / `program_visible` / `owns_program`
  helper spellings and `set search_path = ''` confirmed (B23/B39 migrations);
  `comments.body` CHECK post-tightening is `body ~ '\S'` (so the new table starts there, no
  second migration); `PostFooter` is private in `PostCard.tsx` with the optimistic block at
  lines ~380–423 and `commentButtonLabel` exported; `post-comments/[id].tsx` structure matches
  the D6 extraction; `usePostListActions.openComments` pushes `/post-comments/[id]` (untouched
  here — post cards keep their route); `marketplace.ts` exports and `MARKETPLACE_SELECT` shape
  confirmed; `ChoiceChips` lives in `components/ui/` (already moved — the B24 deferred item is
  done); `useFocusEffect` precedent in `program/[id].tsx`, `team/[id]/index.tsx`,
  `ProfileView`; the fake client branches per table and already fakes two views (`post_scores`,
  `post_hot_scores`) plus the programs author embed — the three new sources are additive;
  `reports.target_kind` CHECK confirmed in the B27 migration (D7's cost estimate is real).
- **G13 — "The migration name says votes_comments but carries the featured view — split it?"**
  One step, one migration is the repo's norm (B23 shipped tables + view + triggers together);
  the view is meaningless without the tables. Kept as one file.
- **G14 — plan defect caught in the final round: `loadProgramPage` had no viewer parameter**,
  but D4's my-vote read must filter `user_id = me` (every viewer of a program may read all its
  votes — G4/B23 — so RLS cannot narrow to "mine"). Fixed in D4: the function gains
  `me: string | null`, null skips the read. The route already holds `me` (`useAuth`); its tests
  pin the filter against the recording fake.
- **G15 — "Skip the scores/my-vote reads on non-published programs, since the social row never
  renders there?"** No: the reads are harmless under RLS (they answer with what the viewer may
  see), and branching the read shape on visibility is a second code path for no observable
  gain. Reads unconditional; the row's render condition is the one gate. Settled.
- **Scope verdict:** right as written. The deliberate readings are D2 (published-only writes —
  the handoff's standing input, flagged as risk 3 for Gate 1), D3's rolling windows (G3), and
  D7's reporting deferral (the B23→B27 precedent). The deliberate inclusions are the two
  extractions (D5, D6 — both are the second-copy extractions the repo's own precedent orders).
  Nothing narrowed: both arrows, the full four windows, comments with the full post-parity
  limits all ship.

## Build deviations (builder run, recorded before commit)

- **X1 — Second migration `20261116015334_program_social_reads.sql` (review fix, D2 amended).**
  Two read-policy defects in D3's SQL, both found after `…012712_program_votes_comments` was
  applied, fixed by replacing the two select policies:
  1. *B27 parity was missing.* Post `votes`/`comments` reads also require
     `private.author_visible(user_id)` (B27: a blocked-either-way or muted lifter's votes and
     comments disappear). The plan's "What exists" described the B23 policies only. Program reads
     now use the same clause, so `program_scores`, like `post_scores`, sums the votes the viewer
     may see — "exactly as feed posts do".
  2. *D2/G8's "a lifter can always take their own row back" was false as written.* Postgres
     applies the select policy to the rows a `DELETE … WHERE` scans; once a program is no longer
     visible to the voter (unpublished), `clearProgramVote` deleted 0 rows (live-probed). Both
     select policies gain `user_id = auth.uid() or …` — your own rows reveal nothing you didn't
     write, and the program itself stays hidden (`program_scores` reads programs under your RLS).
     Live-probed after the fix: unvote and own-comment delete on an unpublished program → 1 row
     each; another user's vote → 0; a flip (update) there is still refused 42501 (insert/update
     stay published-only, as D2 says). Post tables are unchanged (their own analogous
     after-hide-delete gap is pre-existing and out of scope — recorded in DEFERRED).
- **X2 — D5 shape: hook + arrows + control, not one component.** `VoteControl.tsx` exports
  `useOptimisticVote` (the moved state/tap/reset logic), `VoteArrows` (the moved JSX + the moved
  `VoteArrow`), and `VoteControl` (both plus the refusal line, used by the program page).
  `PostFooter` uses the hook + `VoteArrows` so its refusal line keeps its place under the whole
  footer (moving it into the arrows column would have been a layout change). Review fix: a
  sender that throws now counts as 'failed' and releases the in-flight lock (it used to stay
  locked); today's senders never throw.
- **X3 — D6 shape: `CommentsPane` owns its own load + Retry.** Props are `load`, `send`, `me`,
  optional `onReport` and `placeholder` (the plan said "the already-loaded state plus `onSend`").
  Owning the load lets both routes be genuinely thin (Back + heading + wiring); the post route
  re-exports `MORE_COMMENTS_LINE`/`SEND_FAILED_LINE` so its existing tests run unedited.
- **X4 — The program page also re-reads on focus** (D6 put the focus re-read on the tab only),
  so the comment count and score are fresh after returning from the comments screen. First focus
  is skipped (the opening read). The tab does the same.
- **X5 — Featured hides on an empty shelf** (nothing published → only the browse list's empty
  message), and the featured card shows "by Alex · ▲ 12" with its own accessibility label
  ("Open featured program …, score N") so the two lists stay distinguishable. The B40 tab tests
  were edited for this: their five `findByText('PHUL')` waits now wait on the browse card's label
  (a featured card carries the same name). The B23 post tests are unedited.
- **X6 — `PROGRAM_COMMENT_SELECT` / `COMMENT_SELECT` share one author-embed constant** (review
  fix); `refusal`/`refusalFor` collapsed into one function (review fix, behaviour unchanged).
- **Not done from review, on purpose:** `commentButtonLabel` stays imported from `PostCard` (G11);
  `PostComment`/`toPostComment` keep their names for program comments (a rename would edit B23
  files for taste); `program_votes.user_id` stays unindexed (D3, the B23 D4 reading); the two
  comments routes keep their small duplicated shell (Back + wiring, ~20 lines).
- **Live HTTP embed probe not run:** the permission layer declined outbound HTTP from this run,
  so `program_scores?select=…,author:profiles!programs_user_id_fkey(…)` (risk 1) is Gate 2's. The
  shape mirrors `post_hot_scores`, which is proven live; the pre-approved fallback stands.
