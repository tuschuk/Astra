// Tests for intensity.ts — %1RM → working weight.
import { describe, expect, it } from '@jest/globals';

import { workingWeightFromPercent } from './intensity.ts';

describe('workingWeightFromPercent', () => {
  it('returns the percentage of the 1RM', () => {
    expect(workingWeightFromPercent(200, 80)).toBe(160);
    expect(workingWeightFromPercent(142.5, 72.5)).toBeCloseTo(103.3125, 10);
  });

  it('returns the 1RM at 100% and allows overloads above it', () => {
    expect(workingWeightFromPercent(100, 100)).toBe(100);
    expect(workingWeightFromPercent(200, 110)).toBeCloseTo(220, 10);
    expect(workingWeightFromPercent(100, 150)).toBe(150);
  });

  it('rejects percentages at or below 0 or above 150', () => {
    expect(() => workingWeightFromPercent(100, 0)).toThrow(RangeError);
    expect(() => workingWeightFromPercent(100, -10)).toThrow(RangeError);
    expect(() => workingWeightFromPercent(100, 150.5)).toThrow(RangeError);
    expect(() => workingWeightFromPercent(100, NaN)).toThrow(RangeError);
  });

  it('rejects a zero or negative 1RM', () => {
    expect(() => workingWeightFromPercent(0, 80)).toThrow(RangeError);
    expect(() => workingWeightFromPercent(-100, 80)).toThrow(RangeError);
  });
});
