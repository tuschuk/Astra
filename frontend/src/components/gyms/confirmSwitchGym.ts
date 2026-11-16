/**
 * The "Switch to RiNo?" question a lifter answers before moving to a different gym (B50, GYM-2).
 *
 * A lifter belongs to one gym at a time, so joining a new gym quietly ends the old membership.
 * The server enforces that rule regardless; this question exists so the switch is never a
 * surprise — it names the gym being left. Two choices: "Stay" (nothing happens) and "Switch
 * gyms", which calls `onConfirm`. Uses the phone's native alert box.
 */
import { Alert } from 'react-native';

/**
 * Shows the confirmation naming both gyms; `onConfirm` runs only if the lifter picks "Switch gyms".
 * `currentGym` is the gym they're in now, `nextGym` the one they tapped.
 */
export function confirmSwitchGym(currentGym: string, nextGym: string, onConfirm: () => void): void {
  Alert.alert(
    `Switch to ${nextGym}?`,
    `You can belong to one gym at a time, so this takes you out of ${currentGym}.`,
    [
      { text: 'Stay', style: 'cancel' },
      { text: 'Switch gyms', onPress: onConfirm },
    ],
  );
}
