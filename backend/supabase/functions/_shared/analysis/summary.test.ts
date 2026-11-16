// Tests for summary.ts — the analysis numbers (ANA-2), each checked against hand-worked values.
import { describe, expect, it } from '@jest/globals';

import { buildSummary, timestampMs, type AnalysisInput, type AnalysisSet } from './summary.ts';

const W = 'a0000000-0000-4000-8000-000000000001';
const E1 = 'b0000000-0000-4000-8000-000000000001';
const E2 = 'b0000000-0000-4000-8000-000000000002';

function set(id: string, entry: string, position: number, reps: number | null, weight: number | null, warm = false): AnalysisSet {
  return { id, workout_exercise_id: entry, position, reps, weight_kg: weight, is_warmup: warm, rpe: null };
}

function input(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    workout: {
      id: W,
      user_id: 'u',
      started_at: '2026-11-14T09:00:00.000Z',
      ended_at: '2026-11-14T10:02:03.900Z',
      updated_at: '2026-11-14T10:02:04.000Z',
    },
    entries: [
      { id: E1, exercise_id: 'bench', position: 0 },
      { id: E2, exercise_id: 'squat', position: 1 },
    ],
    sets: [],
    records: [],
    exerciseNames: { bench: 'Bench Press', squat: 'Squat' },
    history: [],
    ...overrides,
  };
}

describe('buildSummary', () => {
  it('adds volume over work sets only and counts every set, warm-ups separately', () => {
    const summary = buildSummary(
      input({
        sets: [
          set('s1', E1, 0, 10, 20, true), // warm-up: counted as a set, adds no volume
          set('s2', E1, 1, 5, 100), // 500
          set('s3', E1, 2, 5, 102.5), // 512.5
          set('s4', E2, 0, 8, null), // bodyweight: 0
          set('s5', E2, 1, 3, 140.123), // 420.369
        ],
      }),
    );
    expect(summary.total_volume_kg).toBe(1432.869);
    expect(summary.total_sets).toBe(5);
    expect(summary.working_sets).toBe(4);
  });

  it('rounds volume to the server column’s 3 decimals', () => {
    // 3 × 0.1 kg is 0.30000000000000004 in floating point.
    const summary = buildSummary(input({ sets: [set('s1', E1, 0, 3, 0.1)] }));
    expect(summary.total_volume_kg).toBe(0.3);
  });

  it('measures duration in whole seconds from start to end, never negative', () => {
    expect(buildSummary(input()).duration_seconds).toBe(3723);
    const backwards = input();
    backwards.workout = { ...backwards.workout, ended_at: '2026-11-14T08:00:00.000Z' };
    expect(buildSummary(backwards).duration_seconds).toBe(0);
  });

  it('reads server timestamps with microseconds and offsets', () => {
    const server = input();
    server.workout = {
      ...server.workout,
      started_at: '2026-11-14T09:00:00.123456+00:00',
      ended_at: '2026-11-14T09:45:00.123999+00:00',
    };
    expect(buildSummary(server).duration_seconds).toBe(2700);
    expect(timestampMs('2026-11-14T09:00:00.123456+00:00')).toBe(Date.parse('2026-11-14T09:00:00.123Z'));
  });

  it('lists the records citing this workout’s sets, in lifting order, with names snapshotted', () => {
    const summary = buildSummary(
      input({
        sets: [set('s1', E1, 0, 1, 140), set('s2', E1, 1, 5, 110), set('s3', E2, 0, 5, 180)],
        records: [
          { exercise_id: 'squat', kind: 'repMax', reps: 5, value_kg: 180, source_set_id: 's3' },
          { exercise_id: 'bench', kind: 'repMax', reps: 5, value_kg: 110, source_set_id: 's2' },
          { exercise_id: 'bench', kind: 'e1rm', reps: null, value_kg: 146.667, source_set_id: 's2' },
          { exercise_id: 'bench', kind: 'true1rm', reps: null, value_kg: 140, source_set_id: 's1' },
          // Cites a set from another workout: ignored.
          { exercise_id: 'bench', kind: 'repMax', reps: 3, value_kg: 120, source_set_id: 'elsewhere' },
        ],
      }),
    );
    expect(summary.new_prs).toEqual([
      { exercise_id: 'bench', exercise_name: 'Bench Press', kind: 'true1rm', reps: null, value_kg: 140 },
      { exercise_id: 'bench', exercise_name: 'Bench Press', kind: 'e1rm', reps: null, value_kg: 146.667 },
      { exercise_id: 'bench', exercise_name: 'Bench Press', kind: 'repMax', reps: 5, value_kg: 110 },
      { exercise_id: 'squat', exercise_name: 'Squat', kind: 'repMax', reps: 5, value_kg: 180 },
    ]);
  });

  it('gives the same answer whatever order the rows arrive in (server and phone agree)', () => {
    const sets = [set('s1', E1, 0, 5, 100), set('s2', E1, 1, 5, 105), set('s3', E2, 0, 3, 150)];
    const records = [
      { exercise_id: 'squat', kind: 'repMax' as const, reps: 3, value_kg: 150, source_set_id: 's3' },
      { exercise_id: 'bench', kind: 'repMax' as const, reps: 5, value_kg: 105, source_set_id: 's2' },
    ];
    const a = buildSummary(input({ sets, records }));
    const b = buildSummary(input({ sets: [...sets].reverse(), records: [...records].reverse(), entries: [...input().entries].reverse() }));
    expect(b).toEqual(a);
  });

  it('names a record of a deleted exercise null, and ignores sets outside the workout’s slots', () => {
    const summary = buildSummary(
      input({
        sets: [set('s1', E1, 0, 5, 100), set('stray', 'not-a-slot', 0, 5, 1000)],
        records: [{ exercise_id: 'bench', kind: 'repMax', reps: 5, value_kg: 100, source_set_id: 's1' }],
        exerciseNames: {},
      }),
    );
    expect(summary.total_volume_kg).toBe(500);
    expect(summary.total_sets).toBe(1);
    expect(summary.new_prs[0].exercise_name).toBeNull();
  });

  it('refuses an unfinished workout', () => {
    const unfinished = input();
    unfinished.workout = { ...unfinished.workout, ended_at: null };
    expect(() => buildSummary(unfinished)).toThrow('not finished');
  });
});
