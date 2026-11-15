-- ============================================================================
-- Teams (B36 — TEAM-1, TEAM-2, SOC-10 part, YOU-6 part): groups of lifters
-- with a shared feed.
-- ============================================================================
-- Three tables:
--
--   teams         one team: its name, who created it, and its join mode
--   team_members  one row per lifter per team, with their role
--   team_invites  standing permission for one lifter to join one team
--
-- Teams are server-authoritative and online-only (the B23 votes precedent):
-- they never sync to the phone, so ids default on the server.
--
-- JOIN MODES (TEAM-1): a team is `open` by default — any signed-in lifter may
-- add themselves as a member. Switched to `invite`, only a lifter holding an
-- invite row may join. Only the team's owner (its creator — the owner row is
-- written by trigger when the team is made, and nothing in B36 changes roles)
-- can switch the mode or invite.
--
-- ROSTER VISIBILITY follows the join mode (plan G4): an open team's member
-- list is readable by any signed-in lifter; an invite-only team's only by its
-- members. Your own membership rows are always readable.
--
-- THE TEAM FEED WIDENS NOTHING: it is the ordinary posts read filtered to the
-- members' ids, so posts RLS (untouched here) still decides every post.
--
-- The ownership / membership rules live once, in the private.* helpers below.
-- ============================================================================

create type public.team_join_mode as enum ('open', 'invite');
-- `coach` is assigned from B37; in B36 no policy grants it anything.
create type public.team_role as enum ('owner', 'coach', 'member');

-- ----------------------------------------------------------------------------
-- teams
-- ----------------------------------------------------------------------------
create table public.teams (
  id         uuid primary key default gen_random_uuid(),  -- created online, so the server picks the id
  created_by uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  join_mode  public.team_join_mode not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index teams_created_by_idx on public.teams (created_by);

alter table public.teams enable row level security;

create trigger set_updated_at
  before update on public.teams
  for each row execute function extensions.moddatetime (updated_at);

-- ----------------------------------------------------------------------------
-- team_members
-- ----------------------------------------------------------------------------
create table public.team_members (
  team_id   uuid not null references public.teams (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      public.team_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- "Which teams is this lifter in?" (Home chips, Communities, the profile).
create index team_members_user_idx on public.team_members (user_id);

alter table public.team_members enable row level security;

-- ----------------------------------------------------------------------------
-- team_invites
-- ----------------------------------------------------------------------------
create table public.team_invites (
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,  -- the invitee
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_invites_user_idx on public.team_invites (user_id);

alter table public.team_invites enable row level security;

-- ----------------------------------------------------------------------------
-- Helpers — THE single home of the team rules
-- ----------------------------------------------------------------------------
-- In `private` so the API can't call them; SECURITY DEFINER so a policy on
-- team_members can ask about team_members without re-entering its own RLS.

-- Does the caller hold any membership row in team `tid`?
create or replace function private.is_team_member(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = tid and m.user_id = (select auth.uid())
  )
$$;

-- Does the caller hold the owner row of team `tid`? (Creator = owner in B36.)
create or replace function private.is_team_owner(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = tid and m.user_id = (select auth.uid()) and m.role = 'owner'
  )
$$;

-- Team `tid`'s join mode (null if there is no such team).
create or replace function private.team_mode(tid uuid)
returns public.team_join_mode
language sql
stable
security definer
set search_path = ''
as $$
  select t.join_mode from public.teams t where t.id = tid
$$;

-- Does the caller hold an invite to team `tid`?
create or replace function private.has_team_invite(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_invites i
    where i.team_id = tid and i.user_id = (select auth.uid())
  )
$$;

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------
-- A new team gets its owner row in the same transaction, so a team is never
-- ownerless and no client ever writes an owner row (the policy below forbids
-- it). SECURITY DEFINER: the member insert policy only allows role 'member'.
create or replace function private.handle_new_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.team_members (team_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger on_team_created
  after insert on public.teams
  for each row execute function private.handle_new_team();

-- Joining consumes your invite, so "invited" always means "may join and
-- hasn't yet". SECURITY DEFINER for the same reason as handle_new_block.
create or replace function private.handle_new_team_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.team_invites i
  where i.team_id = new.team_id and i.user_id = new.user_id;
  return new;
end;
$$;

create trigger on_team_member_created
  after insert on public.team_members
  for each row execute function private.handle_new_team_member();

-- ----------------------------------------------------------------------------
-- Policies — teams
-- ----------------------------------------------------------------------------
-- Discoverable: the directory and "you're invited to …" need the row.
create policy "signed-in users read teams"
  on public.teams for select
  to authenticated
  using (true);

create policy "users create teams as themselves"
  on public.teams for insert
  to authenticated
  with check (created_by = (select auth.uid()));

-- The join-mode switch (and rename): owner only — which is the creator in B36.
create policy "owners update their teams"
  on public.teams for update
  to authenticated
  using (private.is_team_owner(id))
  with check (private.is_team_owner(id));

-- No delete policy: team deletion is a later step (B38's family).

-- Without this an owner's update could rewrite created_by (the update policy
-- re-checks ownership through the unchanged id), mislabeling the creator and
-- re-aiming the account-deletion cascade at someone else (plan G10).
-- Postgres ignores a column-level revoke while the table-level UPDATE grant
-- (Supabase's default) stands, so the table grant is revoked and only the two
-- editable columns are granted back. (updated_at is set by its trigger.)
revoke update on public.teams from authenticated, anon;
grant update (name, join_mode) on public.teams to authenticated;

-- ----------------------------------------------------------------------------
-- Policies — team_members
-- ----------------------------------------------------------------------------
create policy "members and open-team readers see rosters"
  on public.team_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_team_member(team_id)
    or private.team_mode(team_id) = 'open'
  );

-- Self-join only, only as a plain member, and only when the team is open or
-- the caller holds an invite.
create policy "users join open teams or teams that invited them"
  on public.team_members for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'member'
    and (private.team_mode(team_id) = 'open' or private.has_team_invite(team_id))
  );

-- No update policy: roles change in B37.

-- Leave a team; an owner can't abandon theirs.
create policy "members leave teams"
  on public.team_members for delete
  to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner');

-- ----------------------------------------------------------------------------
-- Policies — team_invites
-- ----------------------------------------------------------------------------
-- Owners invite; never across a block (the follows precedent).
create policy "owners invite lifters"
  on public.team_invites for insert
  to authenticated
  with check (
    private.is_team_owner(team_id)
    and not private.blocked_either((select auth.uid()), user_id)
  );

create policy "invitees and owners see invites"
  on public.team_invites for select
  to authenticated
  using (user_id = (select auth.uid()) or private.is_team_owner(team_id));

-- The invitee declines, or the owner cancels.
create policy "invitees decline and owners cancel invites"
  on public.team_invites for delete
  to authenticated
  using (user_id = (select auth.uid()) or private.is_team_owner(team_id));
