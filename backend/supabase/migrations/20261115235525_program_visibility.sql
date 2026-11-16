-- ============================================================================
-- Program visibility (B39 — PRG-4): who besides the author may see a program.
-- ============================================================================
-- What this migration does, in plain language:
--
--   1. A `visibility` setting on every program: private (only the author),
--      followers (the author's followers, unless either has blocked the other),
--      team (members of the Teams the author shared it with) or published
--      (anyone signed in — the Marketplace, B40, lists these). New and existing
--      programs are private.
--
--   2. `program_team_shares` — which Teams a team-visibility program is shared
--      with. An author can share only their own program, and only with a team
--      they belong to. Shares stay put when the visibility moves off "team"
--      (they simply stop counting), so switching back restores the old list.
--
--   3. `private.program_visible` — THE single home of "may the caller see this
--      program?". The `programs` read policy and the content read below both
--      use it.
--
--   4. Non-authors read a shared program's CONTENT (weeks, workouts, exercise
--      targets) through one gated function, `public.program_payload`, as one
--      JSON document — never by reading the child tables.
--
-- THE B34 WARNING, RESTATED WITH THE NEW SHAPE: the phone downloads the three
-- child tables (program_weeks, program_workouts, program_exercises) WITHOUT a
-- user filter — it relies on their select policies returning only the caller's
-- own rows. So those policies STAY AUTHOR-ONLY here, untouched. Only the
-- `programs` parent policy widens, which is safe because the phone filters its
-- programs download to the signed-in lifter. Anyone widening the children's
-- select policies must change the phone's download shape in the same step.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enum and column
-- ----------------------------------------------------------------------------
create type public.program_visibility as enum ('private', 'followers', 'team', 'published');

-- Every existing program stays private (the B34 status quo). The phone sets it
-- like any other synced column; only the author can, because `programs`'
-- update policy is author-only.
alter table public.programs
  add column visibility public.program_visibility not null default 'private';

-- ----------------------------------------------------------------------------
-- 2. program_team_shares — which Teams a team-visibility program is shared with
-- ----------------------------------------------------------------------------
-- Online-only (never mirrored on the phone). Rows are added and removed, never
-- edited, so there is no updated_at.
create table public.program_team_shares (
  program_id uuid not null references public.programs (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (program_id, team_id)
);

create index program_team_shares_team_idx on public.program_team_shares (team_id);

alter table public.program_team_shares enable row level security;

-- The author shares their own program, and only with a team they're in.
create policy "authors share programs with their teams"
  on public.program_team_shares for insert
  to authenticated
  with check (private.owns_program(program_id) and private.is_team_member(team_id));

-- The author manages the list; a team's members can see what's shared with it.
create policy "authors and team members see shares"
  on public.program_team_shares for select
  to authenticated
  using (private.owns_program(program_id) or private.is_team_member(team_id));

-- Only the author unshares. (Team or program deletion cascades the rows away.)
create policy "authors unshare their programs"
  on public.program_team_shares for delete
  to authenticated
  using (private.owns_program(program_id));

-- ----------------------------------------------------------------------------
-- 3. The visibility rule — one helper
-- ----------------------------------------------------------------------------
-- May the caller see program `pid` (owned by `owner`, with visibility `vis`,
-- soft-deleted at `deleted`)? Takes the row's own columns so the policy doesn't
-- re-read the row.
--
--   * The author always sees their own programs — deleted ones included, so a
--     delete still reaches the author's other phones through sync.
--   * Nobody else ever sees a deleted program.
--   * followers: a follower of the author, unless either blocked the other.
--   * team: a member of any Team the program is shared with. Blocks do not cut
--     this (team content addresses the team as a unit, like team_posts).
--   * published: anyone signed in. Blocks do not cut this (a public shelf).
--   * private: nobody but the author. Mutes play no part anywhere.
create or replace function private.program_visible(
  pid uuid, owner uuid, vis public.program_visibility, deleted timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    owner = (select auth.uid())
    or (
      deleted is null
      and (
        vis = 'published'
        or (
          vis = 'followers'
          and not private.blocked_either((select auth.uid()), owner)
          and exists (
            select 1 from public.follows f
            where f.follower_id = (select auth.uid()) and f.followee_id = owner
          )
        )
        or (
          vis = 'team'
          and exists (
            select 1 from public.program_team_shares s
            where s.program_id = pid and private.is_team_member(s.team_id)
          )
        )
      )
    )
$$;

-- ----------------------------------------------------------------------------
-- 4. programs read policy — widened to the rule
-- ----------------------------------------------------------------------------
-- Insert / update / delete stay author-only (B34). The child tables' policies
-- are untouched (see the warning at the top).
drop policy "authors read their own programs" on public.programs;
create policy "visible programs are readable"
  on public.programs for select
  to authenticated
  using (private.program_visible(id, user_id, visibility, deleted_at));

-- ----------------------------------------------------------------------------
-- 5. Reading program content — one tree builder, gated callers
-- ----------------------------------------------------------------------------
-- The whole live tree of program `pid` as JSON: its name, then weeks →
-- workouts → exercise slots, each level ordered by (position, id), soft-deleted
-- rows left out. GATE-FREE BY DESIGN: it lives in `private` (unreachable from
-- the API) and only gated functions may call it. Answers null for an unknown
-- id. (Liveness of the program row itself is the caller's gate to check.)
create or replace function private.program_tree_json(pid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.name,
    'weeks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position', w.position,
          'workouts', coalesce((
            select jsonb_agg(private.program_workout_json(pw.id) order by pw.position, pw.id)
            from public.program_workouts pw
            where pw.program_week_id = w.id and pw.deleted_at is null
          ), '[]'::jsonb)
        )
        order by w.position, w.id
      )
      from public.program_weeks w
      where w.program_id = p.id and w.deleted_at is null
    ), '[]'::jsonb)
  )
  from public.programs p
  where p.id = pid
$$;

-- A program's content for anyone the visibility rule admits (the author, or a
-- reader of a live shared program). Null otherwise — private, not shared with
-- the caller, deleted, or unknown.
create or replace function public.program_payload(p_program uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.program_tree_json(p.id)
  from public.programs p
  where p.id = p_program
    and private.program_visible(p.id, p.user_id, p.visibility, p.deleted_at)
$$;

revoke execute on function public.program_payload(uuid) from public, anon;
grant execute on function public.program_payload(uuid) to authenticated;

-- B37's team read, re-based on the shared tree builder. Its gate is unchanged:
-- a member of the team, the program pushed to it or assigned to the caller in
-- it, and still live — whatever the program's visibility (a coach may push a
-- private program).
create or replace function public.team_program_payload(p_team uuid, p_program uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.program_tree_json(p.id)
  from public.programs p
  where p.id = p_program
    and p.deleted_at is null
    and private.is_team_member(p_team)
    and (
      exists (
        select 1 from public.team_posts tp
        where tp.team_id = p_team and tp.kind = 'program' and tp.program_id = p_program
      )
      or exists (
        select 1 from public.team_assignments a
        where a.team_id = p_team and a.user_id = (select auth.uid()) and a.program_id = p_program
      )
    )
$$;

-- `create or replace` keeps the existing grants, but restate the lock-down.
revoke execute on function public.team_program_payload(uuid, uuid) from public, anon;
grant execute on function public.team_program_payload(uuid, uuid) to authenticated;
