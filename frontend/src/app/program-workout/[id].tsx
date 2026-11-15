/**
 * Program workout editor — one workout of one of the lifter's programs (PRG-1, B34), opened by
 * tapping a workout on the program page.
 *
 * What it shows: which program and week it belongs to ("Strength Block · Week 2"), the workout's
 * name in an editable box (blank shows as "Workout N"), and its exercises in order, each as a card
 * with its targets — sets, reps, a load in the lifter's kg/lb unit, and an RPE.
 *
 * What the lifter can do:
 *   - rename the workout (saves itself a moment after typing stops);
 *   - **Add exercise**: opens the same exercise picker as the logger — the whole library plus
 *     their own custom exercises — and adds the chosen one with a starting target of 3 sets;
 *   - on each exercise: change its targets and **Save targets**, move it up / down, or remove it
 *     (asks first).
 * Everything is saved on the phone at once (no signal needed) and synced later. An unknown,
 * deleted, or someone else's workout (or one inside a deleted week or program) shows "not found".
 */
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MAX_PROGRAM_WORKOUT_NAME_LENGTH } from '@training-math';

import { useAuth } from '@/auth/AuthProvider';
import { AutosaveNameField } from '@/components/programs/AutosaveNameField';
import { confirmProgramRemoval } from '@/components/programs/confirmProgramRemoval';
import { ProgramExerciseCard } from '@/components/programs/ProgramExerciseCard';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormError } from '@/components/ui/FormError';
import { Body, Heading, SectionLabel } from '@/components/ui/Text';
import { ExercisePicker, type PickedExercise } from '@/components/workout/ExercisePicker';
import { useAppDatabase } from '@/db/useAppDatabase';
import { useCustomExercises } from '@/library/useCustomExercises';
import {
  addProgramExercise,
  moveProgramExercise,
  readProgramWorkout,
  removeProgramExercise,
  renameProgramWorkout,
  updateProgramExercise,
  type ProgramWorkoutLocation,
} from '@/programs/programs';
import { useDisplayUnit } from '@/settings/displayUnit';
import { spacing } from '@/theme';

/** The targets a newly added exercise starts with — the lifter then sets the rest. */
const STARTING_TARGETS = { sets: 3, reps: null, weight: null, rpe: null } as const;

type Load =
  | { status: 'loading' }
  | { status: 'found'; location: ProgramWorkoutLocation }
  | { status: 'missing' }
  | { status: 'failed' };

export default function ProgramWorkoutScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = typeof id === 'string' ? id : '';
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db, error: dbError } = useAppDatabase();
  const { customs } = useCustomExercises();
  const unit = useDisplayUnit();
  const [loaded, setLoaded] = useState<{ forId: string; state: Load } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const state: Load = dbError
    ? { status: 'failed' }
    : !session || workoutId === ''
      ? { status: 'missing' }
      : loaded && loaded.forId === workoutId
        ? loaded.state
        : { status: 'loading' };

  /** Re-reads the workout (inside its program's tree) from the phone. */
  const refresh = useCallback(async () => {
    if (!db || !userId || workoutId === '') return;
    try {
      const location = await readProgramWorkout(db, userId, workoutId);
      setLoaded({ forId: workoutId, state: location ? { status: 'found', location } : { status: 'missing' } });
    } catch (caught) {
      console.warn('Program workout: could not read the workout', caught);
      setLoaded({ forId: workoutId, state: { status: 'failed' } });
    }
  }, [db, userId, workoutId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  /** Back to the program page (or the Programs list if there's no history). */
  function back(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/programs');
  }

  const backButton = <Button label="Back" variant="ghost" onPress={back} style={styles.back} />;

  if (state.status === 'loading') return <Screen>{backButton}</Screen>;
  if (state.status === 'missing') {
    return (
      <Screen>
        {backButton}
        <EmptyState icon="calendar-outline" message="That workout isn’t in one of your programs any more." />
      </Screen>
    );
  }
  if (state.status === 'failed' || !db || !userId) {
    return (
      <Screen>
        {backButton}
        <EmptyState icon="alert-circle-outline" message="This workout couldn’t be read from this phone." />
      </Screen>
    );
  }

  const { tree, week, workout } = state.location;
  const database = db;
  const lifter = userId;

  /** Adds the picked exercise with the starting targets, then re-reads. */
  async function addPicked(picked: PickedExercise): Promise<void> {
    setPickerOpen(false);
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      await addProgramExercise(database, lifter, workout.workout.id, {
        exerciseId: picked.deviceId,
        targets: { ...STARTING_TARGETS },
      });
      await refresh();
    } catch (caught) {
      console.warn('Program workout: could not add the exercise', caught);
      setError(`${picked.name} couldn’t be added. Try again.`);
    } finally {
      running.current = false;
    }
  }

  return (
    <Screen>
      {backButton}
      <SectionLabel size="small">{`${tree.program.name} · Week ${week.number}`}</SectionLabel>
      <Heading>{workout.label}</Heading>
      <View style={styles.nameField}>
        <AutosaveNameField
          key={workout.workout.id}
          label="Workout name"
          initial={workout.workout.name}
          placeholder={`Workout ${workout.number}`}
          save={async (text) => {
            await renameProgramWorkout(database, lifter, workout.workout.id, text);
            await refresh();
          }}
          errorMessage={`Keep the name to ${MAX_PROGRAM_WORKOUT_NAME_LENGTH} characters.`}
        />
      </View>
      <FormError message={error} />

      <SectionLabel style={styles.listLabel}>Exercises</SectionLabel>
      {workout.exercises.length === 0 ? (
        <Body variant="muted" style={styles.hint}>
          Add the exercises for this workout, then set their sets, reps and target load.
        </Body>
      ) : null}
      {workout.exercises.map((node, index) => (
        <ProgramExerciseCard
          // Keyed by slot and its saved targets/unit, so the boxes re-fill after a save or unit change.
          key={`${node.slot.id}:${node.slot.updated_at}:${unit}`}
          node={node}
          index={index}
          count={workout.exercises.length}
          unit={unit}
          onSaveTargets={async (targets) => {
            await updateProgramExercise(database, lifter, node.slot.id, targets);
            await refresh();
          }}
          onMove={async (direction) => {
            await moveProgramExercise(database, lifter, node.slot.id, direction);
            await refresh();
          }}
          onRemove={() =>
            confirmProgramRemoval('exercise', () => {
              setError(null);
              removeProgramExercise(database, lifter, node.slot.id)
                .then(refresh)
                .catch((caught: unknown) => {
                  console.warn('Program workout: could not remove the exercise', caught);
                  setError('That exercise couldn’t be removed. Try again.');
                });
            })
          }
        />
      ))}

      <Button label="Add exercise" onPress={() => setPickerOpen(true)} style={styles.add} />

      <ExercisePicker
        visible={pickerOpen}
        customExercises={customs}
        onPick={(picked) => void addPicked(picked)}
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  nameField: {
    marginTop: spacing.lg,
  },
  listLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  hint: {
    marginBottom: spacing.md,
  },
  add: {
    marginTop: spacing.md,
  },
});
