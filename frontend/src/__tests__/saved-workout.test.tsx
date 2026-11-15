/**
 * Tests for the saved-workout screen: a finished workout shows every exercise and every set in
 * the lifter's unit; a workout that isn't this user's (or isn't on the phone) shows nothing of
 * it. Real SQLite through a mocked `openAppDatabase`; the router is a stub.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { OTHER_USER_ID } from '@/test-utils/workoutFixtures';
import { startActiveWorkout } from '@/workout/activeWorkout';
import { workoutDateLabel } from '@/workout/format';

import SavedWorkoutScreen from '@/app/workout/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
let mockParams: { id?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    // Focus = mount here; the screen re-reads on focus (B14).
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const START = '2026-11-12T12:00:00.000Z';
let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

/** A finished two-exercise workout for `userId`; returns its id. */
async function seedWorkout(userId: string): Promise<string> {
  const store = await startActiveWorkout(db, userId, steadyOptions(START));
  const squat = await store.addExercise(libraryExerciseId('squat'));
  await store.logSet(squat.id, { reps: 5, weight: { value: 315, unit: 'lb' } });
  await store.logSet(squat.id, { reps: 3, weight: { value: 335, unit: 'lb' } });
  const bench = await store.addExercise(libraryExerciseId('bench_press'));
  await store.logSet(bench.id, { reps: 10 });
  await store.finish();
  return store.getSnapshot().workout.id;
}

describe('Saved workout screen', () => {
  it('shows every exercise and every set, in order, in the lifter’s unit', async () => {
    mockParams = { id: await seedWorkout(SIGNED_IN_USER_ID) };
    await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText(workoutDateLabel(START))).toBeTruthy();
    expect(screen.getByText('6 min · 2 exercises · 3 sets')).toBeTruthy();
    expect(screen.getByText('Squat')).toBeTruthy();
    expect(screen.getByText('5 × 315 lb')).toBeTruthy();
    expect(screen.getByText('3 × 335 lb')).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('10 reps')).toBeTruthy();
  });

  it('B11: shows a superset as one unit, a drop set as one numbered row, and timed / scored sets', async () => {
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions(START));
    const bench = await store.addExercise(libraryExerciseId('bench_press'));
    const pullups = await store.addExercise(libraryExerciseId('pullups'));
    const deadlift = await store.addExercise(libraryExerciseId('deadlift'));
    await store.linkWithPrevious(pullups.id);
    await store.logSet(bench.id, { reps: 8, weight: { value: 225, unit: 'lb' } });
    await store.logSet(bench.id, { reps: 8, weight: { value: 185, unit: 'lb' }, dropSetPosition: 1 });
    await store.logSet(bench.id, { reps: 10, weight: { value: 155, unit: 'lb' }, dropSetPosition: 2 });
    await store.logSet(bench.id, { reps: 5, weight: { value: 225, unit: 'lb' } });
    await store.logSet(pullups.id, { reps: 8 });
    await store.logSet(deadlift.id, { reps: 100, durationSeconds: 452 });
    await store.logSet(deadlift.id, { score: '7 rounds + 12 reps' });
    await store.finish();
    mockParams = { id: store.getSnapshot().workout.id };

    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('Bench Press');
    // One "Superset" unit holding bench and pull-ups; the deadlift stands alone.
    expect(screen.getAllByText('Superset')).toHaveLength(1);
    expect(screen.getByText('Pullups')).toBeTruthy();
    // The drop set: one row, numbered as one set; the next set is Set 2.
    expect(screen.getByText('8 × 225 lb → 8 × 185 lb → 10 × 155 lb')).toBeTruthy();
    expect(screen.getByText('5 × 225 lb')).toBeTruthy();
    expect(screen.getAllByText('Set 2')).toHaveLength(2); // bench's second set, deadlift's second
    expect(screen.queryByText('Set 3')).toBeNull();
    // Timed and scored work.
    expect(screen.getByText('100 reps · 7:32')).toBeTruthy();
    expect(screen.getByText('7 rounds + 12 reps')).toBeTruthy();
  });

  it('B12: shows the workout’s, each exercise’s and each set’s notes, drop notes in order', async () => {
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions(START));
    const bench = await store.addExercise(libraryExerciseId('bench_press'));
    const squat = await store.addExercise(libraryExerciseId('squat'));
    const top = await store.logSet(bench.id, { reps: 8, weight: { value: 225, unit: 'lb' } });
    const drop1 = await store.logSet(bench.id, { reps: 8, weight: { value: 185, unit: 'lb' }, dropSetPosition: 1 });
    await store.logSet(bench.id, { reps: 10, weight: { value: 155, unit: 'lb' }, dropSetPosition: 2 });
    const drop3 = await store.logSet(bench.id, { reps: 12, weight: { value: 135, unit: 'lb' }, dropSetPosition: 3 });
    await store.logSet(squat.id, { reps: 5 });
    await store.setTitle('Push day');
    await store.setNotes('Slept badly.');
    await store.setEntryNotes(bench.id, 'Grip slipping.');
    await store.setSetNotes(top.id, 'Belt on');
    await store.setSetNotes(drop1.id, 'First strip');
    await store.setSetNotes(drop3.id, 'Grip gave out');
    await store.finish();
    mockParams = { id: store.getSnapshot().workout.id };

    await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText('Push day')).toBeTruthy();
    expect(screen.getByText('Slept badly.')).toBeTruthy();
    expect(screen.getByText('Grip slipping.')).toBeTruthy();
    // The drop set's notes, in segment order; the drop with none adds no line.
    const notes = screen.getAllByText(/^(Belt on|↳ First strip|↳ Grip gave out)$/).map((n) => n.props.children);
    expect(notes).toEqual(['Belt on', '↳ First strip', '↳ Grip gave out']);
    // Squat has no note: nothing extra under it.
    expect(screen.queryByText('Add note')).toBeNull();
  });

  it('shows no note lines for a workout without notes', async () => {
    mockParams = { id: await seedWorkout(SIGNED_IN_USER_ID) };
    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('Squat');
    expect(screen.queryByText(/^↳/)).toBeNull();
  });

  it('B13: badges each set that holds a record with its kind; a set whose record was beaten loses it', async () => {
    const first = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions(START));
    const squat = await first.addExercise(libraryExerciseId('squat'));
    await first.logSet(squat.id, { reps: 5, weight: { value: 315, unit: 'lb' }, isWarmup: true });
    await first.logSet(squat.id, { reps: 1, weight: { value: 405, unit: 'lb' } });
    await first.logSet(squat.id, { reps: 3, weight: { value: 365, unit: 'lb' } });
    await first.finish();
    mockParams = { id: first.getSnapshot().workout.id };

    const view = await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('Squat');
    // The single holds the true 1RM; the triple holds the 3RM and (365 × 3 → 401.5 < 405) not e1RM.
    expect(await screen.findByText('PR · 1RM · e1RM')).toBeTruthy();
    expect(screen.getByText('PR · 3RM')).toBeTruthy();
    expect(screen.getAllByText(/^PR ·/)).toHaveLength(2); // the warm-up never
    await view.unmount();

    // A later, heavier single takes the 1RM and e1RM books: the old single's badge goes.
    const second = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions('2026-11-13T12:00:00.000Z'));
    const squat2 = await second.addExercise(libraryExerciseId('squat'));
    await second.logSet(squat2.id, { reps: 1, weight: { value: 425, unit: 'lb' } });
    await second.finish();
    await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText('PR · 3RM')).toBeTruthy();
    expect(screen.queryByText('PR · 1RM · e1RM')).toBeNull();
  });

  it('never shows another user’s workout', async () => {
    mockParams = { id: await seedWorkout(OTHER_USER_ID) };
    await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText('This workout isn’t on this phone.')).toBeTruthy();
    expect(screen.queryByText('Squat')).toBeNull();
  });

  it('Back goes to the Workout tab when there is nothing to go back to', async () => {
    mockParams = { id: 'missing' };
    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('This workout isn’t on this phone.');
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/workout');
  });
});
