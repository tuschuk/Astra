/**
 * Tests for the shared profile body (B25) beyond what the two route tests walk: someone else's
 * profile offline shows no remembered identity (only your own is remembered) and the Retry line;
 * Retry brings the header and the open tab back once the connection returns; the PRs tab's empty
 * state for a lifter with none.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { saveOwnProfile, resetOwnProfileCache } from '@/social/ownProfileCache';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawPost } from '@/test-utils/feedFixtures';
import { createPreparedDb, renderSignedIn } from '@/test-utils/loggerTestKit';

import { PROFILE_OFFLINE, ProfileView } from './ProfileView';

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

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const pat = profile('pat', 'pat_pulls', 'Pat');

beforeEach(async () => {
  jest.clearAllMocks();
  resetOwnProfileCache();
  mockOpenDatabase.mockResolvedValue(await createPreparedDb());
  mockSocial = createFakeSocialClient({
    profiles: [pat],
    posts: [rawPost({ id: 'p', author: pat, createdAt: '2026-11-15T08:00:00.000Z', title: 'Pat session' })],
  });
});

describe('ProfileView', () => {
  it('offline, another lifter shows no remembered identity; Retry brings the profile back', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // A remembered copy exists for someone else — it must never stand in for Pat.
    saveOwnProfile('pat', { username: 'stale', displayName: 'Stale Pat', bio: null, avatarPath: null });
    mockSocial.setOffline(true);
    await renderSignedIn(<ProfileView profileId="pat" />);
    expect(await screen.findByText(PROFILE_OFFLINE)).toBeTruthy();
    expect(screen.queryByText('Stale Pat')).toBeNull();
    expect(screen.getByLabelText('Followers: unknown')).toBeTruthy();

    mockSocial.setOffline(false);
    // The header's Retry (first) reloads the header and the open tab; the tab's own Retry is below it.
    await fireEvent.press(screen.getAllByLabelText('Retry')[0]);
    expect(await screen.findByText('Pat session')).toBeTruthy();
    expect(screen.getByText('@pat_pulls')).toBeTruthy();
    expect(screen.queryByText(PROFILE_OFFLINE)).toBeNull();
    warn.mockRestore();
  });

  it('a lifter with no PRs says so', async () => {
    await renderSignedIn(<ProfileView profileId="pat" />);
    await fireEvent.press(await screen.findByLabelText('Show personal records'));
    expect(await screen.findByText('No PRs to show.')).toBeTruthy();
  });
});
