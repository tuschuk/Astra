// Tests for limits.ts — the phone's copy of the server's rules on a logged set.
import { describe, expect, it } from '@jest/globals';

import {
  assertValidEntryNotes,
  assertValidExerciseName,
  assertValidProgramName,
  assertValidProgramPosition,
  assertValidProgramTargets,
  assertValidProgramWorkoutName,
  assertValidSetFields,
  assertValidSupersetGroup,
  assertValidTeamAnnouncement,
  assertValidTeamName,
  assertValidWorkoutNotes,
  MAX_TEAM_ANNOUNCEMENT_LENGTH,
  assertValidWorkoutTitle,
  MAX_ENTRY_NOTES_LENGTH,
  MAX_TEAM_NAME_LENGTH,
  MAX_EXERCISE_NAME_LENGTH,
  MAX_PROGRAM_NAME_LENGTH,
  MAX_PROGRAM_WORKOUT_NAME_LENGTH,
  MAX_INTEGER,
  MAX_SET_NOTES_LENGTH,
  MAX_SET_SCORE_LENGTH,
  MAX_WORKOUT_NOTES_LENGTH,
  MAX_WORKOUT_TITLE_LENGTH,
  MAX_SMALLINT,
  roundRpeForStorage,
  roundWeightKgForStorage,
} from './limits.ts';
import { displayWeight, lbToKg } from './units.ts';

describe('roundWeightKgForStorage', () => {
  it('rounds to the 2 decimals the server column keeps', () => {
    expect(roundWeightKgForStorage(lbToKg(225))).toBe(102.06);
    expect(roundWeightKgForStorage(100)).toBe(100);
    expect(roundWeightKgForStorage(102.555)).toBe(102.56);
  });

  it('survives a round trip back to the lifter’s pounds', () => {
    for (const lb of [45, 135, 225, 315, 405, 2.5]) {
      expect(displayWeight(roundWeightKgForStorage(lbToKg(lb)), 'lb')).toBe(lb);
    }
  });
});

describe('roundRpeForStorage', () => {
  it('rounds to the 1 decimal the server column keeps', () => {
    expect(roundRpeForStorage(9.55)).toBe(9.6);
    expect(roundRpeForStorage(7.5)).toBe(7.5);
    expect(roundRpeForStorage(8.04)).toBe(8);
  });
});

describe('assertValidSetFields', () => {
  it('accepts a typical set and a set with every optional field empty', () => {
    expect(() =>
      assertValidSetFields({ position: 0, reps: 5, weightKg: 102.06, rpe: 8.5, dropSetPosition: 1, durationSeconds: 0 }),
    ).not.toThrow();
    expect(() =>
      assertValidSetFields({ position: 3, reps: null, weightKg: null, rpe: null, dropSetPosition: null }),
    ).not.toThrow();
  });

  it('accepts the exact edges the server accepts', () => {
    expect(() =>
      assertValidSetFields({
        position: MAX_SMALLINT,
        reps: 0,
        weightKg: 0,
        rpe: 1,
        dropSetPosition: MAX_SMALLINT,
        durationSeconds: MAX_INTEGER,
        score: 'x'.repeat(MAX_SET_SCORE_LENGTH),
      }),
    ).not.toThrow();
    expect(() => assertValidSetFields({ position: 0, weightKg: 9999.99, rpe: 10 })).not.toThrow();
  });

  it.each([
    [{ position: -1 }, /position/],
    [{ position: 1.5 }, /position/],
    [{ position: MAX_SMALLINT + 1 }, /position/],
    [{ position: 0, reps: -1 }, /reps/],
    [{ position: 0, reps: 2.5 }, /reps/],
    [{ position: 0, reps: MAX_INTEGER + 1 }, /reps/],
    [{ position: 0, weightKg: -0.01 }, /weightKg/],
    [{ position: 0, weightKg: 10000 }, /weightKg/],
    [{ position: 0, weightKg: NaN }, /weightKg/],
    [{ position: 0, rpe: 0.9 }, /rpe/],
    [{ position: 0, rpe: 11 }, /rpe/],
    [{ position: 0, dropSetPosition: 0 }, /dropSetPosition/],
    [{ position: 0, durationSeconds: -5 }, /durationSeconds/],
    [{ position: 0, durationSeconds: 1.2 }, /durationSeconds/],
    [{ position: 0, score: 'x'.repeat(MAX_SET_SCORE_LENGTH + 1) }, /score/],
  ])('refuses %o, naming the field', (fields, name) => {
    expect(() => assertValidSetFields(fields)).toThrow(RangeError);
    expect(() => assertValidSetFields(fields)).toThrow(name);
  });

  it('counts score characters the way Postgres char_length does (an emoji is one)', () => {
    const score = '🔥'.repeat(MAX_SET_SCORE_LENGTH);
    expect(score.length).toBe(MAX_SET_SCORE_LENGTH * 2);
    expect(() => assertValidSetFields({ position: 0, score })).not.toThrow();
    expect(() => assertValidSetFields({ position: 0, score: `${score}!` })).toThrow(/score/);
  });

  it('allows an empty or missing score', () => {
    expect(() => assertValidSetFields({ position: 0, score: null })).not.toThrow();
    expect(() => assertValidSetFields({ position: 0, score: '' })).not.toThrow();
  });
});

describe('set notes (assertValidSetFields)', () => {
  it('accepts a note at the 500-character cap and refuses one past it', () => {
    expect(MAX_SET_NOTES_LENGTH).toBe(500);
    expect(() => assertValidSetFields({ position: 0, notes: 'x'.repeat(500) })).not.toThrow();
    expect(() => assertValidSetFields({ position: 0, notes: 'x'.repeat(501) })).toThrow(RangeError);
    expect(() => assertValidSetFields({ position: 0, notes: 'x'.repeat(501) })).toThrow(/notes/);
  });

  it('allows a missing note and counts emoji once', () => {
    expect(() => assertValidSetFields({ position: 0, notes: null })).not.toThrow();
    expect(() => assertValidSetFields({ position: 0, notes: '💪'.repeat(500) })).not.toThrow();
    expect(() => assertValidSetFields({ position: 0, notes: '💪'.repeat(501) })).toThrow(/notes/);
  });
});

describe.each([
  ['assertValidWorkoutTitle', assertValidWorkoutTitle, MAX_WORKOUT_TITLE_LENGTH, 100, /title/],
  ['assertValidWorkoutNotes', assertValidWorkoutNotes, MAX_WORKOUT_NOTES_LENGTH, 2000, /notes/],
  ['assertValidEntryNotes', assertValidEntryNotes, MAX_ENTRY_NOTES_LENGTH, 1000, /notes/],
] as const)('%s', (_name, assertFn, max, expected, field) => {
  it('mirrors the server cap', () => {
    expect(max).toBe(expected);
  });

  it('accepts null, an empty text, under and exactly at the cap', () => {
    expect(() => assertFn(null)).not.toThrow();
    expect(() => assertFn('')).not.toThrow();
    expect(() => assertFn('x'.repeat(max - 1))).not.toThrow();
    expect(() => assertFn('x'.repeat(max))).not.toThrow();
  });

  it('refuses one character over, naming the field', () => {
    expect(() => assertFn('x'.repeat(max + 1))).toThrow(RangeError);
    expect(() => assertFn('x'.repeat(max + 1))).toThrow(field);
  });

  it('counts characters the way Postgres char_length does (an emoji is one)', () => {
    expect(() => assertFn('🏋'.repeat(max))).not.toThrow();
    expect(() => assertFn('🏋'.repeat(max + 1))).toThrow(RangeError);
  });
});

describe('assertValidExerciseName', () => {
  it('mirrors the server cap of 80', () => {
    expect(MAX_EXERCISE_NAME_LENGTH).toBe(80);
  });

  it('accepts 1 through 80 characters', () => {
    expect(() => assertValidExerciseName('x')).not.toThrow();
    expect(() => assertValidExerciseName('x'.repeat(80))).not.toThrow();
  });

  it('refuses an empty name and one over the cap, naming the field', () => {
    expect(() => assertValidExerciseName('')).toThrow(RangeError);
    expect(() => assertValidExerciseName('')).toThrow(/name/);
    expect(() => assertValidExerciseName('x'.repeat(81))).toThrow(/name/);
  });

  it('counts characters the way Postgres char_length does (an emoji is one)', () => {
    expect(() => assertValidExerciseName('🏋'.repeat(80))).not.toThrow();
    expect(() => assertValidExerciseName('🏋'.repeat(81))).toThrow(RangeError);
  });
});

describe('assertValidSupersetGroup', () => {
  it('accepts 1 through the smallint limit', () => {
    expect(() => assertValidSupersetGroup(1)).not.toThrow();
    expect(() => assertValidSupersetGroup(MAX_SMALLINT)).not.toThrow();
  });

  it.each([0, -1, 1.5, MAX_SMALLINT + 1, NaN])('refuses %p, naming the field', (group) => {
    expect(() => assertValidSupersetGroup(group)).toThrow(RangeError);
    expect(() => assertValidSupersetGroup(group)).toThrow(/supersetGroup/);
  });
});

describe('program limits (B34)', () => {
  it('mirror the server caps of 100', () => {
    expect(MAX_PROGRAM_NAME_LENGTH).toBe(100);
    expect(MAX_PROGRAM_WORKOUT_NAME_LENGTH).toBe(100);
  });

  it('assertValidProgramName accepts 1…100 characters and refuses empty or 101', () => {
    expect(() => assertValidProgramName('x')).not.toThrow();
    expect(() => assertValidProgramName('🏋'.repeat(100))).not.toThrow();
    expect(() => assertValidProgramName('')).toThrow(/name/);
    expect(() => assertValidProgramName('x'.repeat(101))).toThrow(RangeError);
  });

  it('assertValidProgramWorkoutName allows none, refuses 101', () => {
    expect(() => assertValidProgramWorkoutName(null)).not.toThrow();
    expect(() => assertValidProgramWorkoutName('x'.repeat(100))).not.toThrow();
    expect(() => assertValidProgramWorkoutName('x'.repeat(101))).toThrow(/name/);
  });

  it('assertValidProgramTargets accepts full and sets-only prescriptions and the edges', () => {
    expect(() =>
      assertValidProgramTargets({ position: 0, targetSets: 3, targetReps: 8, targetWeightKg: 102.06, targetRpe: 8.5 }),
    ).not.toThrow();
    expect(() => assertValidProgramTargets({ position: MAX_SMALLINT, targetSets: 1 })).not.toThrow();
    expect(() =>
      assertValidProgramTargets({
        position: 0,
        targetSets: MAX_SMALLINT,
        targetReps: 0,
        targetWeightKg: 9999.99,
        targetRpe: 10,
      }),
    ).not.toThrow();
  });

  it.each([
    [{ position: -1, targetSets: 3 }, /position/],
    [{ position: 0, targetSets: 0 }, /targetSets/],
    [{ position: 0, targetSets: 2.5 }, /targetSets/],
    [{ position: 0, targetSets: MAX_SMALLINT + 1 }, /targetSets/],
    [{ position: 0, targetSets: 3, targetReps: -1 }, /targetReps/],
    [{ position: 0, targetSets: 3, targetReps: 1.5 }, /targetReps/],
    [{ position: 0, targetSets: 3, targetWeightKg: 10000 }, /targetWeightKg/],
    [{ position: 0, targetSets: 3, targetWeightKg: -1 }, /targetWeightKg/],
    [{ position: 0, targetSets: 3, targetRpe: 11 }, /targetRpe/],
    [{ position: 0, targetSets: 3, targetRpe: 0.5 }, /targetRpe/],
  ])('assertValidProgramTargets refuses %o, naming the field', (fields, name) => {
    expect(() => assertValidProgramTargets(fields)).toThrow(RangeError);
    expect(() => assertValidProgramTargets(fields)).toThrow(name);
  });

  it('assertValidProgramPosition refuses negatives, fractions and overflow', () => {
    expect(() => assertValidProgramPosition(0)).not.toThrow();
    for (const bad of [-1, 0.5, MAX_SMALLINT + 1]) expect(() => assertValidProgramPosition(bad)).toThrow(/position/);
  });
});

describe('team limits (B36)', () => {
  it('mirror the server cap of 80', () => {
    expect(MAX_TEAM_NAME_LENGTH).toBe(80);
  });

  it('assertValidTeamName accepts 1…80 characters (an emoji counted once) and refuses empty or 81', () => {
    expect(() => assertValidTeamName('x')).not.toThrow();
    expect(() => assertValidTeamName('🏋'.repeat(80))).not.toThrow();
    expect(() => assertValidTeamName('')).toThrow(/empty/);
    expect(() => assertValidTeamName('x'.repeat(81))).toThrow(RangeError);
  });

  it('assertValidTeamAnnouncement accepts 1…2000 characters (an emoji counted once) and refuses empty or 2001', () => {
    expect(MAX_TEAM_ANNOUNCEMENT_LENGTH).toBe(2000);
    expect(() => assertValidTeamAnnouncement('x')).not.toThrow();
    expect(() => assertValidTeamAnnouncement('🏋'.repeat(2000))).not.toThrow();
    expect(() => assertValidTeamAnnouncement('')).toThrow(/empty/);
    expect(() => assertValidTeamAnnouncement('x'.repeat(2001))).toThrow(RangeError);
  });
});
