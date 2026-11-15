/**
 * Tests for the analysis screen (B18): it shows the session's numbers in the lifter's unit, the
 * encouraging copy and the PRs, works with no server copy at all (offline), carries the
 * not-medical-advice statement in every state (NFR-9), and is reachable from the saved workout;
 * and (B19) its muscle map shades exactly the muscles the logged exercises trained (ANA-3).
 * Real SQLite through a mocked `openAppDatabase`; the router is a stub.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { NOT_MEDICAL_ADVICE } from '@analysis';

import type { SqlDriver } from '@/db/driver';
import type { MuscleKey } from '@/library/exercises';
import { MUSCLE_ORDER } from '@/library/muscles';
import { libraryExerciseId } from '@/library/uuidv5';
import { unitStore } from '@/settings/unitStore';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { isShaded } from '@/test-utils/muscleMapQueries';
import { startActiveWorkout } from '@/workout/activeWorkout';
import { openWorkoutForEdit } from '@/workout/editWorkout';
import { formatWeight } from '@/workout/format';

import AnalysisScreen from '@/app/analysis/[id]';
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
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  unitStore.reset();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

/** A finished squat session for `userId`: warm-up 10×95 lb, 5×225 lb, 3×275 lb. Returns its id. */
async function seedWorkout(userId = SIGNED_IN_USER_ID): Promise<string> {
  const store = await startActiveWorkout(db, userId, steadyOptions('2026-11-12T12:00:00.000Z'));
  const squat = await store.addExercise(libraryExerciseId('squat'));
  await store.logSet(squat.id, { reps: 10, weight: { value: 95, unit: 'lb' }, isWarmup: true });
  await store.logSet(squat.id, { reps: 5, weight: { value: 225, unit: 'lb' } });
  await store.logSet(squat.id, { reps: 3, weight: { value: 275, unit: 'lb' } });
  return (await store.finish()).id;
}

describe('Analysis screen', () => {
  it('shows the copy, the numbers in the lifter’s unit and the PRs — computed on the phone, no server copy needed', async () => {
    mockParams = { id: await seedWorkout() };
    await renderSignedIn(<AnalysisScreen />);
    expect(await screen.findByText(/new personal records!$/)).toBeTruthy();
    const volumeKg = (await db.getFirstAsync<{ v: number }>(
      'select sum(reps * weight_kg) as v from sets where is_warmup = 0',
    ))!.v;
    expect(screen.getByText(formatWeight(Math.round(volumeKg * 1000) / 1000, 'lb'))).toBeTruthy();
    expect(screen.getByText('3 sets · 1 warm-up')).toBeTruthy();
    expect(screen.getByText('New PRs')).toBeTruthy();
    expect(screen.getByText('Squat · 5RM · 225 lb')).toBeTruthy();
    expect(screen.getByText('Squat · 3RM · 275 lb')).toBeTruthy();
    expect(screen.getByText(NOT_MEDICAL_ADVICE)).toBeTruthy();
    // No copy string carries a unit: the only "lb" on screen is in the numbers.
    expect(screen.queryByText(/kg/)).toBeNull();
  });

  it('shows kilograms for a kg lifter (numbers only — the copy never names a unit)', async () => {
    mockParams = { id: await seedWorkout() };
    await unitStore.setUnit(db, SIGNED_IN_USER_ID, 'kg');
    await renderSignedIn(<AnalysisScreen />);
    expect(await screen.findByText(/^Squat · 5RM · [\d.]+ kg$/)).toBeTruthy();
    expect(screen.queryByText(/lb/)).toBeNull();
  });

  it('carries the not-medical-advice statement when the workout isn’t there, and Back goes to the Workout tab', async () => {
    mockParams = { id: 'missing' };
    await renderSignedIn(<AnalysisScreen />);
    expect(await screen.findByText('This workout isn’t on this phone.')).toBeTruthy();
    expect(screen.getByText(NOT_MEDICAL_ADVICE)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/workout');
  });

  it('never shows another user’s workout, and never an unfinished one', async () => {
    mockParams = { id: await seedWorkout('22222222-2222-4222-8222-222222222222') };
    const view = await renderSignedIn(<AnalysisScreen />);
    expect(await screen.findByText('This workout isn’t on this phone.')).toBeTruthy();
    await view.unmount();

    const draft = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions());
    mockParams = { id: draft.getSnapshot().workout.id };
    await renderSignedIn(<AnalysisScreen />);
    expect(await screen.findByText('This workout isn’t on this phone.')).toBeTruthy();
  });

  it('an empty finish still gets encouraging copy and the statement', async () => {
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions());
    mockParams = { id: (await store.finish()).id };
    await renderSignedIn(<AnalysisScreen />);
    expect(await screen.findByText('You showed up')).toBeTruthy();
    expect(screen.getByText('0 sets')).toBeTruthy();
    expect(screen.queryByText('New PRs')).toBeNull();
    expect(screen.getByText(NOT_MEDICAL_ADVICE)).toBeTruthy();
  });

  it('View workout opens the saved workout', async () => {
    const id = await seedWorkout();
    mockParams = { id };
    await renderSignedIn(<AnalysisScreen />);
    await fireEvent.press(await screen.findByLabelText('View workout'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/workout/[id]', params: { id } });
  });

  describe('muscle map (ANA-3)', () => {
    /** A finished session whose only exercise is the library's Bench Press. */
    async function seedBenchOnly(): Promise<string> {
      const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions('2026-11-12T12:00:00.000Z'));
      const bench = await store.addExercise(libraryExerciseId('bench_press'));
      await store.logSet(bench.id, { reps: 5, weight: { value: 185, unit: 'lb' } });
      await store.logSet(bench.id, { reps: 5, weight: { value: 185, unit: 'lb' } });
      return (await store.finish()).id;
    }

    it('a bench-only session highlights chest, shoulders and triceps and nothing else (step DoD)', async () => {
      mockParams = { id: await seedBenchOnly() };
      await renderSignedIn(<AnalysisScreen />);
      expect(await screen.findByText('Muscles trained')).toBeTruthy();
      const trained: MuscleKey[] = ['chest', 'shoulders', 'triceps'];
      for (const muscle of MUSCLE_ORDER) {
        expect([muscle, isShaded(muscle)]).toEqual([muscle, trained.includes(muscle)]);
      }
      // Sighted and screen-reader users both get the names, most direct first.
      expect(screen.getByText('Chest, Shoulders, Triceps')).toBeTruthy();
      expect(screen.getByLabelText('Muscles trained: Chest, Shoulders, Triceps')).toBeTruthy();
    });

    it('a squat session with warm-ups names the squat’s muscles, most direct first', async () => {
      mockParams = { id: await seedWorkout() };
      await renderSignedIn(<AnalysisScreen />);
      expect(await screen.findByText('Quads, Glutes, Hamstrings')).toBeTruthy();
      expect(isShaded('quads')).toBe(true);
      expect(isShaded('chest')).toBe(false);
    });

    it('is left out for an empty finish', async () => {
      const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions());
      mockParams = { id: (await store.finish()).id };
      await renderSignedIn(<AnalysisScreen />);
      expect(await screen.findByText('You showed up')).toBeTruthy();
      expect(screen.queryByText('Muscles trained')).toBeNull();
    });

    it('is left out for a custom-exercise-only session (no library muscle data), the rest of the screen intact', async () => {
      const custom = 'c0000000-0000-4000-8000-000000000001';
      await db.runAsync(
        `insert into exercises (id, owner_id, name, primary_muscle, equipment, slug, created_at, updated_at)
         values (?, ?, 'My Press', 'Chest', 'Machine', null, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`,
        [custom, SIGNED_IN_USER_ID],
      );
      const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions());
      const entry = await store.addExercise(custom);
      await store.logSet(entry.id, { reps: 10, weight: { value: 100, unit: 'lb' } });
      mockParams = { id: (await store.finish()).id };
      await renderSignedIn(<AnalysisScreen />);
      expect(await screen.findByText('1 set')).toBeTruthy();
      expect(screen.queryByText('Muscles trained')).toBeNull();
    });

    it('follows an edit: removing the bench leaves only the squat’s muscles', async () => {
      const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions('2026-11-12T12:00:00.000Z'));
      const bench = await store.addExercise(libraryExerciseId('bench_press'));
      await store.logSet(bench.id, { reps: 5, weight: { value: 185, unit: 'lb' } });
      const squat = await store.addExercise(libraryExerciseId('squat'));
      await store.logSet(squat.id, { reps: 5, weight: { value: 225, unit: 'lb' } });
      const { id } = await store.finish();
      mockParams = { id };
      const view = await renderSignedIn(<AnalysisScreen />);
      expect(await screen.findByText('Chest, Quads, Glutes, Shoulders, Triceps, Hamstrings')).toBeTruthy();
      await view.unmount();

      const edit = await openWorkoutForEdit(db, SIGNED_IN_USER_ID, id, steadyOptions('2026-11-12T14:00:00.000Z'));
      await edit!.removeExercise(edit!.getSnapshot().entries[0].id);
      await renderSignedIn(<AnalysisScreen />);
      expect(await screen.findByText('Quads, Glutes, Hamstrings')).toBeTruthy();
      expect(isShaded('chest')).toBe(false);
    });
  });

  it('the saved workout opens its analysis (ANA-1: from any past workout)', async () => {
    const id = await seedWorkout();
    mockParams = { id };
    await renderSignedIn(<SavedWorkoutScreen />);
    await fireEvent.press(await screen.findByLabelText('Analysis'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/analysis/[id]', params: { id } });
  });
});
