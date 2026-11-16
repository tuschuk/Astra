# tool-kit-prefill — B43: Calculators open prefilled from the exercise in progress and stored PRs

**Branch:** `tool-kit-prefill` (from `main`)
**Build step:** B43 — covers **TK-6** (whole): "Opening a calculator mid-workout arrives
prefilled from the exercise in progress and the user's PRs."
**Depends on:** B16 (the Tool Kit sheet, `toolkit/session.ts`, `toolkit/inputs.ts`,
`plateRack.ts`) and B13 (`personal_records` + `currentPrs` in `workout/prs.ts`), and through
them B08/B09 (the active-workout store and logger) and B06 (`@training-math`).

## Step definition of done (from the Build order)

Calculators open prefilled from the exercise in progress and the user's stored PRs. Step DoD:
observed on a mid-workout open for each calculator.

## Scope check

The scope is right as written and this plan stays inside it. "Each calculator" means the four
calculators (1RM, RPE, %1RM, plate loader); the timer is not a calculator and is untouched.
"Mid-workout" means the sheet opened from the logger's floating button; the Workout tab's tiles
keep opening the sheet exactly as today (HANDOFF's standing input: with nothing in progress the
calculators open empty / with session values as before — no prefill path exists there). Prefill
is a starting value the lifter can overwrite, never a lock. No migration, no sync change, no new
dependency, no new math.

Three of HANDOFF's standing-input sketches are implemented with a deliberate adjustment each,
recorded in "Deviations from the standing inputs" below for Gate 1 to overrule.

## What this step builds

One new pure-ish module, one edited screen, zero changes to the sheet and calculators
themselves. The whole feature is: *when the logger's Tool Kit button is pressed, work out what
the lifter is doing, read their stored PRs for it (both from device SQLite — offline by
construction), and seed the Tool Kit session (`toolkit/session.ts`) that the calculators
already initialize from.* The sheet then shows prefilled boxes for free.

### 1. `frontend/src/toolkit/prefill.ts` (+ test) — the one home for prefill logic

**The exercise in progress** (the decision HANDOFF left to this planner, settled):

- the entry holding the **most recently logged set** of the workout — compared by `created_at`
  (ISO strings with millisecond precision), ties broken by entry position then set position,
  later wins (deterministic, though real taps never tie);
- if no set is logged anywhere yet: the **last entry** (the exercise most recently added — the
  one the lifter is about to work; adding an exercise and opening the %1RM calculator to pick a
  first working weight is exactly TK-6's moment);
- no entries at all: no prefill (the sheet opens as today).

The alternative — tracking which entry's input box last had focus, plumbed up from every
`EntryCard` input — was rejected: it is wiring through every text input for a correction that
only matters in the "logged on A, moved to B, opened the calculator before B's first set" case,
where the prefill is visibly from A and one tap away from right. Revisit on device evidence.

**The source set**: the focused entry's most recently logged set (same ordering), warm-ups and
drop segments included. Not filtered to working sets on purpose: between warm-ups, "load my
next warm-up" is a real plate-loader moment, and an empty box helps nobody. Each calculator
takes only the fields the set has (a timed set without weight prefills reps only, and so on).

**The 1RM reference** (for the RPE and %1RM calculators' 1RM box): the focused exercise's
stored **`e1rm` record book** (`currentPrs` — the e1rm book always ≥ the true-1RM book, since a
single's estimate is itself); when the lifter has no stored records for this exercise (first
time doing it, nothing finished yet), fall back to `epleyE1rm(weight_kg, reps)` of the source
set when it has a weight and whole reps in [1, `MAX_EPLEY_REPS`]; otherwise no value. The
fallback is the module's own function — no math is written here.

**Per-calculator seeds** (every weight is converted with the module's `displayWeight` — kg →
the box's unit, rounded to the 0.1 the app displays everywhere — and written as plain text the
boxes' readers already parse):

| Calculator | Box | Seed |
|---|---|---|
| 1RM | Weight | source set's `weight_kg`, in the display unit |
| 1RM | Reps | source set's `reps`, when whole and in [1, `MAX_EPLEY_REPS`] |
| RPE | 1RM | the 1RM reference, in the display unit |
| RPE | Target reps chips | source set's `reps`, only when in [`MIN_RPE_REPS`, `MAX_RPE_REPS`] |
| RPE | RPE chips | source set's `rpe`, only when in [`MIN_RPE`, `MAX_RPE`] **and** on a half step (`Number.isInteger(rpe * 2)`; stored RPE keeps 1 decimal, so 7.3 exists and must not snap to a chip claiming 7.5) |
| %1RM | 1RM | the 1RM reference, in the display unit |
| %1RM | Percent | untouched (see deviation 2) |
| Plates | Target | source set's `weight_kg`, in the **rack's** unit (B16's settled rule: the plate screen works in the rack's unit) |

A box with no seed keeps whatever the session already holds — the merge is per-field.

**Zero gates:** every weight seed (and the Epley fallback, whose domain is positive) requires
`weight_kg > 0` — a seeded "0" would render as an inline error, not a prefill — and the reps
gates already exclude a stored 0 (`reps >= 0` is legal in the schema).

**Exports:**

- `ToolKitPrefill` — the seeds plus a `sourceKey` (`exerciseId:setId-or-none`);
- `focusedEntry(entries): ActiveEntry | null` — the focus rule above, exported because the
  caller needs the exercise *before* it can read that exercise's PRs;
- `buildToolKitPrefill(entry, prs, displayUnit, rackUnit): ToolKitPrefill | null` — pure;
  `entry` is the already-chosen focused entry (so focus is computed once, not re-derived
  here and in the caller), `prs` the `currentPrs` rows;
- `applyToolKitPrefill(prefill): void` — merges the seeds into the Tool Kit session via
  `updateToolKitSession`, **only when `sourceKey` differs from the last one applied** (module
  state beside the session's, in-memory, with a reset for tests). So: log a set → the next open
  re-seeds; type over a prefill and reopen without logging → the typed values stand. This is
  how "a starting value the lifter can overwrite" survives reopening, without the fill-only-
  empty rule that would go permanently stale mid-workout.

No training math lives here: `displayWeight`, `epleyE1rm` and the range constants come from
`@training-math`; the only logic of prefill's own is choosing rows and gating chip
representability (UI concerns).

### 2. `frontend/src/app/active-workout.tsx` — the only wiring

The floating button's handler becomes async:

1. `focusedEntry(snapshot.entries)` (the snapshot is already in hand — no store change,
   honoring the standing input's point that the sheet never reads the workout store);
2. `await Promise.all([currentPrs(db, userId, exerciseId), loadPlateRacks()])` — two local,
   indexed, offline reads (the same `currentPrs` every `EntryCard` panel already calls on
   mount; `loadPlateRacks` is a one-key kv read, cached after the first call). The rack unit is
   `racks.unit ?? displayUnit`, the same rule `PlateLoader` applies — awaited rather than taken
   from `getCachedPlateRacks()` so a lb-rack/kg-display lifter who hasn't opened the plate
   screen this app run still gets the target in the unit the plate screen will actually show;
3. `applyToolKitPrefill(buildToolKitPrefill(...))`, then `setToolKitOpen(true)`.

**Failure fails open:** any thrown read is caught, logged with `console.warn`, and the sheet
opens unprefilled — the Tool Kit's B16 guarantees (one tap, offline, never blocked) outrank the
prefill. PR staleness is not a concern: records change only at finish (B13) or on a history
edit (B14), neither reachable while this handler runs; reads happen at press time, so each open
is as fresh as it can be.

`ToolKitSheet`, the four calculators, `session.ts`, `inputs.ts`, `plateRack.ts` and
`(tabs)/workout.tsx` are **not modified**.

## Deviations from the standing inputs (for Gate 1)

1. **The RPE calculator's 1RM box takes the 1RM reference, not "the last set's weight".** The
   box is labelled 1RM; seeding it with the last set's weight (HANDOFF's sketch) would misstate
   the lifter's max by the whole rep count — 100×5 would read as a 100 max and hand back absurd
   working weights. The last set still feeds the reps and RPE chips, which is the useful part of
   the sketch; the stored e1RM (TK-6's "and the user's PRs") feeds the box.
2. **The %1RM calculator's percent box is not seeded from "the set's load".** Turning a load
   into a percent is `load ÷ 1RM × 100` — a derivation that exists nowhere in `@training-math`,
   and writing it in the app breaks the one-home rule for a marginal fill (the lifter opens
   this calculator holding a percent from their program, not to learn one). If Gate 1 wants it,
   the right shape is a one-line module helper first; this plan seeds the 1RM box only.
3. **Prefill reaches the sheet by seeding the session, not as a `prefill` prop threaded through
   the sheet into four calculators.** The standing input's stated point — the sheet must not
   read the workout store — holds either way (the screen computes, the sheet knows nothing).
   Seeding the session touches zero component APIs, makes prefill-vs-typed precedence one rule
   in one file, and keeps the session what it already is: "what the boxes hold between opens".
   Consequence, accepted: a later tab-tile open shows the seeded values (exactly as if typed) —
   consistent with the session's existing semantics.

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/toolkit/prefill.ts` (+ `prefill.test.ts`) | new — focus rule, source set, 1RM reference, per-calculator seeds, `applyToolKitPrefill` with the `sourceKey` rule (§1) |
| `frontend/src/app/active-workout.tsx` | edit — async open handler: read PRs + racks, apply prefill, open; fail open (§2) |
| `frontend/src/__tests__/tool-kit.test.tsx` | edit — route-level prefill proofs (below) |
| `docs/diagrams/app-flow.md` | Document step — the prefill data path (snapshot + `personal_records` + plate rack → session → sheet) on the existing Tool Kit nodes |
| `docs/diagrams/database-erd.md` | untouched — no schema change on either side |
| `docs/BUILD_LIST.md` | untouched — status flips at Gate 2 |

No route is added or changed; the typed-routes regeneration happens anyway in the established
check order (`npx expo start --offline` → `tsc` → lint → Jest) because Gate 2 runs it.

## Data model impact

**None.** No server migration, no device schema change, no sync change, no new storage. Every
read is of tables and kv keys that already exist, through functions that already exist.

## How the definitions of done become observably true

All Jest (node SQLite driver where a db is involved, no transport, no network — the proof of
offline is again that there is nothing to mock), then Tristen's device observation.

- **`prefill.test.ts` (unit, pure):** focus picks the entry of the newest set across entries;
  falls back to the last entry when no sets; null on an empty workout. Source set is the
  focused entry's newest, warm-ups and drops included. Seeds: kg and lb display units both
  (text matches `String(displayWeight(...))`); plate target in a rack unit that differs from
  the display unit; RPE 7.3 seeds no chip while 7.5 does; reps 15 seeds no RPE-calculator chip
  but does seed the 1RM calculator; reps 0 and weight 0 seed nothing (the zero gates); stored
  e1rm book preferred over the Epley fallback; the fallback used when no PR rows; neither → no
  1RM seed. `applyToolKitPrefill` merges only seeded fields, skips a repeated `sourceKey`,
  re-applies on a new one — including after the newest set is removed (focus falls back to the
  previous set, a different key) and after a new exercise with no sets is added
  (`exerciseId:none` differs per exercise).
- **`tool-kit.test.tsx` (route level, the step DoD's "mid-workout open for each calculator"):**
  a seeded active workout (set: 100 kg × 5 @ RPE 8) plus seeded `personal_records` rows → press
  the floating button → the 1RM calculator shows weight 100 / reps 5; switch to RPE → 1RM box
  holds the stored e1RM in the display unit, chips on 5 and 8; switch to %1RM → same 1RM box;
  switch to Plates → target 100 in the rack's unit. Typed override: change a box, close,
  reopen without logging → the typed value stands; log another set, reopen → the new set's
  numbers. A tab-tile open applies no prefill. A `currentPrs` failure still opens the sheet.
- **TK-6 / step DoD on device (Built → Done, Tristen):** mid-workout, open each of the four
  calculators and see the numbers arrive filled in; overwrite one and see it stick. Recorded
  here per the standing input: the Built → Done flip is his.

## Out of scope (this branch)

- **Timer prefill** — not a calculator; TK-5 shipped finished in B17.
- **Prefill from the Workout tab tiles** (e.g. while a workout is in progress in the
  background) — the standing input keeps tab opens as today; one `openToolKit`-shaped handler
  on the tab would be the later change if ever wanted.
- **A "from your last set of <exercise>" caption** on the calculators — UI copy the DoD doesn't
  ask for; the numbers are self-evident seconds after logging them. On device evidence.
- **Seeding the percent box** (deviation 2) and any new `@training-math` helper.
- **Focus tracking of the active input** (rejected above; revisit on device evidence).
- **Inventory-aware snapping, per-calculator history** — B16's standing rejections, unchanged.

## Risks a reviewer should weigh

1. **The `sourceKey` apply-once rule is the one stateful subtlety.** Done wrong in one
   direction it clobbers typed values on every open (prefill becomes a lock); in the other it
   never re-seeds after a new set (prefill goes stale). The unit tests pin both sides; the
   reviewer should check the key covers exercise *and* set (a new exercise with no sets must
   re-seed too) and that the module state resets with the session in tests.
2. **Three units are in play** — storage kg, display unit, rack unit — and the seeds are
   *text*, round-tripped through `displayWeight`'s 0.1 rounding and re-parsed by
   `readWeightKg`/`parseNumberInput` on render. A unit slip here shows plausible-but-wrong
   numbers (the worst kind). The lb-display and lb-rack/kg-display fixtures exist precisely to
   pin this; nothing may convert outside the module's functions.
3. **The open handler goes async on a hot path.** Two local reads (~ms) now sit between tap
   and sheet; both must stay device-only (no transport import — the review re-checks the
   import graph, the B16 precedent) and any failure must fail open. If a slow device ever
   makes the delay visible, the fallback is reading PRs in an effect keyed on the focused
   exercise and applying at press from state — recorded so it isn't redesigned ad hoc.

## Grilling decisions (settled before code)

Headless pipeline run: the planner worked the attack tree itself at full severity (the
B08–B42 precedent), verifying every checkable claim in the repo — the session/calculator
init pattern (`useState(() => getToolKitSession()...)` in all four calculators), `Modal`
remounting `SheetBody` per open, `currentPrs`'s shape and sorting, `getCachedPlateRacks` /
`loadPlateRacks` and the `racks.unit ?? displayUnit` rule, `SetRow.created_at`'s presence,
`displayWeight`'s rounding, and the RPE chip ranges. Gate 1 is where Tristen overrules.

- **"Which entry is 'in progress'?"** Last logged set wins; last entry when nothing is logged;
  rejected focus-plumbing (argument in §1). The dominant calculator moment is between sets of
  the exercise just worked — the last-set rule is exact there and self-evidently sourced.
- **"Prefill vs. what the lifter typed — who wins on reopen?"** Neither blindly. Apply-per-
  `sourceKey`: a new set re-seeds, no new set keeps the lifter's edits. Prefill-always-wins
  silently discards deliberate input (the known-1RM-over-estimate case); fill-only-empty means
  the plate target never follows the workout after first use. Both rejected for the key rule.
- **"Why seed the session instead of passing props?"** Deviation 3's argument. The prop design
  additionally can't express "the lifter already overwrote this" without the same key logic
  somewhere — so the key logic is the real feature, and the session is where the values the
  boxes show already live. The sheet stays ignorant of the workout either way.
- **"Warm-ups and drops as the source set — doesn't a warm-up make a silly 1RM estimate?"** It
  can (and is overwritable, and labelled an estimate); excluding warm-ups would empty the plate
  loader's best case (loading the next warm-up). One simple rule beats two conditional ones.
- **"The e1rm book or `max(true1rm, e1rm)` as the 1RM reference?"** The e1rm book alone — it is
  ≥ the true-1RM book by construction (a single estimates as itself and both books fold the
  same history), so the max is the e1rm book. Verified against the module's fold semantics.
- **"Is `Number.isInteger(rpe * 2)` training math in the app?"** No — it decides whether a chip
  exists for a value, a UI-representability gate like the reps range checks. Snapping 7.3 to a
  7.5 chip *would* be inventing a claim; refusing to seed is honest.
- **"Why read PRs at press time instead of an effect?"** Press-time is race-free (records
  cannot change while the logger is up and the handler runs), always fresh, and avoids effect
  machinery keyed on focus changes. Cost: ~ms of local reads before the sheet opens, with the
  effect design recorded as the fallback (risk 3).
- **"What does a brand-new lifter see (no sets, no PRs)?"** Untouched boxes — exactly today's
  behavior. TK-6's sentence presumes something to prefill from; with neither a set nor a PR
  there is honestly nothing, and inventing a value would be worse.
- **"Does the plate target belong in the rack's unit or the display unit?"** The rack's — B16
  settled that the plate screen works in the rack's unit, and a seed the screen reinterprets in
  another unit would be wrong by exactly the kg/lb ratio. Hence awaiting `loadPlateRacks` for
  the true unit rather than trusting the cache (§2).
- **"Scope creep check: the tab tiles, the timer, captions?"** All out (Out of scope); the
  diff touches two source files plus tests. The standing input's reading of the scope is kept
  to the letter on both.
- **Second pass (post-draft), three sharpenings folded in above:** `focusedEntry` exported and
  `buildToolKitPrefill` takes the chosen entry, so focus is computed once (the caller needs it
  for the PR read anyway); the zero gates (`weight_kg > 0`, reps ≥ 1 via the existing ranges) —
  a stored 0 is legal and would otherwise seed an inline *error* into a box, and `epleyE1rm`
  refuses non-positive weight; and the `sourceKey` rule re-checked against set removal and
  just-added exercises (both yield a new key, so re-seeding tracks genuine source changes).
  A double-tap on the floating button runs the reads twice and applies once (second apply
  skipped by key) — harmless, no guard needed.
- **Scope verdict:** right as written. The three standing-input adjustments (deviations 1–3)
  sharpen the sketch rather than widen the step; nothing else moved.

## Build notes and deviations (builder run)

1. **`sourceKey` is `entryId:setId-or-none`, and the apply-once rule runs per calculator.** The
   plan's key was `exerciseId:setId-or-none`, applied to the whole prefill at once. Built: each
   calculator keeps its own fingerprint — `sourceKey` plus the values it would write — and is
   written only when that fingerprint changes. Why: `updateSet` (fixing a typo on the source
   set) and a unit change (display unit, or the plate loader's rack toggle) must refill the
   boxes they affect, which a set-id-only key missed; but a whole-prefill key that included the
   values would let a rack-unit flip rewrite *every* calculator and wipe a typed-over 1RM (the
   Spec review's one defect, fixed). Entry id instead of exercise id also separates the same
   exercise added twice. Logging a set with identical numbers still refills (new set id).
2. **`isChartRpe` added to `@training-math` (`rpe.ts`), and `percentOfOneRm` now uses it.** The
   plan put the half-step RPE gate in `prefill.ts` as a UI check and listed "any new
   `@training-math` helper" as out of scope. The Standards review flagged it as a mirrored copy
   of `percentOfOneRm`'s own range check (CLAUDE.md: "a mirrored copy is a bug"); the rule —
   which RPE values the chart covers — now has one home, with its own test. No behaviour
   change for any existing caller.
3. **Review findings not acted on (judgement calls):** moving the screen's read-and-apply
   orchestration into `prefill.ts` (the plan placed it in the screen deliberately; it is covered
   by the route tests); bundling `(displayUnit, rackUnit)`; the small `wholeIn` repetition;
   guarding a double tap (the plan's grilling covered it — the second apply is a no-op). The
   handler's `db` / `userId` guard skips prefill entirely when either is missing; unreachable in
   practice because the logger renders only its loading state until both exist.
