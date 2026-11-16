/**
 * Fixture tests for the `analyze-workout` server function (B18's step definition of done:
 * "edge-function tests use fixtures"). Each fixture is a whole workout as the database would
 * hold it; the expected numbers are worked out by hand in the comments, and the FULL stored
 * analysis — numbers and copy state — is pinned. The database is an in-memory fake standing in
 * for the caller's row-level-security view; nothing touches the real project.
 */
import { describe, expect, it } from '@jest/globals';

import { handleAnalyzeRequest, workoutIdOf, type AnalyzeDeps, type StoredAnalysisRow } from '../analyze-workout/handler.ts';
import {
  ANALYSIS_ENGINE_VERSION,
  NOT_MEDICAL_ADVICE,
  pickCopy,
  type AnalysisEntry,
  type AnalysisRecord,
  type AnalysisSet,
  type AnalysisWorkout,
  type TrendSessionInput,
  type WorkoutAnalysis,
} from '../_shared/analysis/index.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const BENCH = 'e0000000-0000-4000-8000-00000000000b';
const SQUAT = 'e0000000-0000-4000-8000-00000000000c';
const PULLUP = 'e0000000-0000-4000-8000-00000000000d';
const NAMES: Record<string, string> = { [BENCH]: 'Bench Press', [SQUAT]: 'Squat', [PULLUP]: 'Pullups' };

/** One fixture: a workout and everything the caller can see of it. */
interface Fixture {
  workout: AnalysisWorkout;
  entries: AnalysisEntry[];
  sets: AnalysisSet[];
  records: AnalysisRecord[];
}

/** A workout id per fixture number. */
const wid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function workout(n: number, minutes: number, endedAt: string | null = 'auto'): AnalysisWorkout {
  const start = Date.parse('2026-11-14T09:00:00.000Z');
  return {
    id: wid(n),
    user_id: USER,
    started_at: new Date(start).toISOString(),
    ended_at: endedAt === 'auto' ? new Date(start + minutes * 60_000).toISOString() : endedAt,
    updated_at: '2026-11-14T11:00:00.000000+00:00',
  };
}

function entry(n: number, slot: number, exerciseId: string): AnalysisEntry {
  return { id: `b${n}000000-0000-4000-8000-00000000000${slot}`, exercise_id: exerciseId, position: slot };
}

function set(e: AnalysisEntry, position: number, reps: number | null, weightKg: number | null, warm = false): AnalysisSet {
  return { id: `${e.id.slice(0, 34)}${position}${position}`, workout_exercise_id: e.id, position, reps, weight_kg: weightKg, is_warmup: warm, rpe: null };
}

/** Fixture 1 — multi-exercise weighted session. */
const f1 = (() => {
  const bench = entry(1, 0, BENCH);
  const squat = entry(1, 1, SQUAT);
  return {
    workout: workout(1, 62.5),
    entries: [bench, squat],
    // Bench: warm-up 10×20 (0) + 5×80 (400) + 5×80 (400); squat: 5×100 (500) + 3×110 (330).
    sets: [set(bench, 0, 10, 20, true), set(bench, 1, 5, 80), set(bench, 2, 5, 80), set(squat, 0, 5, 100), set(squat, 1, 3, 110)],
    records: [],
  } satisfies Fixture;
})();

/** Fixture 2 — a PR session: two records cite its sets; one belongs to an older workout. */
const f2 = (() => {
  const squat = entry(2, 0, SQUAT);
  const sets = [set(squat, 0, 1, 180), set(squat, 1, 5, 150)];
  return {
    workout: workout(2, 45),
    entries: [squat],
    sets,
    records: [
      { exercise_id: SQUAT, kind: 'repMax', reps: 5, value_kg: 150, source_set_id: sets[1].id },
      { exercise_id: SQUAT, kind: 'true1rm', reps: null, value_kg: 180, source_set_id: sets[0].id },
    ],
  } satisfies Fixture;
})();

/** Fixture 3 — warm-ups only. */
const f3 = (() => {
  const bench = entry(3, 0, BENCH);
  return { workout: workout(3, 10), entries: [bench], sets: [set(bench, 0, 10, 20, true), set(bench, 1, 8, 40, true)], records: [] } satisfies Fixture;
})();

/** Fixture 4 — bodyweight only (pull-ups with no added weight). */
const f4 = (() => {
  const pullups = entry(4, 0, PULLUP);
  return { workout: workout(4, 20), entries: [pullups], sets: [set(pullups, 0, 10, null), set(pullups, 1, 8, null)], records: [] } satisfies Fixture;
})();

/** Fixture 5 — timed / scored work only (no reps, no weight on record). */
const f5 = (() => {
  const wod = entry(5, 0, SQUAT);
  return { workout: workout(5, 25), entries: [wod], sets: [set(wod, 0, null, null), set(wod, 1, null, null)], records: [] } satisfies Fixture;
})();

/** Fixture 6 — finished with nothing logged. */
const f6: Fixture = { workout: workout(6, 3), entries: [], sets: [], records: [] };

/** Fixture 7 — still in progress. */
const f7: Fixture = { workout: workout(7, 0, null), entries: [], sets: [], records: [] };

const FIXTURES = [f1, f2, f3, f4, f5, f6, f7];

/** A fake database holding the fixtures, recording every save. */
function fakeDeps(visible: readonly Fixture[] = FIXTURES, history: readonly TrendSessionInput[] = []) {
  const saved = new Map<string, StoredAnalysisRow>();
  const saves: WorkoutAnalysis[] = [];
  const historyReads: AnalysisWorkout[] = [];
  let clock = 0;
  const deps: AnalyzeDeps = {
    readHistory: async (w) => {
      historyReads.push(w);
      return [...history];
    },
    readWorkout: async (id) => visible.find((f) => f.workout.id === id)?.workout ?? null,
    readEntries: async (id) => visible.find((f) => f.workout.id === id)?.entries ?? [],
    readSets: async (ids) => visible.flatMap((f) => f.sets).filter((s) => ids.includes(s.workout_exercise_id)),
    readRecords: async (ids) => visible.flatMap((f) => f.records).filter((r) => ids.includes(r.source_set_id)),
    readExerciseNames: async (ids) => Object.fromEntries(ids.filter((id) => NAMES[id]).map((id) => [id, NAMES[id]])),
    saveAnalysis: async (analysis) => {
      saves.push(analysis);
      clock += 1;
      const stamp = `2026-11-14T12:00:0${clock}.000000+00:00`;
      const row = { ...analysis, created_at: saved.get(analysis.id)?.created_at ?? stamp, updated_at: stamp };
      saved.set(analysis.id, row);
      return row;
    },
  };
  return { deps, saved, saves, historyReads };
}

/**
 * The expected stored analysis for a fixture, from hand-worked numbers. These fixtures carry no
 * RPE and no history, so the trend is absent; `loadPerRep` is the session's volume ÷ loaded reps.
 */
function expected(
  f: Fixture,
  numbers: Pick<WorkoutAnalysis, 'total_volume_kg' | 'total_sets' | 'working_sets' | 'duration_seconds' | 'new_prs'>,
  loadPerRep: number | null = null,
) {
  const copy = pickCopy(numbers);
  return {
    id: f.workout.id,
    user_id: USER,
    engine_version: ANALYSIS_ENGINE_VERSION,
    ...numbers,
    headline: copy.headline,
    message: copy.message,
    workout_updated_at: f.workout.updated_at,
    trend_sessions: null,
    trend_volume_avg_kg: null,
    trend_rpe_avg: null,
    trend_load_per_rep_avg_kg: null,
    session_rpe_avg: null,
    session_load_per_rep_kg: loadPerRep,
  };
}

async function analyze(f: Fixture) {
  const { deps } = fakeDeps();
  const response = await handleAnalyzeRequest({ workoutId: f.workout.id }, USER, deps);
  if (response.status !== 200) throw new Error(`unexpected ${response.status}`);
  const { created_at: _c, updated_at: _u, ...analysis } = response.body;
  return analysis;
}

describe('analyze-workout fixtures', () => {
  it('1: a multi-exercise weighted session', async () => {
    expect(await analyze(f1)).toEqual(
      // Load per rep: 1630 kg over 5 + 5 + 5 + 3 = 18 loaded reps = 90.5555… → 90.556.
      expected(f1, { total_volume_kg: 1630, total_sets: 5, working_sets: 4, duration_seconds: 3750, new_prs: [] }, 90.556),
    );
    expect(pickCopy({ new_prs: [], total_volume_kg: 1630, total_sets: 5 }).state).toBe('weighted');
  });

  it('2: a PR session lists the records its sets hold, in lifting order', async () => {
    // 180 + 5×150 = 930 kg.
    const analysis = await analyze(f2);
    expect(analysis).toEqual(
      expected(f2, {
        total_volume_kg: 930,
        total_sets: 2,
        working_sets: 2,
        duration_seconds: 2700,
        new_prs: [
          { exercise_id: SQUAT, exercise_name: 'Squat', kind: 'true1rm', reps: null, value_kg: 180 },
          { exercise_id: SQUAT, exercise_name: 'Squat', kind: 'repMax', reps: 5, value_kg: 150 },
        ],
      }, 155), // 930 kg over 6 reps
    );
    expect(analysis.headline).toBe('2 new personal records!');
  });

  it('3: warm-ups only — sets counted, no volume, the "work is work" state', async () => {
    const analysis = await analyze(f3);
    expect(analysis).toEqual(expected(f3, { total_volume_kg: 0, total_sets: 2, working_sets: 0, duration_seconds: 600, new_prs: [] }));
    expect(analysis.headline).toBe('Work is work');
  });

  it('4: bodyweight only — a complete session, not a failed weighted one', async () => {
    const analysis = await analyze(f4);
    expect(analysis).toEqual(expected(f4, { total_volume_kg: 0, total_sets: 2, working_sets: 2, duration_seconds: 1200, new_prs: [] }));
    expect(analysis.headline).toBe('Work is work');
  });

  it('5: timed / scored work only', async () => {
    const analysis = await analyze(f5);
    expect(analysis).toEqual(expected(f5, { total_volume_kg: 0, total_sets: 2, working_sets: 2, duration_seconds: 1500, new_prs: [] }));
    expect(analysis.headline).toBe('Work is work');
  });

  it('6: an empty finish gets gentle "showing up counts" copy', async () => {
    const analysis = await analyze(f6);
    expect(analysis).toEqual(expected(f6, { total_volume_kg: 0, total_sets: 0, working_sets: 0, duration_seconds: 180, new_prs: [] }));
    expect(analysis.headline).toBe('You showed up');
  });

  it('7: an unfinished workout is refused with 422 and nothing saved', async () => {
    const { deps, saves } = fakeDeps();
    expect(await handleAnalyzeRequest({ workoutId: f7.workout.id }, USER, deps)).toEqual({
      status: 422,
      body: { error: 'Only finished workouts are analyzed' },
    });
    expect(saves).toEqual([]);
  });

  it('the statement every analysis screen shows is exported for it', () => {
    expect(NOT_MEDICAL_ADVICE).toMatch(/not medical advice/);
  });
});

describe('analyze-workout requests', () => {
  it('a workout the caller cannot see (another user’s, or missing) is 404, nothing saved', async () => {
    const { deps, saves } = fakeDeps([f2]); // the caller's RLS view holds only fixture 2
    expect(await handleAnalyzeRequest({ workoutId: f1.workout.id }, USER, deps)).toEqual({ status: 404, body: { error: 'Workout not found' } });
    expect(saves).toEqual([]);
  });

  it('another user’s PUBLIC workout (visible to the caller under RLS) is still 404, nothing saved', async () => {
    // RLS lets a follower or anyone read a public workout — but never its owner's records, so
    // an analysis made by someone else would wrongly overwrite the owner's.
    const { deps, saves } = fakeDeps();
    expect(await handleAnalyzeRequest({ workoutId: f2.workout.id }, '22222222-2222-4222-8222-222222222222', deps)).toEqual({
      status: 404,
      body: { error: 'Workout not found' },
    });
    expect(saves).toEqual([]);
  });

  it('a body without a workout id is 400', async () => {
    const { deps } = fakeDeps();
    for (const body of [null, 'x', {}, { workoutId: 42 }, { workoutId: 'not-a-uuid' }]) {
      expect((await handleAnalyzeRequest(body, USER, deps)).status).toBe(400);
    }
    expect(workoutIdOf({ workoutId: f1.workout.id })).toBe(f1.workout.id);
  });

  it('asking twice keeps exactly one analysis per workout; a repeat replaces it, keeping created_at', async () => {
    const { deps, saved } = fakeDeps();
    const first = await handleAnalyzeRequest({ workoutId: f1.workout.id }, USER, deps);
    const second = await handleAnalyzeRequest({ workoutId: f1.workout.id }, USER, deps);
    expect(saved.size).toBe(1);
    if (first.status !== 200 || second.status !== 200) throw new Error('expected 200s');
    expect(second.body.created_at).toBe(first.body.created_at);
    const { created_at: _a, updated_at: _b, ...one } = first.body;
    const { created_at: _c, updated_at: _d, ...two } = second.body;
    expect(two).toEqual(one);
  });

  it('the owner comes from the workout row read as the caller, never from the request', async () => {
    const { deps, saves } = fakeDeps();
    await handleAnalyzeRequest({ workoutId: f1.workout.id, user_id: 'someone-else' }, USER, deps);
    expect(saves[0].user_id).toBe(USER);
  });
});

describe('analyze-workout trend (B42)', () => {
  /** An earlier session `hoursBefore` fixture 1 started, with one set per [reps, kg, rpe]. */
  function earlier(n: number, hoursBefore: number, sets: [number | null, number | null, number | null][]): TrendSessionInput {
    const id = wid(100 + n);
    return {
      id,
      started_at: new Date(Date.parse(f1.workout.started_at) - hoursBefore * 3_600_000).toISOString(),
      sets: sets.map(([reps, kg, rpe], i) => ({
        id: `${id.slice(0, 34)}${i}${i}`,
        workout_exercise_id: `${id}-slot`,
        position: i,
        reps,
        weight_kg: kg,
        is_warmup: false,
        rpe,
      })),
    };
  }

  it('hands the workout to readHistory and stores the trend computed from what it returned', async () => {
    // Five earlier sessions with volumes 500, 600, 700, 800, 900 → average 700. Fixture 1 has
    // 1630 kg, so the screen will say about 133% more. No RPE anywhere: the RPE arm stays null,
    // load per rep (each 100 kg/rep: 5×100, 6×100, …) averages 100.
    const history = [5, 6, 7, 8, 9].map((reps, i) => earlier(i, 24 * (i + 1), [[reps, 100, null]]));
    const { deps, historyReads } = fakeDeps(FIXTURES, history);
    const response = await handleAnalyzeRequest({ workoutId: f1.workout.id }, USER, deps);
    if (response.status !== 200) throw new Error('expected 200');
    expect(historyReads).toEqual([f1.workout]);
    expect(response.body).toMatchObject({
      trend_sessions: 5,
      trend_volume_avg_kg: 700,
      trend_rpe_avg: null,
      trend_load_per_rep_avg_kg: 100,
      session_rpe_avg: null,
      session_load_per_rep_kg: 90.556,
    });
  });

  it('four earlier sessions are below the threshold: every trend column is null', async () => {
    const history = [5, 6, 7, 8].map((reps, i) => earlier(i, 24 * (i + 1), [[reps, 100, 8]]));
    const { deps } = fakeDeps(FIXTURES, history);
    const response = await handleAnalyzeRequest({ workoutId: f1.workout.id }, USER, deps);
    if (response.status !== 200) throw new Error('expected 200');
    expect(response.body).toMatchObject({
      trend_sessions: null,
      trend_volume_avg_kg: null,
      trend_rpe_avg: null,
      trend_load_per_rep_avg_kg: null,
    });
  });

  it('refused requests never read history', async () => {
    const { deps, historyReads } = fakeDeps();
    await handleAnalyzeRequest({ workoutId: f7.workout.id }, USER, deps);
    await handleAnalyzeRequest({ workoutId: f1.workout.id }, '22222222-2222-4222-8222-222222222222', deps);
    expect(historyReads).toEqual([]);
  });
});
