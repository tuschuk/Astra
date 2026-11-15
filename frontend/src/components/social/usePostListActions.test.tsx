/**
 * Tests for usePostListActions (B36's shared card wiring): a vote reaches the server and a
 * second tap takes it back, a report is filed, the three "open" buttons route to the right
 * screens, and with nobody signed in the writes quietly fail. (The privacy change is covered
 * through Home's and the profile's own tests, which use this hook.)
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawPost } from '@/test-utils/feedFixtures';

import { usePostListActions } from './usePostListActions';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const pat = profile('pat', 'pat_pulls', 'Pat');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('usePostListActions', () => {
  it('votes, takes the vote back, and files a report', async () => {
    const fake = createFakeSocialClient({ posts: [rawPost({ id: 'p', author: pat, createdAt: '2026-11-15T08:00:00.000Z' })] });
    const { result } = await renderHook(() =>
      usePostListActions({ client: fake.client, db: null, me: 'me', onVisibilityChanged: jest.fn() }),
    );
    expect((await result.current.vote('p', 1)).ok).toBe(true);
    expect(fake.tables.votes).toEqual([{ post_id: 'p', user_id: 'me', value: 1 }]);
    expect((await result.current.vote('p', null)).ok).toBe(true);
    expect(fake.tables.votes).toEqual([]);
    expect((await result.current.reportPost('p', 'spam', '')).ok).toBe(true);
    expect(fake.tables.reports).toHaveLength(1);
  });

  it('routes the share, comments and profile buttons', async () => {
    const fake = createFakeSocialClient();
    const { result } = await renderHook(() =>
      usePostListActions({ client: fake.client, db: null, me: 'me', onVisibilityChanged: jest.fn() }),
    );
    result.current.shareWorkout('w');
    result.current.openComments('p');
    result.current.openProfile('pat');
    expect(mockPush.mock.calls).toEqual([
      [{ pathname: '/share-card/[id]', params: { id: 'w' } }],
      [{ pathname: '/post-comments/[id]', params: { id: 'p' } }],
      [{ pathname: '/profile/[id]', params: { id: 'pat' } }],
    ]);
  });

  it('signed out, the writes fail without a request', async () => {
    const fake = createFakeSocialClient();
    const { result } = await renderHook(() =>
      usePostListActions({ client: fake.client, db: null, me: null, onVisibilityChanged: jest.fn() }),
    );
    expect(await result.current.vote('p', 1)).toEqual({ ok: false, reason: 'failed' });
    expect((await result.current.reshare(undefined as never)).ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });
});
