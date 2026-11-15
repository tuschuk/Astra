# program-visibility (B39)

Covers **PRG-4** (program visibility: private, shared with friends or a Team, or published to the
Marketplace — DoD: "All three visibility levels are enforced server-side"). Depends on B34 (the
program tables and their author-only RLS) and B36 (teams, `private.is_team_member`); builds on
B37's payload-RPC machinery.

Step scope: `programs.visibility` column — private, friends (followers), Team, published —
enforced by RLS. Step DoD: **each level is verified through the API with two users.**

Scope reading: the PRD's "shared with friends" is Astra's **followers** relation (the app has no
separate friend graph; B26's post visibility made the same reading and the handoff directs it).
The PRD names three levels plus private; the enum has four values. Recorded, not widened.

## The constraint that shapes everything (B34's recorded warning)

The phone pulls the three program child tables (`program_weeks`, `program_workouts`,
`program_exercises`) **bare** — `supabaseTransport.ts` `pullProgramRows` filters `user_id` only
on `programs`; the children rely on author-only select policies to return the caller's rows and
nobody else's (`20261115193156_programs.sql`, header warning; B34 plan risk 1). Widening the
children's select policies would make every reader's next sync ingest other authors' program rows
into their device mirror.

**Settled (option (a) from the handoff, the B37 precedent):**

- The **children's select policies stay author-only, untouched.** Non-authors never read program
  child rows directly — not through sync, not through PostgREST.
- The **`programs` parent select policy is widened** to the visibility rule. This is mirror-safe
  because the parent pull is user-filtered client-side (`supabaseTransport.ts:124`), and it is
  what B40's Marketplace list will read.
- Non-authors read a shared program's **content** through one new SECURITY DEFINER JSON RPC,
  `public.program_payload(p_program)`, gated by the same visibility rule — the generalisation of
  B37's `team_program_payload`, which proved the shape. An online read, like the feed: other
  people's data is read online, never mirrored.

The rejected alternative — refetching children through their parent with an author filter — is
recorded (again) as the costly path: it touches every sync consumer and both B34 and B35 already
rejected it.

## Data model (one migration, `<ts>_program_visibility.sql`)

### 1. Enum and column

```sql
create type public.program_visibility as enum ('private', 'followers', 'team', 'published');

alter table public.programs
  add column visibility public.program_visibility not null default 'private';
```

Every existing program stays private (B34 shipped no column on purpose, so the default is the
status quo). No index on `visibility`: B40's Marketplace query is the first reader that could
want one, and it brings full-text search machinery of its own ("add nothing speculative").

### 2. `program_team_shares` — which Teams a `team`-visibility program is shared with

A program can be shared with more than one team, so this is a join table, not a column:

```sql
create table public.program_team_shares (
  program_id uuid not null references public.programs (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (program_id, team_id)
);
create index program_team_shares_team_idx on public.program_team_shares (team_id);
```

Online-only server rows (the teams-family precedent): **not** mirrored on the device, not in
`TABLE_COLUMNS`, no sync. No `updated_at`, no moddatetime — rows are inserted and deleted, never
edited (the `team_assignments` shape).

RLS (all `to authenticated`):

```sql
insert: with check (private.owns_program(program_id) and private.is_team_member(team_id))
select: using  (private.owns_program(program_id) or private.is_team_member(team_id))
delete: using  (private.owns_program(program_id))
```

- Insert: the author shares their own program, and **only with a team they are a member of**
  (the handoff's rule). `is_team_member` is B36's existing helper.
- Select: the author manages the list; members can see what is shared with their team (a later
  team-page surface reads it; the `team_feed_hides` precedent of letting readers see curation
  rows).
- Delete: author-only. Team deletion cascades the rows away (`teams` FK); program deletion too.

Two recorded product calls: an author who later **leaves the team keeps the share standing**
(they chose to share it and can unshare any time; the B38 removal trigger is not widened — pushes
by a removed coach stand the same way), and shares **persist when visibility moves off `team`**
(the arm below only reads them when `visibility = 'team'`, so a dormant share is inert; switching
back restores the old team list instead of losing it).

### 3. The visibility rule — one helper, `private.program_visible`

The single home of "may the caller see program X?", SECURITY DEFINER, `stable`,
`set search_path = ''`, taking the row's columns like `workout_visible(owner, vis)` does:

```sql
create or replace function private.program_visible(
  pid uuid, owner uuid, vis public.program_visibility, deleted timestamptz
) returns boolean … as $$
  select
    owner = (select auth.uid())
    or (
      deleted is null                       -- non-authors never see a soft-deleted program
      and (
        vis = 'published'                   -- any signed-in user (B40 lists them)
        or (
          vis = 'followers'
          and not private.blocked_either((select auth.uid()), owner)
          and exists (select 1 from public.follows f
                      where f.follower_id = (select auth.uid()) and f.followee_id = owner)
        )
        or (
          vis = 'team'
          and exists (select 1 from public.program_team_shares s
                      where s.program_id = pid and private.is_team_member(s.team_id))
        )
      )
    )
$$;
```

Decisions inside the rule, each recorded:

- **The author arm ignores `deleted_at`** — the author's own device mirror must keep pulling
  soft-deleted rows (that is how a delete reaches their other phones). Non-authors never see a
  deleted program (B37's payload gates made the same call).
- **Blocks cut the `followers` arm** (person-to-person sharing follows the `workout_visible`
  precedent: blocked-either hides everything). **Blocks do not cut the `team` arm** — team
  content is addressed to the team as a unit, exactly like `team_posts` select
  (`is_team_member` only, B37) and B36's recorded call that a blocked lifter can join your open
  team but never sees your person-to-person content. **Blocks do not cut `published`** — the
  Marketplace is a public shelf, not a relationship; B40 can filter blocked authors client-side
  if the product ever wants it.
- **Mutes play no part** (mute is feed curation, B27's whole-person *feed* rule; a program read
  is a deliberate navigation, and B37's coach access already ignores mutes).
- **`private` has no arm** — only the author branch can return true.

### 4. `programs` select policy — widened to the rule

```sql
drop policy "authors read their own programs" on public.programs;
create policy "visible programs are readable"
  on public.programs for select
  to authenticated
  using (private.program_visible(id, user_id, visibility, deleted_at));
```

Insert/update/delete policies are untouched (author-only; `visibility` rides the existing
author-only update policy, so only the author can ever change it — server-enforced, not
client-side). The three child tables' policies are **untouched** (see the constraint above).

### 5. The read path for content — `public.program_payload(p_program)`

B37 built the tree-to-JSON machinery inline inside `team_program_payload`. To avoid two copies
of the tree SQL (a mirrored copy is a bug), the migration:

1. extracts **`private.program_tree_json(pid)`** — the gate-free tree builder: program name +
   weeks → workouts → exercises as JSON, live rows only, ordered `(position, id)` at every
   level, exercise names joined from `exercises` (it reuses B37's existing
   `private.program_workout_json` for the workout level);
2. creates **`public.program_payload(p_program uuid) returns jsonb`** — SECURITY DEFINER,
   `stable`, empty search_path: returns `private.program_tree_json(p_program)` when
   `private.program_visible(id, user_id, visibility, deleted_at)` passes for that row, else
   null. `revoke execute … from public, anon; grant execute … to authenticated` (the B37
   lock-down, probed with a no-token call);
3. `create or replace`s **`team_program_payload`** to build its tree through
   `program_tree_json` — **its gate is byte-for-byte unchanged** (member of the team AND pushed
   to it or assigned to the caller in it AND live).

**`team_program_payload` and `team_workout_payload` are kept, not subsumed** (the handoff asked
for a recorded choice). A pushed or assigned program must stay readable by the team **regardless
of the visibility column** — a coach pushes a private program and that is correct and must keep
working (B37's contract; its clients call these RPCs by name). Folding the push/assignment arms
into `program_payload` would entangle two different grants (what I chose to show vs. what a
coach handed the team) and risk regressing B37 for zero caller benefit. Two RPCs, two gates, one
shared tree builder — nothing mirrored.

### 6. What `published` surfaces now

Nothing beyond RLS. No Marketplace tab, no listing, no search — B40's step. After B39 a
published program's **row** is readable by any signed-in user and its **content** by
`program_payload`; that is the whole of PRG-4's "published to the Marketplace" that this step
owns (the feature row is covered in full because enforcement — its DoD — is complete; browsing
is MKT-1/MKT-4/MKT-5).

## Device and app changes

### Sync (`visibility` is a synced column of `programs`)

- `db/schema.ts` — **V14**: `alter table programs add column visibility text not null default
  'private'` (migrates on open, the V11–V13 pattern); schema test updated.
- `db/dao.ts` — `ProgramVisibility` type (`'private' | 'followers' | 'team' | 'published'`),
  `visibility` on the `programs` row type and in `TABLE_COLUMNS.programs`. That one entry makes
  `writeLocal` upsert it, push upload it and pull download it — no sync-engine code changes.
  The fake transport's rows gain the column by type flow-through.
- The author edits visibility **offline** and it syncs (the column rides the ordinary row
  upsert; conflict is row-level LWW, the B14 class, accepted).

### `programs/programs.ts` (the one home — edits)

- `setProgramVisibility(db, userId, programId, visibility)` — ownership-checked,
  refuses deleted programs, `writeLocal` (the `renameProgram` shape).
- `PROGRAM_VISIBILITY_WORDS` + `PROGRAM_VISIBILITY_ORDER` — the chip labels and meaning
  sentences, one place (the `VISIBILITY_WORDS` precedent; separate table because the words
  differ: "Team" and "Published" don't exist for posts): private "Only you", followers "Your
  followers", team "Teams you share it with", published "Anyone on Astra — listed on the
  Marketplace (coming soon)".
- `ProgramRow` / `ProgramSummary` / tree reads carry `visibility` through.
- `createProgram` writes `'private'` explicitly (new programs are born private).

### `social/programShares.ts` (+ test, new) — the shares, online

Injected-client pattern, `TEAM_FAILED`-style calm refusals (reusing `codeOf` / `RLS_REFUSED`
from `social/teams.ts`):

- `listProgramShares(client, programId)` → `Set<teamId>`.
- `shareProgramWithTeam(client, programId, teamId)` — maps 42501 to "You can only share with
  teams you're in. If you just made this program, wait for it to sync and try again." (the B37
  D5 lesson: a just-created program fails `owns_program` until its row has synced); 23505
  (already shared) is success.
- `unshareProgramFromTeam(client, programId, teamId)`.

No client wrapper for `program_payload` in this step — no screen consumes it yet (B40's Save /
program page is the consumer; building the parse now is speculative). The RPC is exercised
directly by the Gate 2 API probe.

### UI — the author's control on the program page

`app/program/[id].tsx` gains a **"Who can see this"** section under the name field:

- Four chips (`ChoiceChips`, the B24/B26 pattern) from `PROGRAM_VISIBILITY_ORDER`, current value
  highlighted; tapping writes through `setProgramVisibility` — **works offline**, like the rest
  of the editor, and the meaning sentence for the chosen level shows beneath.
- Choosing **Team** reveals the share list: the lifter's teams (`loadTeamsOf`, B36) as toggle
  rows wired to `programShares` — **online-only**, with the standard `TEAMS_OFFLINE` line when
  there's no connection (visibility chips still work; the team list just can't be edited). Zero
  teams → "Join a team to share with it." Zero shares chosen → "Pick at least one team or only
  you can see this." (a `team` program with no shares is private-in-effect; allowed, hinted,
  harmless).
- Component: `components/programs/ProgramVisibilitySection.tsx` (+ test) so the route file stays
  readable; route-level behaviour pinned in `__tests__/program-visibility.test.tsx`.

**No reader UI in this step.** Nothing navigates to someone else's program yet — no screen, no
deep link (B40 builds the first browsing surface; a profile "Programs" section is unplanned).
The step's DoD is server enforcement verified through the API, and that is what ships.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<ts>_program_visibility.sql` | new — enum, column, shares table + RLS, `program_visible`, widened programs select policy, `program_tree_json` extraction, `program_payload` RPC, `team_program_payload` re-based on the shared builder, revokes/grants |
| `frontend/src/db/schema.ts` (+ test) | V14: `programs.visibility` on device |
| `frontend/src/db/dao.ts` | `ProgramVisibility`, row type + `TABLE_COLUMNS.programs` |
| `frontend/src/programs/programs.ts` (+ test) | `setProgramVisibility`, words/order tables, `visibility` through reads, `createProgram` default |
| `frontend/src/social/programShares.ts` (+ test) | new — share list/add/remove |
| `frontend/src/components/programs/ProgramVisibilitySection.tsx` (+ test) | new — chips + team toggles + meaning line |
| `frontend/src/app/program/[id].tsx` | mount the section |
| `frontend/src/__tests__/program-visibility.test.tsx` | route-level: chips change the row offline; team list needs connection |
| sync tests (push/pull round-trip) | `visibility` rides a program row both ways |
| `docs/diagrams/database-erd.md` | enum, column, shares table, helper + RPC notes, policy change |
| `docs/diagrams/app-flow.md` | the visibility section, the share path, the online `program_payload` read path (marked as having no consumer screen until B40) |
| `docs/DEFERRED.md` | items listed under Out of scope |

Data model impact: one enum, one column, one table, two helpers, one RPC, one policy swap, one
RPC body re-based; device schema V14. **No new dependency, no edge function, no change to
`SYNC_ORDER` or the pull shape.** `export-data` still exports neither programs nor runs — the
standing deferred item widens to note the new column rides `'*'` selects when that lands.

Builder footguns (standing): apply the migration via MCP, then rename the file to the recorded
version (`list_migrations`); new-route-free step but the schema bump still means
`npx expo start --offline` (~150 s) → `tsc` → lint → Jest (`--maxWorkers=50%` on timeout);
fakes only in tests; the fake social client already speaks `rpc` (B37) and gains the
`program_team_shares` table.

## How each definition of done becomes observably true

**Step DoD — "each level is verified through the API with two users"** (Gate 2, the PIPELINE.md
throwaway-JWT recipe; two users A (author) + B, a team T both belong to, and a third user C for
the negative follower case — SQL rolled-back claims probe first, then the live HTTP pass):

- **private:** A's program (default) — B reads the `programs` row → 0 rows; `program_payload`
  → null.
- **followers:** A sets `visibility = 'followers'`; B follows A → B reads the row and the
  payload returns the full tree; C (not following) → 0 / null; B blocked by A → 0 / null.
- **team:** A sets `'team'` and inserts a share to T → B (member) reads row + payload; C
  (non-member) → 0 / null; B after leaving T → 0 / null. Share RLS: C inserting a share on A's
  program → 42501; A sharing with a team A is not in → 42501.
- **published:** A sets `'published'` → B and C both read the row and the payload; a call with
  **no token** → 401 / refused (the revoke).
- **Mirror safety, every level:** B selects `program_weeks`, `program_workouts`,
  `program_exercises` bare (the pull's exact shape) → **0 rows even while the program is
  published** — the proof the device mirror cannot ingest foreign rows.
- **B37 unregressed:** a program pushed to T while still `private` → member's
  `team_program_payload` returns the tree (gate untouched); `visibility` has no effect on it.

**PRG-4 — "All three visibility levels are enforced server-side":** the probe above *is* the
enforcement demonstration, positive and negative, at the row and the payload, for
followers / Team / published (and private). Client code never filters; the only client-side
narrowing is the pull's own user filter, which the probe shows is not load-bearing for privacy
(children return 0 by policy alone).

**Jest:** `setProgramVisibility` (ownership, deleted refusal, offline write + outbox line);
round-trip sync of the column; `programShares` (happy path, 42501 mapping, 23505-is-success);
the section component (chips reflect + write, team toggles call the module, offline message);
route test (chip change persists through remount with the fake db).

**Device verification (Built → Done, Tristen):** on the program page set each visibility in
turn (airplane mode for the chips — they stick after kill + reopen; reconnect → the column in
Supabase); choose Team online, toggle a team on, see the share row in Supabase; second account
in that team reads the payload via the API (or, after B40, on device).

## Out of scope (this branch)

- **Marketplace browsing, search, Save and Start** — B40 (`program_payload` +
  `createProgramFromPayload` are its building blocks).
- **Any reader-facing screen** for shared programs (a followee's program list, a team-page
  "shared programs" section, deep links) — no covered DoD asks for one; the first is B40's.
- **Client wrapper/parser for `program_payload`** — lands with its first consumer (B40).
- **Program votes, comments, ratings, download counts** — Marketplace steps.
- **Share cleanup on team leave / member removal** — shares stand (recorded product call above);
  revisit on evidence.
- **`export-data`** still exports no program tables (standing deferred item; the new column
  changes nothing about that gap).
- **Block filtering of `published` programs** — recorded as a B40 client-side option if wanted.

## Risks a reviewer should weigh

1. **The `programs` select-policy swap is the step's one shared-surface edit.** Widening the
   parent read is mirror-safe *only because* the parent pull is user-filtered client-side —
   the inverse of the children's situation, where safety rests on the policy. Both halves are
   asserted by the probe (children bare-read → 0; the parent pull filter is code, pinned by the
   existing transport tests). The migration header must restate B34's warning with the new
   shape: **children stay author-only; anyone widening them must change the pull in the same
   step.**
2. **`program_payload` is a new client-callable definer function** — the B37 class of risk: the
   gate is the entire wall. Mitigations are B37's, reused: gate = one helper
   (`program_visible`) probed adversarially at every level (including blocked-follower and
   left-team), `stable` definer SQL with empty search_path, explicit revoke from anon + public,
   no-token probe. The tree builder itself is gate-free **by design** and lives in `private`
   (unreachable through the API); only gated functions may call it — stated in its header
   comment.
3. **Re-basing `team_program_payload` onto the shared tree builder touches a working B37
   surface.** The gate clause is kept verbatim and the probe includes the B37 regression case
   (private pushed program still readable by the team). The alternative — leaving B37's inline
   tree SQL and accepting a second copy in `program_payload` — was rejected: two copies of
   ordering/liveness rules is exactly the mirrored-math bug class this repo bans.

## Grilling record (settled decisions)

Conducted by the planner session (autonomous pipeline, both sides at full severity). What was
attacked and what changed:

- **G1 — "Is the payload RPC speculative? Nothing consumes it until B40."** No: it is the
  *positive half of the enforcement DoD*. Without a content read path, "shared with followers"
  shares a name string and nothing else — the step DoD ("each level verified through the API")
  would reduce to parent-row visibility, which is not program sharing. The RPC is the smallest
  read that makes the grant real, it is probed in this step, and B40 was already pointed at it
  by the handoff. The *client wrapper* for it, with no consuming screen, IS speculative — cut
  (Out of scope).
- **G2 — "Subsume `team_program_payload` into `program_payload` — one RPC, one gate."** Rejected,
  recorded in §5: the two grants are semantically different (author's visibility choice vs.
  coach's push), B37's contract says a pushed private program stays team-readable, and its
  clients call the RPC by name. Shared tree builder removes the duplication that was the real
  argument for merging.
- **G3 — "Why a shares join table and not `programs.team_id`?"** The handoff directs
  more-than-one-team sharing, and a column would make switching visibility destructive (one
  team forgotten per switch). The table is three policies and one index; the arm reads it only
  when `vis = 'team'`.
- **G4 — "Blocks on the team arm / published arm — why not everywhere, like
  `workout_visible`?"** Argued in §3: team content addresses the team as a unit (`team_posts`
  select has no block filter — B37 shipped that precedent deliberately); published is a public
  shelf. The followers arm — the person-to-person one — does take the block check. The handoff's
  own rule sketch drew exactly this line. One-line change in the helper if the product call
  flips.
- **G5 — "A `team` program with zero shares is secretly private — confusing?"** Allowed and
  hinted in the UI ("Pick at least one team…"). Forcing a share before allowing the chip would
  make the chip online-only and break the offline-first editing of the column for no safety
  gain (the failure mode is *too little* sharing).
- **G6 — "Visibility chips offline but team picker online — isn't that an inconsistent
  surface?"** It is the honest seam: the column is the lifter's own synced data (offline rule
  applies); shares are relations to server-owned team rows, exactly like joining a team
  (online-only since B36, with the recorded `TEAMS_OFFLINE` message). Faking offline shares
  would need an outbox for a non-mirrored table — new sync machinery, rejected as speculative.
- **G7 — "Should the author's *follower-visible* program hide from a follower who muted
  them?"** No — mute is feed curation (B27's definition); nothing here inserts programs into a
  feed. Recorded in §3 so the next step doesn't re-litigate it.
- **G8 — "Does widening the parent select leak programs into *search* or other embeds?"** The
  only parent-row readers today are the pull (user-filtered) and the author's own screens
  (device reads). No PostgREST surface in the app selects `programs` unfiltered; B40 will, on
  purpose. The probe's bare-children check covers the embed route (`programs` embedding
  children would still hit the children's own policies — PostgREST applies RLS per table).
- **G9 — "Soft-deleted published program — ghost on the Marketplace later?"** The non-author
  branch of `program_visible` requires `deleted is null`, so a deleted program disappears for
  everyone but the author everywhere the rule is used (row and payload) — pinned by a probe
  case (delete A's published program → B reads 0 / null).
- **G10 — "The author arm must keep returning soft-deleted rows"** (else the author's other
  phones never learn of the delete and resurrect it from their mirror). Caught during drafting
  and baked into the helper's shape — the `deleted is null` guard sits inside the non-author
  branch only. A probe case covers the author still pulling the deleted row.
- **G11 — "Is `visibility` on the device a schema bump worth V14, or could it stay
  server-only?"** It must mirror: the control is on an offline-first editor screen, and a
  server-only column would make the chips online-only (G6's logic in reverse). The bump is one
  `alter table` riding the existing migrate-on-open machinery.
- **G12 — facts re-checked in the repo:** `pullProgramRows` parent filter at
  `supabaseTransport.ts:124–125` (comment states the B34 reliance); the children's four
  author-only policies in `20261115193156_programs.sql`; `team_program_payload`'s gate and
  `private.program_workout_json` in `20261115222643_team_coaching.sql`; `blocked_either`,
  `is_team_member` exist (`private.*`); `follows` shape in `workout_visible`
  (`20261115150035_moderation.sql:71`); `ChoiceChips` used beyond toolkit (B24);
  `loadTeamsOf` / `codeOf` / `RLS_REFUSED` exported from `social/teams.ts`; device schema at
  V13 (`db/schema.ts:359–377`); `TABLE_COLUMNS.programs` lacks `visibility` (`db/dao.ts:440`).
- **G13 — "Is the `TABLE_COLUMNS` edit cosmetic?"** No — the transport selects **named columns**
  (`columnsOf(tbl)`, `supabaseTransport.ts:94`), so without the dao entry the column would
  neither download nor upload. The same fact is a safety property: a phone still running the
  pre-V14 app upserts only the columns it knows, and PostgREST's merge updates only provided
  columns — an old device cannot silently reset a program's visibility to the default.
- **G14 — type ripple:** `ProgramRow` gains a required field, so every fixture and fake that
  builds program rows needs the column — mechanical, tsc finds each site; noted as a builder
  footgun, not a design concern.
- **G15 — "Show visibility on the Programs list rows?"** Cut — no DoD needs it; the page
  section is the control surface. Trivially addable later.
- **G16 — PostgREST embedding** (`programs?select=*,program_weeks(*)`) cannot reach children:
  RLS applies per table, embedded children filter to 0 rows for non-authors. The Gate 2 probe's
  bare-children read covers the same policy; an embed case is added to the HTTP pass for
  completeness.
- **Scope verdict:** right as written. The step's scope line (column + RLS + API-verified
  levels) is implemented exactly; the two deliberate inclusions are the payload RPC (G1 — the
  DoD's positive half) and the author-side UI section (the column must be settable by a human
  for Tristen's device verification; a column only SQL can set is not a shipped feature). The
  reader-side UI, Marketplace surfaces and the payload client wrapper are explicitly left to
  B40.
