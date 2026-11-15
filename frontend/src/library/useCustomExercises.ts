/**
 * `useCustomExercises` — gives a screen the signed-in lifter's live custom exercises (LIB-5, B31),
 * read from the phone's database.
 *
 * The list is re-read every time the screen comes into focus — returning to the Library after
 * deleting an exercise on its card, or to the logger after creating one on the Library tab, shows
 * the change at once — and whenever the screen calls `reload` (after its own create). Used by the
 * Library tab and both logging screens (for the "Add exercise" picker).
 *
 * Returns the list (empty until the first read lands, or if it fails — a custom-exercise read
 * failing must never block the catalog or the logger), plus the database handle and lifter id the
 * screen needs to write one.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import type { ExerciseRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { useAppDatabase } from '@/db/useAppDatabase';

import { listCustomExercises } from './customExercises';

/** What the hook hands back. */
export interface CustomExercisesState {
  /** The lifter's live custom exercises, by name. */
  customs: readonly ExerciseRow[];
  /** Re-reads the list now. */
  reload: () => Promise<void>;
  /** The phone's database, once open. */
  db: SqlDriver | null;
  /** The signed-in lifter, or null when signed out. */
  userId: string | null;
}

/**
 * Reads the signed-in lifter's live custom exercises whenever the screen gains focus.
 * No inputs (the lifter and database come from the app's providers). Output: the list, a
 * `reload` to re-read on demand, and the database and lifter id for writing one. A failed read
 * is logged and leaves the last list in place — never an error the lifter has to dismiss.
 */
export function useCustomExercises(): CustomExercisesState {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { db } = useAppDatabase();
  const [loaded, setLoaded] = useState<{ forUser: string; rows: readonly ExerciseRow[] } | null>(null);

  const reload = useCallback(async () => {
    if (!db || !userId) return;
    try {
      const rows = await listCustomExercises(db, userId);
      setLoaded({ forUser: userId, rows });
    } catch (caught) {
      console.warn('Could not read your custom exercises from the phone', caught);
    }
  }, [db, userId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Tagged by lifter, so a sign-out / sign-in never shows the previous account's list.
  const customs = loaded && loaded.forUser === userId ? loaded.rows : [];
  return { customs, reload, db, userId };
}
