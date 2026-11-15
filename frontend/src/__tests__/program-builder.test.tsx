/**
 * Tests for the program builder's three screens (PRG-1, PRG-2, B34): the Programs list (empty
 * state, New program → the new program's page, sizes), the program page (week sections holding
 * workout rows — PRG-2's "renders it on the program page" — Add week / Add workout / removals that
 * ask first, rename, delete, not-found), and the workout editor (Add exercise through the real
 * picker for a library and a custom exercise, targets typed in the lifter's unit and saved in kg,
 * refused targets, move and remove — PRG-1). The step DoD's screen half: what was authored renders
 * again after the screens are unmounted and remounted. Real SQLite through a mocked
 * `openAppDatabase`; the router is a stub; no network.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { lbToKg, roundWeightKgForStorage } from '@training-math';

import type { SqlDriver } from '@/db/driver';
import { exerciseById } from '@/library/catalog';
import { createCustomExercise } from '@/library/customExercises';
import { libraryExerciseId } from '@/library/uuidv5';
import {
  addProgramExercise,
  addProgramWorkout,
  addWeek,
  createProgram,
  listPrograms,
  readProgramTree,
} from '@/programs/programs';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import ProgramWorkoutScreen from '@/app/program-workout/[id]';
import ProgramScreen from '@/app/program/[id]';
import ProgramsScreen from '@/app/programs';

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

const OTHER = 'a0000000-0000-4000-8000-0000000000ff';
const BENCH = exerciseById('bench_press');
let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

/** Answers the next native "are you sure?" alert by pressing the button labelled `choice`. */
function answerAlerts(choice: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.text === choice)?.onPress?.();
  });
}

/** A program with two weeks; week 1 holds "Day A" (bench 3 × 5 @ 225 lb) and an unnamed workout. */
async function seedProgram() {
  const program = await createProgram(db, SIGNED_IN_USER_ID, 'Strength Block');
  const w1 = await addWeek(db, SIGNED_IN_USER_ID, program.id);
  await addWeek(db, SIGNED_IN_USER_ID, program.id);
  const dayA = await addProgramWorkout(db, SIGNED_IN_USER_ID, w1.id, 'Day A');
  await addProgramWorkout(db, SIGNED_IN_USER_ID, w1.id);
  await addProgramExercise(db, SIGNED_IN_USER_ID, dayA.id, {
    exerciseId: libraryExerciseId('bench_press'),
    targets: { sets: 3, reps: 5, weight: { value: 225, unit: 'lb' }, rpe: null },
  });
  return { program, w1, dayA };
}

describe('Programs list', () => {
  it('explains programs when there are none', async () => {
    await renderSignedIn(<ProgramsScreen />);
    expect(await screen.findByText(/No programs yet/)).toBeTruthy();
  });

  it('lists only the lifter’s live programs with their size, and opens one', async () => {
    const { program } = await seedProgram();
    await createProgram(db, OTHER, 'Someone else’s');
    await renderSignedIn(<ProgramsScreen />);
    expect(await screen.findByText('Strength Block')).toBeTruthy();
    expect(screen.getByText('2 weeks · 2 workouts')).toBeTruthy();
    expect(screen.queryByText('Someone else’s')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Open Strength Block'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/program/[id]', params: { id: program.id } });
  });

  it('New program needs a name, creates it on the phone and opens its page', async () => {
    await renderSignedIn(<ProgramsScreen />);
    await screen.findByText(/No programs yet/);
    await fireEvent.press(screen.getByLabelText('New program'));
    const create = screen.getByLabelText('Create program');
    expect(create.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByLabelText('Program name'), 'x'.repeat(101));
    expect(screen.getByText('Names can be at most 100 characters.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Program name'), '  Hypertrophy ');
    await fireEvent.press(screen.getByLabelText('Create program'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalled());
    const [made] = await listPrograms(db, SIGNED_IN_USER_ID);
    expect(made.program.name).toBe('Hypertrophy');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/program/[id]', params: { id: made.program.id } });
  });
});

describe('Program page (PRG-2)', () => {
  it('renders weeks as sections holding their workouts, and opens a workout', async () => {
    const { program, dayA } = await seedProgram();
    mockParams = { id: program.id };
    await renderSignedIn(<ProgramScreen />);
    expect(await screen.findByText('Week 1')).toBeTruthy();
    expect(screen.getByText('Week 2')).toBeTruthy();
    expect(screen.getByText('Day A')).toBeTruthy();
    expect(screen.getByText('1 exercise')).toBeTruthy();
    expect(screen.getByText('Workout 2')).toBeTruthy();
    expect(screen.getByText('No workouts in this week yet.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open Week 1 Day A'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/program-workout/[id]', params: { id: dayA.id } });
  });

  it('adds a week and a workout inside a week', async () => {
    const program = await createProgram(db, SIGNED_IN_USER_ID, 'Fresh');
    mockParams = { id: program.id };
    await renderSignedIn(<ProgramScreen />);
    expect(await screen.findByText(/Start with a week/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add week'));
    expect(await screen.findByText('Week 1')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add workout to Week 1'));
    expect(await screen.findByText('Workout 1')).toBeTruthy();
    const tree = await readProgramTree(db, SIGNED_IN_USER_ID, program.id);
    expect(tree?.weeks.map((w) => w.workouts.length)).toEqual([1]);
  });

  it('removing a week or a workout asks first', async () => {
    const { program } = await seedProgram();
    mockParams = { id: program.id };
    await renderSignedIn(<ProgramScreen />);
    await screen.findByText('Week 1');

    const keep = answerAlerts('Keep it');
    await fireEvent.press(screen.getByLabelText('Remove Week 1'));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Day A')).toBeTruthy();
    keep.mockRestore();

    const confirmWorkout = answerAlerts('Remove workout');
    await fireEvent.press(screen.getByLabelText('Remove Week 1 Day A'));
    await waitFor(() => expect(screen.queryByText('Day A')).toBeNull());
    confirmWorkout.mockRestore();

    const confirmWeek = answerAlerts('Remove week');
    await fireEvent.press(screen.getByLabelText('Remove Week 1'));
    await waitFor(() => expect(screen.queryByText('Week 2')).toBeNull());
    expect(screen.getByText('Week 1')).toBeTruthy(); // the old Week 2, renumbered
    confirmWeek.mockRestore();
    expect((await readProgramTree(db, SIGNED_IN_USER_ID, program.id))?.weeks).toHaveLength(1);
  });

  it('renames the program as the lifter types', async () => {
    const { program } = await seedProgram();
    mockParams = { id: program.id };
    await renderSignedIn(<ProgramScreen />);
    await screen.findByText('Week 1');
    const box = screen.getByLabelText('Program name');
    await fireEvent.changeText(box, 'Peaking Block');
    await act(async () => {
      fireEvent(box, 'blur');
    });
    await waitFor(async () =>
      expect((await readProgramTree(db, SIGNED_IN_USER_ID, program.id))?.program.name).toBe('Peaking Block'),
    );
  });

  it('Delete program asks, deletes and goes back', async () => {
    const { program } = await seedProgram();
    mockParams = { id: program.id };
    await renderSignedIn(<ProgramScreen />);
    await screen.findByText('Week 1');
    const confirm = answerAlerts('Delete program');
    await fireEvent.press(screen.getByLabelText('Delete program'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await listPrograms(db, SIGNED_IN_USER_ID)).toEqual([]);
    confirm.mockRestore();
  });

  it('someone else’s or an unknown program is not found', async () => {
    const theirs = await createProgram(db, OTHER, 'Theirs');
    mockParams = { id: theirs.id };
    await renderSignedIn(<ProgramScreen />);
    expect(await screen.findByText('That program isn’t one of yours, or it was deleted.')).toBeTruthy();
    expect(screen.queryByText('Theirs')).toBeNull();
  });
});

describe('Program workout editor (PRG-1)', () => {
  it('shows each exercise with its targets in the lifter’s unit', async () => {
    const { dayA } = await seedProgram();
    mockParams = { id: dayA.id };
    await renderSignedIn(<ProgramWorkoutScreen />);
    expect(await screen.findByText('Strength Block · Week 1')).toBeTruthy();
    expect(screen.getByText(BENCH?.name ?? '')).toBeTruthy();
    expect(screen.getByText('3 × 5 @ 225 lb')).toBeTruthy();
  });

  it('adds a library and a custom exercise through the picker and sets their targets', async () => {
    const curl = await createCustomExercise(db, SIGNED_IN_USER_ID, { name: 'Spider Curl', equipment: null, primaryMuscle: null });
    const program = await createProgram(db, SIGNED_IN_USER_ID, 'P');
    const week = await addWeek(db, SIGNED_IN_USER_ID, program.id);
    const workout = await addProgramWorkout(db, SIGNED_IN_USER_ID, week.id, 'Pull');
    mockParams = { id: workout.id };
    await renderSignedIn(<ProgramWorkoutScreen />);
    await screen.findByText(/Add the exercises for this workout/);

    await fireEvent.press(screen.getByLabelText('Add exercise'));
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'bench press');
    await fireEvent.press(screen.getByLabelText(`Add ${BENCH?.name}`));
    expect(await screen.findByText('3 sets')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Add exercise'));
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'spider');
    await fireEvent.press(screen.getByLabelText('Add Spider Curl'));
    expect(await screen.findByText('Spider Curl')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText(`Sets for ${BENCH?.name}`), '5');
    await fireEvent.changeText(screen.getByLabelText(`Reps for ${BENCH?.name}`), '5');
    await fireEvent.changeText(screen.getByLabelText(`Weight in lb for ${BENCH?.name}`), '185');
    await fireEvent.changeText(screen.getByLabelText(`RPE for ${BENCH?.name}`), '8');
    await fireEvent.press(screen.getByLabelText(`Save targets for ${BENCH?.name}`));
    expect(await screen.findByText('5 × 5 @ 185 lb · RPE 8')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Reps for Spider Curl'), '12');
    await fireEvent.press(screen.getByLabelText('Save targets for Spider Curl'));
    expect(await screen.findByText('3 × 12')).toBeTruthy();

    const slots = (await readProgramTree(db, SIGNED_IN_USER_ID, program.id))?.weeks[0].workouts[0].exercises;
    expect(slots?.map((s) => [s.slot.exercise_id, s.slot.target_sets, s.slot.target_reps, s.slot.target_weight_kg])).toEqual([
      [libraryExerciseId('bench_press'), 5, 5, roundWeightKgForStorage(lbToKg(185))],
      [curl.id, 3, 12, null],
    ]);
  });

  it('refuses targets the server would refuse, with a message', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { dayA } = await seedProgram();
    mockParams = { id: dayA.id };
    await renderSignedIn(<ProgramWorkoutScreen />);
    const name = BENCH?.name ?? '';
    await screen.findByText(name);
    await fireEvent.changeText(screen.getByLabelText(`RPE for ${name}`), '11');
    await fireEvent.press(screen.getByLabelText(`Save targets for ${name}`));
    expect(await screen.findByText('RPE goes from 1 to 10.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(`RPE for ${name}`), '');
    await fireEvent.changeText(screen.getByLabelText(`Sets for ${name}`), '');
    await fireEvent.press(screen.getByLabelText(`Save targets for ${name}`));
    expect(await screen.findByText('Every exercise needs a number of sets.')).toBeTruthy();
    expect(screen.getByText('3 × 5 @ 225 lb')).toBeTruthy();
  });

  it('moves and removes exercises', async () => {
    const { program, dayA } = await seedProgram();
    await addProgramExercise(db, SIGNED_IN_USER_ID, dayA.id, {
      exerciseId: libraryExerciseId('squat'),
      targets: { sets: 5, reps: 5, weight: null, rpe: null },
    });
    const squat = exerciseById('squat')?.name ?? '';
    const bench = BENCH?.name ?? '';
    mockParams = { id: dayA.id };
    await renderSignedIn(<ProgramWorkoutScreen />);
    await screen.findByText(squat);
    await fireEvent.press(screen.getByLabelText(`Move ${squat} up`));
    await waitFor(async () => {
      const order = (await readProgramTree(db, SIGNED_IN_USER_ID, program.id))?.weeks[0].workouts[0].exercises.map(
        (e) => e.exerciseName,
      );
      expect(order).toEqual([squat, bench]);
    });

    const confirm = answerAlerts('Remove exercise');
    await fireEvent.press(screen.getByLabelText(`Remove ${bench}`));
    await waitFor(() => expect(screen.queryByText(bench)).toBeNull());
    confirm.mockRestore();
  });

  it('a workout inside a removed week is not found', async () => {
    const program = await createProgram(db, SIGNED_IN_USER_ID, 'P');
    const week = await addWeek(db, SIGNED_IN_USER_ID, program.id);
    const workout = await addProgramWorkout(db, SIGNED_IN_USER_ID, week.id);
    await db.runAsync('update program_weeks set deleted_at = ? where id = ?', ['2026-11-15T00:00:00.000Z', week.id]);
    mockParams = { id: workout.id };
    await renderSignedIn(<ProgramWorkoutScreen />);
    expect(await screen.findByText('That workout isn’t in one of your programs any more.')).toBeTruthy();
  });
});

describe('step DoD: what was authored renders again after reopening', () => {
  it('the program page and the workout editor show the same program after a remount', async () => {
    const { program, dayA } = await seedProgram();
    mockParams = { id: program.id };
    const page = await renderSignedIn(<ProgramScreen />);
    await screen.findByText('Day A');
    await page.unmount();

    mockParams = { id: program.id };
    const again = await renderSignedIn(<ProgramScreen />);
    expect(await screen.findByText('Day A')).toBeTruthy();
    expect(screen.getByText('Week 2')).toBeTruthy();
    expect(screen.getByText('Workout 2')).toBeTruthy();
    await again.unmount();

    mockParams = { id: dayA.id };
    await renderSignedIn(<ProgramWorkoutScreen />);
    expect(await screen.findByText('3 × 5 @ 225 lb')).toBeTruthy();
  });
});
