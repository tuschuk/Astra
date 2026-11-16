/**
 * The state of one open direct-message thread (B48 — SOC-12): the messages on screen, whether
 * older ones exist, sending, and — the step's definition of done — new messages arriving live.
 *
 * What it does:
 *   1. Loads: finds the conversation with `other` (the thread is keyed by the other lifter, so a
 *      push or a profile button can open it with just their id). None yet → an empty thread; the
 *      first send starts the conversation.
 *   2. Listens: once the conversation's id is known, subscribes to Supabase Realtime for new rows
 *      in `messages` with that `conversation_id`. The server re-checks its row-level security for
 *      each listener, so only the two members hear, and a block stops delivery. The subscription
 *      is removed when the screen closes (or the conversation changes).
 *   3. Sends: the message gets its id on the phone, so the server's live echo of our own message
 *      (Realtime delivers it to the sender too) is recognised and not shown twice.
 *   4. Re-reads on `reload()` (the screen calls it when it comes back into view) — belt and
 *      braces for a live event missed while the phone slept (plan risk 1).
 *
 * Inputs: the Supabase client (tests pass a fake), the signed-in lifter, the other lifter.
 * Output: the thread state and the actions the screen needs.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { newUuid } from '@/lib/ids';

import { conversationWith, listMessages, sendMessage, THREAD_PAGE_SIZE, toMessage, type Message } from './messages';

/** Where the thread's first load stands. */
export type ThreadStatus = 'loading' | 'ready' | 'error';

/** What `useThread` hands the screen. */
export interface ThreadState {
  status: ThreadStatus;
  /** The conversation's id, or null before the first message is ever sent. */
  conversationId: string | null;
  /** Oldest first. */
  messages: Message[];
  hasOlder: boolean;
  sending: boolean;
  /** The last send's failure sentence, or null. */
  sendError: string | null;
  /** Sends `text`; true when it landed. */
  send: (text: string) => Promise<boolean>;
  /** Reads THREAD_PAGE_SIZE more older messages. */
  showOlder: () => Promise<void>;
  /** Re-reads the thread (keeping what's on screen if the read fails). */
  reload: () => Promise<void>;
}

/** The exact Realtime subscription for one conversation's new messages. */
export function threadChannelFilter(conversationId: string) {
  return { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` } as const;
}

/**
 * Adds messages to a thread, skipping any whose id is already there (our own send arriving
 * again over Realtime), and keeps the thread oldest first.
 */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const seen = new Set(current.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id) && seen.add(m.id));
  if (fresh.length === 0) return current as Message[];
  return [...current, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** One read of the thread: the conversation (null if none yet) and its newest messages, or a failure. */
type ThreadRead = { ok: true; conversationId: string | null; messages: Message[]; hasOlder: boolean } | { ok: false };

/**
 * Reads the thread between `me` and `other`: finds their conversation, then its newest `limit`
 * messages. Never throws — a failure comes back as `{ ok: false }` (and is logged).
 */
async function readThread(client: SupabaseClient, me: string, other: string, limit: number): Promise<ThreadRead> {
  try {
    const id = await conversationWith(client, me, other);
    if (!id) return { ok: true, conversationId: null, messages: [], hasOlder: false };
    const page = await listMessages(client, id, limit);
    return { ok: true, conversationId: id, messages: page.messages, hasOlder: page.hasOlder };
  } catch (error: unknown) {
    console.warn('Thread: could not load', error);
    return { ok: false };
  }
}

/**
 * One open thread between `me` and `other` (see the file comment for the four things it does).
 * Starts in 'loading'; becomes 'ready' after the first read (an empty thread if they have never
 * messaged) or 'error' if that read fails. Later failures keep what's on screen.
 */
export function useThread(client: SupabaseClient, me: string, other: string): ThreadState {
  const [status, setStatus] = useState<ThreadStatus>('loading');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // How many messages the thread reads — grows by a page per "Show older" (the B30 pattern).
  const limit = useRef(THREAD_PAGE_SIZE);
  const live = useRef(true);
  // The first load decides between the spinner and the error; later reloads keep the screen.
  const loaded = useRef(false);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /** Shows a finished read (or its failure) — called only from a read's promise callback. */
  const apply = useCallback((read: ThreadRead) => {
    if (!live.current) return;
    if (!read.ok) {
      // A failed first load is the error screen; a failed re-read keeps what's on screen.
      if (!loaded.current) setStatus('error');
      return;
    }
    const id = read.conversationId;
    setConversationId(id);
    // Keep anything that arrived live while the read was in flight.
    setMessages((current) => (id ? mergeMessages(read.messages, current.filter((m) => m.conversationId === id)) : []));
    setHasOlder(read.hasOlder);
    loaded.current = true;
    setStatus('ready');
  }, []);

  const reload = useCallback(() => readThread(client, me, other, limit.current).then(apply), [client, me, other, apply]);

  // The first load (status starts at 'loading'). A screen shows one thread for its whole life, so
  // this only runs again if the signed-in lifter or the other lifter changes.
  useEffect(() => {
    loaded.current = false;
    limit.current = THREAD_PAGE_SIZE;
    void readThread(client, me, other, limit.current).then(apply);
  }, [client, me, other, apply]);

  // Listen for new messages in this conversation while the thread is open.
  useEffect(() => {
    if (!conversationId) return;
    const channel = client
      .channel(`messages:${conversationId}`)
      .on('postgres_changes', threadChannelFilter(conversationId), (payload: { new: Record<string, unknown> }) => {
        if (!live.current) return;
        setMessages((current) => mergeMessages(current, [toMessage(payload.new)]));
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [client, conversationId]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      setSending(true);
      setSendError(null);
      const result = await sendMessage(client, { me, other, conversationId, text, id: newUuid() });
      if (!live.current) return result.ok;
      setSending(false);
      if (!result.ok) {
        setSendError(result.message);
        return false;
      }
      setConversationId(result.conversationId);
      setMessages((current) => mergeMessages(current, [result.message]));
      return true;
    },
    [client, me, other, conversationId],
  );

  const showOlder = useCallback(async () => {
    limit.current += THREAD_PAGE_SIZE;
    await reload();
  }, [reload]);

  return { status, conversationId, messages, hasOlder, sending, sendError, send, showOlder, reload };
}
