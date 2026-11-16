/**
 * A direct-message thread with one other lifter (B48 — SOC-12). Reached from "Message" on their
 * profile, from a row of the Messages list, or by tapping a "sent you a message" push. The route
 * is the OTHER lifter's id, so every door needs only that.
 *
 * What it shows: the other lifter's name at the top, then the messages oldest first — theirs on
 * the left, the viewer's own on the right, each with its time — scrolled so the newest is in view
 * (on open, after a send, and when one arrives live). "Show older messages" sits at the top when
 * there are more than the newest 50. A thread that has never had a message says "Say hello".
 * Below, a box to write a message (up to 2000 characters, counted as the server counts them — a
 * counter appears near the limit, and a line says so past it) and Send.
 *
 * What the user can do: read the thread and send messages. New messages from the other lifter
 * appear on their own while the thread is open (Supabase Realtime — `social/useThread.ts`); the
 * thread also re-reads when it comes back into view. If the server refuses a send — the other
 * lifter's "who can message you" setting, or a block either way — one calm line says "You can't
 * message this lifter." and says nothing about why.
 *
 * Messages live only on the server (never on the phone), so with no connection the thread shows
 * the standing connection message with Retry. Logging and the Tool Kit are unaffected.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { getSupabase } from '@/lib/supabase';
import { MESSAGE_MAX_LENGTH, messageLength, MESSAGES_OFFLINE, messageToSend, type Message } from '@/social/messages';
import { personLabels } from '@/social/names';
import { loadProfileRow } from '@/social/profile';
import { useThread } from '@/social/useThread';
import { colors, radii, spacing } from '@/theme';
import { postDateLabel } from '@/workout/format';

/** The empty thread's line. */
export const SAY_HELLO = 'No messages yet. Say hello.';

/** The character count appears once a message gets this long. */
export const MESSAGE_COUNTER_FROM = MESSAGE_MAX_LENGTH - 200;

/** Shown (with Send off) when the draft is over the cap. */
export const MESSAGE_TOO_LONG = `Messages can be up to ${MESSAGE_MAX_LENGTH} characters.`;

/** "Today 14:05" style time for a message. */
function messageTime(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${postDateLabel(iso)} ${hh}:${mm}`;
}

export default function MessageThreadScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const other = typeof userId === 'string' ? userId : '';
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const client = useMemo(() => getSupabase(), []);
  const thread = useThread(client, me, other);
  const [draft, setDraft] = useState('');
  const [name, setName] = useState<string | null>(null);

  // The other lifter's name for the heading (a failed read keeps the plain "Messages" title).
  useEffect(() => {
    let current = true;
    loadProfileRow(client, other)
      .then((row) => {
        if (current && row) setName(personLabels(row).name);
      })
      .catch((error: unknown) => console.warn('Thread: could not read the name', error));
    return () => {
      current = false;
    };
  }, [client, other]);

  // Re-read when the screen comes back into view (a message missed while the phone slept). Not
  // on the first focus — the thread's own first load is already running then.
  const { reload } = thread;
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) void reload();
      focusedBefore.current = true;
    }, [reload]),
  );

  const length = messageLength(draft);
  const canSend = me !== '' && thread.status === 'ready' && messageToSend(draft) !== null && !thread.sending;
  // The thread scrolls itself to the newest message: on open, on a send, on a live arrival.
  const listRef = useRef<ComponentRef<typeof ScrollView>>(null);

  /** Sends the draft; clears the box once the server saved it. */
  async function submit(): Promise<void> {
    if (!canSend) return;
    if (await thread.send(draft)) setDraft('');
  }

  /** Back to wherever the thread was opened from, or the Messages list. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/messages');
  }

  return (
    <Screen scroll={false}>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>{name ?? 'Messages'}</Heading>

      {thread.status === 'loading' ? <Body variant="muted">Loading messages…</Body> : null}
      {thread.status === 'error' ? (
        <EmptyState icon="cloud-offline-outline" message={MESSAGES_OFFLINE} actionLabel="Retry" onAction={() => void thread.reload()} />
      ) : null}

      {thread.status === 'ready' ? (
        <>
          <ScrollView
            ref={listRef}
            style={styles.scroller}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            // Newest at the bottom, in view — whenever the content grows.
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            testID="thread-list"
          >
            {thread.hasOlder ? (
              <Button label="Show older messages" variant="ghost" onPress={() => void thread.showOlder()} />
            ) : null}
            {thread.messages.length === 0 ? <Body variant="muted">{SAY_HELLO}</Body> : null}
            {thread.messages.map((message) => (
              <MessageBubble key={message.id} message={message} mine={message.senderId === me} />
            ))}
          </ScrollView>

          <TextField
            label="Write a message"
            placeholder="Message"
            value={draft}
            onChangeText={setDraft}
            // No `maxLength`: the box would count emoji as two (UTF-16) while the server counts
            // them once. The counter and the "too long" line guide instead (the comments rule).
            multiline
            style={styles.composer}
          />
          {length >= MESSAGE_COUNTER_FROM ? <Body variant="small">{`${length} / ${MESSAGE_MAX_LENGTH}`}</Body> : null}
          {length > MESSAGE_MAX_LENGTH ? (
            <Body variant="small" style={styles.problem}>
              {MESSAGE_TOO_LONG}
            </Body>
          ) : null}
          {thread.sendError ? (
            <Body variant="small" style={styles.problem}>
              {thread.sendError}
            </Body>
          ) : null}
          <Button
            label={thread.sending ? 'Sending…' : 'Send'}
            onPress={() => void submit()}
            disabled={!canSend}
            style={styles.send}
          />
        </>
      ) : null}
    </Screen>
  );
}

/** One message: the viewer's own on the right in the accent tint, the other lifter's on the left. */
function MessageBubble({ message, mine }: { message: Message; mine: boolean }) {
  return (
    <View
      style={[styles.bubble, mine ? styles.mine : styles.theirs]}
      testID={mine ? 'message-mine' : 'message-theirs'}
      accessible
      accessibilityLabel={`${mine ? 'You' : 'They'} said: ${message.body}. ${messageTime(message.createdAt)}`}
    >
      <Body style={styles.bubbleText}>{message.body}</Body>
      <Body variant="small" style={styles.time}>
        {messageTime(message.createdAt)}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  scroller: {
    flex: 1,
    marginTop: spacing.lg,
  },
  list: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 2,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accentDim,
    borderColor: colors.accentBorder,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceDeep,
    borderColor: colors.borderStrong,
  },
  bubbleText: {
    color: colors.text,
  },
  time: {
    color: colors.muted,
  },
  composer: {
    marginTop: spacing.xl,
  },
  problem: {
    color: colors.muted,
  },
  send: {
    marginTop: spacing.md,
  },
});
