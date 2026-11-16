/**
 * Post step — the last step after Finish: share the workout to the feed, or skip (LOG-7, B21).
 *
 * The flow it ends: Finish → the workout's analysis → **Next** → this screen. It is only reached
 * from a fresh finish (the analysis shows Next only then), so an old workout is never offered
 * again — one post per workout.
 *
 * What it shows: the workout's title (or its date), and the flairs as a row of chips — the
 * labels a post wears ("WOD", "New PR", …). The chips are the flair rows the phone downloaded
 * from the server, in their order, never names written in the app (SOC-3); the first is picked
 * to start with.
 *
 * What the lifter can do:
 *   - pick a flair (one at a time);
 *   - **Post** — saves the post on the phone, queued for upload (so it works with no signal and
 *     goes up on the next connection), then opens Home, where their own post appears once it is
 *     on the server. The post carries the workout's own visibility. The very first Post on this
 *     phone also asks, once, whether Astra may send push notifications (B47, `askOnce.ts`);
 *   - **Skip** — makes no post and goes to the Workout tab;
 *   - **Back** — returns to the analysis.
 *
 * Other states: a workout that isn't this lifter's finished workout on this phone shows "This
 * workout isn't on this phone."; one that already has a post shows "Already posted" with a way to
 * Home; and if the flair list has never synced (near-impossible — signing in needs a connection
 * and the first sync brings it), Post is disabled with a line saying so, while Skip still works.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { FlairRow } from '@/db/dao';
import type { SqlExecutor } from '@/db/driver';
import { readFlairs } from '@/db/flairs';
import { useAppDatabase } from '@/db/useAppDatabase';
import { maybeAskForPushOnce } from '@/notifications/askOnce';
import { createWorkoutPost, hasPostForWorkout, PostRefusedError } from '@/social/createPost';
import { workoutDateLabel } from '@/workout/format';
import { colors, radii, spacing } from '@/theme';

/** Where the screen is: reading, ready to post, already posted, or no such workout here. */
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; title: string; flairs: FlairRow[] }
  | { status: 'posted' }
  | { status: 'missing' };

/**
 * Reads what the screen needs for workout `id`: the lifter's own finished workout (else
 * 'missing'), whether it already has a post (then 'posted'), and the flair list.
 */
async function readScreen(db: SqlExecutor, userId: string, id: string): Promise<LoadState> {
  const workout = await db.getFirstAsync<{ title: string | null; started_at: string; ended_at: string | null }>(
    'select title, started_at, ended_at from workouts where id = ? and user_id = ?',
    [id, userId],
  );
  if (!workout || workout.ended_at === null) return { status: 'missing' };
  if (await hasPostForWorkout(db, id)) return { status: 'posted' };
  return { status: 'ready', title: workout.title ?? workoutDateLabel(workout.started_at), flairs: await readFlairs(db) };
}

export default function PostWorkoutScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  // Keyed by workout id, so a reused screen never shows the previous workout.
  const [loaded, setLoaded] = useState<{ forId: string; state: LoadState } | null>(null);
  const state: LoadState = loaded && loaded.forId === id ? loaded.state : { status: 'loading' };
  // The lifter's pick; null means "the first flair" until they tap one.
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!db || !userId || typeof id !== 'string') return;
      let cancelled = false;
      readScreen(db, userId, id)
        .then((next) => {
          if (!cancelled) setLoaded({ forId: id, state: next });
        })
        .catch((caught: unknown) => {
          console.warn('Post step: could not read the workout from the phone', caught);
          if (!cancelled) setLoaded({ forId: id, state: { status: 'missing' } });
        });
      return () => {
        cancelled = true;
      };
    }, [db, userId, id]),
  );

  /** Back to the analysis this was opened from, or the Workout tab. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  }

  /** Makes no post and ends the finish flow on the Workout tab. */
  function skip(): void {
    router.replace('/workout');
  }

  const flairs = state.status === 'ready' ? state.flairs : [];
  const flairId = picked && flairs.some((f) => f.id === picked) ? picked : (flairs[0]?.id ?? null);

  /** Saves the post (queued for upload) and opens Home. Disabled while it runs, so one tap = one post. */
  async function post(): Promise<void> {
    if (!db || !userId || typeof id !== 'string' || !flairId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createWorkoutPost(db, userId, id, flairId);
      // B47: the first Post is when push becomes worth asking for — once per phone, never awaited.
      void maybeAskForPushOnce(userId);
      router.replace('/');
    } catch (caught) {
      if (caught instanceof PostRefusedError && caught.reason === 'already-posted') {
        setLoaded({ forId: id, state: { status: 'posted' } });
      } else {
        console.warn('Post step: could not save the post', caught);
        setError('The post couldn’t be saved. Try again, or skip.');
      }
    } finally {
      setBusy(false);
    }
  }

  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (state.status === 'posted') {
    return (
      <Screen>
        {backButton}
        <Heading>Already posted</Heading>
        <Body variant="muted" style={styles.message}>
          This workout is already shared to your feed.
        </Body>
        <Button label="Go to Home" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (state.status !== 'ready') {
    return (
      <Screen>
        {backButton}
        {state.status === 'missing' || dbError ? (
          <EmptyState icon="barbell-outline" message="This workout isn’t on this phone." />
        ) : (
          <Body variant="muted">Loading…</Body>
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      {backButton}
      <SectionLabel size="small" style={styles.workoutName}>
        {state.title}
      </SectionLabel>
      <Heading>Share your workout</Heading>
      <Body variant="muted" style={styles.message}>
        Pick a flair and post it to your feed, or skip.
      </Body>

      <SectionLabel size="small" accessibilityRole="header" style={styles.flairLabel}>
        Flair
      </SectionLabel>
      {flairs.length > 0 ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          {flairs.map((flair) => (
            <FlairChip key={flair.id} flair={flair} selected={flair.id === flairId} onPress={() => setPicked(flair.id)} />
          ))}
        </View>
      ) : (
        <Body variant="small" style={styles.noFlairs}>
          Flairs haven’t synced to this phone yet, so posting isn’t available. Connect and try again, or skip.
        </Body>
      )}

      <FormError message={error} />
      <Button label="Post" onPress={post} disabled={busy || !flairId} style={styles.post} />
      <Button label="Skip" variant="ghost" onPress={skip} disabled={busy} style={styles.skip} />
    </Screen>
  );
}

/** One flair as a tappable chip; the picked one is filled red. */
function FlairChip({ flair, selected, onPress }: { flair: FlairRow; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={flair.name}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <SectionLabel size="small" style={styles.chipText}>
        {flair.name}
      </SectionLabel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  workoutName: {
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  message: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  flairLabel: {
    color: colors.accentText,
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  chipSelected: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDim,
  },
  chipText: {
    color: colors.text,
  },
  noFlairs: {
    color: colors.muted,
    marginBottom: spacing.xl,
  },
  post: {
    marginTop: spacing.md,
  },
  skip: {
    marginTop: spacing.md,
  },
});
