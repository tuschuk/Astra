/**
 * The exercise catalog — the library's seed data shaped for the app.
 *
 * `exercises.ts` stores the founder's library the way it was authored: by
 * movement pattern. This module turns that into what the Library tab (and
 * later the logger and PR tracking) actually consume: one entry per unique
 * exercise, carrying everything known about it. Pure functions and data —
 * no I/O, no React.
 *
 * Why one entry per exercise: the source emits one card per name *per
 * pattern*, so exercises that train two patterns (Pushups, Leg Press, Dips…)
 * would show as duplicate cards. Here each exercise appears once, with every
 * pattern it belongs to listed in `patterns` (first = primary, used for its
 * default coaching content).
 */
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_NAME_ALIASES,
  MOVEMENT_PATTERNS,
  PATTERN_MUSCLES,
  PATTERN_NAMES,
  PATTERN_PRIMARY,
  PATTERN_STEPS,
  PATTERN_TIPS,
  type CoachingStep,
  type Equipment,
  type MuscleKey,
  type PatternName,
} from './exercises';

/** The four body regions the Library tab filters by. */
export type BodyRegion = 'upper' | 'lower' | 'core' | 'cardio';

/**
 * Which body region each movement pattern belongs to. Drives the Library
 * tab's Upper / Lower / Core / Cardio filter chips.
 */
export const PATTERN_BODY: Record<PatternName, BodyRegion> = {
  'Horizontal Push': 'upper',
  'Vertical Push': 'upper',
  'Unilateral Push': 'upper',
  'Tricep Accessory': 'upper',
  'Shoulder Accessory': 'upper',
  'Chest Accessory': 'upper',
  'Push Machine': 'upper',
  'Vertical Pull': 'upper',
  'Horizontal Pull': 'upper',
  'Posterior Upper Accessory': 'upper',
  'Bicep Accessory': 'upper',
  'Hinge': 'lower',
  'Squat Pattern': 'lower',
  'Posterior Chain Accessory': 'lower',
  'Unilateral Lower': 'lower',
  'Isolation Lower': 'lower',
  'Calves & Shins': 'lower',
  'Machine Lower': 'lower',
  'Core': 'core',
  'Bodyweight Strength Upper': 'upper',
  'Bodyweight Lower': 'lower',
  'Cardio': 'cardio',
};

/**
 * Everything the library knows about one exercise. The coaching content
 * (primary label, muscles, steps, tips) comes from the exercise's primary
 * pattern — the first pattern it appears in, in the founder's ordering.
 */
export interface ExerciseDef {
  /** Stable slug id, e.g. 'bench_press' — the future database key. */
  id: string;
  /** Canonical display name, e.g. 'Bench Press'. */
  name: string;
  /** Every movement pattern this exercise belongs to; first is primary. */
  patterns: readonly PatternName[];
  /** Body region of the primary pattern (all of an exercise's patterns agree). */
  body: BodyRegion;
  /** Human label of the muscles chiefly trained, e.g. 'Chest'. */
  primary: string;
  /** Muscle → involvement intensity in (0, 1], for the muscle map. */
  muscles: Readonly<Partial<Record<MuscleKey, number>>>;
  /** The founder's five coaching steps for the primary pattern. */
  steps: readonly CoachingStep[];
  /** Short form tips for the primary pattern. */
  tips: readonly string[];
  /** What the exercise is performed with. */
  equipment: Equipment;
}

/**
 * The UUID namespace of library-exercise identity — the contract that lets the
 * app and the database each compute the SAME `exercises.id` for a library
 * exercise without talking to each other: `uuidv5(this, slug)`. The seed
 * generator (`automation/scripts/generate-library-seed.ts`) uses it to emit the
 * ids the database stores; the logger will use it to reference library
 * exercises while offline. Fixed forever — changing it would orphan every
 * seeded row.
 */
export const LIBRARY_EXERCISE_NAMESPACE = '87cc00da-e1d2-497b-9d5b-7c0090f308be';

/** Turn an exercise name into its stable slug id ('Bench Press' → 'bench_press'). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Resolve legacy or synonymous spellings ("Squats", "Back Squat") to the one
 * canonical library name, so lookups, history and PRs all land on the same
 * exercise. Unknown names come back unchanged; matching is trim + lowercase.
 */
export function canonicalExerciseName(name: string): string {
  return EXERCISE_NAME_ALIASES[name.trim().toLowerCase()] ?? name;
}

/**
 * Expand the pattern-grouped seed into the deduplicated catalog: one
 * ExerciseDef per unique name, patterns in founder order.
 */
function buildCatalog(): ExerciseDef[] {
  const byName = new Map<string, ExerciseDef>();
  for (const pattern of PATTERN_NAMES) {
    for (const name of MOVEMENT_PATTERNS[pattern]) {
      const existing = byName.get(name);
      if (existing) {
        existing.patterns = [...existing.patterns, pattern];
        continue;
      }
      const equipment = EXERCISE_EQUIPMENT[name];
      if (!equipment) {
        // A pattern references a name with no equipment entry — the seed is
        // broken. Fail loudly at load (and in every test run) rather than
        // rendering cards with holes.
        throw new Error(`Launch library: no equipment entry for exercise "${name}"`);
      }
      byName.set(name, {
        id: slugify(name),
        name,
        patterns: [pattern],
        body: PATTERN_BODY[pattern],
        primary: PATTERN_PRIMARY[pattern],
        muscles: PATTERN_MUSCLES[pattern],
        steps: PATTERN_STEPS[pattern],
        tips: PATTERN_TIPS[pattern],
        equipment,
      });
    }
  }
  return [...byName.values()];
}

/** The full launch catalog: one entry per exercise, computed once at load. */
export const ALL_EXERCISES: readonly ExerciseDef[] = buildCatalog();

/** Every exercise name in the catalog (canonical spellings only). */
export const ALL_EXERCISE_NAMES: readonly string[] = ALL_EXERCISES.map((e) => e.name);

/**
 * Case-insensitive, alias-aware name search over the catalog. An empty or
 * whitespace query returns everything (the Library tab's resting state).
 */
export function searchExercises(
  query: string,
  exercises: readonly ExerciseDef[] = ALL_EXERCISES,
): readonly ExerciseDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return exercises;
  // When the whole query is a legacy spelling ("back squat"), also surface its
  // canonical exercise; for every other query the alias map resolves nothing.
  const alias = EXERCISE_NAME_ALIASES[q];
  return exercises.filter(
    (e) => e.name.toLowerCase().includes(q) || (alias !== undefined && e.name === alias),
  );
}
