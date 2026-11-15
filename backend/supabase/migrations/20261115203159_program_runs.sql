-- ============================================================================
-- Program runs (B35 — PRG-3, LOG-1): a lifter running one of their programs.
-- ============================================================================
-- Two changes:
--
--   program_runs                 one row per time a lifter starts running a
--                                program: which program, and where they are in
--                                it (the next session's week and workout
--                                POSITIONS — see below). A run is never deleted;
--                                it ENDS (`ended_at`), when the lifter stops it,
--                                finishes its last session, or starts another
--                                program. Ended rows are the run history.
--   workouts.program_workout_id  which program workout a logged session was
--                                started from (null for an ordinary workout).
--                                Finishing such a workout is what moves its run
--                                on to the next session, on the phone, in the
--                                same transaction as the finish.
--
-- WHY POSITIONS, NOT A program_workout id: programs are edited while they run.
-- Weeks and workouts are never renumbered (B34), so a stored (week position,
-- workout position) keeps meaning the same session until that session is
-- removed — and then it simply slides to the session that now stands there.
-- An id would dangle with nothing to fall back on.
--
-- AT MOST ONE ACTIVE RUN PER LIFTER IS ENFORCED BY THE APP, NOT HERE. There is
-- deliberately no unique index on (user_id) where ended_at is null: two phones
-- starting runs offline would both upload an active run, the second would be
-- refused, and that phone's upload queue would be stuck behind it forever. The
-- phone ends every active run it sees when it starts a new one, and every read
-- treats the newest active run (by started_at, then id) as "the" run. A query
-- written by hand must do the same — it must not assume at most one row.
--
-- ROW-LEVEL SECURITY: owner-only for all four verbs. `program_id` is an
-- existence-only foreign key (the `exercise_id` precedent): it proves the
-- program exists, it grants no read of it.
-- ============================================================================

create table public.program_runs (
  id                    uuid primary key,  -- client-generated, like workouts.id
  user_id               uuid not null references public.profiles (id) on delete cascade,
  program_id            uuid not null references public.programs (id) on delete cascade,
  -- Where the run is: the stored `position` (not the 1-based "Week N") of the
  -- next session's week, and of that workout within its week.
  next_week_position    smallint not null check (next_week_position >= 0),
  next_workout_position smallint not null check (next_workout_position >= 0),
  started_at            timestamptz not null,
  -- Null while the run is active. The phone never stamps a time before the
  -- start (it clamps a clock that is behind), so honest uploads always pass.
  ended_at              timestamptz check (ended_at is null or ended_at >= started_at),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- The phone's download reads "this user's runs after a bookmark".
create index program_runs_user_idx on public.program_runs (user_id, updated_at);
-- The program foreign key's cascade.
create index program_runs_program_idx on public.program_runs (program_id);

alter table public.program_runs enable row level security;

create trigger set_updated_at
  before update on public.program_runs
  for each row execute function extensions.moddatetime (updated_at);

create policy "lifters read their own program runs"
  on public.program_runs for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "lifters start program runs as themselves"
  on public.program_runs for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "lifters update their own program runs"
  on public.program_runs for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "lifters delete their own program runs"
  on public.program_runs for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- workouts.program_workout_id
-- ----------------------------------------------------------------------------
-- Existence-only, like exercise_id: the workouts policies already govern the
-- row. `on delete set null` so a program workout removed for good (account
-- deletion, a cascade) leaves the logged session in place.
alter table public.workouts add column program_workout_id uuid
  references public.program_workouts (id) on delete set null;

create index workouts_program_workout_idx on public.workouts (program_workout_id);
