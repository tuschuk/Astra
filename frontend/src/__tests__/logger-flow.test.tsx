/**
 * The B09 definition of done, walked end to end through the real screens, the real
 * active-workout store and real SQLite:
 *
 *   Workout tab → Start empty workout → logger → add two exercises by search → log sets in
 *   pounds → repeat a set with ONE press → Finish → saved workout shows every set intact →
 *   nothing is left in progress.
 *
 * Plus B10's set types through the same screens (a reps-only pull-up, a warm-up, an RPE), and
 * the logger's two exits that don't save: finishing with nothing logged (offered only
 * "Discard workout" / "Keep lifting") and Discard. The router is a stub, so each screen is
 * rendered in turn the way navigation would show it; the database is handed in through a
 * mocked `openAppDatabase`. Sync is proven in B07/B08; B11's test pushes once more to show its
 * new columns (superset, drop, time, score) reach the stand-in server intact. B13 walks the
 * last-time panel (previous sets + current PRs + History link) and the PR badge Finish leaves on
 * the saved workout: a heavier 5 is flagged, a repeat of the record is not.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { createCustomExercise, deleteCustomExercise } from '@/library/customExercises';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';
import { loadActiveWorkout, startActiveWorkout } from '@/workout/activeWorkout';
import { clearSessionWorkout, currentSessionWorkout } from '@/workout/activeWorkoutSession';
import { readWorkout } from '@/workout/history';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';

import WorkoutScreen from '@/app/(tabs)/workout';
import ActiveWorkoutScreen from '@/app/active-workout';
import SavedWorkoutScreen from '@/app/workout/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { id?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

afterEach(() => {
  clearSessionWorkout();
  jest.restoreAllMocks();
});

/** Opens the Add-exercise panel, searches, and taps the exercise. */
async function addExercise(search: string, name: string): Promise<void> {
  await fireEvent.press(screen.getByLabelText('Add exercise'));
  await fireEvent.changeText(screen.getByLabelText('Search exercises'), search);
  await fireEvent.press(screen.getByLabelText(`Add ${name}`));
  await screen.findByLabelText(`Reps for ${name}`);
}

/** Types reps and weight (lb) into an exercise's card and taps Log set. */
async function logSet(name: string, reps: string, weight: string, setNumber: number): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText(`Reps for ${name}`), reps);
  await fireEvent.changeText(screen.getByLabelText(`Weight in lb for ${name}`), weight);
  const logButtons = screen.getAllByLabelText('Log set');
  const cardIndex = name === 'Bench Press' ? 0 : 1;
  await fireEvent.press(logButtons[cardIndex]);
  await screen.findByLabelText(`Remove set ${setNumber} of ${name}`);
}

describe('custom exercises in the logger (B31, LIB-5)', () => {
  it('a live custom is offered by the picker and logs under its own id; a deleted one is not offered', async () => {
    const mine = await createCustomExercise(db, SIGNED_IN_USER_ID, { name: 'Zercher Carry', equipment: 'Barbell', primaryMuscle: null });
    const gone = await createCustomExercise(db, SIGNED_IN_USER_ID, { name: 'Zercher Retired', equipment: null, primaryMuscle: null });
    await deleteCustomExercise(db, SIGNED_IN_USER_ID, gone.id);
    await startActiveWorkout(db, SIGNED_IN_USER_ID);

    await renderSignedIn(<ActiveWorkoutScreen />);
    await screen.findByText('No exercises yet. Add the first one to start logging.');
    await fireEvent.press(screen.getByLabelText('Add exercise'));
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zercher');
    expect(screen.queryByLabelText('Add Zercher Retired')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Add Zercher Carry'));
    await screen.findByLabelText('Reps for Zercher Carry');

    const loaded = await loadActiveWorkout(db, SIGNED_IN_USER_ID);
    expect(loaded?.getSnapshot().entries.map((e) => e.exercise_id)).toEqual([mine.id]);
  });
});

describe('logger flow (B09 definition of done)', () => {
  it('logs a multi-exercise session, saves it and reopens it with every set intact', async () => {
    // 1. The Workout tab starts a blank workout.
    const tab = await renderSignedIn(<WorkoutScreen />);
    await screen.findByText('Finished workouts show up here.');
    await fireEvent.press(screen.getByLabelText('Start empty workout'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/active-workout'));
    await tab.unmount();

    // 2. The logger: two exercises from the library, sets in pounds, one-tap repeat.
    await renderSignedIn(<ActiveWorkoutScreen />);
    await screen.findByText('No exercises yet. Add the first one to start logging.');
    await addExercise('bench press', 'Bench Press');
    await logSet('Bench Press', '5', '225', 1);
    const [repeatBench] = screen.getAllByLabelText('Repeat last set');
    await fireEvent.press(repeatBench); // NFR-2: exactly one tap
    await screen.findByLabelText('Remove set 2 of Bench Press');

    await addExercise('squats', 'Squat');
    await logSet('Squat', '3', '315', 1);
    await logSet('Squat', '2', '335', 2);

    await fireEvent.press(screen.getByLabelText('Finish'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const [[target]] = mockRouter.replace.mock.calls as [[{ pathname: string; params: { id: string } }]];
    // B18: Finish lands on the workout's analysis (its own tests: analysis.test.tsx).
    expect(target.pathname).toBe('/analysis/[id]');
    // Finishing replaced the logger; it did not also try to go "back".
    expect(mockRouter.back).not.toHaveBeenCalled();
    await screen.unmount();

    // 3. The saved workout (the analysis's "View workout"): every set, as logged.
    mockParams = { id: target.params.id };
    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('Bench Press');
    expect(screen.getAllByText('5 × 225 lb')).toHaveLength(2);
    expect(screen.getByText('Squat')).toBeTruthy();
    expect(screen.getByText('3 × 315 lb')).toBeTruthy();
    expect(screen.getByText('2 × 335 lb')).toBeTruthy();
    expect(screen.getByText(/2 exercises · 4 sets$/)).toBeTruthy();

    // The database agrees, and nothing is left in progress.
    const saved = await readWorkout(db, SIGNED_IN_USER_ID, target.params.id);
    expect(saved?.entries.map((e) => [e.exerciseName, e.sets.map((s) => s.reps)])).toEqual([
      ['Bench Press', [5, 5]],
      ['Squat', [3, 2]],
    ]);
    expect(saved?.entries[0].sets[0].weight_kg).toBe(saved?.entries[0].sets[1].weight_kg);
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).toBeNull();
    expect(currentSessionWorkout(SIGNED_IN_USER_ID)).toBeNull();
  });

  it('B10: a pull-up logged with reps only, a warm-up and an RPE survive finish to the saved workout', async () => {
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);

    // A warm-up, then a work set with an RPE, on bench.
    await addExercise('bench press', 'Bench Press');
    await fireEvent.press(screen.getByLabelText('Warm-up sets for Bench Press'));
    await logSet('Bench Press', '10', '95', 1);
    await fireEvent.press(screen.getByLabelText('Warm-up sets for Bench Press'));
    await fireEvent.changeText(screen.getByLabelText('RPE for Bench Press'), '8');
    await logSet('Bench Press', '5', '225', 2);

    // A pull-up: reps only, nothing in the weight box (LOG-15).
    await addExercise('pullups', 'Pullups');
    await fireEvent.changeText(screen.getByLabelText('Reps for Pullups'), '8');
    await fireEvent.press(screen.getAllByLabelText('Log set')[1]);
    await screen.findByLabelText('Remove set 1 of Pullups');

    await fireEvent.press(screen.getByLabelText('Finish'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const [[target]] = mockRouter.replace.mock.calls as [[{ params: { id: string } }]];
    await screen.unmount();

    mockParams = { id: target.params.id };
    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('Pullups');
    expect(screen.getByText('W · 10 × 95 lb')).toBeTruthy();
    expect(screen.getByText('5 × 225 lb @ RPE 8')).toBeTruthy();
    expect(screen.getByText('8 reps')).toBeTruthy();

    const saved = await readWorkout(db, SIGNED_IN_USER_ID, target.params.id);
    expect(saved?.entries.map((e) => e.sets.map((s) => [s.reps, s.weight_kg === null, s.rpe, s.is_warmup]))).toEqual([
      [
        [10, false, null, true],
        [5, false, 8, false],
      ],
      [[8, true, null, false]],
    ]);
  });

  it('B13: the panel shows last time and PRs; a heavier 5 is flagged a 5RM on the saved workout, a repeat is not', async () => {
    // Last session: 5 × 200 lb on bench.
    const past = await startActiveWorkout(db, SIGNED_IN_USER_ID, {
      clock: () => '2026-11-10T09:00:00.000Z',
    });
    const pastBench = await past.addExercise(libraryExerciseId('bench_press'));
    await past.logSet(pastBench.id, { reps: 5, weight: { value: 200, unit: 'lb' } });
    await past.finish();

    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);
    await addExercise('bench press', 'Bench Press');
    // The last-time panel (LOG-5): last session's sets, the current PRs, and a History link.
    expect(await screen.findByText('Last time: 5 @ 200 lb')).toBeTruthy();
    expect(await screen.findByText(/^PRs: e1RM 233\.3 lb · 5RM 200 lb$/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('History of Bench Press'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/exercise-history/[exerciseId]',
      params: { exerciseId: pastBench.exercise_id },
    });

    await logSet('Bench Press', '5', '200', 1); // a repeat of the record: volume, not a PR
    await logSet('Bench Press', '5', '225', 2); // a heavier 5: 5RM and e1RM
    await fireEvent.press(screen.getByLabelText('Finish'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const [[target]] = mockRouter.replace.mock.calls as [[{ params: { id: string } }]];
    await screen.unmount();

    mockParams = { id: target.params.id };
    await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText('PR · e1RM · 5RM')).toBeTruthy();
    expect(screen.getAllByText(/^PR ·/)).toHaveLength(1); // only the 225 set
  });

  it('B11: a superset, a drop set, a timed and a scored entry log, sync and show as one unit each', async () => {
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);

    // A superset: bench, then pull-ups linked to it (LOG-11).
    await addExercise('bench press', 'Bench Press');
    await addExercise('pullups', 'Pullups');
    await fireEvent.press(screen.getByLabelText('Superset Pullups with the exercise above'));
    expect(await screen.findAllByText('Superset')).toHaveLength(2);

    // A three-segment drop set on bench (LOG-12).
    await logSet('Bench Press', '8', '225', 1);
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '185');
    await fireEvent.press(screen.getAllByLabelText('Drop')[0]);
    await screen.findByLabelText('Remove drop 1 of set 1 of Bench Press');
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '10');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '155');
    await fireEvent.press(screen.getAllByLabelText('Drop')[0]);
    await screen.findByLabelText('Remove drop 2 of set 1 of Bench Press');

    // A pull-up set inside the superset.
    await fireEvent.changeText(screen.getByLabelText('Reps for Pullups'), '8');
    await fireEvent.press(screen.getAllByLabelText('Log set')[1]);
    await screen.findByLabelText('Remove set 1 of Pullups');

    // Timed and scored work on a third exercise (LOG-13).
    await addExercise('deadlift', 'Deadlift');
    await fireEvent.press(screen.getByLabelText('Timed work for Deadlift'));
    await fireEvent.changeText(screen.getByLabelText('Reps for Deadlift'), '100');
    await fireEvent.changeText(screen.getByLabelText('Time for Deadlift'), '7:32');
    await fireEvent.press(screen.getAllByLabelText('Log set')[2]);
    await screen.findByLabelText('Remove set 1 of Deadlift');
    await fireEvent.changeText(screen.getByLabelText('Reps for Deadlift'), '');
    await fireEvent.changeText(screen.getByLabelText('Time for Deadlift'), '');
    await fireEvent.changeText(screen.getByLabelText('Score for Deadlift'), '7 rounds + 12 reps');
    await fireEvent.press(screen.getAllByLabelText('Log set')[2]);
    await screen.findByLabelText('Remove set 2 of Deadlift');

    await fireEvent.press(screen.getByLabelText('Finish'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const [[target]] = mockRouter.replace.mock.calls as [[{ params: { id: string } }]];
    await screen.unmount();

    // Displays: the saved workout shows each as one unit.
    mockParams = { id: target.params.id };
    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('Pullups');
    expect(screen.getAllByText('Superset')).toHaveLength(1);
    expect(screen.getByText('8 × 225 lb → 8 × 185 lb → 10 × 155 lb')).toBeTruthy();
    expect(screen.getByText('100 reps · 7:32')).toBeTruthy();
    expect(screen.getByText('7 rounds + 12 reps')).toBeTruthy();

    // Syncs: the upload carries every new column intact.
    const saved = await readWorkout(db, SIGNED_IN_USER_ID, target.params.id);
    const server = new FakeServer();
    await pushOutbox(db, server);
    const [benchEntry, pullupEntry, deadliftEntry] = saved!.entries;
    expect(
      [benchEntry, pullupEntry, deadliftEntry].map((e) => server.tables.workout_exercises.get(e.id)?.superset_group),
    ).toEqual([1, 1, null]);
    expect(benchEntry.sets.map((s) => server.tables.sets.get(s.id)?.drop_set_position)).toEqual([null, 1, 2]);
    expect(deadliftEntry.sets.map((s) => server.tables.sets.get(s.id))).toEqual([
      expect.objectContaining({ reps: 100, duration_seconds: 452, score: null }),
      expect.objectContaining({ reps: null, duration_seconds: null, score: '7 rounds + 12 reps' }),
    ]);
  });

  it('B12: a title and notes at all three levels, typed right before Finish, save, sync and show on review', async () => {
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);
    await addExercise('bench press', 'Bench Press');
    await logSet('Bench Press', '8', '225', 1);
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '185');
    await fireEvent.press(screen.getByLabelText('Drop'));
    await screen.findByLabelText('Remove drop 1 of set 1 of Bench Press');

    // Every box is typed into and Finish is tapped at once: no box is closed, no autosave timer
    // has run — Finish must save them all first.
    await fireEvent.changeText(screen.getByLabelText('Workout title'), 'Push day');
    await fireEvent.changeText(screen.getByLabelText('Workout notes'), 'Slept badly, still moved well.');
    await fireEvent.press(screen.getByLabelText('Add a note on Bench Press'));
    await fireEvent.changeText(await screen.findByLabelText('Note on Bench Press'), 'Grip slipping on the top set.');
    await fireEvent.press(screen.getByLabelText('Write a note on drop 1 of set 1 of Bench Press'));
    await fireEvent.changeText(await screen.findByLabelText('Note on drop 1 of set 1 of Bench Press'), 'Grip gave out');
    await fireEvent.press(screen.getByLabelText('Write a note on set 1 of Bench Press'));
    await fireEvent.changeText(await screen.findByLabelText('Note on set 1 of Bench Press'), 'Elbow twinged on rep 3');
    await fireEvent.press(screen.getByLabelText('Finish'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const [[target]] = mockRouter.replace.mock.calls as [[{ params: { id: string } }]];
    await screen.unmount();

    // Shows on review: the saved workout prints all three levels.
    mockParams = { id: target.params.id };
    await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText('Push day')).toBeTruthy();
    expect(screen.getByText('Slept badly, still moved well.')).toBeTruthy();
    expect(screen.getByText('Grip slipping on the top set.')).toBeTruthy();
    expect(screen.getByText('Elbow twinged on rep 3')).toBeTruthy();
    expect(screen.getByText('↳ Grip gave out')).toBeTruthy();

    // Syncs: the upload carries every note.
    const saved = await readWorkout(db, SIGNED_IN_USER_ID, target.params.id);
    const server = new FakeServer();
    await pushOutbox(db, server);
    expect(server.tables.workouts.get(target.params.id)).toMatchObject({
      title: 'Push day',
      notes: 'Slept badly, still moved well.',
    });
    const [bench] = saved!.entries;
    expect(server.tables.workout_exercises.get(bench.id)).toMatchObject({ notes: 'Grip slipping on the top set.' });
    expect(bench.sets.map((s) => server.tables.sets.get(s.id)?.notes)).toEqual(['Elbow twinged on rep 3', 'Grip gave out']);
  });

  it('B12: Finish stops, and says so, when a note can’t be saved', async () => {
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);
    await addExercise('bench press', 'Bench Press');
    await logSet('Bench Press', '5', '225', 1);
    // Past the 2000-character cap (the box's maxLength normally stops this).
    await fireEvent.changeText(screen.getByLabelText('Workout notes'), 'x'.repeat(2001));
    await fireEvent.press(screen.getByLabelText('Finish'));
    expect(await screen.findByText('A title or note couldn’t be saved. Fix it, then tap Finish again.')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).not.toBeNull(); // still in progress

    // Fixing the note lets Finish through.
    await fireEvent.changeText(screen.getByLabelText('Workout notes'), 'fine');
    await fireEvent.press(screen.getByLabelText('Finish'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  });

  it('finishing with no sets offers only Discard workout or Keep lifting', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);
    await addExercise('deadlift', 'Deadlift'); // an exercise alone isn't something logged
    await fireEvent.press(screen.getByLabelText('Finish'));

    expect(alert.mock.calls[0][0]).toBe('Nothing logged yet');
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    expect(buttons.map((b) => b.text)).toEqual(['Keep lifting', 'Discard workout']);
    expect(mockRouter.replace).not.toHaveBeenCalled();

    buttons.find((b) => b.text === 'Discard workout')?.onPress?.();
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).toBeNull();
  });

  it('Discard asks first, then deletes the workout and leaves', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);
    await addExercise('bench press', 'Bench Press');
    await logSet('Bench Press', '5', '135', 1);
    await fireEvent.press(screen.getByLabelText('Discard'));
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).not.toBeNull(); // only asked so far

    (alert.mock.calls[0][2] as AlertButton[]).find((b) => b.text === 'Discard workout')?.onPress?.();
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).toBeNull();
  });

  it('opened with nothing in progress, the logger goes back', async () => {
    await renderSignedIn(<ActiveWorkoutScreen />);
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  });
});
