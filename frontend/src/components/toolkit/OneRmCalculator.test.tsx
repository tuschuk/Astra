/**
 * Tests for the 1RM calculator (TK-1): it shows exactly the training-math module's Epley answer
 * in the lifter's unit (expectations are computed through the module, never re-derived), a
 * single counts as its own 1RM, the rep table and the source citation appear, bad boxes say
 * why, and what's typed survives a remount (the Tool Kit panel remounts on every open).
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { epleyE1rm, lbToKg, weightForReps } from '@training-math';

import { resetToolKitSession } from '@/toolkit/session';
import { formatWeight } from '@/workout/format';

import { EPLEY_CITATION, OneRmCalculator } from './OneRmCalculator';

afterEach(() => resetToolKitSession());

/** Types a weight and reps into the calculator. */
async function enter(unit: 'kg' | 'lb', weight: string, reps: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText(`Weight (${unit})`), weight);
  await fireEvent.changeText(screen.getByLabelText('Reps'), reps);
}

describe('OneRmCalculator', () => {
  it('shows the Epley estimate in kg: 100 kg × 5', async () => {
    await render(<OneRmCalculator unit="kg" />);
    await enter('kg', '100', '5');
    const expected = formatWeight(epleyE1rm(100, 5), 'kg');
    expect(expected).toBe('116.7 kg');
    expect(screen.getByLabelText(`Estimated 1RM: ${expected}`)).toBeTruthy();
  });

  it('works in lb: 225 lb × 5 goes through the module in kg and back', async () => {
    await render(<OneRmCalculator unit="lb" />);
    await enter('lb', '225', '5');
    const expected = formatWeight(epleyE1rm(lbToKg(225), 5), 'lb');
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('a single is its own 1RM, not an estimate', async () => {
    await render(<OneRmCalculator unit="kg" />);
    await enter('kg', '140', '1');
    // Screen readers hear the second line too.
    expect(screen.getByLabelText('1RM: 140 kg. A single you lifted counts as your 1RM — no estimate needed.')).toBeTruthy();
    expect(screen.getByText('A single you lifted counts as your 1RM — no estimate needed.')).toBeTruthy();
  });

  it('lists the weight the estimate suggests for 2–10 reps', async () => {
    await render(<OneRmCalculator unit="kg" />);
    await enter('kg', '100', '3');
    const e1rm = epleyE1rm(100, 3);
    expect(screen.getByText('10 reps')).toBeTruthy();
    expect(screen.getByText(formatWeight(weightForReps(e1rm, 10), 'kg'))).toBeTruthy();
    expect(screen.getByText(formatWeight(weightForReps(e1rm, 2), 'kg'))).toBeTruthy();
  });

  it('always cites the formula’s published source', async () => {
    await render(<OneRmCalculator unit="kg" />);
    expect(screen.getByText(EPLEY_CITATION)).toBeTruthy();
    expect(EPLEY_CITATION).toContain('Epley, B. (1985)');
  });

  it('shows a hint until both boxes are usable, and says what is wrong', async () => {
    await render(<OneRmCalculator unit="kg" />);
    expect(screen.getByText('Enter the weight and reps of a set.')).toBeTruthy();
    await enter('kg', '100', '31');
    expect(screen.getByText('Enter reps from 1 to 30.')).toBeTruthy();
    expect(screen.getByText('Enter the weight and reps of a set.')).toBeTruthy();
    await enter('kg', 'abc', '5');
    expect(screen.getByText('Enter a weight as a number.')).toBeTruthy();
  });

  it('keeps what was typed across a remount', async () => {
    const first = await render(<OneRmCalculator unit="kg" />);
    await enter('kg', '100', '5');
    await first.unmount();
    await render(<OneRmCalculator unit="kg" />);
    expect(screen.getByLabelText('Weight (kg)').props.value).toBe('100');
    expect(screen.getByText('116.7 kg')).toBeTruthy();
  });
});
