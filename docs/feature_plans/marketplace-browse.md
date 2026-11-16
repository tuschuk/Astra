# marketplace-browse (B40)

Covers **MKT-1** (browse and search published programs — DoD: "Any published program is findable
by search and browse"), **MKT-4** (program page: author, length, days per week, full workout
breakdown — DoD: "A program page shows all four facts plus every workout's contents") and
**MKT-5** (save and start from the page — DoD: "One action from the program page saves it and
makes it the active program in the logger"). Depends on B39 (the `published` visibility level,
the widened `programs` read policy, `public.program_payload`) and B35 (`program_runs`,
`startProgramRun`), and through B37 on `createProgramFromPayload`.

Step scope: Marketplace tab lists published programs with Postgres full-text search; program page
shows author, length, days per week and every workout; Save and Start makes it the active
program. Step DoD: **any published program is findable and startable in one action.**

Scope verdict: right as written; nothing widened or narrowed. Two handoff-delegated decisions are
settled below: **no `description` column** (D1) and **list cards carry name + author only** (D2).

## What exists (verified before planning)

- **B39 already opened the server.** The `programs` select policy admits `published` rows to any
  signed-in user (`20261115235525_program_visibility.sql`), and `public.program_payload(p_program)`
  returns the full live tree as JSON, gated by `private.program_visible`, EXECUTE revoked from
  anon. **No new policy and no new RPC are needed for reading.** The three child tables stay
  author-only — the Marketplace must never read them directly (B34's standing warning).
- **The payload parse has one home.** `program_tree_json` returns `{ name, weeks: [{ position,
  workouts: [...] }] }` — byte-identical in shape to what `parseProgramPayload` in
  `social/teamCoaching.ts` already checks and converts (B37/B39 share the tree builder). B40
  imports that parser; it does not write a second one.
- **Save and Start exists as a sequence, not a function.** `useTeamCoaching.tsx`'s assignment
  accept flow runs `createProgramFromPayload` (fresh ids, one transaction, coach-custom slots
  nulled with a counted `skippedExercises`) then `startProgramRun` (ends other active runs,
  refuses empty programs with a typed error), with distinct failure messages for "copy failed"
  (nothing saved) and "saved but couldn't start". The handoff directs extracting this into one
  shared home with two callers.
- **`TeamProgramSheet` renders a payload tree** (weeks → `WorkoutCard` → `SlotLine` with
  `formatProgramTargets` in the display unit) — the exact rendering MKT-4's breakdown needs.
- **No full-text search exists anywhere** — no tsvector column, no `textSearch` call, no GIN
  index. `programs` has no description column (B34 deferred it).
- **Patterns:** online surfaces read through `getSupabase` with injected-client modules under
  `social/` and show the standard connection message offline (feed precedent); `find-lifters.tsx`
  is the debounced-search precedent; `useAppDatabase` + `useAuth` give device + user id;
  `profiles` select is public (B25), so an author embed works for any reader. "Show more" by
  growing the read's limit is the B30 precedent.
- **Marketplace tab** (`app/(tabs)/marketplace.tsx`) is a placeholder with fake cards and a
  "Featured this week" skeleton — replaced wholesale by this step (featured is B41).

## Settled decisions

### D1 — No `description` column in this step

The handoff left it to the planner ("a nullable `description` … is in scope if the planner wants
searchable text beyond the name, recorded either way"). Decision: **not added.** Every covered
DoD is satisfied by the name: MKT-1 needs findability (name search + browse list), MKT-4 names
its four facts exhaustively and a description is not one, MKT-5 doesn't read text at all. Adding
it would drag in authoring-side scope that belongs with B34's editor family: an input on the
program page, a `limits.ts` entry + CHECK, a synced column, device schema V15, and a migration of
the search expression when it lands. A later step that *shows* descriptions (B41 featured cards
are the natural reader) adds the column and swaps the generated expression in one migration —
nothing built here blocks that. Recorded in DEFERRED.

### D2 — Browse cards show name + author; length/days live on the program page

The B34 constraint decides this: the child tables are author-only, so a non-author's embed
(`programs?select=*,program_weeks(count)`) returns empty children — **a browse list cannot count
weeks through PostgREST**, and fetching every listed program's payload to decorate cards is N
RPCs per page. The alternatives — a definer list-RPC or a counts view — duplicate
`program_visible`-gated surface for decoration no DoD asks for. MKT-1's DoD is findability;
MKT-4 puts the four facts *on the program page*, where the payload is already fetched once.
Cards show the program's name and author (and tap through); the page shows everything. B41
(featured, votes) is the step that redesigns card decoration and can earn a counts surface.

### D3 — Full-text search: a generated tsvector column on `programs.name`

One migration, `backend/supabase/migrations/<ts>_marketplace_search.sql` (builder applies via
MCP, then renames the file to the version Supabase records — the B11 discipline):

```sql
-- Search over the program's name. 'simple' (not 'english'): program names are proper
-- nouns and gym jargon ("PHUL", "5/3/1"); stemming adds nothing and 'simple' is
-- language-neutral and predictable. Generated, so it can never drift from `name`.
alter table public.programs
  add column search tsvector
  generated always as (to_tsvector('simple', name)) stored;

create index programs_search_idx on public.programs using gin (search);

-- The browse list's exact shape: published, live, newest first.
create index programs_published_idx
  on public.programs (created_at desc, id desc)
  where visibility = 'published' and deleted_at is null;
```

- Query: `.textSearch('search', query, { type: 'websearch', config: 'simple' })` —
  `websearch_to_tsquery` is built for raw user input (no syntax errors on quotes/operators), so
  nothing needs escaping client-side.
- The column is **not** in `TABLE_COLUMNS.programs` and must never be: sync selects named columns
  (`columnsOf`), so the device neither downloads nor tries to upload a generated column (an
  upload naming it would be refused by Postgres). No device schema change — **this step ships no
  V15.**
- Known limitation, recorded: websearch matches whole lexemes — "Starting Str" finds nothing,
  "starting" finds "Starting Strength". Prefix search (`:*`) or an ilike arm can be added on
  device evidence; the browse list makes short names findable without typing at all.
- Relevance ranking (`ts_rank`) is not reachable through plain PostgREST ordering; search results
  order newest-first like the browse list. Fine at launch scale; an RPC/view earns its keep only
  with volume (recorded).

### D4 — `social/marketplace.ts`: the one online-read module (new, + test)

Injected-client pattern (the `teamCoaching.ts` discipline), raw row types declared at the seam:

- `loadPublishedPrograms(client, { query, limit })` → `MarketplaceProgram[]`
  (`{ id, name, authorId, author: PersonName, createdAt }`): select
  `id,name,user_id,created_at,author:profiles!programs_user_id_fkey(username,display_name)`
  with `.eq('visibility', 'published')`, `.is('deleted_at', null)`, `.textSearch(...)` only when
  `query` is non-blank, order `created_at` desc then `id` desc, `.limit(limit)`. The explicit
  `visibility`/`deleted_at` filters are load-bearing: RLS alone would also return the caller's
  own private/followers/team programs and their own soft-deleted rows (the author arm).
- `loadProgramPage(client, programId)` → `{ summary: MarketplaceProgram, payload:
  TeamProgramPayload | null } | null`: one row read (the same select, with the `visibility`
  **column added — no `eq` filter**: the page serves whatever RLS shows, G8) and one
  `rpc('program_payload', { p_program })` parsed through the **imported** `parseProgramPayload`.
  Row absent (not visible to the caller / deleted) → null; row present but payload null (lost
  visibility between reads) → the page's "no longer available" state. Works for *any* program
  RLS shows the caller — their own, a followee's, a team share — but the only navigator built
  here is the Marketplace (published); that generality costs nothing and is what B39 recorded.
- `programFacts(payload)` → `{ weekCount, daysPerWeek: string }` — pure, exported for tests:
  `weekCount = weeks.length`; days per week from each week's live workout count — uniform `n` →
  `"n"`, varied → `"min–max"` (the honest label when weeks differ), no weeks → `"0"`.
- Paging: **grow-the-limit** (B30 precedent — a "Show more" that re-reads with limit + 30), not
  keyset. Simpler by a module, correct at launch scale; the feed's keyset shape is the recorded
  upgrade when the catalog grows.

Blocked authors are **not** filtered (B39's recorded reading: published is a public shelf;
client-side filtering needs a blocks read this step doesn't otherwise make). Recorded in
DEFERRED as the B39 option, unchanged.

### D5 — `programs/saveAndStart.ts`: the one Save-and-Start home (new, + test)

```ts
saveAndStartProgram(db, userId, payload, options?) →
  { programId, skippedExercises, started: boolean }
```

`createProgramFromPayload` then `startProgramRun`, in that order. Copy failure throws (nothing
saved — the caller shows "couldn't be saved"); a copy that lands but whose run won't start
(empty program, or any throw) returns `started: false` so callers keep the honest
"saved, but couldn't be started" message. **`useTeamCoaching`'s assignment accept is refactored
to call it** — the handoff's directive: the Marketplace page and the team banner become two
callers of one home, and the B37 sequence stops being a copy waiting to be mirrored. The team
flow keeps everything else it does (spent-footer flag, assignment consumption, its messages).
Save-without-start stays `createProgramFromPayload` called directly (both callers already do).

`startProgramRun` ends any current active run (B35's contract) — the page says so next to the
button when a run is active ("This will replace your current program") rather than adding a
confirm dialog the team accept flow doesn't have; one behaviour, both callers (G7).

### D6 — Screens

**`app/(tabs)/marketplace.tsx` (rewritten):** search box at the top (debounced, the find-lifters
pattern), then the list — every published program, newest first, as cards (name, author name) —
with "Show more" past the first 30. Tap → `/marketplace-program/[id]`. Online surface: no
connection → the standard message + Retry (feed precedent); no results for a query → "No
programs match"; an empty Marketplace → "Nothing published yet." The placeholder cards and
"Featured this week" skeleton go away (featured is B41's; the lede line stays honest about
votes coming later).

**`app/marketplace-program/[id].tsx` (new route):** the program page.

- Loads `loadProgramPage` on mount; offline → connection message + Retry; null → "This program
  is no longer available."
- Header: program name; author line (tap → `/profile/[id]`, the existing route); facts line —
  "N weeks · M days/week" from `programFacts`.
- Breakdown: every week, every workout, every slot with targets in the lifter's display unit —
  via the shared payload renderer (D7). This is MKT-4's "full workout breakdown": the same
  rendering a team member sees before saving a pushed program.
- Actions (own vs. others'): the caller's **own** program shows "This is your program" and an
  **Open in editor** link to `/program/[id]` instead of copy buttons (copying your own program
  into a duplicate is never what that tap means). Anyone else gets **Save and Start** (primary;
  `saveAndStartProgram` → on success route to the Workout tab, which now shows the run card —
  MKT-5's "active program in the logger") and **Save to my programs** (ghost;
  `createProgramFromPayload` only — the B37 push-save precedent). Both report
  `skippedExercisesLine` when slots didn't copy (a published program can name the author's
  custom exercises — same rule, same words as B37). A payload with no runnable session disables
  both with "This program has no workouts yet" (mirrors `startProgramRun`'s refusal instead of
  surfacing it as an error). After a successful save/start the buttons are spent (the B37
  review-fix rule: a second tap must not copy twice). If a workout draft is in progress, Save
  and Start still works (a run is not a workout): the Workout tab then shows Resume first and
  the run card once the draft is finished or discarded — B35's one-thing-at-a-time rule,
  unchanged; MKT-5's "active program" is true throughout (`readActiveRun` resolves it).

**Route tests** live in `frontend/src/__tests__/` (expo-router rule). The save/start work runs
on the device database; the reads run on the injected client — the page needs both, like
`app/program/[id].tsx` already does.

### D7 — One payload renderer, extracted, not copied

`components/programs/ProgramPayloadView.tsx` (+ test, new): the weeks → workouts → slots
rendering lifted out of `TeamProgramSheet` (its `WorkoutCard`/`SlotLine`/weeks map, props:
`payload`, `unit`). `TeamProgramSheet` keeps its modal shell, heading logic, footer and
messages, and renders the view for program-shaped content; the Marketplace page renders the same
view inline. A second hand-rolled copy of "how a program tree renders" is the mirrored-copy bug
class this repo bans — this is the B39 tree-builder extraction, client-side.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<ts>_marketplace_search.sql` | new — D3: generated `search` column, GIN index, partial browse index |
| `frontend/src/social/marketplace.ts` (+ test) | new — D4: list read, page read, `programFacts` |
| `frontend/src/programs/saveAndStart.ts` (+ test) | new — D5: the one copy-then-run home |
| `frontend/src/components/teams/useTeamCoaching.tsx` | edit — accept flow calls `saveAndStartProgram` |
| `frontend/src/components/programs/ProgramPayloadView.tsx` (+ test) | new — D7: extracted renderer |
| `frontend/src/components/teams/TeamProgramSheet.tsx` | edit — renders `ProgramPayloadView` |
| `frontend/src/app/(tabs)/marketplace.tsx` | rewrite — D6: search + browse list |
| `frontend/src/app/marketplace-program/[id].tsx` | new — D6: the program page |
| `frontend/src/programs/programs.ts` | edit — the Published chip's meaning drops "(coming soon)": the Marketplace now exists (+ its test if it pins the string) |
| `frontend/src/__tests__/screens.test.tsx` | edit — the placeholder "featured section" assertion is replaced by the rewritten tab's smoke case (or dropped for the dedicated test below) |
| `frontend/src/__tests__/marketplace.test.tsx` | new — tab: list, search, offline, tap-through |
| `frontend/src/__tests__/marketplace-program.test.tsx` | new — page: four facts, breakdown, both actions, own-program state |
| existing team tests (`__tests__/team.test.tsx`, component tests) | stay green through the D5/D7 refactors (no behaviour change) |
| `docs/diagrams/database-erd.md` | `search` column + the two indexes, policy unchanged note |
| `docs/diagrams/app-flow.md` | Marketplace tab → search/browse → program page → Save and Start → run; B41 marked future |
| `docs/DEFERRED.md` | D1 description, blocked-author filter, prefix search / ranking / keyset, B40 follow-ups |

Data model impact: one generated column and two indexes on `programs` — **no new table, no new
policy, no new RPC, no device schema change, no sync change, no new dependency.** Nothing for
`export-data` (generated columns aren't user data; the standing program-tables gap is unchanged).

Builder footguns: new route → `npx expo start --offline` (~150 s) before `tsc` → lint → Jest
(`--maxWorkers=50%` on timeout); apply the migration via MCP then rename to the recorded version;
the fake social client needs a recording `textSearch` method (it already speaks `rpc` since B37);
fakes only in tests. Keep `saveAndStart.ts` free of `activeWorkoutSession` imports (the B35
cycle rule: it composes `copyProgram` + `programRuns` only).

## How each definition of done becomes observably true

- **MKT-1 ("any published program is findable by search and browse")** — module test: the fake
  client records `visibility=eq.published`, the `is` filter, and `wfts(simple)` with the typed
  words; route test: a fake client seeded with published rows renders their cards, typing a word
  narrows to the match, clearing restores the browse list. **Gate 2 HTTP probe (the step DoD's
  "findable")**: with a throwaway JWT, `programs?select=…&visibility=eq.published&search=wfts(simple).<word>`
  returns A's published program for B; the same word search does **not** return A's private
  program; no token → 401/refused. (The B39 HTTP pass this extends is already Gate 2 recipe.)
- **MKT-4 ("author, length, days per week, full workout breakdown")** — route test: a 2-week ×
  2/3-workout fixture payload renders the author's name, "2 weeks", "2–3 days/week", and every
  workout card with every slot's name and targets. `programFacts` unit tests: uniform, varied,
  zero weeks.
- **MKT-5 ("one action saves it and makes it the active program in the logger")** —
  `saveAndStart.test.ts` on real SQLite: payload → `saveAndStartProgram` → the program's rows
  exist under the lifter's id, queued for push, and `readActiveRun` resolves the copy with
  Week 1's first session next (`started: true`); an empty payload → copy exists, `started:
  false`, no run. Route test: tapping Save and Start calls the home once and routes to the
  Workout tab; a second tap is impossible (spent). Team regression: the refactored accept flow's
  existing tests stay green.
- **Step DoD ("findable and startable in one action")** — the conjunction of the MKT-1 probe and
  the MKT-5 flow; the Gate 2 Jest headline is the B35 four-session flow's shape: a published
  fixture payload through `saveAndStartProgram`, then `startProgramSession` opens Week 1 Day 1
  prefilled.
- **Device verification (Built → Done, Tristen):** account A publishes a program (B39 chips);
  account B: Marketplace tab lists it → search a word of its name → tap → page shows author /
  weeks / days + the full breakdown → Save and Start → Workout tab shows the run → Start next
  session is A's Day 1 with targets; airplane mode → Marketplace shows the connection message;
  B's copy survives kill + reopen and syncs up (own rows in Supabase).

## Out of scope (this branch)

- **Featured sections, program votes, comments, popularity ranking** — B41 (the tab's layout
  deliberately leaves the list as its single section until then).
- **`programs.description`** — D1; lands with the first step that displays one (B41 cards are
  the natural reader), one migration swapping the generated expression.
- **Download/save counts, counts-decorated cards** — D2 / B41.
- **Blocked-author filtering of the published shelf** — B39's recorded option, still open.
- **Prefix/typeahead search, ts_rank ordering, keyset paging** — D3/D4 recorded upgrades, on
  evidence.
- **Publishing UX changes** — the B39 chips are the publish surface; nothing changes here.
- **Unpublish/takedown moderation of published programs** — no DoD asks; founder tooling on
  evidence.
- **A "Marketplace" entry for followers/team-shared programs** (a followee's program list etc.)
  — the page serves them if navigated to, but no browsing surface lists them; B39 recorded this
  as unplanned.

## Risks a reviewer should weigh

1. **The browse query is the app's first unfiltered-by-user `programs` read**, standing on
   B39's policy plus two explicit filters. If the `eq('visibility','published')` or
   `is('deleted_at', null)` filter were dropped, the caller's own private programs (and their
   own deleted ones, via the author arm) would appear in their Marketplace — confusing, though
   never a leak (RLS still hides *other* people's non-published rows; the Gate 2 probe pins the
   leak direction). The filters are pinned by the module test against the recording fake.
2. **The D5 refactor edits B37's working accept flow.** Mitigation: `saveAndStartProgram` is a
   pure extraction (same two calls, same order, same failure split carried by `started`), the
   team tests run unchanged, and the plan forbids behaviour drift — any message or ordering
   change is a deviation to record. The alternative (a second copy of the sequence on the
   Marketplace page) is the mirrored-copy class and was rejected.
3. **The D7 extraction edits a second working B37 surface** (`TeamProgramSheet`). Same shape as
   risk 2: moved JSX, not changed JSX; the sheet's own tests plus a new view test pin it. The
   cheap-looking alternative — copy the ~60 lines — is the ban again.
4. **A generated column on a synced table.** Safe because sync reads and writes *named* columns
   only (`columnsOf` / `TABLE_COLUMNS`, which don't gain `search`) — verified in exploration;
   a future widening of program sync to `*` selects would start downloading (harmless) and
   uploading (refused by Postgres) it. The ERD note must state the column is server-generated
   and must stay out of `TABLE_COLUMNS`.

## Grilling record (settled decisions)

Conducted by the planner session (autonomous pipeline, both sides at full severity). What was
attacked and what changed:

- **G1 — "The step needs no migration at all: `ilike` on `name` would satisfy 'findable'. The
  tsvector machinery is speculative."** The scope sentence names "Postgres full-text search"
  explicitly — it is the one piece of search machinery the step *orders*. And `ilike '%q%'`
  unindexed is a seq scan the published shelf would never outgrow gracefully, while the FTS
  column is ~10 lines of migration using what Postgres ships. Kept, with D3's limitation
  recorded honestly (no prefix matching; the browse list covers the short-query gap).
- **G2 — "Why no `search` arm over the author's username? Lifters will search 'PHUL by Alex'."**
  The tsvector is generated from the row's own columns; a username lives in `profiles` and
  can change, so indexing it means triggers or a denormalised copy — real machinery for a guess
  about behaviour. Author search exists already: Find lifters → profile. Deferred on evidence.
- **G3 — "D2 leaves browse cards thinner than the placeholder they replace (it showed weeks ·
  days/week)."** The placeholder faked data no query can cheaply produce (author-only children,
  D2's analysis). Shipping honest name+author cards beats shipping N-RPC cards or a new definer
  surface for decoration; B41 redesigns cards anyway (votes, featured). Kept, recorded as
  deliberate.
- **G4 — "Does `loadProgramPage` really need the row read? The payload has the name."** Yes —
  the payload has no author (the tree builder deliberately omits `user_id`), no `created_at`,
  and no way to tell "own program" for the editor-link state. One row read + one RPC, both
  already-opened surfaces, is the floor. (Adding author to the payload JSON was rejected: it
  changes a B37/B39 shared shape two other callers parse, for data PostgREST already serves.)
- **G5 — "`saveAndStartProgram` is a two-line wrapper — is extracting it worth touching B37?"
  (inverse of risk 2)** The handoff directs it by name, and the wrapper is where the *contract*
  lives (copy-throws vs. started:false — the split both callers' messages depend on). Without
  the home, B40 re-derives that split, and the next caller (B41? gyms?) makes three. Kept.
- **G6 — "Route collision: `app/marketplace-program/[id].tsx` vs. nesting under
  `app/marketplace/[id].tsx`."** The tab route `(tabs)/marketplace.tsx` already owns the
  `/marketplace` path; a sibling real directory of the same name invites group/path ambiguity
  for zero gain. The flat `marketplace-program/[id]` matches the repo's existing flat detail
  routes (`exercise-history/[exerciseId]`, `program-workout/[id]`). Kept.
- **G7 — "Save and Start silently kills an active run — a Marketplace browser won't expect
  that."** True and now surfaced: the page shows "This will replace your current program"
  beside the button when `readActiveRun` is non-null (one device read the page can make). A
  confirm dialog was weighed and rejected for parity: the team accept flow (same home, same
  consequence) has none, and two behaviours for one function is drift. If device use says a
  dialog is needed, both callers gain it at the home's call sites. D5 updated.
- **G8 — "Own published program shows editor link — but what about a program of mine that's
  *not* published, reached by its URL?"** The page serves whatever RLS shows (D4); the own-row
  check keys on `user_id`, not visibility, so any own program deep-linked shows the editor
  link. No listing surface links there today; correct either way. No change.
- **G9 — "A published program whose author blocked me: B39 lets me read it. The page's Save and
  Start then copies a blocker's program — fine?"** Fine and recorded: B39 settled that blocks
  don't cut the published arm (a public shelf), and a copy severs all relation to the author.
  The client-side list filter stays the recorded open option. No change.
- **G10 — "The `programs_published_idx` partial index is speculative — launch scale is dozens
  of rows."** It encodes the browse query's exact shape rather than guessing at one, costs
  nothing to maintain at low write volume, and avoids revisiting the migration when the shelf
  grows. Weighed against "add nothing speculative" and kept as the query's own index (the
  `team_posts_team_idx` class), not an anticipatory service. A reviewer wanting it cut loses
  nothing correctness-wise.
- **G11 — "Does the fake client's `textSearch` addition belong in this step's scope?"** Yes —
  it is test infrastructure for this step's own queries, the same way B37 added `rpc` to the
  fake when it first called an RPC. Footgun-listed so the builder extends the fake once, not
  per-test.
- **G12 — facts re-checked in the repo:** the B39 policy and RPC exist as described
  (`20261115235525_program_visibility.sql`); `parseProgramPayload` / `TeamProgramPayload` /
  `skippedExercisesLine` are exported; `createProgramFromPayload` writes `visibility:
  'private'` on copies (B39 build record) — a saved Marketplace copy is born private, correct;
  `startProgramRun` refuses empty programs and ends other runs (B35 §f); `useTeamCoaching.tsx`
  lines 240–267 are the extraction site; `TeamProgramSheet` body at lines 71–133 is the D7
  extraction site; `getSupabase` / `useAppDatabase` / `useAuth` patterns confirmed in routes;
  `profiles` embed via FK hint works in `teamCoaching.ts` (`TEAM_POST_SELECT`); no `textSearch`
  or tsvector anywhere (grepped).
- **G13 — "MKT-5 says 'active program in the logger' — is routing to the Workout tab enough?"**
  The Workout tab *is* the logger's front door (LOG-1/B35): the run card with "Start next
  session" prefilled is what "active program" observably means in this app. The DoD's Jest
  proof is `readActiveRun` resolving the copy; the route-to-tab is the human-visible half.
  Settled reading, recorded.
- **G14 — "Two actions (Save and Start / Save) where the DoD asks for one — widening?"** The
  DoD requires *one action that does both* — Save and Start, the primary button, is exactly
  that. Save-only is one extra button calling an existing exported function, with B37's
  push-save as the precedent that saving-without-running is a real want. Kept, recorded as the
  deliberate small inclusion.
- **G15 — "Save and Start while a workout draft is open — does the run vanish behind
  Resume?"** The run is created and active either way; the tab's one-thing-at-a-time rule
  (B35 §h) shows Resume until the draft is finished or discarded, then the run card. Made
  explicit in D6 so the builder doesn't "fix" it with a blocking dialog. No change in
  behaviour, only in the plan's words.
- **G16 — stale copy found by grep:** `programs.ts`'s Published meaning line reads "listed on
  the Marketplace (coming soon)" — false once this step merges. The one-line copy change joins
  the files table (the keep-comments-current rule applied to product copy).
- **G17 — existing-test collision:** `__tests__/screens.test.tsx` asserts the placeholder's
  "featured section"; the rewrite breaks it by design. Named in the files table so the change
  is deliberate, not a builder surprise. The fake client's missing `textSearch` was also
  confirmed by grep (G11 stands).
- **Scope verdict:** right as written. The step's three sentences map to D3/D4/D6 (list +
  search), D4/D6/D7 (page + four facts + breakdown) and D5/D6 (Save and Start). The deliberate
  inclusions are the Save-only button (G14) and the own-program editor link (D6 — without it
  the page offers an author a nonsense copy of their own program); the deliberate exclusions
  are D1 and D2, both delegated by the handoff and both recorded.
