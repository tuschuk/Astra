/**
 * The "Delete Iron Tribe?" question the team's owner answers before deleting the team (B38).
 *
 * Deleting a team removes it for every member — the roster, invites, the coaches' pushes and
 * assignments, and the feed's hidden-post list — and cannot be undone. Everyone's posts,
 * workouts and programs stay with their owners, so a plain named confirm is enough (the
 * type-DELETE ritual is kept for deleting a whole account). Two choices: "Keep the team"
 * (nothing happens) and "Delete team", which calls `onConfirm`. Uses the phone's native alert box.
 */
import { Alert } from 'react-native';

/** Shows the confirmation naming the team; `onConfirm` runs only if the owner picks "Delete team". */
export function confirmDeleteTeam(teamName: string, onConfirm: () => void): void {
  Alert.alert(
    `Delete ${teamName}?`,
    'This deletes the team for everyone. Posts and workouts stay with their owners.',
    [
      { text: 'Keep the team', style: 'cancel' },
      { text: 'Delete team', style: 'destructive', onPress: onConfirm },
    ],
  );
}
