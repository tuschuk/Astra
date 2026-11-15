/**
 * Tests for the Find lifters screen (B20): searching after typing pauses, results as user cards
 * (never me, never someone I blocked), following and unfollowing from a card (SOC-7), a block's
 * refusal, and the offline message. The Supabase client is the in-memory fake social client.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { FOLLOW_REFUSED } from '@/social/follows';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';
import { renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import FindLiftersScreen from '@/app/find-lifters';

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const ME = SIGNED_IN_USER_ID;

beforeEach(() => {
  jest.clearAllMocks();
  mockSocial = createFakeSocialClient({
    profiles: [
      profile(ME, 'sam_me', 'Sam Me'),
      profile('a', 'samantha', 'Samantha'),
      profile('blocked', 'sam_blocked', null),
      profile('blocks-me', 'sam_blocks_me', null),
    ],
    blocks: [
      { blocker_id: ME, blocked_id: 'blocked' },
      { blocker_id: 'blocks-me', blocked_id: ME },
    ],
  });
});

async function searchFor(text: string) {
  await fireEvent.changeText(screen.getByLabelText('Search lifters'), text);
}

describe('Find lifters', () => {
  it('asks for two letters before searching', async () => {
    await renderSignedIn(<FindLiftersScreen />);
    expect(screen.getByText(/Type at least 2 letters/)).toBeTruthy();
    await searchFor('s');
    expect(screen.getByText(/Type at least 2 letters/)).toBeTruthy();
    expect(mockSocial.requests).toHaveLength(0);
  });

  it('shows matches as cards, without me or anyone I blocked, and follows then unfollows', async () => {
    await renderSignedIn(<FindLiftersScreen />);
    await searchFor('sam');
    expect(await screen.findByText('Samantha')).toBeTruthy();
    expect(screen.queryByText('Sam Me')).toBeNull();
    expect(screen.queryByText('@sam_blocked')).toBeNull();

    await searchFor('samantha');
    await screen.findByText('Samantha');
    await fireEvent.press(screen.getByLabelText('Follow'));
    expect(await screen.findByLabelText('Following')).toBeTruthy();
    expect(mockSocial.tables.follows).toContainEqual({ follower_id: ME, followee_id: 'a' });

    await fireEvent.press(screen.getByLabelText('Following'));
    await screen.findAllByLabelText('Follow');
    expect(mockSocial.tables.follows).toHaveLength(0);
  });

  it('a follow the server refuses (they blocked me) flips back and explains', async () => {
    await renderSignedIn(<FindLiftersScreen />);
    await searchFor('blocks_me');
    expect(await screen.findByText('@sam_blocks_me')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Follow'));
    expect(await screen.findByText(FOLLOW_REFUSED)).toBeTruthy();
    expect(screen.getByLabelText('Follow')).toBeTruthy();
    expect(mockSocial.tables.follows).toHaveLength(0);
  });

  it('says when nobody matches, and when there is no connection', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await renderSignedIn(<FindLiftersScreen />);
    await searchFor('zzz');
    expect(await screen.findByText('No lifters match “zzz”.')).toBeTruthy();
    mockSocial.setOffline(true);
    await searchFor('samantha');
    expect(await screen.findByText(/Searching needs a connection/)).toBeTruthy();
    warn.mockRestore();
  });

  it('Back goes back', async () => {
    await renderSignedIn(<FindLiftersScreen />);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
