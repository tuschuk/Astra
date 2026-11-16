/**
 * Tests for the `notify` server function's decisions (B47 — push notifications; step DoD "each
 * toggle stops exactly its notification"). The database and Expo are an in-memory fake; nothing
 * touches the real project or the network.
 *
 * The heart of it is the matrix: for each of the four events, with each of the four switches
 * turned off in turn, exactly the event that switch governs is skipped and the others still send.
 */
import { describe, expect, it } from '@jest/globals';

import { buildMessage, chunk, isDeviceNotRegistered, parseTickets, type ExpoMessage } from '../notify/expoPush.ts';
import {
  DEFAULT_SWITCHES,
  handleNotifyRequest,
  parseNotifyRequest,
  SWITCH_FOR_EVENT,
  type NotifyDeps,
  type NotifyEvent,
  type NotifySwitches,
} from '../notify/handler.ts';

const ALEX = '11111111-1111-4111-8111-111111111111'; // the actor
const BEA = '22222222-2222-4222-8222-222222222222'; // the recipient
const CAL = '33333333-3333-4333-8333-333333333333'; // a teammate
const POST = 'a0000000-0000-4000-8000-000000000001'; // Bea's post
const COMMENT = 'c0000000-0000-4000-8000-000000000001'; // Alex's comment on it
const OWN_COMMENT = 'c0000000-0000-4000-8000-000000000002'; // Bea's comment on her own post
const TEAM = 'b0000000-0000-4000-8000-000000000001';
const TEAM_POST = 'd0000000-0000-4000-8000-000000000001'; // Alex's post to the team

const tokenOf = (who: string, n = 0) => `ExponentPushToken[${who.slice(0, 4)}${n}]`;

/** A fake world with Alex, Bea and Cal; Bea and Cal have one phone each. */
function fakeWorld() {
  const switches = new Map<string, NotifySwitches>([
    [BEA, { ...DEFAULT_SWITCHES }],
    [CAL, { ...DEFAULT_SWITCHES }],
  ]);
  const follows = new Set([`${ALEX}:${BEA}`]);
  const comments = new Map([
    [COMMENT, { authorId: ALEX, postId: POST, postAuthorId: BEA }],
    [OWN_COMMENT, { authorId: BEA, postId: POST, postAuthorId: BEA }],
  ]);
  const votes = new Map([[`${POST}:${ALEX}`, { value: 1, postAuthorId: BEA }]]);
  const teamPosts = new Map([[TEAM_POST, { authorId: ALEX, teamId: TEAM, teamName: 'Iron Crew' }]]);
  const members = [ALEX, BEA, CAL];
  const blocks: [string, string][] = [];
  const mutes: [string, string][] = []; // [muter, muted]
  let tokens: { token: string; user_id: string }[] = [
    { token: tokenOf(BEA), user_id: BEA },
    { token: tokenOf(CAL), user_id: CAL },
  ];
  const log = new Map<string, { status: string; tickets?: unknown }>();
  const sent: ExpoMessage[][] = [];
  let expoReply: (messages: readonly ExpoMessage[]) => unknown = (messages) => ({
    data: messages.map((_, i) => ({ status: 'ok', id: `ticket-${i}` })),
  });

  const deps: NotifyDeps = {
    followExists: async (a, b) => follows.has(`${a}:${b}`),
    readComment: async (id) => comments.get(id) ?? null,
    readVote: async (post, voter) => votes.get(`${post}:${voter}`) ?? null,
    readTeamPost: async (id) => teamPosts.get(id) ?? null,
    teamMemberIds: async () => [...members],
    displayName: async (id) => (id === ALEX ? 'Alex' : id === BEA ? 'Bea' : null),
    readSwitches: async (ids) => new Map([...switches].filter(([id]) => ids.includes(id))),
    blockedWith: async (actor, ids) =>
      new Set(ids.filter((id) => blocks.some(([x, y]) => (x === actor && y === id) || (x === id && y === actor)))),
    mutedBy: async (actor, ids) => new Set(ids.filter((id) => mutes.some(([muter, muted]) => muter === id && muted === actor))),
    readTokens: async (ids) => tokens.filter((t) => ids.includes(t.user_id)),
    claim: async ({ event, sourceKey, recipientId, status }) => {
      const key = `${event}|${sourceKey}|${recipientId}`;
      if (log.has(key)) return false;
      log.set(key, { status });
      return true;
    },
    finish: async ({ event, sourceKey, recipientId, status, tickets }) => {
      log.set(`${event}|${sourceKey}|${recipientId}`, { status, tickets });
    },
    sendToExpo: async (messages) => {
      sent.push([...messages]);
      return expoReply(messages);
    },
    deleteTokens: async (dead) => {
      tokens = tokens.filter((t) => !dead.includes(t.token));
    },
  };
  return {
    deps,
    switches,
    votes,
    members,
    blocks,
    mutes,
    log,
    sent,
    get tokens() {
      return tokens;
    },
    set tokens(value) {
      tokens = value;
    },
    setExpoReply(fn: typeof expoReply) {
      expoReply = fn;
    },
  };
}

/** The four calls the triggers make, one per event, all with Alex as the actor. */
const CALLS: Record<NotifyEvent, unknown> = {
  follow: { event: 'follow', keys: { follower_id: ALEX, followee_id: BEA } },
  comment: { event: 'comment', keys: { id: COMMENT } },
  vote: { event: 'vote', keys: { post_id: POST, user_id: ALEX } },
  team_push: { event: 'team_push', keys: { id: TEAM_POST } },
};
const EVENTS = Object.keys(CALLS) as NotifyEvent[];

describe('parseNotifyRequest', () => {
  it('reads each event with its keys', () => {
    expect(parseNotifyRequest(CALLS.follow)).toEqual({ event: 'follow', followerId: ALEX, followeeId: BEA });
    expect(parseNotifyRequest(CALLS.comment)).toEqual({ event: 'comment', commentId: COMMENT });
    expect(parseNotifyRequest(CALLS.vote)).toEqual({ event: 'vote', postId: POST, voterId: ALEX });
    expect(parseNotifyRequest(CALLS.team_push)).toEqual({ event: 'team_push', teamPostId: TEAM_POST });
  });

  it('refuses unknown events, missing or non-uuid keys, and non-objects', () => {
    expect(parseNotifyRequest({ event: 'dm', keys: { id: COMMENT } })).toBeNull();
    expect(parseNotifyRequest({ event: 'comment', keys: { id: 'not-a-uuid' } })).toBeNull();
    expect(parseNotifyRequest({ event: 'follow', keys: { follower_id: ALEX } })).toBeNull();
    expect(parseNotifyRequest({ event: 'comment' })).toBeNull();
    expect(parseNotifyRequest(null)).toBeNull();
    expect(parseNotifyRequest('comment')).toBeNull();
  });
});

describe('handleNotifyRequest — each switch stops exactly its notification', () => {
  for (const off of EVENTS) {
    describe(`with ${SWITCH_FOR_EVENT[off]} off`, () => {
      for (const event of EVENTS) {
        const expected = event === off ? 'skipped_setting' : 'sent';
        it(`${event} → ${expected}`, async () => {
          const world = fakeWorld();
          world.switches.set(BEA, { ...DEFAULT_SWITCHES, [SWITCH_FOR_EVENT[off]]: false });
          const outcome = await handleNotifyRequest(CALLS[event], world.deps);
          expect(outcome.get(BEA)).toBe(expected);
          const toBea = world.sent.flat().filter((m) => m.to === tokenOf(BEA));
          expect(toBea).toHaveLength(expected === 'sent' ? 1 : 0);
        });
      }
    });
  }

  it('sends all four when every switch is on, and a person with no settings row gets the defaults', async () => {
    const world = fakeWorld();
    world.switches.delete(BEA);
    for (const event of EVENTS) expect((await handleNotifyRequest(CALLS[event], world.deps)).get(BEA)).toBe('sent');
  });
});

describe('handleNotifyRequest — who hears about it', () => {
  it('never tells the actor about their own act', async () => {
    const world = fakeWorld();
    const outcome = await handleNotifyRequest({ event: 'comment', keys: { id: OWN_COMMENT } }, world.deps);
    expect(outcome.get(BEA)).toBe('skipped_self');
    expect(world.sent).toHaveLength(0);
  });

  it('skips when the recipient blocked the actor, or the actor blocked the recipient', async () => {
    for (const pair of [[BEA, ALEX], [ALEX, BEA]] as [string, string][]) {
      const world = fakeWorld();
      world.blocks.push(pair);
      expect((await handleNotifyRequest(CALLS.comment, world.deps)).get(BEA)).toBe('skipped_block');
      expect(world.sent).toHaveLength(0);
    }
  });

  it('skips when the recipient muted the actor — but not when the actor muted the recipient', async () => {
    const world = fakeWorld();
    world.mutes.push([BEA, ALEX]);
    expect((await handleNotifyRequest(CALLS.vote, world.deps)).get(BEA)).toBe('skipped_mute');

    const other = fakeWorld();
    other.mutes.push([ALEX, BEA]);
    expect((await handleNotifyRequest(CALLS.vote, other.deps)).get(BEA)).toBe('sent');
  });

  it('ignores a downvote, and a vote that is gone', async () => {
    const world = fakeWorld();
    world.votes.set(`${POST}:${ALEX}`, { value: -1, postAuthorId: BEA });
    expect((await handleNotifyRequest(CALLS.vote, world.deps)).size).toBe(0);
    world.votes.clear();
    expect((await handleNotifyRequest(CALLS.vote, world.deps)).size).toBe(0);
    expect(world.sent).toHaveLength(0);
    expect(world.log.size).toBe(0);
  });

  it('ignores a call for a row that does not exist (a forged call learns and sends nothing)', async () => {
    const world = fakeWorld();
    const ghost = 'f0000000-0000-4000-8000-00000000000f';
    expect((await handleNotifyRequest({ event: 'comment', keys: { id: ghost } }, world.deps)).size).toBe(0);
    expect((await handleNotifyRequest({ event: 'follow', keys: { follower_id: BEA, followee_id: ALEX } }, world.deps)).size).toBe(0);
    expect(world.sent).toHaveLength(0);
  });

  it('tells every team member except the author about a team post', async () => {
    const world = fakeWorld();
    const outcome = await handleNotifyRequest(CALLS.team_push, world.deps);
    expect([...outcome]).toEqual([
      [BEA, 'sent'],
      [CAL, 'sent'],
    ]);
    expect(outcome.has(ALEX)).toBe(false);
    expect(world.sent.flat().map((m) => m.to).sort()).toEqual([tokenOf(BEA), tokenOf(CAL)].sort());
  });

  it("applies each member's own switch on a team post", async () => {
    const world = fakeWorld();
    world.switches.set(CAL, { ...DEFAULT_SWITCHES, notify_team_pushes: false });
    const outcome = await handleNotifyRequest(CALLS.team_push, world.deps);
    expect(outcome.get(BEA)).toBe('sent');
    expect(outcome.get(CAL)).toBe('skipped_setting');
  });

  it('logs no_tokens for a recipient with no phone registered', async () => {
    const world = fakeWorld();
    world.tokens = [];
    expect((await handleNotifyRequest(CALLS.follow, world.deps)).get(BEA)).toBe('no_tokens');
    expect(world.sent).toHaveLength(0);
  });

  it('sends to every phone a recipient has', async () => {
    const world = fakeWorld();
    world.tokens = [...world.tokens, { token: tokenOf(BEA, 1), user_id: BEA }];
    await handleNotifyRequest(CALLS.follow, world.deps);
    expect(world.sent.flat().map((m) => m.to)).toEqual([tokenOf(BEA), tokenOf(BEA, 1)]);
  });
});

describe('handleNotifyRequest — repeats, batching and Expo errors', () => {
  it('sends nothing the second time the same call arrives', async () => {
    const world = fakeWorld();
    expect((await handleNotifyRequest(CALLS.comment, world.deps)).get(BEA)).toBe('sent');
    expect((await handleNotifyRequest(CALLS.comment, world.deps)).size).toBe(0);
    expect(world.sent).toHaveLength(1);
  });

  it('records each outcome in the log, with Expo tickets for a send', async () => {
    const world = fakeWorld();
    world.switches.set(CAL, { ...DEFAULT_SWITCHES, notify_team_pushes: false });
    await handleNotifyRequest(CALLS.team_push, world.deps);
    expect(world.log.get(`team_push|${TEAM_POST}|${BEA}`)).toEqual({ status: 'sent', tickets: [{ status: 'ok', id: 'ticket-0' }] });
    expect(world.log.get(`team_push|${TEAM_POST}|${CAL}`)).toEqual({ status: 'skipped_setting' });
  });

  it('splits more than 100 phones into requests of at most 100', async () => {
    const world = fakeWorld();
    const many = Array.from({ length: 130 }, (_, i) => `e0000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    world.members.push(...many);
    world.tokens = [...world.tokens, ...many.map((id) => ({ token: `ExponentPushToken[m${id.slice(-4)}]`, user_id: id }))];
    const outcome = await handleNotifyRequest(CALLS.team_push, world.deps);
    expect(world.sent.map((batch) => batch.length)).toEqual([100, 32]);
    expect([...outcome.values()].every((s) => s === 'sent')).toBe(true);
  });

  it('forgets a phone Expo reports as DeviceNotRegistered, and logs send_failed', async () => {
    const world = fakeWorld();
    world.setExpoReply((messages) => ({
      data: messages.map(() => ({ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } })),
    }));
    expect((await handleNotifyRequest(CALLS.follow, world.deps)).get(BEA)).toBe('send_failed');
    expect(world.tokens.map((t) => t.user_id)).toEqual([CAL]);
  });

  it('logs send_failed when the request to Expo fails outright, and keeps the token', async () => {
    const world = fakeWorld();
    world.setExpoReply(() => {
      throw new Error('offline');
    });
    expect((await handleNotifyRequest(CALLS.follow, world.deps)).get(BEA)).toBe('send_failed');
    expect(world.tokens).toHaveLength(2);
  });
});

describe('handleNotifyRequest — what a push says', () => {
  it('carries the actor name and the kind of act, the screen to open, and nothing else', async () => {
    const world = fakeWorld();
    for (const event of EVENTS) await handleNotifyRequest(CALLS[event], world.deps);
    const toBea = world.sent.flat().filter((m) => m.to === tokenOf(BEA));
    expect(toBea.map(({ title, body, data }) => ({ title, body, data }))).toEqual([
      { title: 'New follower', body: 'Alex started following you', data: { path: `/profile/${ALEX}` } },
      { title: 'New comment', body: 'Alex commented on your post', data: { path: `/post-comments/${POST}` } },
      { title: 'New upvote', body: 'Alex upvoted your post', data: { path: `/post-comments/${POST}` } },
      { title: 'Iron Crew', body: 'Alex posted to Iron Crew', data: { path: `/team/${TEAM}` } },
    ]);
  });

  it('never reads a comment body — the fake has none to leak, and the message has no extra fields', async () => {
    const world = fakeWorld();
    await handleNotifyRequest(CALLS.comment, world.deps);
    expect(Object.keys(world.sent[0][0]).sort()).toEqual(['body', 'data', 'sound', 'title', 'to']);
    expect(Object.keys(world.sent[0][0].data)).toEqual(['path']);
  });

  it('calls a lifter with no name "Someone"', async () => {
    const world = fakeWorld();
    world.deps.displayName = async () => null;
    await handleNotifyRequest(CALLS.follow, world.deps);
    expect(world.sent[0][0].body).toBe('Someone started following you');
  });
});

describe('expoPush helpers', () => {
  it('chunks in order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([])).toEqual([]);
  });

  it('builds a message', () => {
    expect(buildMessage('t', 'T', 'B', '/x')).toEqual({ to: 't', title: 'T', body: 'B', sound: 'default', data: { path: '/x' } });
  });

  it('parses tickets, and turns an unreadable or mis-sized reply into errors for all', () => {
    expect(parseTickets({ data: [{ status: 'ok', id: 'a' }, { status: 'error', message: 'm', details: { error: 'DeviceNotRegistered' } }] }, 2)).toEqual([
      { status: 'ok', id: 'a' },
      { status: 'error', message: 'm', details: { error: 'DeviceNotRegistered' } },
    ]);
    expect(parseTickets(null, 2).every((t) => t.status === 'error')).toBe(true);
    expect(parseTickets({ data: [{ status: 'ok', id: 'a' }] }, 2)).toHaveLength(2);
    expect(parseTickets({ errors: [{ code: 'X' }] }, 1)[0].status).toBe('error');
  });

  it('recognises DeviceNotRegistered only', () => {
    expect(isDeviceNotRegistered({ status: 'error', message: '', details: { error: 'DeviceNotRegistered' } })).toBe(true);
    expect(isDeviceNotRegistered({ status: 'error', message: '', details: { error: 'MessageRateExceeded' } })).toBe(false);
    expect(isDeviceNotRegistered({ status: 'ok', id: 'x' })).toBe(false);
  });
});
