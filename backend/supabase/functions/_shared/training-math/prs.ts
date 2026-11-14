/**
 * Personal-record (PR) detection: "was that set a PR, and what kind?"
 *
 * Astra keeps three record books per exercise:
 *   - true1rm — the heaviest single (1 rep) actually lifted;
 *   - repMax  — the heaviest weight lifted for exactly N reps, one book per rep count (2, 3, 5…);
 *   - e1rm    — the highest estimated 1RM (Epley, see e1rm.ts) from any set.
 * A single feeds the true-1RM book, not a separate "1-rep max" book — they would be the same
 * number twice.
 *
 * Never a PR: warm-up sets, sets with no weight (bodyweight or timed work) and sets with no reps.
 * Volume (more sets, more total reps or tonnage) is never even an input here, so doing the same
 * weight for more sets can never flag a PR — by design, per the PRD.
 *
 * Pure logic. Saving PRs and showing badges belong to the logger, not this file.
 */
import { epleyE1rm, MAX_EPLEY_REPS } from './e1rm.ts';

/** The three kinds of record. The database's PR table must use these same names. */
export type PrKind = 'true1rm' | 'repMax' | 'e1rm';

/** The fields of a logged set that matter for PRs — mirrors the `sets` table (weights in kg). */
export interface PrCandidateSet {
  reps: number | null;
  weightKg: number | null;
  isWarmup: boolean;
}

/** A lifter's current bests for one exercise, in kg. A missing value means no record yet. */
export interface PrRecords {
  true1RmKg?: number;
  e1RmKg?: number;
  /** Best weight per exact rep count (2 and up), e.g. { 5: 140 } = 5-rep max of 140 kg. */
  repMaxesKg: Record<number, number>;
}

/**
 * One PR a set just earned: which book, the new best (kg) and the best it beat (`previousKg`,
 * absent on a first-ever record). Only rep maxes carry `reps` — which rep count's book it is.
 */
export type PrEvent =
  | { kind: 'true1rm' | 'e1rm'; valueKg: number; previousKg?: number }
  | { kind: 'repMax'; reps: number; valueKg: number; previousKg?: number };

/**
 * How much bigger a new value must be to count. Stops tiny floating-point leftovers — and exact
 * ties — from flagging a PR.
 */
const EPSILON = 1e-6;

/** True when `candidate` beats `current` (or there is no current record yet). */
function beats(candidate: number, current: number | undefined): boolean {
  return current === undefined || candidate > current + EPSILON;
}

/**
 * Which PRs a set earns against the lifter's current bests.
 * Input: the set and the records *before* it. Output: zero or more PR events (one set can earn
 * several — e.g. a heavy 5 is both a 5-rep max and an estimated-1RM PR). Never changes `records`.
 * A set with no previous record in a book counts as a PR in that book (first ever).
 * Sets over 30 reps can be rep maxes but get no e1RM — Epley isn't trusted that far.
 */
export function classifyPrs(set: PrCandidateSet, records: PrRecords): PrEvent[] {
  const { reps, weightKg, isWarmup } = set;
  if (isWarmup) return [];
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) return [];
  if (reps === null || !Number.isInteger(reps) || reps < 1) return [];

  const events: PrEvent[] = [];
  if (reps === 1) {
    if (beats(weightKg, records.true1RmKg)) {
      events.push(withPrevious({ kind: 'true1rm', valueKg: weightKg }, records.true1RmKg));
    }
  } else {
    const previous = records.repMaxesKg[reps];
    if (beats(weightKg, previous)) {
      events.push(withPrevious({ kind: 'repMax', reps, valueKg: weightKg }, previous));
    }
  }
  if (reps <= MAX_EPLEY_REPS) {
    const estimate = epleyE1rm(weightKg, reps);
    if (beats(estimate, records.e1RmKg)) {
      events.push(withPrevious({ kind: 'e1rm', valueKg: estimate }, records.e1RmKg));
    }
  }
  return events;
}

/** Attach the beaten record to an event, leaving the field off entirely for a first-ever PR. */
function withPrevious(event: PrEvent, previousKg: number | undefined): PrEvent {
  return previousKg === undefined ? event : { ...event, previousKg };
}

/** Return new records with a set's PR events applied. Never changes the input. */
function applyPrs(records: PrRecords, events: PrEvent[]): PrRecords {
  const next: PrRecords = { ...records, repMaxesKg: { ...records.repMaxesKg } };
  for (const event of events) {
    if (event.kind === 'repMax') next.repMaxesKg[event.reps] = event.valueKg;
    else if (event.kind === 'true1rm') next.true1RmKg = event.valueKg;
    else next.e1RmKg = event.valueKg;
  }
  return next;
}

/**
 * Rebuild a lifter's records for one exercise from their set history, using exactly the same
 * rules as `classifyPrs`. Used to seed records from history and to recompute them after a set
 * is edited or deleted. Order of sets doesn't change the result.
 */
export function recordsFromSets(sets: PrCandidateSet[]): PrRecords {
  return sets.reduce<PrRecords>(
    (records, set) => applyPrs(records, classifyPrs(set, records)),
    { repMaxesKg: {} },
  );
}
