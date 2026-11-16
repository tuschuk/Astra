/**
 * What the `notify` server function does with one call (B47 — push notifications), separated
 * from the Deno wiring in `index.ts` so every decision can be tested with fakes.
 *
 * Who calls it: the database itself. After a row is inserted into `follows`, `comments`, `votes`
 * (upvotes only), `team_posts` or `messages` (B48 — direct messages), a trigger queues a call here
 * carrying only that row's keys —
 * `{ event: 'follow' | 'comment' | 'vote' | 'team_push' | 'message', keys: {...} }`.
 *
 * Why it trusts nothing in the call: the function is reachable without a login (a database
 * trigger has no lifter's login to send, and storing a secret in SQL would be worse). So the call
 * is treated as a hint — "look at this row" — and everything that matters is re-read from the
 * database with the server key: whether the row exists, who did it, who should hear about it, and
 * what the message says. A made-up call can at most ask about a row that truly exists, and the
 * `notification_log` "already handled" key turns a repeat into nothing. The caller is told
 * nothing either way (index.ts always answers the same empty 204).
 *
 * For each person who should hear about the event, in this order:
 *   1. never the person who did it ("skipped_self");
 *   2. nothing if either has blocked the other ("skipped_block");
 *   3. nothing if the recipient has muted the actor ("skipped_mute");
 *   4. nothing if the recipient turned this kind of notification off in Settings
 *      ("skipped_setting") — the step's definition of done: each switch stops exactly its own;
 *   5. nothing if they have no phone registered for push ("no_tokens");
 *   6. otherwise one push to each of their phones ("sent", or "send_failed" if Expo refused all).
 * Every outcome is written to `notification_log` first; if a row for the same event, source row
 * and recipient is already there, that person is skipped — this is what makes a repeated call
 * send nothing.
 *
 * What a push says: the actor's display name and the kind of act ("Alex commented on your post")
 * and, for a team post, the team's name. Never a comment's or a direct message's words, workout
 * numbers, photos or body data (CLAUDE.md's privacy rule). The only data attached is the in-app screen a tap opens.
 */
import { buildMessage, chunk, isDeviceNotRegistered, parseTickets, type ExpoMessage, type ExpoTicket } from './expoPush.ts';

/** The five kinds of event. */
export type NotifyEvent = 'follow' | 'comment' | 'vote' | 'team_push' | 'message';

/** The five per-person switches on `user_settings`, one per event. */
export interface NotifySwitches {
  notify_follows: boolean;
  notify_comments: boolean;
  notify_votes: boolean;
  notify_team_pushes: boolean;
  notify_messages: boolean;
}

/** Which switch governs which event. */
export const SWITCH_FOR_EVENT: Record<NotifyEvent, keyof NotifySwitches> = {
  follow: 'notify_follows',
  comment: 'notify_comments',
  vote: 'notify_votes',
  team_push: 'notify_team_pushes',
  message: 'notify_messages',
};

/** What a person with no settings row gets: every switch on (the columns' default). */
export const DEFAULT_SWITCHES: NotifySwitches = {
  notify_follows: true,
  notify_comments: true,
  notify_votes: true,
  notify_team_pushes: true,
  notify_messages: true,
};

/** What became of the notification for one recipient (the `notification_log.status` values). */
export type NotifyStatus =
  | 'sent'
  | 'send_failed'
  | 'no_tokens'
  | 'skipped_setting'
  | 'skipped_block'
  | 'skipped_mute'
  | 'skipped_self';

/** One phone that can receive pushes, and whose it is. */
export interface PushTokenRow {
  token: string;
  user_id: string;
}

/** The database and network access a call needs (server key; tests pass fakes). */
export interface NotifyDeps {
  /** Does this follow exist? */
  followExists(followerId: string, followeeId: string): Promise<boolean>;
  /** The comment's author and its post's author, or null if the comment is gone. */
  readComment(commentId: string): Promise<{ authorId: string; postId: string; postAuthorId: string } | null>;
  /** The vote's value and its post's author, or null if the vote is gone. */
  readVote(postId: string, voterId: string): Promise<{ value: number; postAuthorId: string } | null>;
  /** The team post's author, team and team name, or null if it is gone. */
  readTeamPost(postId: string): Promise<{ authorId: string; teamId: string; teamName: string } | null>;
  /**
   * The message's sender and its conversation's two members, or null if the message is gone.
   * Never the message's text — a push must not carry it, so the handler never reads it.
   */
  readMessage(messageId: string): Promise<{ senderId: string; memberIds: [string, string] } | null>;
  /** Every member of the team. */
  teamMemberIds(teamId: string): Promise<string[]>;
  /** The name to show for a lifter (display name, else username), or null if they have neither. */
  displayName(userId: string): Promise<string | null>;
  /** Each listed person's switches; a person with no settings row is left out. */
  readSwitches(userIds: readonly string[]): Promise<Map<string, NotifySwitches>>;
  /** Of the listed people, those with a block either way with `actorId`. */
  blockedWith(actorId: string, userIds: readonly string[]): Promise<Set<string>>;
  /** Of the listed people, those who have muted `actorId`. */
  mutedBy(actorId: string, userIds: readonly string[]): Promise<Set<string>>;
  /** The listed people's registered phones. */
  readTokens(userIds: readonly string[]): Promise<PushTokenRow[]>;
  /**
   * Writes the log row for one recipient unless one already exists for the same event, source
   * row and recipient. Returns true if this call wrote it (and so owns the notification).
   */
  claim(entry: { event: NotifyEvent; sourceKey: string; recipientId: string; actorId: string; status: NotifyStatus | 'sending' }): Promise<boolean>;
  /** Records how a claimed send ended, with Expo's tickets. */
  finish(entry: { event: NotifyEvent; sourceKey: string; recipientId: string; status: 'sent' | 'send_failed'; tickets: ExpoTicket[] }): Promise<void>;
  /** POSTs one batch (≤ 100) to Expo and returns the parsed JSON reply; throws on a network failure. */
  sendToExpo(messages: readonly ExpoMessage[]): Promise<unknown>;
  /** Forgets phones Expo says can no longer receive pushes. */
  deleteTokens(tokens: readonly string[]): Promise<void>;
}

/** A UUID in its usual text form. Every key in these tables is one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The call, once checked: which event, and the keys of the row that caused it. */
export type NotifyRequest =
  | { event: 'follow'; followerId: string; followeeId: string }
  | { event: 'comment'; commentId: string }
  | { event: 'vote'; postId: string; voterId: string }
  | { event: 'team_push'; teamPostId: string }
  | { event: 'message'; messageId: string };

/** Reads a uuid out of `keys[name]`, or null. */
function uuidKey(keys: Record<string, unknown>, name: string): string | null {
  const value = keys[name];
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

/**
 * Checks the call's shape: a known event with the uuid keys that event needs. Anything else is
 * null (and ignored). Extra fields are ignored — nothing in the call is used except these keys.
 */
export function parseNotifyRequest(body: unknown): NotifyRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { event, keys } = body as { event?: unknown; keys?: unknown };
  if (typeof keys !== 'object' || keys === null) return null;
  const k = keys as Record<string, unknown>;
  if (event === 'follow') {
    const followerId = uuidKey(k, 'follower_id');
    const followeeId = uuidKey(k, 'followee_id');
    return followerId && followeeId ? { event, followerId, followeeId } : null;
  }
  if (event === 'comment') {
    const commentId = uuidKey(k, 'id');
    return commentId ? { event, commentId } : null;
  }
  if (event === 'vote') {
    const postId = uuidKey(k, 'post_id');
    const voterId = uuidKey(k, 'user_id');
    return postId && voterId ? { event, postId, voterId } : null;
  }
  if (event === 'team_push') {
    const teamPostId = uuidKey(k, 'id');
    return teamPostId ? { event, teamPostId } : null;
  }
  if (event === 'message') {
    const messageId = uuidKey(k, 'id');
    return messageId ? { event, messageId } : null;
  }
  return null;
}

/** Everything about one event that doesn't depend on the recipient. */
interface ResolvedEvent {
  event: NotifyEvent;
  actorId: string;
  recipients: string[];
  sourceKey: string;
  path: string;
  title: string;
  /** The message body, given the actor's name. */
  body: (actorName: string) => string;
}

/**
 * Re-reads the row the call names and works out who did it, who should hear about it, what the
 * push says and which screen it opens. Null when the row is gone (deleted before the call ran,
 * or never existed) or isn't something we notify about (a downvote).
 */
async function resolveEvent(request: NotifyRequest, deps: NotifyDeps): Promise<ResolvedEvent | null> {
  switch (request.event) {
    case 'follow': {
      if (!(await deps.followExists(request.followerId, request.followeeId))) return null;
      return {
        event: 'follow',
        actorId: request.followerId,
        recipients: [request.followeeId],
        sourceKey: `${request.followerId}:${request.followeeId}`,
        path: `/profile/${request.followerId}`,
        title: 'New follower',
        body: (name) => `${name} started following you`,
      };
    }
    case 'comment': {
      const comment = await deps.readComment(request.commentId);
      if (!comment) return null;
      return {
        event: 'comment',
        actorId: comment.authorId,
        recipients: [comment.postAuthorId],
        sourceKey: request.commentId,
        path: `/post-comments/${comment.postId}`,
        title: 'New comment',
        body: (name) => `${name} commented on your post`,
      };
    }
    case 'vote': {
      const vote = await deps.readVote(request.postId, request.voterId);
      // Upvotes only (plan decision 4); the trigger already filters, this re-checks the true row.
      if (!vote || vote.value !== 1) return null;
      return {
        event: 'vote',
        actorId: request.voterId,
        recipients: [vote.postAuthorId],
        sourceKey: `${request.postId}:${request.voterId}`,
        path: `/post-comments/${request.postId}`,
        title: 'New upvote',
        body: (name) => `${name} upvoted your post`,
      };
    }
    case 'team_push': {
      const post = await deps.readTeamPost(request.teamPostId);
      if (!post) return null;
      const members = await deps.teamMemberIds(post.teamId);
      return {
        event: 'team_push',
        actorId: post.authorId,
        // Every member except the author (the author is never told about their own post).
        recipients: [...new Set(members)].filter((id) => id !== post.authorId),
        sourceKey: request.teamPostId,
        path: `/team/${post.teamId}`,
        title: post.teamName,
        body: (name) => `${name} posted to ${post.teamName}`,
      };
    }
    case 'message': {
      const message = await deps.readMessage(request.messageId);
      if (!message) return null;
      return {
        event: 'message',
        actorId: message.senderId,
        // The other member of the conversation (the sender is never told about their own message).
        recipients: message.memberIds.filter((id) => id !== message.senderId),
        sourceKey: request.messageId,
        // Threads are keyed by the OTHER lifter — for the recipient, that is the sender.
        path: `/messages/${message.senderId}`,
        title: 'New message',
        // The act only, never the words (plan decision 9; CLAUDE.md's privacy rule).
        body: (name) => `${name} sent you a message`,
      };
    }
  }
}

/** What one call did, per recipient (for tests and logs; the caller is never shown it). */
export type NotifyOutcome = Map<string, NotifyStatus>;

/**
 * Handles one call (see the file comment). Returns each recipient's outcome — only for the
 * recipients this call handled; ones already in the log are left out. Database failures are
 * thrown for index.ts to log.
 */
export async function handleNotifyRequest(body: unknown, deps: NotifyDeps): Promise<NotifyOutcome> {
  const outcome: NotifyOutcome = new Map();
  const request = parseNotifyRequest(body);
  if (!request) return outcome;
  const resolved = await resolveEvent(request, deps);
  if (!resolved || resolved.recipients.length === 0) return outcome;

  const { event, actorId, recipients, sourceKey } = resolved;
  const others = recipients.filter((id) => id !== actorId);
  const [switches, blocked, muted, tokens] = await Promise.all([
    deps.readSwitches(others),
    deps.blockedWith(actorId, others),
    deps.mutedBy(actorId, others),
    deps.readTokens(others),
  ]);
  const switchName = SWITCH_FOR_EVENT[event];

  // Decide each recipient's fate and claim their log row; only claimed "send" rows go out.
  const toSend = new Map<string, string[]>();
  for (const recipientId of recipients) {
    const theirTokens = tokens.filter((t) => t.user_id === recipientId).map((t) => t.token);
    let status: NotifyStatus | 'sending';
    if (recipientId === actorId) status = 'skipped_self';
    else if (blocked.has(recipientId)) status = 'skipped_block';
    else if (muted.has(recipientId)) status = 'skipped_mute';
    else if (!(switches.get(recipientId) ?? DEFAULT_SWITCHES)[switchName]) status = 'skipped_setting';
    else if (theirTokens.length === 0) status = 'no_tokens';
    else status = 'sending';

    if (!(await deps.claim({ event, sourceKey, recipientId, actorId, status }))) continue;
    if (status === 'sending') toSend.set(recipientId, theirTokens);
    else outcome.set(recipientId, status);
  }
  if (toSend.size === 0) return outcome;

  // One message per phone, sent in batches of at most 100.
  const actorName = (await deps.displayName(actorId))?.trim() || 'Someone';
  const text = resolved.body(actorName);
  const addressed: { recipientId: string; message: ExpoMessage }[] = [];
  for (const [recipientId, theirTokens] of toSend) {
    for (const token of theirTokens) addressed.push({ recipientId, message: buildMessage(token, resolved.title, text, resolved.path) });
  }

  const ticketsFor = new Map<string, ExpoTicket[]>();
  const deadTokens: string[] = [];
  for (const batch of chunk(addressed)) {
    let tickets: ExpoTicket[];
    try {
      tickets = parseTickets(await deps.sendToExpo(batch.map((a) => a.message)), batch.length);
    } catch (error) {
      console.warn('notify: Expo request failed', error);
      tickets = batch.map((): ExpoTicket => ({ status: 'error', message: 'Request to Expo failed' }));
    }
    batch.forEach((a, i) => {
      const list = ticketsFor.get(a.recipientId) ?? [];
      list.push(tickets[i]);
      ticketsFor.set(a.recipientId, list);
      if (isDeviceNotRegistered(tickets[i])) deadTokens.push(a.message.to);
    });
  }

  for (const [recipientId, tickets] of ticketsFor) {
    const status = tickets.some((t) => t.status === 'ok') ? 'sent' : 'send_failed';
    await deps.finish({ event, sourceKey, recipientId, status, tickets });
    outcome.set(recipientId, status);
  }
  if (deadTokens.length > 0) await deps.deleteTokens(deadTokens);
  return outcome;
}
