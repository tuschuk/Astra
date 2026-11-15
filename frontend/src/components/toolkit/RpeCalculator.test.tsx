/**
 * Tests for the RPE calculator (TK-2): the working weight is exactly the module's
 * `workingWeightFromRpe` answer in the lifter's unit, half-step RPEs are pickable, the chips
 * only offer what the chart covers, and the loadable line snaps through the module.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { lbToKg, MAX_RPE, MAX_RPE_REPS, MIN_RPE, workingWeightFromRpe } from '@training-math';

import { loadableWeight } from '@/toolkit/inputs';
import { resetToolKitSession } from '@/toolkit/session';
import { formatWeight } from '@/workout/format';

import { RpeCalculator } from './RpeCalculator';

afterEach(() => resetToolKitSession());

describe('RpeCalculator', () => {
  it('150 kg 1RM, 5 reps @ RPE 8 → the module’s answer in kg, plus the loadable weight', async () => {
    await render(<RpeCalculator unit="kg" />);
    await fireEvent.changeText(screen.getByLabelText('1RM (kg)'), '150');
    await fireEvent.press(screen.getByLabelText('5 reps'));
    await fireEvent.press(screen.getByLabelText('RPE 8'));
    const working = workingWeightFromRpe(150, 5, 8);
    expect(screen.getByLabelText(`Working weight · 5 @ RPE 8: ${formatWeight(working, 'kg')}.`, { exact: false })).toBeTruthy();
    expect(screen.getByText(new RegExp(`^Load ${loadableWeight(working, 'kg')} kg \\(nearest 2\\.5 kg\\)`))).toBeTruthy();
  });

  it('the same fixture in lb', async () => {
    await render(<RpeCalculator unit="lb" />);
    await fireEvent.changeText(screen.getByLabelText('1RM (lb)'), '330');
    await fireEvent.press(screen.getByLabelText('3 reps'));
    await fireEvent.press(screen.getByLabelText('RPE 9.5'));
    const working = workingWeightFromRpe(lbToKg(330), 3, 9.5);
    expect(screen.getByText(formatWeight(working, 'lb'))).toBeTruthy();
    expect(screen.getByText(new RegExp(`^Load ${loadableWeight(working, 'lb')} lb \\(nearest 5 lb\\)`))).toBeTruthy();
  });

  it('offers exactly the chart’s reps (1–12) and RPEs (6–10 in half steps)', async () => {
    await render(<RpeCalculator unit="kg" />);
    const radios = screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel as string);
    const reps = radios.filter((label) => /reps?$/.test(label));
    const rpes = radios.filter((label) => label.startsWith('RPE '));
    expect(reps).toHaveLength(MAX_RPE_REPS);
    expect(reps[0]).toBe('1 rep');
    expect(rpes).toHaveLength((MAX_RPE - MIN_RPE) * 2 + 1);
    expect(rpes[0]).toBe(`RPE ${MIN_RPE}`);
    expect(rpes.at(-1)).toBe(`RPE ${MAX_RPE}`);
  });

  it('marks the chosen chips selected and asks for a 1RM until one is typed', async () => {
    await render(<RpeCalculator unit="kg" />);
    expect(screen.getByText('Enter your 1RM.')).toBeTruthy();
    expect(screen.getByLabelText('RPE 8').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByLabelText('RPE 6.5'));
    expect(screen.getByLabelText('RPE 6.5').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('RPE 8').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('remembers the 1RM and chips across a remount', async () => {
    const first = await render(<RpeCalculator unit="kg" />);
    await fireEvent.changeText(screen.getByLabelText('1RM (kg)'), '200');
    await fireEvent.press(screen.getByLabelText('2 reps'));
    await first.unmount();
    await render(<RpeCalculator unit="kg" />);
    expect(screen.getByLabelText('1RM (kg)').props.value).toBe('200');
    expect(screen.getByLabelText('2 reps').props.accessibilityState).toMatchObject({ selected: true });
  });
});
