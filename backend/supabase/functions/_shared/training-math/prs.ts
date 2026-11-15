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

/**
 * True when `candidate` beats `current` (or there is no current record yet) — the one "is this
 * bigger enough to count?" rule. Exported so code that compares against records it has SAVED
 * (the logger's PR persistence) asks exactly the same question the classifier does, instead of
 * inventing its own tolerance.
 */
export function beatsRecord(candidate: number, current: number | undefined): boolean {
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
    if (beatsRecord(weightKg, records.true1RmKg)) {
      events.push(withPrevious({ kind: 'true1rm', valueKg: weightKg }, records.true1RmKg));
    }
  } else {
    const previous = records.repMaxesKg[reps];
    if (beatsRecord(weightKg, previous)) {
      events.push(withPrevious({ kind: 'repMax', reps, valueKg: weightKg }, previous));
    }
  }
  if (reps <= MAX_EPLEY_REPS) {
    const estimate = epleyE1rm(weightKg, reps);
    if (beatsRecord(estimate, records.e1RmKg)) {
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
 * One record book's current best, and which set holds it.
 *   - `kind` / `reps`: which book (only rep maxes carry `reps`, the rep count of their book);
 *   - `valueKg`: the best, in kg (for e1rm, the Epley estimate);
 *   - `ref`: whatever the caller attached to the set that set it — the logger passes the set's
 *     database id, so a saved record can point at its proof.
 */
export type RecordBook<Ref> =
  | { kind: 'true1rm' | 'e1rm'; valueKg: number; ref: Ref }
  | { kind: 'repMax'; reps: number; valueKg: number; ref: Ref };

/** A logged set plus the caller's label for it (see `RecordBook.ref`). */
export type RefSet<Ref> = PrCandidateSet & { ref: Ref };

/** Where each kind of book sits in a list of records. */
const KIND_RANK: Record<PrKind, number> = { true1rm: 0, e1rm: 1, repMax: 2 };

/**
 * The one order records are listed in everywhere — true 1RM, e1RM, then rep maxes from fewest
 * reps up — for anything with a kind and (for rep maxes) a rep count: a folded book or a saved
 * record row. Use it with `Array.sort`.
 */
export function compareRecordBooks(
  a: { kind: PrKind; reps?: number | null },
  b: { kind: PrKind; reps?: number | null },
): number {
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.reps ?? 0) - (b.reps ?? 0);
}

/**
 * Rebuild every record book for one exercise from its set history, remembering which set holds
 * each best. Input: the sets in the order they were logged, each with a `ref`. Output: one entry
 * per book that has a record, ordered true 1RM, e1RM, then rep maxes by rep count.
 *
 * Uses `classifyPrs` set by set — so the rules are exactly the classifier's (warm-ups, weightless
 * sets and volume never count). A tie never beats a record, so when two sets tie the EARLIER one
 * keeps it: the lifter set that record first. Why it exists: saving PRs needs the proof (which
 * set), which `recordsFromSets` alone throws away.
 */
export function recordBooks<Ref>(sets: readonly RefSet<Ref>[]): RecordBook<Ref>[] {
  let records: PrRecords = { repMaxesKg: {} };
  const books = new Map<string, RecordBook<Ref>>();
  for (const set of sets) {
    const events = classifyPrs(set, records);
    records = applyPrs(records, events);
    for (const event of events) {
      if (event.kind === 'repMax') {
        books.set(`repMax:${event.reps}`, { kind: 'repMax', reps: event.reps, valueKg: event.valueKg, ref: set.ref });
      } else {
        books.set(event.kind, { kind: event.kind, valueKg: event.valueKg, ref: set.ref });
      }
    }
  }
  return [...books.values()].sort(compareRecordBooks);
}

/**
 * Rebuild a lifter's records for one exercise from their set history, using exactly the same
 * rules as `classifyPrs` (it is `recordBooks` with the "which set" part dropped). Used to seed
 * records from history and to recompute them after a set is edited or deleted. Order of sets
 * doesn't change the result.
 */
export function recordsFromSets(sets: readonly PrCandidateSet[]): PrRecords {
  const records: PrRecords = { repMaxesKg: {} };
  for (const book of recordBooks(sets.map((set) => ({ ...set, ref: null })))) {
    if (book.kind === 'repMax') records.repMaxesKg[book.reps] = book.valueKg;
    else if (book.kind === 'true1rm') records.true1RmKg = book.valueKg;
    else records.e1RmKg = book.valueKg;
  }
  return records;
}
