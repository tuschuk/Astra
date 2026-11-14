# launch-library-seed

**Build-list item:** LIB-7 — launch library imported from the founder's library (cues included).
Also moves LIB-1 forward: the Library tab's card grid fills in from the imported data.

**Branch:** `launch-library-seed` (off `ui-foundation`, which holds the Library screen shell).

## Source

The founder's library is Max Method's consolidated exercise module,
`MaxMethodApp/client/max-method/src/config/exercises.js` — the canonical home after Max Method's
own dedup effort. It contains:

- `MOVEMENT_PATTERNS` — 22 pattern labels → ordered exercise name lists (~140 cards, ~130 unique names)
- `EXERCISE_EQUIPMENT` — name → equipment (Barbell / Dumbbell / Cable / Machine / Bodyweight / Cardio Machine)
- `PATTERN_PRIMARY` — pattern → primary muscle label
- `PATTERN_MUSCLES` — pattern → muscle-fill colors for the body diagram (Max Method brand red + alphas)
- `PATTERN_STEPS` — pattern → 5 coaching-cue steps (HTML strings with `<strong>` emphasis)
- `PATTERN_TIPS` — pattern → 4–5 one-line tips
- `EXERCISE_NAME_ALIASES` — legacy name → canonical ("squats"/"back squat" → "Squat")
- `VIDEO_NAME_ALIASES` — frontend label → Mux video name
- `buildExerciseList` / `ALL_EXERCISES` / `ALL_EXERCISE_NAMES` — derived catalog

## What gets copied

Everything that is library content, converted to typed TypeScript in a new single-home module
`frontend/src/library/`:

- `frontend/src/library/exercises.ts` — the seed data: movement patterns, equipment map, pattern
  primary-muscle labels, muscle involvement, coaching steps, tips, name aliases.
- `frontend/src/library/catalog.ts` — the derived catalog: body-region mapping
  (upper/lower/core/cardio, matching the Library tab's four filter chips), `buildCatalog()`,
  `ALL_EXERCISES`, `ALL_EXERCISE_NAMES`, `canonicalExerciseName()`.

Conversions (data preserved, encoding changed):

1. **Muscle colors → intensities.** `PATTERN_MUSCLES` encodes involvement as Max Method brand
   colors (`#cc0404`, `rgba(204,4,4,α)`). Astra stores theme-independent numbers:
   muscle → intensity 0–1 (solid = 1.0, rgba keeps its alpha). Rendering color is the UI's job
   (styling guide owns color); ANA-3's muscle map will consume the same numbers.
2. **Coaching steps HTML → plain text with `**bold**` markers.** React Native doesn't render HTML.
   `<strong>…</strong>` becomes `**…**` so emphasis survives for the card UI to style; HTML
   entities/escapes resolved. No other tags exist in the source.
3. **One catalog entry per unique exercise name.** Max Method emits one card per name *per
   pattern* (so Pushups and Leg Press appear twice). Astra's LIB-1 wants one card per exercise;
   each entry carries `patterns: string[]` (all patterns it belongs to, source order), with
   body/primary/steps/tips resolved from its *first* (primary) pattern and the rest available.
4. **Alias keys dropped from the equipment map.** Max Method keeps `'Squats'`/`'Back Squat'` as
   duplicate equipment keys for consumers that don't normalize. Astra normalizes through
   `EXERCISE_NAME_ALIASES` + `canonicalExerciseName` from day one, so only canonical names are
   stored.

## What does NOT get copied (and why)

- **User data** — PRs, workout history, personal bests, classification state. Explicitly excluded
  by the task.
- **Strength-classification threshold tables** (`classification.js` / `levelProgress.js`) — that's
  LIB-6 / strength grades, blocked on the Strength Level data licence, and it's user-progress math,
  not library content.
- **`VIDEO_NAME_ALIASES`** — Mux-specific names for videos Astra doesn't have; the video service
  isn't chosen yet (LIB-2 / blocker table). Re-import when videos land.
- **Cardio machine selector metadata** (`cardioMachineMetadata.js`: skill floors, impact, HIIT
  suitability, injury exclusions, fatigue maps) — inputs to Max Method's program-generator scoring,
  which Astra doesn't have. The nine cardio machines themselves ARE in the library (Cardio
  pattern). Noted in DEFERRED for when programs/cardio selection exist.
- **AI exercise selector** (`AI_tools/`, `variation_families.py`, `exerciseSelector.js`) — "No AI
  in the product" rule; selector logic isn't library content.

## UI wiring

`frontend/src/app/(tabs)/library.tsx` renders the catalog as cards under its existing search field
and category chips: name, equipment pill, primary muscles, pattern. Search filters by name
(alias-aware); chips filter by body region. The LIB-7 empty state goes away; a "no results" state
replaces it when a search misses. Full card detail (steps, tips, muscle diagram, video, history)
stays with LIB-2/3/4.

## Data model note

There is no database yet (FND-2 not started). This module is the seed source of truth; when
SQLite/Supabase land, their exercise tables are seeded *from this module* (one home, no mirrored
copy — the DB row is a load, not a second authored copy). ARCHITECTURE.md's "exercises (shared
library + private custom)" table maps 1:1 onto `ExerciseDef`.

## Tests

`frontend/src/library/catalog.test.ts` + `exercises.test.ts` (Jest):

- Every exercise name in every pattern has an equipment entry; every pattern has primary label,
  muscles, 5 steps, and tips.
- Catalog dedup: one entry per unique name; multi-pattern exercises (Pushups, Leg Press, Dips,
  Pendulum Squat, …) carry all their patterns; entry count equals unique-name count.
- Intensities all within (0, 1]; each pattern has exactly one 1.0 (primary) muscle — except
  Cardio, which is all sub-maximal in the source (asserted as its own case).
- No `<strong>`/HTML remnants in any step text; `**` markers balanced.
- Alias round-trip: `canonicalExerciseName('Back Squat') === 'Squat'`, non-aliased and non-string
  inputs pass through.
- Spot-check fidelity against the source: e.g. 'Horizontal Push' pattern list, Bench Press
  equipment, squat-pattern muscle intensities.
- Library screen test updated: renders cards, search narrows, chip filters by region.

## Grilling decisions (settled)

- **Why a TS module and not wait for the DB?** LIB-7's DoD is "imported as seed data" — a typed,
  tested module the app renders from is seed data; blocking a P0 data import on FND-2 inverts the
  dependency. The DB migration later consumes this module.
- **Why dedup to one entry per name when the source emits per-pattern cards?** LIB-1's DoD is
  findability of each exercise; duplicate cards for Pushups would be a UX bug Astra would then
  have to fix against its own seed. The pattern membership is preserved losslessly in `patterns`.
- **Why intensities instead of copying the colors?** Colors are Max Method brand values; Astra's
  styling guide owns color. Copying presentation would violate the single-home theme rule.
- **Why render cards now (scope)?** The Library screen was built with an explicit "card grid
  fills in when LIB-7 is imported" seam; rendering is the observable proof the import landed.
  Detail views stay out of scope.
- **Why not port `customExercises.js`?** It's localStorage + legacy API persistence for LIB-5
  (custom exercises), a separate build item with different storage (SQLite + RLS).
- **Pattern-level cues, not per-exercise cues.** The founder's cues are authored per movement
  pattern; inventing per-exercise variants would be fabrication. Imported as-is at pattern grain.
- **Orphan equipment keys preserved.** `'Banded Tibia Raises'` exists in the source equipment map
  but in no pattern (so it never produced a card in Max Method either). Kept in the map for
  fidelity; tests assert pattern→equipment coverage, not the reverse.
- **Generated, not retyped.** The TS data file is produced by a one-off script that imports the
  source module and transforms it (colors→intensities, HTML→`**`, alias-key drop), eliminating
  transcription errors. The script is scratch tooling, not committed.
