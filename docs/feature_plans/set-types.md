# set-types — B10: Warm-up sets, bodyweight exercises, optional RPE (LOG-14, LOG-15, LOG-10 part)

**Branch:** `set-types` (from `main`)
**Build step:** B10 — covers LOG-14 (whole: warm-up sets excluded from PRs and volume), LOG-15
(whole: bodyweight exercises log reps without a weight and still track history and PRs), LOG-10
(partial: a set can carry RPE and it saves and syncs; the intensity analysis that *uses* RPE is
B42, as the step scope says).
**Depends on:** B09 (the logger screens), and through it B08 (the active-workout store), B07
(device SQLite + sync) and B06 (`@training-math`).

## Step definition of done (from the Build order)

A warm-up set is excluded from PR candidates and session volume by the math module (asserted in
its tests; B13 consumes that); a pull-up logs with reps only; RPE saves and syncs.

## What already exists (found in Explore — most of this step's plumbing is done)

The earlier steps deliberately built the columns and pass-through so B10 is thin:

- **Schema, both sides:** `sets.is_warmup` (boolean, default false) and `sets.rpe`
  (`numeric(3,1)`, CHECK 1–10) exist in the server migration and the device mirror
  (`frontend/src/db/schema.ts`). The sync layer pushes and pulls every `sets` column already.
  **No migration of any kind in this step.**
- **Store:** `SetInput` already takes `rpe` and `isWarmup`; `logSet`/`updateSet` round RPE to
  the column's decimal (`roundRpeForStorage`) and validate 1–10 (`assertValidSetFields` in
  `@training-math` `limits.ts`); `repeatLastSet` copies both fields.
- **PR exclusion (half of LOG-14) is done and tested:** `classifyPrs` in `@training-math`
  `prs.ts` returns no PR for a warm-up set ("never flags a warm-up, however heavy") and for a
  weightless set ("ignores sets with no weight") — both asserted in `prs.test.ts` since B06.
- **Reps-only logging (the mechanics of LOG-15) works:** the entry card's weight box is
  optional; a reps-only set saves `weight_kg = null`, syncs, and prints as "8 reps"
  (`formatSet`). What's missing is the *dedicated UX* B09 deferred here, and tests that pin the
  pull-up path end to end.

What does **not** exist: session-volume math (nowhere in the repo — B18 would otherwise grow its
own copy), any UI to mark a set as warm-up or enter RPE, and any bodyweight-aware affordance.

## What this step builds

### 1. `volume.ts` — session volume in the one math home (LOG-14's other half)

New file `backend/supabase/functions/_shared/training-math/volume.ts`, exported from `index.ts`,
same rules as the rest of the module (pure TS, `.ts` imports, no I/O):

- `setVolumeKg({ reps, weightKg, isWarmup })` — one set's tonnage: `reps × weightKg`; **0 for a
  warm-up set** and 0 when reps or weight is null (a bodyweight or timed set adds no tonnage —
  the external load is unknown, and guessing the lifter's bodyweight would need body data that
  is null for most users and would make volume numbers unexplainable).
- `sessionVolumeKg(sets)` — the sum over a workout's sets.

The input is volume's own `VolumeSet` interface (`reps`/`weightKg`/`isWarmup`), structurally
compatible with `PrCandidateSet` so a caller feeds the same mapped rows to both — but not
imported from `prs.ts`, so volume's contract isn't coupled to the PR file. HANDOFF's B06/B07 record says it verbatim:
"session volume math lands *in* `@training-math` (`volume.ts`), never beside it." B18 (analysis)
and B13 (PR screen) import it later; nothing in the app displays volume yet, and this step adds
no display — the module and its tests are the deliverable, exactly as the step DoD words it
("asserted in its tests; B13 consumes that").

Deliberately *not* built: per-muscle volume, weekly volume, set-count analytics — no consumer,
nothing speculative.

### 2. Entry card: warm-up toggle and RPE input (LOG-14 + LOG-10 UI)

`frontend/src/components/workout/EntryCard.tsx`:

- **Input row** gains a **Warm-up** toggle chip (pressed state = the next logged set is a
  warm-up) and an **RPE** box (`decimal-pad`, optional, placeholder "RPE"). `logSet` passes
  `isWarmup` and the parsed `rpe` through. The chip does not reset after logging — warm-ups
  come in runs, and Repeat already copies the flag; the lifter un-presses it when work sets
  start. The Log button still enables only when reps or weight is entered — an RPE alone is
  not a set.
- **Every logged set row** shows the set as `formatSet` prints it (see §4) and gains a small
  **W** toggle control (pressed/filled when the set is a warm-up, outlined when not, with an
  accessible "Warm-up set" label), so a set can be marked or unmarked *after* logging ("warm-up toggle **per set**", the scope's words — a lifter
  usually realizes at set 3 that sets 1–2 were warm-ups). The toggle calls `store.updateSet`
  with the row's other values unchanged.
- A store `RangeError` on RPE surfaces through the existing message line
  (`setErrorMessage` gains an `rpe` branch: "RPE goes from 1 to 10.").

To rebuild a `SetInput` from a stored `SetRow` without the UI knowing the conversion rules,
`frontend/src/workout/activeWorkout.ts` exports a small pure helper
`setInputFromRow(set: SetRow): SetInput` — weight goes back as `{ value: set.weight_kg,
unit: 'kg' }`, which round-trips exactly because stored values are already rounded to the
column's precision (B08's storage-rounding decision). Domain knowledge stays in the domain file;
no math in the component.

### 3. Bodyweight exercises: the dedicated UX (LOG-15)

- `history.ts`'s `exerciseName` lookup widens to return `{ name, equipment }` (the device
  `exercises` table already stores `equipment`; one more selected column, same query, same
  user filter). Renamed `exerciseInfo`; the card's one call site updates.
- When the entry's exercise has `equipment = 'Bodyweight'` (the catalog's enum value), the
  weight box's placeholder reads **"+ lb"** (added weight) instead of "lb", and the card treats
  reps-only as the normal case it already is. The box stays visible and usable — weighted
  pull-ups and dips are real, and the stored weight is the *added* load, which is exactly what
  the PR books should compare.
- Nothing else branches on equipment. No "bodyweight mode", no hidden fields, no stored flag —
  the data model already says everything (`weight_kg null` = no external load).

**The PR decision LOG-15's DoD forces, recorded here as settled:** "still track … PRs" means
weightless sets pass through PR detection safely and *weighted* bodyweight sets feed the normal
books. There is **no separate rep-record book for bodyweight movements** (no "20-rep pull-up
PR"). The PRD's decisions list is closed on this: "PRs: true 1RM, rep maxes and estimated 1RM
(Epley) all count; volume does not" — all three are weight-based, and a max-reps-at-bodyweight
record is a volume-flavored record the PRD's own rule excludes. B06's plan left this open
("B10+B13 decide if they exist at all"); B10 decides **no**, and B13 builds the
`personal_records` table against the three existing kinds only. If the founder ever wants rep
records, that is a new PRD decision, a new `PrKind` and a migration — not a B13 surprise.

### 4. Display: warm-up and RPE in the set text (`format.ts`)

- `formatSet` widens its pick of `SetRow` to `reps | weight_kg | rpe | is_warmup` and prints:
  warm-up prefix `W · ` (e.g. `W · 8 × 135 lb`) and RPE suffix ` @ RPE 8` (e.g.
  `8 × 185 lb @ RPE 8.5`). One spelling, so the logger's rows, the saved-workout screen and
  the Workout tab all show it with **no screen changes** — they already call `formatSet`.
- `formatLastTime` (the "last time" line) **filters warm-up sets out** before grouping, and the
  card hides the line if only warm-ups remain. The line exists to answer "what did I work at
  last time?" — warm-ups are noise there by LOG-14's own definition, and keeping them would
  break the grouped `3 × 8 @ 185 lb` shape. RPE is *not* shown in the last-time line (it is a
  one-line summary; B13's fuller panel can show more).
- The saved-workout screen and Workout tab are untouched as files; their rendering picks the
  new formatting up through `formatSet`. Their set-count labels ("12 sets") keep counting all
  logged sets including warm-ups — they are counts of what was done, not training volume;
  volume semantics live only in `volume.ts`.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/functions/_shared/training-math/volume.ts` (+ `.test.ts`) | new — `setVolumeKg`, `sessionVolumeKg`, warm-up exclusion asserted (§1) |
| `backend/supabase/functions/_shared/training-math/index.ts` | edit — export `volume.ts` |
| `frontend/src/workout/activeWorkout.ts` | edit — add exported `setInputFromRow` helper (§2); no store behavior change |
| `frontend/src/workout/activeWorkout.test.ts` | edit — assert a pushed set carries `rpe` and `is_warmup` after finish (the "syncs" half of the DoD), warm-up/RPE round-trip through `updateSet` via `setInputFromRow` |
| `frontend/src/workout/history.ts` (+ test) | edit — `exerciseName` → `exerciseInfo` returning `{ name, equipment }` (§3) |
| `frontend/src/workout/format.ts` (+ test) | edit — `formatSet` warm-up/RPE text, `formatLastTime` warm-up filter, `setErrorMessage` RPE branch (§4) |
| `frontend/src/components/workout/EntryCard.tsx` (+ test) | edit — warm-up chip, RPE box, per-row warm-up toggle, bodyweight placeholder (§2–3) |
| `frontend/src/__tests__/logger-flow.test.tsx` | edit — extend the end-to-end flow: a bodyweight exercise logged reps-only and a warm-up + RPE set survive finish → saved screen (§ Testing) |
| `docs/diagrams/app-flow.md` | edit (Document step) — entry-card actions gain warm-up/RPE; note the volume module |
| `docs/diagrams/database-erd.md` | untouched — no schema change |
| `docs/BUILD_LIST.md` | not touched — status flips happen at Gate 2 |

## Data model impact

**None.** No server migration, no device migration, no new columns, no new tables. Every value
this step writes goes into columns that have existed since B02/B07 and already ride the sync
path. `limits.ts` already mirrors their CHECKs.

## How each definition of done becomes observably true

- **Step DoD, clause 1** — `prs.test.ts` already asserts warm-up exclusion from PR candidates
  (B06); new `volume.test.ts` asserts a warm-up set contributes 0 to `sessionVolumeKg` while an
  identical non-warm-up set contributes `reps × weightKg`. Both live in the math module's own
  tests, which is where the DoD points B13 to.
- **Step DoD, clause 2** — the extended `logger-flow.test.tsx` logs a pull-up (Bodyweight
  equipment) with reps only through the real card → store → SQLite, finishes, and the saved
  screen shows "8 reps"; `EntryCard.test.tsx` asserts the Log button enables with reps alone
  and the placeholder reads "+ lb".
- **Step DoD, clause 3** — `EntryCard.test.tsx` types an RPE and asserts the snapshot's set
  carries it (saves); `activeWorkout.test.ts`'s finish-then-push assertion shows the pushed row
  reaching the fake server with `rpe` and `is_warmup` intact (syncs).
- **LOG-14** — clause 1 plus the card tests: chip on → logged set has `is_warmup = true`,
  row badge toggles it off through `updateSet`.
- **LOG-15** — clause 2 plus: `classifyPrs` on a weightless set returns `[]` (existing test —
  history and PR tracking survive weightless sets), a weighted pull-up set is an ordinary PR
  candidate (existing behavior, no code change), and the settled no-rep-records decision above.
- **LOG-10 (this step's part)** — clause 3. The `sets.rpe` column exists (B02). The analysis
  use is B42's, as the step scope assigns it.

## Out of scope (this branch)

- **Drop sets, supersets, timed work UI** (B11) — their columns keep riding through untouched.
- **RPE in analysis** (B42) and **any volume display** (B18 shows session volume; B13 reads
  the module for PRs). This step ships math + logging UI only.
- **PR detection on finish, personal_records table, PR badges** (B13).
- **Unit toggle** (B15) — the bodyweight placeholder uses the same `displayUnit` seam.
- **Rep-record PR book for bodyweight movements** — decided against (§3); revisiting it is a
  PRD change, not a build step.
- **Bodyweight-inclusive tonnage** (adding the lifter's body mass to pull-up volume) — needs
  bodyweight history (DEFERRED: `user_body_data` log) and a product decision; volume counts
  external load only, stated in `volume.ts`'s comment.
- **Set-count labels excluding warm-ups** — counts stay raw (§4); any "working sets" number a
  future screen wants comes from the math module then.

## Risks a reviewer should weigh

1. **The no-bodyweight-rep-PR decision (§3) closes an open question from B06 on the planner's
   reading of the PRD.** The PRD's decision list ("true 1RM, rep maxes and estimated 1RM all
   count; volume does not") is the cited ground. If Tristen reads LOG-15's "still track …
   PRs" as *demanding* rep records at bodyweight, B13's table design changes — reject this plan
   at Gate 1 rather than letting B13 inherit the narrow reading silently.
2. **`formatLastTime` starts filtering warm-ups** — a behavior change to an existing B09
   surface, chosen without a DoD sentence demanding it. The argument: the line answers "what
   did I work at", and LOG-14 defines warm-ups as not-work. The filter is one line, tested, and
   reversible; but it is the one place this step edits B09 behavior rather than adding to it.
3. **Per-row warm-up toggling goes through `updateSet` + `setInputFromRow`.** The helper's
   kg-in/kg-out round trip is exact only because stored weights are pre-rounded (B08's
   invariant). If that invariant ever broke, toggling a warm-up flag could silently rewrite a
   weight by a rounding hair. The helper's test pins the round trip (log in lb → toggle → weight
   unchanged byte-for-byte).

## Grilling decisions (settled before code)

Run via `mattpocock-skills:grilling`; headless pipeline run, so the planner played both sides at
full severity (B08/B09 precedent). Questions that changed or sharpened the plan:

- **"The step DoD says the math module excludes warm-ups from PRs — that shipped in B06. Is
  this step claiming finished work?"** It was, in the first draft's wording. Reworded: B10's
  math-module deliverable is `volume.ts` (which does not exist anywhere); the PR half of
  LOG-14 is *verified* here (the B06 tests are cited, not rewritten) and the UI half (the
  toggle) is built here. The plan now opens by naming exactly what already exists so the
  builder doesn't rebuild it.
- **"Why does `volume.ts` exist with no consumer? 'Add nothing speculative.'"** Because the
  step's own DoD sentence demands it ("excluded from … session volume by the math module —
  asserted in its tests; B13 consumes that") and HANDOFF records the standing decision that
  volume math lands in `@training-math` before a consumer grows a local copy. The scope is cut
  to the two functions the sentence needs; per-muscle/weekly volume were dropped from the first
  draft as the actual speculation.
- **"Does a bodyweight set count toward volume? Reps × 0 = 0 — is that right, or should it use
  the lifter's bodyweight?"** 0. `user_body_data.bodyweight_kg` is null for most users
  (collected nowhere yet), varies over time with no history table, and a volume number that
  jumps when the user edits their bodyweight is unexplainable. External load only, documented
  in the file comment; bodyweight-inclusive tonnage is listed out of scope as a product
  decision, not a TODO.
- **"Warm-up chip that stays pressed — won't lifters forget and mislabel their first work
  set?"** Considered auto-reset after each log; rejected because warm-ups come in runs of 2–5
  and re-pressing per set is worse. The mislabeled-set case is exactly why the per-row toggle
  exists (fix after the fact, two taps). The chip's pressed state is loud (accessibility state
  + filled style).
- **"Is the per-row toggle scope creep? The DoD only needs warm-ups excluded."** The scope
  sentence says "warm-up toggle **per set**" — a toggle only on the input row would be a toggle
  per *future* set. Marking sets 1–2 as warm-ups retroactively at set 3 is the dominant real
  usage. It stays, built on the existing `updateSet` (no new store surface beyond the pure
  helper).
- **"Why `setInputFromRow` in the domain file instead of a `toggleWarmup(setId)` store
  method?"** A store method would be a second way to write a set (the exact duplication the
  store's `updateSet` exists to prevent) and would grow once (B11 wants drop-set edits, B12
  notes). The pure helper keeps one write path and no new mutation surface; the component
  stays dumb.
- **"RPE as a bare TextInput — the RPE scale is 1–10 in 0.5s; why not a picker?"** The store
  already validates 1–10 and rounds to 0.1; a free box with the existing error line is the
  smallest honest UI and matches the reps/weight boxes beside it. A picker/slider is a design
  flourish with new interaction states; nothing in LOG-10's DoD asks for it. If the device run
  finds the box clumsy, that is a UI iteration, not a data change.
- **"Hide the weight box entirely for Bodyweight equipment?"** No — weighted pull-ups/dips are
  core strength training, and hiding the box would make them unloggable (and `equipment` is
  seed data, not a law about how a movement is performed). Placeholder-only differentiation
  keeps every path open at zero logic cost.
- **"`exerciseName` → `exerciseInfo` renames a B09 API — churn?"** One call site (the card's
  history hook). Returning a second column from the same filtered query is cheaper than a
  second query and keeps the lookup single. The rename is honest (it no longer returns just a
  name); `history.test.ts` updates alongside.
- **"Should the last-time line keep warm-ups but mark them?"** Rejected: the grouped format
  (`3 × 8 @ 185`) can't carry per-set badges without becoming a paragraph, and the line's job
  is "what did I work at last time". Filtering is the smaller, truer change; risk recorded
  (§ Risks 2) so Gate 1 can overrule cheaply.
- **"Does 'RPE syncs' need a new sync test? B07 proved column pass-through."** B07/B08 prove
  the pipe; no test anywhere asserts these two *specific* fields reach the fake server with
  values intact (the finish test deep-equals rows it built without RPE). One added assertion in
  the existing finish-push test closes the DoD sentence at near-zero cost — cheaper than
  trusting transitivity across three steps' tests.
- **"A W badge only on warm-up rows gives a work set no way to *become* a warm-up."** Caught
  in grilling — the first draft's wording implied the badge appeared only once a set was a
  warm-up. Fixed: every set row carries the W toggle, filled or outlined by state, so marking
  and unmarking are the same two taps.
- **"Does an RPE alone enable the Log button?"** No — an RPE with no reps and no weight is not
  a set (nothing performed). The existing reps-or-weight enablement rule stands; stated in §2
  so the builder doesn't widen it.
- **"Should `volume.ts` import `PrCandidateSet` as its input type?"** No — structural
  compatibility without the import. Coupling volume's contract to the PR file would make an
  innocent PR-field change (e.g. B13 adding a field) ripple into volume's API. Each file owns
  its input shape; callers pass the same mapped rows to both.
- **"Is `W · ` too cryptic in `formatSet`?"** The row badge carries the accessible word
  ("Warm-up set"); the text prefix is deliberately one character so the weight stays the
  loudest token mid-workout. The saved screen shows the same string, one spelling everywhere
  (`format.ts`'s charter). If the device run reads badly, it's a one-function change.
