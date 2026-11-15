/**
 * Tests for EntryCard, wired to a real active-workout store on real SQLite, so what the card
 * shows is what the database holds. The headline is NFR-2: a single press of Repeat logs a set
 * identical to the previous one. B10 adds the set types: warm-up toggles (LOG-14), reps-only
 * bodyweight sets (LOG-15) and an optional RPE (LOG-10).
 */
import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { lbToKg, roundWeightKgForStorage } from '@training-math';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, steadyOptions } from '@/test-utils/loggerTestKit';
import { USER_ID } from '@/test-utils/workoutFixtures';
import { startActiveWorkout, type ActiveWorkoutStore } from '@/workout/activeWorkout';
import { supersetPlacement } from '@/workout/format';
import { useWorkoutSnapshot } from '@/workout/useActiveWorkout';

import { EntryCard } from './EntryCard';

const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');

/** Renders one card per exercise in `store`, redrawing on every change, as the logger does. */
function Cards({ store, db }: { store: ActiveWorkoutStore; db: SqlDriver }) {
  const snapshot = useWorkoutSnapshot(store);
  const placement = supersetPlacement(snapshot?.entries ?? []);
  return (
    <>
      {snapshot?.entries.map((entry, i) => (
        <EntryCard
          key={entry.id}
          store={store}
          entry={entry}
          entryCount={snapshot.entries.length}
          db={db}
          userId={USER_ID}
          unit="lb"
          linkedToPrevious={placement[i].linkedToPrevious}
          inSuperset={placement[i].inSuperset}
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
    expect(await screen.findByText('Enter reps, weight and RPE as plain numbers.')).toBeTruthy();

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

  it('logs warm-ups while the Warm-up chip is pressed, and work sets once it is released (LOG-14)', async () => {
    const { store } = await setup();
    const chip = screen.getByLabelText('Warm-up sets for Bench Press');
    expect(chip.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(chip);
    expect(screen.getByLabelText('Warm-up sets for Bench Press').props.accessibilityState).toMatchObject({
      checked: true,
    });

    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '8');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '135');
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('W · 8 × 135 lb')).toBeTruthy();
    // The chip stays pressed: warm-ups come in runs.
    await fireEvent.press(screen.getByLabelText('Repeat last set'));
    await screen.findByText('Set 2');

    await fireEvent.press(screen.getByLabelText('Warm-up sets for Bench Press'));
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '5');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '225');
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('5 × 225 lb')).toBeTruthy();
    expect(store.getSnapshot().entries[0].sets.map((s) => s.is_warmup)).toEqual([true, true, false]);
  });

  it('flips a logged set between warm-up and work with its W, keeping its values', async () => {
    const { store } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '10');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '95');
    await fireEvent.press(screen.getByLabelText('Log set'));
    await screen.findByText('10 × 95 lb');
    const before = store.getSnapshot().entries[0].sets[0];
    const badge = screen.getByLabelText('Warm-up: set 1 of Bench Press');
    expect(badge.props.accessibilityState).toMatchObject({ checked: false });

    await fireEvent.press(badge);
    expect(await screen.findByText('W · 10 × 95 lb')).toBeTruthy();
    const after = store.getSnapshot().entries[0].sets[0];
    expect(after).toMatchObject({ id: before.id, reps: 10, weight_kg: before.weight_kg, is_warmup: true });
    expect(screen.getByLabelText('Warm-up: set 1 of Bench Press').props.accessibilityState).toMatchObject({
      checked: true,
    });

    await fireEvent.press(screen.getByLabelText('Warm-up: set 1 of Bench Press'));
    expect(await screen.findByText('10 × 95 lb')).toBeTruthy();
    expect(store.getSnapshot().entries[0].sets[0].is_warmup).toBe(false);
  });

  it('saves an optional RPE with the set, and refuses one outside 1–10 (LOG-10)', async () => {
    const { store } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '5');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '225');
    await fireEvent.changeText(screen.getByLabelText('RPE for Bench Press'), '8,5');
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('5 × 225 lb @ RPE 8.5')).toBeTruthy();
    expect(store.getSnapshot().entries[0].sets[0].rpe).toBe(8.5);

    await fireEvent.changeText(screen.getByLabelText('RPE for Bench Press'), '11');
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('RPE goes from 1 to 10.')).toBeTruthy();
    expect(store.getSnapshot().entries[0].sets).toHaveLength(1);
  });

  it('does not log an RPE alone', async () => {
    await setup();
    await fireEvent.changeText(screen.getByLabelText('RPE for Bench Press'), '8');
    expect(screen.getByLabelText('Log set').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('logs a pull-up with reps only; its weight box asks for added weight (LOG-15)', async () => {
    const PULLUPS = libraryExerciseId('pullups');
    const db = await createPreparedDb();
    const store = await startActiveWorkout(db, USER_ID, steadyOptions());
    await store.addExercise(PULLUPS);
    await render(<Cards store={store} db={db} />);
    const weightBox = await screen.findByLabelText('Added weight in lb for Pullups');
    expect(weightBox.props.placeholder).toBe('+ lb');

    await fireEvent.changeText(screen.getByLabelText('Reps for Pullups'), '8');
    expect(screen.getByLabelText('Log set').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('8 reps')).toBeTruthy();

    // A weighted pull-up: the added load is what's stored.
    await fireEvent.changeText(screen.getByLabelText('Reps for Pullups'), '5');
    await fireEvent.changeText(weightBox, '45');
    await fireEvent.press(screen.getByLabelText('Log set'));
    expect(await screen.findByText('5 × 45 lb')).toBeTruthy();
    expect(store.getSnapshot().entries[0].sets.map((s) => [s.reps, s.weight_kg])).toEqual([
      [8, null],
      [5, roundWeightKgForStorage(lbToKg(45))],
    ]);
  });

  it('keeps the plain weight placeholder for a barbell lift', async () => {
    await setup();
    expect(screen.getByLabelText('Weight in lb for Bench Press').props.placeholder).toBe('lb');
  });

  it('leaves warm-ups out of "Last time", and hides the line when only warm-ups were done', async () => {
    const db = await createPreparedDb();
    const past = await startActiveWorkout(db, USER_ID, steadyOptions('2026-11-10T09:00:00.000Z'));
    const pastBench = await past.addExercise(BENCH);
    const pastSquat = await past.addExercise(SQUAT);
    await past.logSet(pastBench.id, { reps: 10, weight: { value: 95, unit: 'lb' }, isWarmup: true });
    for (let i = 0; i < 3; i += 1) await past.logSet(pastBench.id, { reps: 5, weight: { value: 225, unit: 'lb' } });
    await past.logSet(pastSquat.id, { reps: 5, weight: { value: 135, unit: 'lb' }, isWarmup: true });
    await past.finish();

    const store = await startActiveWorkout(db, USER_ID, steadyOptions('2026-11-14T09:00:00.000Z'));
    await store.addExercise(BENCH);
    await store.addExercise(SQUAT);
    await render(<Cards store={store} db={db} />);
    expect(await screen.findByText('Last time: 3 × 5 @ 225 lb')).toBeTruthy();
    await screen.findByText('Squat');
    expect(screen.getAllByText(/^Last time:/)).toHaveLength(1);
  });

  describe('drop sets (LOG-12)', () => {
    /** Types reps and weight into the bench card and presses `button` ("Log set" or "Drop"). */
    async function log(reps: string, lb: string, button: 'Log set' | 'Drop') {
      await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), reps);
      await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), lb);
      await fireEvent.press(screen.getByLabelText(button));
    }

    it('keeps Drop disabled until there is a set to drop from and something typed', async () => {
      await setup();
      expect(screen.getByLabelText('Drop').props.accessibilityState).toMatchObject({ disabled: true });
      await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '8');
      expect(screen.getByLabelText('Drop').props.accessibilityState).toMatchObject({ disabled: true });
      await fireEvent.press(screen.getByLabelText('Log set'));
      await screen.findByText('8 reps');
      expect(screen.getByLabelText('Drop').props.accessibilityState).toMatchObject({ disabled: false });
    });

    it('logs each drop under its top set, numbered as one set', async () => {
      const { store } = await setup();
      await log('8', '225', 'Log set');
      await screen.findByText('8 × 225 lb');
      await log('8', '185', 'Drop');
      await screen.findByText('↳ 8 × 185 lb');
      await log('10', '155', 'Drop');
      await screen.findByText('↳ 10 × 155 lb');
      await log('5', '225', 'Log set');
      await screen.findByText('5 × 225 lb');

      expect(store.getSnapshot().entries[0].sets.map((s) => s.drop_set_position)).toEqual([null, 1, 2, null]);
      // Four rows saved, two sets as the lifter counts them.
      expect(screen.getByText('Set 1')).toBeTruthy();
      expect(screen.getByText('Set 2')).toBeTruthy();
      expect(screen.queryByText('Set 3')).toBeNull();
      expect(screen.getByLabelText('Remove drop 2 of set 1 of Bench Press')).toBeTruthy();
    });

    it('marks a whole drop set as warm-up with one W', async () => {
      const { store } = await setup();
      await log('8', '135', 'Log set');
      await screen.findByText('8 × 135 lb');
      await log('8', '95', 'Drop');
      await screen.findByText('↳ 8 × 95 lb');
      await fireEvent.press(screen.getByLabelText('Warm-up: set 1 of Bench Press'));
      await screen.findByText('W · 8 × 135 lb');
      expect(store.getSnapshot().entries[0].sets.map((s) => s.is_warmup)).toEqual([true, true]);
      // The drop row does not repeat the W.
      expect(screen.getByText('↳ 8 × 95 lb')).toBeTruthy();
    });

    it('removing a drop set’s top row removes the whole drop set, never orphaning its drops', async () => {
      const { store } = await setup();
      await log('5', '135', 'Log set');
      await screen.findByText('5 × 135 lb');
      await log('8', '225', 'Log set');
      await screen.findByText('8 × 225 lb');
      await log('8', '185', 'Drop');
      await screen.findByText('↳ 8 × 185 lb');
      await fireEvent.press(screen.getByLabelText('Remove set 2 of Bench Press'));
      await waitFor(() => expect(screen.queryByText('↳ 8 × 185 lb')).toBeNull());
      expect(store.getSnapshot().entries[0].sets.map((s) => s.reps)).toEqual([5]);
    });

    it('removes one drop, leaving the rest of the set', async () => {
      const { store } = await setup();
      await log('8', '225', 'Log set');
      await screen.findByText('8 × 225 lb');
      await log('8', '185', 'Drop');
      await screen.findByText('↳ 8 × 185 lb');
      await fireEvent.press(screen.getByLabelText('Remove drop 1 of set 1 of Bench Press'));
      expect(await screen.findByText('8 × 225 lb')).toBeTruthy();
      expect(screen.queryByText('↳ 8 × 185 lb')).toBeNull();
      expect(store.getSnapshot().entries[0].sets).toHaveLength(1);
    });
  });

  describe('timed and scored work (LOG-13)', () => {
    it('opens Time and Score boxes, and logs a time alone', async () => {
      const { store } = await setup();
      expect(screen.queryByLabelText('Time for Bench Press')).toBeNull();
      await fireEvent.press(screen.getByLabelText('Timed work for Bench Press'));
      expect(screen.getByLabelText('Timed work for Bench Press').props.accessibilityState).toMatchObject({
        checked: true,
      });
      await fireEvent.changeText(screen.getByLabelText('Time for Bench Press'), '4:32');
      expect(screen.getByLabelText('Log set').props.accessibilityState).toMatchObject({ disabled: false });
      await fireEvent.press(screen.getByLabelText('Log set'));
      expect(await screen.findByText('4:32')).toBeTruthy();
      expect(store.getSnapshot().entries[0].sets[0]).toMatchObject({ duration_seconds: 272, reps: null, score: null });
    });

    it('logs reps with a time, and a score alone', async () => {
      const { store } = await setup();
      await fireEvent.press(screen.getByLabelText('Timed work for Bench Press'));
      await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '100');
      await fireEvent.changeText(screen.getByLabelText('Time for Bench Press'), '7:32');
      await fireEvent.press(screen.getByLabelText('Log set'));
      await screen.findByText('100 reps · 7:32');

      await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '');
      await fireEvent.changeText(screen.getByLabelText('Time for Bench Press'), '');
      await fireEvent.changeText(screen.getByLabelText('Score for Bench Press'), '7 rounds + 12 reps');
      await fireEvent.press(screen.getByLabelText('Log set'));
      expect(await screen.findByText('7 rounds + 12 reps')).toBeTruthy();
      expect(store.getSnapshot().entries[0].sets.map((s) => [s.reps, s.duration_seconds, s.score])).toEqual([
        [100, 452, null],
        [null, null, '7 rounds + 12 reps'],
      ]);
    });

    it('closing Timed empties its boxes, so nothing hidden is logged', async () => {
      const { store } = await setup();
      await fireEvent.press(screen.getByLabelText('Timed work for Bench Press'));
      await fireEvent.changeText(screen.getByLabelText('Time for Bench Press'), '60');
      await fireEvent.changeText(screen.getByLabelText('Score for Bench Press'), 'AMRAP');
      await fireEvent.press(screen.getByLabelText('Timed work for Bench Press'));
      expect(screen.queryByLabelText('Time for Bench Press')).toBeNull();
      expect(screen.getByLabelText('Log set').props.accessibilityState).toMatchObject({ disabled: true });
      await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '5');
      await fireEvent.press(screen.getByLabelText('Log set'));
      await screen.findByText('5 reps');
      expect(store.getSnapshot().entries[0].sets[0]).toMatchObject({ duration_seconds: null, score: null });
      // Reopened, the boxes start empty.
      await fireEvent.press(screen.getByLabelText('Timed work for Bench Press'));
      expect(screen.getByLabelText('Time for Bench Press').props.value).toBe('');
    });

    it('refuses a time it cannot read, saving nothing', async () => {
      const { store } = await setup();
      await fireEvent.press(screen.getByLabelText('Timed work for Bench Press'));
      await fireEvent.changeText(screen.getByLabelText('Time for Bench Press'), '4,32');
      await fireEvent.press(screen.getByLabelText('Log set'));
      expect(await screen.findByText('Enter the time as seconds or m:ss, like 90 or 4:32.')).toBeTruthy();
      expect(store.getSnapshot().entries[0].sets).toEqual([]);
    });
  });

  describe('supersets (LOG-11)', () => {
    it('links a card with the one above, badges both, and unlinks again', async () => {
      const { store } = await setup([BENCH, SQUAT]);
      await screen.findByText('Squat');
      // The first card has nothing above it to link to.
      expect(screen.queryByLabelText('Superset Bench Press with the exercise above')).toBeNull();
      const toggle = screen.getByLabelText('Superset Squat with the exercise above');
      expect(toggle.props.accessibilityState).toMatchObject({ checked: false });
      expect(screen.queryByText('Superset')).toBeNull();

      await fireEvent.press(toggle);
      expect(await screen.findAllByText('Superset')).toHaveLength(2);
      expect(screen.getByLabelText('Superset Squat with the exercise above').props.accessibilityState).toMatchObject({
        checked: true,
      });
      expect(store.getSnapshot().entries.map((e) => e.superset_group)).toEqual([1, 1]);

      await fireEvent.press(screen.getByLabelText('Superset Squat with the exercise above'));
      await screen.findByLabelText('Superset Squat with the exercise above');
      expect(store.getSnapshot().entries.map((e) => e.superset_group)).toEqual([null, null]);
      expect(screen.queryByText('Superset')).toBeNull();
    });
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
