/**
 * WorkoutDetailsFields — the workout's own Title and Notes boxes (LOG-3).
 *
 * What it shows: a one-line "Workout title" box and a few-lines "Notes" box, filled with what
 * the workout already says, and a message under them if a save is refused.
 *
 * What the lifter can do: type. Each box saves itself a moment after the lifter stops typing
 * (see `useAutosaveText`), so nothing typed here is lost if the app is killed; a screen that
 * provides an autosave registry can save anything still waiting before it moves on (the logger
 * does before Finish, the edit screen before Done). A blank box means no title (the saved
 * workout shows its date) or no note.
 *
 * Used by the logger (an in-progress workout) and the edit screen (a finished one, B14) —
 * it only talks to the store it is given, so it works the same for both.
 */
import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { MAX_WORKOUT_NOTES_LENGTH, MAX_WORKOUT_TITLE_LENGTH } from '@training-math';

import { FormError } from '@/components/ui/FormError';
import type { WorkoutRow } from '@/db/dao';
import type { ActiveWorkoutStore } from '@/workout/activeWorkout';
import { textErrorMessage } from '@/workout/format';
import { useAutosaveText } from '@/workout/useAutosaveText';
import { colors, layout, radii, spacing, type } from '@/theme';

export function WorkoutDetailsFields({ store, workout }: { store: ActiveWorkoutStore; workout: WorkoutRow }) {
  const title = useAutosaveText({ initial: workout.title, save: (text) => store.setTitle(text), store });
  const notes = useAutosaveText({ initial: workout.notes, save: (text) => store.setNotes(text), store });
  const error = title.error ?? notes.error;
  return (
    <View style={styles.details}>
      <TextInput
        style={[styles.input, styles.titleInput]}
        value={title.text}
        onChangeText={title.onChangeText}
        placeholder="Workout title"
        placeholderTextColor={colors.muted}
        maxLength={MAX_WORKOUT_TITLE_LENGTH}
        accessibilityLabel="Workout title"
      />
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={notes.text}
        onChangeText={notes.onChangeText}
        placeholder="Notes"
        placeholderTextColor={colors.muted}
        maxLength={MAX_WORKOUT_NOTES_LENGTH}
        multiline
        accessibilityLabel="Workout notes"
      />
      <FormError message={error ? textErrorMessage(error) : null} />
    </View>
  );
}

const styles = StyleSheet.create({
  details: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  input: {
    ...type.input,
    minHeight: layout.minTouchTarget,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
  },
  titleInput: {
    ...type.cardTitle,
  },
  notesInput: {
    // Grows with the note up to a few lines, then scrolls inside the box.
    maxHeight: 140,
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
  },
});
