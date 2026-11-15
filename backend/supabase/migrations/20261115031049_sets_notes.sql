-- ============================================================================
-- sets.notes — the lifter's remark about one set (LOG-3, B12)
-- ============================================================================
-- What this migration does, in plain language:
--   A lifter can already write a note on the whole workout (workouts.notes)
--   and on each exercise in it (workout_exercises.notes). This adds the third
--   level: a note on a single set — "elbow twinged on rep 3", "belt on".
--
--   Each set gains an optional free-text `notes`, capped at 500 characters:
--   longer than a score (100) but shorter than an exercise note (1000), so the
--   caps step down workout → exercise → set. It is for people to read:
--   nothing parses it, the post-workout analysis ignores it, and no
--   leaderboard ranks it.
--
--   Row-level security is unchanged: the existing `sets` policies are
--   row-level, so they already cover the new column, and a set note is seen
--   by exactly whoever may see its workout.
--
--   The phone checks the same 500-character rule before saving
--   (backend/supabase/functions/_shared/training-math/limits.ts,
--   MAX_SET_NOTES_LENGTH) so a note the server would refuse never reaches the
--   upload queue. Change both together.
-- ============================================================================

alter table public.sets
  add column notes text check (char_length(notes) <= 500);

comment on column public.sets.notes is
  'Free-text remark about this one set, e.g. "elbow twinged on rep 3". Display only; never parsed.';
