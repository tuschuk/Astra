/**
 * TrendsSection — the Trends tab of the lifter's own profile (B46, the trends half of YOU-7):
 * long-term charts drawn from every workout logged on this phone.
 *
 * What it shows, top to bottom:
 *   - a time window to look through: 3 months, 6 months, 1 year or All (All to start);
 *   - **Volume** — how much weight each session moved (reps × weight; warm-ups and bodyweight
 *     work add nothing), one point per finished workout;
 *   - **Estimated 1RM** — for one exercise, the best Epley estimate of each session it was in,
 *     with a row of exercise chips to pick which (it starts on the exercise trained most
 *     recently). It's labelled an estimate, because it is one.
 *
 * What the user can do: pick a window (both charts follow it), pick an exercise for the e1RM
 * chart, and — if the phone's storage couldn't be read — tap Retry.
 *
 * Calm empty states rather than empty boxes: no finished workouts yet → "Charts grow here as you
 * log workouts"; nothing in the chosen window → "Nothing in this window yet"; no weighted sets of
 * 1–30 reps yet → a line saying the e1RM chart starts with one. The data comes from
 * `useTrendData` (read from the phone); this component only shows it.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { MAX_EPLEY_REPS, type WeightUnit } from '@training-math';

import { UNNAMED_EXERCISE } from '@/components/social/PostCard';
import { Card } from '@/components/ui/Card';
import { ChoiceChips, type ChoiceOption } from '@/components/ui/ChoiceChips';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, SectionLabel } from '@/components/ui/Text';
import { colors, spacing } from '@/theme';
import { filterWindow, type TrendWindow } from '@/workout/trendSeries';

import { TrendChart } from './TrendChart';
import type { TrendData } from './useTrendData';

/** The window chips. */
const WINDOW_OPTIONS: readonly ChoiceOption<TrendWindow>[] = [
  { value: '3m', label: '3M', spoken: 'Show the last 3 months' },
  { value: '6m', label: '6M', spoken: 'Show the last 6 months' },
  { value: '12m', label: '1Y', spoken: 'Show the last year' },
  { value: 'all', label: 'All', spoken: 'Show all time' },
];

/** The line when no finished workout exists yet. */
export const TRENDS_EMPTY = 'Charts grow here as you log workouts.';
/** The line when the chosen window holds no session. */
export const TRENDS_WINDOW_EMPTY = 'Nothing in this window yet.';
/** The line when no set has ever earned an e1RM. */
export const TRENDS_NO_E1RM = `Your estimated 1RM chart starts with your first weighted set of 1–${MAX_EPLEY_REPS} reps.`;
/** What the Volume chart's spoken sentence starts with. */
export const VOLUME_CHART_TITLE = 'Volume per session';

/** The e1RM chart's spoken title for one exercise: "Squat estimated 1RM". */
export function e1rmChartTitle(name: string): string {
  return `${name} estimated 1RM`;
}

interface TrendsSectionProps {
  data: TrendData;
  timeWindow: TrendWindow;
  onSelectWindow: (next: TrendWindow) => void;
  onSelectExercise: (exerciseId: string) => void;
  onRetry: () => void;
  unit: WeightUnit;
}

export function TrendsSection({
  data,
  timeWindow,
  onSelectWindow,
  onSelectExercise,
  onRetry,
  unit,
}: TrendsSectionProps) {
  if (data.status === 'error') {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        message="Your workouts couldn’t be read from this phone."
        actionLabel="Retry"
        onAction={onRetry}
      />
    );
  }
  if (data.status !== 'ready') return <Body variant="muted">Loading…</Body>;
  if (data.volume.length === 0) return <EmptyState icon="analytics-outline" message={TRENDS_EMPTY} />;

  // Windows count back from when the data was read (re-read on every visit to the tab).
  const nowMs = data.readAtMs;
  const volume = filterWindow(data.volume, timeWindow, nowMs);
  const picked = data.exercises.find((e) => e.exerciseId === data.exerciseId) ?? null;
  const pickedName = picked ? (picked.name ?? UNNAMED_EXERCISE) : null;
  const e1rm = filterWindow(data.e1rm, timeWindow, nowMs);
  const exerciseOptions: ChoiceOption<string>[] = data.exercises.map((e) => {
    const name = e.name ?? UNNAMED_EXERCISE;
    return { value: e.exerciseId, label: name, spoken: `Show ${name} estimated 1RM` };
  });

  return (
    <View style={styles.section}>
      <ChoiceChips options={WINDOW_OPTIONS} selected={timeWindow} onSelect={onSelectWindow} fill />

      <Card style={styles.card}>
        <SectionLabel>Volume</SectionLabel>
        <Body variant="small" style={styles.muted}>
          Per session, in {unit} · warm-ups and bodyweight sets add nothing
        </Body>
        {volume.length > 0 ? (
          <TrendChart title={VOLUME_CHART_TITLE} points={volume} unit={unit} baseline="zero" testID="volume-chart" />
        ) : (
          <Body variant="muted" style={styles.note}>
            {TRENDS_WINDOW_EMPTY}
          </Body>
        )}
      </Card>

      <Card style={styles.card}>
        <SectionLabel>Estimated 1RM</SectionLabel>
        <Body variant="small" style={styles.muted}>
          Best estimate per session (Epley formula), in {unit}
        </Body>
        {picked && pickedName ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.picker}>
              <ChoiceChips options={exerciseOptions} selected={picked.exerciseId} onSelect={onSelectExercise} />
            </ScrollView>
            {data.e1rmFor !== picked.exerciseId ? (
              <Body variant="muted" style={styles.note}>
                Loading…
              </Body>
            ) : e1rm.length > 0 ? (
              <TrendChart title={e1rmChartTitle(pickedName)} points={e1rm} unit={unit} baseline="fit" testID="e1rm-chart" />
            ) : (
              <Body variant="muted" style={styles.note}>
                {TRENDS_WINDOW_EMPTY}
              </Body>
            )}
          </>
        ) : (
          <Body variant="muted" style={styles.note}>
            {TRENDS_NO_E1RM}
          </Body>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.sm,
  },
  muted: {
    color: colors.muted,
  },
  note: {
    paddingVertical: spacing.lg,
  },
  picker: {
    paddingVertical: spacing.xs,
  },
});
