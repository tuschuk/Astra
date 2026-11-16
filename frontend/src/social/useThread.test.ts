/**
 * Tests for one open DM thread's state (B48), against the fake client and its fake Realtime
 * channels — the Jest layer of "messages arrive in real time": the thread subscribes with the
 * exact `postgres_changes` arguments for its conversation, a pushed INSERT appears once, our own
 * send's echo is not shown twice, and the subscription is removed when the screen closes.
 */
import { describe, expect, it } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { createFakeMessagesClient } from '@/test-utils/fakeMessagesClient';

import { MESSAGE_REFUSED } from './messages';
import { mergeMessages, threadChannelFilter, useThread } from './useThread';

const ALEX = '11111111-1111-4111-8111-111111111111';
const BEA = '22222222-2222-4222-8222-222222222222';
const CONV = 'c0000000-0000-4000-8000-000000000001';

const seeded = () => ({
  conversations: [{ id: CONV, user_a: ALEX, user_b: BEA, last_message_at: '2026-11-16T09:00:00.000Z' }],
  messages: [{ id: 'e1', conversation_id: CONV, sender_id: BEA, body: 'hi Alex', created_at: '2026-11-16T09:00:00.000Z' }],
});

describe('mergeMessages', () => {
  const m = (id: string, createdAt: string) => ({ id, conversationId: CONV, senderId: ALEX, body: id, createdAt });
  it('adds new ones in time order and skips ids already shown', () => {
    const current = [m('a', '1'), m('c', '3')];
    expect(mergeMessages(current, [m('b', '2'), m('a', '1')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(mergeMessages(current, [m('a', '1')])).toBe(current);
  });
});

describe('useThread', () => {
  it('loads the conversation with the other lifter and subscribes to exactly its new messages', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, ...seeded() });
    const { result } = await renderHook(() => useThread(fake.client, ALEX, BEA));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.conversationId).toBe(CONV);
    expect(result.current.messages.map((m) => m.body)).toEqual(['hi Alex']);

    await waitFor(() => expect(fake.channels).toHaveLength(1));
    const [channel] = fake.channels;
    expect(channel.subscribed).toBe(true);
    expect(channel.bindings.map((b) => [b.type, b.filter])).toEqual([
      ['postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${CONV}` }],
    ]);
    expect(threadChannelFilter(CONV)).toEqual(channel.bindings[0].filter);
  });

  it('shows a message pushed over Realtime once, and ignores another conversation’s', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, ...seeded() });
    const { result } = await renderHook(() => useThread(fake.client, ALEX, BEA));
    await waitFor(() => expect(fake.channels).toHaveLength(1));

    const incoming = { id: 'e2', conversation_id: CONV, sender_id: BEA, body: 'you there?', created_at: '2026-11-16T09:05:00.000Z' };
    await act(async () => fake.emitInsert(incoming));
    await act(async () => fake.emitInsert(incoming));
    await act(async () => fake.emitInsert({ ...incoming, id: 'x', conversation_id: 'c0000000-0000-4000-8000-00000000000f' }));
    expect(result.current.messages.map((m) => m.body)).toEqual(['hi Alex', 'you there?']);
  });

  it('our own send appears at once, and its Realtime echo is not shown twice', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, ...seeded() });
    const { result } = await renderHook(() => useThread(fake.client, ALEX, BEA));
    await waitFor(() => expect(fake.channels).toHaveLength(1));

    await act(async () => {
      expect(await result.current.send('on my way')).toBe(true);
    });
    expect(result.current.messages.map((m) => m.body)).toEqual(['hi Alex', 'on my way']);
    const saved = fake.state.messages.find((m) => m.body === 'on my way');
    await act(async () => fake.emitInsert(saved!));
    expect(result.current.messages).toHaveLength(2);
  });

  it('starts with an empty thread when no conversation exists, and the first send starts one and subscribes', async () => {
    const fake = createFakeMessagesClient({ me: ALEX });
    const { result } = await renderHook(() => useThread(fake.client, ALEX, BEA));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(fake.channels).toHaveLength(0);

    await act(async () => {
      await result.current.send('hello');
    });
    const id = String(fake.state.conversations[0].id);
    expect(result.current.conversationId).toBe(id);
    await waitFor(() => expect(fake.channels.map((c) => c.bindings[0].filter.filter)).toEqual([`conversation_id=eq.${id}`]));
  });

  it('a refused send shows the calm line and adds nothing', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, canStart: () => false });
    const { result } = await renderHook(() => useThread(fake.client, ALEX, BEA));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      expect(await result.current.send('hello')).toBe(false);
    });
    expect(result.current.sendError).toBe(MESSAGE_REFUSED);
    expect(result.current.messages).toEqual([]);
  });

  it('removes the subscription when the screen closes', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, ...seeded() });
    const { unmount } = await renderHook(() => useThread(fake.client, ALEX, BEA));
    await waitFor(() => expect(fake.channels).toHaveLength(1));
    await unmount();
    expect(fake.channels[0].removed).toBe(true);
  });

  it('a failed first load is an error; a failed reload keeps what is on screen', async () => {
    const down = createFakeMessagesClient({ me: ALEX, offline: true });
    const first = await renderHook(() => useThread(down.client, ALEX, BEA));
    await waitFor(() => expect(first.result.current.status).toBe('error'));

    const fake = createFakeMessagesClient({ me: ALEX, ...seeded() });
    const { result } = await renderHook(() => useThread(fake.client, ALEX, BEA));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    fake.state.offline = true;
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.messages).toHaveLength(1);
  });

  it('Show older grows the read by a page', async () => {
    const messages = Array.from({ length: 55 }, (_, i) => ({
      id: `e${String(i).padStart(3, '0')}`,
      conversation_id: CONV,
      sender_id: BEA,
      body: `m${i}`,
      created_at: `2026-11-16T09:${String(i).padStart(2, '0')}:00.000Z`,
    }));
    const fake = createFakeMessagesClient({ me: ALEX, conversations: seeded().conversations, messages });
    const { result } = await renderHook(() => useThread(fake.client, ALEX, BEA));
    await waitFor(() => expect(result.current.messages).toHaveLength(50));
    expect(result.current.hasOlder).toBe(true);
    await act(async () => {
      await result.current.showOlder();
    });
    expect(result.current.messages).toHaveLength(55);
    expect(result.current.hasOlder).toBe(false);
  });
});
