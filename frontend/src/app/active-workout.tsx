/**
 * Active workout — the logger itself (LOG-2), shown full-screen without the tab bar.
 *
 * What it shows: the exercises of the workout in progress, in order, each as an EntryCard
 * (its sets, a reps / weight entry row in the lifter's unit, one-tap Repeat, and the "last
 * time" panel: last session's sets, current PRs, and a History link to that exercise's
 * history screen).
 *
 * What the lifter can do:
 *   - **Add exercise**: search the library and add the exercise at the end;
 *   - everything on each card: log sets (plain, warm-up, timed or scored), log a drop, repeat,
 *     remove sets; move or remove the exercise; link it into a superset with the card above
 *     (B11 — linked cards wear a "Superset" badge, worked out here from the snapshot);
 *   - give the workout a **title** and a **note** in the boxes at the top (LOG-3); notes on an
 *     exercise or a set are written on its card. Every box saves itself as it is typed;
 *   - **Finish**: save any title or note still being typed, then save the workout for good (it
 *     is handed to sync, which uploads it when there is signal) and open the saved workout. Finishing with no sets logged instead asks
 *     "Nothing logged yet" with two choices — discard the workout, or keep lifting;
 *   - **Discard**: after a confirmation, delete the workout from the phone.
 *
 * Everything is saved to the phone the moment it is done, so leaving this screen (or the app
 * being killed) loses nothing: the Workout tab offers Resume. Opened with nothing in progress
 * (say, from a stale link), it looks in the database itself and goes back if there is truly
 * nothing to resume.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading } from '@/components/ui/Text';
import { EntryCard } from '@/components/workout/EntryCard';
import { ExercisePicker } from '@/components/workout/ExercisePicker';
import { confirmDiscardWorkout } from '@/components/workout/confirmDiscardWorkout';
import { WorkoutDetailsFields } from '@/components/workout/WorkoutDetailsFields';
import { useAppDatabase } from '@/db/useAppDatabase';
import type { ExerciseDef } from '@/library/catalog';
import { libraryExerciseId } from '@/library/uuidv5';
import { useDisplayUnit } from '@/settings/displayUnit';
import { clearSessionWorkout, resumeSessionWorkout } from '@/workout/activeWorkoutSession';
import { supersetPlacement, totalSets, workoutDateLabel } from '@/workout/format';
import { useSessionWorkout, useWorkoutSnapshot } from '@/workout/useActiveWorkout';
import { AutosaveRegistryContext, createAutosaveRegistry } from '@/workout/useAutosaveText';
import { spacing } from '@/theme';

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db } = useAppDatabase();
  const unit = useDisplayUnit();
  const store = useSessionWorkout(userId);
  const snapshot = useWorkoutSnapshot(store);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every title / note box on this screen, so Finish can save them all first (LOG-3).
  const [autosave] = useState(createAutosaveRegistry);
  // Set once Finish or Discard succeeds: from then on this screen is on its way out, and the
  // now-empty slot must not trigger the "nothing to resume" exit a second time.
  const ended = useRef(false);

  /** Leaves the logger: back to wherever it was opened from, or the Workout tab. */
  function leave(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  }

  // Opened with an empty slot (a relaunch straight onto this screen): the database, not the
  // slot, knows whether a workout is in progress.
  useEffect(() => {
    if (store || !db || !userId || ended.current) return;
    let cancelled = false;
    resumeSessionWorkout(db, userId)
      .then((resumed) => {
        if (!cancelled && !resumed && !ended.current) leave();
      })
      .catch((caught: unknown) => {
        console.warn('Logger: could not look for a workout in progress', caught);
        if (!cancelled) setError('Your workout couldn’t be read from this phone.');
      });
    return () => {
      cancelled = true;
    };
    // `leave` only uses the router, which is stable for the screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, db, userId]);

  /** Adds the picked library exercise at the end of the workout. */
  function addExercise(exercise: ExerciseDef): void {
    setPickerOpen(false);
    if (!store) return;
    setError(null);
    store.addExercise(libraryExerciseId(exercise.id)).catch((caught: unknown) => {
      console.warn('Logger: could not add the exercise', caught);
      setError('That exercise couldn’t be added. Try again.');
    });
  }

  /**
   * Ends the workout exactly once. `work` is the finish or discard step (the store call, then
   * where to go next); the buttons are disabled while it runs, and a store that has already
   * ended refuses a second go anyway. `failure` is the message shown if it doesn't work.
   */
  async function endWorkout(work: () => Promise<void>, failure: string): Promise<void> {
    if (!store || busy || store.getStatus() !== 'active') return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      console.warn('Logger: could not end the workout', caught);
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  /** Saves the workout for good and opens the saved view. */
  function finish(): Promise<void> {
    return endWorkout(async () => {
      if (!store) return;
      // Any title or note still waiting out its autosave timer is saved first, so text typed a
      // moment before tapping Finish (the tap doesn't close the keyboard) is in the finished
      // workout rather than dropped once it has ended. If one is refused, stop: finishing would
      // seal the workout without it (the box that failed says why).
      if (!(await autosave.flushAll())) {
        setError('A title or note couldn’t be saved. Fix it, then tap Finish again.');
        return;
      }
      const workout = await store.finish();
      ended.current = true;
      clearSessionWorkout();
      // Replace, so going back from the saved workout lands on the tab, not a dead logger.
      router.replace({ pathname: '/workout/[id]', params: { id: workout.id } });
    }, 'The workout couldn’t be finished. Try again.');
  }

  /** Deletes the workout from the phone and leaves. */
  function discard(): Promise<void> {
    return endWorkout(async () => {
      if (!store) return;
      await store.discard();
      ended.current = true;
      clearSessionWorkout();
      leave();
    }, 'The workout couldn’t be discarded. Try again.');
  }

  /** Finish — unless nothing has been logged, when the only choices are discard or keep going. */
  function onFinish(): void {
    if (!snapshot) return;
    if (totalSets(snapshot.entries) === 0) {
      Alert.alert('Nothing logged yet', 'Log at least one set to save this workout.', [
        { text: 'Keep lifting', style: 'cancel' },
        { text: 'Discard workout', style: 'destructive', onPress: () => void discard() },
      ]);
      return;
    }
    void finish();
  }

  if (!snapshot || !db || !userId || !store) {
    return (
      <Screen>
        <Body variant="muted">Loading your workout…</Body>
        <FormError message={error} />
      </Screen>
    );
  }

  // Which cards are supersetted with the card above, and which wear the Superset badge.
  const placement = supersetPlacement(snapshot.entries);

  const header = (
    <View style={styles.header}>
      <Heading>Workout</Heading>
      <Body variant="muted">Started {workoutDateLabel(snapshot.workout.started_at)}</Body>
      <WorkoutDetailsFields store={store} workout={snapshot.workout} />
      <View style={styles.headerActions}>
        <Button label="Finish" onPress={onFinish} disabled={busy} style={styles.headerButton} />
        <Button
          label="Discard"
          onPress={() => confirmDiscardWorkout(() => void discard())}
          variant="ghost" disabled={busy} style={styles.headerButton} />
      </View>
      <FormError message={error} />
    </View>
  );

  return (
    <AutosaveRegistryContext.Provider value={autosave}>
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <FlatList
        data={snapshot.entries}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item, index }) => (
          <EntryCard
            store={store}
            entry={item}
            entryCount={snapshot.entries.length}
            db={db}
            userId={userId}
            unit={unit}
            linkedToPrevious={placement[index]?.linkedToPrevious}
            inSuperset={placement[index]?.inSuperset}
            // Pushed on top: Back returns here with the workout exactly as it was.
            onOpenHistory={(exerciseId) =>
              router.push({ pathname: '/exercise-history/[exerciseId]', params: { exerciseId } })
            }
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState icon="barbell-outline" message="No exercises yet. Add the first one to start logging." />
        }
        ListFooterComponent={
          <Button label="Add exercise" variant="outline" onPress={() => setPickerOpen(true)} disabled={busy} />
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
      <ExercisePicker visible={pickerOpen} onPick={addExercise} onClose={() => setPickerOpen(false)} />
    </Screen>
    </AutosaveRegistryContext.Provider>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  headerButton: {
    flex: 1,
  },
  screenContent: {
    paddingBottom: 0,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
});
