// Tests for volume.ts — session tonnage, with warm-ups and weightless sets adding nothing (LOG-14).
import { describe, expect, it } from '@jest/globals';

import { classifyPrs, type PrCandidateSet } from './prs.ts';
import { sessionVolumeKg, setVolumeKg, type VolumeSet } from './volume.ts';

const set = (weightKg: number | null, reps: number | null, isWarmup = false): VolumeSet => ({
  weightKg,
  reps,
  isWarmup,
});

describe('setVolumeKg', () => {
  it('is reps × weight for a work set', () => {
    expect(setVolumeKg(set(100, 5))).toBe(500);
    expect(setVolumeKg(set(102.06, 3))).toBeCloseTo(306.18, 6);
  });

  it('is 0 for a warm-up set, however heavy (LOG-14)', () => {
    expect(setVolumeKg(set(100, 5, true))).toBe(0);
    expect(setVolumeKg(set(300, 1, true))).toBe(0);
  });

  it('is 0 for a bodyweight or timed set — external load only (LOG-15)', () => {
    expect(setVolumeKg(set(null, 8))).toBe(0);
    expect(setVolumeKg(set(20, null))).toBe(0);
    expect(setVolumeKg(set(null, null))).toBe(0);
  });

  it('is 0 for values that are not usable positive numbers', () => {
    expect(setVolumeKg(set(0, 10))).toBe(0);
    expect(setVolumeKg(set(-5, 10))).toBe(0);
    expect(setVolumeKg(set(100, 0))).toBe(0);
    expect(setVolumeKg(set(Number.NaN, 5))).toBe(0);
    expect(setVolumeKg(set(100, Number.POSITIVE_INFINITY))).toBe(0);
    expect(setVolumeKg(set(100, 2.5))).toBe(0);
  });
});

describe('sessionVolumeKg', () => {
  it('adds up the work sets and leaves warm-ups out (the step DoD)', () => {
    const warmup = set(60, 5, true);
    const work = set(60, 5);
    // Identical sets: the warm-up flag alone decides whether it counts.
    expect(sessionVolumeKg([warmup])).toBe(0);
    expect(sessionVolumeKg([work])).toBe(300);
    expect(sessionVolumeKg([set(20, 10, true), warmup, work, set(100, 5), set(100, 5)])).toBe(1300);
  });

  it('counts the added weight of a weighted pull-up and nothing for a plain one', () => {
    expect(sessionVolumeKg([set(null, 10), set(null, 8), set(20, 5)])).toBe(100);
  });

  it('is 0 for an empty workout', () => {
    expect(sessionVolumeKg([])).toBe(0);
  });

  it('takes the same mapped rows as PR detection, which also skips the warm-up', () => {
    // A caller (B13/B18) maps each `sets` row once and hands it to both.
    const rows: PrCandidateSet[] = [set(140, 3, true), set(100, 5)];
    expect(sessionVolumeKg(rows)).toBe(500);
    expect(classifyPrs(rows[0], { repMaxesKg: {} })).toEqual([]);
    expect(classifyPrs(rows[1], { repMaxesKg: {} }).length).toBeGreaterThan(0);
  });
});
