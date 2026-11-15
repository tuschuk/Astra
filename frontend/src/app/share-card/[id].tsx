/**
 * Share card — one finished workout as a Strava-style image, sent to the phone's share sheet
 * (LOG-8; and SOC-6's "export to the OS share sheet" for the lifter's own workout posts, B28).
 *
 * What it shows: a preview of the card (`ShareCard`) at screen width — the workout's title or
 * date, volume in the lifter's unit, sets and duration, and the session's new PRs (or, with
 * none, its exercises) — exactly the picture that will be sent. Under it, **Share**.
 *
 * What the lifter can do: tap **Share** — the card on screen is captured to a 1080 × 1350 PNG
 * and handed to the phone's share sheet (Instagram, Messages, Photos, anything); or **Back**.
 * While the capture runs the button is disabled; if it fails, a calm line says so and Share can
 * be tapped again. On a phone (or emulator) with no share sheet, Share is disabled with a line
 * saying why.
 *
 * Where it comes from: the phone only — `analysisForScreen` (the analysis screen's own read) for
 * the numbers and PRs, and the saved workout for the exercise names and set counts. So it works
 * with no signal at all, and the sharer's card carries nothing beyond their own workout.
 *
 * Opened from the analysis screen's **Share** button and from Share on the lifter's own workout
 * posts in the feed and on their profile. A workout that isn't the lifter's finished workout on
 * this phone shows "This workout isn't on this phone." and no Share.
 */
import React, { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { analysisForScreen, type ScreenAnalysis } from '@/analysis/analysis';
import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { SHARE_IMAGE_SIZE, ShareCard, type ShareCardExercise } from '@/components/share/ShareCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body } from '@/components/ui/Text';
import type { SqlExecutor } from '@/db/driver';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { readWorkout } from '@/workout/history';
import { colors, layout, spacing } from '@/theme';

/** The widest the card is drawn, so it stays a card (not a poster) on a tablet. */
const MAX_PREVIEW_WIDTH = 420;

/** What the screen says when the capture or the share sheet fails. */
export const SHARE_FAILED = 'Couldn’t make the image. Try again.';

/** What the screen says when this phone has no share sheet (some emulators). */
export const SHARE_UNAVAILABLE = 'Sharing isn’t available on this device.';

/** Where the screen is: reading, found (the numbers and the exercise lines), or not on this phone. */
type LoadState =
  | { status: 'loading' }
  | { status: 'found'; view: ScreenAnalysis; exercises: ShareCardExercise[] }
  | { status: 'missing' };

/** Reads everything the card shows for one workout, from the phone only. */
async function readCard(db: SqlExecutor, userId: string, id: string): Promise<LoadState> {
  const view = await analysisForScreen(db, userId, id);
  if (!view) return { status: 'missing' };
  const saved = await readWorkout(db, userId, id);
  const exercises = (saved?.entries ?? []).map((e) => ({ id: e.id, name: e.exerciseName, setCount: e.sets.length }));
  return { status: 'found', view, exercises };
}

export default function ShareCardScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const unit = useDisplayUnit();
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.min(windowWidth - layout.screenPadding * 2, MAX_PREVIEW_WIDTH);
  const cardRef = useRef<ComponentRef<typeof View>>(null);

  // Keyed by workout id, so a reused screen never shows the previous workout's card.
  const [loaded, setLoaded] = useState<{ forId: string; state: LoadState } | null>(null);
  const state: LoadState = loaded && loaded.forId === id ? loaded.state : { status: 'loading' };
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!db || !userId || typeof id !== 'string') return;
      let cancelled = false;
      readCard(db, userId, id)
        .then((next) => {
          if (!cancelled) setLoaded({ forId: id, state: next });
        })
        .catch((caught: unknown) => {
          console.warn('Share card: could not read the workout from the phone', caught);
          if (!cancelled) setLoaded({ forId: id, state: { status: 'missing' } });
        });
      return () => {
        cancelled = true;
      };
    }, [db, userId, id]),
  );

  // Whether this phone has a share sheet at all, asked once.
  useEffect(() => {
    let cancelled = false;
    Sharing.isAvailableAsync()
      .then((yes) => {
        if (!cancelled) setAvailable(yes);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Share tapped: capture the card on screen to a PNG and open the share sheet with it. */
  async function share(): Promise<void> {
    if (sharing || !cardRef.current) return;
    setSharing(true);
    setMessage(null);
    try {
      const uri = await captureRef(cardRef, { format: 'png', result: 'tmpfile', ...SHARE_IMAGE_SIZE });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your workout' });
    } catch (caught: unknown) {
      console.warn('Share card: capture or share failed', caught);
      setMessage(SHARE_FAILED);
    } finally {
      setSharing(false);
    }
  }

  /** Back to wherever this was opened from, or the Workout tab. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  }

  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (state.status !== 'found') {
    return (
      <Screen>
        {backButton}
        {state.status === 'missing' || dbError ? (
          <EmptyState icon="barbell-outline" message="This workout isn’t on this phone." />
        ) : (
          <Body variant="muted">Loading card…</Body>
        )}
      </Screen>
    );
  }

  const { analysis, workout } = state.view;
  return (
    <Screen>
      {backButton}
      <View style={styles.preview}>
        <ShareCard
          ref={cardRef}
          title={workout.title}
          startedAt={workout.started_at}
          volumeKg={analysis.total_volume_kg}
          totalSets={analysis.total_sets}
          workingSets={analysis.working_sets}
          durationSeconds={analysis.duration_seconds}
          prs={analysis.new_prs}
          exercises={state.exercises}
          unit={unit}
          width={cardWidth}
        />
      </View>
      <Button
        label={sharing ? 'Preparing…' : 'Share'}
        onPress={() => void share()}
        disabled={sharing || available !== true}
        style={styles.share}
      />
      {available === false ? (
        <Body variant="small" style={styles.note}>
          {SHARE_UNAVAILABLE}
        </Body>
      ) : null}
      {message ? (
        <Body variant="small" style={styles.note}>
          {message}
        </Body>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  preview: {
    alignItems: 'center',
  },
  share: {
    marginTop: spacing.xl,
  },
  note: {
    color: colors.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
