# tool-kit-calculators — B16: The four Tool Kit calculator screens (TK-1..TK-4, NFR-1 part)

**Branch:** `tool-kit-calculators` (from `main`)
**Build step:** B16 — covers TK-1 (1RM calculator), TK-2 (RPE calculator), TK-3 (intensity
calculator), TK-4 (plate loader) — all four whole: the math shipped in B06, the screens are this
step — and NFR-1 (partial: the Tool Kit works fully offline; the logging half of NFR-1 shipped
in B07/B09).
**Depends on:** B06 (`@training-math` — every formula already exists: `epleyE1rm`,
`weightForReps`, `workingWeightFromRpe`, `workingWeightFromPercent`, `loadBar`,
`roundToIncrement`, `displayWeight`, `lbToKg`) and B09 (the active-workout screen the sheet
opens from, `useDisplayUnit`, `parseNumberInput`).

## Step definition of done (from the Build order)

Tool Kit sheet opens from the active workout in one tap and closes without losing the user's
place; 1RM, RPE, intensity and plate-loader screens over the math module; fully offline. Each
calculator returns the module's answer in the user's unit for any input, with no network.

## Scope check

The scope sentence names one entry point: the active workout. This plan adds a second, cheap
one — the Workout tab's existing Tool Kit tiles (placeholders since B09, promising "one tap
away during any workout, even offline") become real for the four calculators, opening the same
sheet component. Reasoning: the tiles already exist and are drawn in `app-flow.md` as
scaffolding; a lifter planning at home needs the 1RM calculator without starting a workout; the
sheet is a plain component, so the tab wiring is ~15 lines and one test. The Timer tile stays a
placeholder until B17. This is the plan's one deliberate widening, noted here rather than done
silently. Everything else stays strictly inside the scope.

"In the user's unit" is read per B06's settled principle for the plate loader: plates are real
objects, so the plate screen works in the **rack's** unit (which defaults to the display unit),
never in converted plate weights. The three weight calculators use the display unit throughout.

## What this step builds

No new math anywhere — every number on these screens comes out of `@training-math`; this step
is parsing, unit conversion at the edges (`lbToKg` in, `displayWeight` out), layout and one
small device-local preference (the plate rack). No server call, no sync, no migration.

### 1. The sheet (`frontend/src/components/toolkit/ToolKitSheet.tsx`)

A React Native `Modal` (the `ExercisePicker` precedent: `visible` / `onClose` props, slide-up,
full-screen panel, safe-area aware — "sheet" in the scope is the gesture, not a half-height
spec), **not a route**:

- "Closes without losing the user's place" holds by construction — the logger stays mounted
  underneath, scroll position, keyboard state and half-typed inputs untouched. Nothing to
  restore, nothing to test beyond "the same screen is still there".
- No new route means no `.expo/types/router.d.ts` churn (the staleness footgun bitten in
  B06–B15).

**`Modal` unmounts its children when closed** — verified in RN's source
(`Modal.js`: `render()` returns null when not visible; Android immediately, iOS after
dismiss), so component state alone would reset every close, and mid-workout that means
retyping your 1RM between sets. `frontend/src/toolkit/session.ts` fixes it: a plain
module-level, in-memory record of the last selected tool and each calculator's inputs;
components initialize from it and write to it on change. Deliberately **not persisted** —
it resets on app restart (fresh session, fresh numbers), only the plate rack earns kv
persistence (§4). Being module-level it is also shared by both entry points, so a number
typed in the logger's sheet is still there when the tab's sheet opens. (`ExercisePicker`
resets its search on close *on purpose* — a picker should start fresh; a calculator
mid-workout should not.)

Inside: a header (title, close button) and a four-way switcher — 1RM | RPE | %1RM | Plates —
rendered as chips with `accessibilityRole`/`selected` state (the B15 radio-group precedent,
NFR-10 is standing). The sheet takes an optional `initialTool` so a tab tile opens straight to
its calculator; otherwise it opens on the session's last tool.

### 2. Entry points

- **Active workout** (`frontend/src/app/active-workout.tsx`): a floating "Tool Kit" pill button
  (calculator icon + label), bottom-right, rendered as a sibling of the FlatList inside the
  `Screen` — **always visible regardless of scroll position**, so it is genuinely one tap
  mid-workout. The FlatList's content bottom padding grows so the last entry card can scroll
  clear of it. (A header button was rejected: the header scrolls away in a long workout, making
  it scroll-then-tap.)
- **Workout tab** (`frontend/src/app/(tabs)/workout.tsx`): the 1RM / RPE / %1RM / Plates tiles
  become pressable and open the sheet at that tool; the Timer tile stays an inert placeholder
  (B17). The tab's top-of-file comment and the tiles' "placeholder" wording update to match.

### 3. The three weight calculators

All inputs are typed in the display unit (`useDisplayUnit`, read once in the sheet and passed
down); parsing reuses `parseNumberInput` (comma decimals already handled); weight text inputs
use `keyboardType="decimal-pad"` like the entry card. Conversion only at the edges:
parse → `lbToKg` when the unit is lb → module (kg) → `displayWeight` out. Every answer is
labeled with the unit.

- **1RM calculator (TK-1)** (`OneRmCalculator.tsx`): weight + reps (whole 1–30) →
  `epleyE1rm`, shown big. Below it, a compact "estimated weight for N reps" table
  (reps 2–10 via `weightForReps`) — the display B06 built `weightForReps` for; it turns one
  answer into a usable loading chart. **Copy carries the citation CLAUDE.md requires** (the
  open item HANDOFF assigns to this screen): the result is labeled an estimate and the screen
  cites the formula's published source — "Estimated with the Epley formula: weight × (1 + reps
  ÷ 30). Epley, B. (1985), *Poundage Chart*, Boyd Epley Workout, Body Enterprises." — plus the
  B06-settled rule stated plainly: a performed single counts as its own 1RM, not an estimate.
- **RPE calculator (TK-2)** (`RpeCalculator.tsx`): 1RM (weight input) + target reps (stepper or
  chips, 1–12) + RPE (chips, 6–10 in 0.5 steps). Bounded controls, not free text, so the
  module's domain can't be left — `RangeError` stays the backstop it was designed as, not a UX
  path. Answer: `workingWeightFromRpe` → `displayWeight`, shown big (the module's answer, per
  the step DoD), with a secondary "loadable" line snapped via `roundToIncrement` — 2.5 kg or
  5 lb by unit (the increments B06's plan reserved for B16). Snapping to the smallest inventory
  plate pair is deliberately not done — it would couple this calculator to the plate rack for a
  marginal refinement; the fixed step is what every published program uses.
- **Intensity calculator (TK-3)** (`IntensityCalculator.tsx`): 1RM + percent (free numeric,
  decimals allowed, validated to (0, 150] before the call; out-of-range shows an inline message
  naming the bounds, mirroring `MAX_PERCENT` rather than hard-coding 150 in two places).
  Answer: `workingWeightFromPercent`, same big-answer + loadable-line treatment as RPE.

Shared pieces (planned, not discovered later, since all three need them):
`components/toolkit/WeightField.tsx` (labeled weight input with unit suffix and inline error)
and `components/toolkit/ResultCard.tsx` (the big answer + secondary line). Anything else is
extracted only when a third copy appears.

### 4. The plate loader (TK-4) (`PlateLoader.tsx` + `frontend/src/toolkit/plateRack.ts`)

**The rack model** (`plateRack.ts`): `PlateRackConfig { barWeight: number; plates:
PlateInventoryItem[] }` (the module's own inventory type — counts are per side, as B06's G6
settled). The stored shape holds **one rack per unit**: `{ kg: PlateRackConfig; lb:
PlateRackConfig }`, so switching units never destroys the other unit's edits. Defaults: kg —
bar 20, per side 2×25, 2×20, 1×15, 1×10, 1×5, 1×2.5, 1×1.25; lb — bar 45, per side 4×45, 1×35,
1×25, 2×10, 1×5, 1×2.5. (A fully stocked commercial rack; the point of the editor is that any
real rack is a few taps away.)

**The screen**: target weight and bar weight inputs, the rack's plate list as rows (plate size,
a − / + per-side count stepper, remove), an "add plate size" input (any positive weight —
micro-plates are the reason custom sizes exist), and a kg | lb rack-unit toggle that switches
to that unit's remembered rack. Everything on this screen — target included — is in the
**rack's unit**, stated in the labels; the rack unit defaults to the display unit the first
time the screen is used. Answer: `loadBar(target, bar, plates)` rendered as per-side rows
("2 × 25 kg" …), the loaded total, and the remainder states in plain words: exact hit; "short
by X — this rack can't make the target"; "the bar alone is over the target".

**Where the rack lives — the open decision HANDOFF left to this planner:** device-only, in
`expo-sqlite/kv-store` (already a dependency; the B07 session-store precedent) under one key,
as JSON with a version field. Not a `user_settings` column, because syncing it is speculative
three times over: nobody asked for cross-device racks, the rack describes a *place* (the gym
you're standing in), and a column would drag a migration plus push/pull/mirror work into a step
whose scope is screens. Not per-user either: a rack is shared physical equipment, not training
data — two accounts on one phone lift on the same plates; nothing sensitive, no RLS concern
(the privacy rule governs body data, progress pics and recovery, not plate counts). Recorded
here so Gate 1 can overrule. `plateRack.ts` owns load (damaged or missing JSON → defaults,
never a crash), save (fire-and-forget on change, failure logged and tolerated — worst case the
rack resets next launch), and the defaults.

### 5. Offline (NFR-1's Tool Kit half)

True by construction and kept that way: the sheet and calculators import only `@training-math`,
React Native, the theme, and `plateRack.ts` (kv-store). No transport, no Supabase client, no
fetch — the review re-checks the import graph. The step DoD's "with no network" is proven by
the tests, which run with no transport fake at all (nothing to fake).

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/toolkit/plateRack.ts` (+ test) | new — rack types, per-unit defaults, kv load/save with corruption tolerance (§4) |
| `frontend/src/toolkit/session.ts` (+ test) | new — in-memory last-inputs record shared by both entry points (§1) |
| `frontend/src/components/toolkit/ToolKitSheet.tsx` (+ test) | new — the Modal sheet + tool switcher (§1) |
| `frontend/src/components/toolkit/OneRmCalculator.tsx` (+ test) | new — TK-1 screen incl. Epley citation copy (§3) |
| `frontend/src/components/toolkit/RpeCalculator.tsx` (+ test) | new — TK-2 screen (§3) |
| `frontend/src/components/toolkit/IntensityCalculator.tsx` (+ test) | new — TK-3 screen (§3) |
| `frontend/src/components/toolkit/PlateLoader.tsx` (+ test) | new — TK-4 screen (§4) |
| `frontend/src/components/toolkit/WeightField.tsx`, `ResultCard.tsx` | new — shared input/answer pieces (§3; tested through the calculators) |
| `frontend/src/app/active-workout.tsx` | edit — floating Tool Kit button + sheet (§2) |
| `frontend/src/app/(tabs)/workout.tsx` | edit — four tiles open the sheet; Timer stays placeholder (§2) |
| `frontend/src/__tests__/tool-kit.test.tsx` | new — route-level: open from logger, open from tab tile, logger state intact after close |
| `docs/diagrams/app-flow.md` | Document step — Tool Kit sheet node, its two entry paths, the kv-store rack; `@training-math`'s TK functions no longer marked unconsumed |
| `docs/diagrams/database-erd.md` | untouched — no schema change on either side |
| `docs/BUILD_LIST.md` | untouched — status flips at Gate 2 |

## Data model impact

**None.** No server migration, no device schema change, no new synced table. The plate rack is
one JSON value in the kv-store (not part of `astra.db`'s mirror schema); it appears in
`app-flow.md`, not the ERD. No route is added, so no typed-routes regeneration is strictly
required — the builder still runs the established order (`npx expo start` → `tsc` → lint →
Jest) because Gate 2 does.

## How each definition of done becomes observably true

- **TK-1** — `OneRmCalculator.test.tsx`: type 100 / 5 with unit kg → shows exactly
  `displayWeight(epleyE1rm(100, 5), 'kg')` ("116.7 kg"); type 225 / 5 with unit lb → shows
  `displayWeight(epleyE1rm(lbToKg(225), 5), 'lb')` (the test computes the expectation **through
  the module**, never a re-derived constant — the "math in `@training-math`" clause stays
  observable); reps 1 shows the entered weight itself; the citation text is asserted present.
- **TK-2** — `RpeCalculator.test.tsx`: 150 kg 1RM, 5 reps @ RPE 8 → the module's
  `workingWeightFromRpe` answer in kg, and the lb path through the same fixture; half-step RPE
  selectable; bounds unreachable through the UI.
- **TK-3** — `IntensityCalculator.test.tsx`: 100 kg @ 85 % → module answer; >100 % works
  (overload); 0 and >150 refused with the inline message, module never called out of domain.
- **TK-4** — `PlateLoader.test.tsx`: default lb rack, target 225, bar 45 → "2 × 45 lb" per
  side; editing counts changes the answer; an unreachable target shows the shortfall; target
  under bar shows the bar-too-heavy state; custom micro-plate size addable;
  `plateRack.test.ts`: round-trip through the kv fake, corrupted JSON → defaults, per-unit
  racks independent.
- **Step DoD (one tap, place kept, offline)** — `tool-kit.test.tsx`: from a seeded active
  workout, one `fireEvent.press` on the floating button shows the sheet; entering values,
  closing, and reopening finds the logger's entries intact and the calculator inputs restored
  (from `session.ts` — the Modal remounts its children, so this is the session store's test,
  not an accident of mounting); a tab tile opens the sheet at its tool. All tests run with no
  transport and no network mock — there is nothing to mock, which is the proof.
- **NFR-1 (this step's part)** — the above plus the import-graph check in review. The feature
  stays In progress at Gate 2 (its logging half already shipped; the whole flips on Tristen's
  airplane-mode device run).

## Out of scope (this branch)

- **Timer / stopwatch (TK-5)** — B17; its tile stays a placeholder.
- **Prefill from the exercise in progress and stored PRs (TK-6)** — B43 (depends on B13 + this
  step). The sheet's `initialTool` prop is the only seam B43 needs; no PR reads here.
- **Syncing the plate rack** or putting it in `user_settings` — rejected above (§4).
- **Inventory-aware snapping** in the RPE/intensity calculators (§3).
- **New math of any kind** — anything missing from the module would be a B06 follow-up landing
  *in the module*, never beside it; this plan needs nothing the module doesn't have.
- Per-calculator history, favorites, or remembering past inputs beyond component lifetime.

## Risks a reviewer should weigh

1. **The plate loader's unit semantics.** The screen works in the rack's unit, defaulting to —
   but not following — the display unit (a lifter who flips to kg in Settings keeps their lb
   rack until they switch it on the plate screen). This is deliberate (plates are objects; B06
   settled it) but it is the one place the step DoD's "in the user's unit" is interpreted
   rather than literal. The per-unit remembered racks make the toggle lossless either way.
2. **The floating button at phone width.** It overlays the list and sits near the keyboard's
   territory; RNTL cannot verify layout. If it crowds the entry card's Log button on a real
   phone, the fallback is a header button (worse reachability, zero overlap). Tristen's device
   check covers it; flagged for the Built → Done run.
3. **Device-only, device-shared rack storage** (§4): not synced, not per-user. If Gate 1 wants
   per-user racks or a synced column, the change is contained in `plateRack.ts` (its key/shape)
   or a future step (a column), respectively.
4. **Two stores with different lifetimes.** The plate rack persists (kv), calculator inputs
   don't (in-memory `session.ts`), and the Modal unmounts everything between opens. The split
   is deliberate — equipment is durable, numbers are per-session — but a reviewer should check
   the builder didn't blur it (e.g. by persisting session inputs or holding rack state only in
   a component).

## Grilling decisions (settled before code)

Run via `mattpocock-skills:grilling`; headless pipeline run, so the planner worked the attack
tree itself at full severity (B08–B15 precedent), verifying every checkable claim in the repo
(module exports and domains, `ExercisePicker`'s Modal pattern, the kv-store dependency, the
tab tiles' placeholder status, `parseNumberInput`'s comma handling). Gate 1 is where Tristen
overrules.

- **"You claimed the sheet keeps state because Modal children stay mounted — true?"** False,
  and the grilling caught it: RN's `Modal.render()` returns null when not visible (checked in
  the installed `react-native/Libraries/Modal/Modal.js`), so children unmount on every close.
  The plan first leaned on that wrong fact; the fix is `toolkit/session.ts` (§1), an in-memory
  module-level record — ~30 lines, tested, and it makes inputs consistent across the two entry
  points, which component state never would have been. Not persisted: a calculator that
  remembers last month's numbers is clutter; the rack is the only durable thing (§4).
- **"'Sheet' — half-height bottom sheet or full screen?"** Full-screen panel, the
  `ExercisePicker` precedent. A half-height sheet needs a gesture/sheet dependency or
  hand-rolled drag handling ("add nothing speculative") and the calculators want keyboard
  room. The scope's word "sheet" names the open/close gesture, not a height; recorded so the
  builder doesn't reach for a library.
- **"Why a Modal and not a route, when every other screen is a route?"** The scope's own words
  decide it: "closes without losing the user's place" is free with a Modal over the mounted
  logger and is machinery with a route (per-screen state handoff, plus typed-routes churn).
  `ExercisePicker` is the in-repo precedent for exactly this shape.
- **"Is wiring the tab tiles scope creep?"** It is a widening, and it is declared in the Scope
  check rather than smuggled. The alternative — four working calculators reachable only
  mid-workout while the tab shows dead tiles advertising them — fails the B15 "dead settings
  erode trust" standard from the other direction. Cost measured: one prop (`initialTool`), one
  handler per tile, one test. Kill it at Gate 1 and the step still meets its DoD.
- **"A rep table on the 1RM screen — isn't that the intensity calculator in disguise?"** No:
  the table answers "what can I do for N reps" from a *just-estimated* 1RM in one glance;
  the intensity calculator answers "what is X % of a 1RM I already know". B06 built
  `weightForReps` naming this exact display as its purpose; leaving it unused would strand
  public API. The table stays compact (reps 2–10, no inputs of its own).
- **"The step DoD says the module's answer — why show a snapped number at all?"** Both: the
  module's exact answer is the primary figure (DoD-literal), the snapped line is secondary and
  labeled ("nearest 2.5 kg"). `roundToIncrement` exists in the module for precisely this; B06's
  plan reserved the 2.5 kg / 5 lb steps for B16. Showing only the exact value hands a lifter
  121.6 kg — a number no bar can hold.
- **"Why isn't the rack per-user when every DB query in the repo is user-filtered?"** That rule
  guards *training data rows* against leaking across accounts (B07). The rack is equipment
  description — the same physical plates whoever signs in — with zero privacy weight. Keying it
  per user would make the second account re-enter the first's rack for no one's benefit.
  Settled: device-level, revisitable in `plateRack.ts` alone.
- **"Stored rack JSON goes stale/corrupt — what breaks?"** Nothing: load validates shape and
  falls back to defaults; save failures are logged and tolerated. The worst outcome is a reset
  rack. Pinned by tests.
- **"Unit flip mid-calculation?"** The weight calculators re-render from the display unit like
  every other screen (B15's mechanism); typed text is not auto-converted — the field label
  changes and the lifter retypes, same as the logger's entry row (B15 settled that parsing
  happens at submit time with the unit then in force). The plate screen ignores display-unit
  flips by design (risk 1).
- **"RPE chips for 9 values × reps 1–12 — why not free text?"** Bounded controls make the
  module's domain unrepresentable in the UI instead of validated after the fact — fewer error
  states, no RangeError path to style, and faster between sets (tap, not type). Free text adds
  a keyboard for a value with nine legal answers.
- **"Where does the Epley citation live, exactly?"** On the 1RM result card, always visible
  with the estimate — not behind an info tap — because CLAUDE.md's rule is about product copy
  that *states* the claim, and this screen is where the claim is stated. The RPE screen's
  numbers derive from the same formula; its copy says "derived from the Epley estimate" and
  leans on the 1RM screen's full citation (one citation home, two pointers — mirrors the
  one-home math rule). B13's bare "e1RM" label stays Tristen's open product reading (HANDOFF);
  this step neither fixes nor worsens it.
- **"Defaults for the rack are invented numbers — speculative?"** They are a starting point the
  editor exists to change, not a claim; any plate set a gym stocks is reachable. No source to
  cite because no performance claim is made.
- **Scope verdict:** right as written, with the one declared widening (tab tiles) and the one
  declared interpretation (rack unit). Nothing else moved.
