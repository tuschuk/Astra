-- ============================================================================
-- Team moderation (B38 — TEAM-4): owners remove members, hide posts from the
-- Team feed, remove coaches' pushes, and delete the team.
-- ============================================================================
-- Everything here is an OWNER right, enforced by policy through the one
-- existing helper `private.is_team_owner` (B36). Nothing widens what anyone can
-- READ: the new table's read rule is the roster-visibility rule verbatim.
--
--   1. "owners remove members"  — a second delete arm on team_members
--   2. on_team_member_removed   — a membership delete cleans up after itself
--   3. team_feed_hides          — the owner's curation of the Team feed
--   4. "owners remove pushes"   — a second delete arm on team_posts
--   5. "owners delete their teams" — the delete policy B36 left out on purpose
--
-- A HIDE IS CURATION, NOT PRIVACY. The Team feed is not a table — it is
-- members' ordinary posts filtered to the roster in the app (B36). A hide only
-- tells the team page to leave that post out; the post stays exactly as
-- visible on Home, profiles and the API as posts RLS says. What RLS guards
-- here is who may WRITE a hide.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Owners remove members
-- ----------------------------------------------------------------------------
-- ORs with B36's "members leave teams". `role <> 'owner'` in both arms keeps the
-- owner row untouchable by everyone, the owner included (a team always keeps
-- its owner). Coaches are removable. Removal is not a ban: a removed member of
-- an OPEN team may rejoin at once — the owner's keep-out tool is invite-only.
create policy "owners remove members"
  on public.team_members for delete
  to authenticated
  using (private.is_team_owner(team_id) and role <> 'owner');

-- ----------------------------------------------------------------------------
-- 2. A membership delete cleans up after itself
-- ----------------------------------------------------------------------------
-- team_members rows have nothing cascading from them, so this names what goes:
--   * on EVERY delete (leave or removal): the member's standing assignments —
--     a departed member can never start them (the payload RPC answers null to
--     a non-member), so they would only linger in coaches' "Assigned:" lists;
--   * on a REMOVAL only (someone other than the member deleted the row): the
--     member's standing invite. Left behind, it would let a member removed
--     from an invite-only team rejoin at once. A voluntary LEAVE keeps the
--     invite (B36 G12: an invite "sits unused until they leave").
-- Leave vs removal is told apart by who is acting: `auth.uid()`. `is distinct
-- from` makes a null caller (server-run cascades such as account deletion)
-- count as a removal — those invites are cascading away anyway, so the extra
-- delete is a no-op. Likewise when a whole team is deleted the cascade fires
-- this per member and the rows it targets are already going: harmless.
-- SECURITY DEFINER: the cleanup must happen whoever is acting, even when that
-- person's own policies wouldn't let them delete these rows directly.
create or replace function private.handle_team_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.team_assignments a
  where a.team_id = old.team_id and a.user_id = old.user_id;
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

-- ----------------------------------------------------------------------------
-- 3. team_feed_hides — posts the owner left out of the Team feed
-- ----------------------------------------------------------------------------
create table public.team_feed_hides (
  team_id    uuid not null references public.teams (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,  -- a deleted post takes its hides
  hidden_by  uuid not null references public.profiles (id) on delete cascade,  -- who hid it (the owner)
  created_at timestamptz not null default now(),
  primary key (team_id, post_id)  -- a repeat hide is 23505, which the app treats as done
);

create index team_feed_hides_hidden_by_idx on public.team_feed_hides (hidden_by);
create index team_feed_hides_post_idx on public.team_feed_hides (post_id);

alter table public.team_feed_hides enable row level security;

create policy "owners hide posts from their team feed"
  on public.team_feed_hides for insert
  to authenticated
  with check (private.is_team_owner(team_id) and hidden_by = (select auth.uid()));

-- Everyone who can read the Team feed must read the hides to apply them: the
-- roster-visibility rule, verbatim (members, or anyone when the team is open).
create policy "feed readers see hides"
  on public.team_feed_hides for select
  to authenticated
  using (private.is_team_member(team_id) or private.team_mode(team_id) = 'open');

create policy "owners unhide posts"
  on public.team_feed_hides for delete
  to authenticated
  using (private.is_team_owner(team_id));

-- No update policy: a hide has nothing to edit.

-- ----------------------------------------------------------------------------
-- 4. Owners remove coaches' pushes
-- ----------------------------------------------------------------------------
-- ORs with B37's "authors delete their pushes". Delete only — who may READ
-- pushes is unchanged (members; the owner is always one).
create policy "owners remove pushes"
  on public.team_posts for delete
  to authenticated
  using (private.is_team_owner(team_id));

-- ----------------------------------------------------------------------------
-- 5. Owners delete their teams
-- ----------------------------------------------------------------------------
-- Every team-scoped table (team_members, team_invites, team_posts,
-- team_assignments, team_feed_hides) cascades from teams, so this one policy is
-- the whole server side. Members' posts, workouts and programs are their own
-- and untouched. The default DELETE grant stands (B36 revoked only UPDATE).
create policy "owners delete their teams"
  on public.teams for delete
  to authenticated
  using (private.is_team_owner(id));
