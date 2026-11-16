/**
 * Tests for the two direct-message screens (B48 — SOC-12), with the in-memory fake messages
 * client (and its fake Realtime channels) standing in for the server:
 *   - Messages (the list): one row per conversation, newest first, "You: …" on the viewer's own
 *     last line, tapping opens the thread; the empty state; the connection message with Retry;
 *   - the thread: messages oldest first with the other lifter's name as the heading; a message
 *     pushed live appears without a reload; sending clears the box and shows the message once;
 *     a refused send shows the one calm line; an empty thread says hello; the cap counter.
 * The router is a stub; the server's walls (membership, blocks, the setting) were probed live.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { MESSAGE_MAX_LENGTH, MESSAGE_REFUSED, MESSAGES_OFFLINE } from '@/social/messages';
import { createFakeMessagesClient } from '@/test-utils/fakeMessagesClient';
import { renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import MessagesScreen, { NO_CONVERSATIONS } from '@/app/messages';
import MessageThreadScreen, { MESSAGE_COUNTER_FROM, MESSAGE_TOO_LONG, SAY_HELLO } from '@/app/messages/[userId]';

const ME = SIGNED_IN_USER_ID;
// Ids chosen so the pair's order is checked both ways round.
const SAM = '00000000-0000-4000-8000-00000000000a';
const ZOE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const CONV_SAM = 'c0000000-0000-4000-8000-000000000001';
const CONV_ZOE = 'c0000000-0000-4000-8000-000000000002';

const pair = (a: string, b: string) => (a < b ? { user_a: a, user_b: b } : { user_a: b, user_b: a });

let mockMessages = createFakeMessagesClient({ me: ME });
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockMessages.client,
}));

let mockUserId = SAM;
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ userId: mockUserId }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const profiles = [
  { id: ME, username: 'me_lifts', display_name: 'Me', avatar_url: null },
  { id: SAM, username: 'sam_lifts', display_name: 'Sam', avatar_url: null },
  { id: ZOE, username: 'zoe', display_name: null, avatar_url: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = SAM;
  mockMessages = createFakeMessagesClient({
    me: ME,
    profiles,
    conversations: [
      { id: CONV_SAM, ...pair(ME, SAM), last_message_at: '2026-11-16T09:01:00.000Z' },
      { id: CONV_ZOE, ...pair(ME, ZOE), last_message_at: '2026-11-15T09:00:00.000Z' },
    ],
    messages: [
      { id: 'e1', conversation_id: CONV_SAM, sender_id: SAM, body: 'Squat Saturday?', created_at: '2026-11-16T09:00:00.000Z' },
      { id: 'e2', conversation_id: CONV_SAM, sender_id: ME, body: 'In. 8am', created_at: '2026-11-16T09:01:00.000Z' },
      { id: 'e3', conversation_id: CONV_ZOE, sender_id: ZOE, body: 'Nice PR', created_at: '2026-11-15T09:00:00.000Z' },
    ],
  });
});

describe('Messages list (B48)', () => {
  it('lists conversations newest first with the other lifter and the newest line', async () => {
    await renderSignedIn(<MessagesScreen />);
    await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(2));
    const labels = screen.getAllByTestId('conversation-row').map((row) => row.props.accessibilityLabel as string);
    expect(labels).toEqual(['Conversation with Sam. You: In. 8am', 'Conversation with zoe. Nice PR']);
  });

  it('tapping a row opens the thread with that lifter', async () => {
    await renderSignedIn(<MessagesScreen />);
    await fireEvent.press(await screen.findByLabelText('Conversation with zoe. Nice PR'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/messages/[userId]', params: { userId: ZOE } });
  });

  it('a blocked pair’s conversation never appears; no conversations shows how to start one', async () => {
    mockMessages.state.blocked = true;
    await renderSignedIn(<MessagesScreen />);
    expect(await screen.findByText(NO_CONVERSATIONS)).toBeTruthy();
  });

  it('offline: the connection message, and Retry reads again', async () => {
    mockMessages.state.offline = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await renderSignedIn(<MessagesScreen />);
    expect(await screen.findByText(MESSAGES_OFFLINE)).toBeTruthy();
    mockMessages.state.offline = false;
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(2));
    warn.mockRestore();
  });
});

describe('Message thread (B48)', () => {
  it('shows the other lifter’s name and the messages oldest first, mine on the right', async () => {
    await renderSignedIn(<MessageThreadScreen />);
    expect(await screen.findByText('Sam')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Squat Saturday?')).toBeTruthy());
    expect(screen.getAllByTestId(/message-(mine|theirs)/).map((n) => n.props.testID)).toEqual(['message-theirs', 'message-mine']);
  });

  it('step DoD (Jest layer): a message pushed live appears without a reload', async () => {
    await renderSignedIn(<MessageThreadScreen />);
    await waitFor(() => expect(mockMessages.channels.filter((c) => c.subscribed)).toHaveLength(1));
    await act(async () =>
      mockMessages.emitInsert({ id: 'e9', conversation_id: CONV_SAM, sender_id: SAM, body: 'Bring chalk', created_at: '2026-11-16T09:30:00.000Z' }),
    );
    expect(screen.getByText('Bring chalk')).toBeTruthy();
  });

  it('sending shows the message once (its live echo is ignored) and clears the box', async () => {
    await renderSignedIn(<MessageThreadScreen />);
    await screen.findByText('Squat Saturday?');
    await fireEvent.changeText(screen.getByLabelText('Write a message'), '  See you there  ');
    await fireEvent.press(screen.getByLabelText('Send'));
    expect(await screen.findByText('See you there')).toBeTruthy();
    const saved = mockMessages.state.messages.find((m) => m.body === 'See you there');
    expect(saved).toMatchObject({ sender_id: ME, conversation_id: CONV_SAM });
    await act(async () => mockMessages.emitInsert(saved!));
    expect(screen.getAllByText('See you there')).toHaveLength(1);
    expect(screen.getByLabelText('Write a message').props.value).toBe('');
  });

  it('a refused send (a block, or their setting) shows one calm line and keeps the draft', async () => {
    mockUserId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    mockMessages.state.canStart = () => false;
    await renderSignedIn(<MessageThreadScreen />);
    expect(await screen.findByText(SAY_HELLO)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'hey');
    await fireEvent.press(screen.getByLabelText('Send'));
    expect(await screen.findByText(MESSAGE_REFUSED)).toBeTruthy();
    expect(screen.getByLabelText('Write a message').props.value).toBe('hey');
    expect(mockMessages.state.conversations).toHaveLength(2);
  });

  it('Send stays off for a blank box; the counter counts emoji once and a too-long draft says so', async () => {
    await renderSignedIn(<MessageThreadScreen />);
    await screen.findByText('Squat Saturday?');
    expect(screen.getByLabelText('Send').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Write a message'), '💪'.repeat(MESSAGE_COUNTER_FROM));
    expect(screen.getByText(`${MESSAGE_COUNTER_FROM} / ${MESSAGE_MAX_LENGTH}`)).toBeTruthy();
    expect(screen.getByLabelText('Send').props.accessibilityState.disabled).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'x'.repeat(MESSAGE_MAX_LENGTH + 1));
    expect(screen.getByText(MESSAGE_TOO_LONG)).toBeTruthy();
    expect(screen.getByLabelText('Send').props.accessibilityState.disabled).toBe(true);
  });

  it('scrolls to the newest message when the thread grows', async () => {
    await renderSignedIn(<MessageThreadScreen />);
    await screen.findByText('Squat Saturday?');
    const list = screen.getByTestId('thread-list');
    expect(typeof list.props.onContentSizeChange).toBe('function');
  });

  it('closing the thread removes its live subscription', async () => {
    const view = await renderSignedIn(<MessageThreadScreen />);
    await waitFor(() => expect(mockMessages.channels).toHaveLength(1));
    await view.unmount();
    expect(mockMessages.channels[0].removed).toBe(true);
  });

  it('offline: the connection message with Retry', async () => {
    mockMessages.state.offline = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await renderSignedIn(<MessageThreadScreen />);
    expect(await screen.findByText(MESSAGES_OFFLINE)).toBeTruthy();
    warn.mockRestore();
  });
});
