# feed-sort-and-filter — B24: ranked / chronological feed toggle and flair filter

**Branch:** `feed-sort-and-filter` (from `main`)
**Build step:** B24 — covers **SOC-11** (ranked sort by votes, Reddit-style, switchable; the
choice persists) and **SOC-9** (filter the feed by flair; P1 pulled forward because it is one
query clause on this screen), both in full.
**Depends on:** B23 (`votes` and the vote tally; `post_scores` stays untouched — this step builds
its own view *beside* it, as B23's G10(h) recorded) and through it B20 (the feed query, keyset
paging, `flairs` as data, `posts_flair_idx`).

## Step definition of done (from the Build order)

Chronological / ranked toggle (Reddit-style hot score in a Postgres view) persisted per user;
filter the feed by flair. **Toggle and filter change the results and survive relaunch.**

## Scope readings settled up front

- **The sort choice is a device-local preference, not a `user_settings` column.** The handoff
  explicitly delegated this call. The server mirror path costs a migration, a schema-V7 device
  mirror, and a widening of B15's push/pull phases — all to make a sort order roam between
  phones, which nothing asks for: SOC-11's DoD is "the choice persists" and the step DoD is
  "survives relaunch", both true of the phone's key-value store (the B16 plate-rack precedent).
  "Nothing speculative" decides it. Recorded limit: the choice does not roam to a second device;
  if that ever matters, B26 (which mirrors `default_workout_visibility` anyway) is the natural
  ride. Grilled at G1.
- **"Persisted per user" means per user on this phone.** The kv-store key carries the signed-in
  user id (`astra.social.feedPrefs.<userId>`), unlike the plate rack (which is deliberately
  per-phone — equipment, not preference). Two accounts on one phone keep separate feeds. G2.
- **The flair filter persists too.** The step DoD's sentence covers both ("toggle and filter …
  survive relaunch"), so the selected flair rides in the same stored object. A lifter who
  filtered to Form Check yesterday reopens to Form Check, with the chip visibly selected — the
  filter is never invisible. G3.
- **The hot score has one home: the Postgres view.** The app never computes, adjusts or mirrors
  a hot score; it only echoes the server's number back as a paging bookmark. The formula is
  Reddit's published ranking (cited in the view's comment — the handoff's standing input), not
  an invention. G4 settles the formula; G5 settles what it reads (votes only, no comment count).
- **Flair chips come from the device's flair mirror** (`db/flairs.ts`, synced since B21) —
  names from rows, never words in code, and no extra request on a screen that already needs
  one for the feed itself. A stored flair id that no longer matches a mirrored row is treated
  as "All" rather than silently emptying the feed. G6.

## Data model impact

**One migration, one view, nothing else.** No tables, no columns, no RLS changes, no device
schema change (the preference lives in kv-store, not SQLite tables).

```sql
-- How the feed ranks posts when the lifter picks "Hot" (SOC-11, B24).
-- The formula is Reddit's published "hot" ranking (open-sourced in reddit's
-- r2/lib/db/_sorts.pyx; walked through in Amir Salihefendic's "How Reddit
-- ranking algorithms work"): newer beats older, votes lift a post roughly
-- logarithmically, and every ~12.5 hours of age costs about as much as a
-- 10× vote lead. 1134028003 is Reddit's arbitrary epoch offset, kept so the
-- formula matches its source verbatim; it shifts every score equally and
-- never changes the order.
create view public.post_hot_scores
  with (security_invoker = true) as
  select p.id,
         p.user_id,
         p.flair_id,
         p.workout_id,
         p.kind,
         p.image_path,
         p.visibility,
         p.created_at,
         (sign(coalesce(v.score, 0)) * log(greatest(abs(coalesce(v.score, 0)), 1))
            + (extract(epoch from p.created_at) - 1134028003) / 45000.0
         )::double precision as hot_score
  from public.posts p
  left join (select post_id, sum(value) as score
             from public.votes group by post_id) v
    on v.post_id = p.id;
```

- `security_invoker`, like `post_scores`: the viewer's own posts/votes RLS filters the rows, the
  view adds no reading power, and the security advisor stays quiet. Because every viewer of a
  post may read all its votes (B23 G4), the sum — and so the ranking — is the same for everyone.
- **The column list is the feed's contract, not a minimal id list.** It carries every posts
  column `FEED_SELECT` names (`kind`, `image_path`, `visibility`, `created_at`) so the hot page
  can run the feed's exact select against the view, plus every foreign-key column an embed hangs
  on (`flair_id` → flairs, `user_id` → profiles, `workout_id` → workouts, and `id` under its own
  name for the votes reverse join), which is what PostgREST's view-embedding detection reads
  (risk 1). The draft of this plan exposed only the ranking columns; G12 caught that the primary
  strategy would have failed on its first select, before any embed question even arose.
- `user_id` and `flair_id` also serve the feed's author in-list and the new flair clause
  directly on the view.
- Zero-vote posts: `sign(0) = 0`, so the vote term vanishes and they rank purely by age — among
  themselves, "Hot" reads newest-first, which is the right degenerate behaviour for a young feed.
- Like `post_scores`, the vote sum aggregates before the author filter (B23 recorded "measure
  when B24 builds the hot view"). Gate 2 runs `explain analyze` on the ranked read with the
  seeded data; if the plan shows the whole `votes` table being aggregated, the recorded rewrite
  is a lateral per-post sum — a view-body change, invisible to the app.

Migration applied live via MCP, file renamed to the recorded version (standard since B11).

## App modules

### `frontend/src/social/feedPrefs.ts` (new, + test)

The remembered feed preferences, the `plateRack.ts` pattern end to end: a versioned JSON blob in
`expo-sqlite/kv-store` under `astra.social.feedPrefs.<userId>`, a parse that never throws and
falls back to defaults (`{ sort: 'latest', flairId: null }`), an in-memory cache per user so a
tab switch doesn't re-read storage, a fire-and-forget save that logs a failure and shrugs
(worst case: a reset preference next launch), and a storage seam (`getItem`/`setItem`) so tests
hand in a fake. `FeedSort = 'latest' | 'hot'`. A stored `flairId` is kept as an opaque string —
whether it still names a real flair is the screen's call against the mirror (G6). One pattern
divergence from `plateRack.ts`: the in-memory cache is keyed by user id (a map, not a single
value), so an account switch on one phone can never show the previous account's preference.

### `frontend/src/social/feed.ts` (edit, + test)

- `FeedSort` drives `loadFeedPage`; the cursor becomes a tagged pair so a bookmark can never be
  replayed under the wrong order:
  `FeedCursor = { sort: 'latest'; created_at: string; id: string } | { sort: 'hot'; hot_score: number; id: string }`.
  (Today's shape gains the tag; `beforeCursorFilter` keeps serving the latest arm.)
- `loadFeedPage(client, me, authorIds, sort, flairId, after)`:
  - **Latest** — today's query on `posts`, untouched but for one clause: `.eq('flair_id', flairId)`
    when a flair is selected (SOC-9's "one query clause", on `posts_flair_idx`).
  - **Hot** — the same `FEED_SELECT` plus `hot_score`, read **from the view**
    (`from('post_hot_scores')`), `.in('user_id', …)`, the same `my_vote` alias filter, the flair
    clause, ordered `hot_score desc, id desc`, keyset
    `or(hot_score.lt.{h}, and(hot_score.eq.{h}, id.lt.{id}))` via a new `beforeHotCursorFilter`.
    One request shape for both sorts; `toFeedPost` unchanged; `RawFeedPost` gains an optional
    `hot_score` the hot arm reads for the next bookmark.
  - `loadPostScores` second request stays exactly as B23 left it, in both sorts.
- **Primary strategy and its named fallback (risk 1):** embedding *from a view to tables* is the
  PostgREST-documented direction (base-table columns preserved by the view carry their foreign
  keys), unlike B23's refused table→view embed. If the live server refuses any of the embeds on
  `post_hot_scores`, the fallback is mechanical and goes in this file as a deviation: read the
  view bare (`id, hot_score`) for one ordered page of ids, then today's `posts` + `FEED_SELECT`
  query `.in('id', ids)` and re-order client-side by the id list. The builder must not silently
  switch strategy.

### `frontend/src/app/(tabs)/index.tsx` (edit)

- Under "Your feed": a two-chip sort toggle — **Latest / Hot** — and a horizontal flair row —
  **All** plus one chip per mirrored flair (`readFlairs` via the existing `useAppDatabase`,
  picker order). Both reflect the stored preference; tapping saves it and reloads page one
  (bumping the existing `generation` ref, so a stale page can't land on the new order).
- On mount, preferences hydrate from kv-store *before* the first feed request, so launch issues
  one read in the remembered order — no flash of the wrong feed, no doubled request.
- Empty states: an empty page under a flair filter says so ("No *Form Check* posts yet" with the
  flair's name from the row) instead of the follow-nobody invitation — a filtered-empty feed is
  not a friendless one. The offline / error state is unchanged (the feed already needs signal).
- `PostCard` is untouched.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_post_hot_scores.sql` | new — the view above |
| `frontend/src/social/feedPrefs.ts` (+ test) | new — remembered sort + flair, kv-store |
| `frontend/src/social/feed.ts` (+ test) | edit — sort modes, tagged cursor, flair clause, hot query |
| `frontend/src/app/(tabs)/index.tsx` | edit — toggle, flair chips, hydrate-then-load |
| `frontend/src/__tests__/home-feed.test.tsx` | edit — toggle, filter, persistence behaviour |
| `frontend/src/test-utils/fakeSocialClient.ts` / `feedFixtures.ts` | edit — the view as a queryable table in the fake |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) |

No new route, so no typed-routes regeneration is strictly required; the check order stays the
standard one anyway (`npx expo start --offline` ~150 s → `tsc --noEmit` → lint → Jest).

## How the definitions of done become observably true

- **SOC-11 "toggle between chronological and ranked"**: the feed test seeds the fake with posts
  whose vote sums invert their age order, renders Home, flips the toggle, and asserts the order
  changes — and that the hot request went to the view, ordered by `hot_score desc, id desc`.
  Unit tests pin `beforeHotCursorFilter`'s string and the tagged-cursor round trip. Live, Gate 2
  reads the view as a seeded user and asserts: a 3-vote old post outranks a 0-vote slightly newer
  one; among zero-vote posts, newer first; a post invisible to the viewer (private/blocked) is
  absent from the view.
- **SOC-11 "the choice persists" / step DoD "survive relaunch"**: `feedPrefs` tests pin
  save-then-load through a fake storage, damaged-JSON fallback, and per-user keying; the screen
  test unmounts and remounts Home against the same fake storage and asserts the first request
  after remount already carries the remembered sort and flair. On the device, Tristen's check is
  kill-and-reopen.
- **SOC-9 "selecting a flair shows only matching posts"**: the screen test taps a flair chip and
  asserts every rendered card wears it and the request carried the clause; tapping All removes
  the clause. Gate 2 probes the clause live in both sorts.
- **The filter and toggle compose**: one screen test runs Hot + Form Check together and asserts
  both the order and the filtering hold; the keyset page-two request keeps both clauses.

## Offline / sync / privacy / rules check

- **Offline-first:** untouched where it applies. The feed was online-only before this step; the
  preference itself is readable offline (kv-store) so the toggle still *shows* the remembered
  state next to the offline message.
- **One home:** the hot formula lives in the view and nowhere else; the vote tally stays the
  server's; the flair names stay rows; the preference has one module (`feedPrefs.ts`).
- **Training math:** none involved — the hot score is a ranking formula, not training math; it
  still gets the one-home treatment and a cited source in the view comment (handoff's standing
  input; the CLAUDE.md citation rule itself is about product copy).
- **RLS:** no policy changes; the view is `security_invoker`, so it can only rank what the
  viewer may already see. No new exposure: `hot_score` derives from vote sums any viewer of the
  post could already read.
- **Nothing speculative:** no materialized view, no cached ranking, no decay cron, no
  controversy/top/rising sorts, no server-side preference. Each waits for evidence.
- **No AI, no numeric product claims:** the toggle copy ("Latest" / "Hot") makes no performance
  claim; the formula citation lives in SQL comments, not product copy.

## Out of scope (and where it lands)

- Ranking tweaks (comment weight, decay tuning, "Top"/"Rising") — a later SOC step, on product
  evidence; the view body is the one place to change.
- Preference roaming across devices (`user_settings` column + mirror) — with B26's settings work
  if ever wanted (G1).
- Filtering by multiple flairs, or filtering anywhere but Home — nothing asks for it.
- Comment-count or realtime-driven re-ranking; feed caching (would reopen B23's G1) — no.
- Moderation effects on ranking (blocked users' votes already vanish via RLS; the rest is B27).

## Risks a reviewer should read first

1. **Embedding from the view is the one novel PostgREST surface.** B23's refused embed was
   table→view (aggregates hide the relationship); this plan bets the hot page on the documented
   view→table direction (the view preserves the posts columns untouched — including every FK
   column — exactly so the posts relationships resolve). The fake pins the app-side shape either way, and the fallback
   (ids-from-the-view, then today's posts query, client re-order) is mechanical and recorded
   above — but only Gate 2's live read proves the primary. The builder must not silently switch.
2. **Keyset paging under a moving order.** A vote cast while the lifter scrolls moves hot
   scores, so page two's keyset can skip or repeat a post. Repeats are already absorbed
   (`appendPage` dedupes); skips are accepted ranked-feed behaviour (Reddit's own pages do the
   same) and heal on the next refresh. The float cursor is echoed back from the JS number the
   reply carried; double-precision round-trips losslessly through PostgREST's JSON at the
   shortest-repr level, and the `id` tiebreak means even a near-tie only costs one post one
   page. (No scientific-notation guard is needed: a hot score is ≈ (epoch − offset)/45000, a
   five-digit number for decades to come, so the JS number always prints plain.) Pinned by the
   `beforeHotCursorFilter` unit test; G8 settled leaving snapshots out.
3. **The aggregate-before-filter cost, inherited knowingly.** The view sums votes before the
   author/flair filters apply, the exact shape B23 flagged on `post_scores` with "measure when
   B24 builds the hot view". Gate 2 measures (`explain analyze` with the seeded corpus); the
   recorded rewrite (lateral per-post sums) changes only the view body. Launch scale makes this
   a measurement, not a blocker.

## Build deviations (recorded by the builder)

- **D1 — the author embed names its foreign key.** Risk 1's primary strategy held: embedding
  through `post_hot_scores` resolves the flair, workout and votes relationships. But the live
  server refused the bare `author:profiles(...)` on the view with `PGRST201` — through the view,
  `profiles` is reachable both by `posts_user_id_fkey` and many-to-many through `votes`
  (`votes.post_id` → view, `votes.user_id` → profiles). Fix: `FEED_SELECT` now says
  `author:profiles!posts_user_id_fkey(...)`, the relationship the server's own hint named. Probed
  live with the full select, the alias filter, `user_id` in-list, the flair clause, the hot keyset
  `or()` and the hot ordering: `post_hot_scores` 200, `posts` 200 (anon key, so empty bodies — the
  point was that the request parses and the embeds resolve). One select string still serves both
  orders. The fallback (ids from the view, then a posts read) was **not** used. The fake social
  client reproduces the refusal so a regression to the bare name fails a test.
- **D2 — a list is shown only under the chips it was loaded for.** The plan said a tap "saves it
  and reloads page one (bumping the existing `generation` ref)". The build keeps that (the reload
  follows from `refresh` depending on the order and flair; each refresh takes a new generation)
  and adds: a ready list records the order and flair it was loaded with, and while that differs
  from the current choice Home shows "Loading your feed…" instead of the list. That covers a chip
  tap *and* a remembered flair that only becomes active when a fresh flair list arrives, and
  "load more" always continues the list it belongs to (the screen can never offer the tagged
  cursor to the wrong order). Review caught that the first build forced the loading state from
  the tap handler, which stuck on "Loading" when the lit chip was re-tapped with a stale flair
  stored — fixed by deriving it instead; regression test added. A failed reload of a list the
  lifter has switched away from shows the connection error (not the old list).
- **D4 — the first feed request waits for the flair list too, not only the kv-store read.** G6
  needs the phone's flair list to decide whether the remembered flair is real, so the first read
  waits for `useAppDatabase` + `readFlairs` (a local read; a database that fails to open reads as
  an empty list → "All"). The flair row is hidden until both are read, so no chip is ever lit
  wrongly.
- **D5 — `grant select on post_hot_scores to authenticated`** added to the migration, mirroring
  `post_scores` (Supabase's default privileges grant it anyway; stated explicitly as B23 did).
- **D3 — the filtered-empty state carries a "Show all posts" action** (sets the flair back to
  All). The plan's message wording is kept: "No *Form Check* posts yet." EmptyState's pattern is
  that every empty state offers the action that fills it.
- **Live probe done in the build:** in a rolled-back transaction as an authenticated user, three
  zero-vote posts came back from the view newest first with hot scores ≈ 14682 (five digits, as
  risk 2 predicted). The multi-voter ranking probe and `explain analyze` need several real
  accounts with votes and are left to Gate 2 as the plan already assigns.

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session; checkable claims verified against
the repo (B20/B23 migrations, `feed.ts`, `index.tsx`, `plateRack.ts`, `db/flairs.ts`, handoff).

- **G1 — "SOC-11 says *persisted per user*; a kv-store blob is persisted per phone. Are you
  under-delivering the P0 feature?"** The feature's own DoD is the test: "the user can toggle …
  and the choice persists" — it says nothing about a second device, and the app has no
  second-device story anywhere yet (B07 explicitly defers even account-switch wipes). The
  server path costs migration + mirror + sync-phase widening now, against a need no feature has.
  The handoff's standing input delegated exactly this call and named the device-only answer as
  satisfying the DoD. Settled: device-only, per-user key, limit recorded, B26 named as the ride
  if roaming ever matters.
- **G2 — "Why per-user at all, if one phone ≈ one account today?"** Because the scope sentence
  says "per user" and the cost is the key string. The plate rack's per-phone choice was a
  product decision about shared equipment; a feed preference is personal. One line, no debate.
- **G3 — "Does the *filter* really persist? Maybe the DoD only means the toggle."** The step DoD
  sentence applies "survive relaunch" to both nouns. And a persisted filter is only honest if
  it is visible — hence the chip row always showing the selected state, and the filtered-empty
  message naming the flair. If Tristen dislikes sticky filters, flipping `flairId` out of the
  stored blob at Gate 1 is a two-line change.
- **G4 — "Why Reddit's exact formula and not something simpler, like score/age?"** The Build
  order names it ("Reddit-style hot score"), it is published and citable (the handoff requires
  the citation), and its properties are known: log-dampened votes so brigades don't pin a post,
  linear age so the feed turns over roughly twice a day. A homemade ratio would need its own
  justification and has no source to cite. Kept verbatim, offset constant included, so a reader
  can diff the SQL against the source.
- **G5 — "Should comment count feed the ranking? The card already shows it."** No. Reddit's hot
  uses votes only; adding comment weight would be an uncited, invented formula — exactly what G4
  avoided. The view joins `votes` alone, and `post_scores` (which also counts comments) stays a
  separate surface for the card's footer. Revisit only as a deliberate product decision.
- **G6 — "A stored flair id can outlive the flair list (re-seeded mirror, retired flair). A
  stale id filters the feed to nothing with no visible chip — a lifter would think the feed
  broke."** Caught in grilling. Settled: the screen resolves the stored id against the mirror
  before using it; no match → treated as All (and the stored value left alone, in case the
  mirror is just empty pre-first-sync). The filter can never be invisible.
- **G7 — "Hydrate-before-load adds a storage read to every Home mount — why not load with
  defaults and correct after?"** Because correcting after is a visible re-sort *and* a doubled
  feed request on every launch for anyone whose preference isn't the default. The kv-store read
  is a one-row SQLite hit, microseconds against the network read it gates, and the in-memory
  cache makes every later mount free. Measured instinct, same as B15's hydrate decision.
- **G8 — "Moving hot scores break keyset paging — shouldn't the cursor pin a snapshot?"** A
  snapshot (materialized ranking per request, or re-reading page one's scores on page two) is
  machinery against a cosmetic blemish: a duplicate is deduped by `appendPage`, a skip heals on
  refresh, and the ranked feeds lifters already use behave exactly this way. Priced, declined,
  recorded in risk 2.
- **G9 — "Does `my_vote` even work on the view? The embed filter names the alias, and B23 only
  proved it on `posts`."** Checked against the mechanism rather than assumed: the filter rides
  on the embed, and the embed is the thing risk 1 already stakes out — if embeds resolve on the
  view, the votes relationship is one of them (FK to `posts.id`, preserved as `id`); if they
  don't, the fallback's second query *is* today's proven `posts` request, alias filter and all.
  Either branch has the viewer's vote on the card; no third failure mode.
- **G10 — facts checked in the repo:** (a) `posts_flair_idx` exists (B20 migration line 80) —
  the flair clause has its index. (b) `posts_user_created_idx` serves the latest order; no index
  serves `hot_score` (computed) — expected, noted in risk 3's measurement. (c) `readFlairs`
  orders by `position, id` and `useAppDatabase` is already the screens' handle (`new-post.tsx`).
  (d) `generation`/`pageInFlight` refs in `index.tsx` already drop stale replies — the toggle
  reuses that, no new race machinery. (e) `FeedCursor` is exported and used only by
  `feed.ts`/`index.tsx`/tests, so tagging it is a contained change. (f) kv-store is already the
  app's preference store (`plateRack.ts`, the session) — no new dependency. (g) `flairs` mirror
  exists since schema V8 and sync replaces it wholesale; empty only pre-first-sync (G6 covers
  it). (h) B23's `post_scores` and its second-request read stay untouched — verified nothing
  here redefines or re-reads the tally except through the existing `loadPostScores`.
- **G12 — "The draft view exposed only `id, user_id, flair_id, created_at, hot_score`, but
  `FEED_SELECT` also asks for `kind`, `image_path` and `visibility`, and the workouts embed
  hangs on `workout_id` — the primary strategy's very first select would have been refused,
  no embed inference involved."** Caught in grilling, against `feed.ts`'s actual select string.
  Settled: the view carries the feed's full column contract (the SQL above), and the data-model
  section now says *why* each column is there, so a future posts column that joins `FEED_SELECT`
  knows to join the view in the same commit. This is also why the view, not the formula, is the
  part of the migration a reviewer should diff against `FEED_SELECT`.
- **G11 — "Two sort orders double the feed query surfaces — is `loadFeedPage` becoming two
  functions in a trenchcoat?"** It is one function with one branch at the query-builder stage;
  the select string, the scores second request, the shaping and the paging contract are shared.
  Splitting it would duplicate all of that to avoid one `if`. Revisit if a third sort appears.
- **Scope verdict:** right as written. SOC-9's pull-forward is exactly the promised "one query
  clause" plus the chips to drive it; the one place this plan goes beyond the scope's letter is
  the filtered-empty-state message (G6's honesty requirement, a few lines). Nothing narrowed;
  ranking variants, roaming and multi-flair filtering explicitly refused.
