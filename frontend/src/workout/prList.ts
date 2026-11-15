/**
 * The PR list's shape (YOU-3, B25): a lifter's current records grouped per exercise, as the profile
 * prints them. One home for the grouping, so the own list (read from the phone, `allCurrentPrs`)
 * and another lifter's (read from the server, `loadProfilePrs`) always look the same.
 *
 * It only arranges stored rows; what counts as a record, and the order record books are listed in,
 * belong to `@training-math` (`compareRecordBooks`).
 */
import { compareRecordBooks } from '@training-math';

import type { PersonalRecordRow } from '@/db/dao';

/** The parts of one record the PR list prints. */
export type ProfileRecord = Pick<PersonalRecordRow, 'id' | 'kind' | 'reps' | 'value_kg'>;

/** One exercise's current records, as the profile's PR list shows them. */
export interface ExercisePrs {
  exerciseId: string;
  /** Null when the viewer can't see the exercise's name (someone's custom exercise). */
  exerciseName: string | null;
  /** In `compareRecordBooks` order (1RM, e1RM, rep maxes by reps). */
  records: ProfileRecord[];
}

/**
 * Groups records by exercise. Input: one entry per stored record with its exercise's id and name.
 * Output: one group per exercise, ordered by name (unnamed ones last, ties by id so the order never
 * wobbles), each group's records in the usual record-book order.
 */
export function groupPrs(
  rows: readonly { exerciseId: string; exerciseName: string | null; record: ProfileRecord }[],
): ExercisePrs[] {
  const groups = new Map<string, ExercisePrs>();
  for (const { exerciseId, exerciseName, record } of rows) {
    const group = groups.get(exerciseId) ?? { exerciseId, exerciseName, records: [] };
    group.records.push(record);
    groups.set(exerciseId, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, records: [...g.records].sort(compareRecordBooks) }))
    .sort((a, b) => {
      if (a.exerciseName === b.exerciseName) return a.exerciseId < b.exerciseId ? -1 : 1;
      if (a.exerciseName === null) return 1;
      if (b.exerciseName === null) return -1;
      return a.exerciseName.localeCompare(b.exerciseName);
    });
}
