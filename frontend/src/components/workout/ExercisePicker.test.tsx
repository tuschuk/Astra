/**
 * Tests for the logger's Add-exercise panel: the search narrows the library, a tap reports the
 * exercise, Cancel reports nothing.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ALL_EXERCISES, type ExerciseDef } from '@/library/catalog';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import { ExercisePicker } from './ExercisePicker';

/** Renders the open picker with spy callbacks. */
async function renderPicker() {
  const onPick = jest.fn<(exercise: ExerciseDef) => void>();
  const onClose = jest.fn<() => void>();
  await render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <ExercisePicker visible onPick={onPick} onClose={onClose} />
    </SafeAreaProvider>,
  );
  return { onPick, onClose };
}

describe('ExercisePicker', () => {
  it('narrows the library as the lifter types', async () => {
    await renderPicker();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'deadlift');
    expect(screen.getByLabelText('Add Deadlift')).toBeTruthy();
    expect(screen.queryByLabelText('Add Bench Press')).toBeNull();
  });

  it('finds an exercise by a legacy spelling (alias-aware, like the Library tab)', async () => {
    await renderPicker();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'squats');
    expect(screen.getByLabelText('Add Squat')).toBeTruthy();
  });

  it('reports the tapped exercise', async () => {
    const { onPick, onClose } = await renderPicker();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'bench press');
    await fireEvent.press(screen.getByLabelText('Add Bench Press'));
    const bench = ALL_EXERCISES.find((e) => e.id === 'bench_press');
    expect(bench).toBeDefined();
    expect(onPick).toHaveBeenCalledWith(bench as ExerciseDef);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a no-results message, and Cancel closes without picking', async () => {
    const { onPick, onClose } = await renderPicker();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zzzz');
    expect(screen.getByText(/No exercises match/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});
