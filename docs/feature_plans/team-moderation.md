# team-moderation — B38: Team moderation (owners remove members and posts)

**Branch:** `team-moderation` (from `main`)
**Build step:** B38 — covers **TEAM-4** (owners can remove members and moderate the Team feed).
**Depends on:** B36 (teams, `team_members`, the Team feed read, `private.is_team_owner`); builds
on B37's `team_posts` / `team_assignments` where moderation touches them (B37 is merged, so this
is a fact, not a new dependency).

## Step definition of done (from the Build order)

Owners remove members and remove posts from the Team feed. **Both actions work and are refused
for non-owners by RLS.**

## Scope readings settled up front

- **"Remove posts from the Team feed" cannot be a `posts` delete.** The Team feed is not a
  table — it is members' ordinary `posts` filtered to the roster through `loadFeedPage` (B36).
  The author owns the post; deleting it would destroy their content everywhere (Home, their
  profile), which is global moderation and already has a home (B27's `moderate` function and
  `reports`). The honest shape is a **hide**: a `team_feed_hides` row the owner writes, and the
  team page excludes hidden posts from the feed it renders. The post itself, and who may see it,
  are untouched — hiding is **curation of the team's surface, not privacy**. Home, profiles and
  the API still show the post to everyone who could see it before. The RLS half of the DoD is
  the *write*: only the owner can create or remove a hide, enforced by policy. The exclusion
  itself is app query logic, exactly as the Team feed itself is app query logic — there is no
  server object "the Team feed" for RLS to guard.
- **The Coach's corner is part of the Team feed for moderation purposes.** B37 left `team_posts`
  deletion author-only and recorded "owner moderation is B38". An owner arm on the `team_posts`
  delete policy makes a rogue coach's push removable. This one *is* a real delete: pushes live
  in a team-scoped table, exist only for the team, and the author can already delete them —
  the owner removing one destroys nothing that exists anywhere else.
- **Removal is not a ban.** A removed member of an **open** team can rejoin at once; nothing in
  TEAM-4 asks for bans, and a ban table would be new speculative machinery. The owner's
  keep-out tool is switching the team to invite-only (B36). Recorded as a product call; a ban
  list waits for evidence that removal + invite-only isn't enough.
- **What a removal cleans up** (`team_members` has no cascades from a membership row, so the
  plan must name it — handoff standing input):
  - **Standing invite:** deleted by the removal trigger (below) — but **only when someone
    else removed the member**, never on a voluntary leave. A stale invite is possible because
    B36 G12 lets an owner invite an existing member; left standing after a removal it would
    let a member removed from an *invite-only* team rejoin instantly, making removal a lie —
    so this is part of "removal works", not hygiene, and it must be atomic with the removal
    (an app-side second request that fails would leave the hole open). On a **leave** the
    invite survives, preserving B36 G12's recorded semantic ("sits unused until they leave").
    The trigger tells the two apart by `auth.uid()`: the remover's id differs from the removed
    row's `user_id` (settled under grilling, G3).
  - **Assignments to the removed member:** deleted by the same trigger, on every membership
    delete (leave included) — a deliberate small change to B37 behaviour: a departed member's
    standing assignments were already unusable (the payload RPC answers null to a non-member)
    and only lingered as dead rows in every coach's "Assigned:" list. Recorded under Risks.
  - **Pushes authored by a removed coach:** survive. They were pushed *to the team* and the
    team may still want them; the owner can now delete any of them under the new arm.
  - **Nothing else.** The removed member's `posts`, workouts, PRs are their own and merely stop
    appearing in the roster-filtered feed because the roster no longer lists them.
- **Team deletion is included — a deliberate inclusion, recorded.** TEAM-4 does not name it,
  but the B36 plan explicitly parked it here ("team deletion: the delete policy + cascade is
  one migration line there"), and the handoff's Build-order breadcrumbs repeat it. It is one
  owner-only delete policy — every team-scoped table (`team_members`, `team_invites`,
  `team_posts`, `team_assignments`, and the new `team_feed_hides`) already cascades from
  `teams` — plus a confirmed button. Without it, the only way a team dies is its creator
  deleting their whole account (B36 G8), which is absurd as the product's answer.
- **Online-only, like all of Teams** (B36/B37 precedent): every action here needs a connection
  and degrades to the standard message. The offline-first rule governs logging and the Tool
  Kit, which don't change.
- **No new limits:** no hide reason is stored (a reason column is speculative until a product
  reading asks for one), so `limits.ts` is untouched.

## Data model (one migration: `<version>_team_moderation.sql`)

### 1. Owner removes members — a second delete arm on `team_members`

```sql
create policy "owners remove members"
  on public.team_members for delete
  to authenticated
  using (private.is_team_owner(team_id) and role <> 'owner');
```

ORs with B36's "members leave teams". `role <> 'owner'` protects the owner row in both arms:
an owner can never remove themselves (a team always keeps its owner, B36), and nobody else can
touch the owner row either. A coach is removable (their role is `coach`). All rules go through
the existing `private.is_team_owner` — nothing is respelled.

### 2. A membership delete cleans up after itself — trigger

```sql
create or replace function private.handle_team_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Gone is gone: a departed member's standing assignments can never be
  -- started again (the payload RPC answers null to a non-member).
  delete from public.team_assignments a
  where a.team_id = old.team_id and a.user_id = old.user_id;
  -- A REMOVAL (someone else deleted the row) also takes the member's standing
  -- invite, or a removed member of an invite-only team could rejoin at once.
  -- A voluntary LEAVE keeps it (B36 G12: an invite "sits unused until they
  -- leave"). `is distinct from` so a null auth.uid() (cascades run by the
  -- server, e.g. account deletion) counts as a removal — those invites are
  -- cascading away anyway, so the extra delete is a no-op.
  if (select auth.uid()) is distinct from old.user_id then
    delete from public.team_invites i
    where i.team_id = old.team_id and i.user_id = old.user_id;
  end if;
  return old;
end;
$$;

create trigger on_team_member_removed
  after delete on public.team_members
  for each row execute function private.handle_team_member_removed();
```

Mirrors B36's `handle_new_team_member` (the invite-consume trigger) in shape and reasoning.
When a whole team is deleted, the cascade fires this per member row; the rows it targets are
being cascaded away in the same statement, and deleting an already-gone row is a no-op —
harmless, noted so nobody "fixes" it.

### 3. `team_feed_hides` — the owner's curation of the Team feed

```sql
create table public.team_feed_hides (
  team_id    uuid not null references public.teams (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  hidden_by  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, post_id)
);
create index team_feed_hides_hidden_by_idx on public.team_feed_hides (hidden_by);

alter table public.team_feed_hides enable row level security;

create policy "owners hide posts from their team feed"
  on public.team_feed_hides for insert
  to authenticated
  with check (private.is_team_owner(team_id) and hidden_by = (select auth.uid()));

-- Everyone who can read the Team feed must read the hides to apply them:
-- the roster-visibility rule, verbatim (members, or anyone when the team is open).
create policy "feed readers see hides"
  on public.team_feed_hides for select
  to authenticated
  using (private.is_team_member(team_id) or private.team_mode(team_id) = 'open');

create policy "owners unhide posts"
  on public.team_feed_hides for delete
  to authenticated
  using (private.is_team_owner(team_id));
```

No update policy (a hide has nothing to edit). `post_id` cascades from `posts`, so a post the
author or a moderator deletes takes its hides with it. Hiding a post the owner can't even read
is possible (the FK check doesn't run the viewer's RLS) and harmless — the id is just excluded.
A repeat hide is a `23505`, mapped to success like repeat invites. `hidden_by` records who hid
(always the owner today — ownership never transfers — but the row should say so itself).

### 4. Owner removes pushes — a second delete arm on `team_posts`

```sql
create policy "owners remove pushes"
  on public.team_posts for delete
  to authenticated
  using (private.is_team_owner(team_id));
```

ORs with B37's "authors delete their pushes".

### 5. Team deletion — the deliberate inclusion

```sql
create policy "owners delete their teams"
  on public.teams for delete
  to authenticated
  using (private.is_team_owner(id));
```

B36 left `teams` with no delete policy on purpose ("B38's family"). Every team-scoped table
cascades from `teams`, so the one policy is the whole server side. The default table grants
include DELETE for `authenticated` (B36 only revoked and re-granted UPDATE), so no grant work.

## App modules and screens

### `frontend/src/social/teams.ts` (+ its test) — four new functions, same discipline

Injected client, RLS decides, refusals become calm sentences, "ask for the row back" where a
policy can silently match nothing (the `leaveTeam` / `setJoinMode` pattern):

- `removeMember(client, teamId, userId)` — delete the membership row, asking for it back;
  zero rows → `TEAM_NOT_ALLOWED` (a non-owner, or the owner row). One request: the standing
  invite and assignments are the trigger's job, atomic with the removal.
- `hideTeamPost(client, teamId, postId, me)` — insert `{team_id, post_id, hidden_by: me}`;
  `23505` → ok (already hidden); `42501` → `TEAM_NOT_ALLOWED`.
- `unhideTeamPost(client, teamId, postId)` — delete; errors → `TEAM_FAILED` (an unhide that
  deletes nothing is fine — the hide is gone either way, the page re-reads).
- `teamFeedHides(client, teamId)` — the team's hidden post ids as a `Set<string>` (the
  `teamInvitees` shape). RLS returns rows only to feed readers.
- `deleteTeam(client, teamId)` — delete the team row, asking for it back; zero rows →
  `TEAM_NOT_ALLOWED`.

### `frontend/src/app/team/[id]/index.tsx` — the moderation surfaces, owner-only by render, RLS by enforcement

- **`load()`** also reads `teamFeedHides` (when the feed is visible to the viewer) into a
  `hidden: Set<string>` state, re-read on every reload.
- **Feed rendering:** a non-owner's list filters hidden posts out at render time
  (`posts.filter(p => !hidden.has(p.id))` over every loaded page). The **owner** still sees a
  hidden post, collapsed to a small marker card — "Hidden from the Team feed" + **Unhide** —
  so a mis-tap is reversible without a separate "hidden posts" screen. Under each visible
  post card the owner gets one **Hide from Team feed** ghost button (a row below `PostCard`
  in the team page's `renderItem` — `PostCard` itself is untouched; it is shared with Home
  and profiles, which know nothing of teams).
  - Why render-time filtering and not a `not.in` exclusion in the query: the owner must still
    receive hidden posts to unhide them; the hide list would otherwise grow the URL on every
    page forever; and the feed's existing drop pattern (withheld workouts, broken re-shares)
    already tolerates a page rendering fewer than twenty cards. A hidden post still travels
    to a non-owner's phone in the reply before being filtered — not a leak, because posts RLS
    already grants that viewer the post everywhere else (hiding is curation, not privacy).
- **Member rows:** the owner gets **Remove from team** on every non-owner row (next to Make
  coach / Assign a program), behind a confirm naming the member — a small
  `confirmRemoveMember.ts` module, the `confirmDeleteWorkout.ts` precedent. Then reload.
- **Coach's corner:** the Remove button's condition widens from `post.authorId === me` to
  `post.authorId === me || isOwner`. Checked in the repo: `useTeamCoaching.deletePost` calls
  `deleteTeamPost(client, post.id)` — delete by id, no client-side author check — so the new
  policy arm is the only change needed for it to work for the owner.
- **Danger zone:** the owner section gains **Delete team** behind a confirm that names the team
  and says members lose it ("This deletes the team for everyone. Posts and workouts stay with
  their owners.") — its own `confirmDeleteTeam.ts`, same precedent. A plain confirm, not the
  type-DELETE ritual: that ritual is for account deletion, which destroys sign-in and all data;
  a team's posts and workouts all survive with their owners (settled under grilling, G7). On
  success, `router.replace('/communities')`.

### Tests

- `teams.test.ts`: each new function — success, the zero-rows → `TEAM_NOT_ALLOWED` path,
  `23505` → ok on hide, `42501` → `TEAM_NOT_ALLOWED` on hide.
- `__tests__/team.test.tsx` (route test, expo-router rule): owner sees Remove / Hide / Delete
  team and a hidden post renders as the marker card with Unhide; a plain member sees none of
  those controls and a hidden post not at all; a non-member viewer of an open team also doesn't
  see hidden posts. Fake client grows a `team_feed_hides` table and the `teams` delete.
- The fake has no RLS (B36 G5 precedent): owner-only enforcement is proven live by the probe,
  not in Jest; Jest pins the app's behaviour on both sides of the server's answer.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_team_moderation.sql` | new — removal policy, cleanup trigger, `team_feed_hides` + policies, `team_posts` owner arm, `teams` delete policy |
| `frontend/src/social/teams.ts` (+ `teams.test.ts`) | edit — `removeMember`, `hideTeamPost`, `unhideTeamPost`, `teamFeedHides`, `deleteTeam` |
| `frontend/src/app/team/[id]/index.tsx` | edit — hides state + filter/marker, Remove on member rows, owner Remove on pushes, Delete team |
| `frontend/src/components/teams/confirmRemoveMember.ts`, `confirmDeleteTeam.ts` (+ tests) | new — the two confirms (`confirmDeleteWorkout.ts` precedent) |
| `frontend/src/__tests__/team.test.tsx` | edit — the moderation cases above |
| test fakes (wherever the team fake client lives) | edit — `team_feed_hides`, `teams` delete |
| `docs/diagrams/database-erd.md` | edit (Document step) — `team_feed_hides`, new policy arms, trigger |
| `docs/diagrams/app-flow.md` | edit (Document step) — the owner's moderation controls and data paths |

No new routes (everything lives on the existing team page), so the typed-routes regeneration is
belt-and-braces only; the check order stays `npx expo start --offline` → `tsc` → lint → Jest.
Apply the migration live via MCP, rename the file to the version `list_migrations` records. If
the full suite hits the 30 s Jest timeout, rerun with `--maxWorkers=50%`.

## Offline / sync / privacy / rules check

- **Offline-first:** untouched where it applies; Teams stay online-only with the standard
  message.
- **One home:** all ownership checks through the existing `private.is_team_owner`; the hide
  rule lives once in `team_feed_hides` policies; no training math involved; no limits change.
- **RLS, never client-side:** who may remove, hide, unhide, delete pushes and delete the team
  is policy; the UI only renders what the policies will allow, and every refusal path is
  exercised live. The *exclusion* of a hidden post is app logic because the Team feed is app
  logic — stated honestly above and in Risks.
- **Privacy:** nothing sensitive is touched or widened; hiding narrows a surface. No post,
  workout, PR or body data changes visibility in either direction.
- **Nothing speculative:** no ban table, no hide reasons, no moderation log, no hidden-posts
  screen, no notification to the hidden author (B47's family if ever).
- **No AI, no numeric claims, 18+ unaffected.**

## Migration / Gate 2 probe (the B36/B37 rolled-back recipe)

As owner A, coach C, members B and B2, outsider O (rolled back):

1. A removes B2 → 1 row gone; B2's standing assignment rows gone and B2's unused invite gone
   (both by trigger — the probe must run with A's JWT claims set, which the standing
   throwaway-JWT recipe already does, or `auth.uid()` is null and the leave/removal
   distinction can't be probed). Separately: B leaves on their own → B's assignments gone,
   but B's unused invite **kept** (the G12 semantic).
2. C removing B → 0 rows. B removing C → 0 rows. O removing anyone → 0 rows. Nobody can
   delete A's owner row (A included) → 0 rows.
3. Removed-member rejoin: B2 rejoins while the team is open → allowed (recorded product call);
   after A switches to invite-only, B2's rejoin → 42501.
4. A hides B's post → row lands; the team page's query shape (posts for roster ids) minus the
   hide set excludes it, while the same post still returns on Home/profile reads. C hiding →
   42501. B hiding their own post → 42501 (not the owner). O reads hides of the open team →
   rows; after the switch to invite-only, O reads → 0 rows.
5. A unhides → row gone; C unhiding → 0 rows.
6. A deletes C's push under the new arm → 1 row; C deleting A's push → 0 rows (not theirs,
   not owner).
7. A deletes the team → `teams` row gone and zero rows remain in `team_members`,
   `team_invites`, `team_posts`, `team_assignments`, `team_feed_hides` for that id; members'
   `posts` and workouts untouched. B deleting a team → 0 rows.

## How TEAM-4's definition of done becomes observably true

- **"Removal works, restricted to owners":** probe steps 1–2 are the enforcement proof; Jest
  pins `removeMember`'s both-answer behaviour and the owner-only rendering.
- **"Feed moderation works, restricted to owners":** probe steps 4–6 prove the writes are
  owner-only and that Home still returns the hidden post (step 4's live read); the route test
  proves a hidden post disappears from the team page for everyone but the owner. The hide set
  is loaded and applied only on the team page — no other screen imports it.
- **Step DoD:** both of the above plus the live refusal of every non-owner path.

## Out of scope (and where it lands)

- **Bans / blocking rejoin** — removal is not a ban (product call above); on evidence.
- **Hide reasons, a moderation log, notifying the hidden author** — on evidence / B47.
- **Comment moderation inside a team** — comments belong to posts, not teams; B27's global
  tools cover abuse.
- **Ownership transfer** — unchanged recorded product call (B36); the owner deleting their
  account still cascades the team away.
- **Gym moderation** — B50's family.
- **Report-to-owner flows** — reports stay global (B27).

## Risks a reviewer should weigh

1. **A hide is curation, not privacy — and the DoD's RLS clause covers the writes, not the
   exclusion.** The hidden post remains visible on Home, profiles and the API to anyone posts
   RLS already admits; a team member who follows the author still sees it there. If Tristen
   reads "moderate the Team feed" as "make it invisible to members everywhere", that is a
   different (and privacy-violating) feature — flagged as the plan's main reading for Gate 1.
   The server cannot RLS-guard "the Team feed" because the feed is a client-side filter; what
   RLS guards is who can write a hide, a removal, a push-delete and a team-delete.
2. **The cleanup trigger reads `auth.uid()` — a first for this repo's triggers.** Policies
   read it everywhere, but every existing trigger works from `new.*` / `old.*` columns only.
   It is the standard Supabase way to know who is acting, and `is distinct from` pins the
   null case (server-run cascades count as removals, whose invites are cascading anyway) —
   but a reviewer should check that reasoning, and the probe can't exercise the distinction
   without real JWT claims. The trigger also fires on voluntary leave (assignments half),
   changing a harmless recorded B37 behaviour: a member who leaves now loses their standing
   assignments instead of keeping dead rows every coach had to look at.
3. **Team deletion is scope TEAM-4 never named.** It is included on the strength of B36's
   explicit deferral *to this step* and is one policy line plus a confirmed button — but it is
   the step's only irreversible destructive action (cascades take memberships, invites, pushes,
   assignments and hides with it). If Gate 1 reads the step scope strictly, dropping it is one
   policy and one button removed, with no effect on TEAM-4's DoD.

## Grilling decisions (settled)

- **G1 — "Hide, not delete: who says the owner shouldn't delete a member's post?"** The post
  is the member's content everywhere (Home, their profile, their export); an owner deleting it
  would be a stranger destroying a lifter's data on a surface the post doesn't even belong to.
  Global takedowns already have B27. A hide moderates exactly the surface the owner owns — the
  team's — and nothing else. Also attacked from the other side ("is a hide too weak to count
  as moderation?"): TEAM-4 says *moderate the Team feed*, and the feed is the only thing a
  hide touches, completely. Settled: hide.
- **G2 — "`team_feed_hides` — a whole new table for a curation flag?"** Alternatives weighed:
  a `hidden_post_ids uuid[]` column on `teams` (unindexable membership checks, no audit of
  who/when, array-update races) and owner-deletes-the-`team_posts`-push-only (ignores the
  actual feed). A three-column table with the repo's standard policy shapes is the smallest
  honest mechanism. Settled: the table.
- **G3 — "App-side invite cleanup is a hole, not hygiene."** The plan's first draft removed
  the stale invite with a best-effort second request; grilling caught that a failure of that
  request leaves a removed member of an invite-only team able to rejoin instantly — removal
  that doesn't stick fails the step's own DoD. Moved into the removal trigger, atomic, with
  the leave/removal distinction made by `auth.uid() is distinct from old.user_id` so B36
  G12's "an invite sits unused until they leave" survives. Recorded as Risk 2 (first
  `auth.uid()` in a trigger).
- **G4 — "Why is the hide exclusion client-side? CLAUDE.md says RLS, never client-side."**
  That rule governs *who may see data*; a hide changes nobody's visibility of anything — the
  post stays exactly as visible as posts RLS says, everywhere. The Team feed itself is a
  client-side filter over `posts` (B36, settled then); its curation can live nowhere else.
  What must be — and is — RLS: every write (hide, unhide, removal, push-delete, team-delete).
  A `not.in` server-side exclusion was rejected because the owner must still receive hidden
  posts to unhide them, and the hide list would grow the URL on every page forever. Settled:
  render-time filter, owner sees marker cards. Risk 1 flags the product reading for Gate 1.
- **G5 — "The hides read is unbounded."** One extra request per team-page load returning bare
  ids; it grows with hides, not posts. The same class as the roster in-list accepted at B36
  (risk 3 there): hundreds of hides before it matters, measured evidence buys a view or
  paging. Settled: accepted at launch scale.
- **G6 — "Rejoin-at-once makes removal theater on open teams."** True and accepted as the
  product call: TEAM-4 asks for removal, not bans; the owner's keep-out tool is invite-only
  mode (B36), and a ban table is new machinery nothing has asked for. The probe asserts the
  rejoin works (open) and is refused (invite-only) so the behaviour is pinned, not accidental.
- **G7 — "Should Delete team demand the type-to-confirm ritual?"** No — that ritual (B32) is
  for destroying sign-in and every row a person owns. A team's death takes shared scaffolding
  only; every post, workout and program survives with its owner. A plain named confirm
  matches the destruction. Settled.
- **G8 — "Does the owner arm on `team_posts` let the owner delete, or also read, pushes?"**
  Delete only — the select policy is untouched (`is_team_member`), and the owner is always a
  member. No read widening anywhere in the step.
- **G9 — Facts checked in the repo:** `useTeamCoaching.deletePost` → `deleteTeamPost(client,
  post.id)`, no client-side author check (the policy arm suffices). Confirm dialogs live as
  small modules (`confirmDeleteWorkout.ts`, `confirmProgramRemoval.ts`) — followed. The teams
  test fake is table-backed (`fake.tables.team_members`) — `team_feed_hides` slots in. B36
  revoked only UPDATE on `teams`, so the default DELETE grant stands and the new delete
  policy needs no grant work. All four team-scoped tables cascade from `teams`. The existing
  "members leave teams" and new "owners remove members" delete policies OR cleanly, and
  `role <> 'owner'` in both keeps the owner row untouchable by everyone including the owner.
- **G10 — "Hidden-post marker cards for the owner: scope creep?"** The alternative is an
  unhide with no surface (a mis-tap is permanent short of SQL) or a separate hidden-posts
  screen (more scope). The marker is a render branch in the one screen that already has the
  data. Settled: marker cards, owner only.
- **Scope verdict:** right as written, with two recorded deliberate inclusions — team
  deletion (B36's explicit deferral to this step; Risk 3 offers the strict-reading fallback)
  and unhide (removal's inverse; without it the feature is a one-way ratchet). Nothing
  narrowed: both named actions (remove members, remove posts from the feed) plus the
  Coach's-corner arm land fully.
