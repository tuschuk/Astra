/**
 * Which weight unit (kg or lb) the app shows and accepts — the one place screens ask.
 *
 * Why this exists: every screen that shows or reads a weight (the logger, a saved workout,
 * editing a workout, exercise history) asks this hook instead of deciding for itself, so the
 * lifter's kg/lb choice reaches all of them from one place. B09 left the seam; B15 wired it to
 * the real, synced setting: the hook now follows the unit store (settings/unitStore.ts), which
 * mirrors `user_settings.unit` on the phone. Flip the toggle in Settings and every mounted
 * weight re-draws in the new unit.
 *
 * No weight math lives here — converting and rounding stays in `@training-math`, and stored
 * weights are always kg whatever this says.
 */
import { useSyncExternalStore } from 'react';
import type { WeightUnit } from '@training-math';

import { unitStore } from './unitStore';

export { DEFAULT_DISPLAY_UNIT } from './unitStore';

/**
 * The unit the signed-in lifter sees weights in. Re-renders the calling screen whenever the
 * lifter (or a download from another of their devices) changes it.
 */
export function useDisplayUnit(): WeightUnit {
  return useSyncExternalStore(unitStore.subscribe, unitStore.getSnapshot);
}
