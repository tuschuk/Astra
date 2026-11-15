// Tests for muscles.ts — the rule that turns a session's exercises into one muscle map (ANA-3).
import { describe, expect, it } from '@jest/globals';

import { combineMuscleLoads } from './muscles.ts';

describe('combineMuscleLoads', () => {
  it('returns an empty map for a session with no exercises', () => {
    expect(combineMuscleLoads([])).toEqual({});
  });

  it('returns one exercise’s table unchanged', () => {
    expect(combineMuscleLoads([{ chest: 1, shoulders: 0.4, triceps: 0.25 }])).toEqual({
      chest: 1,
      shoulders: 0.4,
      triceps: 0.25,
    });
  });

  it('takes the highest value per muscle across exercises, and the union of muscles', () => {
    const bench = { chest: 1, shoulders: 0.4, triceps: 0.25 };
    const press = { shoulders: 1, traps: 0.4, triceps: 0.3 };
    expect(combineMuscleLoads([bench, press])).toEqual({ chest: 1, shoulders: 1, triceps: 0.3, traps: 0.4 });
    // Order doesn't matter.
    expect(combineMuscleLoads([press, bench])).toEqual(combineMuscleLoads([bench, press]));
  });

  it('never exceeds 1 when every input is at most 1, and adding an exercise never lowers a muscle', () => {
    const maps = [{ chest: 1 }, { chest: 0.2, abs: 0.5 }, { abs: 1, lats: 0.15 }, { lats: 0.9 }];
    const combined = combineMuscleLoads(maps);
    for (const value of Object.values(combined)) expect(value).toBeLessThanOrEqual(1);
    const fewer = combineMuscleLoads(maps.slice(0, 2));
    for (const [key, value] of Object.entries(fewer)) {
      expect(combined[key as keyof typeof combined]).toBeGreaterThanOrEqual(value as number);
    }
  });

  it('ignores zero, negative and non-number values', () => {
    expect(combineMuscleLoads([{ chest: 0, abs: -1, lats: Number.NaN, quads: 0.5 }])).toEqual({ quads: 0.5 });
  });
});
