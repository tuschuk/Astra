/**
 * Catalog tests — the deduplicated per-exercise view of the seed data that
 * the Library tab (and later logging/PRs) consume.
 */
import { describe, expect, it } from '@jest/globals';

import {
  ALL_EXERCISES,
  ALL_EXERCISE_NAMES,
  EQUIPMENT_ORDER,
  PATTERN_BODY,
  canonicalExerciseName,
  exerciseById,
  filterExercises,
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

describe('filterExercises (Library muscle / equipment / region chips)', () => {
  it('with no active filter returns the catalog unchanged', () => {
    expect(filterExercises(ALL_EXERCISES, {})).toEqual(ALL_EXERCISES);
    expect(filterExercises(ALL_EXERCISES, { body: null, muscle: null, equipment: null })).toEqual(ALL_EXERCISES);
  });

  it('equipment matches exactly', () => {
    const dumbbell = filterExercises(ALL_EXERCISES, { equipment: 'Dumbbell' });
    expect(dumbbell.length).toBeGreaterThan(0);
    expect(dumbbell.every((e) => e.equipment === 'Dumbbell')).toBe(true);
    expect(dumbbell).toHaveLength(ALL_EXERCISES.filter((e) => e.equipment === 'Dumbbell').length);
  });

  it('muscle includes any involvement, however light', () => {
    const triceps = filterExercises(ALL_EXERCISES, { muscle: 'triceps' });
    const expected = ALL_EXERCISES.filter((e) => (e.muscles.triceps ?? 0) > 0);
    expect(new Set(triceps.map((e) => e.id))).toEqual(new Set(expected.map((e) => e.id)));
    // Bench Press only assists with the triceps (0.25) but is still findable under it.
    expect(triceps.map((e) => e.name)).toContain('Bench Press');
  });

  it('muscle orders by involvement, hardest first, ties in catalog order', () => {
    const triceps = filterExercises(ALL_EXERCISES, { muscle: 'triceps' });
    const levels = triceps.map((e) => e.muscles.triceps ?? 0);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    // A dedicated triceps movement outranks a press that only assists with them.
    const firstAccessory = triceps.findIndex((e) => e.patterns[0] === 'Tricep Accessory');
    expect(firstAccessory).toBeGreaterThanOrEqual(0);
    expect(firstAccessory).toBeLessThan(triceps.findIndex((e) => e.name === 'Bench Press'));
    for (let i = 1; i < triceps.length; i++) {
      if (levels[i] === levels[i - 1]) {
        expect(ALL_EXERCISES.indexOf(triceps[i])).toBeGreaterThan(ALL_EXERCISES.indexOf(triceps[i - 1]));
      }
    }
  });

  it('combines filters with AND, and composes with name search', () => {
    const narrowed = filterExercises(ALL_EXERCISES, { body: 'upper', muscle: 'chest', equipment: 'Dumbbell' });
    expect(narrowed.length).toBeGreaterThan(0);
    for (const e of narrowed) {
      expect([e.name, e.body, e.equipment, (e.muscles.chest ?? 0) > 0]).toEqual([e.name, 'upper', 'Dumbbell', true]);
    }
    const searched = searchExercises('fly', narrowed);
    expect(searched.length).toBeGreaterThan(0);
    expect(searched.every((e) => e.name.toLowerCase().includes('fly'))).toBe(true);
    // An impossible combination is an honest empty list, not a silent filter reset.
    expect(filterExercises(ALL_EXERCISES, { body: 'lower', muscle: 'chest' })).toEqual([]);
  });

  it('every equipment value the catalog uses has a chip, once', () => {
    for (const e of ALL_EXERCISES) expect(EQUIPMENT_ORDER).toContain(e.equipment);
    expect(new Set(EQUIPMENT_ORDER).size).toBe(EQUIPMENT_ORDER.length);
  });
});

describe('exerciseById', () => {
  it('finds every catalog exercise by its slug', () => {
    for (const e of ALL_EXERCISES) expect(exerciseById(e.id)).toBe(e);
  });

  it('returns undefined for an unknown slug', () => {
    expect(exerciseById('not_an_exercise')).toBeUndefined();
    expect(exerciseById('')).toBeUndefined();
  });
});
