/**
 * Seed-data integrity tests for the launch library (LIB-7). These guard the
 * imported founder data: complete coverage across the maps, valid muscle
 * intensities, and clean (HTML-free) coaching text.
 */
import { describe, expect, it } from '@jest/globals';

import {
  EXERCISE_EQUIPMENT,
  EXERCISE_NAME_ALIASES,
  MOVEMENT_PATTERNS,
  PATTERN_MUSCLES,
  PATTERN_NAMES,
  PATTERN_PRIMARY,
  PATTERN_STEPS,
  PATTERN_TIPS,
} from './exercises';

describe('launch library seed data', () => {
  it('has the 22 founder movement patterns, each with exercises', () => {
    expect(PATTERN_NAMES).toHaveLength(22);
    for (const pattern of PATTERN_NAMES) {
      expect(MOVEMENT_PATTERNS[pattern].length).toBeGreaterThan(0);
    }
  });

  it('maps every exercise in every pattern to an equipment kind', () => {
    for (const pattern of PATTERN_NAMES) {
      for (const name of MOVEMENT_PATTERNS[pattern]) {
        expect(EXERCISE_EQUIPMENT[name]).toBeDefined();
      }
    }
  });

  it('keeps no legacy alias spellings as equipment keys', () => {
    expect(EXERCISE_EQUIPMENT['Squats']).toBeUndefined();
    expect(EXERCISE_EQUIPMENT['Back Squat']).toBeUndefined();
  });

  it('gives every pattern a primary-muscle label, five steps and tips', () => {
    for (const pattern of PATTERN_NAMES) {
      expect(PATTERN_PRIMARY[pattern]).toBeTruthy();
      expect(PATTERN_STEPS[pattern]).toHaveLength(5);
      expect(PATTERN_TIPS[pattern].length).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps every muscle intensity in (0, 1]', () => {
    for (const pattern of PATTERN_NAMES) {
      for (const intensity of Object.values(PATTERN_MUSCLES[pattern])) {
        expect(intensity).toBeGreaterThan(0);
        expect(intensity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('marks exactly one primary (1.0) muscle per pattern — except Cardio, which is all sub-maximal', () => {
    for (const pattern of PATTERN_NAMES) {
      const primaries = Object.values(PATTERN_MUSCLES[pattern]).filter((v) => v === 1);
      expect(primaries).toHaveLength(pattern === 'Cardio' ? 0 : 1);
    }
  });

  it('contains no HTML remnants and only balanced ** emphasis in coaching text', () => {
    for (const pattern of PATTERN_NAMES) {
      for (const step of PATTERN_STEPS[pattern]) {
        expect(step.cue).not.toMatch(/<[a-z/]/i);
        expect((step.cue.match(/\*\*/g) ?? []).length % 2).toBe(0);
      }
    }
  });

  it('aliases only point at names that exist in the library', () => {
    const allNames = new Set(Object.values(MOVEMENT_PATTERNS).flat());
    for (const canonical of Object.values(EXERCISE_NAME_ALIASES)) {
      expect(allNames.has(canonical)).toBe(true);
    }
  });

  it('spot-checks fidelity against the founder source', () => {
    expect(MOVEMENT_PATTERNS['Horizontal Push']).toEqual([
      'Bench Press',
      'Incline Bench Press',
      'Decline Bench Press',
      'Floor Press',
    ]);
    expect(EXERCISE_EQUIPMENT['Bench Press']).toBe('Barbell');
    expect(EXERCISE_EQUIPMENT['Leg Press']).toBe('Machine');
    expect(EXERCISE_EQUIPMENT['Treadmill']).toBe('Cardio Machine');
    expect(PATTERN_MUSCLES['Squat Pattern']).toEqual({ quads: 1, glutes: 0.5, hamstrings: 0.2 });
    expect(PATTERN_PRIMARY['Vertical Pull']).toBe('Lats');
    expect(EXERCISE_NAME_ALIASES).toEqual({ squats: 'Squat', 'back squat': 'Squat' });
  });
});
