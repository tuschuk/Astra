/**
 * Exercise history — every past session of one exercise, and the lifter's records on it (LOG-4).
 *
 * What it shows: the exercise's name; a "Current PRs" card with each record book's best ("1RM
 * 140 kg · e1RM 151.7 kg · 5RM 130 kg"; the e1RM is an Epley estimate) or "No PRs yet"; then one
 * card per finished workout that included the exercise, newest first (at most 50), headed by
 * the workout's title or date, listing that exercise's sets in order — warm-ups marked "W", a
 * drop set as one numbered row with its drops joined by arrows (the same set text as the saved
 * workout).
 *
 * Reached from the "History" link in the logger's last-time panel. Reads only the phone's
 * database, so it works with no signal. What the lifter can do: read it and go Back.
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
import type { PersonalRecordRow } from '@/db/dao';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { formatDropSet, formatPrLine, groupDropSets, workoutDateLabel } from '@/workout/format';
import { exerciseInfo, exerciseSessions, type ExerciseSession } from '@/workout/history';
import { currentPrs } from '@/workout/prs';
import { colors, spacing, type } from '@/theme';

/** Everything the screen reads, once, for one exercise. */
interface ExerciseHistory {
  name: string | null;
  prs: PersonalRecordRow[];
  sessions: ExerciseSession[];
}

/** Reading, read, or the read failed. */
type LoadState = { status: 'loading' } | { status: 'found'; history: ExerciseHistory } | { status: 'failed' };

export default function ExerciseHistoryScreen() {
  const router = useRouter();
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const unit = useDisplayUnit();
  // Keyed by exercise id, so a reused screen never shows the previous exercise while loading.
  const [loaded, setLoaded] = useState<{ forId: string; state: LoadState } | null>(null);
  const state: LoadState = loaded && loaded.forId === exerciseId ? loaded.state : { status: 'loading' };

  useEffect(() => {
    if (!db || !userId || typeof exerciseId !== 'string') return;
    let cancelled = false;
    Promise.all([
      exerciseInfo(db, userId, exerciseId),
      currentPrs(db, userId, exerciseId),
      exerciseSessions(db, userId, exerciseId),
    ])
      .then(([info, prs, sessions]) => {
        if (!cancelled) {
          setLoaded({ forId: exerciseId, state: { status: 'found', history: { name: info?.name ?? null, prs, sessions } } });
        }
      })
      .catch((caught: unknown) => {
        console.warn('Exercise history: could not read it from the phone', caught);
        if (!cancelled) setLoaded({ forId: exerciseId, state: { status: 'failed' } });
      });
    return () => {
      cancelled = true;
    };
  }, [db, userId, exerciseId]);

  /** Back to the logger (or wherever this was opened from), or the Workout tab. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  }

  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (state.status !== 'found') {
    return (
      <Screen>
        {backButton}
        {state.status === 'failed' || dbError ? (
          <EmptyState icon="barbell-outline" message="This exercise’s history couldn’t be read." />
        ) : (
          <Body variant="muted">Loading history…</Body>
        )}
      </Screen>
    );
  }

  const { name, prs, sessions } = state.history;
  const prLine = formatPrLine(prs, unit);

  return (
    <Screen>
      {backButton}
      <Heading>{name ?? 'Exercise'}</Heading>

      <Card style={styles.card}>
        <SectionLabel size="small">Current PRs</SectionLabel>
        <Body>{prLine !== '' ? prLine : 'No PRs yet'}</Body>
      </Card>

      {sessions.length === 0 ? (
        <EmptyState icon="time-outline" message="No finished sessions of this exercise yet." />
      ) : (
        sessions.map((s) => (
          <Card key={s.workoutId} style={styles.card}>
            <Body style={styles.sessionTitle}>{s.title ?? workoutDateLabel(s.startedAt)}</Body>
            {s.title ? (
              <Body variant="small" style={styles.muted}>
                {workoutDateLabel(s.startedAt)}
              </Body>
            ) : null}
            {groupDropSets(s.sets).map((segments, index) => (
              <View key={segments[0].id} style={styles.setRow}>
                <SectionLabel size="small" style={styles.setNumber}>
                  Set {index + 1}
                </SectionLabel>
                <Body style={styles.setText}>{formatDropSet(segments, unit)}</Body>
              </View>
            ))}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  card: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  sessionTitle: {
    ...type.cardTitle,
  },
  muted: {
    color: colors.muted,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  setNumber: {
    width: 48,
  },
  setText: {
    flex: 1,
  },
});
