/**
 * Tests for direct messages' server calls (B48), against the in-memory fake: the pair is always
 * stored smaller id first, the first send starts the conversation (and a race re-reads the
 * winner), refusals — a block or the recipient's setting — come back as one calm sentence, the
 * thread reads newest-first and shows oldest-first, and the list reads in one request.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeMessagesClient } from '@/test-utils/fakeMessagesClient';

import {
  canMessageUser,
  canOpenThread,
  CONVERSATION_LIST_SELECT,
  conversationWith,
  getOrCreateConversation,
  listConversations,
  listMessages,
  MESSAGE_FAILED,
  MESSAGE_MAX_LENGTH,
  MESSAGE_REFUSED,
  messageLength,
  messageToSend,
  orderedPair,
  previewLine,
  sendMessage,
} from './messages';

const ALEX = '11111111-1111-4111-8111-111111111111';
const BEA = '22222222-2222-4222-8222-222222222222';
const CONV = 'c0000000-0000-4000-8000-000000000001';

const profiles = [
  { id: ALEX, username: 'alex', display_name: 'Alex', avatar_url: null },
  { id: BEA, username: 'bea', display_name: null, avatar_url: `${BEA}/a.jpg` },
];

describe('small helpers', () => {
  it('orders a pair smaller id first, whichever way round it is given', () => {
    expect(orderedPair(BEA, ALEX)).toEqual([ALEX, BEA]);
    expect(orderedPair(ALEX, BEA)).toEqual([ALEX, BEA]);
  });

  it('trims what will be sent, and refuses blank or over-long text', () => {
    expect(messageToSend('  hi  ')).toBe('hi');
    expect(messageToSend('   \n ')).toBeNull();
    expect(messageToSend('x'.repeat(MESSAGE_MAX_LENGTH))).toHaveLength(MESSAGE_MAX_LENGTH);
    expect(messageToSend('x'.repeat(MESSAGE_MAX_LENGTH + 1))).toBeNull();
  });

  it('mirrors the migration cap', () => {
    expect(MESSAGE_MAX_LENGTH).toBe(2000);
  });

  it('counts characters the way the server does — an emoji is one, not two', () => {
    expect(messageLength('💪')).toBe(1);
    expect('💪'.length).toBe(2);
    // 2000 emoji fit (the server's char_length is 2000), 2001 do not.
    expect(messageToSend('💪'.repeat(MESSAGE_MAX_LENGTH))).not.toBeNull();
    expect(messageToSend('💪'.repeat(MESSAGE_MAX_LENGTH + 1))).toBeNull();
  });

  it('flattens and shortens a preview line', () => {
    expect(previewLine('one\ntwo   three')).toBe('one two three');
    expect(previewLine('a'.repeat(100), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

describe('canMessageUser', () => {
  it('answers what the server answers, and false on any failure', async () => {
    expect(await canMessageUser(createFakeMessagesClient({ me: ALEX }).client, BEA)).toBe(true);
    expect(await canMessageUser(createFakeMessagesClient({ me: ALEX, canStart: () => false }).client, BEA)).toBe(false);
    expect(await canMessageUser(createFakeMessagesClient({ me: ALEX, blocked: true }).client, BEA)).toBe(false);
    expect(await canMessageUser(createFakeMessagesClient({ me: ALEX, offline: true }).client, BEA)).toBe(false);
  });
});

describe('canOpenThread (the profile’s Message button)', () => {
  it('is yes when the server allows starting one', async () => {
    expect(await canOpenThread(createFakeMessagesClient({ me: BEA }).client, BEA, ALEX)).toBe(true);
  });

  it('the reply edge: yes when a conversation already exists, even if Bea could not start one', async () => {
    const fake = createFakeMessagesClient({ me: BEA, canStart: () => false, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }] });
    expect(await canOpenThread(fake.client, BEA, ALEX)).toBe(true);
  });

  it('no when neither holds, when blocked, and on any failure', async () => {
    expect(await canOpenThread(createFakeMessagesClient({ me: BEA, canStart: () => false }).client, BEA, ALEX)).toBe(false);
    const blocked = createFakeMessagesClient({ me: BEA, blocked: true, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }] });
    expect(await canOpenThread(blocked.client, BEA, ALEX)).toBe(false);
    expect(await canOpenThread(createFakeMessagesClient({ me: BEA, offline: true }).client, BEA, ALEX)).toBe(false);
  });
});

describe('getOrCreateConversation', () => {
  it('finds the existing pair by its ordered ids — from either side', async () => {
    const fake = createFakeMessagesClient({ me: BEA, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }] });
    expect(await getOrCreateConversation(fake.client, BEA, ALEX)).toEqual({ ok: true, id: CONV });
    expect(fake.requests[0].calls).toEqual([
      ['select', 'id'],
      ['eq', 'user_a', ALEX],
      ['eq', 'user_b', BEA],
      ['maybeSingle'],
    ]);
    expect(fake.state.conversations).toHaveLength(1);
  });

  it('starts one with the pair in canonical order when none exists', async () => {
    const fake = createFakeMessagesClient({ me: BEA });
    const result = await getOrCreateConversation(fake.client, BEA, ALEX);
    expect(result.ok).toBe(true);
    expect(fake.state.conversations).toEqual([expect.objectContaining({ user_a: ALEX, user_b: BEA })]);
  });

  it("maps the server's refusal (the recipient's setting, or a block) to one calm sentence", async () => {
    expect(await getOrCreateConversation(createFakeMessagesClient({ me: ALEX, canStart: () => false }).client, ALEX, BEA)).toEqual({
      ok: false,
      message: MESSAGE_REFUSED,
    });
    expect(await getOrCreateConversation(createFakeMessagesClient({ me: ALEX, blocked: true }).client, ALEX, BEA)).toEqual({
      ok: false,
      message: MESSAGE_REFUSED,
    });
  });

  it('re-reads the winner when the other phone started the same conversation first (23505)', async () => {
    const fake = createFakeMessagesClient({ me: ALEX });
    // The first lookup sees nothing; the other phone's row lands before our insert.
    const realFrom = fake.client.from.bind(fake.client);
    let lookups = 0;
    (fake.client as unknown as { from: typeof realFrom }).from = ((table: string) => {
      if (table === 'conversations' && lookups++ === 1) fake.state.conversations.push({ id: CONV, user_a: ALEX, user_b: BEA });
      return realFrom(table);
    }) as typeof realFrom;
    expect(await getOrCreateConversation(fake.client, ALEX, BEA)).toEqual({ ok: true, id: CONV });
    expect(fake.state.conversations).toHaveLength(1);
  });

  it('reports a dropped connection as a failed send', async () => {
    expect(await getOrCreateConversation(createFakeMessagesClient({ me: ALEX, offline: true }).client, ALEX, BEA)).toEqual({
      ok: false,
      message: MESSAGE_FAILED,
    });
  });
});

describe('sendMessage', () => {
  it('the first message starts the conversation, then lands with the given id and a server time', async () => {
    const fake = createFakeMessagesClient({ me: ALEX });
    const id = 'e0000000-0000-4000-8000-000000000001';
    const result = await sendMessage(fake.client, { me: ALEX, other: BEA, conversationId: null, text: '  hello  ', id });
    expect(result).toEqual({
      ok: true,
      conversationId: fake.state.conversations[0].id,
      message: { id, conversationId: fake.state.conversations[0].id, senderId: ALEX, body: 'hello', createdAt: expect.any(String) },
    });
    expect(fake.state.messages).toHaveLength(1);
  });

  it('sends into an open conversation without looking it up again', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }] });
    expect((await sendMessage(fake.client, { me: ALEX, other: BEA, conversationId: CONV, text: 'hi' })).ok).toBe(true);
    expect(fake.requests.map((r) => r.table)).toEqual(['messages']);
  });

  it('a block refuses the send into an existing conversation', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, blocked: true, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }] });
    expect(await sendMessage(fake.client, { me: ALEX, other: BEA, conversationId: CONV, text: 'hi' })).toEqual({
      ok: false,
      message: MESSAGE_REFUSED,
    });
    expect(fake.state.messages).toHaveLength(0);
  });

  it('the recipient setting refuses a first message, and nothing is created', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, canStart: () => false });
    expect(await sendMessage(fake.client, { me: ALEX, other: BEA, conversationId: null, text: 'hi' })).toEqual({
      ok: false,
      message: MESSAGE_REFUSED,
    });
    expect(fake.state.conversations).toHaveLength(0);
  });

  it('sends nothing for blank text, and reports a dropped connection', async () => {
    const fake = createFakeMessagesClient({ me: ALEX });
    expect((await sendMessage(fake.client, { me: ALEX, other: BEA, conversationId: null, text: '   ' })).ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
    const offline = createFakeMessagesClient({ me: ALEX, offline: true, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }] });
    expect(await sendMessage(offline.client, { me: ALEX, other: BEA, conversationId: CONV, text: 'hi' })).toEqual({
      ok: false,
      message: MESSAGE_FAILED,
    });
  });

  it('a retried send with the same id cannot land twice', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }] });
    const id = 'e0000000-0000-4000-8000-000000000009';
    await sendMessage(fake.client, { me: ALEX, other: BEA, conversationId: CONV, text: 'hi', id });
    expect((await sendMessage(fake.client, { me: ALEX, other: BEA, conversationId: CONV, text: 'hi', id })).ok).toBe(false);
    expect(fake.state.messages).toHaveLength(1);
  });
});

describe('listMessages', () => {
  const messages = Array.from({ length: 5 }, (_, i) => ({
    id: `e0000000-0000-4000-8000-00000000000${i}`,
    conversation_id: CONV,
    sender_id: i % 2 ? BEA : ALEX,
    body: `m${i}`,
    created_at: `2026-11-16T09:0${i}:00.000Z`,
  }));

  it('reads the newest page newest-first, returns it oldest-first, and says whether older exist', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }], messages });
    const page = await listMessages(fake.client, CONV, 3);
    expect(page.messages.map((m) => m.body)).toEqual(['m2', 'm3', 'm4']);
    expect(page.hasOlder).toBe(true);
    expect(fake.requests[0].calls).toEqual([
      ['select', 'id,conversation_id,sender_id,body,created_at'],
      ['eq', 'conversation_id', CONV],
      ['order', 'created_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', 4, undefined],
    ]);
    expect((await listMessages(fake.client, CONV, 5)).hasOlder).toBe(false);
  });

  it('a blocked pair reads nothing', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, blocked: true, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }], messages });
    expect((await listMessages(fake.client, CONV)).messages).toEqual([]);
  });

  it('throws when the read fails', async () => {
    await expect(listMessages(createFakeMessagesClient({ me: ALEX, offline: true }).client, CONV)).rejects.toThrow('Loading messages failed');
  });
});

describe('listConversations', () => {
  it('reads every conversation in one request: the other lifter, the newest message, newest first, empty ones last', async () => {
    const CAL = '33333333-3333-4333-8333-333333333333';
    const OTHER = 'c0000000-0000-4000-8000-000000000002';
    const fake = createFakeMessagesClient({
      me: BEA,
      profiles: [...profiles, { id: CAL, username: 'cal', display_name: 'Cal', avatar_url: null }],
      conversations: [
        { id: OTHER, user_a: BEA, user_b: CAL, last_message_at: null },
        { id: CONV, user_a: ALEX, user_b: BEA, last_message_at: '2026-11-16T09:01:00.000Z' },
      ],
      messages: [
        { id: 'e1', conversation_id: CONV, sender_id: ALEX, body: 'first', created_at: '2026-11-16T09:00:00.000Z' },
        { id: 'e2', conversation_id: CONV, sender_id: BEA, body: 'latest', created_at: '2026-11-16T09:01:00.000Z' },
      ],
    });
    const list = await listConversations(fake.client, BEA);
    expect(list).toEqual([
      {
        id: CONV,
        other: { id: ALEX, username: 'alex', displayName: 'Alex', avatarPath: null },
        last: { senderId: BEA, body: 'latest', createdAt: '2026-11-16T09:01:00.000Z' },
      },
      { id: OTHER, other: { id: CAL, username: 'cal', displayName: 'Cal', avatarPath: null }, last: null },
    ]);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].calls).toEqual([
      ['select', CONVERSATION_LIST_SELECT],
      ['or', `user_a.eq.${BEA},user_b.eq.${BEA}`],
      ['order', 'created_at', { ascending: false, referencedTable: 'messages' }],
      ['limit', 1, { referencedTable: 'messages' }],
      ['order', 'last_message_at', { ascending: false, nullsFirst: false }],
      ['limit', 100, undefined],
    ]);
  });

  it('leaves out a blocked pair', async () => {
    const fake = createFakeMessagesClient({ me: ALEX, blocked: true, profiles, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }] });
    expect(await listConversations(fake.client, ALEX)).toEqual([]);
  });
});

describe('conversationWith', () => {
  it('is null when there is none, or when a block hides it', async () => {
    expect(await conversationWith(createFakeMessagesClient({ me: ALEX }).client, ALEX, BEA)).toBeNull();
    const hidden = createFakeMessagesClient({ me: ALEX, blocked: true, conversations: [{ id: CONV, user_a: ALEX, user_b: BEA }] });
    expect(await conversationWith(hidden.client, ALEX, BEA)).toBeNull();
  });
});
