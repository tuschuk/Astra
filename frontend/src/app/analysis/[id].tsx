/**
 * Workout analysis — the post-workout summary of one finished workout (ANA-1, ANA-2, ANA-4).
 *
 * What it shows: an encouraging headline and message picked by Astra's scripted rules (never AI,
 * ANA-11); the session's numbers — total volume in the lifter's unit, sets (with how many were
 * warm-ups), and how long it took; the personal records the session holds ("Squat · 5RM ·
 * 315 lb"); and, at the bottom of every state, the not-medical-advice statement (NFR-9).
 *
 * Where it comes from: the server's stored analysis when the phone has an up-to-date copy, else
 * the same rules run on the phone's own data — so it works fully offline, and fills in the
 * server's copy after a sync without looking any different (see `analysisForScreen`). It re-reads
 * every time it comes into view.
 *
 * Opened by Finish (in place of the logger) and by the saved workout's **Analysis** button —
 * including for workouts finished before analyses existed.
 *
 * What the lifter can do: read it; **View workout** to open the saved workout; **Back** to where
 * it was opened from (or the Workout tab).
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { NOT_MEDICAL_ADVICE } from '@analysis';

import { analysisForScreen, type ScreenAnalysis } from '@/analysis/analysis';
import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { countLabel, formatDuration, formatWeight, prBookLabel, workoutDateLabel } from '@/workout/format';
import { colors, spacing, type } from '@/theme';

/** Where the screen is: reading, found, or not this user's finished workout on this phone. */
type LoadState = { status: 'loading' } | { status: 'found'; view: ScreenAnalysis } | { status: 'missing' };

export default function AnalysisScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const unit = useDisplayUnit();
  // Keyed by workout id, so a reused screen never shows the previous workout's numbers.
  const [loaded, setLoaded] = useState<{ forId: string; state: LoadState } | null>(null);
  const state: LoadState = loaded && loaded.forId === id ? loaded.state : { status: 'loading' };

  // Read on every focus: a sync may have brought the server's copy, or an edit changed the workout.
  useFocusEffect(
    useCallback(() => {
      if (!db || !userId || typeof id !== 'string') return;
      let cancelled = false;
      analysisForScreen(db, userId, id)
        .then((view) => {
          if (!cancelled) setLoaded({ forId: id, state: view ? { status: 'found', view } : { status: 'missing' } });
        })
        .catch((caught: unknown) => {
          console.warn('Analysis: could not read it from the phone', caught);
          if (!cancelled) setLoaded({ forId: id, state: { status: 'missing' } });
        });
      return () => {
        cancelled = true;
      };
    }, [db, userId, id]),
  );

  /** Back to wherever this was opened from, or the Workout tab (Finish replaces the logger with this screen). */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  }

  const disclaimer = (
    <Body variant="small" style={styles.disclaimer}>
      {NOT_MEDICAL_ADVICE}
    </Body>
  );
  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (state.status !== 'found') {
    return (
      <Screen>
        {backButton}
        {state.status === 'missing' || dbError ? (
          <EmptyState icon="barbell-outline" message="This workout isn’t on this phone." />
        ) : (
          <Body variant="muted">Loading analysis…</Body>
        )}
        {disclaimer}
      </Screen>
    );
  }

  const { analysis, workout } = state.view;
  const warmups = analysis.total_sets - analysis.working_sets;
  const setsText =
    warmups > 0 ? `${countLabel(analysis.total_sets, 'set')} · ${warmups} warm-up` : countLabel(analysis.total_sets, 'set');

  return (
    <Screen>
      {backButton}
      <SectionLabel size="small" style={styles.workoutName}>
        {workout.title ?? workoutDateLabel(workout.started_at)}
      </SectionLabel>
      <Heading>{analysis.headline}</Heading>
      <Body style={styles.message}>{analysis.message}</Body>

      <Card style={styles.card}>
        <Stat label="Volume" value={formatWeight(analysis.total_volume_kg, unit)} />
        <Stat label="Sets" value={setsText} />
        <Stat label="Duration" value={formatDuration(analysis.duration_seconds)} />
      </Card>

      {analysis.new_prs.length > 0 ? (
        <Card style={styles.card}>
          <SectionLabel size="small" style={styles.prLabel}>
            New PRs
          </SectionLabel>
          {analysis.new_prs.map((pr) => (
            <Body key={`${pr.exercise_id}:${pr.kind}:${pr.reps ?? ''}`}>
              {`${pr.exercise_name ?? 'Deleted exercise'} · ${prBookLabel(pr)} · ${formatWeight(pr.value_kg, unit)}`}
            </Body>
          ))}
        </Card>
      ) : null}

      <Button
        label="View workout"
        variant="outline"
        onPress={() => router.push({ pathname: '/workout/[id]', params: { id: analysis.id } })}
        style={styles.view}
      />
      {disclaimer}
    </Screen>
  );
}

/** One number of the summary: a small label and its value, side by side. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <SectionLabel size="small" style={styles.statLabel}>
        {label}
      </SectionLabel>
      <Body style={styles.statValue}>{value}</Body>
    </View>
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
  card: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statLabel: {
    width: 80,
  },
  statValue: {
    ...type.cardTitle,
    flex: 1,
  },
  prLabel: {
    color: colors.accent,
  },
  view: {
    marginTop: spacing.md,
  },
  disclaimer: {
    color: colors.muted,
    marginTop: spacing.xl,
  },
});
