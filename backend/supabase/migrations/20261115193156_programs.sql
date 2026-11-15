-- ============================================================================
-- Programs (B34 — PRG-1, PRG-2): a lifter's own training program, authored as
-- weeks → workouts → exercises with target sets, reps, load and RPE.
-- ============================================================================
-- Four tables, one per level of the hierarchy:
--
--   programs           one program, owned by its author (user_id)
--   program_weeks      "Week 1…N" of a program (no name — shown from position)
--   program_workouts   one workout inside a week ("Day A", or "Workout N")
--   program_exercises  one exercise slot inside a workout, with its targets
--
-- Every id is generated on the phone (programs are authored offline and synced
-- by the generic outbox, like workouts), so there is no id default.
--
-- DELETES ARE SOFT: every table has `deleted_at`. Removing a week, a workout,
-- an exercise slot or a whole program only stamps that one row; a row is live
-- when its own `deleted_at` is null AND every ancestor's is too. A soft delete
-- is an ordinary update, so it rides the phone's existing upload and download
-- with no tombstone machinery (see docs/feature_plans/program-builder.md §b).
--
-- ROW-LEVEL SECURITY IS AUTHOR-ONLY for all four verbs on all four tables:
-- nobody but the author can read, add, change or delete any of it. The rule
-- lives once, in `private.owns_program`, and the children reach it through
-- the two lookup helpers below.
--
-- WARNING FOR B39 (program visibility): the phone downloads the three child
-- tables WITHOUT filtering them by program — it relies on these select
-- policies returning only the caller's own rows. If a later migration lets
-- other users read a program's children (through a visible program), the
-- phone's sync mirror would start downloading other authors' rows. Keep the
-- children's select author-only (others read shared programs online, never
-- into the mirror) or change the phone's download shape in the same step.
--
-- No `visibility` column on purpose: author-only is private-only, which is
-- this step's scope; B39 adds the column when something reads it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- programs
-- ----------------------------------------------------------------------------
create table public.programs (
  id         uuid primary key,  -- client-generated, like workouts.id
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  deleted_at timestamptz,       -- soft delete (see the file comment)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The phone's download reads "this user's programs after a bookmark".
create index programs_user_idx on public.programs (user_id, updated_at);

alter table public.programs enable row level security;

create trigger set_updated_at
  before update on public.programs
  for each row execute function extensions.moddatetime (updated_at);

-- ----------------------------------------------------------------------------
-- program_weeks
-- ----------------------------------------------------------------------------
create table public.program_weeks (
  id         uuid primary key,
  program_id uuid not null references public.programs (id) on delete cascade,
  -- Display order (Week 1 = lowest). Not unique: offline edits sync row by row.
  position   smallint not null check (position >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index program_weeks_program_idx on public.program_weeks (program_id);

alter table public.program_weeks enable row level security;

create trigger set_updated_at
  before update on public.program_weeks
  for each row execute function extensions.moddatetime (updated_at);

-- ----------------------------------------------------------------------------
-- program_workouts
-- ----------------------------------------------------------------------------
create table public.program_workouts (
  id              uuid primary key,
  program_week_id uuid not null references public.program_weeks (id) on delete cascade,
  name            text check (char_length(name) <= 100),  -- null → shown as "Workout N"
  position        smallint not null check (position >= 0),
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index program_workouts_week_idx on public.program_workouts (program_week_id);

alter table public.program_workouts enable row level security;

create trigger set_updated_at
  before update on public.program_workouts
  for each row execute function extensions.moddatetime (updated_at);

-- ----------------------------------------------------------------------------
-- program_exercises
-- ----------------------------------------------------------------------------
create table public.program_exercises (
  id                 uuid primary key,
  program_workout_id uuid not null references public.program_workouts (id) on delete cascade,
  -- Library (uuidv5 of its slug) or a custom exercise. Nullable + set null, the
  -- workout_exercises precedent: if the exercise row is ever hard-deleted
  -- (account deletion, a founder content change) the slot survives and shows
  -- as "Deleted exercise".
  exercise_id        uuid references public.exercises (id) on delete set null,
  position           smallint not null check (position >= 0),
  -- Required: a prescription must say how many sets.
  target_sets        smallint not null check (target_sets >= 1),
  -- Optional: bodyweight work has no load; RPE is optional everywhere.
  target_reps        integer check (target_reps >= 0),
  target_weight_kg   numeric(6, 2) check (target_weight_kg >= 0),  -- always kg, like sets.weight_kg
  target_rpe         numeric(3, 1) check (target_rpe between 1 and 10),
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index program_exercises_workout_idx on public.program_exercises (program_workout_id);
create index program_exercises_exercise_idx on public.program_exercises (exercise_id);

alter table public.program_exercises enable row level security;

create trigger set_updated_at
  before update on public.program_exercises
  for each row execute function extensions.moddatetime (updated_at);

-- ----------------------------------------------------------------------------
-- Ownership helpers — THE single home of "is this the caller's program?"
-- ----------------------------------------------------------------------------
-- In `private` so the API can't call them; SECURITY DEFINER so the parent
-- lookups aren't re-filtered by the parent tables' own RLS (the same reason
-- as private.owns_workout / private.entry_workout).

-- Does the caller own program `pid`?
create or replace function private.owns_program(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.programs p
    where p.id = pid and p.user_id = (select auth.uid())
  )
$$;

-- Which program does week `week_id` belong to?
create or replace function private.week_program(week_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select program_id from public.program_weeks where id = week_id
$$;

-- Which week does program workout `pwid` belong to?
create or replace function private.workout_week(pwid uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select program_week_id from public.program_workouts where id = pwid
$$;

-- ----------------------------------------------------------------------------
-- Policies — author-only, all four verbs, all four tables
-- ----------------------------------------------------------------------------
create policy "authors read their own programs"
  on public.programs for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "authors create programs as themselves"
  on public.programs for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "authors update their own programs"
  on public.programs for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "authors delete their own programs"
  on public.programs for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy "authors read weeks of their programs"
  on public.program_weeks for select
  to authenticated
  using (private.owns_program(program_id));

create policy "authors add weeks to their programs"
  on public.program_weeks for insert
  to authenticated
  with check (private.owns_program(program_id));

create policy "authors update weeks of their programs"
  on public.program_weeks for update
  to authenticated
  using (private.owns_program(program_id))
  with check (private.owns_program(program_id));

create policy "authors delete weeks of their programs"
  on public.program_weeks for delete
  to authenticated
  using (private.owns_program(program_id));

create policy "authors read workouts of their programs"
  on public.program_workouts for select
  to authenticated
  using (private.owns_program(private.week_program(program_week_id)));

create policy "authors add workouts to their programs"
  on public.program_workouts for insert
  to authenticated
  with check (private.owns_program(private.week_program(program_week_id)));

create policy "authors update workouts of their programs"
  on public.program_workouts for update
  to authenticated
  using (private.owns_program(private.week_program(program_week_id)))
  with check (private.owns_program(private.week_program(program_week_id)));

create policy "authors delete workouts of their programs"
  on public.program_workouts for delete
  to authenticated
  using (private.owns_program(private.week_program(program_week_id)));

create policy "authors read exercises of their programs"
  on public.program_exercises for select
  to authenticated
  using (private.owns_program(private.week_program(private.workout_week(program_workout_id))));

create policy "authors add exercises to their programs"
  on public.program_exercises for insert
  to authenticated
  with check (private.owns_program(private.week_program(private.workout_week(program_workout_id))));

create policy "authors update exercises of their programs"
  on public.program_exercises for update
  to authenticated
  using (private.owns_program(private.week_program(private.workout_week(program_workout_id))))
  with check (private.owns_program(private.week_program(private.workout_week(program_workout_id))));

create policy "authors delete exercises of their programs"
  on public.program_exercises for delete
  to authenticated
  using (private.owns_program(private.week_program(private.workout_week(program_workout_id))));
