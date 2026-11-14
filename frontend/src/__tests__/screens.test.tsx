/**
 * Screen smoke tests — each of the six tab screens renders its heading and
 * primary content. These live outside src/app because expo-router would
 * otherwise register *.test.tsx files as routes.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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

const METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function renderScreen(element: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>);
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

  it('You renders the profile skeleton with both follow counts', async () => {
    const screen = await renderScreen(<YouScreen />);
    expect(screen.getByText('Your profile')).toBeTruthy();
    expect(screen.getByText('Followers')).toBeTruthy();
    expect(screen.getByText('Following')).toBeTruthy();
  });
});
