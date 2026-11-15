# library-filters-and-detail (B29)

Covers **LIB-1** (Library tab: every exercise as a card, with search and muscle/equipment
filters — the per-muscle and equipment filters half; cards, name search and body-region chips
shipped in B03) and **LIB-3** (muscle groups and coaching cues on the card — the detail screen;
the data has been in the catalog since B03). Depends on B03 only.

Step DoD: **any launch exercise is findable by name, muscle or equipment in a few taps, and its
card shows cues and muscles.**

## What exists (B03/B19, read before planning)

- `frontend/src/library/exercises.ts` — the founder's imported library: `MOVEMENT_PATTERNS`,
  `EXERCISE_EQUIPMENT` (`Equipment` union of 6 values), `PATTERN_MUSCLES` (per-pattern
  `Partial<Record<MuscleKey, number>>` intensities in (0, 1]), `PATTERN_STEPS` (five
  `CoachingStep`s: `title` + `cue` with `**bold**` markers), `PATTERN_TIPS`, `MuscleKey`
  (12 keys).
- `frontend/src/library/catalog.ts` — `ExerciseDef` (id = slug, name, patterns, body, primary,
  muscles, steps, tips, equipment), `ALL_EXERCISES` (151), `searchExercises` (alias-aware name
  search).
- `frontend/src/app/(tabs)/library.tsx` — cards (name, equipment pill, primary-muscles line,
  region dot), name search, four body-region chips (local Pressable chips, single-select,
  re-tap clears), result count, empty state.
- `frontend/src/components/muscleMapPaths.ts` — holds `MUSCLE_ORDER` and `MUSCLE_NAMES`;
  B19's review recorded they belong beside `MuscleKey` in the library module (the map imports
  from the library, never the reverse). The handoff assigns the move to B29.
- `frontend/src/components/MuscleMap.tsx` — `trainedMuscles(loads)` already ranks a muscle
  table by involvement with the `MUSCLE_ORDER` tiebreak; the detail screen needs the same
  ranking. A second copy of that sort would be a bug (one home).

No database, sync or network involvement anywhere in this step: the catalog is bundled code,
so offline-first is satisfied by construction and the ERD is untouched.

## Approach

### 1. One home for muscle vocabulary — new `frontend/src/library/muscles.ts`

Move `MUSCLE_ORDER` and `MUSCLE_NAMES` out of `components/muscleMapPaths.ts` into a new small
`library/muscles.ts` (beside `MuscleKey`'s home; `exercises.ts` itself stays exactly the
authored founder data). Add one pure helper:

- `rankMuscles(table: Partial<Record<MuscleKey, number>>): MuscleKey[]` — the muscles with
  involvement > 0, most involved first, ties broken by `MUSCLE_ORDER`. This is
  `trainedMuscles`'s exact ordering rule, extracted so the detail screen and the muscle-map
  legend can never disagree.

Update the importers (`muscleMapPaths.ts`, `MuscleMap.tsx`, `MuscleMap.test.tsx`,
`src/__tests__/analysis.test.tsx`) — **no re-export left behind** in `muscleMapPaths.ts`; a
forwarding alias would be a second home. `MuscleMap.tsx` keeps `trainedMuscles` /
`trainedMuscleNames` (their filter-then-rank semantics are the analysis screen's concern) but
implements them via `rankMuscles`. The MuscleMap tests keep asserting that every drawn region
names a known key; the 12-key/name-completeness invariants move to a new `muscles.test.ts`
with the constants.

### 2. Muscle and equipment filters on the Library tab

`app/(tabs)/library.tsx` gains two single-select filter rows under the existing region chips,
one for the 12 muscles (labels from `MUSCLE_NAMES`, in `MUSCLE_ORDER`), one for the 6
`Equipment` values. Each is a **horizontally scrollable** row of the screen's existing chip
style (the region-chip Pressable pattern already in this file): tap to select, tap the active
chip again to clear. `ChoiceChips` is deliberately not used — it is a radio group (no
null-toggle, wraps instead of scrolling); twelve wrapping chips would push the cards below the
fold. The filters are screen-local state like `selected` today.

Filter semantics, implemented as a pure function in `catalog.ts` so the screen stays thin:

- `filterExercises(list, { body?, muscle?, equipment? })` — AND of the active criteria.
  - `body`: `exercise.body === body` (the existing region behaviour, folded in).
  - `equipment`: exact match on `exercise.equipment`.
  - `muscle`: `(exercise.muscles[muscle] ?? 0) > 0` — any involvement counts (the DoD says
    *findable* by muscle; a lifter looking for forearm work wants Farmer Carries even though
    nothing has forearms as its top muscle). To keep "a few taps" honest, when a muscle filter
    is active the result is **ordered by that muscle's involvement, descending** (ties by
    catalog order), so Chest puts the Bench Press family first, not whatever brushes chest.
    Honest granularity note: intensities are per *primary pattern*, so exercises sharing a
    pattern tie and keep founder order — the ordering's win is across patterns (Horizontal
    Push above Chest Accessory), which is the visible one.

The screen composes `searchExercises(query, filterExercises(ALL_EXERCISES, filters))`
(`Array.filter` preserves order, so the muscle ordering survives the search pass). Count
line and empty state keep working unchanged, except the empty-state copy gains "or clear the
filters" — the existing `screens.test.tsx` assertion on that copy changes with it, in the
same commit. The new chips carry the same accessibility surface as the shipped region chips
(`accessibilityRole="button"`, `accessibilityState.selected`, a spoken `Filter: <name>`
label). The header's four region chips, the search box and the new rows all remain in the
`FlatList` header, as today.

### 3. Exercise detail screen — `app/exercise/[id].tsx`

New route (id = the exercise slug), registered in `app/_layout.tsx` under the signed-in guard
(`<Stack.Screen name="exercise/[id]" />`) with the route list comment updated. **Builder
note:** a new route means the gitignored `.expo/types/router.d.ts` is stale — run
`npx expo start --offline` (~150 s) to regenerate it *before* `tsc --noEmit`, the recorded
B09 check order; Jest later rewrites that file, so keep the order expo → tsc → lint → Jest. Library cards
become tappable (`Pressable` → `router.push`); the card gains a chevron affordance so the tap
is discoverable.

The screen is a scrollable read-only view of the catalog entry, resolved by slug from
`ALL_EXERCISES` (a `Map` lookup built once in `catalog.ts`: `exerciseById(id)`):

- **Header:** name, region dot, equipment pill, movement pattern(s).
- **Muscles worked:** `rankMuscles(exercise.muscles)` rendered as `MUSCLE_NAMES` labels, most
  involved first — the same list the muscle map's legend would speak, satisfying LIB-3's
  "lists muscles worked".
- **How to do it:** the five imported coaching steps, numbered, `title` bold and `cue` below
  it — LIB-3's "imported coaching cues".
- **Tips:** the pattern's tips as a short bulleted list.
- An unknown id renders the standard `EmptyState` ("That exercise isn't in the library") with
  back navigation — reachable only via a stale deep link today, but routes must not crash.

Cue text carries `**bold**` emphasis markers from the founder's import. A tiny pure splitter,
`boldSegments(text): { text: string; bold: boolean }[]` in `frontend/src/library/cueFormat.ts`,
feeds nested `<Text>` spans; unmatched markers render literally. (First renderer of cue text
anywhere in the app, so this is new, not a move.)

### 4. Files

Create:
- `frontend/src/library/muscles.ts` (+ `muscles.test.ts`)
- `frontend/src/library/cueFormat.ts` (+ `cueFormat.test.ts`)
- `frontend/src/app/exercise/[id].tsx`
- `frontend/src/__tests__/exercise-detail.test.tsx` (route file → tests live in `__tests__`)

Change:
- `frontend/src/library/catalog.ts` — `filterExercises`, `exerciseById` (+ tests in
  `catalog.test.ts`)
- `frontend/src/app/(tabs)/library.tsx` — two filter rows, tappable cards
- `frontend/src/app/_layout.tsx` — register the route
- `frontend/src/components/muscleMapPaths.ts`, `MuscleMap.tsx`, `MuscleMap.test.tsx`,
  `src/__tests__/analysis.test.tsx`, `src/__tests__/screens.test.tsx` — vocabulary move +
  new filter/navigation tests

Documentation step (builder): update `docs/diagrams/app-flow.md` — the Library branch gains
the two filter rows and the card → detail path (lines 115–116 area), and the tab-walk notes;
the ERD is untouched. Component/function comments per the Documentation rules.

### 5. Tests (Jest, no network, bundled data only)

- `muscles.test.ts`: 12 keys, every key named, `rankMuscles` ordering (descending, zero
  excluded, `MUSCLE_ORDER` tiebreak).
- `catalog.test.ts` additions: equipment filter exact; muscle filter includes any involvement
  and orders by it; AND composition with body + search; unknown slug → `exerciseById`
  undefined.
- `cueFormat.test.ts`: plain text, one bold span, several, unmatched marker literal.
- `screens.test.tsx`: muscle chip narrows and reorders, equipment chip narrows, chips
  combine with search, re-tap clears, card tap pushes `/exercise/<slug>`.
- `exercise-detail.test.tsx`: a known slug renders name, equipment, ranked muscle names,
  all five step titles and the tips; unknown slug renders the not-found state.

### DoD, made observable

- **LIB-1:** on the Library tab, any launch exercise is reachable by (a) typing its name,
  (b) tapping its region and/or one muscle chip, or (c) one equipment chip — each a tap or
  two plus scroll; pinned by the screen tests above. BUILD_LIST flips LIB-1 In progress →
  Built at Gate 2.
- **LIB-3:** every card opens a detail screen listing muscles worked (ranked) and the five
  imported coaching steps plus tips — pinned by `exercise-detail.test.tsx` running over real
  catalog data. LIB-3 → Built at Gate 2.
- Device verification (Built → Done, Tristen): chip rows usable at phone width (two scroll
  rows under four region chips), detail screen legibility, card tap feel.

## Out of scope

- History and PRs on the detail screen — **B30** (this screen is its landing place).
- Custom exercises — **B31**.
- Demo videos (LIB-2) — blocked on the video-provider decision.
- An info/detail link from the logger's `ExercisePicker` — the handoff allowed it "if one
  line"; it is not (the picker's rows add-on-tap, so a detail link needs a second tap target).
  Deferred, noted for a later tidy-up.
- Library reading from `astra.db` instead of the bundled catalog (existing recorded gap,
  app-flow line 322) — unchanged by this step.
- Any migration, sync change, or new dependency. None needed.

## Risks

1. **Header height:** four region chips + two new rows + search may crowd small phones before
   the first card. Mitigation: the two new rows are single-line horizontal scrollers (~40 px
   each); device check judges it, fallback is collapsing the two rows behind a "Filters"
   toggle without logic changes.
2. **The vocabulary move touches B19's tested surface.** Mitigated by moving the invariants
   with the constants and keeping `trainedMuscles`'s public behaviour identical (its tests in
   `MuscleMap.test.tsx` keep passing unchanged except the import line).
3. **Muscle-filter noise:** "any involvement counts" can surface low-involvement matches.
   Mitigated by involvement-descending ordering; if device use still reads as noisy, the knob
   is a threshold constant in `filterExercises`, one line, no UI change.

## Grilling record (settled decisions)

Conducted by the planner session itself (autonomous pipeline — no interactive user; CLAUDE.md
"Autonomous sessions" delegates the gate judgment to the session). Questions below were put
adversarially and settled; the earlier draft was revised in place where an answer changed it.

- **Per-pattern intensities make the muscle ordering pattern-granular** (exercises in one
  pattern tie). Kept anyway: the cross-pattern ordering is the visible benefit; noted honestly
  in the semantics section rather than oversold.
- **Region ∧ muscle can yield guaranteed-empty combinations** (Lower + Chest). Kept as a
  plain AND with the honest empty state; auto-clearing the other filter would be silent state
  mutation, worse than an empty list with a "clear the filters" line.
- **Is result reordering scope-widening?** It is one comparator inside `filterExercises`,
  tested, serving the step DoD's "a few taps" directly — recorded here as a deliberate
  inclusion, not silent widening.
- **No markdown dependency for `**bold**` cues** — a library for one marker violates "add
  nothing speculative"; the owned splitter is ~10 lines and unit-tested.
- **Typed-routes staleness** (B09's recorded trap) is called out in the plan body so the
  builder doesn't rediscover it at tsc time.

- **Why not `ChoiceChips`?** It is a radio group that wraps; these filters need null-toggle
  and horizontal scroll. Changing the shared component for one screen is the wrong trade; the
  screen already owns an identical local chip pattern (the region chips). If a third screen
  ever needs scrollable toggle-chips, extract then.
- **Why filter logic in `catalog.ts`, not the screen?** Testable pure functions beside the
  data they filter; the screen's `useMemo` stays one line. Matches `searchExercises`.
- **Why move `MUSCLE_ORDER`/`MUSCLE_NAMES` in this step at all?** Recorded B19 review
  decision, explicitly assigned to B29 in the handoff; the detail screen is the first consumer
  outside the map, which is exactly when the wrong home would force a components → library
  back-import or a copy.
- **Why a new `muscles.ts` instead of `exercises.ts`?** `exercises.ts` is the founder's
  import, kept as authored; display vocabulary and ranking are app concerns. Same module
  (`library/`), separate file.
- **Why rank instead of threshold for the muscle filter?** A threshold hides exercises (DoD
  says *findable*); ranking keeps everything reachable while putting the strongest matches
  first. Threshold stays available as the recorded fallback knob.
- **Detail route is signed-in only** (like every non-auth route) — no new auth surface.
- **Scope check:** the step's scope line matches what B03 left undone exactly; nothing here
  widens it (no videos, no history, no DB reads). The `ExercisePicker` link was consciously
  dropped rather than half-shipped.
