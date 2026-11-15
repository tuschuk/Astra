/**
 * Saved workout — a finished workout, read-only.
 *
 * What it shows: the workout's date and duration, then every exercise in the order it was
 * logged, each with every set (reps and weight in the lifter's unit). This is what Finish opens,
 * and what each row of the Workout tab's history opens — the "reopens with every set intact"
 * half of LOG-2. It reads straight from the phone's database, so it works offline.
 *
 * What the lifter can do: read it, and go back. Editing a finished workout arrives with B14;
 * the post-workout analysis with B18/B21.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { formatSet, totalSets, workoutDateLabel, workoutDetailsLabel } from '@/workout/format';
import { readWorkout, type SavedWorkout } from '@/workout/history';
import { spacing, type } from '@/theme';

/** Where the screen is: reading, found, or not on this phone (or not this user's). */
type LoadState = { status: 'loading' } | { status: 'found'; workout: SavedWorkout } | { status: 'missing' };

export default function SavedWorkoutScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const unit = useDisplayUnit();
  // What was last read, and for which workout id: if the screen is reused for another id, the
  // old workout's sets must not linger while the new one loads, so a mismatch reads as loading.
  const [loaded, setLoaded] = useState<{ forId: string; state: LoadState } | null>(null);
  const state: LoadState = loaded && loaded.forId === id ? loaded.state : { status: 'loading' };

  useEffect(() => {
    if (!db || !userId || typeof id !== 'string') return;
    let cancelled = false;
    readWorkout(db, userId, id)
      .then((workout) => {
        if (!cancelled) setLoaded({ forId: id, state: workout ? { status: 'found', workout } : { status: 'missing' } });
      })
      .catch((caught: unknown) => {
        console.warn('Saved workout: could not read it from the phone', caught);
        if (!cancelled) setLoaded({ forId: id, state: { status: 'missing' } });
      });
    return () => {
      cancelled = true;
    };
  }, [db, userId, id]);

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
          <Body variant="muted">Loading workout…</Body>
        )}
      </Screen>
    );
  }

  const { workout, entries } = state.workout;
  const details = workoutDetailsLabel(workout, entries.length, totalSets(entries));

  return (
    <Screen>
      {backButton}
      <Heading>{workout.title ?? workoutDateLabel(workout.started_at)}</Heading>
      <Body variant="muted" style={styles.details}>
        {details}
      </Body>

      {entries.map((entry) => (
        <Card key={entry.id} style={styles.card}>
          <Body style={styles.name}>{entry.exerciseName ?? 'Deleted exercise'}</Body>
          {entry.sets.length === 0 ? (
            <Body variant="small">No sets logged</Body>
          ) : (
            entry.sets.map((set) => (
              <View key={set.id} style={styles.setRow}>
                <SectionLabel size="small" style={styles.setNumber}>
                  Set {set.position + 1}
                </SectionLabel>
                <Body>{formatSet(set, unit)}</Body>
              </View>
            ))
          )}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  details: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  card: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  name: {
    ...type.cardTitle,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  setNumber: {
    width: 48,
  },
});
