/**
 * Saved workout — a finished workout, read-only.
 *
 * What it shows: the workout's date and duration, then every exercise in the order it was
 * logged, each with every set (reps and weight in the lifter's unit; time and score for timed
 * or WOD-style work). A superset is shown as one card labelled "Superset" holding its
 * exercises (LOG-11); a drop set is one numbered row with its drops joined by arrows (LOG-12).
 * Notes written in the logger show at all three levels (LOG-3): the workout's under its date
 * line, an exercise's under its name, and a set's as a muted line under that set (a drop's
 * marked "↳"). A set that currently holds a personal record wears a badge naming the record
 * ("PR · 5RM", "PR · 1RM · e1RM") — B13, read from the phone's `personal_records`.
 *
 * This is what Finish opens, and what each row of the Workout tab's history opens — the
 * "reopens with every set intact" half of LOG-2. It reads straight from the phone's database, so it works offline.
 *
 * What the lifter can do: read it; go back; tap **Edit** to change it (LOG-9, B14 — the edit
 * screen, which saves every change at once and recomputes the PRs); or tap **Delete** and
 * confirm, which deletes the workout, works the PRs out again from what remains (a record it
 * held passes to the next best set) and returns to the Workout tab. The screen re-reads the
 * workout every time it comes back into view, so it shows an edit the moment the lifter
 * returns. The post-workout analysis arrives with B18/B21.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { confirmDeleteWorkout } from '@/components/workout/confirmDeleteWorkout';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useDisplayUnit } from '@/settings/displayUnit';
import type { PersonalRecordRow } from '@/db/dao';
import type { SqlExecutor } from '@/db/driver';
import type { WeightUnit } from '@training-math';
import { deleteWorkout } from '@/workout/editWorkout';
import { currentPrs } from '@/workout/prs';
import {
  formatDropSet,
  formatPrBadge,
  groupDropSets,
  supersetRuns,
  totalSets,
  workoutDateLabel,
  workoutDetailsLabel,
} from '@/workout/format';
import { readWorkout, type SavedEntry, type SavedWorkout } from '@/workout/history';
import { colors, spacing, type } from '@/theme';

/**
 * Where the screen is: reading, found, or not on this phone (or not this user's). A found
 * workout carries the records its sets currently hold, by set id (for the PR badges).
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'found'; workout: SavedWorkout; recordsBySet: RecordsBySet }
  | { status: 'missing' };

/** Set id → the record books that set currently holds. */
type RecordsBySet = ReadonlyMap<string, PersonalRecordRow[]>;

/**
 * The current records of every exercise in the workout, grouped by the set that holds them —
 * read through `currentPrs`, the same reader as the logger's panel and the history screen.
 */
async function readRecordsBySet(db: SqlExecutor, userId: string, workout: SavedWorkout): Promise<RecordsBySet> {
  const exerciseIds = [...new Set(workout.entries.map((e) => e.exercise_id).filter((id): id is string => id != null))];
  const bySet = new Map<string, PersonalRecordRow[]>();
  for (const exerciseId of exerciseIds) {
    for (const record of await currentPrs(db, userId, exerciseId)) {
      bySet.set(record.source_set_id, [...(bySet.get(record.source_set_id) ?? []), record]);
    }
  }
  return bySet;
}

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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read on every focus, not just once: coming back from the edit screen must show the edited
  // sets and the recomputed PR badges, not what the screen read before (B14).
  useFocusEffect(
    useCallback(() => {
      if (!db || !userId || typeof id !== 'string') return;
      let cancelled = false;
      readWorkout(db, userId, id)
        .then(async (workout) => {
          if (!workout) {
            if (!cancelled) setLoaded({ forId: id, state: { status: 'missing' } });
            return;
          }
          const recordsBySet = await readRecordsBySet(db, userId, workout);
          if (!cancelled) setLoaded({ forId: id, state: { status: 'found', workout, recordsBySet } });
        })
        .catch((caught: unknown) => {
          console.warn('Saved workout: could not read it from the phone', caught);
          if (!cancelled) setLoaded({ forId: id, state: { status: 'missing' } });
        });
      return () => {
        cancelled = true;
      };
    }, [db, userId, id]),
  );

  /** Back to wherever this was opened from, or the Workout tab. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  }

  /** Deletes the workout (its records recomputed without it) and goes to the Workout tab. */
  async function deleteIt(): Promise<void> {
    if (!db || !userId || typeof id !== 'string' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWorkout(db, userId, id);
      router.replace('/workout');
    } catch (caught) {
      console.warn('Saved workout: could not delete it', caught);
      setError('The workout couldn’t be deleted. Try again.');
    } finally {
      setBusy(false);
    }
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
  const { recordsBySet } = state;
  const details = workoutDetailsLabel(workout, entries.length, totalSets(entries));

  return (
    <Screen>
      {backButton}
      <Heading>{workout.title ?? workoutDateLabel(workout.started_at)}</Heading>
      <Body variant="muted" style={styles.details}>
        {details}
      </Body>
      {workout.notes ? <Body style={styles.workoutNotes}>{workout.notes}</Body> : null}
      <View style={styles.actions}>
        <Button
          label="Edit"
          variant="outline"
          disabled={busy}
          style={styles.actionButton}
          onPress={() => router.push({ pathname: '/edit-workout/[id]', params: { id: workout.id } })}
        />
        <Button
          label="Delete"
          variant="ghost"
          disabled={busy}
          style={styles.actionButton}
          onPress={() => confirmDeleteWorkout(() => void deleteIt())}
        />
      </View>
      <FormError message={error} />

      {/* One Card per unit: a lone exercise, or a whole superset with its exercises inside. */}
      {supersetRuns(entries).map(({ superset, entries: run }) => (
        <Card key={run[0].id} style={styles.card}>
          {superset ? (
            <SectionLabel size="small" style={styles.supersetLabel}>
              Superset
            </SectionLabel>
          ) : null}
          {run.map((entry) => (
            <SavedExercise key={entry.id} entry={entry} unit={unit} recordsBySet={recordsBySet} />
          ))}
        </Card>
      ))}
    </Screen>
  );
}

/**
 * One exercise of the saved workout: its name, then one row per set as the lifter thinks of
 * it — a drop set is a single row with its drops joined by arrows ("Set 2 · 8 × 225 lb →
 * 8 × 185 lb"), numbered with the other sets (LOG-12). A set that holds a record gets a badge
 * naming the book(s) under its row ("PR · 5RM"); for a drop set, any segment's records count.
 */
function SavedExercise({
  entry,
  unit,
  recordsBySet,
}: {
  entry: SavedEntry;
  unit: WeightUnit;
  recordsBySet: RecordsBySet;
}) {
  return (
    <View style={styles.exercise}>
      <Body style={styles.name}>{entry.exerciseName ?? 'Deleted exercise'}</Body>
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
            <View style={styles.setRow}>
              <SectionLabel size="small" style={styles.setNumber}>
                Set {index + 1}
              </SectionLabel>
              <Body style={styles.setText}>{formatDropSet(segments, unit)}</Body>
            </View>
            <PrBadge records={segments.flatMap((segment) => recordsBySet.get(segment.id) ?? [])} />
            {/* Each segment's note, in order; a drop's is marked "↳" so it reads as that drop's. */}
            {segments.map((segment, segmentIndex) =>
              segment.notes ? (
                <Body key={segment.id} variant="small" style={[styles.note, styles.setNote]}>
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

/**
 * The PR badge under a set (LOG-4): "PR · 1RM · e1RM" naming each record book the set holds
 * right now, or nothing. Right after Finish these are exactly the PRs the session earned; on an
 * older workout a badge means "this set still holds the record" (a beaten record moves on).
 */
function PrBadge({ records }: { records: readonly PersonalRecordRow[] }) {
  const text = formatPrBadge(records);
  if (text === '') return null;
  return (
    <SectionLabel size="small" style={[styles.prBadge, styles.setNote]}>
      {text}
    </SectionLabel>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  actionButton: {
    flex: 1,
  },
  prBadge: {
    color: colors.accent,
  },
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
  exercise: {
    gap: spacing.sm,
  },
  supersetLabel: {
    color: colors.accent,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  setText: {
    flex: 1,
  },
  setNumber: {
    width: 48,
  },
  workoutNotes: {
    marginTop: -spacing.md,
    marginBottom: spacing.xl,
  },
  note: {
    color: colors.muted,
    fontStyle: 'italic',
  },
  setNote: {
    // Under its set's text, past the "Set n" column.
    paddingLeft: 48 + spacing.md,
  },
});
