/**
 * Tests for ProgramExerciseCard (PRG-1, B34): it shows the slot's name and targets in the lifter's
 * unit, reads the four boxes into targets on Save, keeps an untouched weight at its exact stored
 * kg (never the rounded display number), refuses unreadable boxes and a missing set count, turns
 * the module's refusals into sentences, and disables impossible moves.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { ProgramExerciseNode, ProgramTargetsInput } from '@/programs/programs';

import { ProgramExerciseCard, targetsErrorMessage } from './ProgramExerciseCard';

/** A slot of `name` with the given targets (kg). */
function node(targets: Partial<ProgramExerciseNode['slot']> = {}, name = 'Bench Press'): ProgramExerciseNode {
  return {
    exerciseName: name,
    slot: {
      id: 's1',
      program_workout_id: 'w1',
      exercise_id: 'e1',
      position: 0,
      target_sets: 3,
      target_reps: 8,
      target_weight_kg: 100,
      target_rpe: null,
      deleted_at: null,
      created_at: 't',
      updated_at: 't',
      ...targets,
    },
  };
}

async function renderCard(props: Partial<React.ComponentProps<typeof ProgramExerciseCard>> = {}) {
  const onSaveTargets = jest.fn<(t: ProgramTargetsInput) => Promise<void>>(async () => undefined);
  const onMove = jest.fn<(d: 'up' | 'down') => Promise<void>>(async () => undefined);
  const onRemove = jest.fn();
  await render(
    <ProgramExerciseCard
      node={node()}
      index={0}
      count={2}
      unit="lb"
      onSaveTargets={onSaveTargets}
      onMove={onMove}
      onRemove={onRemove}
      {...props}
    />,
  );
  return { onSaveTargets, onMove, onRemove };
}

describe('ProgramExerciseCard', () => {
  it('shows the name and the targets in the lifter’s unit, boxes filled', async () => {
    await renderCard();
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('3 × 8 @ 220.5 lb')).toBeTruthy();
    expect(screen.getByLabelText('Weight in lb for Bench Press').props.value).toBe('220.5');
  });

  it('keeps an untouched weight at its exact stored kg when other targets change', async () => {
    const { onSaveTargets } = await renderCard();
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '6');
    await fireEvent.press(screen.getByLabelText('Save targets for Bench Press'));
    await waitFor(() => expect(onSaveTargets).toHaveBeenCalled());
    expect(onSaveTargets.mock.calls[0][0]).toEqual({ sets: 3, reps: 6, weight: { value: 100, unit: 'kg' }, rpe: null });
  });

  it('sends a typed weight in the lifter’s unit, and an emptied box as no target', async () => {
    const { onSaveTargets } = await renderCard();
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '225');
    await fireEvent.changeText(screen.getByLabelText('RPE for Bench Press'), '8,5');
    await fireEvent.press(screen.getByLabelText('Save targets for Bench Press'));
    await waitFor(() => expect(onSaveTargets).toHaveBeenCalledTimes(1));
    expect(onSaveTargets.mock.calls[0][0]).toEqual({ sets: 3, reps: 8, weight: { value: 225, unit: 'lb' }, rpe: 8.5 });

    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '');
    await fireEvent.press(screen.getByLabelText('Save targets for Bench Press'));
    await waitFor(() => expect(onSaveTargets).toHaveBeenCalledTimes(2));
    expect(onSaveTargets.mock.calls[1][0].weight).toBeNull();
  });

  it('refuses unreadable boxes and a missing set count without saving', async () => {
    const { onSaveTargets } = await renderCard();
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), 'eight');
    await fireEvent.press(screen.getByLabelText('Save targets for Bench Press'));
    expect(screen.getByText('Enter sets, reps, weight and RPE as plain numbers.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '8');
    await fireEvent.changeText(screen.getByLabelText('Sets for Bench Press'), '');
    await fireEvent.press(screen.getByLabelText('Save targets for Bench Press'));
    expect(screen.getByText('Every exercise needs a number of sets.')).toBeTruthy();
    expect(onSaveTargets).not.toHaveBeenCalled();
  });

  it('shows the module’s refusal as a sentence', async () => {
    const onSaveTargets = jest.fn<(t: ProgramTargetsInput) => Promise<void>>(async () => {
      throw new RangeError('targetRpe must be from 1 to 10, got 11');
    });
    await renderCard({ onSaveTargets });
    await fireEvent.press(screen.getByLabelText('Save targets for Bench Press'));
    expect(await screen.findByText('RPE goes from 1 to 10.')).toBeTruthy();
  });

  it('disables Up on the first slot and Down on the last; Remove calls back', async () => {
    const { onMove, onRemove } = await renderCard({ index: 0, count: 1 });
    expect(screen.getByLabelText('Move Bench Press up').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByLabelText('Move Bench Press down').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByLabelText('Remove Bench Press'));
    expect(onRemove).toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('targetsErrorMessage', () => {
  it.each([
    [new RangeError('targetSets must be …'), 'Sets must be a whole number, at least 1.'],
    [new RangeError('targetReps must be …'), 'Reps must be a whole number.'],
    [new RangeError('targetWeightKg must be …'), 'That weight is too big to save.'],
    [new RangeError('targetRpe must be …'), 'RPE goes from 1 to 10.'],
    [new RangeError('position must be …'), 'Those targets have a value Astra can’t save.'],
    [new Error('disk'), 'Those targets couldn’t be saved. Try again.'],
  ])('%s → %s', (error, message) => {
    expect(targetsErrorMessage(error)).toBe(message);
  });
});
