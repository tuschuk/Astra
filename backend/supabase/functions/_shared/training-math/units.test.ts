// Tests for units.ts — kg/lb conversion is exact both ways, display rounding never feeds storage.
import { describe, expect, it } from '@jest/globals';

import { KG_PER_LB, displayWeight, kgToLb, lbToKg, roundToIncrement } from './units.ts';

describe('kg/lb conversion', () => {
  it('uses the exact international pound', () => {
    expect(KG_PER_LB).toBe(0.45359237);
  });

  it('converts kg to lb exactly', () => {
    expect(kgToLb(100)).toBeCloseTo(220.46226218, 8);
    expect(kgToLb(0)).toBe(0);
  });

  it('stores a typed lb weight as exact, unrounded kg', () => {
    expect(lbToKg(225)).toBe(225 * 0.45359237);
    expect(lbToKg(225)).toBeCloseTo(102.05828325, 8);
  });

  it('round-trips kg → lb → kg and lb → kg → lb without drift', () => {
    for (const kg of [0.5, 20, 61.25, 102.05828325, 142.5, 317.5]) {
      expect(Math.abs(lbToKg(kgToLb(kg)) - kg)).toBeLessThan(1e-9);
    }
    for (const lb of [2.5, 45, 135, 225, 405]) {
      expect(Math.abs(kgToLb(lbToKg(lb)) - lb)).toBeLessThan(1e-9);
    }
  });

  it('rejects non-numbers', () => {
    expect(() => kgToLb(NaN)).toThrow(RangeError);
    expect(() => lbToKg(Infinity)).toThrow(RangeError);
  });
});

describe('displayWeight', () => {
  it('shows kg as kg, rounded to one decimal', () => {
    expect(displayWeight(100, 'kg')).toBe(100);
    expect(displayWeight(116.6666667, 'kg')).toBe(116.7);
  });

  it('shows kg in lb, rounded to one decimal', () => {
    expect(displayWeight(100, 'lb')).toBe(220.5);
    expect(displayWeight(lbToKg(225), 'lb')).toBe(225);
  });

  it('does not change the stored value it is given', () => {
    const stored = lbToKg(225);
    displayWeight(stored, 'lb');
    displayWeight(stored, 'kg');
    expect(stored).toBe(225 * 0.45359237);
  });

  it('rejects non-numbers', () => {
    expect(() => displayWeight(NaN, 'kg')).toThrow(RangeError);
  });
});

describe('roundToIncrement', () => {
  it('snaps to the nearest loadable step', () => {
    expect(roundToIncrement(101.3, 2.5)).toBe(102.5);
    expect(roundToIncrement(121.62, 2.5)).toBe(122.5);
    expect(roundToIncrement(121.2, 2.5)).toBe(120);
    expect(roundToIncrement(227, 5)).toBe(225);
  });

  it('leaves no floating-point residue', () => {
    expect(roundToIncrement(0.3, 0.1)).toBe(0.3);
    expect(roundToIncrement(1.26, 0.25)).toBe(1.25);
  });

  it('rejects a zero, negative or non-numeric step', () => {
    expect(() => roundToIncrement(100, 0)).toThrow(RangeError);
    expect(() => roundToIncrement(100, -2.5)).toThrow(RangeError);
    expect(() => roundToIncrement(NaN, 2.5)).toThrow(RangeError);
  });
});
