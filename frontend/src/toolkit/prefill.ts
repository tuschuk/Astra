/**
 * Tool Kit prefill (TK-6): when the lifter opens the Tool Kit from the logger, the calculators
 * arrive already filled in from what they are lifting right now and from their stored PRs.
 *
 * Why this exists: between sets, the lifter opens a calculator to answer a question about the
 * exercise they are on — "what's my e1RM off that set?", "what do I put on the bar for 8 at
 * RPE 8?", "which plates make that weight?". Typing back numbers the app already knows is
 * friction; this file works out those numbers and writes them into the Tool Kit's in-memory
 * session (`session.ts`), which every calculator already starts from. So the sheet and the
 * calculators know nothing about workouts — they just find their boxes filled.
 *
 * The rules, decided in docs/feature_plans/tool-kit-prefill.md:
 *   - **The exercise in progress** is the one holding the most recently logged set; with no set
 *     logged yet, the exercise added last (the one about to be started). No exercises → nothing.
 *   - **The source set** is that exercise's most recently logged set — warm-ups and drops
 *     included (loading the next warm-up is a real plate-loader moment).
 *   - **The 1RM** for the RPE and %1RM calculators is the lifter's stored best estimated 1RM
 *     for the exercise; with no stored record yet, the Epley estimate of the source set.
 *   - A box only gets a value the calculator can actually use (no "0", no RPE 7.3 snapped to a
 *     7.5 chip); a box with nothing to offer keeps what it already held.
 *   - **A prefill is a starting value, never a lock.** Each calculator is written once per
 *     source and value: reopening the sheet without anything new logged keeps whatever the
 *     lifter typed over it; logging (or fixing) a set, moving to another exercise or changing
 *     units fills again — only the calculators whose prefill actually changed.
 *
 * No training math is written here: conversion, Epley and the chart ranges all come from
 * `@training-math`. This file only chooses which rows to read and which values a box can show.
 */
import {
  displayWeight,
  epleyE1rm,
  isChartRpe,
  MAX_EPLEY_REPS,
  MAX_RPE_REPS,
  MIN_RPE_REPS,
  type WeightUnit,
} from '@training-math';

import type { PersonalRecordRow, SetRow } from '@/db/dao';
import type { ActiveEntry } from '@/workout/activeWorkout';

import { updateToolKitSession, type ToolKitSession } from './session';

/** The four calculators a prefill can fill (the timer is not one of them). */
const CALCULATORS = ['oneRm', 'rpe', 'percent', 'plates'] as const;
type Calculator = (typeof CALCULATORS)[number];

/**
 * What to write into each calculator's boxes, plus `sourceKey` — which entry and which set
 * (or "none" yet) the values came from, so the same prefill is never written twice over the
 * lifter's own typing. A calculator with nothing to offer gets an empty object (its boxes are
 * left alone).
 */
export interface ToolKitPrefill {
  sourceKey: string;
  oneRm: Partial<ToolKitSession['oneRm']>;
  rpe: Partial<ToolKitSession['rpe']>;
  percent: Partial<ToolKitSession['percent']>;
  plates: Partial<ToolKitSession['plates']>;
}

/** A set's place in the workout, for "which was logged last": time, then exercise, then set order. */
interface SetPlace {
  set: SetRow;
  entryIndex: number;
  setIndex: number;
}

/** True when `a` was logged after `b` (later time wins; exact ties go to the later position). */
function loggedAfter(a: SetPlace, b: SetPlace): boolean {
  if (a.set.created_at !== b.set.created_at) return a.set.created_at > b.set.created_at;
  if (a.entryIndex !== b.entryIndex) return a.entryIndex > b.entryIndex;
  return a.setIndex > b.setIndex;
}

/** The most recently logged set among these entries, with where it sits; null if none. */
function newestSet(entries: readonly ActiveEntry[]): SetPlace | null {
  let newest: SetPlace | null = null;
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const sets = entries[entryIndex]?.sets ?? [];
    for (let setIndex = 0; setIndex < sets.length; setIndex++) {
      const set = sets[setIndex];
      if (!set) continue;
      const place: SetPlace = { set, entryIndex, setIndex };
      if (newest === null || loggedAfter(place, newest)) newest = place;
    }
  }
  return newest;
}

/**
 * The exercise the lifter is working on right now, out of the workout's entries (in their
 * on-screen order): the one with the most recently logged set, or — when nothing is logged yet —
 * the last one added. Null for a workout with no exercises. The logger calls this first, because
 * it needs the exercise before it can read that exercise's PRs.
 */
export function focusedEntry(entries: readonly ActiveEntry[]): ActiveEntry | null {
  const newest = newestSet(entries);
  if (newest) return entries[newest.entryIndex] ?? null;
  return entries[entries.length - 1] ?? null;
}

/** A weight in kg as box text in `unit` (rounded to the 0.1 the app shows), or null for none / 0. */
function weightText(kg: number | null, unit: WeightUnit): string | null {
  if (kg === null || !(kg > 0)) return null;
  return String(displayWeight(kg, unit));
}

/** True for a whole number from `min` to `max` — a rep count a calculator can take. */
function wholeIn(value: number | null, min: number, max: number): value is number {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * The 1RM to offer, in kg: the stored best-estimated-1RM record if there is one (it is never
 * below the heaviest single, which estimates as itself), otherwise the Epley estimate of the
 * source set when it has a weight and a usable rep count, otherwise none.
 */
function oneRmReferenceKg(prs: readonly PersonalRecordRow[], source: SetRow | null): number | null {
  const stored = prs.find((record) => record.kind === 'e1rm');
  if (stored && stored.value_kg > 0) return stored.value_kg;
  if (source && source.weight_kg !== null && source.weight_kg > 0 && wholeIn(source.reps, 1, MAX_EPLEY_REPS)) {
    return epleyE1rm(source.weight_kg, source.reps);
  }
  return null;
}

/**
 * Works out what each calculator should show for the exercise in progress.
 *
 * Inputs: the focused entry (from `focusedEntry`), that exercise's stored records
 * (`currentPrs`; empty when there are none), the lifter's display unit, and the plate rack's
 * unit (the plate screen works in the rack's unit, which can differ from the display unit).
 * Output: the values per calculator, or null when there is nothing at all to fill in (an
 * exercise with no sets and no records). Pure — reads nothing, writes nothing.
 */
export function buildToolKitPrefill(
  entry: ActiveEntry,
  prs: readonly PersonalRecordRow[],
  displayUnit: WeightUnit,
  rackUnit: WeightUnit,
): ToolKitPrefill | null {
  const newest = newestSet([entry]);
  const source = newest ? newest.set : null;

  const oneRm: ToolKitPrefill['oneRm'] = {};
  const rpe: ToolKitPrefill['rpe'] = {};
  const percent: ToolKitPrefill['percent'] = {};
  const plates: ToolKitPrefill['plates'] = {};

  if (source) {
    const weight = weightText(source.weight_kg, displayUnit);
    if (weight !== null) oneRm.weight = weight;
    if (wholeIn(source.reps, 1, MAX_EPLEY_REPS)) oneRm.reps = String(source.reps);
    if (wholeIn(source.reps, MIN_RPE_REPS, MAX_RPE_REPS)) rpe.reps = source.reps;
    // Only an RPE the chart has a chip for (6–10 in half steps): a stored 7.3 is not a 7.5.
    if (source.rpe !== null && isChartRpe(source.rpe)) rpe.rpe = source.rpe;
    const target = weightText(source.weight_kg, rackUnit);
    if (target !== null) plates.target = target;
  }

  const reference = weightText(oneRmReferenceKg(prs, source), displayUnit);
  if (reference !== null) {
    rpe.oneRm = reference;
    percent.oneRm = reference;
  }

  const values = { oneRm, rpe, percent, plates };
  if (CALCULATORS.every((calculator) => Object.keys(values[calculator]).length === 0)) return null;
  return { sourceKey: `${entry.id}:${source ? source.id : 'none'}`, ...values };
}

// For each calculator, a fingerprint of the last prefill written into it — which entry and set
// it came from plus the values written. In memory, like the session itself.
let lastWritten: Partial<Record<Calculator, string>> = {};

/**
 * Writes a prefill into the Tool Kit session, calculator by calculator: one with nothing to
 * offer is left as it was, and one whose prefill (same source set, same values) was already
 * written is left as it was too. That is what lets the lifter type over a prefilled number,
 * close the sheet and reopen it to find their own number still there — while the next logged
 * set, a fixed typo on the source set, or a unit change fills the affected boxes afresh. A
 * change that only alters one calculator's values (say, switching the plate rack's unit)
 * refills that calculator alone, never wiping what was typed into the others. Null does nothing.
 */
export function applyToolKitPrefill(prefill: ToolKitPrefill | null): void {
  if (!prefill) return;
  for (const calculator of CALCULATORS) {
    const values = prefill[calculator];
    if (Object.keys(values).length === 0) continue;
    const fingerprint = `${prefill.sourceKey}:${JSON.stringify(values)}`;
    if (lastWritten[calculator] === fingerprint) continue;
    lastWritten = { ...lastWritten, [calculator]: fingerprint };
    updateToolKitSession(calculator, values);
  }
}

/** Forgets which prefills were last written. Tests only (pair it with `resetToolKitSession`). */
export function resetToolKitPrefill(): void {
  lastWritten = {};
}
