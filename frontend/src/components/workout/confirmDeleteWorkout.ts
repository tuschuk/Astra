/**
 * The "Delete this workout?" question, asked the same way from the saved workout and the edit
 * screen (LOG-9, B14).
 *
 * Deleting a finished workout removes it from the phone and, at the next sync, from the
 * lifter's account, and its records are worked out again without it — it cannot be undone, so
 * it always asks first. Two choices: "Keep it" (nothing happens) and "Delete workout", which
 * calls `onConfirm`. Uses the phone's native alert box.
 */
import { Alert } from 'react-native';

/** Shows the confirmation; `onConfirm` runs only if the lifter picks "Delete workout". */
export function confirmDeleteWorkout(onConfirm: () => void): void {
  Alert.alert(
    'Delete this workout?',
    'It is removed from this phone and your account, and your records are recalculated without it.',
    [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete workout', style: 'destructive', onPress: onConfirm },
    ],
  );
}
