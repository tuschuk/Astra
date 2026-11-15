/**
 * Edit workout — changing a workout that is already finished and saved (LOG-9, B14), shown
 * full-screen above the tab bar. Opened from the saved workout's **Edit** button.
 *
 * What it shows: the logger's own surface over the saved workout — its title and notes boxes,
 * then each exercise as an EntryCard with its sets and the "last time" panel (which leaves out
 * this very workout, as in the logger).
 *
 * What the lifter can do — everything the logger allows, on a past workout: add, remove or
 * move exercises; log, repeat or remove sets (a mistyped set is fixed by removing it and
 * logging it again); flip warm-ups; link supersets; edit any note or the title. Each change is
 * saved the moment it is made and queued for upload; the personal records of the exercises it
 * touched are recomputed in the same save, so a deleted or lightened record moves to the next
 * best set straight away (see `workout/editWorkout.ts`). Then:
 *   - **Done**: saves any title or note still being typed, then goes back to the saved workout
 *     (which re-reads itself). Nothing else to commit — there is no Save button;
 *   - **Delete workout**: after a confirmation, deletes the workout (records recomputed from
 *     what remains) and goes to the Workout tab.
 *
 * Works offline; the changes upload with the next sync.
 */
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading } from '@/components/ui/Text';
import { confirmDeleteWorkout } from '@/components/workout/confirmDeleteWorkout';
import { EntryCard } from '@/components/workout/EntryCard';
import { ExercisePicker, type PickedExercise } from '@/components/workout/ExercisePicker';
import { WorkoutDetailsFields } from '@/components/workout/WorkoutDetailsFields';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useCustomExercises } from '@/library/useCustomExercises';
import { useDisplayUnit } from '@/settings/displayUnit';
import type { ActiveWorkoutStore } from '@/workout/activeWorkout';
import { openWorkoutForEdit } from '@/workout/editWorkout';
import { supersetPlacement, workoutDateLabel } from '@/workout/format';
import { useWorkoutSnapshot } from '@/workout/useActiveWorkout';
import { AutosaveRegistryContext, createAutosaveRegistry } from '@/workout/useAutosaveText';
import { spacing } from '@/theme';

/** Where the screen is: opening the workout, editing it, or it isn't editable on this phone. */
type OpenState = { status: 'loading' } | { status: 'open'; store: ActiveWorkoutStore } | { status: 'missing' };

export default function EditWorkoutScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db } = useAppDatabase();
  const unit = useDisplayUnit();
  // The lifter's own exercises, for the Add-exercise picker (B31).
  const { customs } = useCustomExercises();
  const [opened, setOpened] = useState<{ forId: string; state: OpenState } | null>(null);
  const state: OpenState = opened && opened.forId === id ? opened.state : { status: 'loading' };
  const store = state.status === 'open' ? state.store : null;
  const snapshot = useWorkoutSnapshot(store);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every title / note box on this screen, so Done can save them all first.
  const [autosave] = useState(createAutosaveRegistry);

  useEffect(() => {
    if (!db || !userId || typeof id !== 'string') return;
    let cancelled = false;
    openWorkoutForEdit(db, userId, id)
      .then((opened) => {
        if (!cancelled) setOpened({ forId: id, state: opened ? { status: 'open', store: opened } : { status: 'missing' } });
      })
      .catch((caught: unknown) => {
        console.warn('Edit workout: could not open it', caught);
        if (!cancelled) setOpened({ forId: id, state: { status: 'missing' } });
      });
    return () => {
      cancelled = true;
    };
  }, [db, userId, id]);

  /** Back to the saved workout, or the Workout tab when there is nothing to go back to. */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/workout');
  }

  /** Adds the picked exercise (library or the lifter's own custom) at the end of the workout. */
  function addExercise(exercise: PickedExercise): void {
    setPickerOpen(false);
    if (!store) return;
    setError(null);
    store.addExercise(exercise.deviceId).catch((caught: unknown) => {
      console.warn('Edit workout: could not add the exercise', caught);
      setError('That exercise couldn’t be added. Try again.');
    });
  }

  /** Saves any title or note still waiting out its autosave timer, then leaves. */
  async function done(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await autosave.flushAll())) {
        setError('A title or note couldn’t be saved. Fix it, then tap Done again.');
        return;
      }
      back();
    } finally {
      setBusy(false);
    }
  }

  /** Deletes the workout (through the store, so no late note save can bring it back) and leaves. */
  async function deleteIt(): Promise<void> {
    if (!store || busy || store.getStatus() !== 'active') return;
    setBusy(true);
    setError(null);
    try {
      await store.discard();
      // Replace: the saved workout this was opened from no longer exists.
      router.replace('/workout');
    } catch (caught) {
      console.warn('Edit workout: could not delete it', caught);
      setError('The workout couldn’t be deleted. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'missing') {
    return (
      <Screen>
        <Button label="Back" variant="ghost" onPress={back} style={styles.back} />
        <EmptyState icon="barbell-outline" message="This workout can’t be edited on this phone." />
      </Screen>
    );
  }

  if (!snapshot || !store || !db || !userId) {
    return (
      <Screen>
        <Body variant="muted">Loading workout…</Body>
      </Screen>
    );
  }

  const placement = supersetPlacement(snapshot.entries);

  const header = (
    <View style={styles.header}>
      <Heading>Edit workout</Heading>
      <Body variant="muted">{workoutDateLabel(snapshot.workout.started_at)}</Body>
      <WorkoutDetailsFields store={store} workout={snapshot.workout} />
      <View style={styles.headerActions}>
        <Button label="Done" onPress={() => void done()} disabled={busy} style={styles.headerButton} />
        <Button
          label="Delete workout"
          variant="ghost"
          onPress={() => confirmDeleteWorkout(() => void deleteIt())}
          disabled={busy}
          style={styles.headerButton}
        />
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
              onOpenHistory={(exerciseId) =>
                router.push({ pathname: '/exercise-history/[exerciseId]', params: { exerciseId } })
              }
            />
          )}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState icon="barbell-outline" message="No exercises left in this workout." />}
          ListFooterComponent={
            <Button label="Add exercise" variant="outline" onPress={() => setPickerOpen(true)} disabled={busy} />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
        <ExercisePicker
          visible={pickerOpen}
          customExercises={customs}
          onPick={addExercise}
          onClose={() => setPickerOpen(false)}
        />
      </Screen>
    </AutosaveRegistryContext.Provider>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
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
