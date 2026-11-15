/**
 * Screen smoke tests — the placeholder tab screens render their heading and primary content.
 * (Workout: workout-tab.test.tsx; Home: home-feed.test.tsx; Library, which reads the phone's
 * database since B31: library-tab.test.tsx; You: you-profile.test.tsx.) These live outside
 * src/app because expo-router would otherwise register *.test.tsx files as routes.
 */
import { describe, expect, it } from '@jest/globals';
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TEST_SAFE_AREA_METRICS } from '@/test-utils/renderWithAuth';

import MarketplaceScreen from '@/app/(tabs)/marketplace';
import CommunitiesScreen from '@/app/(tabs)/communities';

function renderScreen(element: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>{element}</SafeAreaProvider>);
}

describe('tab screens', () => {
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
});
