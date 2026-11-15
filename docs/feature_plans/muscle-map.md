# muscle-map — B19: the muscle map on the analysis screen

**Branch:** `muscle-map` (from `main`)
**Build step:** B19 — covers **ANA-3** (muscle map of the session: a body diagram highlights the
muscle groups actually trained, driven by the exercises logged — the catalog already carries
per-exercise muscle intensities).
**Depends on:** B18 (the analysis screen this extends, `_shared/analysis` and its three-resolver
wiring), and through it the logger/sync steps that put workouts, slots, sets and the seeded
library on the phone.

## Step definition of done (from the Build order)

SVG body diagram on the analysis screen shaded from the session's exercises using the catalog's
muscle intensities. **A bench-only session highlights chest, shoulders and triceps and nothing
else.**

## Scope check

The scope is right as written and this plan stays inside it. Three readings settled up front:

- **"The session's exercises"** means the exercises that were actually *done*: a slot with at
  least one logged set of any kind. An empty slot (added to the logger, nothing performed)
  trained nothing and shades nothing. Warm-up, timed and score-only sets all count — a warm-up
  bench set still works the chest, and ANA-3 says "actually trained", not "trained heavy"
  (G2 below).
- **"The catalog's muscle intensities"** are the shading values. `PATTERN_MUSCLES` in
  `frontend/src/library/exercises.ts` already maps every exercise (via its primary pattern) to
  `muscle → intensity in (0, 1]`; this step consumes that data, it does not re-author it. Bench
  Press carries `{ chest: 1, shoulders: 0.4, triceps: 0.25 }` — exactly the three groups the
  step DoD names, which is the sign the DoD was written against this data.
- **Nothing is stored.** The map is a pure render of data already on the phone (the workout tree
  + the bundled catalog). No migration, no column on `workout_analyses`, no server change of any
  kind. If B42 ever wants the muscle summary *stored* on the analysis row, the aggregation rule
  built here is already in `_shared/analysis` where the server can import it (G1).

## Shape of the thing

Four pieces, one rule:

1. **The aggregation rule — `backend/supabase/functions/_shared/analysis/muscles.ts`** (pure TS,
   Deno-clean, same constraints as the rest of `_shared/analysis`). How a session's exercises
   combine into per-muscle intensity is *training math* and gets one home, importable by the
   server if an analysis row ever stores it — never computed in a component (CLAUDE.md's
   single-home rule; the handoff's standing instruction for this step).

   `combineMuscleLoads(maps)` — input: one `Readonly<Record<string, number>>` per performed
   exercise (its catalog intensities); output: one `Record<string, number>` for the session,
   taking **the maximum per muscle** across exercises. Max, not sum: intensities stay in the
   catalog's (0, 1] scale with no normalization step, a muscle is shaded exactly as hard as the
   hardest way it was hit, and adding a second chest exercise can never shade the chest *less*
   or push values off scale (G3 weighs sum / set-count weighting and rejects them for now).
   The function is generic over string keys so `_shared` imports nothing from the app — the
   canonical `MuscleKey` list stays where it already lives (`frontend/src/library/exercises.ts`),
   and the catalog data never crosses into the shared module (G1).
   Exported through `_shared/analysis/index.ts`; no resolver wiring changes (B18 already
   aliased the whole directory for tsconfig, Metro and Jest).

2. **The device read — `frontend/src/analysis/muscles.ts`**. `sessionMuscleLoads(db, userId,
   workoutId)`: one query for the distinct `exercises.slug` values of the workout's slots that
   have at least one set (`workout_exercises` ⋈ `sets` ⋈ `exercises`, filtered to the signed-in
   user's workout, parameterized — the same discipline as every reader in
   `frontend/src/analysis/analysis.ts`); slugs resolve to catalog entries through a module-level
   `Map` built once from `ALL_EXERCISES` (catalog `id` *is* the slug — `seedLocal.ts` wrote it
   into the device row precisely so logged rows can point back to the catalog); the per-exercise
   `muscles` records then go through `combineMuscleLoads`. Returns the session's
   `Partial<Record<MuscleKey, number>>`.

   Exercises that resolve to no catalog entry — custom exercises (`slug` null) and any row whose
   slug the bundled catalog no longer knows — contribute nothing, by design: the catalog is the
   only muscle-intensity source that exists, and guessing from `primary_muscle` text would be a
   second, worse source (G4). Recorded as a known limit: a custom-exercise-only session shows no
   map (the card hides — see the screen piece).

3. **The diagram — `frontend/src/components/MuscleMap.tsx`** + its path data in
   `frontend/src/components/muscleMapPaths.ts`. Two stylized SVG figures (front and back) drawn
   with `react-native-svg` (already a dependency at 15.16.0 — nothing new is installed). The
   paths file maps each of the twelve `MuscleKey` regions to its figure (front: chest,
   shoulders, biceps, forearms, abs, quads, calves-front-optional; back: traps, lats, triceps,
   glutes, hamstrings, calves — shoulders and forearms may appear on both, shaded identically)
   plus the neutral body outline. Hand-authored once, data not logic: the component itself just
   iterates `MUSCLE_PATHS` and sets each region's fill.

   Shading: a muscle with no load renders as the neutral outline fill (not shaded at all — the
   DoD's "nothing else" is literal); a loaded muscle fills with the theme accent at an opacity
   scaled by intensity, floored so the lightest real involvement (0.12 in the catalog) is still
   visibly on (`opacity = 0.25 + 0.75 × intensity` — deterministic, no buckets to argue over;
   G5). Color comes from `@/theme`, never hard-coded (the catalog comment already says
   "rendering color belongs to the theme").

   The paths file also carries `MUSCLE_NAMES: Record<MuscleKey, string>` — the display name of
   each key ("lats" → "Lats", "abs" → "Abs") — because the `MuscleKey` values are lowercase
   slugs and the legend and accessibility label must speak human (G9). Ordering wherever
   muscles are listed is deterministic: intensity descending, ties broken by a fixed canonical
   order in the data file (G9) — same list twice is the same list, forever.

   Accessibility (NFR-10): the SVG is decoration to a screen reader, so the component carries an
   `accessibilityLabel` naming the trained muscles in that same order ("Muscles trained: Chest,
   Shoulders, Triceps"), and each shaded region gets a `testID` (`muscle-<key>`) so Jest can
   assert the DoD without rasterizing SVG.

4. **The screen — `frontend/src/app/analysis/[id].tsx`** gains a "Muscles trained" card between
   the numbers card and the New PRs card: the two figures side by side plus a short legend line
   listing the muscles in descending intensity (the same list the accessibility label speaks —
   sighted users get names too, not just shapes). The screen's existing focus-read extends to also call
   `sessionMuscleLoads` **inside the same keyed load** (one combined read, one `setLoaded`, same
   cancelled guard) — two independent async reads could interleave across a workout-id change
   and pair one workout's numbers with another workout's muscles; one keyed state makes that
   impossible (G10). An edit that removes an exercise refreshes the map the same way it
   refreshes the numbers. When the load
   map is empty (empty finish, custom-only session, workout rows not on this phone) the card
   does not render at all — no scolding empty state on an encouraging screen (ANA-4's spirit),
   and the DoD only speaks about sessions with mapped exercises.

### Why the map reads the workout tree and not the analysis row

The stored analysis (`workout_analyses`) carries numbers and copy — no muscle data — and this
step adds no column (nothing stored, scope). The sets + catalog are already on the phone for
exactly this kind of read, offline included, and the handoff's standing input for B19 says the
map's input is the workout's sets + the catalog. The one-home rule is satisfied by *the rule*
living in `_shared/analysis`; *the inputs* stay where they already live.

## Offline / sync / privacy

- **Offline:** every input is a local read (device SQLite + the bundled catalog). The map works
  in airplane mode the moment the analysis screen does, including for a workout finished
  seconds ago. No network path exists to fail.
- **Sync:** untouched. No new table, no mirror, no cursor, no outbox, no transport change.
- **Privacy / RLS:** untouched — the map renders the user's own workout on their own phone;
  every query filters by `user_id` like its neighbours.
- **No AI, no claims:** the map is a lookup + max over founder-authored data; the legend prints
  muscle names only, no numeric performance claims anywhere.

## Data model impact

None. No server migration, no device schema version, no dao change. (`exercises.slug` and the
seeded ids already exist — B07/B09 shipped them.)

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/functions/_shared/analysis/muscles.ts` (+ `muscles.test.ts`) | new — `combineMuscleLoads`, the one home of the aggregation rule |
| `backend/supabase/functions/_shared/analysis/index.ts` | edit — re-export it |
| `frontend/src/analysis/muscles.ts` (+ test) | new — `sessionMuscleLoads`: performed slots → slugs → catalog intensities → combined loads |
| `frontend/src/components/MuscleMap.tsx` (+ test) | new — the front/back SVG figures, shading, accessibility label |
| `frontend/src/components/muscleMapPaths.ts` | new — the hand-authored region paths (data only) |
| `frontend/src/app/analysis/[id].tsx` | edit — the "Muscles trained" card; focus-read extended |
| `frontend/src/__tests__/analysis.test.tsx` | edit — the DoD test and friends (route tests never live in `src/app/`) |
| `docs/diagrams/app-flow.md` | edit (Document step) — the analysis screen's new card and its sets+catalog data path |
| `docs/diagrams/database-erd.md` | untouched — no schema change (checked, not forgotten) |

Builder footguns (precedent from B09–B18): regenerate typed routes with `npx expo start
--offline` (~150 s) **before** `tsc --noEmit` → lint → Jest — even though this step adds no
route, Jest rewrites `.expo/types/router.d.ts` and the order matters. `react-native-svg` under
Jest: jest-expo's preset transpiles it, and the components render as host components in RNTL —
assert via `testID`/props, never pixels; if the preset balks, add it to
`transformIgnorePatterns`' allowlist rather than mocking the library by hand.

## How the definitions of done become observably true

- **Step DoD (bench-only → chest, shoulders, triceps, nothing else):** a route test in
  `frontend/src/__tests__/analysis.test.tsx` seeds a finished workout whose only slot is the
  seeded library's Bench Press with logged sets, renders `/analysis/[id]`, and asserts the three
  `muscle-*` regions are shaded and **the other nine are not** — the DoD sentence as an
  assertion, through the real screen, the real reader and the real catalog row.
- **ANA-3 ("driven by the exercises logged"):** unit tests on `sessionMuscleLoads` — a
  two-exercise session (bench + squat) yields the union with per-muscle max; an empty slot
  contributes nothing; a custom exercise contributes nothing; another user's workout yields
  nothing. Unit tests on `combineMuscleLoads` — empty input → empty output; one map →
  itself; overlapping maps → per-key max; output never exceeds 1 given inputs ≤ 1.
- **Screen behaviour:** card hidden for an empty finish; legend lists muscles in descending
  intensity; accessibility label present and ordered; the card appears for a pre-B19 workout
  opened from its saved screen (no backfill needed — it is a pure read).

## Testing

All Jest, node SQLite driver, seeded local library, never the live project. The key cases are
in the DoD section; additionally: the shading math (`opacity` floor) is pinned for intensity
0.12 and 1 so a theme tweak can't silently un-shade light involvements, and
`muscleMapPaths.ts` gets a data test asserting every `MuscleKey` has at least one region, every
region names a real `MuscleKey`, and `MUSCLE_NAMES` covers all twelve keys (the only way a
typo'd key would surface before a device run).

## Out of scope (and where it lands)

- **Storing the muscle summary on `workout_analyses`** — B42's call, if trends want it; the rule
  is already in `_shared/analysis` waiting.
- **Muscle map anywhere else** (saved workout screen, feed posts, trends over weeks) — the
  component is reusable; wiring it elsewhere belongs to those steps (B20/B21/B42).
- **Per-exercise muscle overrides** (an exercise whose muscles differ from its pattern's) — a
  catalog data change, not a map change; none exist today.
- **Set-count / volume weighting of the shading** — rejected for now (G3); revisit only with a
  product reason, in the shared module, never in the component.
- **Cardio-only shading nuance** — Cardio's catalog entry (quads/hams/calves, all light) renders
  as-is; whether cardio belongs on a *strength* muscle map at all is a product question for the
  cardio steps.

## Risks a reviewer should weigh

1. **The SVG paths are hand-authored art pretending to be data.** Twelve regions × two figures
   drawn blind (no device run in the pipeline) — the real risk isn't correctness but legibility:
   regions too small, overlapping, or anatomically laughable. Mitigations: the paths live in one
   data file a human can replace wholesale without touching logic; the data test pins the
   key↔region contract; the legend + accessibility label carry the information even if the art
   is weak; Tristen's device check is the final judge and the file is built to be swapped.
2. **Slug is the only bridge from a logged row to the catalog.** A server-side rename that
   changes a slug (DEFERRED.md already calls that a deliberate content migration) would silently
   drop that exercise from maps — same failure class the library seed docs already warn about.
   The reader treats unknown slugs as "contributes nothing" rather than throwing, and the test
   suite pins that behaviour.
3. **Max-combine is a product call made by engineering.** It satisfies the DoD exactly and keeps
   the math trivial, but "8 sets of chest shades the same as 1" is a defensible complaint.
   Settled as: max now, one home, weighting is a swap inside `combineMuscleLoads` later —
   recorded so Tristen can overrule at Gate 1 without archaeology.

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session (headless: full severity, every
checkable claim verified in the repo; Gate 1 is where Tristen overrules).

- **G1 — "Why does a frontend-only render rule live in a backend directory?"** Because the
  handoff's standing instruction for this step (and CLAUDE.md's one-home rule) says the
  session→muscle aggregation is training math, importable by the server if the analysis row
  ever stores it; `_shared/analysis` is the module both runtimes already load, with resolver
  wiring in place. The *generic* form (string keys, no catalog import) is what keeps `_shared`
  dependency-free — the catalog and `MuscleKey` stay in the app, which also means the server
  could only ever store muscle data if the catalog moves shared too (B42's problem, noted
  there). Challenged alternative — put it in `frontend/src/analysis/` since only the phone
  reads it: rejected, it would be the one piece of session math living outside the shared home,
  and moving it later re-opens three resolvers for a file that could have started in the right
  place.
- **G2 — "Do warm-ups count? Does an empty slot?"** Warm-ups count: "actually trained" includes
  warm-up work (B18's copy review even insisted warm-up-only sessions are real sessions), and a
  warm-up-only bench session highlighting nothing would contradict the step's own DoD sentence
  the moment someone logs one. Empty slots don't: nothing was performed. Timed/score-only sets
  count (sets exist). This makes "performed" = "slot with ≥ 1 set row", one SQL join, no
  set-type knowledge in the map at all.
- **G3 — "Max is a lie — ten chest sets shade like one."** Weighed sum-then-normalize and
  working-set weighting. Both need a normalization constant that is pure invention (what's
  "full" shading — 10 sets? 20?), both make the shading depend on session length in ways the
  catalog's (0, 1] scale was never designed for, and the step DoD needs none of it. Max is
  deterministic, scale-preserving, and honest about what it claims: *which* muscles were
  trained and *how directly* — not how much. Kept, recorded as risk 3 for Gate 1.
- **G4 — "Custom exercises show nothing — isn't `primary_muscle` text right there?"** It is
  free-text shaped for display ("Hamstrings / Glutes", "Cardiovascular System"); parsing it into
  intensities would be a second muscle-data source with invented numbers — the mirrored-copy
  smell plus fabrication. Custom exercises get muscle data when custom-exercise authoring grows
  a muscle picker (a LIB step), and the map will consume it through the same reader. Until
  then: contributes nothing, card still renders from the session's library exercises.
- **G5 — "Continuous opacity or three buckets?"** Continuous with a floor. Buckets add a
  boundary table and legend chips to maintain for zero DoD gain; opacity directly proportional
  to the founder's own intensity numbers is the smallest honest mapping. The floor (lightest
  catalog value still visible) is pinned by test. If device viewing says light values are
  illegible, the fix is one line in the component, not a data change.
- **G6 — "Front *and* back figures — isn't one figure half the work?"** The twelve keys split
  roughly half front-visible (chest, abs, biceps, forearms, quads), half back-visible (traps,
  lats, triceps, glutes, hamstrings, calves): one figure cannot show a deadlift session at all.
  Two figures is the floor for the feature, not gold-plating. Shoulders appearing on both and
  shading identically is anatomy, not a bug.
- **G7 — "Should the map wait for the *stored* analysis so server and phone agree?"** No — there
  is nothing to agree on: the map is not part of the stored analysis (no column, scope), and
  its inputs (sets + catalog) are the same rows the local analysis already reads. Rendering it
  from the tree keeps it correct even in the stored-row window right after an edit, because the
  tree *is* the truth the staleness rule protects.
- **G8 — facts checked in the repo before the plan settled.** (a) Bench Press's only pattern is
  `Horizontal Push`, whose intensities are exactly `{ chest: 1, shoulders: 0.4, triceps: 0.25 }`
  — the step DoD's three muscles, no more, so max-combine satisfies it literally. (b) The
  shared module's discipline (`_shared/analysis/index.ts` header): `.ts`-suffixed imports, no
  packages, no I/O — `muscles.ts` must follow it. (c) The route-test kit already seeds the
  device library by slug (`analysis.test.tsx` logs `libraryExerciseId('squat')`), so the DoD
  test is `libraryExerciseId('bench_press')` plus the existing helpers — no new fixture
  machinery. (d) jest-expo's default `transformIgnorePatterns` allowlist already names
  `react-native-svg` (and the config deliberately doesn't override it), so the footgun note is
  a fallback, not an expected step. (e) `react-native-svg` 15.16.0 is in
  `frontend/package.json` — nothing is installed.
- **G9 — "The legend speaks slugs."** Caught in grilling: `MuscleKey` values are lowercase
  slugs ('lats', 'abs'); a legend printing them raw is broken copy. Settled: `MUSCLE_NAMES`
  display names live in the paths data file beside the regions, and all listings (legend +
  accessibility label) order by intensity descending with a fixed canonical tie-break, so the
  output is deterministic.
- **G10 — "Two focus reads, one screen, a stale pairing."** Caught in grilling: adding a second
  independent async read beside `analysisForScreen` could resolve after an id change and pair
  workout A's numbers with workout B's muscles. Settled: one combined keyed load (the existing
  `forId` state absorbs the muscle loads), one state set, the existing cancelled guard.
- **Scope verdict:** right as written. No migration, no sync change, no new dependency; the one
  borderline call (rule in `_shared/analysis` rather than beside the screen) is the handoff's
  explicit standing instruction, not widening.

## Build notes (builder run — deviations and additions)

- **Test helper file added:** `frontend/src/test-utils/muscleMapQueries.ts` (`muscleShapes`,
  `isShaded`), shared by the component test and the route test so the "shaded / not shaded"
  check has one definition. Not in the plan's file table; test-only.
- **How Jest sees the shading:** under RNTL 14 the SVG `Path`s are host `RNSVGPath` views with
  `testID`, `fill` (a processed colour `{type, payload}`) and `fillOpacity`; the figures are
  hidden from accessibility, so queries pass `includeHiddenElements: true` and compare `fill`
  against `processColor(colors.accent)`. No mocking of react-native-svg, no
  `transformIgnorePatterns` change (G8d held).
- **Calves are drawn on both figures** (the plan left the front calves optional) so a calf-only
  session is visible whichever figure the eye lands on. Shoulders and forearms also appear on
  both, as planned.
- **`combineMuscleLoads` ignores non-positive / non-finite values** (a 0 in the data never shows
  as trained). Not in the plan; a guard, no behaviour change for today's catalog.
- **`trainedMuscles` / `trainedMuscleNames` / `shadeOpacity` live in `MuscleMap.tsx`** (exported
  for the screen's legend and the tests); the canonical tie-break order is `MUSCLE_ORDER` in
  `muscleMapPaths.ts`, as planned.
- **The reader also filters exercise visibility** (`e.owner_id is null or e.owner_id = ?`), the
  same guard every neighbouring reader in `analysis.ts` uses. No effect today (slugged rows are
  library rows); it keeps a future slugged custom row from another account out.
- **`sessionMuscleLoads` does not check `ended_at`.** On the analysis screen it runs only after
  `analysisForScreen` has confirmed a finished workout; a future caller (B20/B21) that needs the
  finished-only guarantee must check it itself.

### Review (mattpocock-skills:code-review, builder run)

Standards: no hard violations. Judgement calls, not acted on: the muscle-table type is spelled
out in several places (a shared `MuscleIntensities` alias would touch the catalog — out of
scope); `MUSCLE_ORDER` / `MUSCLE_NAMES` could live beside `MuscleKey` in the library (kept in
the paths file per G9, the plan of record); `combineMuscleLoads` is generic and server-side with
no server caller yet (settled by G1). Fixed: the duplicated "is it trained?" check in
`MuscleMap.tsx`.

Spec: no blocking defects. Fixed: added a screen test that a custom-exercise-only session hides
the card; renamed the misnamed "union" screen test (the real multi-exercise case is the edit
test). The "pre-B19 workout" case needs no separate test: the map is a pure read of any finished
workout on the phone, which every screen test already exercises.
