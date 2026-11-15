/**
 * Tests for MuscleMap (ANA-3) and its drawing data: trained muscles are filled and nothing else
 * is, the fill strength follows the library's intensity with a visible floor, the screen-reader
 * label names the muscles in a fixed order, and the shape data covers every muscle key.
 */
import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import type { MuscleKey } from '@/library/exercises';
import { PATTERN_MUSCLES } from '@/library/exercises';
import { isShaded, muscleShapes } from '@/test-utils/muscleMapQueries';

import { MIN_SHADE_OPACITY, MuscleMap, shadeOpacity, trainedMuscleNames, trainedMuscles } from './MuscleMap';
import { MUSCLE_ORDER } from '@/library/muscles';

import { BODY_OUTLINE, MUSCLE_REGIONS } from './muscleMapPaths';

describe('MuscleMap', () => {
  it('fills exactly the trained muscles and leaves every other one plain', async () => {
    await render(<MuscleMap loads={{ chest: 1, shoulders: 0.4, triceps: 0.25 }} />);
    for (const muscle of MUSCLE_ORDER) {
      expect([muscle, isShaded(muscle)]).toEqual([muscle, ['chest', 'shoulders', 'triceps'].includes(muscle)]);
    }
  });

  it('fills a muscle more strongly the more directly it was trained', async () => {
    await render(<MuscleMap loads={{ chest: 1, triceps: 0.25 }} />);
    const opacity = (m: MuscleKey) => muscleShapes(m)[0].props.fillOpacity as number;
    expect(opacity('chest')).toBe(1);
    expect(opacity('triceps')).toBeCloseTo(shadeOpacity(0.25));
    expect(opacity('triceps')).toBeLessThan(opacity('chest'));
  });

  it('tells a screen reader which muscles were trained, most direct first', async () => {
    await render(<MuscleMap loads={{ triceps: 0.25, chest: 1, shoulders: 0.4 }} />);
    expect(screen.getByLabelText('Muscles trained: Chest, Shoulders, Triceps')).toBeTruthy();
  });
});

describe('shadeOpacity', () => {
  it('keeps the lightest library value clearly visible and the main mover fully filled', () => {
    expect(shadeOpacity(0.12)).toBeCloseTo(0.34);
    expect(shadeOpacity(0.12)).toBeGreaterThan(MIN_SHADE_OPACITY);
    expect(shadeOpacity(1)).toBe(1);
  });

  it('stays within its range for out-of-range input', () => {
    expect(shadeOpacity(5)).toBe(1);
    expect(shadeOpacity(-1)).toBe(MIN_SHADE_OPACITY);
  });
});

describe('trainedMuscles', () => {
  it('orders by intensity, then by the fixed top-to-bottom order on ties', () => {
    expect(trainedMuscles({ calves: 0.2, hamstrings: 0.2, quads: 0.25 })).toEqual(['quads', 'hamstrings', 'calves']);
    expect(trainedMuscleNames({ quads: 1, glutes: 0.5, hamstrings: 0.2 })).toBe('Quads, Glutes, Hamstrings');
    expect(trainedMuscles({})).toEqual([]);
  });
});

describe('muscle map drawing data', () => {
  const ALL_KEYS = new Set<MuscleKey>(
    Object.values(PATTERN_MUSCLES).flatMap((m) => Object.keys(m) as MuscleKey[]),
  );

  // The twelve-keys / every-key-named invariants live with the vocabulary in library/muscles.test.ts.
  it('draws at least one shape for every muscle key', () => {
    for (const key of MUSCLE_ORDER) {
      expect([key, MUSCLE_REGIONS.some((r) => r.muscle === key)]).toEqual([key, true]);
    }
  });

  it('every muscle the library uses is drawable, and every shape names a real key', () => {
    for (const key of ALL_KEYS) expect(MUSCLE_ORDER).toContain(key);
    for (const region of MUSCLE_REGIONS) expect(MUSCLE_ORDER).toContain(region.muscle);
  });

  it('every shape and outline piece is a closed path', () => {
    for (const d of [...BODY_OUTLINE, ...MUSCLE_REGIONS.map((r) => r.d)]) expect(d).toMatch(/^M.*Z$/);
  });
});
