// Tests for plates.ts — per-side plate breakdowns for standard, custom and awkward racks.
import { describe, expect, it } from '@jest/globals';

import { loadBar, type PlateInventoryItem } from './plates.ts';

const KG_RACK: PlateInventoryItem[] = [25, 20, 15, 10, 5, 2.5, 1.25].map((plate) => ({
  plate,
  perSide: 4,
}));
const LB_RACK: PlateInventoryItem[] = [45, 35, 25, 10, 5, 2.5].map((plate) => ({
  plate,
  perSide: 4,
}));

describe('loadBar — standard racks', () => {
  it('loads 142.5 kg on a 20 kg bar, preferring heavier plates on a tie', () => {
    // 61.25 per side: 25+25+10+1.25 and 25+20+15+1.25 both use four plates; two 25s wins.
    expect(loadBar(142.5, 20, KG_RACK)).toEqual({
      perSide: [
        { plate: 25, count: 2 },
        { plate: 10, count: 1 },
        { plate: 1.25, count: 1 },
      ],
      loaded: 142.5,
      remainder: 0,
    });
  });

  it('plates out 225 and 315 lb on a 45 lb bar', () => {
    expect(loadBar(225, 45, LB_RACK)).toEqual({
      perSide: [{ plate: 45, count: 2 }],
      loaded: 225,
      remainder: 0,
    });
    expect(loadBar(315, 45, LB_RACK).perSide).toEqual([{ plate: 45, count: 3 }]);
  });

  it('uses the fewest plates', () => {
    // 50 per side: 25+25 (2 plates), not 20+20+10 (3).
    expect(loadBar(120, 20, KG_RACK).perSide).toEqual([{ plate: 25, count: 2 }]);
  });

  it('handles microplates', () => {
    const rack = [
      { plate: 25, perSide: 2 },
      { plate: 15, perSide: 1 },
      { plate: 0.5, perSide: 2 },
    ];
    expect(loadBar(101, 20, rack)).toEqual({
      perSide: [
        { plate: 25, count: 1 },
        { plate: 15, count: 1 },
        { plate: 0.5, count: 1 },
      ],
      loaded: 101,
      remainder: 0,
    });
  });
});

describe('loadBar — custom and impossible racks', () => {
  it('finds the exact answer where biggest-plate-first fails', () => {
    // 6 per side from [4, 3, 3]: grabbing the 4 strands you at 4; 3 + 3 is exact.
    const rack = [
      { plate: 4, perSide: 1 },
      { plate: 3, perSide: 2 },
    ];
    expect(loadBar(12, 0, rack)).toEqual({
      perSide: [{ plate: 3, count: 2 }],
      loaded: 12,
      remainder: 0,
    });
  });

  it('loads the heaviest weight under target when the target is unreachable', () => {
    expect(loadBar(100, 20, [{ plate: 25, perSide: 1 }])).toEqual({
      perSide: [{ plate: 25, count: 1 }],
      loaded: 70,
      remainder: 30,
    });
    // 0.7 over the bar can't be split into two equal sides with 0.5s.
    expect(loadBar(20.7, 20, [{ plate: 0.5, perSide: 2 }])).toEqual({
      perSide: [],
      loaded: 20,
      remainder: 0.7,
    });
  });

  it('returns the bar alone when the target equals it', () => {
    expect(loadBar(20, 20, KG_RACK)).toEqual({ perSide: [], loaded: 20, remainder: 0 });
  });

  it('reports a negative remainder when the bar is already heavier than the target', () => {
    expect(loadBar(15, 20, KG_RACK)).toEqual({ perSide: [], loaded: 20, remainder: -5 });
  });

  it('merges duplicate sizes and ignores sizes with none available', () => {
    const rack = [
      { plate: 20, perSide: 1 },
      { plate: 20, perSide: 1 },
      { plate: 25, perSide: 0 },
    ];
    expect(loadBar(100, 20, rack).perSide).toEqual([{ plate: 20, count: 2 }]);
  });

  it('copes with an empty rack and an absurd target', () => {
    expect(loadBar(100, 20, [])).toEqual({ perSide: [], loaded: 20, remainder: 80 });
    const huge = loadBar(1_000_000, 20, KG_RACK);
    expect(huge.loaded).toBe(20 + 2 * 4 * (25 + 20 + 15 + 10 + 5 + 2.5 + 1.25));
  });

  it('matches brute force on many small random racks', () => {
    // Deterministic pseudo-random generator so the test is repeatable.
    let seed = 42;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const sizes = [0.5, 1.25, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 25];
    for (let trial = 0; trial < 200; trial++) {
      const rack = Array.from({ length: 1 + rand(4) }, () => ({
        plate: sizes[rand(sizes.length)],
        perSide: rand(4),
      }));
      const bar = [0, 15, 20][rand(3)];
      const target = bar + rand(200) / 2;

      // Every per-side sum the rack can make, by enumerating all count combinations.
      let reachable = new Set<number>([0]);
      for (const { plate, perSide } of rack) {
        const grown = new Set<number>();
        for (const sum of reachable) {
          for (let k = 0; k <= perSide; k++) grown.add(Math.round((sum + k * plate) * 100));
        }
        reachable = new Set([...grown].map((c) => c / 100));
      }
      const bestSide = Math.max(...[...reachable].filter((s) => bar + 2 * s <= target + 1e-9));

      const result = loadBar(target, bar, rack);
      expect(result.loaded).toBeCloseTo(bar + 2 * bestSide, 9);
      const sideSum = result.perSide.reduce((s, p) => s + p.plate * p.count, 0);
      expect(bar + 2 * sideSum).toBeCloseTo(result.loaded, 9);
      expect(result.loaded + result.remainder).toBeCloseTo(target, 9);
    }
  });
});

describe('loadBar — bad input', () => {
  it('rejects bad plates, counts and bars', () => {
    expect(() => loadBar(100, 20, [{ plate: 0, perSide: 1 }])).toThrow(RangeError);
    expect(() => loadBar(100, 20, [{ plate: -5, perSide: 1 }])).toThrow(RangeError);
    expect(() => loadBar(100, 20, [{ plate: 5, perSide: -1 }])).toThrow(RangeError);
    expect(() => loadBar(100, 20, [{ plate: 5, perSide: 1.5 }])).toThrow(RangeError);
    expect(() => loadBar(100, -1, KG_RACK)).toThrow(RangeError);
    expect(() => loadBar(NaN, 20, KG_RACK)).toThrow(RangeError);
  });
});
