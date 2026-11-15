/**
 * Screen smoke tests — the tab screens (Workout and Home aside: workout-tab.test.tsx, home-feed.test.tsx) render their heading and
 * primary content, and the Library's filters (region, muscle, equipment, search — B29) and its
 * card → detail navigation behave. These live outside src/app because expo-router would
 * otherwise register *.test.tsx files as routes.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';
import { ALL_EXERCISES, filterExercises } from '@/library/catalog';

import MarketplaceScreen from '@/app/(tabs)/marketplace';
import CommunitiesScreen from '@/app/(tabs)/communities';
import LibraryScreen from '@/app/(tabs)/library';

// The Library opens a card's detail screen through the router; a stub records where it went.
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  ...jest.requireActual<typeof import('expo-router')>('expo-router'),
  useRouter: () => mockRouter,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

function renderScreen(element: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>{element}</SafeAreaProvider>);
}

describe('tab screens', () => {
  // Home is the live feed since B20 (it reads the server); its tests live in home-feed.test.tsx.
  // The Workout tab reads the database and the session since B09; its tests live in
  // workout-tab.test.tsx.

  it('Marketplace renders the featured section', async () => {
    const screen = await renderScreen(<MarketplaceScreen />);
    expect(screen.getByText('Marketplace')).toBeTruthy();
    expect(screen.getByText('Featured this week')).toBeTruthy();
  });

  it('Communities renders both the Teams and Gyms sections', async () => {
    const screen = await renderScreen(<CommunitiesScreen />);
    expect(screen.getByText('Teams')).toBeTruthy();
    expect(screen.getByText('Gyms')).toBeTruthy();
  });

  it('Library renders search and the four category filters', async () => {
    const screen = await renderScreen(<LibraryScreen />);
    expect(screen.getByLabelText('Search exercises')).toBeTruthy();
    for (const label of ['Upper', 'Lower', 'Core', 'Cardio']) {
      expect(screen.getByLabelText(`Filter: ${label}`)).toBeTruthy();
    }
  });

  it('Library renders imported exercise cards from the launch catalog', async () => {
    const screen = await renderScreen(<LibraryScreen />);
    // FlatList virtualizes; the first entries of the catalog are on screen.
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText(`${ALL_EXERCISES.length} exercises`)).toBeTruthy();
  });

  it('Library search narrows the cards and shows the match count', async () => {
    const screen = await renderScreen(<LibraryScreen />);
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'bench press');
    expect(screen.getByText('Bench Press')).toBeTruthy();
    // The count label proves the filter ran — a virtualization false-pass
    // (unrendered off-screen rows) can't satisfy this.
    const matches = ALL_EXERCISES.filter((e) => e.name.toLowerCase().includes('bench press'));
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText(`${matches.length} exercises`)).toBeTruthy();
  });

  it('Library region chips filter the catalog (Cardio shows machines only)', async () => {
    const screen = await renderScreen(<LibraryScreen />);
    await fireEvent.press(screen.getByLabelText('Filter: Cardio'));
    const cardio = ALL_EXERCISES.filter((e) => e.body === 'cardio');
    expect(cardio.length).toBeGreaterThan(0);
    expect(screen.getByText(`${cardio.length} exercises`)).toBeTruthy();
    expect(screen.getByText('Treadmill')).toBeTruthy();
    expect(screen.queryByText('Bench Press')).toBeNull();
  });

  it('Library shows a no-results state when a search misses', async () => {
    const screen = await renderScreen(<LibraryScreen />);
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zzzz');
    expect(screen.getByText(/No exercises match/)).toBeTruthy();
    expect(screen.getByText(/clear the filters/)).toBeTruthy();
  });

  it('Library offers a chip for every muscle and every kind of equipment', async () => {
    const screen = await renderScreen(<LibraryScreen />);
    for (const label of ['Traps', 'Chest', 'Lats', 'Forearms', 'Abs', 'Quads', 'Calves']) {
      expect(screen.getByLabelText(`Filter: ${label}`)).toBeTruthy();
    }
    for (const label of ['Barbell', 'Dumbbell', 'Bodyweight', 'Cable', 'Machine', 'Cardio Machine']) {
      expect(screen.getByLabelText(`Filter: ${label}`)).toBeTruthy();
    }
  });

  it('Library muscle chip narrows to exercises that train it, hardest first', async () => {
    const screen = await renderScreen(<LibraryScreen />);
    await fireEvent.press(screen.getByLabelText('Filter: Triceps'));
    const triceps = filterExercises(ALL_EXERCISES, { muscle: 'triceps' });
    expect(screen.getByText(`${triceps.length} exercises`)).toBeTruthy();
    expect(screen.getByLabelText('Filter: Triceps').props.accessibilityState).toMatchObject({ selected: true });
    // The first card is a dedicated triceps movement, not the bench press (which only assists).
    expect(triceps[0].patterns[0]).toBe('Tricep Accessory');
    const firstCard = screen.getAllByTestId('exercise-card')[0];
    expect(within(firstCard).getByText(triceps[0].name)).toBeTruthy();
  });

  it('Library equipment chip narrows to that equipment', async () => {
    const screen = await renderScreen(<LibraryScreen />);
    await fireEvent.press(screen.getByLabelText('Filter: Cable'));
    const cable = ALL_EXERCISES.filter((e) => e.equipment === 'Cable');
    expect(cable.length).toBeGreaterThan(0);
    expect(screen.getByText(`${cable.length} exercises`)).toBeTruthy();
    expect(screen.queryByText('Bench Press')).toBeNull();
  });

  it('Library chips combine with each other and with search, and re-tapping clears', async () => {
    const screen = await renderScreen(<LibraryScreen />);
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

  it('Library card tap opens that exercise’s detail screen', async () => {
    const screen = await renderScreen(<LibraryScreen />);
    await fireEvent.press(screen.getByText('Bench Press'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/exercise/[id]', params: { id: 'bench_press' } });
  });

  // You is the real profile since B25 (it reads the server and the phone); its tests — including
  // the B15 gear button, no email and no Sign out of its own — live in you-profile.test.tsx.
});
