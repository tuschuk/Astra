/**
 * MuscleMap — the body diagram of which muscles a workout trained (ANA-3).
 *
 * What it shows: two simple figures side by side, front and back. Every muscle group the workout
 * trained is filled in Astra red — strongly for the main movers, lighter for the supporting
 * muscles — and every muscle it didn't train stays the plain body colour, not shaded at all.
 *
 * What the user can do: just look; it has no controls. A screen reader hears one sentence naming
 * the trained muscles, most direct first ("Muscles trained: Chest, Shoulders, Triceps"), because
 * the shapes alone mean nothing without sight.
 *
 * Input: the session's muscle table (from `sessionMuscleLoads`). The shapes come from
 * `muscleMapPaths.ts`, muscle names from `@/library/muscles`; the colour comes from the theme.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { SessionMuscleLoads } from '@/analysis/muscles';
import type { MuscleKey } from '@/library/exercises';
import { MUSCLE_NAMES, rankMuscles } from '@/library/muscles';
import { colors, spacing } from '@/theme';

import { BODY_OUTLINE, FIGURE_VIEWBOX, MUSCLE_REGIONS, type FigureSide } from './muscleMapPaths';

/** The faintest a trained muscle is ever drawn, so even a light supporting role stays visible. */
export const MIN_SHADE_OPACITY = 0.25;

/**
 * How strongly to fill a trained muscle: its intensity (0 to 1) mapped onto
 * `MIN_SHADE_OPACITY`…1, so the lightest real involvement in the library (0.12) is still clearly
 * on. Plan decision G5: one continuous line, no buckets.
 */
export function shadeOpacity(intensity: number): number {
  const clamped = Math.min(1, Math.max(0, intensity));
  return MIN_SHADE_OPACITY + (1 - MIN_SHADE_OPACITY) * clamped;
}

/**
 * The trained muscles in reading order: most direct first, ties broken by the fixed top-to-bottom
 * muscle order — so the same workout always lists the same way. Used by the legend and the
 * screen-reader label. The ordering rule itself is the library's `rankMuscles`, shared with the
 * exercise detail screen so the two can never disagree.
 */
export function trainedMuscles(loads: SessionMuscleLoads): MuscleKey[] {
  return rankMuscles(loads);
}

/** The trained muscles as one readable list: "Chest, Shoulders, Triceps". */
export function trainedMuscleNames(loads: SessionMuscleLoads): string {
  return trainedMuscles(loads)
    .map((m) => MUSCLE_NAMES[m])
    .join(', ');
}

export function MuscleMap({ loads }: { loads: SessionMuscleLoads }) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Muscles trained: ${trainedMuscleNames(loads)}`}
      testID="muscle-map"
    >
      <Figure side="front" loads={loads} />
      <Figure side="back" loads={loads} />
    </View>
  );
}

/** One of the two figures: the body outline, then each muscle shape on this side filled or left plain. */
function Figure({ side, loads }: { side: FigureSide; loads: SessionMuscleLoads }) {
  return (
    <Svg
      style={styles.figure}
      viewBox={`0 0 ${FIGURE_VIEWBOX.width} ${FIGURE_VIEWBOX.height}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {BODY_OUTLINE.map((d, i) => (
        <Path key={`outline-${i}`} d={d} fill={colors.surfaceHover} stroke={colors.border} strokeWidth={0.8} />
      ))}
      {MUSCLE_REGIONS.filter((r) => r.side === side).map((region, i) => {
        const intensity = loads[region.muscle] ?? 0;
        const trained = intensity > 0;
        return (
          <Path
            key={`${region.muscle}-${i}`}
            testID={`muscle-${region.muscle}`}
            d={region.d}
            fill={trained ? colors.accent : colors.surfaceDeep}
            fillOpacity={trained ? shadeOpacity(intensity) : 1}
            stroke={colors.borderStrong}
            strokeWidth={0.6}
          />
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  figure: {
    width: 120,
    height: 264,
  },
});
