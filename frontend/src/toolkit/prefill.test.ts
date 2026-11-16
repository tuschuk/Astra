/**
 * Tests for Tool Kit prefill (TK-6): which exercise counts as "in progress", which set the
 * numbers come from, what each calculator box receives in each unit (expectations computed
 * through `@training-math`, never re-derived), the gates that keep unusable values out of the
 * boxes, and the write-once-per-source rule that lets the lifter's own typing survive a reopen.
 * Synthetic rows only — nothing here touches a database.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import { displayWeight, epleyE1rm } from '@training-math';

import type { PersonalRecordRow, SetRow } from '@/db/dao';
import type { ActiveEntry } from '@/workout/activeWorkout';

import { applyToolKitPrefill, buildToolKitPrefill, focusedEntry, resetToolKitPrefill } from './prefill';
import { getToolKitSession, resetToolKitSession, updateToolKitSession } from './session';

afterEach(() => {
  resetToolKitSession();
  resetToolKitPrefill();
});

/** A logged set; `at` is the minute it was logged (so ordering reads at a glance). */
function set(id: string, at: number, fields: Partial<SetRow> = {}): SetRow {
  const created = new Date(Date.UTC(2026, 10, 15, 10, at)).toISOString();
  return {
    id,
    workout_exercise_id: 'we',
    position: 0,
    reps: 5,
    weight_kg: 100,
    rpe: null,
    is_warmup: false,
    drop_set_position: null,
    duration_seconds: null,
    score: null,
    notes: null,
    created_at: created,
    updated_at: created,
    ...fields,
  };
}

/** One exercise of the workout with these sets (positions follow the array order). */
function entry(id: string, sets: SetRow[], exerciseId = `ex-${id}`): ActiveEntry {
  return {
    id,
    workout_id: 'w',
    exercise_id: exerciseId,
    position: 0,
    notes: null,
    superset_group: null,
    created_at: '2026-11-15T10:00:00.000Z',
    updated_at: '2026-11-15T10:00:00.000Z',
    sets: sets.map((s, i) => ({ ...s, workout_exercise_id: id, position: i })),
  };
}

/** A stored record book for the exercise. */
function record(kind: PersonalRecordRow['kind'], valueKg: number, reps: number | null = null): PersonalRecordRow {
  return {
    id: `pr-${kind}-${reps ?? ''}`,
    user_id: 'u',
    exercise_id: 'ex',
    kind,
    reps,
    value_kg: valueKg,
    source_set_id: 's',
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
  };
}

describe('focusedEntry', () => {
  it('picks the exercise holding the most recently logged set, wherever it sits', () => {
    const squat = entry('squat', [set('s1', 1), set('s2', 9)]);
    const bench = entry('bench', [set('b1', 5)]);
    expect(focusedEntry([squat, bench])?.id).toBe('squat');
    expect(focusedEntry([bench, squat])?.id).toBe('squat');
  });

  it('breaks an exact time tie by position: the later exercise wins', () => {
    const a = entry('a', [set('a1', 3)]);
    const b = entry('b', [set('b1', 3)]);
    expect(focusedEntry([a, b])?.id).toBe('b');
  });

  it('falls back to the last exercise added when nothing is logged yet', () => {
    expect(focusedEntry([entry('a', []), entry('b', [])])?.id).toBe('b');
  });

  it('is null for a workout with no exercises', () => {
    expect(focusedEntry([])).toBeNull();
  });
});

describe('buildToolKitPrefill', () => {
  it('fills every calculator from the last set in kg, with the stored e1RM as the 1RM', () => {
    const bench = entry('bench', [set('b1', 1, { weight_kg: 90 }), set('b2', 2, { weight_kg: 100, reps: 5, rpe: 8 })]);
    const prefill = buildToolKitPrefill(bench, [record('true1rm', 115), record('e1rm', 120)], 'kg', 'kg');
    expect(prefill).toMatchObject({
      oneRm: { weight: '100', reps: '5' },
      rpe: { oneRm: '120', reps: 5, rpe: 8 },
      percent: { oneRm: '120' },
      plates: { target: '100' },
    });
    // The percent box is never filled: a load is not a percentage.
    expect(prefill?.percent).not.toHaveProperty('percent');
  });

  it('writes weights in the display unit, and the plate target in the rack unit', () => {
    const bench = entry('bench', [set('b1', 1, { weight_kg: 102.058 })]);
    const prefill = buildToolKitPrefill(bench, [record('e1rm', 118.5)], 'lb', 'kg');
    expect(prefill?.oneRm.weight).toBe(String(displayWeight(102.058, 'lb')));
    expect(prefill?.rpe.oneRm).toBe(String(displayWeight(118.5, 'lb')));
    expect(prefill?.percent.oneRm).toBe(String(displayWeight(118.5, 'lb')));
    expect(prefill?.plates.target).toBe(String(displayWeight(102.058, 'kg')));

    const lbRack = buildToolKitPrefill(bench, [], 'kg', 'lb');
    expect(lbRack?.oneRm.weight).toBe(String(displayWeight(102.058, 'kg')));
    expect(lbRack?.plates.target).toBe(String(displayWeight(102.058, 'lb')));
  });

  it('takes warm-ups and drops as the source set too (the next warm-up needs plates)', () => {
    const squat = entry('squat', [set('w1', 1, { weight_kg: 60, is_warmup: true })]);
    expect(buildToolKitPrefill(squat, [], 'kg', 'kg')?.plates.target).toBe('60');
    const drop = entry('bench', [set('t', 1, { weight_kg: 100 }), set('d', 2, { weight_kg: 80, drop_set_position: 1 })]);
    expect(buildToolKitPrefill(drop, [], 'kg', 'kg')?.oneRm.weight).toBe('80');
  });

  it('uses the set logged last even when a later position was logged earlier', () => {
    const bench = entry('bench', [set('b1', 7, { weight_kg: 110 }), set('b2', 3, { weight_kg: 90 })]);
    expect(buildToolKitPrefill(bench, [], 'kg', 'kg')?.oneRm.weight).toBe('110');
  });

  it('falls back to the Epley estimate of the last set when no record is stored', () => {
    const bench = entry('bench', [set('b1', 1, { weight_kg: 100, reps: 5 })]);
    const expected = String(displayWeight(epleyE1rm(100, 5), 'kg'));
    const prefill = buildToolKitPrefill(bench, [record('repMax', 100, 5)], 'kg', 'kg');
    expect(prefill?.rpe.oneRm).toBe(expected);
    expect(prefill?.percent.oneRm).toBe(expected);
  });

  it('offers no 1RM when there is neither a record nor a set Epley can read', () => {
    const timed = entry('plank', [set('p1', 1, { weight_kg: null, reps: null, duration_seconds: 60 })]);
    expect(buildToolKitPrefill(timed, [], 'kg', 'kg')).toBeNull();
    const tooMany = entry('bench', [set('b1', 1, { weight_kg: 40, reps: 40 })]);
    const prefill = buildToolKitPrefill(tooMany, [], 'kg', 'kg');
    expect(prefill?.rpe).not.toHaveProperty('oneRm');
    expect(prefill?.oneRm).toEqual({ weight: '40' });
  });

  it('fills only the 1RM boxes for an exercise with records but no set yet', () => {
    const prefill = buildToolKitPrefill(entry('bench', []), [record('e1rm', 130)], 'kg', 'kg');
    expect(prefill).toMatchObject({ oneRm: {}, rpe: { oneRm: '130' }, percent: { oneRm: '130' }, plates: {} });
  });

  it('is null with no sets and no records (a brand-new lift: boxes untouched)', () => {
    expect(buildToolKitPrefill(entry('bench', []), [], 'kg', 'kg')).toBeNull();
  });

  it('sets the RPE chips only to values a chip exists for', () => {
    const at = (rpe: number) => buildToolKitPrefill(entry('b', [set('s', 1, { rpe })]), [], 'kg', 'kg')?.rpe.rpe;
    expect(at(7.5)).toBe(7.5);
    expect(at(10)).toBe(10);
    expect(at(7.3)).toBeUndefined();
    expect(at(5)).toBeUndefined();
  });

  it('sets the RPE rep chips only within the chart; the 1RM reps box takes up to 30', () => {
    const fifteen = buildToolKitPrefill(entry('b', [set('s', 1, { reps: 15 })]), [], 'kg', 'kg');
    expect(fifteen?.rpe).not.toHaveProperty('reps');
    expect(fifteen?.oneRm.reps).toBe('15');
  });

  it('never seeds a zero: no 0 weight, no 0 reps', () => {
    const zero = buildToolKitPrefill(entry('b', [set('s', 1, { weight_kg: 0, reps: 0 })]), [], 'kg', 'kg');
    expect(zero).toBeNull();
    const bodyweight = buildToolKitPrefill(entry('b', [set('s', 1, { weight_kg: 0, reps: 10 })]), [], 'kg', 'kg');
    expect(bodyweight).toMatchObject({ oneRm: { reps: '10' }, rpe: { reps: 10 }, plates: {} });
    expect(bodyweight?.oneRm).not.toHaveProperty('weight');
  });
});

describe('applyToolKitPrefill', () => {
  const first = entry('bench', [set('b1', 1, { weight_kg: 100, reps: 5, rpe: 8 })]);

  it('merges only the boxes it has values for', () => {
    updateToolKitSession('percent', { percent: '85' });
    updateToolKitSession('rpe', { rpe: 9 });
    const prefill = buildToolKitPrefill(entry('b', [set('s', 1, { weight_kg: 100, reps: 3 })]), [], 'kg', 'kg');
    applyToolKitPrefill(prefill);
    const session = getToolKitSession();
    expect(session.percent.percent).toBe('85');
    expect(session.rpe).toMatchObject({ reps: 3, rpe: 9 });
    expect(session.oneRm).toEqual({ weight: '100', reps: '3' });
  });

  it('does not write the same prefill twice: typed numbers survive a reopen', () => {
    applyToolKitPrefill(buildToolKitPrefill(first, [], 'kg', 'kg'));
    updateToolKitSession('oneRm', { weight: '102.5' });
    applyToolKitPrefill(buildToolKitPrefill(first, [], 'kg', 'kg'));
    expect(getToolKitSession().oneRm.weight).toBe('102.5');
  });

  it('writes again once a new set is logged, even one with the same numbers', () => {
    applyToolKitPrefill(buildToolKitPrefill(first, [], 'kg', 'kg'));
    updateToolKitSession('oneRm', { weight: '102.5' });
    const repeated = entry('bench', [...first.sets, set('b2', 2, { weight_kg: 100, reps: 5, rpe: 8 })]);
    applyToolKitPrefill(buildToolKitPrefill(repeated, [], 'kg', 'kg'));
    expect(getToolKitSession().oneRm.weight).toBe('100');
  });

  it('writes again when the source set is fixed, removed, or the unit changes', () => {
    applyToolKitPrefill(buildToolKitPrefill(first, [], 'kg', 'kg'));
    updateToolKitSession('oneRm', { weight: '1' });
    const fixed = entry('bench', [{ ...first.sets[0]!, weight_kg: 105 }]);
    applyToolKitPrefill(buildToolKitPrefill(fixed, [], 'kg', 'kg'));
    expect(getToolKitSession().oneRm.weight).toBe('105');

    applyToolKitPrefill(buildToolKitPrefill(fixed, [], 'lb', 'lb'));
    expect(getToolKitSession().oneRm.weight).toBe(String(displayWeight(105, 'lb')));

    // Two sets, the newest removed: the source falls back to the earlier one.
    const two = entry('bench', [set('a', 1, { weight_kg: 80 }), set('b', 2, { weight_kg: 90 })]);
    applyToolKitPrefill(buildToolKitPrefill(two, [], 'kg', 'kg'));
    expect(getToolKitSession().oneRm.weight).toBe('90');
    applyToolKitPrefill(buildToolKitPrefill(entry('bench', [two.sets[0]!]), [], 'kg', 'kg'));
    expect(getToolKitSession().oneRm.weight).toBe('80');
  });

  it('a change in one calculator’s values (the rack unit) refills that one alone', () => {
    applyToolKitPrefill(buildToolKitPrefill(first, [], 'kg', 'kg'));
    updateToolKitSession('oneRm', { weight: '102.5' });
    updateToolKitSession('plates', { target: '1' });
    applyToolKitPrefill(buildToolKitPrefill(first, [], 'kg', 'lb'));
    expect(getToolKitSession().plates.target).toBe(String(displayWeight(100, 'lb')));
    expect(getToolKitSession().oneRm.weight).toBe('102.5');
  });

  it('writes again for a newly added exercise with records but no sets', () => {
    applyToolKitPrefill(buildToolKitPrefill(first, [record('e1rm', 120)], 'kg', 'kg'));
    updateToolKitSession('percent', { oneRm: '999' });
    applyToolKitPrefill(buildToolKitPrefill(entry('squat', []), [record('e1rm', 160)], 'kg', 'kg'));
    expect(getToolKitSession().percent.oneRm).toBe('160');
    // The bench numbers it had nothing to replace are left in the boxes.
    expect(getToolKitSession().oneRm.weight).toBe('100');
  });

  it('does nothing with no prefill', () => {
    applyToolKitPrefill(null);
    expect(getToolKitSession().oneRm).toEqual({ weight: '', reps: '' });
  });
});
