/**
 * The one "slot" that holds the active workout's store while the app is running.
 *
 * Why this exists: the Workout tab (which starts or resumes a workout) and the logger screen
 * (which edits it) are separate screens, but they must work on the very same store — two
 * stores for one workout would each keep their own copy in memory. This module keeps that one
 * store, so every screen that asks gets the same instance.
 *
 * The slot is only a cache. The truth is the phone's database (B08's rule): if the slot is
 * empty — the app was just relaunched, say — `resumeSessionWorkout` rebuilds the store from
 * SQLite.
 *
 * Accounts: the slot remembers whose workout it holds. Every call passes the signed-in user's
 * id; a store belonging to anyone else is never handed out, and is dropped the next time a
 * workout is started or resumed. That is the whole account-change story — no auth listener.
 * Signing out leaves the in-progress workout in the database, so signing back in offers Resume.
 */
import type { SqlDriver } from '@/db/driver';

import {
  loadActiveWorkout,
  startActiveWorkout,
  type ActiveWorkoutOptions,
  type ActiveWorkoutStore,
} from './activeWorkout';

/** What the slot holds: whose workout, and its store. */
interface Slot {
  userId: string;
  store: ActiveWorkoutStore;
}

let slot: Slot | null = null;
const listeners = new Set<() => void>();

/** Puts `next` in the slot (or empties it) and tells every subscriber, if anything changed. */
function setSlot(next: Slot | null): void {
  if (slot === next || (slot && next && slot.userId === next.userId && slot.store === next.store)) return;
  slot = next;
  listeners.forEach((listener) => listener());
}

/**
 * The store in the slot if it belongs to `userId`, else null. Never changes anything, so it is
 * safe to call while React renders (`useSessionWorkout` does).
 */
export function currentSessionWorkout(userId: string): ActiveWorkoutStore | null {
  return slot && slot.userId === userId ? slot.store : null;
}

/**
 * Starts a blank workout for `userId` (the Workout button, LOG-1) and puts its store in the
 * slot. Throws, like `startActiveWorkout`, if the user already has a workout in progress —
 * the Workout tab offers Resume instead of Start in that case, so this is a safety net.
 */
export async function startSessionWorkout(
  db: SqlDriver,
  userId: string,
  options?: ActiveWorkoutOptions,
): Promise<ActiveWorkoutStore> {
  if (slot && slot.userId !== userId) setSlot(null);
  const store = await startActiveWorkout(db, userId, options);
  setSlot({ userId, store });
  return store;
}

/**
 * The user's workout in progress, or null if there is none. Reuses the slot's store when it
 * is this user's and still active; otherwise rebuilds it from the database (`loadActiveWorkout`)
 * — which is how a workout survives the app being killed — and puts it in the slot.
 */
export async function resumeSessionWorkout(
  db: SqlDriver,
  userId: string,
  options?: ActiveWorkoutOptions,
): Promise<ActiveWorkoutStore | null> {
  if (slot && slot.userId === userId && slot.store.getStatus() === 'active') return slot.store;
  const store = await loadActiveWorkout(db, userId, options);
  setSlot(store ? { userId, store } : null);
  return store;
}

/** Empties the slot — after the workout is finished or discarded, nothing is active any more. */
export function clearSessionWorkout(): void {
  setSlot(null);
}

/** Calls `listener` whenever the slot's contents change; returns a function that stops it. */
export function subscribeSessionWorkout(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
