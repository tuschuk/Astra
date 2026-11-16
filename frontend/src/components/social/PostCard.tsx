/**
 * PostCard — one post on the Home feed (SOC-1): a lifter sharing a finished workout, or (B22) a
 * photo — a progress pic or a PR moment (SOC-2).
 *
 * What it shows, top to bottom:
 *   - who posted it (their profile photo or letter avatar, display name and @username) and when
 *     ("Today", "Yesterday" or the date) — tapping it opens their profile (B25);
 *   - the post's flair chip ("WOD", "New PR", "Physique Check", …) — the name comes from the
 *     flair row on the server, so a new flair needs no app change (SOC-3);
 *   - for a workout post: the workout's title (or its date), "58 min · 3 exercises · 12 sets",
 *     each exercise with its sets printed exactly as the logger prints them (`formatSet` /
 *     `formatDropSet`, supersets grouped with `supersetRuns`) in the *viewer's* kg/lb unit, and
 *     the workout's notes. A long workout stops after four exercises with "+ n more exercises";
 *   - for a photo post: the photo, fetched from the server as the viewer (`photoSource`) so the
 *     server's rules decide whether this viewer may see it; a plain panel while it loads or if it
 *     can't be shown;
 *   - (B26) on the viewer's OWN posts only — every kind: workout, progress pic, PR photo — a small
 *     chip saying who can see it ("Only you", "Followers", "Public"), so a post's privacy is
 *     never a surprise. Other people's cards don't show it.
 *
 *   - (B23) a footer: an upvote arrow, the post's net score (ups minus downs), a downvote arrow,
 *     and a comments button ("3 comments", or "Comment" when there are none). The arrow matching
 *     the viewer's own vote is lit. On a post whose flair takes upvotes only (Physique Check —
 *     read from the flair row, never by name) there is simply no downvote arrow.
 *
 * What the viewer can do: read it; vote — tap an arrow to vote, tap the lit one again to take
 * the vote back, tap the other to switch. The score moves at once and moves back, with a short
 * message, if the server refuses; open the post's comments; and (B26, own posts) tap the
 * visibility chip to choose Only you / Followers / Public — the chip moves at once and back, with
 * a message, if the server refuses. The server's row-level security is what makes the choice
 * real: a post made private disappears for everyone else through the API, not just on screen.
 * (B27) On OTHER people's posts, a ⋯ button beside the flair opens the report panel
 * (`ReportSheet`) — the viewer picks a reason and the report goes to the founder's queue. Own
 * posts have no ⋯ (you don't report yourself).
 * (B28) A re-share card shows the resharer's header, "Re-shared from @them", and the original
 * post (its author — tappable — and its workout or photo) inside a bordered panel; its footer is
 * the re-share's own. Other people's cards have **Re-share** in the footer (not on your own post,
 * nor on a re-share of your own post): a one-step confirmation, then a one-line result. Your own
 * workout cards have **Share**, which opens the image share card. Tapping through to the whole
 * workout arrives with a later step (another lifter's workout has no copy on this phone and no
 * screen yet). Without the vote / comment handlers (tests, or no session) the footer only shows.
 */
import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/social/Avatar';
import { ReportSheet } from '@/components/social/ReportSheet';
import { useOptimisticVote, VoteArrows } from '@/components/social/VoteControl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { Body, SectionLabel } from '@/components/ui/Text';
import type { WorkoutVisibility } from '@/db/dao';
import { useDisplayUnit } from '@/settings/displayUnit';
import type { FeedContent, FeedEntry, FeedOriginal, FeedPost, FeedWorkout } from '@/social/feed';
import type { ReportReason, ReportResult } from '@/social/moderation';
import { personLabels } from '@/social/names';
import type { PostImageSource } from '@/social/postImages';
import {
  POST_VISIBILITY_REFUSAL_MESSAGES,
  VISIBILITY_ORDER,
  VISIBILITY_WORDS,
  type PostVisibilityResult,
} from '@/social/postPrivacy';
import { RESHARE_MESSAGES, type ReshareResult } from '@/social/reshare';
import type { VoteResult, VoteValue } from '@/social/votes';
import { colors, layout, radii, spacing } from '@/theme';
import {
  formatDropSet,
  formatSet,
  groupDropSets,
  postDateLabel,
  supersetRuns,
  totalSets,
  workoutDateLabel,
  workoutDetailsLabel,
} from '@/workout/format';

/** How many exercises a card lists before "+ n more". */
export const CARD_EXERCISE_LIMIT = 4;

/** What a card calls an exercise whose name the viewer can't see (someone's custom one, or a deleted one). */
export const UNNAMED_EXERCISE = 'Custom exercise';

/** How an `<Image>` fetches a photo as the viewer (built by `postImageSource`). */
type PhotoSource = PostImageSource;

interface PostCardProps {
  post: FeedPost;
  /** "Now", for the Today / Yesterday label. Tests pin it; the app leaves it out. */
  now?: Date;
  /** The signed-in viewer's id — to tell them which private posts are their own. */
  viewerId?: string | null;
  /**
   * Builds the fetch for a photo post's picture from its bucket path (`postImageSource` in the
   * app); null when there is no session to fetch with, which shows the plain panel.
   */
  photoSource?: (imagePath: string) => PhotoSource | null;
  /**
   * Sends the viewer's new vote on this post — +1, −1, or null to take it back (B23; `castVote` /
   * `clearVote` in the app). Left out, the arrows only show.
   */
  onVote?: (postId: string, vote: VoteValue | null) => Promise<VoteResult>;
  /** Opens this post's comments (B23). Left out, the comment count only shows. */
  onOpenComments?: (postId: string) => void;
  /** Opens the author's profile (B25) when their name or photo is tapped. Left out, the header only shows. */
  onOpenProfile?: (userId: string) => void;
  /**
   * Changes who can see this post (B26; `setPostVisibility` in the app). Only ever offered on the
   * viewer's OWN posts. Left out, the owner still sees who can see the post, but can't change it.
   */
  onChangeVisibility?: (post: FeedPost, next: WorkoutVisibility) => Promise<PostVisibilityResult>;
  /**
   * Files a report about this post (B27; `report` in `social/moderation.ts`). Only offered on
   * OTHER people's posts. Left out, there is no ⋯ button.
   */
  onReport?: (postId: string, reason: ReportReason, details: string) => Promise<ReportResult>;
  /**
   * Re-shares this post to the viewer's followers (B28; `resharePost` in the app). Offered only
   * on posts that aren't the viewer's own — on a re-share card it passes on the original. Left
   * out, there is no Re-share button.
   */
  onReshare?: (post: FeedPost) => Promise<ReshareResult>;
  /**
   * Opens the image share card for one of the viewer's OWN workout posts (B28; the share-card
   * screen in the app), from which it goes to the phone's share sheet. Left out, no Share button.
   */
  onShareWorkout?: (workoutId: string) => void;
}

export function PostCard({
  post,
  now,
  viewerId,
  photoSource,
  onVote,
  onOpenComments,
  onOpenProfile,
  onChangeVisibility,
  onReport,
  onReshare,
  onShareWorkout,
}: PostCardProps) {
  const { author, flair } = post;
  const who = personLabels(author);
  // Only the author sees (and can change) who the post is shown to; other viewers' cards are
  // exactly as they were before B26.
  const own = viewerId != null && viewerId === author.id;
  // The ⋯ (report) button is for other people's posts only, and only when there's a handler.
  const reportable = !own && viewerId != null && onReport != null;
  const [reporting, setReporting] = useState(false);

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={authorSpoken(who, post.createdAt, now)}
          disabled={!onOpenProfile || !author.id}
          onPress={() => onOpenProfile?.(author.id)}
          style={styles.author}
        >
          <Avatar path={author.avatarPath} initial={who.initial} />
          <View style={styles.headerText}>
            <Body style={styles.name}>{who.name}</Body>
            <Body variant="small">{[who.handle, postDateLabel(post.createdAt, now)].filter(Boolean).join(' · ')}</Body>
          </View>
        </Pressable>
        <View style={styles.flair} accessible accessibilityLabel={`Flair: ${flair.name}`}>
          <SectionLabel size="small" style={styles.flairText}>
            {flair.name}
          </SectionLabel>
        </View>
        {reportable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Report post"
            onPress={() => setReporting(true)}
            hitSlop={8}
            style={styles.iconButton}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {reporting && onReport ? (
        <ReportSheet
          visible
          kind="post"
          onSubmit={(reason, details) => onReport(post.id, reason, details)}
          onClose={() => setReporting(false)}
        />
      ) : null}

      {post.kind === 'reshare' ? (
        <ResharedOriginal original={post.original} now={now} photoSource={photoSource} onOpenProfile={onOpenProfile} />
      ) : (
        <PostContent content={post} photoSource={photoSource} />
      )}

      {own ? <VisibilityControl post={post} onChangeVisibility={onChangeVisibility} /> : null}

      <PostFooter
        post={post}
        onVote={onVote}
        onOpenComments={onOpenComments}
        onReshare={canReshare(post, viewerId) ? onReshare : undefined}
        onShareWorkout={own && post.kind === 'workout' && onShareWorkout ? () => onShareWorkout(post.workout.id) : undefined}
      />
    </Card>
  );
}

/**
 * Whether the viewer may be offered Re-share on this card (B28): signed in, not their own post,
 * and — on a re-share card, which passes on its original — not their own original either. The
 * server refuses both anyway; this just keeps a button that can only fail off the screen.
 */
export function canReshare(post: FeedPost, viewerId: string | null | undefined): boolean {
  if (viewerId == null || post.author.id === viewerId) return false;
  return post.kind !== 'reshare' || post.original.author.id !== viewerId;
}

/** A post's body, by kind: the workout, or the photo. Shared by ordinary cards and a re-share's original. */
function PostContent({ content, photoSource }: { content: FeedContent; photoSource: PostCardProps['photoSource'] }) {
  return content.kind === 'workout' ? (
    <WorkoutBody workout={content.workout} />
  ) : (
    <PostPhoto source={photoSource?.(content.imagePath) ?? null} />
  );
}

/**
 * A re-share's body (B28): a line saying whose post this passes on, then the original in a
 * bordered panel — its author (tappable to their profile) and date, and its workout or photo
 * exactly as an ordinary card shows them. Votes and comments under it are the re-share's own.
 */
function ResharedOriginal({
  original,
  now,
  photoSource,
  onOpenProfile,
}: {
  original: FeedOriginal;
  now?: Date;
  photoSource: PostCardProps['photoSource'];
  onOpenProfile: PostCardProps['onOpenProfile'];
}) {
  const who = personLabels(original.author);
  return (
    <>
      <View style={styles.reshareLine}>
        <Ionicons name="arrow-redo-outline" size={14} color={colors.muted} />
        <Body variant="small" style={styles.muted}>{`Re-shared from ${who.handle ?? who.name}`}</Body>
      </View>
      <View style={styles.original} testID="reshared-original">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={authorSpoken(who, original.createdAt, now)}
          disabled={!onOpenProfile || !original.author.id}
          onPress={() => onOpenProfile?.(original.author.id)}
          style={styles.author}
        >
          <Avatar path={original.author.avatarPath} initial={who.initial} />
          <View style={styles.headerText}>
            <Body style={styles.name}>{who.name}</Body>
            <Body variant="small">{[who.handle, postDateLabel(original.createdAt, now)].filter(Boolean).join(' · ')}</Body>
          </View>
        </Pressable>
        <PostContent content={original} photoSource={photoSource} />
      </View>
    </>
  );
}

/** The chooser's three chips, with what a screen reader says for each. */
const VISIBILITY_OPTIONS: ChoiceOption<WorkoutVisibility>[] = VISIBILITY_ORDER.map((value) => ({
  value,
  label: VISIBILITY_WORDS[value].label,
  spoken: `${VISIBILITY_WORDS[value].label}: ${VISIBILITY_WORDS[value].meaning}`,
}));

/**
 * The owner's "who can see this" control (B26): a small chip naming the post's audience ("Only
 * you", "Followers", "Public"). Tapping it opens a chooser — the three options and the sentence
 * for the chosen one. Choosing moves the chip at once ("optimistic"), sends the change, and — if
 * the server refuses — moves it back with a short message. The options are disabled while a
 * change is on its way, so a double tap sends one change. A fresh feed load (a new
 * `post.visibility`) resets the chip to the server's value — the server is always the truth.
 */
function VisibilityControl({ post, onChangeVisibility }: Pick<PostCardProps, 'post' | 'onChangeVisibility'>) {
  const [shown, setShown] = useState<WorkoutVisibility>(post.visibility);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A ref as well as state: two taps before the next draw must still send only one change.
  const inFlight = useRef(false);

  // The "adjust state when a prop changes" pattern (as in the footer): a refreshed feed wins.
  const [server, setServer] = useState(post.visibility);
  if (server !== post.visibility) {
    setServer(post.visibility);
    setShown(post.visibility);
  }

  /** One option chosen: show it now, send it, undo it if refused. */
  async function choose(next: WorkoutVisibility): Promise<void> {
    if (!onChangeVisibility || inFlight.current || next === shown) return;
    const before = shown;
    setShown(next);
    setMessage(null);
    inFlight.current = true;
    setSending(true);
    const result = await onChangeVisibility(post, next);
    inFlight.current = false;
    setSending(false);
    if (result.ok) {
      setOpen(false);
    } else {
      setShown(before);
      setMessage(POST_VISIBILITY_REFUSAL_MESSAGES[result.reason]);
    }
  }

  const words = VISIBILITY_WORDS[shown];
  return (
    <View style={styles.visibility}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Who can see this post: ${words.label}`}
        accessibilityHint={onChangeVisibility ? 'Changes who can see this post' : undefined}
        accessibilityState={{ expanded: open, disabled: !onChangeVisibility }}
        disabled={!onChangeVisibility}
        onPress={() => {
          setOpen((o) => !o);
          setMessage(null); // an old refusal doesn't outlive the chooser it belonged to
        }}
        hitSlop={8}
        style={styles.visibilityChip}
      >
        <Ionicons name={VISIBILITY_ICONS[shown]} size={14} color={colors.muted} />
        <Body variant="small">{words.label}</Body>
      </Pressable>
      {open ? (
        <View style={styles.visibilityChooser}>
          <ChoiceChips options={VISIBILITY_OPTIONS} selected={shown} onSelect={(v) => void choose(v)} disabled={sending} fill />
          <Body variant="small" style={styles.muted}>
            {words.meaning}
          </Body>
        </View>
      ) : null}
      {message ? (
        <Body variant="small" style={styles.muted}>
          {message}
        </Body>
      ) : null}
    </View>
  );
}

/** The small icon beside each audience's name on the chip. */
const VISIBILITY_ICONS: Record<WorkoutVisibility, 'lock-closed-outline' | 'people-outline' | 'globe-outline'> = {
  private: 'lock-closed-outline',
  followers: 'people-outline',
  public: 'globe-outline',
};

/** What the comments button says: "Comment" with none yet, else "1 comment" / "n comments". */
export function commentButtonLabel(count: number): string {
  if (count <= 0) return 'Comment';
  return `${count} comment${count === 1 ? '' : 's'}`;
}

/**
 * The card's footer (B23): the vote arrows around the net score, and the comments button.
 * The arrows' optimistic logic — the score moves at once, goes back with a message if the server
 * refuses, and a fresh feed load resets it to the server's numbers — is `useOptimisticVote`
 * (VoteControl.tsx, B41), shared with the Marketplace program page. The footer keeps its own
 * layout: the refusal message sits under the whole footer.
 */
function PostFooter({
  post,
  onVote,
  onOpenComments,
  onReshare,
  onShareWorkout,
}: Pick<PostCardProps, 'post' | 'onVote' | 'onOpenComments' | 'onReshare'> & { onShareWorkout?: () => void }) {
  const voteState = useOptimisticVote({
    score: post.score,
    myVote: post.myVote,
    onVote: onVote ? (next) => onVote(post.id, next) : undefined,
  });
  const { message } = voteState;

  // B28: the Re-share confirmation, whether one is on its way, and its one-line result.
  const [confirming, setConfirming] = useState(false);
  const [resharing, setResharing] = useState(false);
  const [reshareMessage, setReshareMessage] = useState<string | null>(null);
  // A ref as well as state: two taps on "Re-share now" before the next draw still send one.
  const reshareInFlight = useRef(false);

  /** "Re-share now" tapped: send it once, close the confirmation, and say how it went. */
  async function reshare(): Promise<void> {
    if (!onReshare || reshareInFlight.current) return;
    reshareInFlight.current = true;
    setResharing(true);
    setReshareMessage(null);
    let outcome: keyof typeof RESHARE_MESSAGES = 'failed';
    try {
      const result = await onReshare(post);
      outcome = result.ok ? 'done' : result.reason;
    } finally {
      // Even if a handler ever threw, the button must come back rather than lock for good.
      reshareInFlight.current = false;
      setResharing(false);
      setConfirming(false);
      setReshareMessage(RESHARE_MESSAGES[outcome]);
    }
  }

  const commentLabel = commentButtonLabel(post.commentCount);
  return (
    <View style={styles.footerWrap}>
      <View style={styles.footer}>
        {/* No downvote control at all on an upvote-only post — the flair row's flag decides. */}
        <VoteArrows state={voteState} showDownvote={!post.flair.upvotesOnly} enabled={onVote != null} scoreTestID="post-score" />
        <View style={styles.actions}>
          {onShareWorkout ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share as image"
              onPress={onShareWorkout}
              style={styles.commentButton}
              hitSlop={8}
            >
              <Ionicons name="share-outline" size={18} color={colors.muted} />
              <Body variant="small">Share</Body>
            </Pressable>
          ) : null}
          {onReshare ? <ReshareButton onPress={() => setConfirming(true)} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={commentLabel}
            disabled={!onOpenComments}
            onPress={() => onOpenComments?.(post.id)}
            style={styles.commentButton}
            hitSlop={8}
          >
            <Ionicons name="chatbubble-outline" size={18} color={colors.muted} />
            <Body variant="small">{commentLabel}</Body>
          </Pressable>
        </View>
      </View>
      {confirming && onReshare ? (
        <ReshareConfirm
          sending={resharing}
          onConfirm={() => void reshare()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {message ? (
        <Body variant="small" style={styles.voteMessage}>
          {message}
        </Body>
      ) : null}
      {reshareMessage ? (
        <Body variant="small" style={styles.voteMessage}>
          {reshareMessage}
        </Body>
      ) : null}
    </View>
  );
}

/** The footer's Re-share button (B28). */
function ReshareButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Re-share" onPress={onPress} style={styles.commentButton} hitSlop={8}>
      <Ionicons name="arrow-redo-outline" size={18} color={colors.muted} />
      <Body variant="small">Re-share</Body>
    </Pressable>
  );
}

/**
 * The one-step confirmation under the footer before a re-share is sent (B28): a line saying where
 * it goes, and Re-share / Cancel. Both are disabled while the re-share is on its way.
 */
function ReshareConfirm({ sending, onConfirm, onCancel }: { sending: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <View style={styles.confirm}>
      <Body variant="small">Re-share this post to your followers?</Body>
      <View style={styles.confirmButtons}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={sending} />
        <Button label="Re-share now" onPress={onConfirm} disabled={sending} />
      </View>
    </View>
  );
}

/** A workout post's body: title, summary line, exercises with their sets, notes. */
function WorkoutBody({ workout }: { workout: FeedWorkout }) {
  const unit = useDisplayUnit();
  const shown = workout.entries.slice(0, CARD_EXERCISE_LIMIT);
  const hidden = workout.entries.length - shown.length;
  const title = workout.title ?? workoutDateLabel(workout.started_at);

  /** One exercise: its name, then one line per set (a drop set is one line). */
  function renderEntry(entry: FeedEntry) {
    return (
      <View key={entry.id} style={styles.entry}>
        <Body style={styles.exerciseName}>{entry.exerciseName ?? UNNAMED_EXERCISE}</Body>
        {groupDropSets(entry.sets).map((group) => (
          <Body key={group[0].id} variant="small">
            {group.length > 1 ? formatDropSet(group, unit) : formatSet(group[0], unit)}
          </Body>
        ))}
      </View>
    );
  }

  return (
    <>
      <Body style={styles.title}>{title}</Body>
      <Body variant="small">{workoutDetailsLabel(workout, workout.entries.length, totalSets(workout.entries))}</Body>

      <View style={styles.exercises}>
        {supersetRuns(shown).map((run) =>
          run.superset ? (
            <View key={run.entries[0].id} style={styles.superset}>
              <SectionLabel size="small">Superset</SectionLabel>
              {run.entries.map(renderEntry)}
            </View>
          ) : (
            renderEntry(run.entries[0])
          ),
        )}
        {hidden > 0 ? <Body variant="small">{`+ ${hidden} more exercise${hidden === 1 ? '' : 's'}`}</Body> : null}
      </View>

      {workout.notes ? (
        <Body variant="muted" style={styles.notes}>
          {workout.notes}
        </Body>
      ) : null}
    </>
  );
}

/**
 * A photo post's picture, filling the card's width at a fixed height (cropped to fit), over a
 * plain panel that shows while it loads — and stays, with a short line, if it can't be shown.
 */
function PostPhoto({ source }: { source: PhotoSource | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.photoFrame} testID="post-photo">
      {source && !failed ? (
        <Image
          source={source}
          style={styles.photo}
          resizeMode="cover"
          accessibilityLabel="Post photo"
          onError={() => setFailed(true)}
        />
      ) : (
        <Body variant="small" style={styles.photoMissing}>
          Photo unavailable
        </Body>
      )}
    </View>
  );
}

/**
 * What a screen reader says for a post's author row (B49): the action, then the lines the row
 * draws beside the avatar — "Open Wendy’s profile, @wendy, 2h ago" — so the handle and the
 * post's age aren't swallowed by the button. Middle dots aren't spoken; commas pause instead.
 */
function authorSpoken(who: ReturnType<typeof personLabels>, createdAt: string, now: Date | undefined): string {
  return [`Open ${who.name}’s profile`, who.handle, postDateLabel(createdAt, now)].filter(Boolean).join(', ');
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  iconButton: {
    // The ⋯ button's own box reaches the minimum touch target (the 20px icon alone is too small).
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  author: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  name: {
    color: colors.text,
  },
  flair: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDim,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  flairText: {
    color: colors.text,
  },
  title: {
    color: colors.text,
  },
  exercises: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  entry: {
    gap: 2,
  },
  exerciseName: {
    color: colors.text,
  },
  superset: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accentBorder,
    paddingLeft: spacing.sm,
    gap: spacing.xs,
  },
  notes: {
    marginTop: spacing.sm,
  },
  photoFrame: {
    width: '100%',
    height: 320,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoMissing: {
    color: colors.muted,
  },
  visibility: {
    marginTop: spacing.sm,
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  visibilityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  visibilityChooser: {
    alignSelf: 'stretch',
    gap: spacing.xs,
  },
  muted: {
    color: colors.muted,
  },
  footerWrap: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  commentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  confirm: {
    gap: spacing.xs,
  },
  confirmButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  reshareLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  original: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  voteMessage: {
    color: colors.muted,
  },
});
