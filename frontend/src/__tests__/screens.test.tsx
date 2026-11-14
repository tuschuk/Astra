/**
 * Screen smoke tests — each of the six tab screens renders its heading and
 * primary content. These live outside src/app because expo-router would
 * otherwise register *.test.tsx files as routes.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/auth/AuthProvider';
import { createFakeAppState, createFakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';
import { ALL_EXERCISES } from '@/library/catalog';

import HomeScreen from '@/app/(tabs)/index';
import MarketplaceScreen from '@/app/(tabs)/marketplace';
import WorkoutScreen from '@/app/(tabs)/workout';
import CommunitiesScreen from '@/app/(tabs)/communities';
import LibraryScreen from '@/app/(tabs)/library';
import YouScreen from '@/app/(tabs)/you';

// The Home screen navigates via expo-router; stub the router.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

function renderScreen(element: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>{element}</SafeAreaProvider>);
}

describe('tab screens', () => {
  it('Home renders the brand and the feed empty state', async () => {
    const screen = await renderScreen(<HomeScreen />);
    expect(screen.getByText('Astra')).toBeTruthy();
    expect(screen.getByText('Log a workout')).toBeTruthy();
  });

  it('Workout renders the start actions and all five Tool Kit utilities', async () => {
    const screen = await renderScreen(<WorkoutScreen />);
    expect(screen.getByText('Start empty workout')).toBeTruthy();
    expect(screen.getByText('Start from a program')).toBeTruthy();
    for (const tool of ['1RM', 'RPE', '%1RM', 'Plates', 'Timer']) {
      expect(screen.getByText(tool)).toBeTruthy();
    }
  });

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
  });

  it('You renders the profile skeleton with both follow counts and the signed-in email', async () => {
    const client = createFakeAuthClient({ storedSession: fakeSession('me@example.com') });
    const screen = await renderScreen(
      <AuthProvider client={client} appState={createFakeAppState()}>
        <YouScreen />
      </AuthProvider>,
    );
    expect(screen.getByText('Your profile')).toBeTruthy();
    expect(screen.getByText('Followers')).toBeTruthy();
    expect(screen.getByText('Following')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('me@example.com')).toBeTruthy());
  });

  it('You has a Sign out button that signs out of this device', async () => {
    const client = createFakeAuthClient({ storedSession: fakeSession() });
    const screen = await renderScreen(
      <AuthProvider client={client} appState={createFakeAppState()}>
        <YouScreen />
      </AuthProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Sign out'));
    expect(client.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
