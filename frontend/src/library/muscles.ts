/**
 * Muscle vocabulary — the one home for how the app names and orders the twelve muscle groups.
 *
 * The founder's library (`exercises.ts`) says which muscles each movement trains and how hard
 * (`MuscleKey` → intensity). This file adds what the app needs to *show* that: a fixed
 * top-to-bottom order, a display name for every key, and one ranking rule. The muscle map, the
 * Library tab's muscle filter and the exercise detail screen all read from here, so they can never
 * spell or order a muscle differently. (It used to sit beside the muscle-map drawing data; it moved
 * here in B29 because the library, not a picture, owns muscle names — the map imports from the
 * library, never the reverse.)
 *
 * Pure data and functions — no React, no I/O.
 */
import type { MuscleKey } from './exercises';

/**
 * Every muscle key in a fixed order (top of the body to the bottom). Wherever muscles are listed
 * and two have the same value, this order breaks the tie — so the same workout or exercise always
 * reads the same list. Also the order the Library tab's muscle chips appear in.
 */
export const MUSCLE_ORDER: readonly MuscleKey[] = [
  'traps',
  'shoulders',
  'chest',
  'lats',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
];

/** The display name of each muscle key — for chips, lists, the map's legend and screen readers. */
export const MUSCLE_NAMES: Record<MuscleKey, string> = {
  traps: 'Traps',
  shoulders: 'Shoulders',
  chest: 'Chest',
  lats: 'Lats',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
};

/**
 * A stored muscle value (free text on a custom exercise's `primary_muscle`, B31) as one of the
 * twelve muscle keys, or null when it isn't one — a row synced from elsewhere could hold anything,
 * and an unknown word must never be shown as if it were a muscle or matched by a muscle chip.
 */
export function asMuscleKey(value: string | null): MuscleKey | null {
  return MUSCLE_ORDER.find((key) => key === value) ?? null;
}

/**
 * Rank a muscle table for reading.
 *
 * Input: any muscle → number table (an exercise's involvement, a workout's total load).
 * Output: the muscles whose number is above zero, biggest first; when two are equal, the one
 * higher on the body (earlier in `MUSCLE_ORDER`) comes first.
 *
 * Why: "which muscles does this work, most direct first" is asked in several places — the muscle
 * map's legend, the exercise detail screen — and they must always agree, so the rule lives once.
 */
export function rankMuscles(table: Readonly<Partial<Record<MuscleKey, number>>>): MuscleKey[] {
  return MUSCLE_ORDER.filter((m) => (table[m] ?? 0) > 0).sort(
    (a, b) => (table[b] ?? 0) - (table[a] ?? 0) || MUSCLE_ORDER.indexOf(a) - MUSCLE_ORDER.indexOf(b),
  );
}
