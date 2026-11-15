/**
 * The "Discard this workout?" question, asked the same way from the Workout tab and the logger.
 *
 * Throwing a workout away deletes every set in it from the phone and cannot be undone, so it
 * always asks first. The lifter sees two choices: "Keep it" (nothing happens) and
 * "Discard workout", which calls `onConfirm`. Uses the phone's native alert box.
 */
import { Alert } from 'react-native';

/** Shows the confirmation; `onConfirm` runs only if the lifter picks "Discard workout". */
export function confirmDiscardWorkout(onConfirm: () => void): void {
  Alert.alert('Discard this workout?', 'Everything logged in it will be deleted from this phone.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Discard workout', style: 'destructive', onPress: onConfirm },
  ]);
}
