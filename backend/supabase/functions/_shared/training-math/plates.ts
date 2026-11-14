/**
 * The plate loader: "which plates go on each side of the bar to make 142.5?"
 *
 * Why this exists: lifters do this arithmetic between sets, tired, all day. Given a target
 * weight, the bar's weight and the plates on the rack, it returns what to put on each side.
 *
 * Unlike the rest of the module this works in whatever unit the lifter's plates are in — a
 * 45 lb plate is a real object, not a converted kilogram. Pass every number in one unit and the
 * answer comes back in that same unit.
 *
 * It finds the true best answer (heaviest loadable weight not over the target), not just the
 * "biggest plate first" guess. The quick guess fails on real racks: aiming for 6 per side with
 * plates of 4, 3 and 3, it grabs the 4 and gets stuck, when 3 + 3 hits 6 exactly.
 */
import { assertFinite, assertPositive } from './validate.ts';

/** One plate size on the rack and how many of them are available for each side of the bar. */
export interface PlateInventoryItem {
  plate: number;
  perSide: number;
}

/** One line of the answer: put `count` plates of weight `plate` on each side. */
export interface PlateCount {
  plate: number;
  count: number;
}

/** The loader's answer. */
export interface BarLoad {
  /** What goes on each side, heaviest plate first. Empty when only the bar is used. */
  perSide: PlateCount[];
  /** The total on the bar: bar + both sides. The heaviest loadable weight at or under target. */
  loaded: number;
  /**
   * Target minus loaded. 0 = hit exactly; above 0 = the rack can't make the target (this much
   * short); below 0 = the bar alone is already heavier than the target.
   */
  remainder: number;
}

/** Best way found so far to make one per-side sum: total plates used and the count per size. */
interface Combo {
  plates: number;
  counts: number[];
}

// Weights are solved in hundredths ("centi-units") as whole numbers, so 1.25 + 1.25 is exactly
// 2.5 with no floating-point drift.
const SCALE = 100;
const toCenti = (value: number): number => Math.round(value * SCALE);
const fromCenti = (centi: number): number => centi / SCALE;

/**
 * True when combo `a` is the better rack-out than `b` for the same weight: fewer plates wins;
 * on a tie, more of the heavier plates wins (what a lifter would actually load). `counts` are
 * ordered heaviest plate first, so the first difference decides.
 */
function isBetter(a: Combo, b: Combo): boolean {
  if (a.plates !== b.plates) return a.plates < b.plates;
  for (let i = 0; i < a.counts.length; i++) {
    if (a.counts[i] !== b.counts[i]) return a.counts[i] > b.counts[i];
  }
  return false;
}

/**
 * Work out the plates per side.
 * Inputs: target total weight, bar weight, and the rack's plates (each with how many are
 * available *per side*), all in one unit. Output: see `BarLoad`.
 * Bad input — a negative bar, a zero or negative plate, a fractional count — throws a RangeError.
 */
export function loadBar(target: number, bar: number, inventory: PlateInventoryItem[]): BarLoad {
  assertFinite(target, 'target');
  assertFinite(bar, 'bar');
  if (bar < 0) throw new RangeError(`bar must not be negative, got ${bar}`);

  // Merge duplicate sizes and drop sizes with none available; heaviest first.
  const bySize = new Map<number, number>();
  for (const { plate, perSide } of inventory) {
    assertPositive(plate, 'plate');
    if (!Number.isInteger(perSide) || perSide < 0) {
      throw new RangeError(`perSide must be a whole number ≥ 0, got ${perSide}`);
    }
    const centi = toCenti(plate);
    bySize.set(centi, (bySize.get(centi) ?? 0) + perSide);
  }
  const sizes = [...bySize.entries()]
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => b - a);

  const barCenti = toCenti(bar);
  const targetCenti = toCenti(target);
  if (targetCenti < barCenti) {
    return { perSide: [], loaded: fromCenti(barCenti), remainder: fromCenti(targetCenti - barCenti) };
  }

  // The most each side may hold without going over target, capped by what the rack has.
  const rackPerSide = sizes.reduce((sum, [size, count]) => sum + size * count, 0);
  const cap = Math.min(Math.floor((targetCenti - barCenti) / 2), rackPerSide);

  // best[s] = the best way found to put exactly s on one side, using the plate sizes looked at
  // so far. We look at one size at a time: for every side weight already makeable, try adding
  // 0, 1, 2… of the new size (up to how many there are), and keep whichever way is better. After
  // the last size, best[] holds the best rack-out for every reachable side weight.
  let best: (Combo | null)[] = new Array(cap + 1).fill(null);
  best[0] = { plates: 0, counts: [] };
  for (const [size, available] of sizes) {
    const next: (Combo | null)[] = new Array(cap + 1).fill(null);
    for (let sum = 0; sum <= cap; sum++) {
      const before = best[sum];
      if (!before) continue;
      for (let k = 0; k <= available && sum + k * size <= cap; k++) {
        const made = sum + k * size;
        const candidate: Combo = { plates: before.plates + k, counts: [...before.counts, k] };
        const current = next[made];
        if (!current || isBetter(candidate, current)) next[made] = candidate;
      }
    }
    best = next;
  }

  // Heaviest reachable per-side sum (0 is always reachable: just the bar).
  let side = cap;
  while (side > 0 && !best[side]) side--;
  const combo = best[side] as Combo;

  const perSide: PlateCount[] = [];
  sizes.forEach(([size], i) => {
    if (combo.counts[i] > 0) perSide.push({ plate: fromCenti(size), count: combo.counts[i] });
  });
  const loadedCenti = barCenti + 2 * side;
  return { perSide, loaded: fromCenti(loadedCenti), remainder: fromCenti(targetCenti - loadedCenti) };
}
