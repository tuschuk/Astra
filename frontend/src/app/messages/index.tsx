/**
 * Messages — the lifter's direct-message conversations (B48 — SOC-12). Reached from the Messages
 * button in Home's header.
 *
 * What it shows: one row per conversation, the most recently active first — the other lifter's
 * photo (or letter) and name, the newest message on one line ("You: …" when it was the viewer's),
 * and when it was sent. A conversation that never got its first message shows "No messages yet"
 * and sorts last. With no conversations, a line explains how to start one (Message on a lifter's
 * profile).
 *
 * What the user can do: tap a row to open that thread. The list re-reads each time the screen
 * comes into view (new messages arrive live inside an open thread, not here — plan decision 8).
 * Conversations with someone either side has blocked never appear (the server hides them).
 *
 * Online only, like every social surface: with no connection, the standing connection message
 * and Retry.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/social/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading } from '@/components/ui/Text';
import { getSupabase } from '@/lib/supabase';
import { listConversations, MESSAGES_OFFLINE, previewLine, type ConversationSummary } from '@/social/messages';
import { personLabels } from '@/social/names';
import { colors, layout, spacing } from '@/theme';
import { postDateLabel } from '@/workout/format';

/** Shown when the lifter has no conversations yet. */
export const NO_CONVERSATIONS = 'No messages yet. Open a lifter’s profile and tap Message to start a conversation.';

/** What the list is showing. */
type ListState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; conversations: ConversationSummary[] };

export default function MessagesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);
  const [state, setState] = useState<ListState>({ status: 'loading' });

  /**
   * Reads the list. A failed re-read keeps the list already on screen. Returns a cleanup that
   * makes a late answer (after the screen lost focus) change nothing.
   */
  const load = useCallback(() => {
    if (!me) return undefined;
    let current = true;
    listConversations(client, me)
      .then((conversations) => {
        if (current) setState({ status: 'ready', conversations });
      })
      .catch((error: unknown) => {
        console.warn('Messages: could not load', error);
        if (current) setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
      });
    return () => {
      current = false;
    };
  }, [client, me]);

  // Read on every focus.
  useFocusEffect(load);

  /** Back to Home, or the Home tab if there is nothing to go back to. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>Messages</Heading>

      {state.status === 'loading' ? <Body variant="muted">Loading messages…</Body> : null}
      {state.status === 'error' ? (
        <EmptyState
          icon="cloud-offline-outline"
          message={MESSAGES_OFFLINE}
          actionLabel="Retry"
          onAction={() => {
            setState({ status: 'loading' });
            load();
          }}
        />
      ) : null}
      {state.status === 'ready' && state.conversations.length === 0 ? (
        <EmptyState icon="chatbubbles-outline" message={NO_CONVERSATIONS} />
      ) : null}
      {state.status === 'ready' ? (
        <View style={styles.list}>
          {state.conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              me={me}
              onPress={() => router.push({ pathname: '/messages/[userId]', params: { userId: conversation.other.id } })}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

/** One conversation: who, the newest line, and when. Tapping opens the thread. */
function ConversationRow({
  conversation,
  me,
  onPress,
}: {
  conversation: ConversationSummary;
  me: string | null;
  onPress: () => void;
}) {
  const who = personLabels(conversation.other);
  const last = conversation.last;
  const preview = last ? `${last.senderId === me ? 'You: ' : ''}${previewLine(last.body)}` : 'No messages yet';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${who.name}. ${preview}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID="conversation-row"
    >
      <Avatar path={conversation.other.avatarPath} initial={who.initial} />
      <View style={styles.rowText}>
        <Body style={styles.name}>{who.name}</Body>
        <Body variant="small">{preview}</Body>
      </View>
      {last ? <Body variant="small">{postDateLabel(last.createdAt)}</Body> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  list: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
});
