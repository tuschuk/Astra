-- B42 trend analysis (ANA-5, LOG-10): the trend fields of a post-workout analysis.
--
-- Six nullable numbers on workout_analyses, written by the analyze-workout server function from
-- the shared rules in functions/_shared/analysis/trend.ts (engine version 2):
--   trend_sessions            how many of the lifter's earlier sessions the averages cover (5–10);
--   trend_volume_avg_kg       their mean volume, kg;
--   trend_rpe_avg             the mean of their average RPEs (null unless 3+ of them have RPE);
--   trend_load_per_rep_avg_kg the mean of their load per rep, kg (null unless 3+ have load);
--   session_rpe_avg           THIS session's average RPE over non-warm-up sets;
--   session_load_per_rep_kg   THIS session's volume ÷ the reps that made it, kg.
-- The four trend_* columns are null below the threshold (fewer than 5 earlier sessions) — the
-- "absent section". The two session_* columns are facts about the session alone, stored whenever
-- computable whatever the history (later steps read them without recomputing). Rows made by
-- engine version 1 keep nulls until the phone's request pass asks for them again.
--
-- No policy change: the table is already owner-select-only with writes by the server role only,
-- which covers new columns. No index, no trigger.

alter table public.workout_analyses
  -- Bounds mirror TREND_MIN_SESSIONS / TREND_WINDOW_SESSIONS in _shared/analysis/trend.ts —
  -- change them together.
  add column trend_sessions            integer       check (trend_sessions between 5 and 10),
  add column trend_volume_avg_kg       numeric(10,3) check (trend_volume_avg_kg >= 0),
  add column trend_rpe_avg             numeric(4,2)  check (trend_rpe_avg between 1 and 10),
  add column trend_load_per_rep_avg_kg numeric(8,3)  check (trend_load_per_rep_avg_kg >= 0),
  add column session_rpe_avg           numeric(4,2)  check (session_rpe_avg between 1 and 10),
  add column session_load_per_rep_kg   numeric(8,3)  check (session_load_per_rep_kg >= 0);
