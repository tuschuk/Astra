/**
 * Tests for TrendsSection (B46), the Trends tab's content: its loading / error / no-workouts
 * states, both charts from the data it is given, the window chips cutting both charts (and the
 * "nothing in this window" line), the exercise chips, the e1RM empty line, and that weights follow
 * the lifter's unit.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TrendWindow } from '@/workout/trendSeries';

import { TRENDS_EMPTY, TRENDS_NO_E1RM, TRENDS_WINDOW_EMPTY, TrendsSection } from './TrendsSection';
import type { TrendData } from './useTrendData';

const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();
const NOW = at(2026, 10, 15);

const READY: TrendData = {
  status: 'ready',
  volume: [
    { workoutId: 'old', startedAtMs: at(2025, 5, 1), valueKg: 5000 },
    { workoutId: 'new', startedAtMs: at(2026, 10, 10), valueKg: 6000 },
  ],
  exercises: [
    { exerciseId: 'sq', name: 'Squat', newestQualifyingMs: at(2026, 10, 10) },
    { exerciseId: 'gone', name: null, newestQualifyingMs: at(2025, 5, 1) },
  ],
  exerciseId: 'sq',
  e1rmFor: 'sq',
  e1rm: [{ workoutId: 'new', startedAtMs: at(2026, 10, 10), valueKg: 150 }],
  readAtMs: NOW,
};

/** Renders the section over `data`; returns its three callbacks as mocks. */
async function show(data: TrendData, timeWindow: TrendWindow = 'all', unit: 'kg' | 'lb' = 'kg') {
  const handlers = { onSelectWindow: jest.fn(), onSelectExercise: jest.fn(), onRetry: jest.fn() };
  await render(<TrendsSection data={data} timeWindow={timeWindow} unit={unit} {...handlers} />);
  return handlers;
}

describe('TrendsSection', () => {
  it('shows loading, then a Retry when the phone’s storage couldn’t be read', async () => {
    await show({ status: 'loading' });
    expect(screen.getByText('Loading…')).toBeTruthy();
    const { onRetry } = await show({ status: 'error' });
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('with no finished workouts, says the charts grow as you log', async () => {
    await show({ status: 'ready', volume: [], exercises: [], exerciseId: null, e1rmFor: null, e1rm: [], readAtMs: NOW });
    expect(screen.getByText(TRENDS_EMPTY)).toBeTruthy();
  });

  it('draws both charts from the data, with a chip per exercise', async () => {
    const { onSelectExercise } = await show(READY);
    expect(screen.getByLabelText(/^Volume per session: 2 sessions .* latest 6,000 kg, highest 6,000 kg\.$/)).toBeTruthy();
    expect(screen.getByLabelText('Squat estimated 1RM: 1 session on Nov 10, 2026, 150 kg.')).toBeTruthy();
    // A deleted custom exercise keeps its chip under the stand-in name.
    await fireEvent.press(screen.getByLabelText('Show Custom exercise estimated 1RM'));
    expect(onSelectExercise).toHaveBeenCalledWith('gone');
  });

  it('a window cuts both charts, and says so when it empties one', async () => {
    const { onSelectWindow } = await show(READY, '3m');
    expect(screen.getByLabelText(/^Volume per session: 1 session on Nov 10, 2026, 6,000 kg\.$/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Show all time'));
    expect(onSelectWindow).toHaveBeenCalledWith('all');

    await show({ ...READY, e1rm: [{ workoutId: 'old', startedAtMs: at(2025, 5, 1), valueKg: 140 }] }, '6m');
    expect(screen.getByText(TRENDS_WINDOW_EMPTY)).toBeTruthy();
  });

  it('says how the e1RM chart starts when no set has earned an estimate yet', async () => {
    await show({ ...READY, exercises: [], exerciseId: null, e1rmFor: null, e1rm: [] });
    expect(screen.getByText(TRENDS_NO_E1RM)).toBeTruthy();
    expect(screen.getByTestId('volume-chart')).toBeTruthy();
  });

  it('while a newly picked exercise is read, shows loading instead of the old exercise’s line', async () => {
    await show({ ...READY, exerciseId: 'gone' });
    expect(screen.queryByTestId('e1rm-chart')).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('prints weights in the lifter’s unit', async () => {
    await show(READY, 'all', 'lb');
    expect(screen.getByLabelText('Squat estimated 1RM: 1 session on Nov 10, 2026, 330.7 lb.')).toBeTruthy();
  });
});
