/**
 * CommentsPane — one conversation: the comments, then a box to add one. Lifted out of the post
 * Comments screen (B23) in B41 so a Marketplace program's comments work exactly as a post's —
 * one copy of the composer rules, never two.
 *
 * What it shows: the comments oldest first, each with who wrote it (a letter avatar, display
 * name, @username), when ("Today", "Yesterday" or the date) and what they said. If there are more
 * than one load brings back (200), a line says so. Below the list, a box to write a comment.
 * While loading, a short line; if the load fails, the "needs a connection" message with Retry.
 *
 * What the user can do: read everyone's comments and add their own — up to 500 characters; a
 * counter appears near the limit, and Send stays off while the box is blank, too long, nobody is
 * signed in, or a comment is on its way. The new comment appears as the server saved it. With
 * `onReport` (post comments, B27), each of OTHER people's comments has a ⋯ that calls it.
 *
 * Inputs: `load` (reads the conversation — throws on failure), `send` (adds one and returns the
 * saved comment — throws on failure), `me` (the signed-in lifter, or null), and optional
 * `onReport`. The screen around it owns the heading, Back, and any report panel.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { LetterAvatar } from '@/components/social/LetterAvatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { COMMENT_COUNTER_FROM, COMMENT_MAX_CHARS, COMMENT_TOO_LONG, commentBodyError } from '@/social/commentLimits';
import type { CommentsPage, PostComment } from '@/social/comments';
import { personLabels } from '@/social/names';
import { colors, spacing } from '@/theme';
import { postDateLabel } from '@/workout/format';

/** The line shown when a conversation has more comments than one load brings back. */
export const MORE_COMMENTS_LINE = 'More comments exist than are shown here.';

/** The line shown when sending a comment failed. */
export const SEND_FAILED_LINE = 'Your comment didn’t send. Check your connection and try again.';

/** The line shown when the comments can't be read. */
export const COMMENTS_OFFLINE = 'Comments need a connection. Logging workouts and the Tool Kit still work offline.';

/** What the pane is showing: the first load, a failed load, or the comments. */
type CommentsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; comments: PostComment[]; more: boolean };

export interface CommentsPaneProps {
  /** Reads the conversation. Called on open and on Retry; a change of function reads again. */
  load: () => Promise<CommentsPage>;
  /** Adds the typed comment and returns it as the server saved it. */
  send: (body: string) => Promise<PostComment>;
  /** The signed-in lifter's id (null: nothing can be sent, nothing reported). */
  me: string | null;
  /** (Post comments) Opens the report panel for someone else's comment. */
  onReport?: (comment: PostComment) => void;
  /** The composer's placeholder. */
  placeholder?: string;
}

export function CommentsPane({ load, send, me, onReport, placeholder = 'Say something to the lifter' }: CommentsPaneProps) {
  const [state, setState] = useState<CommentsState>({ status: 'loading' });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  // Bumped by Retry to load again.
  const [attempt, setAttempt] = useState(0);

  // Load on open and on each Retry. An answer arriving after the pane closed (or after a newer
  // load started) is ignored.
  useEffect(() => {
    let current = true;
    load()
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
  }, [load, attempt]);

  const problem = commentBodyError(draft);
  const length = [...draft].length;
  const canSend = me != null && state.status === 'ready' && problem == null && !sending;

  /** Sends the draft; on success shows the server's saved comment at the end and clears the box. */
  async function submit(): Promise<void> {
    if (!canSend) return;
    setSending(true);
    setSendFailed(false);
    try {
      const saved = await send(draft);
      setState((prev) => (prev.status === 'ready' ? { ...prev, comments: [...prev.comments, saved] } : prev));
      setDraft('');
    } catch (error: unknown) {
      console.warn('Comments: sending failed', error);
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  }

  if (state.status === 'loading') return <Body variant="muted">Loading comments…</Body>;
  if (state.status === 'error') {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        message={COMMENTS_OFFLINE}
        actionLabel="Retry"
        onAction={() => {
          setState({ status: 'loading' });
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  return (
    <>
      <View style={styles.list}>
        {state.comments.length === 0 ? <Body variant="muted">No comments yet. Start the conversation.</Body> : null}
        {state.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            onReport={onReport && me != null && comment.author.id !== me ? () => onReport(comment) : undefined}
          />
        ))}
        {state.more ? <Body variant="small">{MORE_COMMENTS_LINE}</Body> : null}
      </View>

      <TextField
        label="Write a comment"
        placeholder={placeholder}
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
      {length >= COMMENT_COUNTER_FROM ? <Body variant="small">{`${length} / ${COMMENT_MAX_CHARS}`}</Body> : null}
      {/* Blank is shown by Send being off; only "too long" needs saying. */}
      {problem === COMMENT_TOO_LONG ? (
        <Body variant="small" style={styles.problem}>
          {problem}
        </Body>
      ) : null}
      {sendFailed ? (
        <Body variant="small" style={styles.problem}>
          {SEND_FAILED_LINE}
        </Body>
      ) : null}
      <Button label={sending ? 'Sending…' : 'Send'} onPress={() => void submit()} disabled={!canSend} style={styles.send} />
    </>
  );
}

/**
 * One comment: who wrote it and when, then what they said. With `onReport` — given only for
 * other people's comments — a ⋯ button at the end of the row opens the report panel.
 */
function CommentRow({ comment, onReport }: { comment: PostComment; onReport?: () => void }) {
  const who = personLabels(comment.author);
  return (
    <View style={styles.row} testID="comment-row">
      <LetterAvatar initial={who.initial} />
      <View style={styles.rowText}>
        <Body style={styles.name}>{who.name}</Body>
        <Body variant="small">{[who.handle, postDateLabel(comment.createdAt)].filter(Boolean).join(' · ')}</Body>
        <Body style={styles.body}>{comment.body}</Body>
      </View>
      {onReport ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Report ${who.name}’s comment`} onPress={onReport} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
