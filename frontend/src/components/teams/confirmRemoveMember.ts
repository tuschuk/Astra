/**
 * The "Remove Pat from Iron Tribe?" question the team's owner answers before removing a member
 * (TEAM-4, B38).
 *
 * Removing someone takes them off the roster and out of the Team feed, cancels any program a
 * coach assigned them in this team and any unused invite. It is not a ban: if the team is open
 * they can join again, so the message says how to keep them out (switch the team to invite
 * only). Two choices: "Cancel" (nothing happens) and "Remove", which calls `onConfirm`. Uses the
 * phone's native alert box.
 */
import { Alert } from 'react-native';

/** Shows the confirmation naming the member and team; `onConfirm` runs only if the owner picks "Remove". */
export function confirmRemoveMember(memberName: string, teamName: string, onConfirm: () => void): void {
  Alert.alert(
    `Remove ${memberName} from ${teamName}?`,
    'They leave the roster and the Team feed. Their posts and workouts stay theirs. On an open team they can join again — switch to Invite only to keep them out.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: onConfirm },
    ],
  );
}
