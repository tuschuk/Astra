/**
 * Session volume ("tonnage"): how much total weight a workout moved, in kg.
 *
 * Volume is reps × weight, added up over the sets. Two kinds of set add nothing:
 *   - **Warm-up sets** (LOG-14) — they prepare the lifter for the work; counting them would let
 *     a pile of empty-bar sets inflate the number. PR detection skips them too (prs.ts).
 *   - **Sets with no weight or no reps** — a bodyweight pull-up or a timed plank has no external
 *     load on record. Volume here counts *external load only*: guessing the lifter's bodyweight
 *     would need body data most users never enter, and would make the number jump whenever they
 *     edited it. Weighted pull-ups count their added weight like any other set.
 *
 * Volume is never an input to PR detection (the PRD: "volume does not" count as a PR). This file
 * exists so analysis (B18) and the PR screen (B13) read one definition of volume instead of each
 * growing its own. Pure logic, no I/O.
 */

/** The fields of a logged set that volume needs — mirrors the `sets` table (weights in kg). */
export interface VolumeSet {
  reps: number | null;
  weightKg: number | null;
  isWarmup: boolean;
}

/**
 * One set's volume in kg: reps × weight. Returns 0 for a warm-up set, for a set missing its
 * reps or its weight, and for any value that isn't usable (reps that aren't a whole number of
 * at least 1, a weight that isn't a positive number).
 * Example: 5 reps at 100 kg → 500; the same set marked warm-up → 0; 8 pull-ups with no weight → 0.
 */
export function setVolumeKg(set: VolumeSet): number {
  const { reps, weightKg, isWarmup } = set;
  if (isWarmup) return 0;
  // Same rule as PR detection (prs.ts): reps must be a whole number of at least 1.
  if (reps === null || !Number.isInteger(reps) || reps < 1) return 0;
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) return 0;
  return reps * weightKg;
}

/**
 * A whole workout's volume in kg: the sum of `setVolumeKg` over its sets (warm-ups and
 * weightless sets add 0). An empty list is 0.
 */
export function sessionVolumeKg(sets: readonly VolumeSet[]): number {
  return sets.reduce((total, set) => total + setVolumeKg(set), 0);
}
