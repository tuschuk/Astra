/**
 * Catalog tests — the deduplicated per-exercise view of the seed data that
 * the Library tab (and later logging/PRs) consume.
 */
import { describe, expect, it } from '@jest/globals';

import {
  ALL_EXERCISES,
  ALL_EXERCISE_NAMES,
  PATTERN_BODY,
  canonicalExerciseName,
  searchExercises,
  slugify,
} from './catalog';
import { MOVEMENT_PATTERNS } from './exercises';

describe('exercise catalog', () => {
  it('has exactly one entry per unique exercise name', () => {
    const uniqueSourceNames = new Set(Object.values(MOVEMENT_PATTERNS).flat());
    expect(ALL_EXERCISES).toHaveLength(uniqueSourceNames.size);
    expect(new Set(ALL_EXERCISE_NAMES).size).toBe(ALL_EXERCISES.length);
  });

  it('gives every entry a unique id', () => {
    const ids = ALL_EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records every pattern a multi-pattern exercise belongs to, first = primary', () => {
    const pushups = ALL_EXERCISES.find((e) => e.name === 'Pushups');
    expect(pushups?.patterns).toEqual(['Chest Accessory', 'Bodyweight Strength Upper']);
    const legPress = ALL_EXERCISES.find((e) => e.name === 'Leg Press');
    expect(legPress?.patterns).toEqual(['Squat Pattern', 'Machine Lower']);
    const dips = ALL_EXERCISES.find((e) => e.name === 'Dips');
    expect(dips?.patterns).toEqual(['Tricep Accessory', 'Bodyweight Strength Upper']);
  });

  it('never spans body regions within one exercise (chip filtering stays unambiguous)', () => {
    for (const exercise of ALL_EXERCISES) {
      const regions = new Set(exercise.patterns.map((p) => PATTERN_BODY[p]));
      expect(regions.size).toBe(1);
    }
  });

  it('fills every entry with coaching content and equipment', () => {
    for (const exercise of ALL_EXERCISES) {
      expect(exercise.primary).toBeTruthy();
      expect(exercise.steps).toHaveLength(5);
      expect(exercise.tips.length).toBeGreaterThanOrEqual(4);
      expect(exercise.equipment).toBeTruthy();
      expect(Object.keys(exercise.muscles).length).toBeGreaterThan(0);
    }
  });

  it('spot-checks a canonical entry', () => {
    const bench = ALL_EXERCISES.find((e) => e.name === 'Bench Press');
    expect(bench).toMatchObject({
      id: 'bench_press',
      body: 'upper',
      primary: 'Chest',
      equipment: 'Barbell',
      patterns: ['Horizontal Push'],
    });
  });

  it('slugifies names into stable ids', () => {
    expect(slugify('Bench Press')).toBe('bench_press');
    expect(slugify('Calf Raise Machine')).toBe('calf_raise_machine');
    expect(slugify("Low to High Cable Flys")).toBe('low_to_high_cable_flys');
  });

  it('canonicalizes legacy spellings and passes unknown names through', () => {
    expect(canonicalExerciseName('Back Squat')).toBe('Squat');
    expect(canonicalExerciseName('  SQUATS  ')).toBe('Squat');
    expect(canonicalExerciseName('Squat')).toBe('Squat');
    expect(canonicalExerciseName('Bench Press')).toBe('Bench Press');
  });

  it('searches by name, case-insensitively', () => {
    const hits = searchExercises('bench');
    expect(hits.map((e) => e.name)).toContain('Bench Press');
    expect(hits.map((e) => e.name)).toContain('DB Incline Bench');
    expect(hits.every((e) => e.name.toLowerCase().includes('bench'))).toBe(true);
  });

  it('search resolves aliases ("back squat" finds Squat)', () => {
    const hits = searchExercises('back squat');
    expect(hits.map((e) => e.name)).toContain('Squat');
  });

  it('empty search returns the full catalog', () => {
    expect(searchExercises('')).toHaveLength(ALL_EXERCISES.length);
    expect(searchExercises('   ')).toHaveLength(ALL_EXERCISES.length);
  });
});
