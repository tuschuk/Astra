/**
 * The "Remove this…?" questions of the program builder (B34), asked before anything is removed:
 * a whole program, one week, one workout, or one exercise slot.
 *
 * What removing does, in the words the lifter sees: the part disappears from the program on every
 * phone of theirs, along with everything inside it. There is no undo. Two choices: "Keep it"
 * (nothing happens) and the destructive one, which calls `onConfirm`. Uses the phone's native
 * alert box (the same pattern as deleting a workout or a custom exercise).
 */
import { Alert } from 'react-native';

/** Which part of a program is about to be removed. */
export type ProgramPart = 'program' | 'week' | 'workout' | 'exercise';

/** The title, explanation and confirm-button text for each part. */
const COPY: { [P in ProgramPart]: { title: string; message: string; confirm: string } } = {
  program: {
    title: 'Delete this program?',
    message: 'Every week, workout and exercise in it is removed. This can’t be undone.',
    confirm: 'Delete program',
  },
  week: {
    title: 'Remove this week?',
    message: 'Its workouts and their exercises are removed with it.',
    confirm: 'Remove week',
  },
  workout: {
    title: 'Remove this workout?',
    message: 'Its exercises and targets are removed with it.',
    confirm: 'Remove workout',
  },
  exercise: {
    title: 'Remove this exercise?',
    message: 'It and its targets are removed from this workout.',
    confirm: 'Remove exercise',
  },
};

/** Shows the confirmation for `part`; `onConfirm` runs only if the lifter confirms. */
export function confirmProgramRemoval(part: ProgramPart, onConfirm: () => void): void {
  const copy = COPY[part];
  Alert.alert(copy.title, copy.message, [
    { text: 'Keep it', style: 'cancel' },
    { text: copy.confirm, style: 'destructive', onPress: onConfirm },
  ]);
}
