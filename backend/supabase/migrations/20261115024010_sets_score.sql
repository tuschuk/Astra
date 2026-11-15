-- ============================================================================
-- sets.score — the result of a WOD-style piece that isn't a time (LOG-13, B11)
-- ============================================================================
-- What this migration does, in plain language:
--   Some workouts are scored rather than counted as sets × reps: an AMRAP
--   ("as many rounds as possible") ends as "7 rounds + 12 reps", a row ends
--   as "500 m", a bike as "32 cal". Time already has a home
--   (sets.duration_seconds); a score had none, and squeezing one into `reps`
--   would make a WOD read as hundreds of reps of a single movement.
--
--   So each set gains an optional free-text `score`, capped at 100
--   characters like the other free-text columns. It is for people to read:
--   nothing parses it, the post-workout analysis ignores it (as it ignores
--   notes), and no leaderboard ranks it.
--
--   Row-level security is unchanged: the existing `sets` policies are
--   row-level, so they already cover the new column.
--
--   The phone checks the same 100-character rule before saving
--   (backend/supabase/functions/_shared/training-math/limits.ts) so a score
--   the server would refuse never reaches the upload queue. Change both
--   together.
-- ============================================================================

alter table public.sets
  add column score text check (char_length(score) <= 100);

comment on column public.sets.score is
  'Free-text result of a scored (WOD-style) set, e.g. "7 rounds + 12 reps". Display only; never parsed.';
