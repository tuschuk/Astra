/**
 * Tests for the muscle vocabulary: twelve keys in a fixed order, each with a display name, every
 * key the founder's library uses is known, and `rankMuscles` orders biggest first with the
 * top-to-bottom tiebreak and leaves untrained muscles out.
 */
import { describe, expect, it } from '@jest/globals';

import { PATTERN_MUSCLES, type MuscleKey } from './exercises';
import { MUSCLE_NAMES, MUSCLE_ORDER, rankMuscles } from './muscles';

describe('muscle vocabulary', () => {
  it('lists all twelve muscle keys once, each with a name', () => {
    expect(MUSCLE_ORDER).toHaveLength(12);
    expect(new Set(MUSCLE_ORDER).size).toBe(12);
    expect(Object.keys(MUSCLE_NAMES).sort()).toEqual([...MUSCLE_ORDER].sort());
    for (const key of MUSCLE_ORDER) expect(MUSCLE_NAMES[key]).toMatch(/^[A-Z]/);
  });

  it('knows every muscle the library uses', () => {
    const used = new Set<MuscleKey>(Object.values(PATTERN_MUSCLES).flatMap((m) => Object.keys(m) as MuscleKey[]));
    for (const key of used) expect(MUSCLE_ORDER).toContain(key);
  });
});

describe('rankMuscles', () => {
  it('orders biggest first', () => {
    expect(rankMuscles({ triceps: 0.25, chest: 1, shoulders: 0.4 })).toEqual(['chest', 'shoulders', 'triceps']);
  });

  it('breaks ties by the fixed top-to-bottom order', () => {
    expect(rankMuscles({ calves: 0.2, hamstrings: 0.2, quads: 0.25 })).toEqual(['quads', 'hamstrings', 'calves']);
  });

  it('leaves out muscles at zero, and an empty table ranks nothing', () => {
    expect(rankMuscles({ chest: 1, lats: 0 })).toEqual(['chest']);
    expect(rankMuscles({})).toEqual([]);
  });
});
