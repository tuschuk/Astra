/**
 * Tests for the Comments screen (B23, SOC-5 — "users can comment on any visible post and see
 * others' comments"): a post's comments from two people, oldest first, with the right names;
 * the composer's cap (Send off, the one refusal sentence); sending one (it appears as the fake
 * server saved it); the "more exist" line at the load cap; and the offline state with Retry.
 * The Supabase client is the in-memory fake social client; the router is a stub.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { COMMENT_MAX_CHARS, COMMENT_TOO_LONG } from '@/social/commentLimits';
import { COMMENTS_LIMIT } from '@/social/comments';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';
import { renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import PostCommentsScreen, { MORE_COMMENTS_LINE, SEND_FAILED_LINE } from '@/app/post-comments/[id]';

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'post-1' }),
}));

const ME = SIGNED_IN_USER_ID;
const me = profile(ME, 'me_lifts', 'Me Myself');
const ann = profile('ann', 'ann_lifts', 'Ann');
const bob = profile('bob', 'bob_lifts', 'Bob');

/** A stored comment on the screen's post (or another). */
function comment(id: string, user: string, createdAt: string, body: string, postId = 'post-1') {
  return { id, post_id: postId, user_id: user, body, created_at: createdAt };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSocial = createFakeSocialClient({
    profiles: [me, ann, bob],
    comments: [
      comment('c2', 'bob', '2026-11-14T10:05:00.000Z', 'Second, from Bob'),
      comment('c1', 'ann', '2026-11-14T10:00:00.000Z', 'First, from Ann'),
      comment('x', 'ann', '2026-11-14T09:00:00.000Z', 'On another post', 'post-2'),
    ],
  });
});

/** The bodies of this test file's comments on screen, top to bottom. */
function shownBodies(): string[] {
  return screen
    .getAllByText(/^(First, from Ann|Second, from Bob|Lockout looked easy)$/)
    .map((node) => node.props.children as string);
}

describe('Comments screen', () => {
  it('shows others’ comments on the post, oldest first, with who wrote them', async () => {
    await renderSignedIn(<PostCommentsScreen />);
    expect(await screen.findByText('First, from Ann')).toBeTruthy();
    expect(shownBodies()).toEqual(['First, from Ann', 'Second, from Bob']);
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.queryByText('On another post')).toBeNull();
    expect(screen.queryByText(MORE_COMMENTS_LINE)).toBeNull();
  });

  it('adds my comment at the end, as the server saved it, and clears the box', async () => {
    await renderSignedIn(<PostCommentsScreen />);
    await screen.findByText('First, from Ann');
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), 'Lockout looked easy');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send'));
    });
    expect(await screen.findByText('Lockout looked easy')).toBeTruthy();
    expect(shownBodies()).toEqual(['First, from Ann', 'Second, from Bob', 'Lockout looked easy']);
    expect(screen.getByText('Me Myself')).toBeTruthy();
    expect(mockSocial.tables.comments).toContainEqual(
      expect.objectContaining({ post_id: 'post-1', user_id: ME, body: 'Lockout looked easy' }),
    );
    expect(screen.getByLabelText('Write a comment').props.value).toBe('');
  });

  it('Send is off while blank; past the cap it is off and says the one refusal sentence', async () => {
    await renderSignedIn(<PostCommentsScreen />);
    await screen.findByText('First, from Ann');
    const send = () => screen.getByLabelText('Send');
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), '    ');
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), 'x'.repeat(COMMENT_MAX_CHARS + 1));
    expect(screen.getByText(COMMENT_TOO_LONG)).toBeTruthy();
    expect(screen.getByText(`${COMMENT_MAX_CHARS + 1} / ${COMMENT_MAX_CHARS}`)).toBeTruthy();
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(send());
    expect(mockSocial.tables.comments).toHaveLength(3);
    // Exactly the cap in emoji is allowed (the server counts characters, not UTF-16 halves).
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), '💪'.repeat(COMMENT_MAX_CHARS));
    expect(screen.queryByText(COMMENT_TOO_LONG)).toBeNull();
    expect(send().props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('says more comments exist when a full load arrives', async () => {
    mockSocial = createFakeSocialClient({
      profiles: [ann],
      comments: Array.from({ length: COMMENTS_LIMIT }, (_, i) =>
        comment(`c${String(i).padStart(3, '0')}`, 'ann', '2026-11-14T10:00:00.000Z', `Comment ${i}`),
      ),
    });
    await renderSignedIn(<PostCommentsScreen />);
    expect(await screen.findByText(MORE_COMMENTS_LINE)).toBeTruthy();
  });

  it('offline: says comments need a connection, and Retry loads them once back', async () => {
    mockSocial.setOffline(true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await renderSignedIn(<PostCommentsScreen />);
    expect(await screen.findByText(/Comments need a connection/)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('First, from Ann')).toBeTruthy();
    warn.mockRestore();
  });

  it('a send that fails keeps the text and says so', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await renderSignedIn(<PostCommentsScreen />);
    await screen.findByText('First, from Ann');
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), 'Into the void');
    mockSocial.setOffline(true);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send'));
    });
    expect(screen.getByText(SEND_FAILED_LINE)).toBeTruthy();
    expect(screen.getByLabelText('Write a comment').props.value).toBe('Into the void');
    warn.mockRestore();
  });

  it('Back returns to where the lifter came from', async () => {
    await renderSignedIn(<PostCommentsScreen />);
    await screen.findByText('First, from Ann');
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
