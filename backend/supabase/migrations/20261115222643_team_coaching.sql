-- ============================================================================
-- Team coaching (B37 — TEAM-3, TEAM-5): coaches, pushed content, program
-- assignments and coach access to members' training logs.
-- ============================================================================
-- What this migration does, in plain language:
--
--   1. ROLES. A team's owner can make a member a coach, or a coach a member
--      again. Nobody can make a second owner, and the owner's own row never
--      changes. The owner counts as a coach everywhere (the solo owner-coach is
--      the commonest team, and the owner row's role can never change).
--
--   2. PUSHES (`team_posts`). A coach posts an announcement, a program or one
--      program workout to the team. Every member of the team reads them; nobody
--      else does. A coach can only push their OWN programs, and can delete
--      their own pushes. Pushes are never edited.
--
--   3. ASSIGNMENTS (`team_assignments`). A coach assigns one of their own
--      programs to one member. The member sees it on the team page and taps
--      Start: the phone copies the program into the member's own programs and
--      starts running it, then deletes the assignment. (The coach's program
--      never syncs to the member's phone — see the B34 warning in
--      20261115193156_programs.sql — so the copy is how it becomes theirs.)
--
--   4. READING PUSHED PROGRAMS. Members can't read the coach's program tables
--      (author-only, and the phone pulls the child tables unfiltered), so two
--      SECURITY DEFINER functions hand a member the pushed or assigned program
--      as one JSON document: `team_program_payload` and `team_workout_payload`.
--      Each answers null unless the caller is a member of the team AND the
--      program was pushed to it (or assigned to the caller in it) AND it is
--      still live.
--
--   5. COACH LOG ACCESS (TEAM-5). A coach of a team reads every member's
--      workouts, entries and sets — private ones included — unless either has
--      blocked the other. Access is a live join on the membership table, so it
--      ends the moment either leaves the team or the coach is demoted.
--      Deliberately NOT widened: posts (progress pics), personal records,
--      analyses, body data, storage. That is why the coach arm is a sibling
--      helper and not part of `private.workout_visible` (which posts use) or
--      `private.can_view_workout` (which personal records use).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Roles — owners promote and demote coaches
-- ----------------------------------------------------------------------------
-- `using` picks the rows the owner may touch (never the owner row itself);
-- `with check` limits the new role to coach or member (never a second owner).
create policy "owners change member roles"
  on public.team_members for update
  to authenticated
  using (private.is_team_owner(team_id) and role <> 'owner')
  with check (private.is_team_owner(team_id) and role in ('coach', 'member'));

-- Only `role` is editable: rewriting user_id would hand a membership to someone
-- else (the B36 created_by lesson — the table grant must go, then the column
-- comes back).
revoke update on public.team_members from authenticated, anon;
grant update (role) on public.team_members to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Helpers — the coach rule lives once
-- ----------------------------------------------------------------------------
-- Does the caller hold a coaching role (owner or coach) in team `tid`?
create or replace function private.is_team_coach(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = tid and m.user_id = (select auth.uid()) and m.role in ('owner', 'coach')
  )
$$;

-- Is lifter `uid` a member (any role) of team `tid`?
create or replace function private.user_in_team(tid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m where m.team_id = tid and m.user_id = uid
  )
$$;

-- May the caller read `owner`'s training log as their coach? True when they
-- share a team in which the caller is owner or coach — and no block exists in
-- either direction.
create or replace function private.coach_reads_logs(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.team_members c
      join public.team_members m on m.team_id = c.team_id
      where c.user_id = (select auth.uid())
        and c.role in ('owner', 'coach')
        and m.user_id = owner
    )
    and not private.blocked_either((select auth.uid()), owner)
$$;

-- May the caller read workout `wid`'s log (its entries and sets)? Ordinary
-- visibility, or the coach arm. Used by the entries and sets select policies
-- ONLY — personal records keep reading through can_view_workout, so a coach
-- never sees a member's PR book.
create or replace function private.can_read_workout_log(wid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workouts w
    where w.id = wid
      and (private.workout_visible(w.user_id, w.visibility) or private.coach_reads_logs(w.user_id))
  )
$$;

-- ----------------------------------------------------------------------------
-- 3. Coach log access (TEAM-5) — workouts, entries, sets
-- ----------------------------------------------------------------------------
-- The phone's own download filters workouts to the signed-in lifter, so a
-- coach's sync mirror never fills with members' rows.
drop policy "workouts readable per their visibility" on public.workouts;
create policy "workouts readable per their visibility"
  on public.workouts for select
  to authenticated
  using (private.workout_visible(user_id, visibility) or private.coach_reads_logs(user_id));

drop policy "entries readable with their workout" on public.workout_exercises;
create policy "entries readable with their workout"
  on public.workout_exercises for select
  to authenticated
  using (private.can_read_workout_log(workout_id));

drop policy "sets readable with their workout" on public.sets;
create policy "sets readable with their workout"
  on public.sets for select
  to authenticated
  using (private.can_read_workout_log(private.entry_workout(workout_exercise_id)));

-- ----------------------------------------------------------------------------
-- 4. team_posts — pushed announcements, programs and workouts
-- ----------------------------------------------------------------------------
create type public.team_post_kind as enum ('announcement', 'program', 'workout');

create table public.team_posts (
  id                 uuid primary key default gen_random_uuid(),  -- online-only: the server picks the id
  team_id            uuid not null references public.teams (id) on delete cascade,
  author_id          uuid not null references public.profiles (id) on delete cascade,
  kind               public.team_post_kind not null,
  -- The announcement's text. Mirrored by MAX_TEAM_ANNOUNCEMENT_LENGTH in
  -- @training-math limits.ts; change the two together.
  body               text check (char_length(body) between 1 and 2000),
  program_id         uuid references public.programs (id) on delete cascade,
  program_workout_id uuid references public.program_workouts (id) on delete cascade,
  created_at         timestamptz not null default now(),
  -- Exactly the one payload its kind names.
  check ((kind = 'announcement') = (body is not null)),
  check ((kind = 'program') = (program_id is not null)),
  check ((kind = 'workout') = (program_workout_id is not null))
);

create index team_posts_team_idx on public.team_posts (team_id, created_at desc);
create index team_posts_author_idx on public.team_posts (author_id);
create index team_posts_program_idx on public.team_posts (program_id);
create index team_posts_program_workout_idx on public.team_posts (program_workout_id);

alter table public.team_posts enable row level security;

-- A coach pushes as themselves, and only their own program / program workout
-- (without the ownership arms a coach could push someone else's program id
-- and the payload function would show its contents to the team).
create policy "coaches push to their teams"
  on public.team_posts for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and private.is_team_coach(team_id)
    and (program_id is null or private.owns_program(program_id))
    and (
      program_workout_id is null
      or private.owns_program(private.week_program(private.workout_week(program_workout_id)))
    )
  );

create policy "members read their team's pushes"
  on public.team_posts for select
  to authenticated
  using (private.is_team_member(team_id));

-- An author retracts their own push (owner moderation is B38).
create policy "authors delete their pushes"
  on public.team_posts for delete
  to authenticated
  using (author_id = (select auth.uid()));

-- No update policy: pushes are immutable; a wrong one is deleted and redone.

-- ----------------------------------------------------------------------------
-- 5. team_assignments — "this program, for this member"
-- ----------------------------------------------------------------------------
create table public.team_assignments (
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,  -- the assignee
  program_id  uuid not null references public.programs (id) on delete cascade,
  assigned_by uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (team_id, user_id, program_id)
);

create index team_assignments_user_idx on public.team_assignments (user_id);
create index team_assignments_program_idx on public.team_assignments (program_id);
create index team_assignments_assigned_by_idx on public.team_assignments (assigned_by);

alter table public.team_assignments enable row level security;

-- A coach assigns their own program to a member of the team, never across a
-- block (the invites precedent).
create policy "coaches assign programs to members"
  on public.team_assignments for insert
  to authenticated
  with check (
    assigned_by = (select auth.uid())
    and private.is_team_coach(team_id)
    and private.owns_program(program_id)
    and private.user_in_team(team_id, user_id)
    and not private.blocked_either((select auth.uid()), user_id)
  );

create policy "assignees and coaches see assignments"
  on public.team_assignments for select
  to authenticated
  using (user_id = (select auth.uid()) or private.is_team_coach(team_id));

-- The assignee accepts (after copying) or dismisses; a coach revokes.
create policy "assignees and coaches remove assignments"
  on public.team_assignments for delete
  to authenticated
  using (user_id = (select auth.uid()) or private.is_team_coach(team_id));

-- ----------------------------------------------------------------------------
-- 6. Payload functions — how a member reads pushed program content
-- ----------------------------------------------------------------------------
-- One program workout and its live slots as JSON (internal: callers gate).
-- Exercise names come straight from `exercises` (definer), so a coach's own
-- custom exercise still names itself in the pushed view.
create or replace function private.program_workout_json(pwid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', pw.name,
    'position', pw.position,
    'exercises', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'exercise_id', pe.exercise_id,
          'exercise_name', e.name,
          'position', pe.position,
          'target_sets', pe.target_sets,
          'target_reps', pe.target_reps,
          'target_weight_kg', pe.target_weight_kg,
          'target_rpe', pe.target_rpe
        )
        order by pe.position, pe.id
      )
      from public.program_exercises pe
      left join public.exercises e on e.id = pe.exercise_id
      where pe.program_workout_id = pw.id and pe.deleted_at is null
    ), '[]'::jsonb)
  )
  from public.program_workouts pw
  where pw.id = pwid
$$;

-- The whole live tree of program `p_program`, for a member of team `p_team`,
-- when that program was pushed to the team or assigned to the caller in it.
-- Null otherwise (not a member, never pushed, or the program is deleted).
create or replace function public.team_program_payload(p_team uuid, p_program uuid)
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

-- One live program workout pushed to team `p_team`, for a member of it, with
-- its program's name beside it. Null otherwise.
create or replace function public.team_workout_payload(p_team uuid, p_program_workout uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.program_workout_json(pw.id) || jsonb_build_object('program_name', p.name)
  from public.program_workouts pw
  join public.program_weeks w on w.id = pw.program_week_id
  join public.programs p on p.id = w.program_id
  where pw.id = p_program_workout
    and pw.deleted_at is null and w.deleted_at is null and p.deleted_at is null
    and private.is_team_member(p_team)
    and exists (
      select 1 from public.team_posts tp
      where tp.team_id = p_team and tp.kind = 'workout' and tp.program_workout_id = p_program_workout
    )
$$;

-- Functions are executable by PUBLIC by default; only signed-in users may ask.
revoke execute on function public.team_program_payload(uuid, uuid) from public, anon;
grant execute on function public.team_program_payload(uuid, uuid) to authenticated;
revoke execute on function public.team_workout_payload(uuid, uuid) from public, anon;
grant execute on function public.team_workout_payload(uuid, uuid) to authenticated;
