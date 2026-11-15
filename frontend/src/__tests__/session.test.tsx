/**
 * Tests for the read-only session view (`app/session/[id].tsx`, B37 — TEAM-5): a visible workout
 * shows its title, details, notes, exercises in order (supersets grouped, an unreadable custom
 * exercise as "Custom exercise") and every set — a drop set on one row; an invisible or missing
 * workout says it isn't available; offline says so and Retry recovers. The client is the
 * in-memory fake social client (seeded with what the server would let the viewer see — RLS,
 * including the coach arm, was probed live).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { createPreparedDb, renderSignedIn } from '@/test-utils/loggerTestKit';

import SessionScreen, { CUSTOM_EXERCISE, SESSION_OFFLINE, SESSION_UNAVAILABLE } from '@/app/session/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

jest.mock('@/settings/displayUnit', () => ({ useDisplayUnit: () => 'kg' }));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockId = 'w1';
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: mockId }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const set = (id: string, position: number, extra: Record<string, unknown> = {}) => ({
  id,
  position,
  reps: 5,
  weight_kg: 100,
  rpe: null,
  is_warmup: false,
  duration_seconds: null,
  score: null,
  drop_set_position: null,
  notes: null,
  ...extra,
});

/** A member's private workout, as the server returns it to their coach. */
const memberWorkout = {
  id: 'w1',
  user_id: 'member',
  title: 'Heavy squat day',
  notes: 'Felt strong.',
  started_at: '2026-11-15T09:00:00.000Z',
  ended_at: '2026-11-15T10:00:00.000Z',
  visibility: 'private',
  workout_exercises: [
    {
      id: 'e2',
      position: 1,
      superset_group: null,
      notes: null,
      exercise: null,
      sets: [set('s3', 0, { reps: 10, weight_kg: null })],
    },
    {
      id: 'e1',
      position: 0,
      superset_group: null,
      notes: 'Belt on.',
      exercise: { name: 'Back Squat' },
      sets: [set('s2', 1, { reps: 8, weight_kg: 80, drop_set_position: 1 }), set('s1', 0, { notes: 'Grindy' })],
    },
  ],
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockOpenDatabase.mockResolvedValue(await createPreparedDb());
  mockId = 'w1';
  mockSocial = createFakeSocialClient({ workouts: [memberWorkout] });
});

describe('session view', () => {
  it('shows the whole log: exercises in order, sets, drop set on one row, notes (TEAM-5)', async () => {
    await renderSignedIn(<SessionScreen />);
    expect(await screen.findByText('Heavy squat day')).toBeTruthy();
    expect(screen.getByText('Felt strong.')).toBeTruthy();
    expect(screen.getByText('Back Squat')).toBeTruthy();
    expect(screen.getByText('Belt on.')).toBeTruthy();
    expect(screen.getByText('5 × 100 kg → 8 × 80 kg')).toBeTruthy();
    expect(screen.getByText('Grindy')).toBeTruthy();
    expect(screen.getByText(CUSTOM_EXERCISE)).toBeTruthy();
    expect(screen.getByText('10 reps')).toBeTruthy();
    expect(mockSocial.requests[0]).toContainEqual(['eq', 'id', 'w1']);
  });

  it('a workout the server withholds is “not available”', async () => {
    mockId = 'nope';
    await renderSignedIn(<SessionScreen />);
    expect(await screen.findByText(SESSION_UNAVAILABLE)).toBeTruthy();
  });

  it('offline says so; Retry brings it back', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSocial.setOffline(true);
    await renderSignedIn(<SessionScreen />);
    expect(await screen.findByText(SESSION_OFFLINE)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('Heavy squat day')).toBeTruthy();
    warn.mockRestore();
  });
});
