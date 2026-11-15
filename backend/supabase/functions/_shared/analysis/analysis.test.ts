// Tests for analysis.ts — the one call combining summary, copy and the rules version.
import { describe, expect, it } from '@jest/globals';

import { ANALYSIS_ENGINE_VERSION, buildAnalysis } from './analysis.ts';
import { pickCopy } from './copy.ts';
import { buildSummary, type AnalysisInput } from './summary.ts';

const INPUT: AnalysisInput = {
  workout: {
    id: 'w1',
    user_id: 'u1',
    started_at: '2026-11-14T09:00:00.000Z',
    ended_at: '2026-11-14T09:30:00.000Z',
    updated_at: '2026-11-14T09:30:01.000Z',
  },
  entries: [{ id: 'e1', exercise_id: 'x', position: 0 }],
  sets: [{ id: 's1', workout_exercise_id: 'e1', position: 0, reps: 5, weight_kg: 100, is_warmup: false }],
  records: [],
  exerciseNames: { x: 'Squat' },
};

describe('buildAnalysis', () => {
  it('is the summary plus its copy, keyed by the workout, stamped with the rules version', () => {
    const analysis = buildAnalysis(INPUT);
    const summary = buildSummary(INPUT);
    const copy = pickCopy(summary);
    expect(analysis).toEqual({
      id: 'w1',
      user_id: 'u1',
      engine_version: ANALYSIS_ENGINE_VERSION,
      ...summary,
      headline: copy.headline,
      message: copy.message,
      workout_updated_at: '2026-11-14T09:30:01.000Z',
    });
    expect(ANALYSIS_ENGINE_VERSION).toBe(1);
  });

  it('is deterministic: the same rows twice give identical analyses', () => {
    expect(buildAnalysis(INPUT)).toEqual(buildAnalysis(structuredClone(INPUT)));
  });
});
