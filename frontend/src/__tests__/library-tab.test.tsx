/**
 * Tests for the Library tab: its filters (region, muscle, equipment, search — B29) and card →
 * detail navigation over the bundled catalog, and (B31, LIB-5) the "Your exercises" section — the
 * signed-in lifter's own custom exercises read from the phone's database, obeying the same search
 * and chips (a region chip hides them), opening their own card by database id, a New exercise form
 * that saves one offline, and never showing another account's or a deleted exercise.
 * Real SQLite through a mocked `openAppDatabase`; the router is a stub; no network.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { ALL_EXERCISES, filterExercises } from '@/library/catalog';
import { createCustomExercise, deleteCustomExercise, listCustomExercises } from '@/library/customExercises';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';
import { pendingRows } from '@/sync/outbox';

import LibraryScreen from '@/app/(tabs)/library';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

// The Library opens a card's detail screen through the router; a stub records where it went.
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

/** Renders the tab signed in and lets its database open and its custom-exercise read land. */
async function renderLibrary() {
  const view = await renderSignedIn(<LibraryScreen />);
  await waitFor(() => expect(mockOpenDatabase).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

/** Makes a custom exercise for the signed-in lifter (or `owner`). */
function makeCustom(name: string, extra: { equipment?: 'Barbell' | 'Dumbbell'; muscle?: 'chest' | 'biceps' } = {}, owner = SIGNED_IN_USER_ID) {
  return createCustomExercise(db, owner, {
    name,
    equipment: extra.equipment ?? null,
    primaryMuscle: extra.muscle ?? null,
  });
}

describe('Library tab — catalog', () => {
  it('renders search and the four category filters', async () => {
    await renderLibrary();
    expect(screen.getByLabelText('Search exercises')).toBeTruthy();
    for (const label of ['Upper', 'Lower', 'Core', 'Cardio']) {
      expect(screen.getByLabelText(`Filter: ${label}`)).toBeTruthy();
    }
  });

  it('renders imported exercise cards from the launch catalog', async () => {
    await renderLibrary();
    // FlatList virtualizes; the first entries of the catalog are on screen.
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText(`${ALL_EXERCISES.length} exercises`)).toBeTruthy();
  });

  it('search narrows the cards and shows the match count', async () => {
    await renderLibrary();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'bench press');
    expect(screen.getByText('Bench Press')).toBeTruthy();
    // The count label proves the filter ran — a virtualization false-pass
    // (unrendered off-screen rows) can't satisfy this.
    const matches = ALL_EXERCISES.filter((e) => e.name.toLowerCase().includes('bench press'));
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText(`${matches.length} exercises`)).toBeTruthy();
  });

  it('region chips filter the catalog (Cardio shows machines only)', async () => {
    await renderLibrary();
    await fireEvent.press(screen.getByLabelText('Filter: Cardio'));
    const cardio = ALL_EXERCISES.filter((e) => e.body === 'cardio');
    expect(cardio.length).toBeGreaterThan(0);
    expect(screen.getByText(`${cardio.length} exercises`)).toBeTruthy();
    expect(screen.getByText('Treadmill')).toBeTruthy();
    expect(screen.queryByText('Bench Press')).toBeNull();
  });

  it('shows a no-results state when a search misses', async () => {
    await renderLibrary();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zzzz');
    expect(screen.getByText(/No exercises match/)).toBeTruthy();
    expect(screen.getByText(/clear the filters/)).toBeTruthy();
  });

  it('offers a chip for every muscle and every kind of equipment', async () => {
    await renderLibrary();
    for (const label of ['Traps', 'Chest', 'Lats', 'Forearms', 'Abs', 'Quads', 'Calves']) {
      expect(screen.getByLabelText(`Filter: ${label}`)).toBeTruthy();
    }
    for (const label of ['Barbell', 'Dumbbell', 'Bodyweight', 'Cable', 'Machine', 'Cardio Machine']) {
      expect(screen.getByLabelText(`Filter: ${label}`)).toBeTruthy();
    }
  });

  it('muscle chip narrows to exercises that train it, hardest first', async () => {
    await renderLibrary();
    await fireEvent.press(screen.getByLabelText('Filter: Triceps'));
    const triceps = filterExercises(ALL_EXERCISES, { muscle: 'triceps' });
    expect(screen.getByText(`${triceps.length} exercises`)).toBeTruthy();
    expect(screen.getByLabelText('Filter: Triceps').props.accessibilityState).toMatchObject({ selected: true });
    // The first card is a dedicated triceps movement, not the bench press (which only assists).
    expect(triceps[0].patterns[0]).toBe('Tricep Accessory');
    const firstCard = screen.getAllByTestId('exercise-card')[0];
    expect(within(firstCard).getByText(triceps[0].name)).toBeTruthy();
  });

  it('equipment chip narrows to that equipment', async () => {
    await renderLibrary();
    await fireEvent.press(screen.getByLabelText('Filter: Cable'));
    const cable = ALL_EXERCISES.filter((e) => e.equipment === 'Cable');
    expect(cable.length).toBeGreaterThan(0);
    expect(screen.getByText(`${cable.length} exercises`)).toBeTruthy();
    expect(screen.queryByText('Bench Press')).toBeNull();
  });

  it('chips combine with each other and with search, and re-tapping clears', async () => {
    await renderLibrary();
    await fireEvent.press(screen.getByLabelText('Filter: Chest'));
    await fireEvent.press(screen.getByLabelText('Filter: Dumbbell'));
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'fly');
    const expected = filterExercises(ALL_EXERCISES, { muscle: 'chest', equipment: 'Dumbbell' }).filter((e) =>
      e.name.toLowerCase().includes('fly'),
    );
    expect(expected.length).toBeGreaterThan(0);
    const count = expected.length === 1 ? '1 exercise' : `${expected.length} exercises`;
    expect(screen.getByText(count)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Search exercises'), '');
    await fireEvent.press(screen.getByLabelText('Filter: Dumbbell'));
    await fireEvent.press(screen.getByLabelText('Filter: Chest'));
    expect(screen.getByLabelText('Filter: Chest').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByText(`${ALL_EXERCISES.length} exercises`)).toBeTruthy();
  });

  it('card tap opens that exercise’s detail screen', async () => {
    await renderLibrary();
    await fireEvent.press(screen.getByText('Bench Press'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/exercise/[id]', params: { id: 'bench_press' } });
  });
});

describe('Library tab — Your exercises (B31)', () => {
  it('with no customs, offers New exercise and a one-line hint', async () => {
    await renderLibrary();
    expect(screen.getByText('Your exercises')).toBeTruthy();
    expect(screen.getByLabelText('New exercise')).toBeTruthy();
    expect(screen.getByText(/It’s private to you/)).toBeTruthy();
    expect(screen.queryAllByTestId('custom-exercise-card')).toHaveLength(0);
  });

  it('lists the lifter’s live customs, never another account’s or a deleted one, and opens one by id', async () => {
    const mine = await makeCustom('Zercher Carry', { equipment: 'Barbell', muscle: 'biceps' });
    await makeCustom('Their Secret Lift', {}, 'someone-else');
    const gone = await makeCustom('Retired Lift');
    await deleteCustomExercise(db, SIGNED_IN_USER_ID, gone.id);

    await renderLibrary();
    const cards = await screen.findAllByTestId('custom-exercise-card');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText('Zercher Carry')).toBeTruthy();
    expect(within(cards[0]).getByText('Custom')).toBeTruthy();
    expect(within(cards[0]).getByText('Biceps')).toBeTruthy();
    expect(screen.queryByText('Their Secret Lift')).toBeNull();
    expect(screen.queryByText('Retired Lift')).toBeNull();

    await fireEvent.press(cards[0]);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/exercise/[id]', params: { id: mine.id } });
  });

  it('customs obey the search and the muscle / equipment chips; a region chip hides them', async () => {
    await makeCustom('Zercher Carry', { equipment: 'Barbell', muscle: 'biceps' });
    await makeCustom('Zottman Curl', { equipment: 'Dumbbell', muscle: 'biceps' });
    await renderLibrary();
    await screen.findByText('Zottman Curl');

    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zott');
    expect(screen.queryByText('Zercher Carry')).toBeNull();
    expect(screen.getByText('Zottman Curl')).toBeTruthy();
    // Only a custom matched: the empty catalog says so without claiming nothing matched at all.
    expect(screen.getByText('No library exercises match that search.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), '');

    await fireEvent.press(screen.getByLabelText('Filter: Barbell'));
    expect(screen.getByText('Zercher Carry')).toBeTruthy();
    expect(screen.queryByText('Zottman Curl')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Filter: Barbell'));

    await fireEvent.press(screen.getByLabelText('Filter: Chest'));
    expect(screen.queryAllByTestId('custom-exercise-card')).toHaveLength(0);
    await fireEvent.press(screen.getByLabelText('Filter: Biceps'));
    expect(screen.getAllByTestId('custom-exercise-card')).toHaveLength(2);

    await fireEvent.press(screen.getByLabelText('Filter: Upper'));
    expect(screen.queryAllByTestId('custom-exercise-card')).toHaveLength(0);
  });

  it('New exercise saves one to the phone (queued for upload) and it appears in the section', async () => {
    await renderLibrary();
    await fireEvent.press(screen.getByLabelText('New exercise'));
    await fireEvent.changeText(screen.getByLabelText('Name'), '  Belt Squat  ');
    await fireEvent.press(screen.getByLabelText('Equipment: Machine'));
    await fireEvent.press(screen.getByLabelText('Save exercise'));

    const card = await screen.findByTestId('custom-exercise-card');
    expect(within(card).getByText('Belt Squat')).toBeTruthy();
    expect(within(card).getByText('Machine')).toBeTruthy();
    const saved = await listCustomExercises(db, SIGNED_IN_USER_ID);
    expect(saved.map((r) => [r.name, r.equipment, r.owner_id])).toEqual([['Belt Squat', 'Machine', SIGNED_IN_USER_ID]]);
    expect((await pendingRows(db, 'exercises')).map((p) => p.rowId)).toEqual([saved[0].id]);
  });

  it('Cancel on the form saves nothing', async () => {
    await renderLibrary();
    await fireEvent.press(screen.getByLabelText('New exercise'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Never Saved');
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(await listCustomExercises(db, SIGNED_IN_USER_ID)).toEqual([]);
    expect(screen.queryByLabelText('Save exercise')).toBeNull();
  });
});
