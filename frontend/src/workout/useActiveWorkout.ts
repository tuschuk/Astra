/**
 * React hooks that let a screen watch the active workout and redraw when it changes.
 *
 * Two layers, matching the two things that can change:
 *   - `useSessionWorkout`: WHICH store is active (the slot in `activeWorkoutSession.ts` — empty,
 *     then a store after Start or Resume, then empty again after Finish or Discard);
 *   - `useWorkoutSnapshot`: WHAT that store holds (its snapshot, replaced after every logged
 *     set, added exercise, reorder…).
 * Both are thin wrappers over React's `useSyncExternalStore`, which is what B08's store's
 * `subscribe` / `getSnapshot` were built for.
 */
import { useSyncExternalStore } from 'react';

import type { ActiveWorkoutSnapshot, ActiveWorkoutStore } from './activeWorkout';
import { currentSessionWorkout, subscribeSessionWorkout } from './activeWorkoutSession';

/** Subscribing to "no store" does nothing. Module-level so its identity never changes. */
function subscribeNothing(): () => void {
  return () => undefined;
}

/** The snapshot of "no store". */
function noSnapshot(): null {
  return null;
}

/**
 * The signed-in user's active-workout store from the session slot, or null when there is none
 * (or nobody is signed in). Re-renders the screen when a workout starts, resumes or ends.
 */
export function useSessionWorkout(userId: string | null): ActiveWorkoutStore | null {
  return useSyncExternalStore(subscribeSessionWorkout, () => (userId ? currentSessionWorkout(userId) : null));
}

/**
 * The current contents of `store` (its workout, exercises and sets), re-rendering after every
 * change. Null when `store` is null.
 */
export function useWorkoutSnapshot(store: ActiveWorkoutStore | null): ActiveWorkoutSnapshot | null {
  return useSyncExternalStore(store ? store.subscribe : subscribeNothing, store ? store.getSnapshot : noSnapshot);
}
