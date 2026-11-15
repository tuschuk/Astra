/**
 * Tests for the intensity calculator (TK-3): the module's `workingWeightFromPercent` answer in
 * the lifter's unit, overloads past 100 % allowed, 0 and past-the-ceiling refused inline with
 * the module never asked for an out-of-range answer.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { lbToKg, MAX_PERCENT, workingWeightFromPercent } from '@training-math';

import { resetToolKitSession } from '@/toolkit/session';
import { formatWeight } from '@/workout/format';

import { IntensityCalculator } from './IntensityCalculator';

afterEach(() => resetToolKitSession());

/** Types a 1RM and a percentage. */
async function enter(unit: 'kg' | 'lb', oneRm: string, percent: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText(`1RM (${unit})`), oneRm);
  await fireEvent.changeText(screen.getByLabelText('Percent of 1RM (%)'), percent);
}

describe('IntensityCalculator', () => {
  it('100 kg @ 85 % → the module’s answer', async () => {
    await render(<IntensityCalculator unit="kg" />);
    await enter('kg', '100', '85');
    const answer = formatWeight(workingWeightFromPercent(100, 85), 'kg');
    expect(screen.getByLabelText(`Working weight · 85%: ${answer}. Load 85 kg (nearest 2.5 kg)`)).toBeTruthy();
    expect(screen.getByText('Load 85 kg (nearest 2.5 kg)')).toBeTruthy();
  });

  it('works in lb and allows an overload past 100 %', async () => {
    await render(<IntensityCalculator unit="lb" />);
    await enter('lb', '405', '105');
    expect(screen.getByText(formatWeight(workingWeightFromPercent(lbToKg(405), 105), 'lb'))).toBeTruthy();
  });

  it('accepts a decimal percentage', async () => {
    await render(<IntensityCalculator unit="kg" />);
    await enter('kg', '200', '72,5');
    expect(screen.getByText(formatWeight(workingWeightFromPercent(200, 72.5), 'kg'))).toBeTruthy();
  });

  it.each(['0', String(MAX_PERCENT + 1)])('refuses %s %% with the bounds named, and shows no answer', async (percent) => {
    await render(<IntensityCalculator unit="kg" />);
    await enter('kg', '100', percent);
    expect(screen.getByText(`Enter a percentage above 0 and up to ${MAX_PERCENT}.`)).toBeTruthy();
    expect(screen.getByText('Enter your 1RM and a percentage.')).toBeTruthy();
  });
});
