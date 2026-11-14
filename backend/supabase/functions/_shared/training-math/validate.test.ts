// Tests for validate.ts — the shared input checks behind every calculator.
import { describe, expect, it } from '@jest/globals';

import { assertFinite, assertPositive, assertWholeInRange } from './validate.ts';

describe('assertFinite', () => {
  it('accepts real numbers, including 0 and negatives', () => {
    expect(() => assertFinite(0, 'x')).not.toThrow();
    expect(() => assertFinite(-2.5, 'x')).not.toThrow();
  });

  it('rejects NaN and Infinity with the input named', () => {
    expect(() => assertFinite(NaN, 'weightKg')).toThrow(/weightKg/);
    expect(() => assertFinite(-Infinity, 'x')).toThrow(RangeError);
  });
});

describe('assertPositive', () => {
  it('accepts numbers above zero', () => {
    expect(() => assertPositive(0.01, 'x')).not.toThrow();
  });

  it('rejects zero, negatives and non-numbers', () => {
    expect(() => assertPositive(0, 'x')).toThrow(RangeError);
    expect(() => assertPositive(-1, 'x')).toThrow(RangeError);
    expect(() => assertPositive(NaN, 'x')).toThrow(RangeError);
  });
});

describe('assertWholeInRange', () => {
  it('accepts whole numbers at and between the bounds', () => {
    expect(() => assertWholeInRange(1, 1, 30, 'reps')).not.toThrow();
    expect(() => assertWholeInRange(30, 1, 30, 'reps')).not.toThrow();
  });

  it('rejects fractions, out-of-range values and NaN', () => {
    expect(() => assertWholeInRange(2.5, 1, 30, 'reps')).toThrow(RangeError);
    expect(() => assertWholeInRange(0, 1, 30, 'reps')).toThrow(RangeError);
    expect(() => assertWholeInRange(31, 1, 30, 'reps')).toThrow(/reps/);
    expect(() => assertWholeInRange(NaN, 1, 30, 'reps')).toThrow(RangeError);
  });
});
