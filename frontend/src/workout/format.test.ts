/**
 * Tests for the logger's text helpers: how sets, "last time", dates and durations are written,
 * and how the reps / weight boxes are read.
 */
import { describe, expect, it } from '@jest/globals';
import { lbToKg, roundWeightKgForStorage } from '@training-math';

import {
  countLabel,
  formatLastTime,
  formatSet,
  formatWeight,
  parseNumberInput,
  setErrorMessage,
  totalSets,
  workoutDateLabel,
  workoutDetailsLabel,
  workoutDurationLabel,
} from './format';

/** 185 lb as the store saves it (converted, rounded to the column's 2 decimals). */
const KG_185LB = roundWeightKgForStorage(lbToKg(185));

describe('formatWeight / formatSet', () => {
  it('shows a stored kg weight in the lifter unit, rounded for display', () => {
    expect(formatWeight(KG_185LB, 'lb')).toBe('185 lb');
    expect(formatWeight(100, 'kg')).toBe('100 kg');
    expect(formatWeight(100, 'lb')).toBe('220.5 lb');
  });

  /** A plain work set with no RPE — the common case. */
  const work = (reps: number | null, weight_kg: number | null) => ({ reps, weight_kg, rpe: null, is_warmup: false });

  it('writes reps × weight, or whichever part was entered', () => {
    expect(formatSet(work(8, KG_185LB), 'lb')).toBe('8 × 185 lb');
    expect(formatSet(work(12, null), 'lb')).toBe('12 reps');
    expect(formatSet(work(1, null), 'lb')).toBe('1 rep');
    expect(formatSet(work(null, 20), 'kg')).toBe('20 kg');
    expect(formatSet(work(null, null), 'kg')).toBe('—');
  });

  it('marks a warm-up with "W · " and appends an RPE', () => {
    expect(formatSet({ ...work(8, roundWeightKgForStorage(lbToKg(135))), is_warmup: true }, 'lb')).toBe(
      'W · 8 × 135 lb',
    );
    expect(formatSet({ ...work(8, KG_185LB), rpe: 8.5 }, 'lb')).toBe('8 × 185 lb @ RPE 8.5');
    expect(formatSet({ ...work(10, null), rpe: 9 }, 'kg')).toBe('10 reps @ RPE 9');
    expect(formatSet({ reps: 5, weight_kg: 60, rpe: 6, is_warmup: true }, 'kg')).toBe('W · 5 × 60 kg @ RPE 6');
  });
});

describe('formatLastTime', () => {
  /** A past set: reps at kg, a work set unless `warmup`. */
  const past = (reps: number | null, weight_kg: number | null, is_warmup = false) => ({ reps, weight_kg, is_warmup });

  it('groups runs of identical sets', () => {
    const sets = [past(8, KG_185LB), past(8, KG_185LB), past(8, KG_185LB), past(6, KG_185LB)];
    expect(formatLastTime(sets, 'lb')).toBe('3 × 8 @ 185 lb, 6 @ 185 lb');
  });

  it('only groups neighbours, and handles missing reps or weight', () => {
    const sets = [past(5, 100), past(3, 100), past(5, 100), past(10, null), past(null, 50), past(null, 50)];
    expect(formatLastTime(sets, 'kg')).toBe('5 @ 100 kg, 3 @ 100 kg, 5 @ 100 kg, 10 reps, 2 × 50 kg');
  });

  it('leaves warm-up sets out, so work sets around them still group (LOG-14)', () => {
    const sets = [past(10, 20, true), past(5, 60, true), past(5, 100), past(5, 100), past(5, 100)];
    expect(formatLastTime(sets, 'kg')).toBe('3 × 5 @ 100 kg');
  });

  it('is empty for no sets, or only warm-ups', () => {
    expect(formatLastTime([], 'lb')).toBe('');
    expect(formatLastTime([past(10, 20, true)], 'lb')).toBe('');
  });
});

describe('workoutDateLabel / workoutDurationLabel / countLabel', () => {
  it('names a workout by its local start date', () => {
    // Built from local parts so the test holds in any time zone.
    expect(workoutDateLabel(new Date(2026, 10, 14, 12, 0).toISOString())).toBe('Sat, Nov 14, 2026');
    expect(workoutDateLabel(new Date(2027, 0, 3, 7, 30).toISOString())).toBe('Sun, Jan 3, 2027');
  });

  it('rounds the duration to minutes and switches to hours past 60', () => {
    const start = '2026-11-14T09:00:00.000Z';
    expect(workoutDurationLabel(start, '2026-11-14T09:44:40.000Z')).toBe('45 min');
    expect(workoutDurationLabel(start, '2026-11-14T10:05:00.000Z')).toBe('1 h 5 min');
    expect(workoutDurationLabel(start, '2026-11-14T11:00:00.000Z')).toBe('2 h');
    expect(workoutDurationLabel(start, start)).toBe('0 min');
    expect(workoutDurationLabel(start, null)).toBe('');
  });

  it('adds up sets and writes the details line', () => {
    expect(totalSets([{ sets: [1, 2] }, { sets: [] }, { sets: [3] }])).toBe(3);
    const workout = { started_at: '2026-11-14T09:00:00.000Z', ended_at: '2026-11-14T09:58:00.000Z' };
    expect(workoutDetailsLabel(workout, 3, 12)).toBe('58 min · 3 exercises · 12 sets');
    expect(workoutDetailsLabel({ ...workout, ended_at: null }, 1, 1)).toBe('1 exercise · 1 set');
  });

  it('pluralises counts', () => {
    expect(countLabel(1, 'set')).toBe('1 set');
    expect(countLabel(0, 'set')).toBe('0 sets');
    expect(countLabel(3, 'exercise')).toBe('3 exercises');
  });
});

describe('parseNumberInput', () => {
  it('reads plain numbers, decimals and comma decimals', () => {
    expect(parseNumberInput('185')).toEqual({ ok: true, value: 185 });
    expect(parseNumberInput(' 102.5 ')).toEqual({ ok: true, value: 102.5 });
    expect(parseNumberInput('102,5')).toEqual({ ok: true, value: 102.5 });
    expect(parseNumberInput('.5')).toEqual({ ok: true, value: 0.5 });
    expect(parseNumberInput('5.')).toEqual({ ok: true, value: 5 });
  });

  it('treats an empty box as "not entered"', () => {
    expect(parseNumberInput('')).toEqual({ ok: true, value: null });
    expect(parseNumberInput('   ')).toEqual({ ok: true, value: null });
  });

  it('refuses anything that is not a plain non-negative number', () => {
    for (const text of ['abc', '-5', '1e3', '0x10', '1.2.3', '5 kg', 'Infinity']) {
      expect(parseNumberInput(text)).toEqual({ ok: false });
    }
  });
});

describe('setErrorMessage', () => {
  it('names the refused field in plain words', () => {
    expect(setErrorMessage(new RangeError('reps must be a whole number from 0 to 2147483647, got 8.5'))).toBe(
      'Reps must be a whole number.',
    );
    expect(setErrorMessage(new RangeError('weightKg must be at least 0 and below 10000, got 12000'))).toBe(
      'That weight is too big to save.',
    );
    expect(setErrorMessage(new RangeError('rpe must be from 1 to 10, got 11'))).toBe('RPE goes from 1 to 10.');
    expect(setErrorMessage(new RangeError('position must be…'))).toBe('That set has a value Astra can’t save.');
    expect(setErrorMessage(new Error('disk full'))).toBe('That set couldn’t be saved. Try again.');
  });
});
