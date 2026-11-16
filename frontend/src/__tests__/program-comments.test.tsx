/**
 * Tests for a Marketplace program's Comments screen (B41 — MKT-3, "programs take comments exactly
 * as feed posts do"): the program's comments from two people, oldest first, with the right names
 * and never another program's or a post's; the composer's cap (Send off, the one sentence); a
 * sent comment lands in `program_comments` and appears as the fake server saved it; no ⋯ report
 * button (program-comment reporting is deferred); and the offline state with Retry. The Supabase
 * client is the in-memory fake social client; the router is a stub.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { COMMENTS_OFFLINE } from '@/components/social/CommentsPane';
import { COMMENT_MAX_CHARS, COMMENT_TOO_LONG } from '@/social/commentLimits';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';
import { renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import ProgramCommentsScreen from '@/app/program-comments/[id]';

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'prog-1' }),
}));

const ME = SIGNED_IN_USER_ID;

/** A stored comment on the screen's program (or another). */
function comment(id: string, user: string, createdAt: string, body: string, programId = 'prog-1') {
  return { id, program_id: programId, user_id: user, body, created_at: createdAt };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSocial = createFakeSocialClient({
    profiles: [profile(ME, 'me_lifts', 'Me Myself'), profile('ann', 'ann_lifts', 'Ann'), profile('bob', 'bob_lifts', 'Bob')],
    program_comments: [
      comment('c2', 'bob', '2026-11-14T10:05:00.000Z', 'Second, from Bob'),
      comment('c1', 'ann', '2026-11-14T10:00:00.000Z', 'First, from Ann'),
      comment('x', 'ann', '2026-11-14T09:00:00.000Z', 'On another program', 'prog-2'),
    ],
    // A post comment whose post id happens to match never shows here.
    comments: [{ id: 'pc', post_id: 'prog-1', user_id: 'ann', body: 'A post comment', created_at: '2026-11-14T08:00:00.000Z' }],
  });
});

describe('Program comments screen', () => {
  it('shows the program’s comments oldest first with their authors — nothing else', async () => {
    await renderSignedIn(<ProgramCommentsScreen />);
    expect(await screen.findByText('First, from Ann')).toBeTruthy();
    const bodies = screen.getAllByText(/^(First, from Ann|Second, from Bob)$/).map((n) => n.props.children as string);
    expect(bodies).toEqual(['First, from Ann', 'Second, from Bob']);
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.queryByText('On another program')).toBeNull();
    expect(screen.queryByText('A post comment')).toBeNull();
    // Reporting program comments is a recorded follow-up: no ⋯ yet.
    expect(screen.queryByLabelText(/^Report /)).toBeNull();
  });

  it('over the cap: Send is off and the one sentence shows', async () => {
    await renderSignedIn(<ProgramCommentsScreen />);
    await screen.findByText('First, from Ann');
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), 'x'.repeat(COMMENT_MAX_CHARS + 1));
    expect(screen.getByText(COMMENT_TOO_LONG)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(true);
  });

  it('a sent comment lands on the program as me and appears as saved', async () => {
    await renderSignedIn(<ProgramCommentsScreen />);
    await screen.findByText('First, from Ann');
    await fireEvent.changeText(screen.getByLabelText('Write a comment'), 'Ran it, loved it');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Ran it, loved it')).toBeTruthy();
    expect(screen.getByText('Me Myself')).toBeTruthy();
    expect(mockSocial.tables.program_comments.find((c) => c.body === 'Ran it, loved it')).toMatchObject({ program_id: 'prog-1', user_id: ME });
    expect(mockSocial.tables.comments).toHaveLength(1);
  });

  it('offline: the connection message; Retry loads; Back goes to the Marketplace with nothing behind', async () => {
    mockSocial.setOffline(true);
    await renderSignedIn(<ProgramCommentsScreen />);
    expect(await screen.findByText(COMMENTS_OFFLINE)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('First, from Ann')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/marketplace');
  });
});
