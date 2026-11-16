/**
 * VoteControl — the up / down arrows around a net score (B23's feed-card arrows, lifted out in
 * B41 so a Marketplace program page votes exactly as a post does — one copy, never two).
 *
 * What it shows: an upvote arrow, the score (ups minus downs), and a downvote arrow — unless
 * `showDownvote` is false (a Physique Check post takes upvotes only). The arrow matching the
 * viewer's own vote is lit.
 *
 * What the user can do: tap an arrow to vote, tap the lit one again to take the vote back, tap the
 * other to switch. The score moves at once ("optimistic") and moves back, with a short message,
 * if the server refuses. Without an `onVote` handler (tests, or nobody signed in) it only shows.
 *
 * Three pieces, so the post card can keep its own layout:
 *   - `useOptimisticVote` — the shown vote and score, the tap logic, and the refusal message;
 *   - `VoteArrows` — the arrows-and-score row, drawn from that state;
 *   - `VoteControl` — both together with the message under them (the program page uses this).
 */
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Body } from '@/components/ui/Text';
import { nextVote, VOTE_REFUSAL_MESSAGES, voteDelta, type VoteResult, type VoteValue } from '@/social/votes';
import { colors, spacing } from '@/theme';

/** Sends a vote change to the server: the new vote, or null to take it back. */
export type SendVote = (next: VoteValue | null) => Promise<VoteResult>;

/** What `useOptimisticVote` hands back: what to show, and what an arrow tap does. */
export interface OptimisticVote {
  vote: VoteValue | null;
  score: number;
  /** The refusal sentence from the last tap, or null. */
  message: string | null;
  /** An arrow was tapped. Does nothing without an `onVote` handler or while a vote is on its way. */
  tap: (tapped: VoteValue) => Promise<void>;
}

/**
 * The shown vote and score, held locally so a tap shows at once: the score moves by `voteDelta`,
 * the vote is sent through `onVote`, and if the server refuses, both go back and the reason shows.
 * Inputs: the server's `score` and the viewer's `myVote` (a fresh load with new values resets the
 * shown numbers to them — the server's tally is always the truth), and the sender.
 */
export function useOptimisticVote({
  score: serverScore,
  myVote,
  onVote,
}: {
  score: number;
  myVote: VoteValue | null;
  onVote?: SendVote;
}): OptimisticVote {
  const [vote, setVote] = useState<VoteValue | null>(myVote);
  const [score, setScore] = useState(serverScore);
  const [message, setMessage] = useState<string | null>(null);
  // A ref, not state: two taps before the next draw must still send only one vote at a time.
  const sending = useRef(false);

  // A refreshed load brings new server numbers: show those (React's "adjust state when a prop
  // changes" pattern — compared during render, no effect).
  const [server, setServer] = useState({ vote: myVote, score: serverScore });
  if (server.vote !== myVote || server.score !== serverScore) {
    setServer({ vote: myVote, score: serverScore });
    setVote(myVote);
    setScore(serverScore);
  }

  /**
   * One arrow tapped: move the score now, send the vote, undo it if refused. The undo takes the
   * same step back (−delta) rather than restoring a snapshot, so a refresh that landed while the
   * vote was in flight isn't overwritten with older numbers.
   */
  async function tap(tapped: VoteValue): Promise<void> {
    if (!onVote || sending.current) return;
    const before = vote;
    const after = nextVote(before, tapped);
    const delta = voteDelta(before, after);
    setVote(after);
    setScore((s) => s + delta);
    setMessage(null);
    sending.current = true;
    let result: VoteResult;
    try {
      result = await onVote(after);
    } catch {
      // Today's senders never throw, but if one ever did the arrows must not lock for good.
      result = { ok: false, reason: 'failed' };
    } finally {
      sending.current = false;
    }
    if (!result.ok) {
      setVote((v) => (v === after ? before : v));
      setScore((s) => s - delta);
      setMessage(VOTE_REFUSAL_MESSAGES[result.reason]);
    }
  }

  return { vote, score, message, tap };
}

/**
 * The arrows around the score, drawn from a `useOptimisticVote` state. `enabled` false draws them
 * untappable; `scoreTestID` lets each screen's tests find its score.
 */
export function VoteArrows({
  state,
  showDownvote,
  enabled,
  scoreTestID = 'vote-score',
}: {
  state: OptimisticVote;
  showDownvote: boolean;
  enabled: boolean;
  scoreTestID?: string;
}) {
  const { vote, score, tap } = state;
  return (
    <View style={styles.votes}>
      <VoteArrow direction="up" lit={vote === 1} onPress={enabled ? () => void tap(1) : undefined} />
      <View accessible accessibilityLabel={`Score ${score}`} testID={scoreTestID}>
        <Body style={styles.score}>{String(score)}</Body>
      </View>
      {/* No downvote control at all when downvotes aren't taken (an upvote-only post). */}
      {showDownvote ? <VoteArrow direction="down" lit={vote === -1} onPress={enabled ? () => void tap(-1) : undefined} /> : null}
    </View>
  );
}

/**
 * The whole control — arrows, score, and the refusal message under them. Inputs: the server's
 * `score`, the viewer's `myVote`, whether a downvote arrow shows, and the sender (none = display only).
 */
export function VoteControl({
  score,
  myVote,
  showDownvote,
  onVote,
  scoreTestID,
}: {
  score: number;
  myVote: VoteValue | null;
  showDownvote: boolean;
  onVote?: SendVote;
  scoreTestID?: string;
}) {
  const state = useOptimisticVote({ score, myVote, onVote });
  return (
    <View style={styles.control}>
      <VoteArrows state={state} showDownvote={showDownvote} enabled={onVote != null} scoreTestID={scoreTestID} />
      {/* A refused vote's message is announced as it appears (the score snapped back silently otherwise). */}
      {state.message ? (
        <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Body variant="small" style={styles.message}>
            {state.message}
          </Body>
        </View>
      ) : null}
    </View>
  );
}

/** One vote arrow: red and filled when it is the viewer's vote, outlined otherwise. */
function VoteArrow({ direction, lit, onPress }: { direction: 'up' | 'down'; lit: boolean; onPress?: () => void }) {
  const label = direction === 'up' ? 'Upvote' : 'Downvote';
  const icon =
    direction === 'up' ? (lit ? 'arrow-up-circle' : 'arrow-up-circle-outline') : lit ? 'arrow-down-circle' : 'arrow-down-circle-outline';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: lit, disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      hitSlop={8}
    >
      <Ionicons name={icon} size={26} color={lit ? colors.accent : colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    gap: spacing.xs,
  },
  votes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  score: {
    color: colors.text,
    minWidth: 24,
    textAlign: 'center',
  },
  message: {
    color: colors.muted,
  },
});
