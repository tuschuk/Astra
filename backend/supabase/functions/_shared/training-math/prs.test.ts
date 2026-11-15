// Tests for prs.ts — PR classification and rebuilding records from history.
import { describe, expect, it } from '@jest/globals';

import {
  beatsRecord,
  classifyPrs,
  compareRecordBooks,
  recordBooks,
  recordsFromSets,
  type PrCandidateSet,
  type PrRecords,
} from './prs.ts';

const set = (weightKg: number | null, reps: number | null, isWarmup = false): PrCandidateSet => ({
  weightKg,
  reps,
  isWarmup,
});
const NONE: PrRecords = { repMaxesKg: {} };

describe('classifyPrs', () => {
  it('flags a heavier single as a true 1RM (and e1RM) PR — never as a 1-rep max', () => {
    const records: PrRecords = { true1RmKg: 100, e1RmKg: 105, repMaxesKg: {} };
    expect(classifyPrs(set(110, 1), records)).toEqual([
      { kind: 'true1rm', valueKg: 110, previousKg: 100 },
      { kind: 'e1rm', valueKg: 110, previousKg: 105 },
    ]);
  });

  it('flags a 5-rep weight jump as a 5RM and an e1RM PR', () => {
    const records: PrRecords = { e1RmKg: 150, repMaxesKg: { 5: 120 } };
    const events = classifyPrs(set(130, 5), records);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'repMax', reps: 5, valueKg: 130, previousKg: 120 });
    expect(events[1].kind).toBe('e1rm');
    expect(events[1].valueKg).toBeCloseTo(151.6667, 4);
    expect(events[1].previousKg).toBe(150);
  });

  it('only compares a set against its exact rep count', () => {
    // 5 × 100 is a 5RM candidate only — a 3RM of 105 doesn't stop it, a 5RM of 100 does.
    const records: PrRecords = { e1RmKg: 200, repMaxesKg: { 3: 105 } };
    expect(classifyPrs(set(100, 5), records)).toEqual([{ kind: 'repMax', reps: 5, valueKg: 100 }]);
    expect(classifyPrs(set(100, 5), { e1RmKg: 200, repMaxesKg: { 5: 100 } })).toEqual([]);
  });

  it('flags only an e1RM PR when the rep max stands', () => {
    // 3 × 140 (e1RM 154) beats e1RM 150 but not the 3RM of 145.
    const events = classifyPrs(set(140, 3), { e1RmKg: 150, repMaxesKg: { 3: 145 } });
    expect(events.map((e) => e.kind)).toEqual(['e1rm']);
  });

  it('flags every book on the first ever set', () => {
    expect(classifyPrs(set(60, 8), NONE)).toEqual([
      { kind: 'repMax', reps: 8, valueKg: 60 },
      { kind: 'e1rm', valueKg: 76 },
    ]);
    expect(classifyPrs(set(100, 1), NONE)).toEqual([
      { kind: 'true1rm', valueKg: 100 },
      { kind: 'e1rm', valueKg: 100 },
    ]);
  });

  it('never flags a warm-up, however heavy', () => {
    expect(classifyPrs(set(500, 1, true), NONE)).toEqual([]);
    expect(classifyPrs(set(500, 5, true), { true1RmKg: 100, repMaxesKg: {} })).toEqual([]);
  });

  it('never flags a volume-only improvement', () => {
    // Same weight × reps, more sets — and records already reflect the first set.
    const history = [set(100, 5)];
    const records = recordsFromSets(history);
    for (let extraSet = 0; extraSet < 10; extraSet++) {
      expect(classifyPrs(set(100, 5), records)).toEqual([]);
    }
    // Lighter weight for more reps at a lower e1RM is also volume, not a PR.
    expect(classifyPrs(set(80, 5), records)).toEqual([]);
  });

  it('does not flag exact ties or float-noise "improvements"', () => {
    const records: PrRecords = { true1RmKg: 100, e1RmKg: 100, repMaxesKg: {} };
    expect(classifyPrs(set(100, 1), records)).toEqual([]);
    expect(classifyPrs(set(100 + 1e-9, 1), records)).toEqual([]);
  });

  it('ignores sets with no weight, zero weight, or no reps', () => {
    expect(classifyPrs(set(null, 20), NONE)).toEqual([]);
    expect(classifyPrs(set(0, 5), NONE)).toEqual([]);
    expect(classifyPrs(set(100, 0), NONE)).toEqual([]);
    expect(classifyPrs(set(100, null), NONE)).toEqual([]);
    expect(classifyPrs(set(100, 2.5), NONE)).toEqual([]);
  });

  it('gives sets over 30 reps a rep max but no e1RM', () => {
    expect(classifyPrs(set(40, 40), NONE)).toEqual([{ kind: 'repMax', reps: 40, valueKg: 40 }]);
  });

  it('does not change the records it is given', () => {
    const records: PrRecords = { true1RmKg: 100, repMaxesKg: { 5: 80 } };
    classifyPrs(set(120, 1), records);
    classifyPrs(set(90, 5), records);
    expect(records).toEqual({ true1RmKg: 100, repMaxesKg: { 5: 80 } });
  });
});

describe('recordsFromSets', () => {
  const history = [
    set(60, 5, true), // warm-up: ignored
    set(100, 5),
    set(110, 3),
    set(120, 1),
    set(105, 5),
    set(100, 5), // repeat: no change
    set(null, 15), // bodyweight: ignored
  ];

  it('folds a history into the best of each book', () => {
    const records = recordsFromSets(history);
    expect(records.true1RmKg).toBe(120);
    expect(records.repMaxesKg).toEqual({ 3: 110, 5: 105 });
    expect(records.e1RmKg).toBeCloseTo(122.5, 10); // 105 × 5 → 122.5 beats 110 × 3 → 121
  });

  it('gives the same records whatever the order', () => {
    expect(recordsFromSets([...history].reverse())).toEqual(recordsFromSets(history));
  });

  it('returns empty records for an empty or all-warm-up history', () => {
    expect(recordsFromSets([])).toEqual({ repMaxesKg: {} });
    expect(recordsFromSets([set(200, 1, true)])).toEqual({ repMaxesKg: {} });
  });

  it('agrees with classifyPrs: a set flags iff it would raise the rebuilt records', () => {
    const records = recordsFromSets(history);
    expect(classifyPrs(set(105, 5), records)).toEqual([]);
    expect(classifyPrs(set(106, 5), records).map((e) => e.kind)).toEqual(['repMax', 'e1rm']);
  });
});

describe('recordBooks', () => {
  const ref = <R>(s: PrCandidateSet, r: R) => ({ ...s, ref: r });

  it('names the set that holds each book, books ordered true 1RM, e1RM, rep maxes by reps', () => {
    const books = recordBooks([
      ref(set(60, 5, true), 'warmup'),
      ref(set(100, 5), 'a'),
      ref(set(110, 3), 'b'),
      ref(set(120, 1), 'c'),
      ref(set(105, 5), 'd'),
    ]);
    expect(books.map((b) => [b.kind, b.kind === 'repMax' ? b.reps : null, b.ref])).toEqual([
      ['true1rm', null, 'c'],
      ['e1rm', null, 'd'], // 105 × 5 → 122.5 beats 120 × 1 and 110 × 3
      ['repMax', 3, 'b'],
      ['repMax', 5, 'd'],
    ]);
    expect(books[0].valueKg).toBe(120);
    expect(books[1].valueKg).toBeCloseTo(122.5, 10);
  });

  it('keeps the EARLIER set on a tie', () => {
    const books = recordBooks([ref(set(100, 5), 'first'), ref(set(100, 5), 'second')]);
    expect(books.every((b) => b.ref === 'first')).toBe(true);
  });

  it('never moves a book for a volume-only repeat, or for warm-ups and weightless sets', () => {
    const books = recordBooks([
      ref(set(100, 5), 'top'),
      ...Array.from({ length: 5 }, (_, i) => ref(set(100, 5), `again${i}`)),
      ref(set(80, 10), 'lighter'), // e1RM 106.7 < 116.7, a new 10RM book though
      ref(set(500, 1, true), 'warmup'),
      ref(set(null, 20), 'bodyweight'),
    ]);
    expect(books.map((b) => b.ref)).toEqual(['top', 'top', 'lighter']);
  });

  it('returns nothing for an empty or all-warm-up history', () => {
    expect(recordBooks([])).toEqual([]);
    expect(recordBooks([ref(set(200, 1, true), 1)])).toEqual([]);
  });

  it('gives the same values as recordsFromSets', () => {
    const history = [set(100, 5), set(110, 3), set(120, 1), set(105, 5)];
    const fromBooks: PrRecords = { repMaxesKg: {} };
    for (const b of recordBooks(history.map((s, i) => ref(s, i)))) {
      if (b.kind === 'repMax') fromBooks.repMaxesKg[b.reps] = b.valueKg;
      else if (b.kind === 'true1rm') fromBooks.true1RmKg = b.valueKg;
      else fromBooks.e1RmKg = b.valueKg;
    }
    expect(fromBooks).toEqual(recordsFromSets(history));
  });
});

describe('compareRecordBooks', () => {
  it('lists true 1RM, e1RM, then rep maxes from fewest reps up — for books and saved rows alike', () => {
    const rows = [
      { kind: 'repMax' as const, reps: 8 },
      { kind: 'e1rm' as const, reps: null },
      { kind: 'repMax' as const, reps: 3 },
      { kind: 'true1rm' as const },
    ];
    expect([...rows].sort(compareRecordBooks).map((r) => `${r.kind}${r.reps ?? ''}`)).toEqual([
      'true1rm',
      'e1rm',
      'repMax3',
      'repMax8',
    ]);
  });
});

describe('beatsRecord', () => {
  it('counts a first-ever value and a real improvement, never a tie or float noise', () => {
    expect(beatsRecord(50, undefined)).toBe(true);
    expect(beatsRecord(100.001, 100)).toBe(true);
    expect(beatsRecord(100, 100)).toBe(false);
    expect(beatsRecord(100 + 1e-9, 100)).toBe(false);
    expect(beatsRecord(99, 100)).toBe(false);
  });
});
