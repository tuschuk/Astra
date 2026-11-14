// Tests for e1rm.ts — Epley estimates, the single-rep rule, and the inversion.
import { describe, expect, it } from '@jest/globals';

import { MAX_EPLEY_REPS, epleyE1rm, epleyMultiplier, weightForReps } from './e1rm.ts';
import { displayWeight, lbToKg } from './units.ts';

describe('epleyE1rm', () => {
  it('applies weight × (1 + reps ÷ 30) for 2+ reps', () => {
    expect(epleyE1rm(100, 5)).toBeCloseTo(116.6667, 4);
    expect(epleyE1rm(100, 10)).toBeCloseTo(133.3333, 4);
    expect(epleyE1rm(140, 3)).toBeCloseTo(154, 10);
    expect(epleyE1rm(60, 30)).toBeCloseTo(120, 10);
  });

  it('returns the weight itself for a single — a lifted single is the 1RM', () => {
    expect(epleyE1rm(100, 1)).toBe(100);
    expect(epleyE1rm(182.5, 1)).toBe(182.5);
  });

  it('gives the estimate in the lifter’s unit via displayWeight', () => {
    // 225 lb × 3, entered in lb, stored in kg, shown in lb: 225 × 1.1 = 247.5 lb.
    const e1rmKg = epleyE1rm(lbToKg(225), 3);
    expect(displayWeight(e1rmKg, 'lb')).toBe(247.5);
    expect(displayWeight(e1rmKg, 'kg')).toBe(112.3);
  });

  it('rejects reps outside 1–30 or fractional reps', () => {
    expect(() => epleyE1rm(100, 0)).toThrow(RangeError);
    expect(() => epleyE1rm(100, MAX_EPLEY_REPS + 1)).toThrow(RangeError);
    expect(() => epleyE1rm(100, 2.5)).toThrow(RangeError);
  });

  it('rejects a zero, negative or non-numeric weight', () => {
    expect(() => epleyE1rm(0, 5)).toThrow(RangeError);
    expect(() => epleyE1rm(-5, 5)).toThrow(RangeError);
    expect(() => epleyE1rm(NaN, 5)).toThrow(RangeError);
  });
});

describe('weightForReps', () => {
  it('inverts Epley', () => {
    expect(weightForReps(116.6666667, 5)).toBeCloseTo(100, 5);
    expect(weightForReps(154, 3)).toBeCloseTo(140, 10);
    expect(weightForReps(200, 1)).toBe(200);
  });

  it('round-trips with epleyE1rm for every rep count', () => {
    for (let reps = 1; reps <= MAX_EPLEY_REPS; reps++) {
      expect(epleyE1rm(weightForReps(150, reps), reps)).toBeCloseTo(150, 10);
    }
  });

  it('rejects out-of-domain input', () => {
    expect(() => weightForReps(0, 5)).toThrow(RangeError);
    expect(() => weightForReps(100, 31)).toThrow(RangeError);
  });
});

describe('epleyMultiplier', () => {
  it('accepts fractional effective reps for the RPE chart', () => {
    expect(epleyMultiplier(6.5)).toBeCloseTo(1 + 6.5 / 30, 12);
    expect(epleyMultiplier(1)).toBe(1);
  });

  it('rejects values outside 1–30', () => {
    expect(() => epleyMultiplier(0.5)).toThrow(RangeError);
    expect(() => epleyMultiplier(30.5)).toThrow(RangeError);
    expect(() => epleyMultiplier(NaN)).toThrow(RangeError);
  });
});
