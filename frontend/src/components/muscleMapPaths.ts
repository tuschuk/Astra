/**
 * The drawing data of the muscle map (ANA-3): two simple body figures, front and back, and the
 * shape of each muscle group on them — plus the human name of every muscle group.
 *
 * This file is art kept as data. Nothing in it decides *what* is shaded (that comes from the
 * workout and the exercise library); it only says *where* each muscle sits on the figures. A
 * designer can replace every shape here without touching any logic, as long as each region still
 * names one of the twelve muscle keys (a test checks that).
 *
 * Coordinates are in a 100 × 220 box per figure. Most muscles are drawn once on the figure's left
 * and mirrored to the right, so the two sides always match.
 */
import type { MuscleKey } from '@/library/exercises';

/** Which of the two figures a shape belongs to. */
export type FigureSide = 'front' | 'back';

/** One muscle-group shape on one figure: which muscle it is, and its SVG path. */
export interface MuscleRegion {
  muscle: MuscleKey;
  side: FigureSide;
  d: string;
}

/** Width and height of one figure's drawing box. */
export const FIGURE_VIEWBOX = { width: 100, height: 220 } as const;

/**
 * Every muscle key in a fixed order (top of the body to the bottom). Wherever muscles are listed
 * and two have the same value, this order breaks the tie — so the same workout always reads the
 * same list.
 */
export const MUSCLE_ORDER: readonly MuscleKey[] = [
  'traps',
  'shoulders',
  'chest',
  'lats',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
];

/** The display name of each muscle key, for the legend and the screen-reader label. */
export const MUSCLE_NAMES: Record<MuscleKey, string> = {
  traps: 'Traps',
  shoulders: 'Shoulders',
  chest: 'Chest',
  lats: 'Lats',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
};

type Point = readonly [number, number];

/** A closed SVG path through the given points. */
function polygon(points: readonly Point[]): string {
  return `M${points.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
}

/** The same shape reflected across the figure's centre line, for the other side of the body. */
function mirror(points: readonly Point[]): Point[] {
  return points.map(([x, y]) => [FIGURE_VIEWBOX.width - x, y] as const);
}

/** A shape drawn on the left and mirrored to the right: both paths. */
function pair(points: readonly Point[]): string[] {
  return [polygon(points), polygon(mirror(points))];
}

/** The neutral body silhouette both figures share (head, neck, torso, arms, hands, legs, feet). */
export const BODY_OUTLINE: readonly string[] = [
  // Head
  'M41 16 a9 11 0 1 0 18 0 a9 11 0 1 0 -18 0 Z',
  // Neck
  polygon([[45, 26], [55, 26], [55, 35], [45, 35]]),
  // Torso
  polygon([[30, 35], [70, 35], [68, 70], [64, 100], [66, 112], [34, 112], [36, 100], [32, 70]]),
  // Upper arms, forearms, hands
  ...pair([[22, 37], [31, 37], [30, 73], [19, 73]]),
  ...pair([[19, 74], [29, 74], [26, 104], [17, 104]]),
  ...pair([[17, 105], [26, 105], [25, 115], [18, 115]]),
  // Thighs, shins, feet
  ...pair([[34, 112], [49, 112], [47, 161], [36, 161]]),
  ...pair([[36, 162], [47, 162], [45, 205], [38, 205]]),
  ...pair([[37, 206], [46, 206], [47, 212], [34, 212]]),
];

/** Each muscle's shape, drawn on the left half of the figure (mirrored at build time). */
const LEFT_SHAPES: readonly { muscle: MuscleKey; side: FigureSide; points: readonly Point[] }[] = [
  // Front figure
  { muscle: 'shoulders', side: 'front', points: [[24, 37], [34, 36], [32, 46], [23, 50]] },
  { muscle: 'chest', side: 'front', points: [[35, 40], [49, 40], [49, 56], [38, 58], [34, 52]] },
  { muscle: 'biceps', side: 'front', points: [[22, 52], [29, 51], [28, 70], [21, 70]] },
  { muscle: 'forearms', side: 'front', points: [[19, 77], [27, 77], [25, 100], [18, 100]] },
  { muscle: 'abs', side: 'front', points: [[42, 61], [49, 61], [49, 100], [43, 100]] },
  { muscle: 'quads', side: 'front', points: [[35, 116], [48, 116], [46, 156], [37, 156]] },
  { muscle: 'calves', side: 'front', points: [[37, 168], [46, 168], [44, 195], [39, 195]] },
  // Back figure
  { muscle: 'traps', side: 'back', points: [[43, 30], [49, 30], [49, 60], [42, 48], [33, 38]] },
  { muscle: 'shoulders', side: 'back', points: [[24, 37], [32, 36], [31, 46], [23, 50]] },
  { muscle: 'lats', side: 'back', points: [[34, 46], [41, 50], [48, 64], [47, 82], [38, 84], [33, 64]] },
  { muscle: 'triceps', side: 'back', points: [[22, 52], [29, 51], [28, 70], [21, 70]] },
  { muscle: 'forearms', side: 'back', points: [[19, 77], [27, 77], [25, 100], [18, 100]] },
  { muscle: 'glutes', side: 'back', points: [[35, 100], [49, 100], [49, 124], [36, 124]] },
  { muscle: 'hamstrings', side: 'back', points: [[36, 127], [48, 127], [46, 158], [37, 158]] },
  { muscle: 'calves', side: 'back', points: [[37, 166], [46, 166], [45, 192], [38, 192]] },
];

/** Every muscle-group shape on both figures — left and right sides — ready to draw. */
export const MUSCLE_REGIONS: readonly MuscleRegion[] = LEFT_SHAPES.flatMap(({ muscle, side, points }) =>
  pair(points).map((d) => ({ muscle, side, d })),
);
