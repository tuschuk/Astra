/**
 * Active workout — the logger itself (LOG-2), shown full-screen without the tab bar.
 *
 * What it shows: the exercises of the workout in progress, in order, each as an EntryCard
 * (its sets, a reps / weight entry row in the lifter's unit, one-tap Repeat, and the "last
 * time" panel: last session's sets, current PRs, and a History link to that exercise's
 * history screen).
 *
 * What the lifter can do:
 *   - **Add exercise**: search the library and the lifter's own custom exercises (B31) and add
 *     the exercise at the end;
 *   - everything on each card: log sets (plain, warm-up, timed or scored), log a drop, repeat,
 *     remove sets; move or remove the exercise; link it into a superset with the card above
 *     (B11 — linked cards wear a "Superset" badge, worked out here from the snapshot);
 *   - give the workout a **title** and a **note** in the boxes at the top (LOG-3); notes on an
 *     exercise or a set are written on its card. Every box saves itself as it is typed;
 *   - **Finish**: save any title or note still being typed, then save the workout for good (it
 *     is handed to sync, which uploads it when there is signal) and open its post-workout
 *     analysis (B18), which links on to the saved workout and — this once — to the Post step,
 *     where the workout can be shared with a flair or skipped (B21). Finishing with no sets logged instead asks
 *     "Nothing logged yet" with two choices — discard the workout, or keep lifting;
 *   - **Discard**: after a confirmation, delete the workout from the phone;
 *   - **Tool Kit** (B16): the red button floating bottom-right — always on screen however far
 *     the list is scrolled — opens the calculators (1RM, RPE, %1RM, plates) in a panel over
 *     the logger. Closing it lands back on the logger exactly as it was.
 *
 * Everything is saved to the phone the moment it is done, so leaving this screen (or the app
 * being killed) loses nothing: the Workout tab offers Resume. Opened with nothing in progress
 * (say, from a stale link), it looks in the database itself and goes back if there is truly
 * nothing to resume.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading } from '@/components/ui/Text';
import { ToolKitSheet } from '@/components/toolkit/ToolKitSheet';
import { EntryCard } from '@/components/workout/EntryCard';
import { ExercisePicker, type PickedExercise } from '@/components/workout/ExercisePicker';
import { confirmDiscardWorkout } from '@/components/workout/confirmDiscardWorkout';
import { WorkoutDetailsFields } from '@/components/workout/WorkoutDetailsFields';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useCustomExercises } from '@/library/useCustomExercises';
import { useDisplayUnit } from '@/settings/displayUnit';
import { clearSessionWorkout, resumeSessionWorkout } from '@/workout/activeWorkoutSession';
import { supersetPlacement, totalSets, workoutDateLabel } from '@/workout/format';
import { useSessionWorkout, useWorkoutSnapshot } from '@/workout/useActiveWorkout';
import { AutosaveRegistryContext, createAutosaveRegistry } from '@/workout/useAutosaveText';
import { colors, glows, layout, radii, spacing, type } from '@/theme';

/** Extra bottom space the list keeps free for the floating Tool Kit button (its height + gap). */
const TOOL_KIT_BUTTON_CLEARANCE = 64;

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db } = useAppDatabase();
  const unit = useDisplayUnit();
  // The lifter's own exercises, for the Add-exercise picker (B31).
  const { customs } = useCustomExercises();
  const store = useSessionWorkout(userId);
  const snapshot = useWorkoutSnapshot(store);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toolKitOpen, setToolKitOpen] = useState(false);
  const insets = useSafeAreaInsets();
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

  /** Adds the picked exercise (library or the lifter's own custom) at the end of the workout. */
  function addExercise(exercise: PickedExercise): void {
    setPickerOpen(false);
    if (!store) return;
    setError(null);
    store.addExercise(exercise.deviceId).catch((caught: unknown) => {
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

  /** Saves the workout for good and opens its analysis (B18). */
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
      // Replace, so going back from the analysis lands on the tab, not a dead logger. The
      // analysis shows at once, computed on the phone, even with no signal (B18). `post=1` puts
      // it in finish mode: its Next button leads on to the Post step (B21).
      router.replace({ pathname: '/analysis/[id]', params: { id: workout.id, post: '1' } });
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
        // The button floats above the bottom safe area, so the clearance counts it too.
        contentContainerStyle={[styles.listContent, { paddingBottom: styles.listContent.paddingBottom + insets.bottom }]}
      />
      <ExercisePicker
        visible={pickerOpen}
        customExercises={customs}
        onPick={addExercise}
        onClose={() => setPickerOpen(false)}
      />
      {/* Floats over the list, so the Tool Kit is one tap away wherever the lifter has scrolled. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Tool Kit"
        onPress={() => setToolKitOpen(true)}
        style={({ pressed }) => [
          styles.toolKitButton,
          { bottom: insets.bottom + spacing.lg },
          pressed && styles.toolKitButtonPressed,
        ]}
      >
        <Ionicons name="calculator-outline" size={18} color={colors.text} />
        <Text style={type.button}>Tool Kit</Text>
      </Pressable>
      <ToolKitSheet visible={toolKitOpen} onClose={() => setToolKitOpen(false)} />
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
    // Room under the last card so it can scroll clear of the floating Tool Kit button.
    paddingBottom: spacing.xxl + TOOL_KIT_BUTTON_CLEARANCE,
  },
  toolKitButton: {
    position: 'absolute',
    right: layout.screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    ...glows.accentSm,
  },
  toolKitButtonPressed: {
    backgroundColor: colors.accentBright,
  },
});
