/**
 * Puts the launch exercise library into the on-device database on first
 * launch, so the logger can offer "Bench Press" with no signal at all.
 *
 * Each exercise gets the same id the server's seed gave it
 * (`libraryExerciseId(slug)`), so a workout logged offline already points at
 * the right server row when it syncs.
 *
 * Two deliberate choices:
 *   - "Insert if missing", never "overwrite": once the server's copy of an
 *     exercise has been downloaded, the server is the living source (the
 *     founder may have edited it). Overwriting on every launch would put the
 *     older bundled text back.
 *   - Never queued for upload: these aren't the user's changes, and the
 *     server refuses library rows from a phone anyway.
 *
 * Seeded rows carry a 1970 timestamp, so any server copy is newer than them.
 */
import type { SqlDriver } from '@/db/driver';

import { ALL_EXERCISES } from './catalog';
import { libraryExerciseId } from './uuidv5';

/** The timestamp stamped on bundled (not-yet-downloaded) library rows. */
export const SEED_TIMESTAMP = '1970-01-01T00:00:00.000Z';

/**
 * Inserts every catalog exercise that isn't already on the device, in one
 * transaction. Safe to run on every launch: existing rows are left alone, and
 * an app update with new exercises adds only the new ones. Returns how many
 * rows were added.
 */
export async function seedLocalLibrary(db: SqlDriver): Promise<number> {
  return db.withTransactionAsync(async (tx) => {
    let added = 0;
    for (const exercise of ALL_EXERCISES) {
      const result = await tx.runAsync(
        `insert or ignore into exercises (id, owner_id, name, primary_muscle, equipment, slug, created_at, updated_at)
         values (?, null, ?, ?, ?, ?, ?, ?)`,
        [
          libraryExerciseId(exercise.id),
          exercise.name,
          exercise.primary,
          exercise.equipment,
          exercise.id,
          SEED_TIMESTAMP,
          SEED_TIMESTAMP,
        ],
      );
      added += result.changes;
    }
    return added;
  });
}
