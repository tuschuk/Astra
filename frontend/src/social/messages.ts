/**
 * Direct messages (B48 — SOC-12): two lifters writing to each other.
 *
 * How a conversation is stored: one `conversations` row per PAIR of lifters, always written with
 * the smaller id first (`user_a < user_b`), so "my conversation with Bea" is one lookup and two
 * people can never end up with two threads. Messages hang off it. Both are server-only — a DM
 * exists to reach another person, which needs a connection — so nothing here touches the phone's
 * database (the settled posture for votes, comments and Teams; logging and the Tool Kit are
 * untouched and still work offline).
 *
 * Who may do what is decided entirely by the server's row-level security, never here:
 *   - only the two people in a conversation can read it or write in it;
 *   - a block either way hides the conversation from both and refuses every send;
 *   - STARTING a conversation also needs the recipient's "who can message you" setting to allow
 *     it (anyone, or mutual follows only) — `private.can_message` on the server.
 * The app only asks, and turns a refusal into one calm sentence that says nothing about why (a
 * blocked lifter learns nothing they wouldn't by trying).
 *
 * Every function takes the Supabase client as a parameter, so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { newUuid } from '@/lib/ids';
import { throwIfError } from '@/lib/throwIfError';

import type { PersonName } from './names';

/**
 * The longest message, in characters. Mirrors the CHECK on `messages.body` in
 * `…_direct_messages.sql` — change the two together.
 */
export const MESSAGE_MAX_LENGTH = 2000;

/** How many of the newest messages a thread reads at first, and how many more each "Show older" adds. */
export const THREAD_PAGE_SIZE = 50;

/** The one sentence for a refused start or send — a block or the recipient's setting alike. */
export const MESSAGE_REFUSED = 'You can’t message this lifter.';

/** Shown when the request didn't get through at all. */
export const MESSAGE_FAILED = 'That didn’t send. Check your connection and try again.';

/** Shown on the Messages screens when they can't load (most often: no signal). */
export const MESSAGES_OFFLINE = 'Messages need a connection. Logging workouts and the Tool Kit still work offline.';

/** Postgres's "duplicate key" code — the conversation for this pair already exists. */
const UNIQUE_VIOLATION = '23505';
/** Postgres's "refused by row-level security" code. */
const RLS_REFUSED = '42501';

/** The columns a message is read with. */
export const MESSAGE_SELECT = 'id,conversation_id,sender_id,body,created_at';

/**
 * The conversation list's one read (plan decision 12): both members' names and photos (two
 * foreign keys to profiles, so each embed names its key), and the single newest message.
 */
export const CONVERSATION_LIST_SELECT =
  'id,user_a,user_b,last_message_at,' +
  'a:profiles!conversations_user_a_fkey(id,username,display_name,avatar_url),' +
  'b:profiles!conversations_user_b_fkey(id,username,display_name,avatar_url),' +
  'messages(sender_id,body,created_at)';

/** One message in a thread. */
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

/** The other lifter in a conversation, as the list shows them. */
export interface ConversationPerson extends PersonName {
  id: string;
  /** Their photo's path in the avatars bucket, or null. */
  avatarPath: string | null;
}

/** One row of the conversation list. */
export interface ConversationSummary {
  id: string;
  other: ConversationPerson;
  /** The newest message, or null for a conversation that never got its first one (see decision 12). */
  last: Pick<Message, 'senderId' | 'body' | 'createdAt'> | null;
}

/** How a send went: the message as the server saved it (and its conversation), or a sentence. */
export type SendResult =
  | { ok: true; message: Message; conversationId: string }
  | { ok: false; message: string };

/** The two ids in the order the server stores a pair: smaller first. */
export function orderedPair(one: string, two: string): [string, string] {
  return one < two ? [one, two] : [two, one];
}

/**
 * A message's length as the server counts it: characters (code points), so an emoji counts once —
 * not JavaScript's `.length`, which counts most emoji twice. The composer's counter and the cap
 * both use this, so the phone and the server's CHECK always agree.
 */
export function messageLength(text: string): number {
  return [...text].length;
}

/**
 * What the composer would send, or null if there's nothing to send: the text with blank space
 * trimmed from both ends. Null for an empty or all-blank message and for one over
 * `MESSAGE_MAX_LENGTH` characters.
 */
export function messageToSend(text: string): string | null {
  const trimmed = text.trim();
  const length = messageLength(trimmed);
  if (length === 0 || length > MESSAGE_MAX_LENGTH) return null;
  return trimmed;
}

/** A message row from the server, in the app's shape. */
export function toMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderId: String(row.sender_id),
    body: String(row.body),
    createdAt: String(row.created_at),
  };
}

/**
 * May the signed-in lifter start a conversation with `target`? Asks the server
 * (`can_message_user`), which answers with the very rule it enforces — so the profile's Message
 * button shows exactly when a send would be accepted. Any failure answers false: the button is a
 * courtesy, and hiding it when unsure guesses nothing (the server would refuse a send anyway).
 */
export async function canMessageUser(client: SupabaseClient, target: string): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('can_message_user', { target });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Should a profile offer "Message"? Yes when the server would let `me` START a conversation with
 * `target` (`canMessageUser`), and also when the two already have a conversation `me` can see —
 * starting a thread is consent to it, so the other side may always reply even if their own
 * setting wouldn't let them start one (plan decision 2). A block hides the conversation, so it
 * answers no. Any failure answers no (hide rather than guess).
 */
export async function canOpenThread(client: SupabaseClient, me: string, target: string): Promise<boolean> {
  if (await canMessageUser(client, target)) return true;
  try {
    return (await conversationWith(client, me, target)) !== null;
  } catch {
    return false;
  }
}

/**
 * The id of `me`'s conversation with `other`, or null if there is none they can see (never
 * started, or hidden by a block). Throws when the read fails.
 */
export async function conversationWith(client: SupabaseClient, me: string, other: string): Promise<string | null> {
  const [userA, userB] = orderedPair(me, other);
  const { data, error } = await client
    .from('conversations')
    .select('id')
    .eq('user_a', userA)
    .eq('user_b', userB)
    .maybeSingle();
  throwIfError(error, 'Loading the conversation failed');
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * The conversation between `me` and `other`, starting it if it doesn't exist yet. Starting is
 * where the server checks blocks and the recipient's "who can message you" setting; a refusal
 * comes back as `MESSAGE_REFUSED`. If two first messages race (both phones start the thread at
 * once), the loser's insert hits the pair's unique key and simply re-reads the winner's row.
 */
export async function getOrCreateConversation(
  client: SupabaseClient,
  me: string,
  other: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const existing = await conversationWith(client, me, other);
    if (existing) return { ok: true, id: existing };
    const [userA, userB] = orderedPair(me, other);
    const id = newUuid();
    const { error } = await client.from('conversations').insert({ id, user_a: userA, user_b: userB });
    if (!error) return { ok: true, id };
    const code = (error as { code?: string }).code;
    if (code === RLS_REFUSED) return { ok: false, message: MESSAGE_REFUSED };
    if (code === UNIQUE_VIOLATION) {
      const winner = await conversationWith(client, me, other);
      // Exists but invisible: a block arrived between the two reads.
      return winner ? { ok: true, id: winner } : { ok: false, message: MESSAGE_REFUSED };
    }
    return { ok: false, message: MESSAGE_FAILED };
  } catch {
    return { ok: false, message: MESSAGE_FAILED };
  }
}

/**
 * Sends `text` from `me` to `other`. `conversationId` is the thread's id when one is already
 * open (null for the first message, which starts the conversation). The message id is made on
 * the phone (`id`, a fresh uuid by default) so the open thread can match the server's live echo
 * of it, and so a retried send can't land twice (the second insert hits the primary key).
 * Returns the saved message, or `MESSAGE_REFUSED` (blocked, or not allowed to start) /
 * `MESSAGE_FAILED` (no connection, or a blank/over-long text the server refused).
 */
export async function sendMessage(
  client: SupabaseClient,
  args: { me: string; other: string; conversationId: string | null; text: string; id?: string },
): Promise<SendResult> {
  const body = messageToSend(args.text);
  if (body === null) return { ok: false, message: MESSAGE_FAILED };
  let conversationId = args.conversationId;
  if (!conversationId) {
    const started = await getOrCreateConversation(client, args.me, args.other);
    if (!started.ok) return started;
    conversationId = started.id;
  }
  try {
    const { data, error } = await client
      .from('messages')
      .insert({ id: args.id ?? newUuid(), conversation_id: conversationId, sender_id: args.me, body })
      .select(MESSAGE_SELECT)
      .single();
    if (error) {
      const code = (error as { code?: string }).code;
      return { ok: false, message: code === RLS_REFUSED ? MESSAGE_REFUSED : MESSAGE_FAILED };
    }
    return { ok: true, message: toMessage(data as Record<string, unknown>), conversationId };
  } catch {
    return { ok: false, message: MESSAGE_FAILED };
  }
}

/**
 * The newest `limit` messages of a conversation, oldest first (the order a thread reads in), and
 * whether older ones exist beyond them. Reads one extra row to know that without a count. Throws
 * when the read fails.
 */
export async function listMessages(
  client: SupabaseClient,
  conversationId: string,
  limit: number = THREAD_PAGE_SIZE,
): Promise<{ messages: Message[]; hasOlder: boolean }> {
  const { data, error } = await client
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  throwIfError(error, 'Loading messages failed');
  const rows = (data ?? []) as Record<string, unknown>[];
  return { messages: rows.slice(0, limit).map(toMessage).reverse(), hasOlder: rows.length > limit };
}

/** A profiles embed row in the app's shape. */
function toPerson(row: Record<string, unknown> | null | undefined, fallbackId: string): ConversationPerson {
  return {
    id: row?.id ? String(row.id) : fallbackId,
    username: (row?.username as string | null | undefined) ?? null,
    displayName: (row?.display_name as string | null | undefined) ?? null,
    avatarPath: (row?.avatar_url as string | null | undefined) ?? null,
  };
}

/**
 * `me`'s conversations, newest activity first (conversations that never got a message last), each
 * with the other lifter and the newest message. One read (`CONVERSATION_LIST_SELECT`); a blocked
 * pair's conversation simply isn't returned. Throws when the read fails.
 */
export async function listConversations(client: SupabaseClient, me: string): Promise<ConversationSummary[]> {
  const { data, error } = await client
    .from('conversations')
    .select(CONVERSATION_LIST_SELECT)
    .or(`user_a.eq.${me},user_b.eq.${me}`)
    .order('created_at', { ascending: false, referencedTable: 'messages' })
    .limit(1, { referencedTable: 'messages' })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100);
  throwIfError(error, 'Loading conversations failed');
  // The select string is built from parts, so supabase-js can't type the rows; read them loosely.
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const iAmA = row.user_a === me;
    const otherId = String(iAmA ? row.user_b : row.user_a);
    const newest = ((row.messages as Record<string, unknown>[] | null) ?? [])[0];
    return {
      id: String(row.id),
      other: toPerson((iAmA ? row.b : row.a) as Record<string, unknown> | null, otherId),
      last: newest
        ? { senderId: String(newest.sender_id), body: String(newest.body), createdAt: String(newest.created_at) }
        : null,
    };
  });
}

/**
 * A message's text shortened for the conversation list's one-line preview: line breaks become
 * spaces and anything past `max` characters becomes "…".
 */
export function previewLine(body: string, max = 80): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
