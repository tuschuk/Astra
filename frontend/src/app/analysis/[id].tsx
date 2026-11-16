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
 * Right under the numbers, **Against your trend** (B42, ANA-5 / LOG-10): once the lifter has at
 * least 5 earlier sessions, this session's volume beside their recent average ("Compared with
 * your last 10 sessions" · "4,850 kg vs 4,320 kg" · "About 12% more than your recent average"),
 * and one intensity line — average RPE when this session and the history both carry RPE, else
 * load per rep. The words come from the shared `trendCopy`; the card is absent below the
 * threshold (the analysis holds no trend) or when no line can be computed.
 *
 * Between the numbers and the PRs sits the **muscle map** (ANA-3): front and back body figures
 * with the muscles this session trained filled in red (stronger for main movers), and a line
 * naming them. It is read from the phone's own sets and the bundled exercise library, so it is
 * always offline and always matches the workout as it stands now; it is left out entirely when no
 * logged exercise has library muscle data (an empty finish, or custom exercises only).
 *
 * Opened by Finish (in place of the logger) and by the saved workout's **Analysis** button —
 * including for workouts finished before analyses existed.
 *
 * What the lifter can do: read it; **View workout** to open the saved workout; (B28) **Share** to
 * open the workout's image share card and send it to another app (LOG-8); **Back** to where
 * it was opened from (or the Workout tab). When Finish opened it (B21, the `post=1` link — never
 * from the saved workout's button), a primary **Next** button also leads on to the Post step,
 * where the workout can be shared to the feed with a flair, or skipped (LOG-7).
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { NOT_MEDICAL_ADVICE, trendCopy, type TrendLine } from '@analysis';
import type { WeightUnit } from '@training-math';

import { analysisForScreen, type ScreenAnalysis } from '@/analysis/analysis';
import { sessionMuscleLoads, type SessionMuscleLoads } from '@/analysis/muscles';
import { useAuth } from '@/auth/AuthProvider';
import { MuscleMap, trainedMuscleNames } from '@/components/MuscleMap';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import type { SqlExecutor } from '@/db/driver';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { formatDuration, formatWeight, sessionPrLine, setsSummaryLabel, workoutDateLabel } from '@/workout/format';
import { colors, spacing, type } from '@/theme';

/**
 * Where the screen is: reading, found, or not this user's finished workout on this phone. A found
 * workout carries its analysis and its muscle map together, read in one go, so the two can never
 * belong to different workouts.
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'found'; view: ScreenAnalysis; muscles: SessionMuscleLoads }
  | { status: 'missing' };

/** Reads everything the screen shows for one workout: the analysis, then (if found) its muscle map. */
async function readScreen(db: SqlExecutor, userId: string, id: string): Promise<LoadState> {
  const view = await analysisForScreen(db, userId, id);
  if (!view) return { status: 'missing' };
  return { status: 'found', view, muscles: await sessionMuscleLoads(db, userId, id) };
}

export default function AnalysisScreen() {
  const router = useRouter();
  // `post=1` only when Finish opened this (B21): then Next leads on to the Post step.
  const { id, post } = useLocalSearchParams<{ id: string; post?: string }>();
  const finishMode = post === '1';
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
      readScreen(db, userId, id)
        .then((next) => {
          if (!cancelled) setLoaded({ forId: id, state: next });
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
  const muscleList = trainedMuscleNames(state.muscles);
  const setsText = setsSummaryLabel(analysis.total_sets, analysis.working_sets);
  const trend = trendCopy(analysis);

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

      {trend ? (
        <Card style={styles.card}>
          <SectionLabel size="small" style={styles.sectionLabel}>
            Against your trend
          </SectionLabel>
          <Body variant="small" style={styles.trendBasis}>
            {trend.basis}
          </Body>
          {trend.lines.map((line) => (
            <View key={line.measure} style={styles.trendLine}>
              <Stat label={line.label} value={trendPair(line, unit)} />
              <Body variant="small" style={styles.trendSentence}>
                {line.sentence}
              </Body>
            </View>
          ))}
        </Card>
      ) : null}

      {muscleList !== '' ? (
        <Card style={styles.card}>
          <SectionLabel size="small" style={styles.sectionLabel}>
            Muscles trained
          </SectionLabel>
          <MuscleMap loads={state.muscles} />
          <Body variant="small" style={styles.legend}>
            {muscleList}
          </Body>
        </Card>
      ) : null}

      {analysis.new_prs.length > 0 ? (
        <Card style={styles.card}>
          <SectionLabel size="small" style={styles.sectionLabel}>
            New PRs
          </SectionLabel>
          {analysis.new_prs.map((pr) => (
            <Body key={`${pr.exercise_id}:${pr.kind}:${pr.reps ?? ''}`}>{sessionPrLine(pr, unit)}</Body>
          ))}
        </Card>
      ) : null}

      {finishMode ? (
        <Button
          label="Next"
          onPress={() => router.push({ pathname: '/post-workout/[id]', params: { id: analysis.id } })}
          style={styles.view}
        />
      ) : null}
      <Button
        label="View workout"
        variant="outline"
        onPress={() => router.push({ pathname: '/workout/[id]', params: { id: analysis.id } })}
        style={styles.view}
      />
      <Button
        label="Share"
        variant="ghost"
        onPress={() => router.push({ pathname: '/share-card/[id]', params: { id: analysis.id } })}
        style={styles.view}
      />
      {disclaimer}
    </Screen>
  );
}

/**
 * The "this session vs your average" pair for one trend line, e.g. "4,850 kg vs 4,320 kg" or
 * "7.5 vs 7.0". Weights go through `formatWeight` in the lifter's unit; an RPE is unitless and
 * already rounded by `trendCopy` to the one decimal its sentence was worked out from.
 */
function trendPair(line: TrendLine, unit: WeightUnit): string {
  if (line.measure === 'rpe') return `${line.value.toFixed(1)} vs ${line.average.toFixed(1)}`;
  return `${formatWeight(line.value, unit)} vs ${formatWeight(line.average, unit)}`;
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
  sectionLabel: {
    color: colors.accent,
  },
  legend: {
    color: colors.muted,
    textAlign: 'center',
  },
  trendBasis: {
    color: colors.muted,
  },
  trendLine: {
    gap: spacing.xs,
  },
  trendSentence: {
    color: colors.muted,
  },
  view: {
    marginTop: spacing.md,
  },
  disclaimer: {
    color: colors.muted,
    marginTop: spacing.xl,
  },
});
