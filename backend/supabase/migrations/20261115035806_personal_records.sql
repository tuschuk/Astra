-- ============================================================================
-- personal_records — each lifter's current bests per exercise (LOG-4, B13)
-- ============================================================================
-- What this migration does, in plain language:
--   Astra keeps three kinds of "record book" for every exercise a lifter does:
--     * true1rm — the heaviest single (1 rep) actually lifted;
--     * repMax  — the heaviest weight for exactly N reps, one book per rep
--                 count (2, 3, 5, ...);
--     * e1rm    — the highest estimated one-rep max (Epley) from any set.
--   This table holds ONE row per book: the current best, and the set that
--   proves it. It is not a history of every PR ever hit — just "what are my
--   records right now". Volume (more sets, more total weight) is never a
--   record; see backend/supabase/functions/_shared/training-math/prs.ts, the
--   one home of those rules.
--
--   Who writes it: the phone. When a workout is finished, the app recomputes
--   the books for each exercise in it from the lifter's full history (offline,
--   on the device), and uploads only books that improved. Row ids are
--   deterministic — the same book always gets the same id on every device —
--   so two phones improving the same book update one row instead of colliding.
--
--   Privacy: owner-only. Only you can read or write your own records, and a
--   record can only cite a set from one of your own workouts as its proof.
--   (Public profile PRs, B25, will widen the read rule deliberately then.)
--
--   The keep-best safety net: a record is never lowered by an upload. A phone
--   that has not finished downloading could otherwise push a smaller value
--   over a real record. Instead of refusing (a refused upload would retry
--   forever and jam that phone's queue), the server quietly keeps the stored
--   best — value, book and proof together — and the phone's next download
--   repairs its copy. B14 (editing / deleting workouts) must rework this
--   trigger, since deleting a record-setting set will legitimately lower one.
-- ============================================================================

-- Exactly the app's PrKind names (training-math/prs.ts). Schema vocabulary,
-- not a copy of the math.
create type public.pr_kind as enum ('true1rm', 'repMax', 'e1rm');

create table public.personal_records (
  -- Client-generated and deterministic: uuidv5(namespace, user:exercise:kind:reps).
  id            uuid primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  exercise_id   uuid not null references public.exercises (id) on delete cascade,
  kind          public.pr_kind not null,
  -- Which rep count's book, for rep maxes only (2 and up; a single is the
  -- true-1RM book).
  reps          smallint check (reps >= 2),
  -- Kilograms, like every weight. Three decimals because an e1RM is an
  -- estimate that is rarely a round number.
  value_kg      numeric(8, 3) not null check (value_kg > 0),
  -- The set that holds this record. Deleting the set deletes the claim.
  source_set_id uuid not null references public.sets (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Rep maxes, and only rep maxes, say which rep count they are for.
  constraint personal_records_reps_only_for_rep_max check ((kind = 'repMax') = (reps is not null))
);

-- "This lifter's records for this exercise" — the only read pattern.
create index personal_records_user_exercise_idx
  on public.personal_records (user_id, exercise_id);

-- One row per book. Correct clients can never hit this (their ids are
-- deterministic per book); it enforces the invariant against buggy ones.
-- coalesce because reps is null outside rep maxes.
create unique index personal_records_book_idx
  on public.personal_records (user_id, exercise_id, kind, coalesce(reps, 0));

-- Downloads read "rows changed after a bookmark" in (updated_at, id) order.
create index personal_records_user_updated_idx
  on public.personal_records (user_id, updated_at, id);

-- The source-set foreign key's cascade looks rows up by set.
create index personal_records_source_set_idx
  on public.personal_records (source_set_id);

alter table public.personal_records enable row level security;

create trigger set_updated_at
  before update on public.personal_records
  for each row execute function extensions.moddatetime (updated_at);

-- ----------------------------------------------------------------------------
-- Keep-best: an update may raise a record, never lower it (see the header).
-- Never raises an error — it keeps the stored best, proof and book identity,
-- and lets the upload succeed. Fires before `set_updated_at` (triggers run in
-- name order), and either order gives the row a fresh updated_at, so other
-- devices download the kept value.
-- ----------------------------------------------------------------------------
create or replace function private.keep_best_personal_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.value_kg < old.value_kg then
    new.value_kg      := old.value_kg;
    new.source_set_id := old.source_set_id;
    new.kind          := old.kind;
    new.reps          := old.reps;
    new.exercise_id   := old.exercise_id;
  end if;
  return new;
end;
$$;

create trigger keep_best_record
  before update on public.personal_records
  for each row execute function private.keep_best_personal_record();

-- ----------------------------------------------------------------------------
-- Does the current user own this set (through its workout)? The proof a
-- record cites must be the lifter's own lift. SECURITY DEFINER so the lookup
-- isn't re-filtered by the sets / entries tables' own RLS.
-- ----------------------------------------------------------------------------
create or replace function private.owns_set(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sets s
    join public.workout_exercises we on we.id = s.workout_exercise_id
    where s.id = sid and private.owns_workout(we.workout_id)
  )
$$;

-- ----------------------------------------------------------------------------
-- Policies: owner-only, and writes must cite one of the owner's own sets.
-- ----------------------------------------------------------------------------
create policy "users read their own records"
  on public.personal_records for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "users record their own PRs"
  on public.personal_records for insert
  to authenticated
  with check (user_id = (select auth.uid()) and private.owns_set(source_set_id));

create policy "users update their own records"
  on public.personal_records for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.owns_set(source_set_id));

create policy "users delete their own records"
  on public.personal_records for delete
  to authenticated
  using (user_id = (select auth.uid()));

comment on table public.personal_records is
  'Current best per record book (user x exercise x kind [x reps]); computed on the phone at finish, never lowered by an upload.';
