/**
 * TEST USE ONLY — shared pieces for the logger tests (B09): a ready database, a predictable
 * clock and ids for the active-workout store, and a way to render a screen signed in.
 * Nothing in the app imports this.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/auth/AuthProvider';
import { prepareDatabase } from '@/db/database';
import type { SqlDriver } from '@/db/driver';
import type { ActiveWorkoutOptions } from '@/workout/activeWorkout';

import { createFakeAppState, createFakeAuthClient, fakeSession } from './fakeAuthClient';
import { createNodeSqliteDriver } from './nodeSqliteDriver';
import { TEST_SAFE_AREA_METRICS } from './renderWithAuth';

/** The user id `fakeSession()` signs in as. */
export const SIGNED_IN_USER_ID = fakeSession().user.id;

/** A new in-memory database with the schema and the exercise library, like a fresh install. */
export function createPreparedDb(): Promise<SqlDriver> {
  return prepareDatabase(createNodeSqliteDriver());
}

/** Store options whose clock starts at `start` and moves on one minute per reading. */
export function steadyOptions(start = '2026-11-14T09:00:00.000Z'): ActiveWorkoutOptions {
  let ms = Date.parse(start);
  return {
    clock: () => {
      const now = new Date(ms).toISOString();
      ms += 60_000;
      return now;
    },
  };
}

/** Renders `element` inside safe-area metrics and an AuthProvider already holding a session. */
export async function renderSignedIn(element: React.ReactElement) {
  const client = createFakeAuthClient({ storedSession: fakeSession() });
  return render(
    <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>
      <AuthProvider client={client} appState={createFakeAppState()}>
        {element}
      </AuthProvider>
    </SafeAreaProvider>,
  );
}
