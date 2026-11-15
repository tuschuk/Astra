/**
 * Test helpers for reading the muscle map (ANA-3) off a rendered screen — shared by the
 * component's own tests and the analysis-screen tests.
 *
 * The body figures are hidden from screen readers (one spoken sentence stands in for them), so
 * the queries include hidden elements. react-native-svg hands its native view the fill as a
 * processed colour number, so "is it red?" compares against the theme accent processed the same way.
 */
import { processColor } from 'react-native';
import { screen } from '@testing-library/react-native';

import type { MuscleKey } from '@/library/exercises';
import { colors } from '@/theme';

/** Every drawn shape of one muscle group (front and back, left and right). */
export function muscleShapes(muscle: MuscleKey) {
  return screen.getAllByTestId(`muscle-${muscle}`, { includeHiddenElements: true });
}

/** True when every shape of `muscle` is filled red, false when every one is plain; throws if it's mixed. */
export function isShaded(muscle: MuscleKey): boolean {
  const accent = processColor(colors.accent);
  const filled = muscleShapes(muscle).map(
    (s) => (s.props.fill as { payload?: unknown } | undefined)?.payload === accent,
  );
  if (filled.some((f) => f !== filled[0])) throw new Error(`${muscle} is only partly shaded`);
  return filled[0];
}
