/**
 * Which weight unit (kg or lb) the app shows and accepts — the one place screens ask.
 *
 * Why this exists: the logger (B09) has to show and read weights in the lifter's unit, but the
 * kg/lb setting itself arrives with B15 (settings and units) — `user_settings.unit` is not yet
 * copied onto the phone. Rather than every screen hard-coding pounds, they all ask this module,
 * so B15 has exactly one place to rewire to the real, synced setting.
 *
 * Today the answer is always the server's default for `user_settings.unit`: pounds. No weight
 * math lives here — converting and rounding stays in `@training-math`.
 */
import type { WeightUnit } from '@training-math';

/** The unit every account starts with (the column default of `user_settings.unit`). */
export const DEFAULT_DISPLAY_UNIT: WeightUnit = 'lb';

/**
 * The unit the signed-in lifter sees weights in. A hook so that B15 can make it follow the
 * synced setting (and re-render screens when it changes) without touching any caller.
 */
export function useDisplayUnit(): WeightUnit {
  return DEFAULT_DISPLAY_UNIT;
}
