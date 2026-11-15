/**
 * Tests for EntryCard, wired to a real active-workout store on real SQLite, so what the card
 * shows is what the database holds. The headline is NFR-2: a single press of Repeat logs a set
 * identical to the previous one.
 */
import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { lbToKg, roundWeightKgForStorage } from '@training-math';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, steadyOptions } from '@/test-utils/loggerTestKit';
import { USER_ID } from '@/test-utils/workoutFixtures';
import { startActiveWorkout, type ActiveWorkoutStore } from '@/workout/activeWorkout';
import { useWorkoutSnapshot } from '@/workout/useActiveWorkout';

import { EntryCard } from './EntryCard';

const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');

/** Renders one card per exercise in `store`, redrawing on every change, as the logger does. */
function Cards({ store, db }: { store: ActiveWorkoutStore; db: SqlDriver }) {
  const snapshot = useWorkoutSnapshot(store);
  return (
    <>
      {snapshot?.entries.map((entry) => (
        <EntryCard
          key={entry.id}
          store={store}
          entry={entry}
          entryCount={snapshot.entries.length}
          db={db}
          userId={USER_ID}
          unit="lb"
        />
      ))}
    </>
  );
}

/** A fresh workout with the given exercises, rendered; waits for the names to load. */
async function setup(exerciseIds: string[] = [BENCH]) {
  const db = await createPreparedDb();
  const store = await startActiveWorkout(db, USER_ID, steadyOptions('2026-11-14T12:00:00.000Z'));
  for (const id of exerciseIds) await store.addExercise(id);
  await render(<Cards store={store} db={db} />);
  await screen.findByText('Bench Press');
  return { db, store, entryId: () => store.getSnapshot().entries[0].id };
}

/** The bench card's saved sets as [reps, kg] pairs. */
function benchSets(store: ActiveWorkoutStore) {
  return store.getSnapshot().entries[0].sets.map((s) => [s.reps, s.weight_kg]);
}

describe('EntryCard', () => {
  it('logs a set typed in pounds, stored in kg, shown back in pounds', async () => {
    const { store } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '8');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '185');
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('8 × 185 lb')).toBeTruthy();
    expect(benchSets(store)).toEqual([[8, roundWeightKgForStorage(lbToKg(185))]]);
  });

  it('repeats the last set with exactly one press (NFR-2)', async () => {
    const { store } = await setup();
    const repeat = screen.getByLabelText('Repeat last set');
    expect(repeat.props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '5');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '225');
    await fireEvent.press(screen.getByLabelText('Log set'));
    await screen.findByText('Set 1');

    await fireEvent.press(screen.getByLabelText('Repeat last set')); // the one tap
    expect(await screen.findByText('Set 2')).toBeTruthy();
    const [first, second] = store.getSnapshot().entries[0].sets;
    expect(second).toMatchObject({
      reps: first.reps,
      weight_kg: first.weight_kg,
      rpe: first.rpe,
      is_warmup: first.is_warmup,
      position: 1,
    });
    expect(screen.getAllByText('5 × 225 lb')).toHaveLength(2);
  });

  it('accepts reps only or weight only, and comma decimals', async () => {
    const { store } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '12');
    await fireEvent.press(screen.getByLabelText('Log set'));
    await screen.findByText('12 reps');
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '102,5');
    await fireEvent.press(screen.getByLabelText('Log set'));
    await screen.findByText('102.5 lb');
    expect(benchSets(store)).toEqual([
      [12, null],
      [null, roundWeightKgForStorage(lbToKg(102.5))],
    ]);
  });

  it('keeps Log disabled until something is typed', async () => {
    await setup();
    expect(screen.getByLabelText('Log set').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('turns away values the server would refuse with a message, saving nothing', async () => {
    const { store } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), 'abc');
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('Enter reps and weight as plain numbers.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '8.5');
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('Reps must be a whole number.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '1');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '30000');
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('That weight is too big to save.')).toBeTruthy();

    expect(benchSets(store)).toEqual([]);
  });

  it('removes a set', async () => {
    const { store } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '5');
    await fireEvent.press(screen.getByLabelText('Log set'));
    await fireEvent.press(await screen.findByLabelText('Repeat last set'));
    await screen.findByText('Set 2');
    await fireEvent.press(screen.getByLabelText('Remove set 1 of Bench Press'));
    expect(await screen.findByText('Set 1')).toBeTruthy();
    expect(screen.queryByText('Set 2')).toBeNull();
    expect(store.getSnapshot().entries[0].sets).toHaveLength(1);
  });

  it('moves an exercise and removes one', async () => {
    const { store } = await setup([BENCH, SQUAT]);
    await screen.findByText('Squat');
    expect(screen.getByLabelText('Move Bench Press up').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByLabelText('Move Squat down').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByLabelText('Move Squat up'));
    await screen.findByLabelText('Move Bench Press down');
    const order = () => store.getSnapshot().entries.map((e) => e.exercise_id);
    expect(order()).toEqual([SQUAT, BENCH]);

    await fireEvent.press(screen.getByLabelText('Remove Squat'));
    expect(order()).toEqual([BENCH]);
    expect(screen.queryByText('Squat')).toBeNull();
  });

  it('a double-tap moves an exercise once, not twice', async () => {
    const DEADLIFT = libraryExerciseId('deadlift');
    const db = await createPreparedDb();
    const store = await startActiveWorkout(db, USER_ID, steadyOptions());
    for (const id of [BENCH, SQUAT, DEADLIFT]) await store.addExercise(id);
    // Hold the first save open until both taps have landed.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const slowStore: ActiveWorkoutStore = {
      ...store,
      reorderExercise: async (entryId, position) => {
        calls += 1;
        await gate;
        return store.reorderExercise(entryId, position);
      },
    };
    await render(<Cards store={slowStore} db={db} />);
    await screen.findByText('Deadlift');
    await fireEvent.press(screen.getByLabelText('Move Bench Press down'));
    await fireEvent.press(screen.getByLabelText('Move Bench Press down'));
    release();
    await screen.findByLabelText('Move Bench Press up');
    expect(calls).toBe(1);
    expect(store.getSnapshot().entries.map((e) => e.exercise_id)).toEqual([SQUAT, BENCH, DEADLIFT]);
  });

  it('shows the previous session’s sets as "Last time", never this workout’s', async () => {
    const db = await createPreparedDb();
    const past = await startActiveWorkout(db, USER_ID, steadyOptions('2026-11-10T09:00:00.000Z'));
    const pastBench = await past.addExercise(BENCH);
    for (const reps of [8, 8, 8, 6]) await past.logSet(pastBench.id, { reps, weight: { value: 185, unit: 'lb' } });
    await past.finish();

    const store = await startActiveWorkout(db, USER_ID, steadyOptions('2026-11-14T09:00:00.000Z'));
    await store.addExercise(BENCH);
    await store.addExercise(SQUAT);
    await render(<Cards store={store} db={db} />);
    expect(await screen.findByText('Last time: 3 × 8 @ 185 lb, 6 @ 185 lb')).toBeTruthy();
    // Squat was never logged: no line, no error.
    await screen.findByText('Squat');
    expect(screen.getAllByText(/^Last time:/)).toHaveLength(1);
  });
});
