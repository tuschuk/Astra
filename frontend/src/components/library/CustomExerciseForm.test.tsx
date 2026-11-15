/**
 * Tests for the New / Edit exercise form (B31): Save stays disabled until there's a name and
 * refuses one over the server's 80-character limit; chips select and clear on a second tap;
 * create saves an owned row; edit opens prefilled and saves the change in place. Real SQLite
 * (node driver); no network.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ExerciseRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { createCustomExercise, listCustomExercises } from '@/library/customExercises';
import { migrate } from '@/db/schema';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import { CustomExerciseForm } from './CustomExerciseForm';

const USER = 'a0000000-0000-4000-8000-000000000001';
let db: SqlDriver;

beforeEach(async () => {
  // Schema only: the form never reads the library, so skip seeding its 151 rows.
  db = createNodeSqliteDriver();
  await migrate(db);
});

/** Renders the open form with spy callbacks. */
async function renderForm(existing: ExerciseRow | null = null) {
  const onSaved = jest.fn<(row: ExerciseRow) => void>();
  const onClose = jest.fn<() => void>();
  await render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <CustomExerciseForm visible db={db} userId={USER} existing={existing} onSaved={onSaved} onClose={onClose} />
    </SafeAreaProvider>,
  );
  return { onSaved, onClose };
}

/** Whether the button with this label is disabled. */
function isDisabled(label: string): boolean {
  return screen.getByLabelText(label).props.accessibilityState?.disabled === true;
}

describe('CustomExerciseForm', () => {
  it('keeps Save disabled until there is a name, and refuses a name over 80 characters', async () => {
    await renderForm();
    expect(screen.getByText('New exercise')).toBeTruthy();
    expect(isDisabled('Save exercise')).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Name'), '   ');
    expect(isDisabled('Save exercise')).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'x'.repeat(81));
    expect(screen.getByText('Names can be at most 80 characters.')).toBeTruthy();
    expect(isDisabled('Save exercise')).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Belt Squat');
    expect(isDisabled('Save exercise')).toBe(false);
  });

  it('creates an owned exercise with the chosen chips; a second tap clears a chip', async () => {
    const { onSaved } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Zottman Curl');
    await fireEvent.press(screen.getByLabelText('Equipment: Barbell'));
    await fireEvent.press(screen.getByLabelText('Equipment: Dumbbell'));
    await fireEvent.press(screen.getByLabelText('Main muscle: Chest'));
    await fireEvent.press(screen.getByLabelText('Main muscle: Chest'));
    await fireEvent.press(screen.getByLabelText('Main muscle: Biceps'));
    await fireEvent.press(screen.getByLabelText('Save exercise'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [saved] = await listCustomExercises(db, USER);
    expect(saved).toMatchObject({ name: 'Zottman Curl', equipment: 'Dumbbell', primary_muscle: 'biceps', owner_id: USER });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it('opens prefilled for an edit and saves the change to the same row', async () => {
    const made = await createCustomExercise(db, USER, { name: 'Belt Squat', equipment: 'Machine', primaryMuscle: 'quads' });
    const { onSaved } = await renderForm(made);
    expect(screen.getByText('Edit exercise')).toBeTruthy();
    expect(screen.getByLabelText('Name').props.value).toBe('Belt Squat');
    expect(screen.getByLabelText('Equipment: Machine').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByLabelText('Equipment: Machine'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Belt Squat (high)');
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(await listCustomExercises(db, USER)).toEqual([
      expect.objectContaining({ id: made.id, name: 'Belt Squat (high)', equipment: null, primary_muscle: 'quads' }),
    ]);
  });

  it('Cancel reports a close and saves nothing', async () => {
    const { onSaved, onClose } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Never');
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(await listCustomExercises(db, USER)).toEqual([]);
  });
});
