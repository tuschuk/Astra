/**
 * TEST USE ONLY — renders an auth form inside the providers it needs
 * (safe-area metrics and an AuthProvider backed by a fake Supabase client),
 * so the form tests stay short. Nothing in the app imports this.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/auth/AuthProvider';
import { createFakeAppState, createFakeAuthClient, type FakeAuthClient } from './fakeAuthClient';

/** A phone-sized safe-area frame so <Screen> can lay out under Jest. */
export const TEST_SAFE_AREA_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

/** Renders `element` signed out, against `client` (a fresh fake by default). */
export async function renderWithAuth(element: React.ReactElement, client: FakeAuthClient = createFakeAuthClient()) {
  const screen = await render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <AuthProvider client={client} appState={createFakeAppState()} today={() => '2026-11-14'}>
        {element}
      </AuthProvider>
    </SafeAreaProvider>,
  );
  return { screen, client };
}
