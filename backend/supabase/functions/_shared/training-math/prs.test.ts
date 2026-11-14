// Tests for prs.ts — PR classification and rebuilding records from history.
import { describe, expect, it } from '@jest/globals';

import { classifyPrs, recordsFromSets, type PrCandidateSet, type PrRecords } from './prs.ts';

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
