/**
 * The launch exercise library — Astra's seed data (LIB-7).
 *
 * Imported from the founder's Max Method library (its consolidated
 * `config/exercises.js`) on 2026-11-14 by a mechanical transform:
 *   - muscle-fill brand colors became theme-independent intensities (0-1],
 *     where 1 is the pattern's primary muscle;
 *   - coaching-step HTML emphasis (`<strong>`) became `**markers**` the UI styles;
 *   - the legacy duplicate equipment keys ('Squats', 'Back Squat') were dropped —
 *     Astra resolves those names through EXERCISE_NAME_ALIASES instead.
 *
 * This module is pure data with no imports and is the single home of the
 * shared library (see docs/feature_plans/launch-library-seed.md). When the
 * SQLite/Supabase exercise tables land (FND-2), they are seeded FROM this
 * module — never hand-copied.
 *
 * What each export holds:
 *   - PATTERN_NAMES / MOVEMENT_PATTERNS — the 22 movement patterns and the
 *     ordered exercise alternatives inside each (the founder's grouping).
 *   - EXERCISE_EQUIPMENT — what each exercise is performed with.
 *   - PATTERN_PRIMARY — the human label of a pattern's main muscles.
 *   - PATTERN_MUSCLES — muscle → involvement intensity, for muscle maps.
 *   - PATTERN_STEPS — the founder's five coaching cues per pattern.
 *   - PATTERN_TIPS — short form-tips per pattern.
 *   - EXERCISE_NAME_ALIASES — legacy spellings → canonical names.
 */

/** Every movement-pattern label in the library, in the founder's order. */
export const PATTERN_NAMES = [
  'Horizontal Push',
  'Vertical Push',
  'Unilateral Push',
  'Tricep Accessory',
  'Shoulder Accessory',
  'Chest Accessory',
  'Push Machine',
  'Vertical Pull',
  'Horizontal Pull',
  'Posterior Upper Accessory',
  'Bicep Accessory',
  'Hinge',
  'Squat Pattern',
  'Posterior Chain Accessory',
  'Unilateral Lower',
  'Isolation Lower',
  'Calves & Shins',
  'Machine Lower',
  'Core',
  'Bodyweight Strength Upper',
  'Bodyweight Lower',
  'Cardio',
] as const;

export type PatternName = (typeof PATTERN_NAMES)[number];

/** The kinds of equipment an exercise can call for. */
export type Equipment = 'Barbell' | 'Dumbbell' | 'Bodyweight' | 'Cable' | 'Machine' | 'Cardio Machine';

/** Muscle identifiers used by the involvement maps (and later the body diagram). */
export type MuscleKey = 'chest' | 'shoulders' | 'triceps' | 'traps' | 'lats' | 'biceps' | 'forearms' | 'hamstrings' | 'glutes' | 'quads' | 'calves' | 'abs';

/** One coaching cue: a short title and the instruction (with **bold** emphasis markers). */
export interface CoachingStep {
  title: string;
  cue: string;
}

/**
 * Pattern → the ordered exercise alternatives that train it. An exercise may
 * appear in more than one pattern (e.g. Pushups, Leg Press); the catalog
 * builder dedupes names and records every pattern an exercise belongs to.
 */
export const MOVEMENT_PATTERNS: Record<PatternName, readonly string[]> = {
  'Horizontal Push': ['Bench Press', 'Incline Bench Press', 'Decline Bench Press', 'Floor Press'],
  'Vertical Push': ['Military Press', 'Seated Military Press', 'Push Press'],
  'Unilateral Push': ['DB Incline Bench', 'DB Flat Bench', 'DB Shoulder Press', 'Arnold Press', 'DB Floor Press'],
  'Tricep Accessory': ['Dips', 'Weighted Dips', 'Skullcrushers', 'Tricep Pushdowns', 'Tricep Extensions', 'Dip Machine', 'Overhead Tricep Extensions', 'One Arm Extensions', 'Close Grip Bench Press'],
  'Shoulder Accessory': ['Front Raises', 'Lateral Raises', 'Cable Lateral Raises', 'Upright Rows', 'Face Pulls', 'Band Pull Aparts'],
  'Chest Accessory': ['Chest Fly Machine', 'DB Chest Flys', 'Pushups', 'Weighted Pushups', 'Floor Chest Flys', 'Incline Chest Flys', 'Cable Chest Flys', 'Low to High Cable Flys'],
  'Push Machine': ['Chest Press Machine', 'Shoulder Press Machine', 'Decline Press Machine', 'Incline Press Machine'],
  'Vertical Pull': ['Neutral Grip Pullups', 'Weighted Neutral Grip Pullups', 'Pullups', 'Weighted Pull Ups', 'Chin Ups', 'Weighted Chin Ups', 'Lat Pulldowns', 'Close Grip Lat Pulldowns', 'Wide Grip Lat Pulldowns', 'Single Arm Pulldowns'],
  'Horizontal Pull': ['Barbell Row', 'Underhand Barbell Row', 'Cable Row', 'T Bar Rows', 'Single Arm Cable Rows', 'Single Arm Dumbbell Rows', 'Chest Supported Row', 'Seal Row', 'Pendlay Row'],
  'Posterior Upper Accessory': ['Scarecrows', 'Rear Delt Flys', 'Machine Rear Delt Flys', 'Pullovers', 'Cable Pullovers', 'Shrugs', 'DB Shrugs', 'Trap Bar Shrugs', 'YTWLs'],
  'Bicep Accessory': ['DB Curls', 'Barbell Curls', 'Ez Bar Curls', 'Hammer Curls', 'Preacher Curls', 'Cable Curls', 'Rope Curls', 'Incline DB Curls', 'Concentration Curls', 'Cross Body Hammer Curls'],
  'Hinge': ['Deadlift', 'Hip Thrusts', 'Bodyweight Hip Thrusts', 'RDLs', 'Trap Bar Deadlifts', 'Barbell Glute Bridges', 'Bodyweight Glute Bridges', 'Single Leg RDLs', 'Sumo Deadlift', 'Good Mornings'],
  'Squat Pattern': ['Squat', 'Front Squat', 'SSB Squats', 'Box Squats', 'Bodyweight Squat', 'Pendulum Squat', 'Leg Press', 'Goblet Squat', 'Zercher Squat'],
  'Posterior Chain Accessory': ['Back Extensions', 'Bodyweight Back Extensions', 'Nordics', 'Reverse Hypers', 'GHD Raises', 'Single Leg Hip Thrusts'],
  'Unilateral Lower': ['Bulgarians', 'Bodyweight Bulgarians', 'Walking Lunges', 'Bodyweight Lunges', 'ATG Lunges', 'Bodyweight ATG Lunges', 'Reverse Lunges', 'Step Ups'],
  'Isolation Lower': ['Leg Extensions', 'Single Leg Extensions', 'Seated Leg Curls', 'Lying Leg Curls', 'Abductor Machine', 'Adductor Machine'],
  'Calves & Shins': ['Single Leg Calf Raises', 'Calf Raise Machine', 'Seated Calf Raises', 'Bodyweight Calf Raises', 'Weighted Calf Raises', 'Donkey Calf Raises', 'Tibia Raises', 'Tibia Curls', 'Banded Tibia Curls'],
  'Machine Lower': ['Leg Press', 'Hack Squat', 'Hack Squat Machine', 'Pendulum Squat', 'Reverse Hack Squat'],
  'Core': ['Plank', 'Ab Wheel Rollouts', 'Hanging Leg Raises', 'Cable Crunches', 'Decline Crunches', 'Pallof Press', 'Dead Bugs', 'Suitcase Carries', 'Farmer Carries'],
  'Bodyweight Strength Upper': ['Pushups', 'Incline Pushups', 'Diamond Pushups', 'Wide Pushups', 'Dips', 'Pullups', 'Chin Ups', 'Neutral Grip Pullups', 'Inverted Bodyweight Row', 'Burpees'],
  'Bodyweight Lower': ['Bodyweight Squat', 'Bodyweight Lunges', 'Bodyweight ATG Lunges', 'Bodyweight Bulgarians', 'Bodyweight Hip Thrusts', 'Bodyweight Glute Bridges', 'Bodyweight Back Extensions', 'Nordics', 'GHD Raises', 'Bodyweight Calf Raises'],
  'Cardio': ['Treadmill', 'Curved Treadmill', 'Assault Bike', 'Bike', 'Recumbent Bike', 'Elliptical', 'Stairmaster', 'Rowing Machine', 'Ski Erg'],
};

/**
 * Exercise name → equipment. Covers every exercise in MOVEMENT_PATTERNS plus
 * 'Banded Tibia Raises', which the founder's library listed without placing in
 * a pattern (kept for fidelity; it produces no card).
 */
export const EXERCISE_EQUIPMENT: Record<string, Equipment> = {
  'Bench Press': 'Barbell',
  'Incline Bench Press': 'Barbell',
  'Decline Bench Press': 'Barbell',
  'Floor Press': 'Barbell',
  'Military Press': 'Barbell',
  'Seated Military Press': 'Barbell',
  'Push Press': 'Barbell',
  'DB Incline Bench': 'Dumbbell',
  'DB Flat Bench': 'Dumbbell',
  'DB Shoulder Press': 'Dumbbell',
  'Arnold Press': 'Dumbbell',
  'DB Floor Press': 'Dumbbell',
  'Dips': 'Bodyweight',
  'Weighted Dips': 'Dumbbell',
  'Skullcrushers': 'Barbell',
  'Tricep Pushdowns': 'Cable',
  'Tricep Extensions': 'Cable',
  'Dip Machine': 'Machine',
  'Overhead Tricep Extensions': 'Cable',
  'One Arm Extensions': 'Dumbbell',
  'Close Grip Bench Press': 'Barbell',
  'Front Raises': 'Dumbbell',
  'Lateral Raises': 'Dumbbell',
  'Cable Lateral Raises': 'Cable',
  'Upright Rows': 'Barbell',
  'Face Pulls': 'Cable',
  'Band Pull Aparts': 'Dumbbell',
  'Chest Fly Machine': 'Machine',
  'DB Chest Flys': 'Dumbbell',
  'Pushups': 'Bodyweight',
  'Weighted Pushups': 'Dumbbell',
  'Floor Chest Flys': 'Dumbbell',
  'Incline Chest Flys': 'Dumbbell',
  'Cable Chest Flys': 'Cable',
  'Low to High Cable Flys': 'Cable',
  'Chest Press Machine': 'Machine',
  'Shoulder Press Machine': 'Machine',
  'Decline Press Machine': 'Machine',
  'Incline Press Machine': 'Machine',
  'Neutral Grip Pullups': 'Bodyweight',
  'Weighted Neutral Grip Pullups': 'Dumbbell',
  'Pullups': 'Bodyweight',
  'Weighted Pull Ups': 'Dumbbell',
  'Chin Ups': 'Bodyweight',
  'Weighted Chin Ups': 'Dumbbell',
  'Lat Pulldowns': 'Cable',
  'Close Grip Lat Pulldowns': 'Cable',
  'Wide Grip Lat Pulldowns': 'Cable',
  'Single Arm Pulldowns': 'Cable',
  'Barbell Row': 'Barbell',
  'Underhand Barbell Row': 'Barbell',
  'Cable Row': 'Cable',
  'T Bar Rows': 'Barbell',
  'Single Arm Cable Rows': 'Cable',
  'Single Arm Dumbbell Rows': 'Dumbbell',
  'Chest Supported Row': 'Machine',
  'Seal Row': 'Barbell',
  'Pendlay Row': 'Barbell',
  'Scarecrows': 'Dumbbell',
  'Rear Delt Flys': 'Dumbbell',
  'Machine Rear Delt Flys': 'Machine',
  'Pullovers': 'Dumbbell',
  'Cable Pullovers': 'Cable',
  'Shrugs': 'Barbell',
  'DB Shrugs': 'Dumbbell',
  'Trap Bar Shrugs': 'Barbell',
  'YTWLs': 'Dumbbell',
  'DB Curls': 'Dumbbell',
  'Barbell Curls': 'Barbell',
  'Ez Bar Curls': 'Barbell',
  'Hammer Curls': 'Dumbbell',
  'Preacher Curls': 'Barbell',
  'Cable Curls': 'Cable',
  'Rope Curls': 'Cable',
  'Incline DB Curls': 'Dumbbell',
  'Concentration Curls': 'Dumbbell',
  'Cross Body Hammer Curls': 'Dumbbell',
  'Hip Thrusts': 'Barbell',
  'Bodyweight Hip Thrusts': 'Bodyweight',
  'RDLs': 'Barbell',
  'Trap Bar Deadlifts': 'Barbell',
  'Barbell Glute Bridges': 'Barbell',
  'Bodyweight Glute Bridges': 'Bodyweight',
  'Single Leg RDLs': 'Dumbbell',
  'Sumo Deadlift': 'Barbell',
  'Good Mornings': 'Barbell',
  'Squat': 'Barbell',
  'Front Squat': 'Barbell',
  'SSB Squats': 'Barbell',
  'Box Squats': 'Barbell',
  'Bodyweight Squat': 'Bodyweight',
  'Pendulum Squat': 'Machine',
  'Leg Press': 'Machine',
  'Goblet Squat': 'Dumbbell',
  'Zercher Squat': 'Barbell',
  'Back Extensions': 'Machine',
  'Bodyweight Back Extensions': 'Bodyweight',
  'Nordics': 'Bodyweight',
  'Reverse Hypers': 'Machine',
  'GHD Raises': 'Bodyweight',
  'Single Leg Hip Thrusts': 'Barbell',
  'Bulgarians': 'Dumbbell',
  'Bodyweight Bulgarians': 'Bodyweight',
  'Walking Lunges': 'Dumbbell',
  'Bodyweight Lunges': 'Bodyweight',
  'ATG Lunges': 'Dumbbell',
  'Bodyweight ATG Lunges': 'Bodyweight',
  'Reverse Lunges': 'Dumbbell',
  'Step Ups': 'Dumbbell',
  'Leg Extensions': 'Machine',
  'Single Leg Extensions': 'Machine',
  'Seated Leg Curls': 'Machine',
  'Lying Leg Curls': 'Machine',
  'Abductor Machine': 'Machine',
  'Adductor Machine': 'Machine',
  'Single Leg Calf Raises': 'Dumbbell',
  'Calf Raise Machine': 'Machine',
  'Seated Calf Raises': 'Machine',
  'Bodyweight Calf Raises': 'Bodyweight',
  'Weighted Calf Raises': 'Dumbbell',
  'Donkey Calf Raises': 'Machine',
  'Tibia Raises': 'Bodyweight',
  'Tibia Curls': 'Machine',
  'Banded Tibia Curls': 'Bodyweight',
  'Hack Squat': 'Machine',
  'Hack Squat Machine': 'Machine',
  'Reverse Hack Squat': 'Machine',
  'Plank': 'Bodyweight',
  'Ab Wheel Rollouts': 'Bodyweight',
  'Hanging Leg Raises': 'Bodyweight',
  'Cable Crunches': 'Cable',
  'Decline Crunches': 'Bodyweight',
  'Pallof Press': 'Cable',
  'Dead Bugs': 'Bodyweight',
  'Suitcase Carries': 'Dumbbell',
  'Farmer Carries': 'Dumbbell',
  'Treadmill': 'Cardio Machine',
  'Curved Treadmill': 'Cardio Machine',
  'Assault Bike': 'Cardio Machine',
  'Bike': 'Cardio Machine',
  'Recumbent Bike': 'Cardio Machine',
  'Elliptical': 'Cardio Machine',
  'Stairmaster': 'Cardio Machine',
  'Rowing Machine': 'Cardio Machine',
  'Ski Erg': 'Cardio Machine',
  'Deadlift': 'Barbell',
  'Incline Pushups': 'Bodyweight',
  'Diamond Pushups': 'Bodyweight',
  'Wide Pushups': 'Bodyweight',
  'Inverted Bodyweight Row': 'Bodyweight',
  'Burpees': 'Bodyweight',
  'Banded Tibia Raises': 'Bodyweight',
};

/** Pattern → display label of the muscles it chiefly trains. */
export const PATTERN_PRIMARY: Record<PatternName, string> = {
  'Horizontal Push': 'Chest',
  'Vertical Push': 'Shoulders',
  'Unilateral Push': 'Chest / Shoulders',
  'Tricep Accessory': 'Triceps',
  'Shoulder Accessory': 'Shoulders',
  'Chest Accessory': 'Chest',
  'Push Machine': 'Chest / Shoulders',
  'Vertical Pull': 'Lats',
  'Horizontal Pull': 'Back',
  'Posterior Upper Accessory': 'Traps / Rear Delts',
  'Bicep Accessory': 'Biceps',
  'Hinge': 'Hamstrings / Glutes',
  'Squat Pattern': 'Quads',
  'Posterior Chain Accessory': 'Hamstrings',
  'Unilateral Lower': 'Quads / Glutes',
  'Isolation Lower': 'Hamstrings / Quads',
  'Calves & Shins': 'Calves',
  'Machine Lower': 'Quads',
  'Core': 'Core',
  'Bodyweight Strength Upper': 'Chest / Back / Triceps',
  'Bodyweight Lower': 'Quads / Glutes',
  'Cardio': 'Cardiovascular System',
};

/**
 * Pattern → muscle involvement, as intensities in (0, 1]. 1 marks the primary
 * mover; smaller values are supporting muscles. (Cardio is all sub-maximal —
 * it taxes the whole lower body lightly rather than one prime mover.)
 * Rendering color belongs to the theme, not this data.
 */
export const PATTERN_MUSCLES: Record<PatternName, Readonly<Partial<Record<MuscleKey, number>>>> = {
  'Horizontal Push': { chest: 1, shoulders: 0.4, triceps: 0.25 },
  'Vertical Push': { shoulders: 1, traps: 0.4, triceps: 0.3 },
  'Unilateral Push': { chest: 1, shoulders: 0.45, triceps: 0.25 },
  'Tricep Accessory': { triceps: 1, chest: 0.12 },
  'Shoulder Accessory': { shoulders: 1, traps: 0.35 },
  'Chest Accessory': { chest: 1, shoulders: 0.2 },
  'Push Machine': { chest: 1, shoulders: 0.3, triceps: 0.2 },
  'Vertical Pull': { lats: 1, biceps: 0.5, traps: 0.3 },
  'Horizontal Pull': { lats: 1, traps: 0.45, biceps: 0.35 },
  'Posterior Upper Accessory': { traps: 1, shoulders: 0.4, lats: 0.25 },
  'Bicep Accessory': { biceps: 1, forearms: 0.4 },
  'Hinge': { hamstrings: 1, glutes: 0.65, lats: 0.2 },
  'Squat Pattern': { quads: 1, glutes: 0.5, hamstrings: 0.2 },
  'Posterior Chain Accessory': { hamstrings: 1, glutes: 0.5 },
  'Unilateral Lower': { quads: 1, glutes: 0.55, hamstrings: 0.2 },
  'Isolation Lower': { hamstrings: 1, quads: 0.3 },
  'Calves & Shins': { calves: 1 },
  'Machine Lower': { quads: 1, glutes: 0.4 },
  'Core': { abs: 1, lats: 0.15 },
  'Bodyweight Strength Upper': { chest: 1, lats: 0.5, triceps: 0.4, shoulders: 0.3 },
  'Bodyweight Lower': { quads: 1, glutes: 0.6, hamstrings: 0.35, calves: 0.15 },
  'Cardio': { quads: 0.25, hamstrings: 0.2, calves: 0.2 },
};

/**
 * Pattern → the founder's five coaching steps, in teaching order. Text between
 * ** markers is emphasis for the card UI to render bold.
 */
export const PATTERN_STEPS: Record<PatternName, readonly CoachingStep[]> = {
  'Horizontal Push': [
    { title: 'Setup', cue: 'Lie flat on the bench. **Eyes under the bar**, feet planted firmly. Retract and depress shoulder blades.' },
    { title: 'Grip', cue: 'Take a **slightly wider than shoulder-width grip**. Wrap thumbs around the bar securely.' },
    { title: 'Descent', cue: 'Lower the bar in a slight arc to your **lower chest**. Elbows 45–75° from torso.' },
    { title: 'Press', cue: '**Drive the bar back up** explosively. Exhale at the top. Full lockout each rep.' },
    { title: 'Rack', cue: 'Return the bar to the uprights **under control**. Don\'t rush the re-rack.' },
  ],
  'Vertical Push': [
    { title: 'Stance', cue: 'Feet shoulder-width apart. Bar at **clavicle height**, grip just outside shoulders.' },
    { title: 'Brace', cue: '**Squeeze glutes and brace core** hard before pressing. This protects the lower back.' },
    { title: 'Press', cue: '**Press bar overhead** in a vertical path. Head shifts slightly forward as bar passes face.' },
    { title: 'Lockout', cue: 'Lock elbows fully. Bar directly **over mid-foot** when viewed from the side.' },
    { title: 'Lower', cue: 'Control the bar back to clavicle. **Stay tight** the entire rep.' },
  ],
  'Unilateral Push': [
    { title: 'Setup', cue: 'Position the dumbbell(s) at shoulder height. **Neutral or pronated grip** depending on variation.' },
    { title: 'Brace', cue: '**Engage your core** firmly to prevent rotation or compensation on unilateral reps.' },
    { title: 'Press', cue: 'Drive the weight in a **controlled arc or straight line**. Full range of motion every rep.' },
    { title: 'Peak', cue: '**Full extension at the top**. Feel the muscle contracting — don\'t stop short.' },
    { title: 'Lower', cue: '**Slow eccentric** back to the start. Unilateral work builds symmetry — match reps each side.' },
  ],
  'Tricep Accessory': [
    { title: 'Setup', cue: '**Position the load** — overhead, at chest, or at the cable stack depending on variation.' },
    { title: 'Elbow position', cue: '**Lock upper arms in place**. Only the forearm moves. This isolates the tricep completely.' },
    { title: 'Extend', cue: '**Extend through the elbow** fully. Tricep only fully contracts when the arm is straight.' },
    { title: 'Squeeze', cue: '**Hard lockout pause** at the end range. Hold briefly for maximum fiber recruitment.' },
    { title: 'Return', cue: 'Control the return. **Feel the tricep stretch** at the start position before the next rep.' },
  ],
  'Shoulder Accessory': [
    { title: 'Start', cue: 'Hold dumbbells or cables with a **slight elbow bend** throughout the movement.' },
    { title: 'Initiate', cue: 'Lead with your **elbows, not your hands**. Think of the elbow driving the arc.' },
    { title: 'Raise', cue: '**Lift to shoulder height** — no higher. Going past parallel recruits traps, not delts.' },
    { title: 'Control', cue: '**Don\'t swing** the weight up. Slow and deliberate = more delt activation.' },
    { title: 'Lower', cue: '**Resist on the way down**. The eccentric phase builds the shoulder equally.' },
  ],
  'Chest Accessory': [
    { title: 'Setup', cue: 'Arms in a **slight hugging arc** with elbows softly bent. Chest up, shoulders back.' },
    { title: 'Stretch', cue: 'Open arms wide, feeling a **deep stretch across the chest**. Don\'t overextend the shoulder.' },
    { title: 'Squeeze', cue: '**Bring hands together** in a controlled arc — squeeze the pecs, not the arms.' },
    { title: 'Peak', cue: 'At the top, **adduct slightly past center** for full pectoral contraction.' },
    { title: 'Return', cue: 'Slow, controlled return to the stretch position. **Constant tension on the chest** throughout.' },
  ],
  'Push Machine': [
    { title: 'Adjust', cue: 'Set seat height so handles align with **mid-chest or shoulder height**. Back flat against pad.' },
    { title: 'Grip', cue: 'Grip handles with **wrists stacked over elbows**. Relaxed grip — let the chest do the work.' },
    { title: 'Press', cue: '**Push away** in a controlled motion. Full extension without locking out the joints.' },
    { title: 'Return', cue: 'Resist the weight **on the way back**. Don\'t let the stack crash. Full stretch at the start.' },
    { title: 'Breathe', cue: '**Exhale on the press, inhale on return**. Steady rhythm throughout the set.' },
  ],
  'Vertical Pull': [
    { title: 'Hang', cue: '**Dead hang** from the bar or set the starting position. Full arm extension.' },
    { title: 'Initiate', cue: '**Depress shoulder blades** before bending the elbows — pull shoulders away from ears.' },
    { title: 'Pull', cue: 'Drive **elbows down and back**. Think about pulling the bar or handles toward your chest.' },
    { title: 'Peak', cue: '**Full contraction at the bottom** — chest to bar, elbows past the torso if range allows.' },
    { title: 'Extend', cue: '**Full arm extension every rep**. No half reps — the stretch builds the lats.' },
  ],
  'Horizontal Pull': [
    { title: 'Hinge', cue: 'Bend over with a **neutral spine**. Torso roughly 45–90° depending on variation.' },
    { title: 'Grip', cue: '**Firm grip shoulder-width or wider**. Retract shoulder blades before pulling.' },
    { title: 'Pull', cue: '**Drive elbows back and up**, pulling to your abdomen or lower chest. Lead with elbows.' },
    { title: 'Squeeze', cue: 'Hold the **top position one beat** — squeeze lats and rhomboids hard.' },
    { title: 'Lower', cue: '**Controlled descent**. Feel the lat stretch at the bottom of every rep.' },
  ],
  'Posterior Upper Accessory': [
    { title: 'Setup', cue: 'Use **light weight with controlled range**. Posterior work responds to feel, not load.' },
    { title: 'Initiate', cue: 'Lead with the **rear delt or trap**. No momentum — these muscles are often skipped.' },
    { title: 'Range', cue: 'Move through **full range of motion**. These muscles respond to stretch more than most.' },
    { title: 'Squeeze', cue: '**Pause at peak contraction**. Give these often-undertrained muscles the attention they deserve.' },
    { title: 'Return', cue: '**Slow eccentric** back to start. Upper back thickness is built on the way down.' },
  ],
  'Bicep Accessory': [
    { title: 'Setup', cue: 'Hold with a **supinated (palms up) grip**. Upper arms fixed at your sides.' },
    { title: 'Curl', cue: '**Curl upward by flexing the elbow**. Supinate the wrist through the full range.' },
    { title: 'Peak', cue: '**Squeeze the bicep hard** at the top. Wrist slightly supinated at full flex.' },
    { title: 'Lower', cue: '**Slow, controlled return** to full extension. The eccentric is where most growth happens.' },
    { title: 'Stretch', cue: '**Full extension at the bottom** every rep. Don\'t cut the range short.' },
  ],
  'Hinge': [
    { title: 'Hip hinge', cue: 'Push hips back — **not squat down**. Keep the bar or load close to the body throughout.' },
    { title: 'Spine', cue: '**Neutral spine from head to tailbone**. Brace hard before you load the hinge.' },
    { title: 'Load', cue: 'Feel the **hamstrings and glutes loading** as you hinge. Stop at full stretch.' },
    { title: 'Drive', cue: '**Drive hips forward** to stand. Squeeze glutes hard at full lockout.' },
    { title: 'Reset', cue: '**Full lockout at the top** each rep. Controlled return with the same tension.' },
  ],
  'Squat Pattern': [
    { title: 'Stance', cue: 'Feet **slightly wider than shoulder-width**, toes out 15–30°. Find your natural stance.' },
    { title: 'Brace', cue: 'Big breath in, **360° core brace**. Squeeze glutes. Hold this through the whole rep.' },
    { title: 'Descent', cue: 'Break at hips and knees simultaneously. **Push knees over toes**. Chest stays up.' },
    { title: 'Depth', cue: '**Break parallel or below** for full quad and glute development.' },
    { title: 'Drive', cue: '**Push the floor away**. Hips and shoulders rise at the same rate. Full lockout.' },
  ],
  'Posterior Chain Accessory': [
    { title: 'Setup', cue: 'Hips at the **pivot point of the machine** or hinge. Start in the lowered position.' },
    { title: 'Initiate', cue: 'Lead with **glutes and hamstrings**. Squeeze before the movement begins.' },
    { title: 'Extension', cue: '**Extend fully at the top**. Glutes squeezed, hips fully extended.' },
    { title: 'Control', cue: '**Don\'t hyperextend** the lower back. Stop at fully upright.' },
    { title: 'Lower', cue: '**Controlled descent**. Feel the glutes and hamstrings stretching on the way down.' },
  ],
  'Unilateral Lower': [
    { title: 'Setup', cue: 'Set a **correct split stance** for the variation — front foot flat, back foot in position.' },
    { title: 'Brace', cue: '**Core engaged, torso tall**. Look forward. Shoulders back and down.' },
    { title: 'Descent', cue: 'Lower with control. **Front knee tracks over the toe**. Back knee hovers above the floor.' },
    { title: 'Bottom', cue: 'Both knees near 90°. **Front knee doesn\'t cave inward**.' },
    { title: 'Drive', cue: '**Push through the front heel** to return. Complete all reps then switch sides.' },
  ],
  'Isolation Lower': [
    { title: 'Adjust', cue: 'Align the working joint with the **machine\'s axis of rotation** before you start.' },
    { title: 'Sit tall', cue: '**Upright posture**, back against the pad. Don\'t lean into the movement.' },
    { title: 'Move', cue: '**Full range, controlled pace**. Isolation means no help — feel the target muscle working.' },
    { title: 'Peak', cue: '**Pause and squeeze** at full contraction. The targeted muscle should be fully loaded.' },
    { title: 'Return', cue: '**Slow eccentric** back to start. Isolation work lives and dies on the descent.' },
  ],
  'Calves & Shins': [
    { title: 'Setup', cue: 'Ball of foot on the **edge of a step or platform**. Heels free to travel full range.' },
    { title: 'Stretch', cue: '**Lower heels below the platform** for a full stretch. Never skip this.' },
    { title: 'Rise', cue: '**Push through the ball of the foot** as high as possible. Pause at the top.' },
    { title: 'Hold', cue: '**1–2 second pause** at the top. Calves respond to peak contraction and high volume.' },
    { title: 'Lower', cue: '**Slow, deliberate descent**. No bouncing — the stretch at the bottom is where they grow.' },
  ],
  'Machine Lower': [
    { title: 'Adjust', cue: 'Set seat, back pad, and foot plate for your **limb length**. Alignment matters.' },
    { title: 'Foot position', cue: '**Shoulder-width, toes slightly out**. Higher foot = more glutes. Lower = more quads.' },
    { title: 'Move', cue: '**Full range of motion** every rep. Partials limit development significantly.' },
    { title: 'Control', cue: '**No weight stack slamming**. Resist through the full range — both directions.' },
    { title: 'Breathe', cue: '**Exhale on the effort, inhale on return**. Steady rhythm throughout.' },
  ],
  'Core': [
    { title: 'Brace', cue: '**Brace the core 360°** — outward pressure in all directions, not just sucking in.' },
    { title: 'Neutral spine', cue: '**Maintain neutral spine** throughout. Core work with a rounded back loses the benefit.' },
    { title: 'Initiate', cue: '**Lead with the abs**, not momentum. Slow and deliberate beats fast and sloppy.' },
    { title: 'Full range', cue: '**Complete the full movement**. Core exercises are often cut short, limiting effectiveness.' },
    { title: 'Breathe', cue: '**Exhale on the effort**. Holding breath during core work creates unnecessary tension.' },
  ],
  'Bodyweight Strength Upper': [
    { title: 'Setup', cue: 'No equipment needed — **position your body correctly** for the variation. Hands, rings, or bar at the right width and height.' },
    { title: 'Brace', cue: '**Full-body tension every rep**. Core tight, glutes squeezed, legs straight or planted. Bodyweight work demands total-body rigidity.' },
    { title: 'Range', cue: '**Full range of motion every rep** — chest to floor on pushups, chin over bar on pullups. Partial reps are wasted reps.' },
    { title: 'Control', cue: '**Slow the eccentric** on the way down. Lower yourself with control — tempo and tension build more strength than rushing reps.' },
    { title: 'Volume', cue: 'These movements respond to **density and quality reps**. Push for max quality, rest minimally, and focus on what the muscle feels.' },
  ],
  'Bodyweight Lower': [
    { title: 'Setup', cue: 'Position yourself for the specific variation — squat, lunge, bridge, or hinge. **No load doesn\'t mean no effort**.' },
    { title: 'Brace', cue: '**Core tight, neutral spine**. Treat every bodyweight rep as seriously as a loaded one — technique is how you progress here.' },
    { title: 'Depth', cue: '**Full range every time**. Bodyweight work relies on full ROM for development — never cut depth short.' },
    { title: 'Drive', cue: '**Push through the heel(s)** to emphasize glutes and hamstrings. For squats and lunges — knee tracks over the toes.' },
    { title: 'Tension', cue: 'Maintain **active tension throughout** — don\'t just fall into position. Control the descent and own the ascent.' },
  ],
  'Cardio': [
    { title: 'Setup', cue: 'Set your machine to a comfortable starting resistance or speed. **Begin at a warm-up pace** — don\'t start at full intensity.' },
    { title: 'Warm Up', cue: '**Gradually increase intensity** over the first 2–3 minutes. Let heart rate rise before hitting your target zone.' },
    { title: 'Effort', cue: 'Maintain your **target intensity**. Steady state: conversational pace, RPE 5–6. Intervals: push RPE 7–9 then recover fully.' },
    { title: 'Breathe', cue: '**Rhythmic, controlled breathing** throughout. Never hold your breath — exhale on the hardest effort phase.' },
    { title: 'Cool Down', cue: 'Reduce intensity for the **final 2–3 minutes**. Let heart rate come down gradually — don\'t stop abruptly.' },
  ],
};

/** Pattern → short one-line form tips. */
export const PATTERN_TIPS: Record<PatternName, readonly string[]> = {
  'Horizontal Push': [
    'Arch upper back — keeps shoulders safe',
    'Drive feet into the floor for leg drive',
    'Tuck chin slightly on descent',
    'Bar path is a slight arc, not straight down',
  ],
  'Vertical Push': [
    'Squeeze glutes to protect lower back',
    'Flare elbows slightly at the bottom',
    'Press face through at lockout',
    'Keep the bar path as vertical as possible',
  ],
  'Unilateral Push': [
    'Match reps and effort on both sides',
    'Single-arm work exposes imbalances — use it',
    'Brace extra hard to prevent hip tilt',
    'Slow the eccentric for more time under tension',
  ],
  'Tricep Accessory': [
    'Full lockout = full tricep contraction',
    'Upper arms stay pinned — no drift',
    'Lighter weight with full ROM beats heavy partials',
    'Long head needs overhead stretch to fully develop',
  ],
  'Shoulder Accessory': [
    'Elbows slightly bent throughout — never locked',
    'Raise to shoulder height only — not higher',
    'Control the lowering — slow eccentrics build delts',
    'Keep traps out of it — shoulders down',
  ],
  'Chest Accessory': [
    'Slight elbow bend throughout — no straight arms',
    'Think of hugging, not pressing',
    'Full stretch = more pec fiber recruitment',
    'Squeeze past center at the top for full contraction',
  ],
  'Push Machine': [
    'Adjust seat height every session — it matters',
    'Don\'t let weight stack touch at the bottom',
    'Full ROM always beats heavier partial reps',
    'Use to pre-fatigue or finish the muscle',
  ],
  'Vertical Pull': [
    'Initiate with scapular depression, not arm bend',
    'Think: pull elbows to hips',
    'Full dead hang at the bottom every rep',
    'Hollow body position reduces swinging',
  ],
  'Horizontal Pull': [
    'Keep a neutral spine throughout',
    'Pull in an arc, not straight up',
    'Think "elbows to the ceiling"',
    'Brace hard before every single rep',
  ],
  'Posterior Upper Accessory': [
    'Light weight, high feel — these are detail muscles',
    'Squeeze the target muscle before moving',
    'Full range beats loading on accessory moves',
    'Pair with face pulls for shoulder health',
  ],
  'Bicep Accessory': [
    'Supinate fully at the top for peak contraction',
    'Full extension at the bottom — no half reps',
    'Control the eccentric — it\'s where growth happens',
    'Pin upper arms and isolate — no swinging',
  ],
  'Hinge': [
    'Push hips back — don\'t think "bend over"',
    'Bar stays close to the body throughout',
    'Keep lats tight like protecting your armpits',
    'Don\'t chase depth past where hamstrings are loaded',
  ],
  'Squat Pattern': [
    'Knees track over toes — always',
    'Full breath before every rep',
    'Break parallel for full quad and glute development',
    'Bar position affects torso angle — experiment',
  ],
  'Posterior Chain Accessory': [
    'Full hip extension at the top — no partial reps',
    'Slow eccentrics = more hamstring recruitment',
    'These protect the knees — don\'t skip them',
    'Foundation for every big hinge lift you do',
  ],
  'Unilateral Lower': [
    'Long stride = more glute activation',
    'Keep torso tall — no forward lean',
    'Drive through the heel, not the toe',
    'These expose weakness between legs — embrace it',
  ],
  'Isolation Lower': [
    'Alignment with the machine axis is critical',
    'Full range matters more than load here',
    'Pause at peak contraction for max fiber activation',
    'Slow the eccentric — this is detail work',
  ],
  'Calves & Shins': [
    'Full range is non-negotiable — no partial reps',
    'Pause at the top for full engagement',
    'Slightly bent knee hits soleus more',
    'Calves need high volume — 15–25 reps works best',
  ],
  'Machine Lower': [
    'Never fully lock knees out — takes load off the joint',
    'Control the negative — growth happens here',
    'Foot position changes muscle emphasis significantly',
    'Don\'t let lower back lift off the pad',
  ],
  'Core': [
    'Quality over quantity — 5 perfect reps beats 20 sloppy',
    'Full body tension during every core movement',
    'Exhale on the exertion phase',
    'Core strength transfers directly to your big lifts',
  ],
  'Bodyweight Strength Upper': [
    'Full range is non-negotiable — chest to floor, chin over bar',
    'Hollow body position improves every bodyweight movement',
    'Slow the eccentric — tempo builds more strength than speed',
    'These movements build real-world, transferable upper body strength',
  ],
  'Bodyweight Lower': [
    'Full depth every rep — no shortcuts',
    'Tempo matters more than load with bodyweight',
    'Drive through the heel for maximum glute emphasis',
    'High volume works well — bodyweight lower responds to density',
  ],
  'Cardio': [
    'Keep heart rate in your target zone for your goal',
    'Steady state: conversational pace — RPE 5–6',
    'Intervals: push hard then recover fully before repeating',
    'Hydrate before, during, and after every session',
    'Consistency and frequency matter more than any single session',
  ],
};

/**
 * Lowercased legacy / synonymous spelling → canonical library name. Lets older
 * or imported data that says "Squats" or "Back Squat" resolve to the single
 * Squat card (and, later, the same PR history).
 */
export const EXERCISE_NAME_ALIASES: Record<string, string> = {
  'squats': 'Squat',
  'back squat': 'Squat',
};
