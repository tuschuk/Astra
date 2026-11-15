/**
 * Synthetic workout data for database and sync tests: one user, one workout
 * with two exercises and five sets, all with fixed hand-written ids (minting
 * fresh UUIDs arrives with the active-workout store in B08).
 */
import type { SetRow, WorkoutExerciseRow, WorkoutRow } from '@/db/dao';
import { libraryExerciseId } from '@/library/uuidv5';

export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
export const T0 = '2026-11-14T09:00:00.000Z';

export const WORKOUT: WorkoutRow = {
  id: 'a0000000-0000-4000-8000-000000000001',
  user_id: USER_ID,
  title: 'Push day',
  notes: null,
  started_at: T0,
  ended_at: '2026-11-14T10:00:00.000Z',
  visibility: 'public',
  program_workout_id: null,
  created_at: T0,
  updated_at: T0,
};

export const ENTRIES: WorkoutExerciseRow[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    workout_id: WORKOUT.id,
    exercise_id: libraryExerciseId('bench_press'),
    position: 0,
    notes: null,
    superset_group: null,
    created_at: T0,
    updated_at: T0,
  },
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    workout_id: WORKOUT.id,
    exercise_id: libraryExerciseId('squat'),
    position: 1,
    notes: 'felt heavy',
    superset_group: null,
    created_at: T0,
    updated_at: T0,
  },
];

/** A set in entry `entry` at `position`, with a predictable id. */
export function makeSet(entry: number, position: number, overrides: Partial<SetRow> = {}): SetRow {
  return {
    id: `c0000000-0000-4000-8000-0000000${entry}${String(position).padStart(4, '0')}`,
    workout_exercise_id: ENTRIES[entry].id,
    position,
    reps: 5,
    weight_kg: 100 + position * 2.5,
    rpe: 8,
    is_warmup: position === 0,
    drop_set_position: null,
    duration_seconds: null,
    score: null,
    notes: null,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

export const SETS: SetRow[] = [makeSet(0, 0), makeSet(0, 1), makeSet(0, 2), makeSet(1, 0), makeSet(1, 1)];
