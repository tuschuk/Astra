/**
 * Tests for TeamProgramSheet (B37): a pushed program shows its weeks, workouts and targets in the
 * lifter's unit; each kind of content offers its own footer button (Start program / Save to my
 * programs / Start this workout) and reports the tap; content the server no longer hands over
 * says "no longer available" with no button; a message shows under the content.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { TeamProgramPayload, TeamWorkoutPayload } from '@/social/teamCoaching';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import { PUSH_UNAVAILABLE, SHEET_ACTION_LABEL, TeamProgramSheet, type TeamSheetContent } from './TeamProgramSheet';

const slot = { exerciseId: 'x', exerciseName: 'Back Squat', position: 0, targetSets: 3, targetReps: 5, targetWeightKg: 100, targetRpe: 8 };
const program: TeamProgramPayload = {
  name: 'Coach Block',
  weeks: [
    { position: 0, workouts: [{ name: 'Day A', position: 0, exercises: [slot, { ...slot, exerciseName: null, targetRpe: null }] }] },
    { position: 1, workouts: [{ name: null, position: 0, exercises: [] }] },
  ],
};
const workout: TeamWorkoutPayload = { name: 'Day A', position: 0, exercises: [slot], programName: 'Coach Block' };

async function renderSheet(content: TeamSheetContent | null, extra: { message?: string | null } = {}) {
  const onAction = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <TeamProgramSheet content={content} unit="kg" busy={false} message={extra.message ?? null} onAction={onAction} onClose={() => undefined} />
    </SafeAreaProvider>,
  );
  return onAction;
}

describe('TeamProgramSheet', () => {
  it('shows a program’s weeks, workouts and targets; an assignment offers Start program', async () => {
    const onAction = await renderSheet({ kind: 'assignment', payload: program });
    expect(screen.getByText('Coach Block')).toBeTruthy();
    expect(screen.getByText('Week 1')).toBeTruthy();
    expect(screen.getByText('Week 2')).toBeTruthy();
    expect(screen.getByText('Day A')).toBeTruthy();
    expect(screen.getByText('Workout 1')).toBeTruthy();
    expect(screen.getByText('3 × 5 @ 100 kg · RPE 8')).toBeTruthy();
    expect(screen.getByText('Deleted exercise')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(SHEET_ACTION_LABEL.assignment));
    expect(onAction).toHaveBeenCalled();
  });

  it('a pushed program offers Save to my programs', async () => {
    await renderSheet({ kind: 'program', payload: program });
    expect(screen.getByLabelText('Save to my programs')).toBeTruthy();
  });

  it('a pushed workout names its program and offers Start this workout', async () => {
    await renderSheet({ kind: 'workout', payload: workout }, { message: 'Nope.' });
    expect(screen.getByText('From Coach Block')).toBeTruthy();
    expect(screen.getByLabelText('Start this workout')).toBeTruthy();
    expect(screen.getByText('Nope.')).toBeTruthy();
  });

  it('once its action is done, the button goes away', async () => {
    await render(
      <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
        <TeamProgramSheet content={{ kind: 'program', payload: program }} unit="kg" busy={false} done message="Saved." onAction={() => undefined} onClose={() => undefined} />
      </SafeAreaProvider>,
    );
    expect(screen.getByText('Saved.')).toBeTruthy();
    expect(screen.queryByLabelText('Save to my programs')).toBeNull();
  });

  it('content that is gone says so, with no action', async () => {
    await renderSheet({ kind: 'program', payload: null });
    expect(screen.getByText(PUSH_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByLabelText('Save to my programs')).toBeNull();
  });
});
