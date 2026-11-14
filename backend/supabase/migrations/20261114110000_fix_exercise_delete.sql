-- ============================================================================
-- Fix: deleting an exercise (or a whole account) must not be blocked by history
-- ============================================================================
-- Found by the live RLS probe on Nov 14, 2026: deleting a user's auth account
-- cascades to their custom `exercises` rows, but `workout_exercises.exercise_id`
-- had no ON DELETE action (Postgres defaults to "refuse"). Postgres does not
-- guarantee the workouts cascade runs before the exercises cascade, so account
-- deletion failed with a foreign-key violation — breaking the full account
-- deletion requirement (NFR-6).
--
-- The fix: when an exercise disappears, its historical workout entries live on
-- with exercise_id set to null ("a deleted exercise") instead of being deleted
-- or blocking the delete. A user's logged sets are never collateral damage of
-- removing a custom exercise. (A name snapshot on the entry, so history can
-- still say WHICH exercise it was, is noted in docs/DEFERRED.md for the logger
-- build items.)
alter table public.workout_exercises
  alter column exercise_id drop not null;

alter table public.workout_exercises
  drop constraint workout_exercises_exercise_id_fkey;

alter table public.workout_exercises
  add constraint workout_exercises_exercise_id_fkey
    foreign key (exercise_id) references public.exercises (id) on delete set null;
