/**
 * How a session's exercises combine into one muscle map (ANA-3) — the one home of that rule.
 *
 * Every library exercise carries a little table of the muscles it works and how directly, as
 * numbers from just above 0 (a light supporting role) up to 1 (the main mover) — Bench Press is
 * chest 1, shoulders 0.4, triceps 0.25. A workout usually has several exercises, so the map needs
 * one rule for turning several of those tables into one: that rule lives here, beside the rest of
 * the analysis rules, so the phone and (if an analysis row ever stores it) the server can never
 * disagree about it.
 *
 * Same constraints as the rest of this module: plain TypeScript, no packages, no I/O. The muscle
 * names are plain strings here on purpose — the list of muscles and the exercise data stay in the
 * app's library, and this file imports nothing from it.
 */

/** One exercise's muscle table: muscle name → how directly it works that muscle, in (0, 1]. */
export type MuscleLoads<K extends string = string> = Readonly<Partial<Record<K, number>>>;

/**
 * Combines the muscle tables of every exercise performed in a session into the session's map.
 *
 * Input: one table per performed exercise. Output: one table holding every muscle any of them
 * worked, each at the **highest** value any exercise gave it.
 *
 * Why the highest and not a sum: the values stay on the library's own 0-to-1 scale with no
 * invented "how many sets is full" constant, a muscle is shaded exactly as strongly as the most
 * direct way it was trained, and adding another exercise can never make a muscle look *less*
 * trained. The map answers "which muscles, and how directly" — not "how much volume" (plan
 * decision G3). Values that aren't positive numbers are ignored, so a muscle the data marks as 0
 * never shows up as trained.
 */
export function combineMuscleLoads<K extends string>(maps: readonly MuscleLoads<K>[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const map of maps) {
    for (const key of Object.keys(map) as K[]) {
      const value = map[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
      const current = out[key];
      if (current === undefined || value > current) out[key] = value;
    }
  }
  return out;
}
