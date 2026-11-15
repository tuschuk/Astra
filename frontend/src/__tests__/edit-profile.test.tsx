/**
 * Tests for Edit profile (B25, YOU-1) — how the five header facts become settable. The server is
 * the in-memory fake social client (with the `profiles` unique / CHECK refusals); the photo
 * library, the file-size fallback and the avatar upload / delete are stubbed at their seams.
 * Pinned: a valid save updates my row (and the phone's remembered copy) and goes back; over-limit
 * text and a cleared username are refused under their boxes with no request sent; a taken
 * username shows "taken"; an over-limit photo is refused at pick with Save disabled; an accepted
 * photo is uploaded into my folder, saved as the profile's path, and the old one cleaned up;
 * offline says so.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { checkAvatarImage, MAX_AVATAR_BYTES } from '@/social/mediaLimits';
import { getCachedOwnProfile, resetOwnProfileCache } from '@/social/ownProfileCache';
import { PROFILE_FIELD_MESSAGES } from '@/social/profileLimits';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';
import { renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import EditProfileScreen, { AVATAR_UPLOAD_FAILED } from '@/app/edit-profile';

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
  readSupabaseConfig: () => ({ url: 'https://proj.supabase.co', anonKey: 'anon' }),
}));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

let mockPick: { canceled: boolean; assets: { uri: string; fileSize?: number; mimeType?: string }[] | null };
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: async () => mockPick }));

jest.mock('@/social/postImages', () => ({
  ...jest.requireActual<typeof import('@/social/postImages')>('@/social/postImages'),
  fileSizeOf: async () => null,
}));

const mockUpload = jest.fn(async (..._args: unknown[]): Promise<void> => {});
const mockDelete = jest.fn(async (..._args: unknown[]): Promise<boolean> => true);
jest.mock('@/social/avatars', () => ({
  ...jest.requireActual<typeof import('@/social/avatars')>('@/social/avatars'),
  uploadAvatar: (...args: unknown[]) => mockUpload(...args),
  deleteAvatar: (...args: unknown[]) => mockDelete(...args),
}));

const ME = SIGNED_IN_USER_ID;

beforeEach(() => {
  jest.clearAllMocks();
  resetOwnProfileCache();
  mockPick = { canceled: false, assets: [{ uri: 'file:///cache/face.jpg', fileSize: 1_000_000, mimeType: 'image/jpeg' }] };
  mockSocial = createFakeSocialClient({
    profiles: [
      profile(ME, 'me_lifts', 'Sam', { bio: 'Old bio', avatar_url: `${ME}/old.jpg` }),
      profile('other', 'taken_name', 'Other'),
    ],
  });
});

/** Profile update requests sent so far. */
function updates() {
  return mockSocial.requests.filter((r) => r.some(([m]) => m === 'update'));
}

async function openForm() {
  await renderSignedIn(<EditProfileScreen />);
  return screen.findByLabelText('Display name');
}

describe('Edit profile (B25)', () => {
  it('fills the boxes, saves a valid change to my row and my remembered copy, and goes back', async () => {
    const name = await openForm();
    expect(name.props.value).toBe('Sam');
    expect(screen.getByLabelText('Bio').props.value).toBe('Old bio');
    await fireEvent.changeText(name, '  Sam Strong ');
    await fireEvent.changeText(screen.getByLabelText('Bio'), 'Chasing 200.');
    await fireEvent.changeText(screen.getByLabelText('Username'), 'sam_strong');
    await fireEvent.press(screen.getByLabelText('Save'));
    await screen.findByLabelText('Save');
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockSocial.tables.profiles[0]).toMatchObject({
      display_name: 'Sam Strong',
      bio: 'Chasing 200.',
      username: 'sam_strong',
      avatar_url: `${ME}/old.jpg`,
    });
    expect(getCachedOwnProfile(ME)).toEqual({
      username: 'sam_strong',
      displayName: 'Sam Strong',
      bio: 'Chasing 200.',
      avatarPath: `${ME}/old.jpg`,
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('refuses over-limit text and a cleared username under their boxes, sending nothing', async () => {
    await openForm();
    await fireEvent.changeText(screen.getByLabelText('Bio'), 'b'.repeat(301));
    await fireEvent.changeText(screen.getByLabelText('Username'), '');
    await fireEvent.press(screen.getByLabelText('Save'));
    expect(await screen.findByText(PROFILE_FIELD_MESSAGES.bio)).toBeTruthy();
    expect(screen.getByText(PROFILE_FIELD_MESSAGES.usernameRequired)).toBeTruthy();
    expect(updates()).toHaveLength(0);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('a username someone else has shows "taken" and stays', async () => {
    await openForm();
    await fireEvent.changeText(screen.getByLabelText('Username'), 'Taken_Name');
    await fireEvent.press(screen.getByLabelText('Save'));
    expect(await screen.findByText(PROFILE_FIELD_MESSAGES.usernameTaken)).toBeTruthy();
    expect(mockSocial.tables.profiles[0].username).toBe('me_lifts');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('refuses an over-limit photo at pick with the limits message; Save is disabled', async () => {
    mockPick = { canceled: false, assets: [{ uri: 'file:///huge.jpg', fileSize: MAX_AVATAR_BYTES + 1, mimeType: 'image/jpeg' }] };
    await openForm();
    await fireEvent.press(screen.getByLabelText('Change photo'));
    const refusal = checkAvatarImage({ byteSize: MAX_AVATAR_BYTES + 1, mimeType: 'image/jpeg' });
    if (refusal.ok) throw new Error('expected a refusal');
    expect(await screen.findByText(refusal.message)).toBeTruthy();
    expect(screen.getByLabelText('Save')).toBeDisabled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('uploads an accepted photo into my folder, saves its path, then deletes the old one', async () => {
    await openForm();
    await fireEvent.press(screen.getByLabelText('Change photo'));
    expect(await screen.findByLabelText('Chosen photo')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Save'));
    await screen.findByLabelText('Save');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [, , localUri, path, mime] = mockUpload.mock.calls[0] as [unknown, unknown, string, string, string];
    expect(localUri).toBe('file:///cache/face.jpg');
    expect(mime).toBe('image/jpeg');
    expect(path).toMatch(new RegExp(`^${ME}/[0-9a-f-]{36}\\.jpg$`));
    expect(mockSocial.tables.profiles[0].avatar_url).toBe(path);
    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), expect.anything(), `${ME}/old.jpg`);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('a failed photo upload saves nothing and says so', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockUpload.mockRejectedValueOnce(new Error('offline'));
    await openForm();
    await fireEvent.press(screen.getByLabelText('Change photo'));
    await screen.findByLabelText('Chosen photo');
    await fireEvent.press(screen.getByLabelText('Save'));
    expect(await screen.findByText(AVATAR_UPLOAD_FAILED)).toBeTruthy();
    expect(updates()).toHaveLength(0);
    expect(mockSocial.tables.profiles[0].avatar_url).toBe(`${ME}/old.jpg`);
    warn.mockRestore();
  });

  it('offline: editing needs a connection, with Retry', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSocial.setOffline(true);
    await renderSignedIn(<EditProfileScreen />);
    expect(await screen.findByText('Editing your profile needs a connection.')).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByLabelText('Display name')).toBeTruthy();
    warn.mockRestore();
  });
});
