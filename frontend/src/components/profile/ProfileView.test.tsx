/**
 * Tests for the shared profile body (B25) beyond what the two route tests walk: someone else's
 * profile offline shows no remembered identity (only your own is remembered) and the Retry line;
 * Retry brings the header and the open tab back once the connection returns; the PRs tab's empty
 * state for a lifter with none. (B27) Mute / Block on someone else's profile: the actor's one row,
 * the confirm before a block, the explaining line, Follow hidden while blocking, undo, a refusal,
 * and none of it on your own profile. (What disappears is RLS — probed live, not here.)
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import type { SqlDriver } from '@/db/driver';
import { SAFETY_FAILED } from '@/social/moderation';
import { saveOwnProfile, resetOwnProfileCache } from '@/social/ownProfileCache';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawPost } from '@/test-utils/feedFixtures';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import { PROFILE_BLOCKED_LINE, PROFILE_MUTED_LINE, PROFILE_OFFLINE, ProfileView } from './ProfileView';

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

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: mockPush }),
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
  it('(B46) another lifter’s profile keeps exactly its three tabs — no Trends', async () => {
    await renderSignedIn(<ProfileView profileId="pat" />);
    expect(await screen.findByText('Pat session')).toBeTruthy();
    for (const tab of ['Show posts', 'Show workout history', 'Show personal records']) {
      expect(screen.getByLabelText(tab)).toBeTruthy();
    }
    expect(screen.queryByLabelText('Show trends')).toBeNull();
  });

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

  it('(B27) Mute: one row for me, the muted line shows, Follow stays; Unmute removes it', async () => {
    await renderSignedIn(<ProfileView profileId="pat" />);
    await fireEvent.press(await screen.findByLabelText('Mute'));
    expect(await screen.findByText(PROFILE_MUTED_LINE)).toBeTruthy();
    expect(mockSocial.tables.mutes).toEqual([{ muter_id: SIGNED_IN_USER_ID, muted_id: 'pat' }]);
    expect(screen.getByLabelText('Follow')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Unmute'));
    expect(await screen.findByLabelText('Mute')).toBeTruthy();
    expect(screen.queryByText(PROFILE_MUTED_LINE)).toBeNull();
    expect(mockSocial.tables.mutes).toEqual([]);
  });

  it('(B27) Block asks first; confirmed, it blocks, hides Follow and Mute, and says so; Unblock undoes it', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((b) => b.text === 'Block')?.onPress?.();
    });
    await renderSignedIn(<ProfileView profileId="pat" />);
    await fireEvent.press(await screen.findByLabelText('Block'));
    expect(alert).toHaveBeenCalledWith('Block Pat?', expect.any(String), expect.any(Array));
    expect(await screen.findByText(PROFILE_BLOCKED_LINE)).toBeTruthy();
    expect(mockSocial.tables.blocks).toEqual([{ blocker_id: SIGNED_IN_USER_ID, blocked_id: 'pat' }]);
    expect(screen.queryByLabelText('Follow')).toBeNull();
    expect(screen.queryByLabelText('Mute')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Unblock'));
    expect(await screen.findByLabelText('Follow')).toBeTruthy();
    expect(mockSocial.tables.blocks).toEqual([]);
    alert.mockRestore();
  });

  it('(B27) Block cancelled at the question does nothing', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderSignedIn(<ProfileView profileId="pat" />);
    await fireEvent.press(await screen.findByLabelText('Block'));
    expect(mockSocial.tables.blocks).toEqual([]);
    alert.mockRestore();
  });

  it('(B27) a refused mute keeps the button and shows the calm line', async () => {
    await renderSignedIn(<ProfileView profileId="pat" />);
    const mute = await screen.findByLabelText('Mute');
    mockSocial.setOffline(true);
    await fireEvent.press(mute);
    expect(await screen.findByText(SAFETY_FAILED)).toBeTruthy();
    expect(screen.getByLabelText('Mute')).toBeTruthy();
  });

  it('(B27) my own profile has no Mute or Block', async () => {
    mockSocial.tables.profiles.push(profile(SIGNED_IN_USER_ID, 'me_lifts', 'Me'));
    await renderSignedIn(<ProfileView profileId={SIGNED_IN_USER_ID} />);
    expect(await screen.findByLabelText('Edit profile')).toBeTruthy();
    expect(screen.queryByLabelText('Mute')).toBeNull();
    expect(screen.queryByLabelText('Block')).toBeNull();
  });

  it('a lifter with no PRs says so', async () => {
    await renderSignedIn(<ProfileView profileId="pat" />);
    await fireEvent.press(await screen.findByLabelText('Show personal records'));
    expect(await screen.findByText('No PRs to show.')).toBeTruthy();
  });
});

describe('ProfileView — Teams (B36, YOU-6)', () => {
  it('lists the lifter’s teams as links to the team pages', async () => {
    mockSocial.tables.teams.push({ id: 't', name: 'Iron Tribe', join_mode: 'open', created_by: 'pat' });
    mockSocial.tables.team_members.push({ team_id: 't', user_id: 'pat', role: 'owner', joined_at: '2026-11-15T10:00:00.000Z' });
    await renderSignedIn(<ProfileView profileId="pat" />);
    expect(await screen.findByText('Iron Tribe')).toBeTruthy();
    // Someone else's role isn't shown — just how the team lets people in.
    expect(screen.getByText('Open')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open team Iron Tribe'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/team/[id]', params: { id: 't' } });
  });

  it('a lifter whose teams the server withholds (or who has none) shows no Teams section', async () => {
    await renderSignedIn(<ProfileView profileId="pat" />);
    await screen.findByText('Pat session');
    expect(screen.queryByText('Teams')).toBeNull();
  });
});
