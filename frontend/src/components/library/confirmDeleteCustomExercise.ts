/**
 * The "Delete this exercise?" question for one of the lifter's own custom exercises (LIB-5, B31),
 * asked from its card before anything is removed.
 *
 * What deleting does, in the words the lifter sees: the exercise disappears from the Library and
 * the "Add exercise" picker on every phone of theirs, but the sessions they already logged — and
 * the PRs in them — stay, still under its name. There is no undo. Two choices: "Keep it" (nothing
 * happens) and "Delete exercise", which calls `onConfirm`. Uses the phone's native alert box (the
 * same pattern as deleting a workout).
 */
import { Alert } from 'react-native';

/** Shows the confirmation; `onConfirm` runs only if the lifter picks "Delete exercise". */
export function confirmDeleteCustomExercise(onConfirm: () => void): void {
  Alert.alert(
    'Delete this exercise?',
    'It is removed from your Library and the exercise picker. Workouts you already logged keep it, with their PRs.',
    [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete exercise', style: 'destructive', onPress: onConfirm },
    ],
  );
}
