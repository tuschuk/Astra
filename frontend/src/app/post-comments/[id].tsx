/**
 * Comments — one post's conversation (SOC-5, B23). Reached from the comments button on a feed
 * card ("3 comments" / "Comment").
 *
 * What it shows: the post's comments oldest first, each with who wrote it (a letter avatar,
 * display name, @username), when ("Today", "Yesterday" or the date) and what they said. If a
 * post has more comments than one load brings back (200), a line says so. Below the list, a box
 * to write a comment.
 *
 * What the user can do: read everyone's comments and add their own — up to 500 characters; a
 * counter appears near the limit, and Send stays off while the box is blank, too long, or a
 * comment is on its way. The new comment appears as the server saved it. Back returns to Home.
 *
 * Comments are read and written on the server (never stored on the phone), so with no
 * connection the screen says so and offers Retry. Who may see or comment on which post is the
 * server's security's call — exactly the people who can see the post.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { LetterAvatar } from '@/components/social/LetterAvatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { getSupabase } from '@/lib/supabase';
import { COMMENT_COUNTER_FROM, COMMENT_MAX_CHARS, COMMENT_TOO_LONG, commentBodyError } from '@/social/commentLimits';
import { addComment, loadComments, type PostComment } from '@/social/comments';
import { personLabels } from '@/social/names';
import { colors, spacing } from '@/theme';
import { postDateLabel } from '@/workout/format';

/** The line shown when a post has more comments than one load brings back. */
export const MORE_COMMENTS_LINE = 'More comments exist than are shown here.';

/** The line shown when sending a comment failed. */
export const SEND_FAILED_LINE = 'Your comment didn’t send. Check your connection and try again.';

/** What the screen is showing: the first load, a failed load, or the comments. */
type CommentsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; comments: PostComment[]; more: boolean };

export default function PostCommentsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = typeof id === 'string' ? id : '';
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const client = useMemo(() => getSupabase(), []);

  const [state, setState] = useState<CommentsState>({ status: 'loading' });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  // Bumped by Retry to load again.
  const [attempt, setAttempt] = useState(0);

  // Load the post's comments on open and on each Retry. An answer arriving after the screen
  // closed (or after a newer load started) is ignored.
  useEffect(() => {
    let current = true;
    loadComments(client, postId)
      .then((page) => {
        if (current) setState({ status: 'ready', comments: page.comments, more: page.more });
      })
      .catch((error: unknown) => {
        console.warn('Comments: could not be loaded', error);
        if (current) setState({ status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [client, postId, attempt]);

  const problem = commentBodyError(draft);
  const length = [...draft].length;
  const canSend = me != null && state.status === 'ready' && problem == null && !sending;

  /** Sends the draft; on success shows the server's saved comment at the end and clears the box. */
  async function send(): Promise<void> {
    if (!canSend || !me) return;
    setSending(true);
    setSendFailed(false);
    try {
      const saved = await addComment(client, me, postId, draft);
      setState((prev) => (prev.status === 'ready' ? { ...prev, comments: [...prev.comments, saved] } : prev));
      setDraft('');
    } catch (error: unknown) {
      console.warn('Comments: sending failed', error);
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  }

  /** Back to Home, or to the Home tab if there is nothing to go back to. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
      <Heading>Comments</Heading>

      {state.status === 'loading' ? <Body variant="muted">Loading comments…</Body> : null}
      {state.status === 'error' ? (
        <EmptyState
          icon="cloud-offline-outline"
          message="Comments need a connection. Logging workouts and the Tool Kit still work offline."
          actionLabel="Retry"
          onAction={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        />
      ) : null}

      {state.status === 'ready' ? (
        <>
          <View style={styles.list}>
            {state.comments.length === 0 ? <Body variant="muted">No comments yet. Start the conversation.</Body> : null}
            {state.comments.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
            {state.more ? <Body variant="small">{MORE_COMMENTS_LINE}</Body> : null}
          </View>

          <TextField
            label="Write a comment"
            placeholder="Say something to the lifter"
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              setSendFailed(false);
            }}
            // No `maxLength`: the box would count emoji as two (UTF-16) while the server counts
            // them once, cutting comments short. The counter and the refusal line guide instead.
            multiline
            style={styles.composer}
          />
          {length >= COMMENT_COUNTER_FROM ? (
            <Body variant="small">{`${length} / ${COMMENT_MAX_CHARS}`}</Body>
          ) : null}
          {/* Blank is shown by Send being off; only "too long" needs saying. */}
          {problem === COMMENT_TOO_LONG ? <Body variant="small" style={styles.problem}>{problem}</Body> : null}
          {sendFailed ? <Body variant="small" style={styles.problem}>{SEND_FAILED_LINE}</Body> : null}
          <Button label={sending ? 'Sending…' : 'Send'} onPress={() => void send()} disabled={!canSend} style={styles.send} />
        </>
      ) : null}
    </Screen>
  );
}

/** One comment: who wrote it and when, then what they said. */
function CommentRow({ comment }: { comment: PostComment }) {
  const who = personLabels(comment.author);
  return (
    <View style={styles.row} testID="comment-row">
      <LetterAvatar initial={who.initial} />
      <View style={styles.rowText}>
        <Body style={styles.name}>{who.name}</Body>
        <Body variant="small">{[who.handle, postDateLabel(comment.createdAt)].filter(Boolean).join(' · ')}</Body>
        <Body style={styles.body}>{comment.body}</Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  list: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.text,
  },
  body: {
    marginTop: spacing.xs,
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
