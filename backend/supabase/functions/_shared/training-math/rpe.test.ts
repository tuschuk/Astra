// Tests for rpe.ts — the Epley-derived RPE chart and working-weight suggestions.
import { describe, expect, it } from '@jest/globals';

import { epleyE1rm } from './e1rm.ts';
import { isChartRpe, MAX_RPE, MAX_RPE_REPS, MIN_RPE, percentOfOneRm, workingWeightFromRpe } from './rpe.ts';

describe('isChartRpe', () => {
  it('accepts 6 to 10 in half steps and nothing else', () => {
    for (const rpe of [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]) expect(isChartRpe(rpe)).toBe(true);
    for (const rpe of [5.5, 7.3, 10.5, 0, Number.NaN, Number.POSITIVE_INFINITY]) expect(isChartRpe(rpe)).toBe(false);
  });
});

describe('percentOfOneRm', () => {
  it('gives 100% for 1 rep at RPE 10', () => {
    expect(percentOfOneRm(1, 10)).toBe(100);
  });

  it('matches hand-computed chart cells', () => {
    // 5 @ 8 → 7 all-out reps → 100 / (1 + 7/30)
    expect(percentOfOneRm(5, 8)).toBeCloseTo(81.0811, 4);
    // 1 @ 9 → 2 all-out reps → 100 / (1 + 2/30)
    expect(percentOfOneRm(1, 9)).toBeCloseTo(93.75, 10);
    // 3 @ 9.5 → 3.5 all-out reps
    expect(percentOfOneRm(3, 9.5)).toBeCloseTo(89.5522, 4);
    // 12 @ 6 → 16 all-out reps
    expect(percentOfOneRm(12, 6)).toBeCloseTo(65.2174, 4);
  });

  it('falls as reps rise or RPE drops, across the whole grid', () => {
    for (let reps = 1; reps <= MAX_RPE_REPS; reps++) {
      for (let rpe = MIN_RPE; rpe <= MAX_RPE; rpe += 0.5) {
        const pct = percentOfOneRm(reps, rpe);
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThanOrEqual(100);
        if (reps > 1) expect(pct).toBeLessThan(percentOfOneRm(reps - 1, rpe));
        if (rpe > MIN_RPE) expect(pct).toBeGreaterThan(percentOfOneRm(reps, rpe - 0.5));
      }
    }
  });

  it('rejects reps or RPE outside the chart', () => {
    expect(() => percentOfOneRm(0, 8)).toThrow(RangeError);
    expect(() => percentOfOneRm(13, 8)).toThrow(RangeError);
    expect(() => percentOfOneRm(2.5, 8)).toThrow(RangeError);
    expect(() => percentOfOneRm(5, 5.5)).toThrow(RangeError);
    expect(() => percentOfOneRm(5, 10.5)).toThrow(RangeError);
    expect(() => percentOfOneRm(5, 8.25)).toThrow(RangeError);
    expect(() => percentOfOneRm(5, NaN)).toThrow(RangeError);
  });
});

describe('workingWeightFromRpe', () => {
  it('turns a 1RM and reps/RPE into a working weight', () => {
    expect(workingWeightFromRpe(150, 5, 8)).toBeCloseTo(121.6216, 4);
    expect(workingWeightFromRpe(200, 1, 10)).toBe(200);
  });

  it('is self-consistent with Epley: an all-out set at the suggestion gives back the 1RM', () => {
    for (let reps = 2; reps <= MAX_RPE_REPS; reps++) {
      expect(epleyE1rm(workingWeightFromRpe(150, reps, 10), reps)).toBeCloseTo(150, 10);
    }
  });

  it('rejects a zero 1RM', () => {
    expect(() => workingWeightFromRpe(0, 5, 8)).toThrow(RangeError);
  });
});
