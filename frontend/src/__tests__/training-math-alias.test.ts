// Smoke test: the app reaches the shared training-math module through the `@training-math`
// alias (jest.config.js moduleNameMapper; tsconfig.json paths for the type check). Proves
// wiring, not math — the math tests live beside the module in
// backend/supabase/functions/_shared/training-math/.
import { describe, expect, it } from '@jest/globals';

import {
  classifyPrs,
  displayWeight,
  epleyE1rm,
  lbToKg,
  loadBar,
  recordsFromSets,
  workingWeightFromPercent,
  workingWeightFromRpe,
  type PrRecords,
} from '@training-math';

describe('@training-math alias', () => {
  it('exposes the public API to app code', () => {
    expect(epleyE1rm(100, 5)).toBeCloseTo(116.6667, 4);
    expect(workingWeightFromRpe(200, 1, 10)).toBe(200);
    expect(workingWeightFromPercent(200, 80)).toBe(160);
    expect(displayWeight(lbToKg(225), 'lb')).toBe(225);
    expect(loadBar(225, 45, [{ plate: 45, perSide: 4 }]).perSide).toEqual([
      { plate: 45, count: 2 },
    ]);
    const records: PrRecords = recordsFromSets([{ reps: 1, weightKg: 100, isWarmup: false }]);
    expect(classifyPrs({ reps: 1, weightKg: 100, isWarmup: false }, records)).toEqual([]);
  });
});
