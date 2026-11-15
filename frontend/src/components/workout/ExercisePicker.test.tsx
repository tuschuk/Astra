/**
 * Tests for the logger's Add-exercise panel: the search narrows the library and the lifter's own
 * custom exercises (B31), a tap reports the exercise as its exact database id (the uuidv5 of the
 * slug for a library row, the custom's own id for a custom), Cancel reports nothing.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ExerciseRow } from '@/db/dao';
import { libraryExerciseId } from '@/library/uuidv5';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import { ExercisePicker, type PickedExercise } from './ExercisePicker';

/** A custom exercise row as `listCustomExercises` would return it. */
function custom(id: string, name: string, equipment: string | null = null): ExerciseRow {
  return {
    id,
    owner_id: 'lifter',
    name,
    primary_muscle: null,
    equipment,
    slug: null,
    deleted_at: null,
    created_at: 't',
    updated_at: 't',
  };
}

/** Renders the open picker with spy callbacks. */
async function renderPicker(customExercises: readonly ExerciseRow[] = []) {
  const onPick = jest.fn<(exercise: PickedExercise) => void>();
  const onClose = jest.fn<() => void>();
  await render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <ExercisePicker visible customExercises={customExercises} onPick={onPick} onClose={onClose} />
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

  it('reports a library exercise as its database id', async () => {
    const { onPick, onClose } = await renderPicker();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'bench press');
    await fireEvent.press(screen.getByLabelText('Add Bench Press'));
    expect(onPick).toHaveBeenCalledWith({ deviceId: libraryExerciseId('bench_press'), name: 'Bench Press' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lists matching custom exercises marked Custom, and reports one as its own id', async () => {
    const { onPick } = await renderPicker([
      custom('c-1', 'Zercher Hold', 'Barbell'),
      custom('c-2', 'Zombie Walk'),
      custom('c-3', 'Landmine Twist'),
    ]);
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zercher');
    expect(screen.getByText('Custom · Barbell')).toBeTruthy();
    expect(screen.queryByLabelText('Add Landmine Twist')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zombie');
    expect(screen.getByText('Custom')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add Zombie Walk'));
    expect(onPick).toHaveBeenCalledWith({ deviceId: 'c-2', name: 'Zombie Walk' });
  });

  it('shows a no-results message, and Cancel closes without picking', async () => {
    const { onPick, onClose } = await renderPicker([custom('c-1', 'Zercher Hold')]);
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zzzz');
    expect(screen.getByText(/No exercises match/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});
