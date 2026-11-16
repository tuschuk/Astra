// Tests for trend.ts — which earlier sessions count, each session's measures, and the averages
// (B42 step DoD: absent below the threshold, numbers matching history above it). Every expected
// number is worked out by hand in the comments.
import { describe, expect, it } from '@jest/globals';

import type { AnalysisInput, AnalysisSet, TrendSessionInput } from './summary.ts';
import {
  buildTrend,
  sessionMeasures,
  TREND_MIN_SESSIONS,
  TREND_SCAN_LIMIT,
  TREND_WINDOW_SESSIONS,
  trendHistory,
} from './trend.ts';

/** A set: [reps, kg, rpe, warm-up?]. */
type S = [number | null, number | null, number | null, boolean?];

function sets(prefix: string, rows: S[]): AnalysisSet[] {
  return rows.map(([reps, kg, rpe, warm], i) => ({
    id: `${prefix}-s${i}`,
    workout_exercise_id: `${prefix}-e`,
    position: i,
    reps,
    weight_kg: kg,
    is_warmup: warm ?? false,
    rpe,
  }));
}

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-14T09:00:00.000Z');
/** An earlier session `daysBefore` days before NOW. */
function session(id: string, daysBefore: number, rows: S[]): TrendSessionInput {
  return { id, started_at: new Date(NOW - daysBefore * DAY).toISOString(), sets: sets(id, rows) };
}

/**
 * The worked history, newest first (volume / mean RPE / load per rep):
 *   h1  5×100 @8, 5×100 @8             → 1000 / 8    / 100
 *   e   (empty finish)                  → excluded
 *   h2  10×60 @7                        → 600  / 7    / 60
 *   h3  pull-ups 10 reps, no load @9    → 0    / 9    / null
 *   h4  5×120 (no RPE)                  → 600  / null / 120
 *   h5  warm-up 10×20 @5, 8×50, 8×50    → 800  / null / 50   (the warm-up's RPE is ignored)
 *   h6  3×100 @9                        → 300  / 9    / 100
 */
const H1 = session('h1', 1, [[5, 100, 8], [5, 100, 8]]);
const E = session('e', 2, []);
const H2 = session('h2', 3, [[10, 60, 7]]);
const H3 = session('h3', 4, [[10, null, 9]]);
const H4 = session('h4', 5, [[5, 120, null]]);
const H5 = session('h5', 6, [[10, 20, 5, true], [8, 50, null], [8, 50, null]]);
const H6 = session('h6', 7, [[3, 100, 9]]);
const HISTORY = [H1, E, H2, H3, H4, H5, H6];

/** The analyzed session: 5×110 @8.5 and 5×110 @9 → 1100 kg, RPE 8.75, 110 kg/rep. */
function input(history: readonly TrendSessionInput[], started = NOW, ownSets = sets('w', [[5, 110, 8.5], [5, 110, 9]])): AnalysisInput {
  return {
    workout: {
      id: 'w',
      user_id: 'u',
      started_at: new Date(started).toISOString(),
      ended_at: new Date(started + 3_600_000).toISOString(),
      updated_at: new Date(started + 3_600_000).toISOString(),
    },
    entries: [{ id: 'w-e', exercise_id: 'x', position: 0 }],
    sets: ownSets,
    records: [],
    exerciseNames: {},
    history,
  };
}

describe('sessionMeasures', () => {
  it('volume, mean RPE over non-warm-up sets, and load per rep over the loaded sets', () => {
    expect(sessionMeasures(H5.sets)).toEqual({ volume_kg: 800, rpe_avg: null, load_per_rep_kg: 50 });
    expect(sessionMeasures(H3.sets)).toEqual({ volume_kg: 0, rpe_avg: 9, load_per_rep_kg: null });
    expect(sessionMeasures(sets('x', [[5, 110, 8.5], [5, 110, 9]]))).toEqual({ volume_kg: 1100, rpe_avg: 8.75, load_per_rep_kg: 110 });
  });

  it('ignores an out-of-range or non-finite RPE (a device leftover) instead of averaging it', () => {
    expect(sessionMeasures(sets('x', [[5, 100, 11], [5, 100, 0], [5, 100, Number.NaN], [5, 100, 7]])).rpe_avg).toBe(7);
  });

  it('rounds RPE to 2 decimals and kg to 3, like the stored columns', () => {
    // RPEs 7, 7, 8 → 7.3333… → 7.33. Load: (5×100 + 5×100 + 5×101) / 15 = 100.3333… → 100.333.
    expect(sessionMeasures(sets('x', [[5, 100, 7], [5, 100, 7], [5, 101, 8]]))).toEqual({
      volume_kg: 1505,
      rpe_avg: 7.33,
      load_per_rep_kg: 100.333,
    });
  });

  it('an empty session has volume 0 and neither intensity measure', () => {
    expect(sessionMeasures([])).toEqual({ volume_kg: 0, rpe_avg: null, load_per_rep_kg: null });
  });
});

describe('trendHistory', () => {
  it('newest first, empty finishes dropped, at most the window', () => {
    expect(trendHistory({ id: 'w', started_at: new Date(NOW).toISOString() }, [...HISTORY].reverse()).map((h) => h.id)).toEqual([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
    ]);
    const many = Array.from({ length: 15 }, (_, i) => session(`m${String(i).padStart(2, '0')}`, i + 1, [[1, 1, null]]));
    expect(trendHistory({ id: 'w', started_at: new Date(NOW).toISOString() }, many)).toHaveLength(TREND_WINDOW_SESSIONS);
  });

  it('only sessions strictly before the workout: a same-instant tie goes by id, later ones never count', () => {
    const at = new Date(NOW).toISOString();
    const tieLow = { id: 'a', started_at: at, sets: H1.sets };
    const tieHigh = { id: 'z', started_at: at, sets: H1.sets };
    const later = { id: 'b', started_at: new Date(NOW + DAY).toISOString(), sets: H1.sets };
    const self = { id: 'w', started_at: at, sets: H1.sets };
    expect(trendHistory({ id: 'w', started_at: at }, [tieHigh, later, self, tieLow]).map((h) => h.id)).toEqual(['a']);
  });

  it('compares instants, not text: "…Z" and "…+00:00" stamps sort by the moment they name', () => {
    // 09:00:00.500Z is after 09:00:00+00:00 although "+" sorts before "." as text.
    const older = { id: 'older', started_at: '2026-11-13T09:00:00+00:00', sets: H1.sets };
    const newer = { id: 'newer', started_at: '2026-11-13T09:00:00.500Z', sets: H1.sets };
    const micro = { id: 'micro', started_at: '2026-11-13T09:00:00.700123+00:00', sets: H1.sets };
    expect(trendHistory({ id: 'w', started_at: new Date(NOW).toISOString() }, [older, newer, micro]).map((h) => h.id)).toEqual([
      'micro',
      'newer',
      'older',
    ]);
  });

  it('considers only the newest TREND_SCAN_LIMIT candidates: a long run of empty finishes thins the window', () => {
    const empties = Array.from({ length: TREND_SCAN_LIMIT - 2 }, (_, i) => session(`e${i}`, (i + 1) / 100, []));
    const real = [5, 6, 7].map((d) => session(`r${d}`, d, [[1, 1, null]]));
    // 38 empties + 3 real: only the first 40 newest are scanned, so r7 (the 41st) is out.
    expect(trendHistory({ id: 'w', started_at: new Date(NOW).toISOString() }, [...empties, ...real]).map((h) => h.id)).toEqual([
      'r5',
      'r6',
    ]);
  });
});

describe('buildTrend', () => {
  it('above the threshold: the averages match the history worked by hand', () => {
    // 6 qualifying sessions. Volume (1000 + 600 + 0 + 600 + 800 + 300) / 6 = 550.
    // RPE over h1, h2, h3, h6: (8 + 7 + 9 + 9) / 4 = 8.25. Load per rep over h1, h2, h4, h5, h6:
    // (100 + 60 + 120 + 50 + 100) / 5 = 86.
    expect(buildTrend(input(HISTORY))).toEqual({
      trend_sessions: 6,
      trend_volume_avg_kg: 550,
      trend_rpe_avg: 8.25,
      trend_load_per_rep_avg_kg: 86,
      session_rpe_avg: 8.75,
      session_load_per_rep_kg: 110,
    });
  });

  it('exactly at the threshold (5 qualifying; the empty finish does not count toward it)', () => {
    // Without h6: 6 candidates, 5 qualifying. Volume (1000 + 600 + 0 + 600 + 800) / 5 = 600.
    // RPE over h1, h2, h3: (8 + 7 + 9) / 3 = 8. Load over h1, h2, h4, h5: (100 + 60 + 120 + 50) / 4 = 82.5.
    expect(TREND_MIN_SESSIONS).toBe(5);
    expect(buildTrend(input([H1, E, H2, H3, H4, H5]))).toEqual({
      trend_sessions: 5,
      trend_volume_avg_kg: 600,
      trend_rpe_avg: 8,
      trend_load_per_rep_avg_kg: 82.5,
      session_rpe_avg: 8.75,
      session_load_per_rep_kg: 110,
    });
  });

  it('below the threshold (4 qualifying): every trend field null, the session’s own measures kept', () => {
    expect(buildTrend(input([H1, E, H2, H3, H4]))).toEqual({
      trend_sessions: null,
      trend_volume_avg_kg: null,
      trend_rpe_avg: null,
      trend_load_per_rep_avg_kg: null,
      session_rpe_avg: 8.75,
      session_load_per_rep_kg: 110,
    });
    expect(buildTrend(input([])).trend_sessions).toBeNull();
  });

  it('an intensity average needs 3 sessions that have it — fewer and that arm is null, volume stays', () => {
    // RPE only on h1 and h2 here; load per rep on all five.
    const noRpe = (h: TrendSessionInput) => ({ ...h, sets: h.sets.map((s) => ({ ...s, rpe: null })) });
    const history = [H1, H2, noRpe(H4), noRpe(H5), noRpe(H6)];
    const trend = buildTrend(input(history));
    expect(trend.trend_sessions).toBe(5);
    expect(trend.trend_rpe_avg).toBeNull();
    expect(trend.trend_load_per_rep_avg_kg).toBe(86); // (100 + 60 + 120 + 50 + 100) / 5
  });

  it('works with no RPE anywhere (LOG-10 "still works when absent")', () => {
    const strip = (h: TrendSessionInput) => ({ ...h, sets: h.sets.map((s) => ({ ...s, rpe: null })) });
    const trend = buildTrend(input(HISTORY.map(strip), NOW, sets('w', [[5, 110, null], [5, 110, null]])));
    expect(trend).toEqual({
      trend_sessions: 6,
      trend_volume_avg_kg: 550,
      trend_rpe_avg: null,
      trend_load_per_rep_avg_kg: 86,
      session_rpe_avg: null,
      session_load_per_rep_kg: 110,
    });
  });

  it('re-analyzing an old workout compares it with the sessions before IT, not with later ones', () => {
    // Analyze as if started 3.5 days ago: only h3..h6 (4) came before → below the threshold.
    expect(buildTrend(input(HISTORY, NOW - 3.5 * DAY)).trend_sessions).toBeNull();
  });

  it('only the analyzed workout’s own slots count toward its measures', () => {
    const stray = { ...sets('x', [[100, 100, 10]])[0], workout_exercise_id: 'other-slot' };
    expect(buildTrend(input([], NOW, [...sets('w', [[5, 110, 8.5], [5, 110, 9]]), stray]))).toMatchObject({
      session_rpe_avg: 8.75,
      session_load_per_rep_kg: 110,
    });
  });

  it('is deterministic whatever order the reader returned the candidates in', () => {
    expect(buildTrend(input([...HISTORY].reverse()))).toEqual(buildTrend(input(HISTORY)));
  });
});
