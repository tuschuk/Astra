/**
 * Tests for the exercise detail screen (B29 LIB-3, B30 LIB-4): a library exercise opens to its
 * name, equipment, muscles worked (most direct first), all five imported coaching steps with their
 * cue text, and its tips — over the real bundled catalog — then the signed-in lifter's own current
 * PRs and logged sessions of it. The B30 step DoD is asserted literally: over one seeded database,
 * the detail card and the per-exercise history screen show the same PR line and the same set text.
 * An unknown id shows the not-found state and Back still works. B31 (LIB-5): a custom exercise's
 * database id opens its own card (Custom pill, Edit / Delete, the same history section), it
 * collects history and PRs, Delete asks first then soft-deletes, and someone else's or a deleted
 * custom is not found. Real SQLite through a mocked `openAppDatabase`; the router is a stub; no
 * network.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { getRowsByIds } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { ALL_EXERCISES, exerciseById } from '@/library/catalog';
import { createCustomExercise, deleteCustomExercise, getCustomExercise } from '@/library/customExercises';
import { MUSCLE_NAMES, rankMuscles } from '@/library/muscles';
import { libraryExerciseId } from '@/library/uuidv5';
import { DEFAULT_DISPLAY_UNIT } from '@/settings/displayUnit';
import { createPreparedDb, lb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { startActiveWorkout, type SetInput } from '@/workout/activeWorkout';
import { formatPrLine } from '@/workout/format';
import { currentPrs } from '@/workout/prs';

import ExerciseHistoryScreen from '@/app/exercise-history/[exerciseId]';
import ExerciseDetailScreen from '@/app/exercise/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
// Serves both routes' param shapes: `{ id }` for the detail card, `{ exerciseId }` for history.
let mockParams: { id?: string; exerciseId?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

/** Renders the detail card for `slug` signed in, and waits for its history read to settle. */
async function renderDetail(slug: string, settledText = 'No PRs yet') {
  mockParams = { id: slug };
  const view = await renderSignedIn(<ExerciseDetailScreen />);
  await screen.findByText(settledText);
  return view;
}

/** Logs and finishes one workout of `slug` through the real store (so PRs are B13's own rows). */
async function logLibraryExercise(slug: string, start: string, sets: SetInput[]) {
  const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions(start));
  const entry = await store.addExercise(libraryExerciseId(slug));
  for (const input of sets) await store.logSet(entry.id, input);
  await store.finish();
}

describe('exercise detail screen', () => {
  it('shows Bench Press with its equipment, ranked muscles, five steps and tips', async () => {
    await renderDetail('bench_press');
    const bench = exerciseById('bench_press');
    if (!bench) throw new Error('catalog lost Bench Press');

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('Barbell')).toBeTruthy();
    expect(screen.getByText('Muscles worked')).toBeTruthy();
    expect(screen.getByText('Chest, Shoulders, Triceps')).toBeTruthy();
    expect(screen.getByText('How to do it')).toBeTruthy();
    expect(bench.steps).toHaveLength(5);
    bench.steps.forEach((step, index) => {
      expect(screen.getByText(`${index + 1}. ${step.title}`)).toBeTruthy();
    });
    // The first cue's bold phrase is drawn as its own (bold) span, markers removed.
    expect(screen.getByText('Eyes under the bar')).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
    for (const tip of bench.tips) expect(screen.getByText(tip)).toBeTruthy();
    // (B49) Screen-reader users can jump between the card's sections, and each tip is read as
    // its words alone (the drawn bullet isn't spoken).
    for (const section of ['Muscles worked', 'How to do it', 'Tips', 'Your history', 'Current PRs']) {
      expect(screen.getByRole('header', { name: section })).toBeTruthy();
    }
    for (const tip of bench.tips) expect(screen.getByLabelText(tip)).toBeTruthy();
  });

  it('every launch exercise opens with its muscles and all its steps (B29 step DoD)', async () => {
    for (const exercise of ALL_EXERCISES) {
      const view = await renderDetail(exercise.id);
      expect(screen.getByText(exercise.name)).toBeTruthy();
      expect(screen.getByText(rankMuscles(exercise.muscles).map((m) => MUSCLE_NAMES[m]).join(', '))).toBeTruthy();
      expect(exercise.steps.length).toBeGreaterThan(0);
      exercise.steps.forEach((step, index) => {
        expect(screen.getByText(`${index + 1}. ${step.title}`)).toBeTruthy();
      });
      await view.unmount();
    }
  });

  it('a never-logged exercise shows its history section empty', async () => {
    await renderDetail('bench_press');
    expect(screen.getByText('Your history')).toBeTruthy();
    expect(screen.getByText('Current PRs')).toBeTruthy();
    expect(screen.getByText('No finished sessions of this exercise yet.')).toBeTruthy();
  });

  it('shows the same PRs and sets as the history screen over the same records (B30 step DoD)', async () => {
    await logLibraryExercise('bench_press', '2026-11-08T12:00:00.000Z', [lb(10, 95, { isWarmup: true }), lb(5, 205)]);
    await logLibraryExercise('bench_press', '2026-11-12T12:00:00.000Z', [
      lb(1, 245),
      lb(8, 225),
      lb(8, 185, { dropSetPosition: 1 }),
    ]);
    // Another movement's records never leak onto the bench card.
    await logLibraryExercise('squat', '2026-11-13T12:00:00.000Z', [lb(5, 315)]);

    const prLine = formatPrLine(await currentPrs(db, SIGNED_IN_USER_ID, libraryExerciseId('bench_press')), DEFAULT_DISPLAY_UNIT);
    expect(prLine).toBe('1RM 245 lb · e1RM 285 lb · 5RM 205 lb · 8RM 225 lb');
    const setTexts = ['1 × 245 lb', '8 × 225 lb → 8 × 185 lb', 'W · 10 × 95 lb', '5 × 205 lb'];

    const detail = await renderDetail('bench_press', prLine);
    for (const text of setTexts) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText('5 × 315 lb')).toBeNull();
    await detail.unmount();

    mockParams = { exerciseId: libraryExerciseId('bench_press') };
    await renderSignedIn(<ExerciseHistoryScreen />);
    expect(await screen.findByText(prLine)).toBeTruthy();
    for (const text of setTexts) expect(screen.getByText(text)).toBeTruthy();
  });

  it('an unknown id shows the not-found state, and Back leaves', async () => {
    mockParams = { id: 'not_an_exercise' };
    await renderSignedIn(<ExerciseDetailScreen />);
    expect(await screen.findByText('That exercise isn’t in the library.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('another lifter’s custom id shows the not-found state (the phone only finds your own)', async () => {
    const theirs = await createCustomExercise(db, 'someone-else', { name: 'Their Lift', equipment: null, primaryMuscle: null });
    mockParams = { id: theirs.id };
    await renderSignedIn(<ExerciseDetailScreen />);
    expect(await screen.findByText('That exercise isn’t in the library.')).toBeTruthy();
    expect(screen.queryByText('Their Lift')).toBeNull();
  });

  it('Back falls through to the Library tab when there is nothing to go back to', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await renderDetail('bench_press');
    await fireEvent.press(screen.getByText('Back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/library');
  });
});

describe('custom exercise card (B31, LIB-5)', () => {
  /** Makes a custom for the signed-in lifter, opens its card, and waits for its history read. */
  async function openCustom(name = 'Zercher Squat') {
    const made = await createCustomExercise(db, SIGNED_IN_USER_ID, { name, equipment: 'Barbell', primaryMuscle: 'quads' });
    mockParams = { id: made.id };
    const view = await renderSignedIn(<ExerciseDetailScreen />);
    await screen.findByText('Current PRs');
    return { made, view };
  }

  it('gets a card: name, Custom, equipment, muscle, Edit / Delete and an empty history — no coaching content', async () => {
    await openCustom();
    expect(screen.getByText('Zercher Squat')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByText('Barbell')).toBeTruthy();
    expect(screen.getByText('Quads')).toBeTruthy();
    expect(screen.getByLabelText('Edit')).toBeTruthy();
    expect(screen.getByLabelText('Delete')).toBeTruthy();
    expect(screen.getByText('Your history')).toBeTruthy();
    expect(screen.getByText('No PRs yet')).toBeTruthy();
    expect(screen.queryByText('How to do it')).toBeNull();
    expect(screen.queryByText('Tips')).toBeNull();
  });

  it('collects history and PRs like a library exercise (LIB-5 DoD)', async () => {
    const made = await createCustomExercise(db, SIGNED_IN_USER_ID, { name: 'Zercher Squat', equipment: 'Barbell', primaryMuscle: 'quads' });
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions('2026-11-12T12:00:00.000Z'));
    const entry = await store.addExercise(made.id);
    await store.logSet(entry.id, lb(5, 185));
    await store.finish();
    const prLine = formatPrLine(await currentPrs(db, SIGNED_IN_USER_ID, made.id), DEFAULT_DISPLAY_UNIT);
    expect(prLine).toContain('5RM 185 lb');

    mockParams = { id: made.id };
    await renderSignedIn(<ExerciseDetailScreen />);
    expect(await screen.findByText(prLine)).toBeTruthy();
    expect(screen.getByText('5 × 185 lb')).toBeTruthy();
  });

  it('Edit opens the form prefilled and the card shows the saved change', async () => {
    const { made } = await openCustom();
    await fireEvent.press(screen.getByLabelText('Edit'));
    expect(screen.getByLabelText('Name').props.value).toBe('Zercher Squat');
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Zercher Box Squat');
    await fireEvent.press(screen.getByLabelText('Save changes'));
    expect(await screen.findByText('Zercher Box Squat')).toBeTruthy();
    expect((await getCustomExercise(db, SIGNED_IN_USER_ID, made.id))?.name).toBe('Zercher Box Squat');
  });

  it('Delete asks first; Keep it does nothing, Delete exercise soft-deletes and goes back', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { made } = await openCustom();
    await fireEvent.press(screen.getByLabelText('Delete'));
    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    expect(buttons.map((b) => b.text)).toEqual(['Keep it', 'Delete exercise']);
    expect(await getCustomExercise(db, SIGNED_IN_USER_ID, made.id)).not.toBeNull();

    await act(async () => {
      buttons[1].onPress?.();
    });
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await getCustomExercise(db, SIGNED_IN_USER_ID, made.id)).toBeNull();
    // Soft delete: the row (and its name, for history) is still on the phone.
    expect((await getRowsByIds(db, 'exercises', [made.id]))[0].deleted_at).not.toBeNull();
    alert.mockRestore();
  });

  it('a database that can’t be opened says so, never “not in the library”', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockOpenDatabase.mockRejectedValue(new Error('disk full'));
    mockParams = { id: 'c0000000-0000-4000-8000-000000000001' };
    await renderSignedIn(<ExerciseDetailScreen />);
    expect(await screen.findByText('This exercise couldn’t be read from this phone.')).toBeTruthy();
    expect(screen.queryByText('That exercise isn’t in the library.')).toBeNull();
  });

  it('a deleted custom’s card is not found', async () => {
    const made = await createCustomExercise(db, SIGNED_IN_USER_ID, { name: 'Gone', equipment: null, primaryMuscle: null });
    await deleteCustomExercise(db, SIGNED_IN_USER_ID, made.id);
    mockParams = { id: made.id };
    await renderSignedIn(<ExerciseDetailScreen />);
    expect(await screen.findByText('That exercise isn’t in the library.')).toBeTruthy();
  });
});
