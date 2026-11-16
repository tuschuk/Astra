/**
 * Someone else's workout, read-only (B37 — TEAM-5) — opened by tapping a row of another lifter's
 * profile History.
 *
 * What it shows: the workout's title (or its date), "58 min · 3 exercises · 12 sets", the
 * lifter's note on the whole workout, then each exercise (supersets grouped) with its note and
 * every set as the lifter logged it ("Set 2 · 8 × 225 lb → 8 × 185 lb" for a drop set), weights
 * in the viewer's unit. An exercise the viewer can't name (the lifter's own custom exercise)
 * reads "Custom exercise". The only action is **Back**.
 *
 * Why it exists: a team's coach coaches from the log — "open any member's log history" needs
 * the rows to open. It serves any workout the viewer may see (a public one, a followers-only one
 * they follow for), and a coach sees their team members' workouts whatever their visibility.
 * That decision is the server's; this screen only shows what it returns. Not stored on the
 * phone: it needs a connection, and says so (with Retry) without one. Your OWN workouts open the
 * saved-workout screen instead (`/workout/[id]`, read from the phone).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { WeightUnit } from '@training-math';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { getSupabase } from '@/lib/supabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import { loadWorkoutDetail, type WorkoutDetail, type WorkoutDetailEntry } from '@/social/profile';
import { colors, spacing, type } from '@/theme';
import {
  formatDropSet,
  groupDropSets,
  spokenSetLabel,
  supersetRuns,
  totalSets,
  workoutDateLabel,
  workoutDetailsLabel,
} from '@/workout/format';

/** Shown for an exercise whose name the viewer can't read (someone's own custom exercise). */
export const CUSTOM_EXERCISE = 'Custom exercise';

/** Shown when the workout can't be seen (gone, or not visible to the viewer). */
export const SESSION_UNAVAILABLE = 'This workout isn’t available.';

/** Shown when the server can't be reached. */
export const SESSION_OFFLINE = 'Someone else’s workout needs a connection.';

type State = { status: 'loading' | 'error' | 'missing' } | { status: 'ready'; workout: WorkoutDetail };

export default function SessionScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = String(id);
  const client = useMemo(() => getSupabase(), []);
  const unit = useDisplayUnit();
  const [state, setState] = useState<State>({ status: 'loading' });

  /** Reads the workout from the server; whatever it returns is what the viewer may see. */
  const load = useCallback(async () => {
    try {
      const workout = await loadWorkoutDetail(client, workoutId);
      setState(workout ? { status: 'ready', workout } : { status: 'missing' });
    } catch (error: unknown) {
      console.warn('Session: the workout could not be loaded', error);
      setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
    }
  }, [client, workoutId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const backButton = (
    <Button
      label="Back"
      variant="ghost"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={styles.back}
    />
  );

  if (state.status !== 'ready') {
    return (
      <Screen>
        {backButton}
        {state.status === 'missing' ? (
          <EmptyState icon="barbell-outline" message={SESSION_UNAVAILABLE} />
        ) : state.status === 'error' ? (
          <EmptyState
            icon="cloud-offline-outline"
            message={SESSION_OFFLINE}
            actionLabel="Retry"
            onAction={() => {
              setState({ status: 'loading' });
              void load();
            }}
          />
        ) : (
          <Body variant="muted">Loading the workout…</Body>
        )}
      </Screen>
    );
  }

  const { workout } = state;
  return (
    <Screen>
      {backButton}
      <Heading>{workout.title ?? workoutDateLabel(workout.started_at)}</Heading>
      <Body variant="muted" style={styles.details}>
        {workoutDetailsLabel(workout, workout.entries.length, totalSets(workout.entries))}
      </Body>
      {workout.notes ? <Body style={styles.workoutNotes}>{workout.notes}</Body> : null}
      {supersetRuns(workout.entries).map(({ superset, entries: run }) => (
        <Card key={run[0].id} style={styles.card}>
          {superset ? (
            <SectionLabel size="small" style={styles.supersetLabel}>
              Superset
            </SectionLabel>
          ) : null}
          {run.map((entry) => (
            <SessionExercise key={entry.id} entry={entry} unit={unit} />
          ))}
        </Card>
      ))}
    </Screen>
  );
}

/** One exercise: its name and note, then one row per set as the lifter thinks of it. */
function SessionExercise({ entry, unit }: { entry: WorkoutDetailEntry; unit: WeightUnit }) {
  return (
    <View style={styles.exercise}>
      <Body accessibilityRole="header" style={styles.name}>
        {entry.exerciseName ?? CUSTOM_EXERCISE}
      </Body>
      {entry.notes ? (
        <Body variant="small" style={styles.note}>
          {entry.notes}
        </Body>
      ) : null}
      {entry.sets.length === 0 ? (
        <Body variant="small">No sets logged</Body>
      ) : (
        groupDropSets(entry.sets).map((segments, index) => (
          <View key={segments[0].id}>
            {/* One utterance per set for screen readers; a drop set's arrows are spoken as "then". */}
            <View
              style={styles.setRow}
              accessible
              accessibilityLabel={spokenSetLabel(index + 1, segments, unit)}
            >
              <SectionLabel size="small" style={styles.setNumber}>
                Set {index + 1}
              </SectionLabel>
              <Body style={styles.setText}>{formatDropSet(segments, unit)}</Body>
            </View>
            {segments.map((segment, segmentIndex) =>
              segment.notes ? (
                <Body key={segment.id} variant="small" style={styles.note}>
                  {segmentIndex === 0 ? segment.notes : `↳ ${segment.notes}`}
                </Body>
              ) : null,
            )}
          </View>
        ))
      )}
    </View>
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
  workoutNotes: {
    marginBottom: spacing.lg,
  },
  card: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  supersetLabel: {
    color: colors.accentText,
  },
  exercise: {
    gap: spacing.sm,
  },
  name: {
    ...type.cardTitle,
  },
  note: {
    color: colors.muted,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  setNumber: {
    // minWidth: at large text sizes "SET 10" grows instead of clipping.
    minWidth: 48,
  },
  setText: {
    flex: 1,
    color: colors.text,
  },
});
