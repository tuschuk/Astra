/**
 * Tests for ProgramPickerSheet (PRG-3, B35): it lists the lifter's programs with their size, a
 * program with no workouts is shown but can't be picked, tapping a program starts running it
 * (saved on the phone) and reports the run, and with no programs it offers Your programs.
 * Real SQLite; no network.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ProgramRunRow } from '@/db/dao';
import { readActiveRun } from '@/programs/programRuns';
import { addProgramWorkout, addWeek, createProgram } from '@/programs/programs';
import { createPreparedDb } from '@/test-utils/loggerTestKit';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import { ProgramPickerSheet } from './ProgramPickerSheet';

const USER = 'a0000000-0000-4000-8000-000000000001';

function renderSheet(props: Partial<React.ComponentProps<typeof ProgramPickerSheet>> & { db: React.ComponentProps<typeof ProgramPickerSheet>['db'] }) {
  return render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <ProgramPickerSheet
        visible
        userId={USER}
        onStarted={() => undefined}
        onOpenPrograms={() => undefined}
        onClose={() => undefined}
        {...props}
      />
    </SafeAreaProvider>,
  );
}

describe('ProgramPickerSheet', () => {
  it('starts the picked program; a program with no workouts is listed but cannot be picked', async () => {
    const db = await createPreparedDb();
    await createProgram(db, USER, 'Empty one', { now: '2026-11-15T09:00:00.000Z' });
    const p = await createProgram(db, USER, 'Strength Block', { now: '2026-11-15T10:00:00.000Z' });
    const week = await addWeek(db, USER, p.id);
    await addProgramWorkout(db, USER, week.id, 'Day A');
    const onStarted = jest.fn<(run: ProgramRunRow) => void>();
    await renderSheet({ db, onStarted });

    expect(await screen.findByText('1 week · 1 workout')).toBeTruthy();
    expect(screen.getByText('No workouts yet — add some first')).toBeTruthy();
    expect(screen.getByLabelText('Start Empty one').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByLabelText('Start Strength Block'));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(onStarted.mock.calls[0][0]).toMatchObject({ program_id: p.id, ended_at: null });
    expect((await readActiveRun(db, USER))?.nextSession?.workout.label).toBe('Day A');
  });

  it('(B37) pick mode reports the program and starts nothing, under its own heading', async () => {
    const db = await createPreparedDb();
    const p = await createProgram(db, USER, 'Strength Block', { now: '2026-11-15T10:00:00.000Z' });
    const week = await addWeek(db, USER, p.id);
    await addProgramWorkout(db, USER, week.id, 'Day A');
    const onPick = jest.fn<(id: string) => void>();
    await renderSheet({ db, onPick, onStarted: undefined, title: 'Assign a program', intro: 'Pick one.' });
    expect(await screen.findByText('Assign a program')).toBeTruthy();
    expect(screen.getByText('Pick one.')).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText('Pick Strength Block'));
    expect(onPick).toHaveBeenCalledWith(p.id);
    expect(await readActiveRun(db, USER)).toBeNull();
  });

  it('with no programs, offers Your programs', async () => {
    const db = await createPreparedDb();
    const onOpenPrograms = jest.fn();
    await renderSheet({ db, onOpenPrograms });
    expect(await screen.findByText('No programs yet. Build one first, then start it here.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Your programs'));
    expect(onOpenPrograms).toHaveBeenCalled();
  });
});
