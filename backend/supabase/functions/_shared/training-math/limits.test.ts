// Tests for limits.ts — the phone's copy of the server's rules on a logged set.
import { describe, expect, it } from '@jest/globals';

import {
  assertValidSetFields,
  MAX_INTEGER,
  MAX_SMALLINT,
  roundRpeForStorage,
  roundWeightKgForStorage,
} from './limits.ts';
import { displayWeight, lbToKg } from './units.ts';

describe('roundWeightKgForStorage', () => {
  it('rounds to the 2 decimals the server column keeps', () => {
    expect(roundWeightKgForStorage(lbToKg(225))).toBe(102.06);
    expect(roundWeightKgForStorage(100)).toBe(100);
    expect(roundWeightKgForStorage(102.555)).toBe(102.56);
  });

  it('survives a round trip back to the lifter’s pounds', () => {
    for (const lb of [45, 135, 225, 315, 405, 2.5]) {
      expect(displayWeight(roundWeightKgForStorage(lbToKg(lb)), 'lb')).toBe(lb);
    }
  });
});

describe('roundRpeForStorage', () => {
  it('rounds to the 1 decimal the server column keeps', () => {
    expect(roundRpeForStorage(9.55)).toBe(9.6);
    expect(roundRpeForStorage(7.5)).toBe(7.5);
    expect(roundRpeForStorage(8.04)).toBe(8);
  });
});

describe('assertValidSetFields', () => {
  it('accepts a typical set and a set with every optional field empty', () => {
    expect(() =>
      assertValidSetFields({ position: 0, reps: 5, weightKg: 102.06, rpe: 8.5, dropSetPosition: 1, durationSeconds: 0 }),
    ).not.toThrow();
    expect(() =>
      assertValidSetFields({ position: 3, reps: null, weightKg: null, rpe: null, dropSetPosition: null }),
    ).not.toThrow();
  });

  it('accepts the exact edges the server accepts', () => {
    expect(() =>
      assertValidSetFields({
        position: MAX_SMALLINT,
        reps: 0,
        weightKg: 0,
        rpe: 1,
        dropSetPosition: MAX_SMALLINT,
        durationSeconds: MAX_INTEGER,
      }),
    ).not.toThrow();
    expect(() => assertValidSetFields({ position: 0, weightKg: 9999.99, rpe: 10 })).not.toThrow();
  });

  it.each([
    [{ position: -1 }, /position/],
    [{ position: 1.5 }, /position/],
    [{ position: MAX_SMALLINT + 1 }, /position/],
    [{ position: 0, reps: -1 }, /reps/],
    [{ position: 0, reps: 2.5 }, /reps/],
    [{ position: 0, reps: MAX_INTEGER + 1 }, /reps/],
    [{ position: 0, weightKg: -0.01 }, /weightKg/],
    [{ position: 0, weightKg: 10000 }, /weightKg/],
    [{ position: 0, weightKg: NaN }, /weightKg/],
    [{ position: 0, rpe: 0.9 }, /rpe/],
    [{ position: 0, rpe: 11 }, /rpe/],
    [{ position: 0, dropSetPosition: 0 }, /dropSetPosition/],
    [{ position: 0, durationSeconds: -5 }, /durationSeconds/],
    [{ position: 0, durationSeconds: 1.2 }, /durationSeconds/],
  ])('refuses %o, naming the field', (fields, name) => {
    expect(() => assertValidSetFields(fields)).toThrow(RangeError);
    expect(() => assertValidSetFields(fields)).toThrow(name);
  });
});
