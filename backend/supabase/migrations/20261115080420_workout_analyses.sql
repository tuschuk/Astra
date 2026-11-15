-- ============================================================================
-- workout_analyses — the post-workout analysis of each finished workout (B18)
-- ============================================================================
-- What this migration does, in plain language:
--   When a lifter finishes a workout, Astra writes a short analysis of it:
--   total volume, how many sets (and how many were warm-ups), how long it took,
--   the personal records the session holds, and an encouraging headline and
--   message. This table stores that analysis — exactly one per workout, because
--   the row's id IS the workout's id.
--
--   Who writes it: ONLY the `analyze-workout` server function, using the
--   server's own key. There are deliberately no insert / update / delete
--   policies, so no app user can write an analysis directly — not even their
--   own. That is what makes "the analysis is the server's scripted rules"
--   (ANA-11) a database fact: a buggy or hostile phone cannot plant a row the
--   rules didn't compute. The function reads the workout with the caller's own
--   login (so it can only ever analyze the caller's own workout) and copies
--   the owner from that workout row.
--
--   Privacy: owner-only read, like the workouts it describes. (Sharing an
--   analysis on a post is B21's, and will widen this deliberately then.)
--
--   Lifetime: an analysis lives as long as its workout ("reopens forever",
--   ANA-1) and is deleted with it (cascade). Editing a workout makes its
--   analysis stale; the phone notices (`workout_updated_at` is older than the
--   workout's `updated_at`) and asks the function again, which replaces the row.
-- ============================================================================

create table public.workout_analyses (
  -- The workout's own id: one analysis per workout, by key. A deleted workout
  -- takes its analysis with it (there would be nothing to reopen it from).
  id                 uuid primary key references public.workouts (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  -- Which version of the rules produced this row (ANALYSIS_ENGINE_VERSION).
  engine_version     integer not null,
  -- Kilograms. Room for a 9,999,999 kg session; one set's weight is capped far lower.
  total_volume_kg    numeric(10, 3) not null check (total_volume_kg >= 0),
  total_sets         integer not null check (total_sets >= 0),
  working_sets       integer not null check (working_sets >= 0 and working_sets <= total_sets),
  duration_seconds   integer not null check (duration_seconds >= 0),
  -- The records the session holds: [{exercise_id, exercise_name, kind, reps, value_kg}, ...]
  new_prs            jsonb not null default '[]'::jsonb check (jsonb_typeof(new_prs) = 'array'),
  headline           text not null,
  message            text not null,
  -- The workout's updated_at the numbers were computed from — the staleness test.
  workout_updated_at timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Downloads read "this lifter's analyses changed after a bookmark" in
-- (updated_at, id) order — the only read pattern.
create index workout_analyses_user_updated_idx
  on public.workout_analyses (user_id, updated_at, id);

create trigger set_updated_at
  before update on public.workout_analyses
  for each row execute function extensions.moddatetime (updated_at);

alter table public.workout_analyses enable row level security;

-- Owner-only read. No write policies: only the server function (service role,
-- which bypasses row-level security) writes here.
create policy "users read their own analyses"
  on public.workout_analyses for select
  to authenticated
  using (user_id = (select auth.uid()));

comment on table public.workout_analyses is
  'One deterministic post-workout analysis per finished workout (id = workout id); written only by the analyze-workout server function.';
