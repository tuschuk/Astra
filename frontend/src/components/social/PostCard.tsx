/**
 * PostCard — one post on the Home feed (SOC-1): a lifter sharing a finished workout, or (B22) a
 * photo — a progress pic or a PR moment (SOC-2).
 *
 * What it shows, top to bottom:
 *   - who posted it (a letter avatar, their display name and @username) and when ("Today",
 *     "Yesterday" or the date);
 *   - the post's flair chip ("WOD", "New PR", "Physique Check", …) — the name comes from the
 *     flair row on the server, so a new flair needs no app change (SOC-3);
 *   - for a workout post: the workout's title (or its date), "58 min · 3 exercises · 12 sets",
 *     each exercise with its sets printed exactly as the logger prints them (`formatSet` /
 *     `formatDropSet`, supersets grouped with `supersetRuns`) in the *viewer's* kg/lb unit, and
 *     the workout's notes. A long workout stops after four exercises with "+ n more exercises";
 *   - for a photo post: the photo, fetched from the server as the viewer (`photoSource`) so the
 *     server's rules decide whether this viewer may see it; a plain panel while it loads or if it
 *     can't be shown. On the lifter's OWN progress pic, a line says "Only you can see this post",
 *     so a progress pic's privacy is never a surprise.
 *
 * What the viewer can do: read it. Tapping through to the whole workout arrives with a later
 * step (another lifter's workout has no copy on this phone and no screen yet).
 */
import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { LetterAvatar } from '@/components/social/LetterAvatar';
import { Card } from '@/components/ui/Card';
import { Body, SectionLabel } from '@/components/ui/Text';
import { useDisplayUnit } from '@/settings/displayUnit';
import type { FeedEntry, FeedPost, FeedWorkout } from '@/social/feed';
import { personLabels } from '@/social/names';
import type { PostImageSource } from '@/social/postImages';
import { colors, radii, spacing } from '@/theme';
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

/** The line under the lifter's own private post (B22). */
export const ONLY_YOU_LINE = 'Only you can see this post';

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
}

export function PostCard({ post, now, viewerId, photoSource }: PostCardProps) {
  const { author, flair } = post;
  const who = personLabels(author);
  // The owner's own progress pic (private by rule until B26) says so; other cards are unchanged.
  const ownPrivate =
    post.kind === 'progress-pic' && post.visibility === 'private' && viewerId != null && viewerId === author.id;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <LetterAvatar initial={who.initial} />
        <View style={styles.headerText}>
          <Body style={styles.name}>{who.name}</Body>
          <Body variant="small">{[who.handle, postDateLabel(post.createdAt, now)].filter(Boolean).join(' · ')}</Body>
        </View>
        <View style={styles.flair} accessibilityLabel={`Flair: ${flair.name}`}>
          <SectionLabel size="small" style={styles.flairText}>
            {flair.name}
          </SectionLabel>
        </View>
      </View>

      {post.kind === 'workout' ? (
        <WorkoutBody workout={post.workout} />
      ) : (
        <PostPhoto source={photoSource?.(post.imagePath) ?? null} />
      )}

      {ownPrivate ? (
        <Body variant="small" style={styles.privacy}>
          {ONLY_YOU_LINE}
        </Body>
      ) : null}
    </Card>
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

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
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
  privacy: {
    marginTop: spacing.sm,
    color: colors.muted,
  },
});
