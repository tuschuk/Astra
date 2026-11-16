/**
 * The trend part of a post-workout analysis (B42, ANA-5 and LOG-10): this session's volume and
 * intensity set against the lifter's OWN recent history.
 *
 * In plain words: Astra looks back over the lifter's last few real sessions (up to 10), works out
 * their average volume and average intensity, and stores those averages next to this session's
 * own numbers — so the analysis screen can say "about 12% more volume than your recent average".
 * Below 5 earlier sessions there is no trend at all: too little history to call anything a trend.
 *
 * Intensity has two measures, so it works whether or not the lifter rates their sets:
 *   - **Average RPE** — the mean of the lifter's own 1–10 effort ratings (LOG-10), used when both
 *     this session and the history carry them;
 *   - **Load per rep** — volume ÷ the reps that made it ("how heavy was the average rep"), the
 *     fallback when RPE is missing.
 *
 * Why this file exists: like the rest of the analysis, the trend is computed both by the
 * `analyze-workout` server function and by the phone (offline). Both hand this file the same
 * rows and get the same numbers. Selecting WHICH earlier sessions count lives here too (sorting,
 * the "started before" rule, the caps) — the two readers only fetch, so they can never disagree
 * about the window. Pure logic: no I/O, no clock, no randomness; Deno-loadable (imports spell
 * out `.ts`). The constants below are product tuning, not performance claims — no copy cites
 * them as science.
 */
import { MAX_SET_RPE, MIN_SET_RPE, roundToIncrement, sessionVolumeKg, setVolumeKg } from '../training-math/index.ts';
import { timestampMs, type AnalysisInput, type AnalysisSet, type TrendSessionInput } from './summary.ts';

/**
 * How many recent sessions the averages cover at most. 10 spans at least two full cycles of the
 * common 3–5-day splits, so the average blends leg days with push days, while staying recent.
 */
export const TREND_WINDOW_SESSIONS = 10;

/**
 * The threshold ("once enough sessions exist"): fewer earlier sessions than this and no trend
 * is computed at all. Below one full split cycle the average mostly measures which day of the
 * split it is. Mirrored by the `trend_sessions` CHECK in `…_analysis_trend.sql` — change together.
 */
export const TREND_MIN_SESSIONS = 5;

/**
 * An intensity average (RPE or load per rep) needs at least this many history sessions that
 * have the measure; below it, one odd session would own the average, so that average is null.
 */
export const TREND_MIN_MEASURE_SESSIONS = 3;

/**
 * Most earlier workouts either reader fetches (newest first). Bounds the read on both runtimes;
 * empty finishes among them are dropped before the window is filled, so a lifter with dozens of
 * consecutive empty finishes gets a thinner (still deterministic) window.
 */
export const TREND_SCAN_LIMIT = 40;

/** Volume and load-per-rep rounding: 3 decimals, like the stored numeric(…, 3) columns. */
const KG_INCREMENT = 0.001;
/** RPE rounding: 2 decimals, like the stored numeric(4,2) columns. */
const RPE_INCREMENT = 0.01;

/** One session's own measures (any of them may be absent except volume). */
export interface SessionMeasures {
  /** Reps × weight over the work sets, kg, 3 decimals (warm-ups and unloaded sets add 0). */
  volume_kg: number;
  /** Mean RPE of the non-warm-up sets that carry a valid one (1–10), 2 decimals; null if none. */
  rpe_avg: number | null;
  /** volume ÷ the reps of the sets that made volume, kg, 3 decimals; null if no set carried load. */
  load_per_rep_kg: number | null;
}

/**
 * The trend fields of an analysis, column for column as `workout_analyses` stores them. All
 * `trend_*` fields are null below the threshold (the absent section). The two `session_*`
 * fields are facts about this session alone, stored whenever computable, threshold or not.
 */
export interface AnalysisTrend {
  /** How many earlier sessions the averages cover (5–10), or null when there is no trend. */
  trend_sessions: number | null;
  /** Mean volume of those sessions, kg. */
  trend_volume_avg_kg: number | null;
  /** Mean of those sessions' average RPEs — null unless at least 3 of them have one. */
  trend_rpe_avg: number | null;
  /** Mean of those sessions' load per rep, kg — null unless at least 3 of them have one. */
  trend_load_per_rep_avg_kg: number | null;
  /** This session's average RPE. */
  session_rpe_avg: number | null;
  /** This session's load per rep, kg. */
  session_load_per_rep_kg: number | null;
}

/**
 * Works out one session's measures from its raw set rows (see `SessionMeasures`).
 *
 * RPE counts on bodyweight and timed sets too — it is the lifter's own effort rating, not the
 * bar's load — but never on warm-ups, and a value outside 1–10 (a leftover the server would
 * refuse) is ignored rather than poisoning the mean. Load per rep uses exactly the sets that made
 * volume, so the two numbers always describe the same work.
 */
export function sessionMeasures(sets: readonly AnalysisSet[]): SessionMeasures {
  const volumeSets = sets.map((s) => ({ reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup }));
  // Tonnage comes from the one volume home; the reps counted are those of the sets it counted.
  const volume = sessionVolumeKg(volumeSets);
  const loadedReps = volumeSets.reduce((total, s) => total + (setVolumeKg(s) > 0 ? (s.reps ?? 0) : 0), 0);
  let rpeSum = 0;
  let rpeCount = 0;
  for (const s of sets) {
    const rpe = s.rpe;
    if (!s.is_warmup && typeof rpe === 'number' && Number.isFinite(rpe) && rpe >= MIN_SET_RPE && rpe <= MAX_SET_RPE) {
      rpeSum += rpe;
      rpeCount += 1;
    }
  }
  return {
    volume_kg: roundToIncrement(volume, KG_INCREMENT),
    rpe_avg: rpeCount > 0 ? roundToIncrement(rpeSum / rpeCount, RPE_INCREMENT) : null,
    load_per_rep_kg: loadedReps > 0 ? roundToIncrement(volume / loadedReps, KG_INCREMENT) : null,
  };
}

/**
 * The earlier sessions the trend averages over, newest first.
 *
 * Inputs: the analyzed workout (its id and start), and the candidates a reader fetched.
 * Output: at most `TREND_WINDOW_SESSIONS` sessions that (a) started strictly before the analyzed
 * workout — same instant breaks the tie by id, so two workouts sharing a start stamp sit in one
 * fixed order on both runtimes — (b) are among the `TREND_SCAN_LIMIT` newest such candidates,
 * and (c) have at least one logged set (an empty finish is a saved moment, not training, and
 * would drag the average toward zero). Timestamps are compared as instants (`timestampMs`), never
 * as text: the phone holds both "…Z" and "…+00:00" stamps, which don't sort like their instants.
 */
export function trendHistory(
  workout: { id: string; started_at: string },
  candidates: readonly TrendSessionInput[],
): TrendSessionInput[] {
  const at = timestampMs(workout.started_at);
  if (!Number.isFinite(at)) return [];
  const before = candidates
    .map((c) => ({ c, ms: timestampMs(c.started_at) }))
    .filter(({ c, ms }) => Number.isFinite(ms) && (ms < at || (ms === at && c.id < workout.id)))
    .sort((a, b) => b.ms - a.ms || (a.c.id < b.c.id ? 1 : a.c.id > b.c.id ? -1 : 0))
    .map(({ c }) => c);
  return before
    .slice(0, TREND_SCAN_LIMIT)
    .filter((c) => c.sets.length > 0)
    .slice(0, TREND_WINDOW_SESSIONS);
}

/** The mean of the given numbers, rounded to `increment`, or null if fewer than `min` of them. */
function meanOrNull(values: readonly number[], min: number, increment: number): number | null {
  if (values.length < min) return null;
  return roundToIncrement(values.reduce((t, v) => t + v, 0) / values.length, increment);
}

/**
 * The trend fields for one analysis (see `AnalysisTrend`).
 *
 * The analyzed session's own sets are those inside its slots (the same rule as the summary).
 * History comes from `input.history` through `trendHistory`. Each average is the plain mean of
 * the per-session values, so every session weighs the same however many sets it had.
 */
export function buildTrend(input: Pick<AnalysisInput, 'workout' | 'entries' | 'sets' | 'history'>): AnalysisTrend {
  const slotIds = new Set(input.entries.map((e) => e.id));
  const own = sessionMeasures(input.sets.filter((s) => slotIds.has(s.workout_exercise_id)));
  const history = trendHistory(input.workout, input.history).map((h) => sessionMeasures(h.sets));
  const session = { session_rpe_avg: own.rpe_avg, session_load_per_rep_kg: own.load_per_rep_kg };

  if (history.length < TREND_MIN_SESSIONS) {
    return {
      trend_sessions: null,
      trend_volume_avg_kg: null,
      trend_rpe_avg: null,
      trend_load_per_rep_avg_kg: null,
      ...session,
    };
  }
  // Only the sessions that HAVE a measure count toward its average (and toward its minimum of 3).
  const present = (values: (number | null)[]) => values.filter((v): v is number => v != null);
  return {
    trend_sessions: history.length,
    trend_volume_avg_kg: meanOrNull(
      history.map((h) => h.volume_kg),
      1,
      KG_INCREMENT,
    ),
    trend_rpe_avg: meanOrNull(present(history.map((h) => h.rpe_avg)), TREND_MIN_MEASURE_SESSIONS, RPE_INCREMENT),
    trend_load_per_rep_avg_kg: meanOrNull(
      present(history.map((h) => h.load_per_rep_kg)),
      TREND_MIN_MEASURE_SESSIONS,
      KG_INCREMENT,
    ),
    ...session,
  };
}
