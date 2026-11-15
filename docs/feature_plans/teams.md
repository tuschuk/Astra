# teams — B36: Teams (create, join modes, Team feed, profile listing)

**Branch:** `teams` (from `main`)
**Build step:** B36 — covers **TEAM-1** (anyone can create a Team; open-join by default,
switchable to invite-only), **TEAM-2** (Team activity feed, reachable from Home), the Teams part
of **SOC-10** (Team and Gym feeds surfaced on Home), and the Teams part of **YOU-6** (profile
shows the user's Teams).
**Depends on:** B20 (posts, the feed read, `sanitizeSearchTerm`), and through it B23–B28's feed
machinery that the Team feed reuses wholesale.

## Step definition of done (from the Build order)

`teams` and `team_members` (owner, coach, member roles) with RLS; create a Team, open-join by
default, creator switches to invite-only; Team feed of members' posts reachable from Home and
Communities; Teams listed on the profile. **Both join modes work, only the creator switches
them, and the feed is linked from Home.**

## Scope readings settled up front

- **"Both join modes work" means invite-only must be joinable by someone**, or the second mode
  is half a mode (handoff standing input). The minimal mechanism that RLS can express without an
  RPC is **per-user invite rows**: a `team_invites` table the owner writes, read by the invitee,
  consumed on join. An invite-code string on the team row was rejected — a plain insert can't
  carry "the code I typed" past RLS, so codes need an RPC function and a code-entry UI; per-user
  rows reuse the Find-lifters search that already exists.
- **The Team feed widens nothing.** It shows what the viewer can already see, filtered to the
  team's members: one query over `posts` with a member-id list, through the existing
  `loadFeedPage` — the exact Home-feed read with different author ids. `private.workout_visible`
  and the posts policies are untouched; Team membership never changes who may see a post
  (handoff (b), settled as "no"). A member's followers-only post shows in the Team feed only to
  members who follow them — correct, not a gap: joining a team must not republish your
  followers-only content to strangers.
- **Teams are server-authoritative and online-only** (handoff (c), the B23 votes precedent):
  create / join / switch / invite need a connection; no device tables, no outbox, no device
  schema bump, no `SYNC_ORDER` change. Offline, the Teams surfaces say "needs a connection" the
  way the feed does. The offline-first rule governs logging and the Tool Kit, which don't change.
- **"Creator" and "owner" are the same person in B36.** The creation trigger writes the one
  `owner` row; nothing in B36 changes roles (coach assignment is B37, removal is B38), so
  "only the creator can switch" is enforced as "only the holder of the `owner` role", through
  one `private.is_team_owner` helper — the `owns_program` pattern. Ownership transfer does not
  exist; recorded out of scope.
- **Roster visibility follows the join mode** (settled under grilling, G4): an **open** team's
  member list is readable by any signed-in user; an **invite-only** team's roster is readable by
  members only. "Invite-only" then means one coherent thing — a private group — and the profile,
  directory and team page all inherit the right behaviour from RLS instead of each deciding.
  Own membership rows are always readable. The repo's precedent cuts both ways (follows are
  private; profiles are public); this line puts the choice in the creator's hands.

## Data model (one migration: `teams`, `team_members`, `team_invites`)

Two enums, matching the `workout_visibility` precedent:

```sql
create type public.team_join_mode as enum ('open', 'invite');
create type public.team_role      as enum ('owner', 'coach', 'member');
```

`coach` ships in the enum unused — B37 assigns it. Adding an enum value later is a migration
either way; shipping it now costs nothing and keeps B37's diff to policies. (Weighed as
borderline speculative, kept: the step scope itself names the three roles.)

### `teams`

```sql
create table public.teams (
  id         uuid primary key default gen_random_uuid(),  -- created online; server default, unlike offline-born workouts
  created_by uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  join_mode  public.team_join_mode not null default 'open',   -- TEAM-1: open by default
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Plus `moddatetime` on `updated_at` and an index on `created_by`. `on delete cascade`: deleting
the creator's account deletes the team (B32's deletion stays complete; members silently lose the
team — accepted at launch, ownership transfer is a later product call, recorded in Out of
scope). Name cap 80 matches `exercises.name`; no description column (not in scope, one-line
migration later).

### `team_members`

```sql
create table public.team_members (
  team_id   uuid not null references public.teams (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      public.team_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)              -- one row per user per team
);
create index team_members_user_idx on public.team_members (user_id);
```

The **owner row is created with the team by trigger** (`private.handle_new_team`, `security
definer`, the `handle_new_block` precedent): `insert (team_id, user_id, role) values (new.id,
new.created_by, 'owner')`. A team is never ownerless and no client ever writes an `owner` row.

### `team_invites`

```sql
create table public.team_invites (
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,  -- the invitee
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_invites_user_idx on public.team_invites (user_id);
```

An invite is standing permission to join, visible to its invitee. **Joining consumes it**: a
`security definer` trigger after insert on `team_members` deletes the matching invite row, so
"invited" always means "may join and hasn't" and the UI never has to dedupe. Inviting works in
both join modes (an invite to an open team is just a nudge; the join policy doesn't need it).

### Helpers — the ownership/membership rule lives once (`private.*`, the `owns_program` pattern)

All `security definer`, `stable`, `set search_path = ''` — definer also breaks the RLS
self-recursion a `team_members` policy that reads `team_members` would otherwise hit:

- `private.is_team_member(tid uuid)` — does the caller hold any row in `tid`?
- `private.is_team_owner(tid uuid)` — does the caller hold the `owner` row in `tid`?
- `private.team_mode(tid uuid)` — the team's `join_mode` (for policies on other tables).
- `private.has_team_invite(tid uuid)` — does the caller hold an invite to `tid`?

### Policies

```sql
-- teams: discoverable by every signed-in user (the directory and "you're invited" need the row)
select: to authenticated using (true)
insert: with check (created_by = (select auth.uid()))
update: using (private.is_team_owner(id)) with check (private.is_team_owner(id))  -- the join-mode switch (and rename); owner only = creator only in B36
delete: none                                                                      -- team deletion is a later step (B38's family)
-- plus: revoke update (created_by) on public.teams from authenticated;
-- without it an owner could rewrite created_by (the update policy only re-checks ownership
-- through the unchanged id), mislabeling the creator and re-aiming the deletion cascade (G10)

-- team_members
select: using (
  user_id = (select auth.uid())            -- always see your own memberships
  or private.is_team_member(team_id)       -- members see the whole roster
  or private.team_mode(team_id) = 'open'   -- open teams have a public roster (G4)
)
insert: with check (
  user_id = (select auth.uid()) and role = 'member'            -- self-join only, never as owner/coach
  and (private.team_mode(team_id) = 'open' or private.has_team_invite(team_id))
)
update: none                                                    -- roles change in B37, owner-only there
delete: using (user_id = (select auth.uid()) and role <> 'owner')  -- leave; owners can't abandon their team

-- team_invites
insert: with check (private.is_team_owner(team_id)
                    and not private.blocked_either((select auth.uid()), user_id))  -- the follows precedent
select: using (user_id = (select auth.uid()) or private.is_team_owner(team_id))
delete: using (user_id = (select auth.uid()) or private.is_team_owner(team_id))    -- decline / cancel
```

The step DoD falls out of the policies alone: open join = the first insert arm; invite join =
the second; non-invited join of an invite team = refused by RLS; the switch = the teams update
policy, owner-only. The app renders the switch only for the owner, but **the enforcement is the
policy** — never client-side.

`team_members.delete` (leave) is a one-line policy and a small button; strictly it is not named
by the scope sentence, but join-without-leave is a trap (settled under grilling, G6).

## Shared limits

`backend/supabase/functions/_shared/training-math/limits.ts` (the one home) gains
`MAX_TEAM_NAME_LENGTH = 80` and `assertValidTeamName(name)` (trimmed, 1–80, counted the server's
way), mirroring the CHECK — and the file's hand-mirrored table gains the `teams.name` line.
`createTeam` calls it before the insert.

## App modules and screens

### `frontend/src/social/teams.ts` (+ test) — the one module that talks teams to the server

Injected-client pattern (`feed.ts` / `follows.ts`); every function runs as the signed-in user
and RLS decides; refusals map to calm messages (`FOLLOW_FAILED` style):

- `createTeam(client, me, name)` — validate via `assertValidTeamName`, insert, return the row.
- `loadMyTeams(client, me)` — my membership rows joined to their teams (id, name, join_mode, my
  role). Powers Home's chips, Communities' "Your teams", and the own-profile section.
- `loadTeam(client, teamId)` — one team row (name, join_mode, created_by).
- `loadTeamMembers(client, teamId)` — the roster with profile names
  (`profiles!team_members_user_id_fkey(username, display_name, avatar_url)` embed). Returns
  what RLS allows: full roster for members/open teams, else only the caller's own row.
- `searchTeams(client, query)` — directory: `name ilike` via the **existing**
  `sanitizeSearchTerm` from `follows.ts` (imported, not copied), limit 20, min 2 chars.
- `joinTeam(client, me, teamId)` / `leaveTeam(client, me, teamId)` — self insert / delete.
- `setJoinMode(client, teamId, mode)` — the owner's switch (update `teams.join_mode`).
- `myInvites(client, me)` — invites with team embedded ("You're invited to …").
- `inviteToTeam(client, teamId, userId)` / `revokeInvite(client, teamId, userId)` —
  owner-side; `declineInvite(client, me, teamId)` — invitee-side.
- `teamMemberIds(client, teamId)` — the author-id list the feed read takes.

### Screens

| Piece | What it does |
|---|---|
| `app/(tabs)/communities.tsx` (rewrite Teams half) | **Your teams** (rows → team page) · **Invites** ("You're invited to X" → Join / Decline) · **Create a team** → `/team/new` · **Find teams** (debounced `searchTeams`, result rows show name + "Open / Invite only" + Join where joinable → team page). Gyms half stays the placeholder card. Offline → the standard "needs a connection" + Retry. |
| `app/team/new.tsx` | Name box (80-char limit surfaced) → Create → `router.replace` to the new team's page. |
| `app/team/[id]/index.tsx` | The team page: name, join-mode line, Join / Leave / "You're invited — Join"; owner sees the **join-mode switch** (`ChoiceChips`, Open / Invite only) and **Invite lifters** → invite screen; the **member list** (what RLS returns); then the **Team feed** — members' posts via `teamMemberIds` → `loadFeedPage(client, me, ids, 'latest', null, cursor)` with the same `PostCard`s and paging Home uses. What a non-member sees is RLS's answer, made explicit: **open team** → roster and feed (public posts only — a join-decision aid for free); **invite-only team** → neither, just the team row, a "Join to see the team's activity" line, and Join only if invited. |
| `app/team/[id]/invite.tsx` | Owner-only surface: the Find-lifters search (`searchLifters`) with Invite / Invited per row (`inviteToTeam` / `revokeInvite`). |
| `app/(tabs)/index.tsx` (Home, edit) | **SOC-10/TEAM-2 Home link:** a "Your teams" chip row between the feed controls and the list — one chip per team → `/team/[id]`, loaded with `loadMyTeams` on focus, rendered only when the user has teams or invites (an invite shows as a badge chip → Communities). No teams → no row, zero cost to the feed. |
| `components/teams/TeamListItem.tsx` | One team row (name, mode, member-count-free) shared by Communities lists and the profile section. |
| `components/profile/ProfileView.tsx` (edit) | **YOU-6 part:** a **Teams** section above the tabs — the shown lifter's teams as `TeamListItem` links → team page. Reads `team_members` for that user id; RLS means: own profile → all; someone else's → their open teams + invite-only teams shared with the viewer. Empty → the section is absent (no "no teams" noise on every profile). |

Route tests live in `frontend/src/__tests__/` (expo-router rule): `communities.test.tsx`,
`team.test.tsx`, `team-invite.test.tsx` as needed; component/module tests sit beside their files.

**Third-copy rule (G11):** Home and ProfileView each already wire `castVote` / `clearVote` /
`reportPost` / `resharePost` / visibility handlers around a post list; the team page would be
the **third copy**, and the repo's recorded convention (B27/B32 review notes) is "merge when a
third appears". So the team page's post-list action wiring is extracted into one shared hook
(e.g. `components/social/usePostListActions.ts`) that the team page uses; Home and ProfileView
adopt it in this step only if the adoption is mechanical — otherwise the hook ships with the
team page as its first user and a DEFERRED note records the other two.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_teams.sql` | new — enums, `teams`, `team_members`, `team_invites`, `private.*` helpers, two triggers, policies, column revoke, indexes |
| `backend/supabase/functions/_shared/training-math/limits.ts` (+ its test) | edit — `MAX_TEAM_NAME_LENGTH`, `assertValidTeamName`, mirror-table comment line |
| `frontend/src/social/teams.ts` (+ `teams.test.ts`) | new — every team read/write (see above) |
| `frontend/src/components/teams/TeamListItem.tsx` (+ test) | new — one team row |
| `frontend/src/components/social/usePostListActions.ts` (+ test) | new — the extracted post-action wiring (G11) |
| `frontend/src/app/(tabs)/communities.tsx` | rewrite Teams half; Gyms card untouched |
| `frontend/src/app/team/new.tsx` | new — create form |
| `frontend/src/app/team/[id]/index.tsx` | new — team page + Team feed |
| `frontend/src/app/team/[id]/invite.tsx` | new — owner's invite search |
| `frontend/src/app/(tabs)/index.tsx` | edit — "Your teams" chip row (SOC-10 part) |
| `frontend/src/components/profile/ProfileView.tsx` (+ its tests) | edit — Teams section (YOU-6 part) |
| `frontend/src/__tests__/communities.test.tsx`, `__tests__/team.test.tsx` (+ invite as needed) | new — route tests (never in `src/app/`) |
| `docs/diagrams/database-erd.md` | edit (Document step) — three tables, enums, helpers, policies |
| `docs/diagrams/app-flow.md` | edit (Document step) — Communities → Teams paths, Home chips, team page, profile section |

Builder footguns (B09+ precedent): this step adds routes — regenerate typed routes with
`npx expo start --offline` (~150 s) **before** `tsc --noEmit` → lint → Jest. Apply the migration
live via MCP, then rename the file to the version `list_migrations` records. Modules take the
client as a parameter; tests use hand-rolled fakes (never the live project), declaring the raw
reply shapes once at the seam (the `RawFeedPost` discipline). If the full suite hits the 30 s
Jest timeout, rerun with `--maxWorkers=50%`.

## Offline / sync / privacy / rules check

- **Offline-first:** untouched where it applies. Teams are online-only social surfaces (the B23
  precedent); every Teams screen degrades to the standard connection message.
- **One home:** no training math involved; team-name limit in `limits.ts` beside its kin; the
  membership/ownership rule once each in `private.*`; search escaping imported from
  `follows.ts`; the feed read reused, not re-implemented.
- **RLS, never client-side:** both join modes, the switch, roster visibility and invite rights
  are policies; the UI only mirrors them.
- **Privacy:** no progress-pic/body/recovery data is touched; the Team feed re-filters through
  the untouched posts RLS, so nothing a viewer couldn't already see becomes visible; invite
  inserts respect blocks like follows.
- **Nothing speculative:** no member counts view, no team avatars/descriptions, no realtime, no
  Hot sort on the Team feed (Latest only), no RPC functions.
- **No AI, no numeric claims, 18+ unaffected.**

## Migration / Gate 2 probe (the B31/B34 rolled-back recipe)

Apply live via MCP, rename the file to the recorded version. Probe in one rolled-back
transaction as two synthetic users A and B:

1. A creates a team → the `owner` member row exists (trigger).
2. B joins while `open` → member row, `role = 'member'`.
3. B forging `role = 'owner'` on insert → refused (42501). B switching the join mode → refused.
4. A switches to `invite` (update works); B2 (third user) join → refused; B2 reads the roster →
   only rows RLS grants (none); B still reads the full roster.
5. A invites B2 (blocked pair → refused); B2 sees the invite, joins → member row **and the
   invite row is gone** (consume trigger).
6. B leaves (delete own row); A leaving → refused (`role <> 'owner'`).
7. Feed shape: B's public post is returned by the member-id posts query; a stranger's is not;
   B's followers-only post visible only to a member who follows B.

## How each definition of done becomes observably true

- **TEAM-1 / step DoD:** the probe above is the enforcement proof; Jest pins the app side with
  fakes — `createTeam` validates and inserts, `joinTeam` on refusal explains, the switch renders
  only for the owner and calls `setJoinMode`, the Communities create→page flow.
- **TEAM-2 / SOC-10 (part):** route tests — the team page renders members' posts (fake client:
  member's post shown, non-member's absent) through the real `PostCard`; Home renders the
  "Your teams" chip and tapping it routes to `/team/[id]`.
- **YOU-6 (part):** ProfileView test — a lifter with teams shows the Teams section as links;
  tapping routes to the team page; a lifter whose memberships RLS withholds shows no section.

## Out of scope (and where it lands)

- Coach assignment, role changes, pushed programs/announcements — **B37**.
- Removing members, removing posts from the Team feed, team deletion — **B38** (team deletion:
  the delete policy + cascade is one migration line there).
- Ownership transfer; what happens to a team when its creator deletes their account is cascade
  (team disappears) until a transfer feature exists — recorded product call.
- Program visibility `team` — **B39**. Gym feeds, SOC-10's Gym half — **B50**. Team push
  notifications — **B47**.
- Member counts on directory rows / non-member invite-team pages (needs a definer view à la
  `follow_counts`) — on evidence. Team description, avatar — product calls later.
- Realtime team feed, Hot sort or flair filter on the Team feed — later, on evidence.

## Risks a reviewer should weigh

1. **Roster visibility tied to join mode (G4)** is a product rule being set in a schema step:
   open team ⇒ public roster. If Tristen wants rosters members-only everywhere, it is a
   one-line policy change (drop the third select arm) — but the profile's Teams section on
   *other* lifters then shows only shared teams, and the directory can't show "who's in it"
   anywhere. Flagged for Gate 1 as the plan's main product call.
2. **The owner-row and invite-consume triggers** are `security definer` writes that bypass RLS
   by design. They are small and single-purpose, but a bug there writes rows no policy ever
   allowed; the probe's steps 1 and 5 exist to pin exactly those two.
3. **The Team feed reuses `loadFeedPage` with a roster-derived author list** — two requests
   (roster, then posts) with the member list in the URL, the B20 G10 in-list accepted again at
   team scale (hundreds of members before the URL matters; measured evidence buys a view). A
   huge team is also a page-size risk: the posts query is capped at 20 regardless, so the cost
   stays the roster read — capped implicitly by team size; revisit only on evidence.

## Grilling decisions (settled)

- **G1 — "Invite rows: who asked for an invites table at all? Scope says 'switchable to
  invite-only', not 'invitations'."** Attacked hardest. The step DoD says *both join modes
  work*; a mode nobody can pass is not working, it is a lock (handoff standing input says the
  same). Alternatives weighed: an invite-code string (needs an RPC + code entry UI — more
  machinery, worse RLS story); deferring invites to B37/B38 (leaves the DoD unmeetable).
  Per-user rows are the smallest thing that makes mode two demonstrably a mode.
- **G2 — "Why can the owner invite in *open* mode?"** Because gating invite-writes on the
  current mode buys nothing (the join policy ignores invites when open) and costs a mode check
  that can race a switch. An invite in open mode is a no-op permission; kept for simplicity.
- **G3 — "Enum `coach` with no behaviour — speculative?"** The scope sentence itself names
  "(owner, coach, member roles)", so the type is in scope even though only B37 assigns it. No
  policy mentions `coach` in B36; a value with no rights grants no rights.
- **G4 — roster visibility.** Three options fought: (a) members-only (follows precedent; kills
  YOU-6 on other profiles and any directory signal), (b) public always (profiles precedent;
  leaks closed-group rosters), (c) mode-dependent. Settled on (c): it is the only option where
  "invite-only" means something coherent end to end, it costs one policy arm, and each team's
  creator — not the schema — picks the privacy posture. Risk 1 records the fallback.
- **G5 — "Does the Team feed need `can_view_post` to grow a Team arm?"** No — settled per the
  handoff: the Team feed is a *filter*, not a *grant*. Asserted in tests by a followers-only
  post appearing only to a member who follows the author.
- **G6 — "Leave: scope widening?"** One policy line + one button. Without it the device check
  is irreversible and every probe account is stuck in every team it touches. Kept, flagged
  honestly as the plan's one deliberate inclusion beyond the scope sentence (the B20 "Find
  lifters" precedent: an action the feature is unusable without).
- **G7 — "Trigger-created owner row vs. a `with check` that lets creators insert their own
  owner row."** The trigger wins: a team without its owner row can never exist, even for an
  instant, and the client code path is one insert. The policy stays self-join-member-only,
  which is exactly what the probe forges against.
- **G8 — "`created_by` cascade orphans members without warning."** True and accepted: B32's
  "deletion removes everything" rule outranks member convenience at launch; `set null` would
  leave an ownerless team no one can administer (worse). Recorded in Out of scope.
- **G10 — "Can the owner corrupt `created_by`?"** Caught in grilling: the update policy
  re-checks ownership through the unchanged `id`, so an owner's update could rewrite
  `created_by` to any profile — mislabeling the creator and re-aiming the account-deletion
  cascade at someone else's account. Closed with one line of standard SQL in the migration:
  `revoke update (created_by) on public.teams from authenticated` (column-level revoke, no
  trigger). `team_members` and `team_invites` have no update policies at all, so nothing else
  is rewritable.
- **G11 — "A third copy of the post-action wiring."** The team feed would make Home /
  ProfileView / team page three spellings of the vote–report–reshare handler block; the repo's
  own convention says merge at the third copy. Settled: extract the shared hook (see Screens),
  scope-capped so the extraction can't balloon the diff.
- **G12 — "Team names unique?"** No — like Strava clubs; two "Mythical PRs" can coexist, the
  directory shows both, and disambiguation (member counts, creator) waits for directory
  evidence. Inviting an existing member is possible and harmless (the row sits unused until
  they leave; the invite screen may mark current members).
- **G9 — facts checked in the repo:** `sanitizeSearchTerm` is exported from `follows.ts`
  (line 52) — importable, no copy. `private.blocked_either(a, b)` exists (identity migration).
  `handle_new_block` is the definer-trigger precedent. `loadFeedPage(client, me, authorIds,
  sort, flairId, after)` takes an arbitrary author list — the Team feed slots in without
  touching `feed.ts`. `ProfileView` already sections with `SectionLabel` + `Card`; Communities
  is a placeholder expecting exactly this step. No table named `teams` exists in any migration.
  `profiles` select is `using (true)` — the roster's profile embed works for any member RLS
  returns.
- **Scope verdict:** right as written. One deliberate inclusion (leave, G6), one product call
  set here (roster visibility, G4/risk 1), nothing narrowed — invites are read as *inside*
  "both join modes work", per the handoff.
