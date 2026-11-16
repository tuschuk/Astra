# profile-trends — B46: long-term e1RM and volume charts on the profile

**Branch:** `profile-trends` (from `main`)
**Build step:** B46 — covers the **trends half of YOU-7** (strength-level grades and long-term
trends on the profile; the grades half is B45, Blocked on the Strength Level licence). The part
this step owns: **long-term trend charts render from real history.**
**Depends on:** B25 (the profile: `ProfileView`, its tabs, the own-local / others-online split)
and B42 (trend analysis: the data-honesty rules — what counts as a session measure — and the
`timestampMs` parser both runtimes share).

## Step definition of done (from the Build order)

Long-term e1RM and volume charts on the profile from real history. **The charts render from
logged data and update after a new workout.**

## Scope check

The scope is right as written and this plan stays inside it. The handoff's standing inputs for
this planner are honored: `react-native-svg` is the only drawing dependency, the charts read
existing data, the section lives in `ProfileView`, re-read on focus is "update after a new
workout". Three readings the handoff left to this planner, settled up front:

- **The e1RM chart is per exercise, not a whole-body proxy.** An e1RM only means something for
  one movement — averaging squat and curl estimates into one line is a number no lifter can act
  on, and the PRD's YOU-7 sits beside per-exercise grades. The lifter picks an exercise from a
  chip row (exercises they've logged with at least one e1RM-qualifying set, defaulting to the
  one with the newest qualifying set — the B43 "what you train now" product call). The history
  is the best e1RM per session, computed from `sets` — `personal_records` holds only the
  *current* best per book (B13), so the series must come from raw sets, the B13
  `exerciseSessions` precedent.
- **The Trends section is own-profile only; another lifter's profile shows no charts.** The
  handoff asked the planner to name which of "computed from visible sets or omitted" — omitted,
  because a chart computed from only the sets the viewer may see is not "real history": a lifter
  with mixed public/private sessions would show fake dips and gaps presented as their training
  trend, exactly the dishonesty B42 was built to avoid. (A coach would see a *different* wrong
  chart than a stranger.) `workout_analyses` is owner-only RLS, and widening anything for a
  chart is out of the question. YOU-7 is a You-tab feature ("on the profile" — the lifter's
  own); nothing in its DoD requires charts on other people's profiles. Recorded as the named
  decision; revisit only if the PRD's social surface ever asks.
- **The volume series is computed from local raw `sets` via `sessionVolumeKg`, not read from
  the mirrored `workout_analyses.total_volume_kg`.** The mirror is pull-only: a workout
  finished in airplane mode has no mirrored row until reconnect, so a chart reading the mirror
  would fail the step DoD's "update after a new workout" exactly where offline-first matters
  most. Computing from sets through the one volume home gives the same number the server
  stores (same sets, same `sessionVolumeKg`) and works with no signal. The B42 trend *averages*
  are not chart inputs — they are 10-session means, not per-session points.

## Shape of the thing

No migration, no sync change, no server change, no new dependency. One new data module (device
reads + pure series math), one new pure chart-layout module, two new components, and a fourth
tab on the own profile. The ERD is untouched; the flowchart gains the Trends section and its
data path (Document step).

### 1. `frontend/src/workout/trendSeries.ts` (new) — the data, one home

Device reads (read-only, `user_id`-filtered, parameters never pasted — the `history.ts` rules)
plus the pure series builders. All math imports from `@training-math`; timestamps are compared
through `timestampMs` from `@analysis` (the one parser — device rows mix `…Z` and `…+00:00`
serializations, whose text does not sort like their instants; B42 G13).

- `volumeSeries(db, userId): Promise<TrendPoint[]>` — every **finished** workout (`ended_at
  not null`) with its sets' `(reps, weight_kg, is_warmup)`, grouped per workout in JS, each
  session's volume via **`sessionVolumeKg`** (the one home; warm-ups and weightless sets add
  0). One point per session: `{ workoutId, startedAtMs, valueKg }`, oldest → newest (newest
  right, per the handoff). Sessions whose volume is 0 (all-bodyweight, all-warm-up) are **kept
  at 0** — a bodyweight week is real history, and dropping it would fake a flat line where
  training changed. Empty finishes (zero sets) are **excluded** — the B42 G4 rule: a saved
  moment, not training.
- `e1rmSeries(db, userId, exerciseId): Promise<TrendPoint[]>` — the finished workouts holding
  at least one set of `exerciseId` (the `exerciseSessions` query shape), each session's point
  = `recordsFromSets(thatSessionsSets).e1RmKg` — the classifier's own qualifying rules
  (no warm-ups, weight > 0, whole reps 1–30) with zero restating, so the chart's peak can
  never disagree with the stored e1RM PR. Sessions where no set qualifies contribute **no
  point** (unlike volume: there is no honest zero for an estimate).
- `trendExercises(db, userId): Promise<TrendExercise[]>` — the picker's rows: distinct
  exercises with ≥ 1 e1RM-qualifying set in a finished workout, each `{ exerciseId, name,
  newestQualifyingMs }`, names resolved exactly as `allCurrentPrs` does (`left join exercises`
  with the owner filter; a missing name renders as the existing unnamed-exercise constant) —
  soft-deleted customs stay offered, because their logged history is kept (the B31 stance) and
  the chart is that history. Ordered newest-first so the default pick (first row) is the
  exercise with the newest qualifying set. The qualifying predicate
  (`weight_kg > 0`, `reps between 1 and 30`, `not is_warmup`) appears in SQL here and in
  `e1rmSeries`'s JS via `recordsFromSets` — the SQL is a *prefilter* for which exercises/rows
  to fetch, the math module remains the decider of every number (same arrangement as B42's
  readers: over-fetch, shared module owns semantics). A comment marks the mirror pair.
- `filterWindow(points, window, nowMs)` — pure: the 3 m / 6 m / 12 m / all cut on
  `startedAtMs` (calendar months back from `nowMs`, the `Date` arithmetic in one place).
  Cheap, so the handoff's optional window selector is in.

No caps on the reads: "long-term … from real history" is literal, the rows are the lifter's own
phone-local data, and a year of 5×/week training is ~250 sessions / a few thousand set rows —
SQLite reads of this size are what the Workout tab already does. If a device ever measures slow
here, a bounded read is a one-place change (the no-speculation rule; weighed in Risks).

### 2. `frontend/src/components/profile/chartLayout.ts` (new) — pure geometry

`buildChartLayout(points, width, height, unit)` → the SVG drawing plan: the polyline path
string, point markers (only when few enough to read, ≤ 40 — a named constant), x ticks (3–5
date labels across the span, short month-year text built from the same fixed month names
`format.ts` uses — **never `toLocaleDateString`**, so every phone and every test machine
prints the same tick), y ticks (3–4 "nice" round values **computed in the lifter's display
unit**, not computed in kg and converted — a tick grid that is clean in kg prints as 220.5 lb
noise; the kg → display conversion happens through `displayWeight` *before* niceness is
chosen), and the accessibility sentence. Handles the edge cases as data, not
rendering ifs: empty → null layout; a single point → one marker, no path; all-equal values →
a flat line with a non-zero y range (no divide-by-zero); identical timestamps → points share
an x. Pure, no React, no I/O — the fixture-tested heart of the step. Y-axis baseline: volume
charts start at 0 (tonnage is a quantity; a truncated axis manufactures drama); e1RM charts
span min→max padded (an e1RM never nears 0 and a 0-based axis would flatten real progress) —
each a named option the caller sets, with the reasoning in the comment.

### 3. `frontend/src/components/profile/TrendChart.tsx` (new) — the drawing

A dumb SVG renderer of one layout: `Svg`/`Path`/`Circle`/`Line`/`SvgText` from
`react-native-svg` (the MuscleMap precedent — already installed, no charting library). Axis
text in theme colors/sizes; the chart is `accessible` with the layout's sentence (the MuscleMap
accessibility pattern — shapes mean nothing to a screen reader), e.g. "Volume over time: 24
sessions from Mar 3 to Nov 12, latest 8,400 kg, highest 9,210 kg." Width from `onLayout`
(the screen's width minus gutters), fixed height; until the first layout pass reports a width,
nothing is drawn (no zero-width division ever reaches the geometry).

### 4. `frontend/src/components/profile/TrendsSection.tsx` (new) — the section

What the Trends tab shows, top to bottom: the window chips (3 m / 6 m / 1 y / All —
`ChoiceChips`, default All), the **Volume** chart card ("per session" sublabel), the **e1RM**
chart card with the exercise picker chips above it (horizontal scroll, default = newest
qualifying). Every number through `displayWeight` / `formatWeight`; dates through the existing
date labels; **no performance claims, no AI** — the only copy is axis labels, the lifter's own
numbers, and calm empty states: no finished workouts → "Charts grow here as you log workouts";
an exercise with one session → the single-marker chart (the DoD's "render from logged data"
holds at n=1); windows that empty a series → "Nothing in this window yet". Reads go through a
loader with the ProfileView generation-counter pattern; a failed device read shows the
existing local-read error line with Retry.

### 5. `ProfileView.tsx` (edit) — the fourth tab

`SECTION_OPTIONS` gains `{ value: 'trends', label: 'Trends' }` **on the own profile only**
(the options list becomes a function of `own`; another lifter's profile keeps exactly its
three tabs). `loadSection('trends')` loads the series behind the same db-still-opening guard
the History/PRs loaders use; the existing focus effect re-reads the **open tab only** on every
focus — which is precisely "update after a new workout" (finish a workout, come back to You →
Trends re-reads SQLite and the new session is the rightmost point, offline included, since
both series read the phone), and also what bounds the cost: the full-history read runs only
while Trends is the tab being looked at, never behind Posts or History. The window and
exercise selections are independent (the window filters both series; switching exercises
re-reads one). The Trends tab renders `TrendsSection` as the list's single item (the FlatList
stays; trends is one non-paged row).

## Data model impact

None. No server migration, no device schema change, no new sync table, no RLS change, no new
index. `database-erd.md` untouched; `app-flow.md` gains the Trends tab, its two charts and the
SQLite-only data path (marked own-profile-only).

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/workout/trendSeries.ts` (+ `trendSeries.test.ts`) | new — series reads + builders + window filter |
| `frontend/src/components/profile/chartLayout.ts` (+ test) | new — pure chart geometry |
| `frontend/src/components/profile/TrendChart.tsx` (+ test) | new — SVG renderer |
| `frontend/src/components/profile/TrendsSection.tsx` (+ test) | new — the tab's content |
| `frontend/src/components/profile/ProfileView.tsx` (+ test edits) | edit — own-only fourth tab, section loading |
| `frontend/src/__tests__/you-profile.test.tsx` | edit — route test: Trends tab over a seeded database |
| `docs/diagrams/app-flow.md` | edit (Document step) — Trends section + data path |

No new route (`you.tsx` and `profile/[id].tsx` already exist), but the builder regenerates
typed routes with `npx expo start --offline` (~150 s) before `tsc` → lint → Jest anyway (the
standing footgun); Jest full-suite timeouts rerun with `--maxWorkers=50%` (Gate 2 reruns cold
at default workers). No migration and no deploy, so Gate 2 is the check chain plus a skim.

## How each definition of done becomes observably true

- **"The charts render from logged data":** `trendSeries` fixtures — a seeded device database
  (node SQLite driver, the established test harness) with mixed history: plain sessions, a
  warm-up-only session (volume 0, no e1RM point), an empty finish (excluded), a bodyweight
  session (volume 0 kept), two sessions of the picker exercise with hand-computed best e1RMs
  (one where the best set is *not* the heaviest — more reps wins via Epley), a 31-rep set
  (no e1RM), out-of-window sessions. Each series pinned to hand-worked points.
  `chartLayout` fixtures pin path/ticks/sentence for normal, empty, single-point, flat-value
  cases. The route test renders You → Trends over a seeded database and asserts both charts'
  accessibility sentences carry the seeded numbers.
- **"…and update after a new workout":** the route test finishes (inserts) another workout
  into the same database, re-focuses, and asserts the sentence now counts one more session
  with the new latest value. Device-wise this is the focus re-read, the established pattern.
- **YOU-7 (trends half):** the charts above are the long-term trends; the route test over real
  (seeded) history is the "from real history" proof. The grades half stays B45's; the step
  list's `partial: true` holds.
- **Offline:** both series read SQLite only — the Trends section itself makes no client
  call, so the route test asserts the charts render and update with the fake server answering
  only the header/teams reads the You tab makes anyway. That the section's own data path
  never touches the network is the offline proof the Jest way (plus the device check on
  Tristen's list).

## Out of scope (and where it lands)

- **Strength-level grades** on profile or charts — B45 (Blocked, licence).
- **Trends on another lifter's profile** — omitted by decision above; nothing schedules it.
- **Per-muscle / per-body-part volume charts, split-aware views** — nothing asks for them.
- **The analysis screen's trend card** (B42) — untouched; different question (this session vs
  10-session mean), different surface.
- **Charts on share cards or posts** — the share card is untouched.
- **A charting library, downsampling pipelines, chart interactivity** (tap-a-point tooltips,
  pinch zoom) — nothing speculative; the measured-need bar applies.
- **`workout_analyses`-backed anything** — the mirror stays a reader for the analysis screen.

## Risks a reviewer should weigh

1. **The unbounded history read.** `volumeSeries` reads every finished workout's sets; a
   multi-year power user could hold tens of thousands of set rows. Accepted deliberately
   (phone-local SQLite, launch scale, "long-term" is the point, no-speculation rule), with the
   mitigation shape recorded: if a device measures slow, aggregate-per-workout reads or a
   points cap are one-place changes in `trendSeries.ts`. The reviewer should confirm the reads
   select only the columns the math needs.
2. **The qualifying predicate exists twice** — SQL prefilter in `trendExercises` /
   `e1rmSeries`'s row fetch, and the real rules in `recordsFromSets`. The SQL may only
   *over-include* (fetch a row the math then ignores) — never the reverse — or the picker
   could offer an exercise whose chart is empty, or the chart drop a qualifying session. The
   mirror-pair comment and a test (a set qualifying in SQL but not in math, e.g. fractional
   reps, renders no point but breaks nothing) guard it.
3. **Hand-rolled chart geometry.** Axis "niceness", flat-series ranges, single-point layouts
   and label collision are exactly where home-grown charts embarrass themselves. The whole
   surface is a pure function with fixture tests, and the drawn vocabulary is deliberately
   small (one line, markers, 3–5 ticks per axis) — but the reviewer should read
   `chartLayout.test.ts` against the edge-case list before the components.

## Grilling decisions (settled)

Run in the planner session at full severity (headless; Gate 1 is where Tristen overrules).

- **G1 — "Per-exercise e1RM needs a picker — isn't the whole-body proxy a smaller build?"**
  It is smaller and it is wrong: there is no defensible way to average Epley estimates across
  movements (an e1RM is per-lift by definition; a "total" mixes squat days and arm days into
  a sawtooth that means nothing), and the adjacent features (grades, PR books) are all
  per-exercise. The picker is a `ChoiceChips` row over data one query returns. Settled:
  per exercise; recorded as the handoff's requested reading.
- **G2 — "Own-profile only: is the step quietly narrowing YOU-7?"** No — checked YOU-7's row:
  "grades … and long-term trend charts render from real history", a You-tab feature; nothing
  names other profiles. The alternative (charts from visible sets) actively misrepresents a
  lifter's training to strangers and shows different lies to different viewers. Omission is
  the honest reading, named in the plan as the handoff required.
- **G3 — "Volume from raw sets re-computes what `workout_analyses` already stores — mirrored
  math?"** No: a mirrored copy would be a *second implementation* of volume. Both the server
  row and this chart call the same `sessionVolumeKg`; calling the one home twice is the rule
  working as intended, and the mirror row can't serve the offline DoD (pull-only, absent until
  sync). Checked: `total_volume_kg` is rounded server-side to 0.001 — chart points are not
  compared numerically against mirror rows anywhere, so no round-trip trap exists.
- **G4 — "Zero-volume sessions kept, empty finishes dropped — defend the asymmetry."** An
  empty finish has no training in it (B42 G4, same rule, same reason). A bodyweight session
  is training whose *external load* is 0 — the volume definition's own documented stance.
  Dropping it would show a lifter who switched to calisthenics as having stopped training.
  e1RM differs because an estimate has no honest zero: no qualifying set → no point.
- **G5 — "Why build chart layout by hand instead of a library?"** The handoff's standing
  input (and the no-speculation rule): `react-native-svg` is installed, the need is one line
  chart twice, and a charting dependency is a Gate 1 question only on measured need. The
  hand-rolled surface is bounded by making all geometry a pure tested function (Risk 3).
- **G6 — "The window selector was 'optional, only if cheap' — is it?"** Yes: one pure filter
  over already-loaded points plus one `ChoiceChips` row, no extra reads. In. Default All, so
  the first render is the long-term picture the step is named for.
- **G7 — "Does the fourth tab break the three-tab ProfileView contract anywhere?"** Checked:
  `SECTION_OPTIONS` is a local constant consumed once; `ProfileSection` is exported and used
  only by ProfileView and its test. Making options own-conditional and adding a `'trends'`
  arm to `loadSection`/`items` is contained; another lifter's profile renders exactly today's
  three tabs (asserted in the profile route test).
- **G8 — "Is `recordsFromSets` per session actually the best-e1RM-per-session, or does
  book-folding distort it?"** Checked the module: `recordsFromSets` folds `classifyPrs` over
  the given sets only; its `e1RmKg` is the max Epley estimate among qualifying sets of that
  list. Ties and ordering don't change the max. It is the exact per-session best, with the
  classifier's qualifying rules for free — no new math function needed, nothing added to
  `@training-math`.
- **G9 — "`Date` arithmetic for windows — timezone traps?"** The cut is months-back-from-now
  on the device's clock, same class as the existing `workoutDateLabel`/"Yesterday" device-local
  date handling; a session near a window edge moving between 3 m and 6 m is cosmetically
  uninteresting and asserted only loosely (fixture uses mid-window dates). `timestampMs`
  handles the mixed serializations; no new parsing is written.
- **G10 — "Accessibility: is a chart with an SVG and a sentence enough for NFR-10?"** It
  matches the repo's precedent (MuscleMap: visual + one spoken sentence, inner shapes hidden).
  The sentence carries the actual numbers (count, span, latest, highest), which is more than
  decoration. A full accessible data-table rendering is nothing-speculative territory; the
  accessibility pass is B49 and can raise the bar across all charts at once.
- **G11 — "Nice y ticks in kg print as noise in lb."** The second pass's sharpest catch: a
  tick grid chosen on kg values and then converted shows 220.5 / 441.0 lb labels. Settled:
  niceness is computed in the display unit's space (convert first via `displayWeight`, then
  pick round ticks); the fixture tests pin a kg case and an lb case.
- **G12 — "Chart date labels must not depend on the device locale."** `toLocaleDateString`
  output differs across phones and Jest environments — the repo already solved this for
  `workoutDateLabel` with fixed name tables. The tick labels reuse that approach (short
  month + year from the same fixed names), so route tests can assert exact text.
- **G13 — "Does the picker offer an exercise whose custom was deleted?"** Yes — checked the
  `allCurrentPrs` precedent (left join, owner filter, no `deleted_at` filter): B31 keeps a
  deleted custom's logged history and its name, and the chart *is* that history. Nothing new
  decided; the precedent is followed.
- **G14 — smaller second-pass catches, settled in place:** the Trends loader sits behind the
  existing db-opening guard; the full-history read runs only while Trends is the open tab
  (the focus effect's existing shape, now doing cost-bounding work worth a comment); the
  chart draws nothing until `onLayout` reports a real width; the offline DoD proof is worded
  as "the section's data path makes no client call", since the You tab's header reads still
  use the fake server in route tests.
- **Scope verdict (planner):** right as written. The step stays a pure frontend read-and-draw
  over data earlier steps made trustworthy; the one place it could have sprawled (other
  lifters' profiles) is explicitly out with the reasoning recorded.

## Builder deviations (B46 build)

Recorded by the builder; none changes the step's scope or a Rule.

1. **New file `components/profile/useTrendData.ts` (+ test).** The plan put the loader inside
   ProfileView; it became a small hook (state, two numbered read counters, the picked exercise)
   so ProfileView only calls `reload()` from its existing `loadSection('trends')` arm. ProfileView
   still owns *when* (the focus effect, open tab only).
2. **Window "now" is the read time.** `filterWindow` counts back from `readAtMs`, stamped when the
   series were read (every focus), not `Date.now()` during render — the React purity lint refuses
   the latter, and the read time is the honest "now" for the data shown.
3. **`trendExercises` decides qualification per set with `recordsFromSets`** (not by the SQL
   alone), so the picker can never offer an exercise whose chart is empty; the SQL prefilter takes
   `MAX_EPLEY_REPS` as a parameter from `@training-math` (review: no literal 30 anywhere, copy
   included). A fractional-reps row is tested end to end (Risk 2's guard test).
4. **Two general formatters moved into `workout/format.ts`** — `groupThousands` (hand-written
   thousands separators) and `shortDateLabel` ("Mar 3, 2026"), beside `MONTHS` (now exported) —
   per review (Duplicated Code / misplaced formatter). `chartLayout.ts` keeps only chart geometry.
5. **Tick counts.** Y ticks aim for 4 and land on 3–5 (rarely 6) after snapping to nice steps;
   x ticks are at most 4, neighbouring duplicates merged, "Nov 12" day labels when the span is
   under 60 days, "Nov 2026" otherwise (G12's fixed names either way).
6. **A failed exercise pick keeps the chart already drawn** (and reverts the chip) instead of
   blanking both charts; only a failed *first* read shows the error + Retry. Review finding: the
   two failure paths now follow ProfileView's one rule (a failed re-read keeps what's shown).
7. **Exercise chips** are `ChoiceChips` inside a horizontal `ScrollView` (the plan's horizontal
   scroll); the window chips use `fill`.
8. **Card sublabels** say what the number is — "Per session, in kg · warm-ups and bodyweight sets
   add nothing" and "Best estimate per session (Epley formula), in kg" — the estimate wording the
   CLAUDE.md numeric-claims rule asks for. No performance claims.
9. **The three-tabs-for-others assertion** lives in `ProfileView.test.tsx`, not the
   `profile/[id]` route test. The You route test's offline proof runs with the fake server
   offline the whole time (stronger than "answers only header/teams").
10. **Not changed (review judgement call):** ProfileView's per-section ternaries gained a fourth
    arm rather than becoming a per-section map — a refactor of B25 code outside this step.
