/**
 * Tests for reading Tool Kit boxes: empty vs unusable vs good, unit conversion through the
 * training-math module, and snapping to a loadable weight.
 */
import { describe, expect, it } from '@jest/globals';
import { kgToLb, lbToKg, MAX_PERCENT, roundToIncrement } from '@training-math';

import {
  loadableWeight,
  MAX_CALCULATOR_WEIGHT,
  readPercent,
  readPositiveNumber,
  readWeightKg,
  readWholeNumber,
  readZeroOrMore,
} from './inputs';

describe('readPositiveNumber', () => {
  it('tells empty, unusable and good apart', () => {
    expect(readPositiveNumber('  ', 10, 'a weight')).toEqual({ kind: 'empty' });
    expect(readPositiveNumber('abc', 10, 'a weight')).toEqual({ kind: 'invalid', message: 'Enter a weight as a number.' });
    expect(readPositiveNumber('2.5', 10, 'a weight')).toEqual({ kind: 'ok', value: 2.5 });
  });

  it('accepts a decimal comma', () => {
    expect(readPositiveNumber('102,5', 1000, 'a weight')).toEqual({ kind: 'ok', value: 102.5 });
  });

  it('refuses 0 and anything past the ceiling, naming the range', () => {
    const message = 'Enter a weight above 0 and up to 10.';
    expect(readPositiveNumber('0', 10, 'a weight')).toEqual({ kind: 'invalid', message });
    expect(readPositiveNumber('10.01', 10, 'a weight')).toEqual({ kind: 'invalid', message });
    expect(readPositiveNumber('10', 10, 'a weight')).toEqual({ kind: 'ok', value: 10 });
  });

  it('refuses a number too long to be finite', () => {
    expect(readPositiveNumber('9'.repeat(400), 10, 'a weight').kind).toBe('invalid');
  });
});

describe('readZeroOrMore', () => {
  it('allows 0, refuses past the ceiling and non-numbers', () => {
    expect(readZeroOrMore('0', 100, 'a bar weight')).toEqual({ kind: 'ok', value: 0 });
    expect(readZeroOrMore('', 100, 'a bar weight')).toEqual({ kind: 'empty' });
    expect(readZeroOrMore('101', 100, 'a bar weight')).toEqual({
      kind: 'invalid',
      message: 'Enter a bar weight up to 100.',
    });
    expect(readZeroOrMore('-5', 100, 'a bar weight')).toEqual({
      kind: 'invalid',
      message: 'Enter a bar weight as a number.',
    });
  });
});

describe('readWeightKg', () => {
  it('passes kg through and converts lb with the module', () => {
    expect(readWeightKg('100', 'kg')).toEqual({ kind: 'ok', value: 100 });
    expect(readWeightKg('225', 'lb')).toEqual({ kind: 'ok', value: lbToKg(225) });
  });

  it('caps at the calculator ceiling in the lifter’s unit', () => {
    expect(readWeightKg(String(MAX_CALCULATOR_WEIGHT + 1), 'lb').kind).toBe('invalid');
    expect(readWeightKg('', 'kg')).toEqual({ kind: 'empty' });
  });
});

describe('readWholeNumber', () => {
  it('accepts whole numbers in range only', () => {
    expect(readWholeNumber('5', 1, 30, 'reps')).toEqual({ kind: 'ok', value: 5 });
    expect(readWholeNumber('', 1, 30, 'reps')).toEqual({ kind: 'empty' });
    expect(readWholeNumber('5.5', 1, 30, 'reps')).toEqual({ kind: 'invalid', message: 'Enter reps as a whole number.' });
    expect(readWholeNumber('0', 1, 30, 'reps')).toEqual({ kind: 'invalid', message: 'Enter reps from 1 to 30.' });
    expect(readWholeNumber('31', 1, 30, 'reps').kind).toBe('invalid');
  });
});

describe('readPercent', () => {
  it('follows the module’s own ceiling, overloads included', () => {
    expect(readPercent('85')).toEqual({ kind: 'ok', value: 85 });
    expect(readPercent('110')).toEqual({ kind: 'ok', value: 110 });
    expect(readPercent(String(MAX_PERCENT))).toEqual({ kind: 'ok', value: MAX_PERCENT });
    expect(readPercent(String(MAX_PERCENT + 0.5))).toEqual({
      kind: 'invalid',
      message: `Enter a percentage above 0 and up to ${MAX_PERCENT}.`,
    });
    expect(readPercent('0').kind).toBe('invalid');
  });
});

describe('loadableWeight', () => {
  it('snaps to 2.5 kg or 5 lb through the module', () => {
    expect(loadableWeight(121.6, 'kg')).toBe(122.5);
    expect(loadableWeight(121.6, 'lb')).toBe(roundToIncrement(kgToLb(121.6), 5));
    expect(loadableWeight(121.6, 'lb')).toBe(270);
  });
});
