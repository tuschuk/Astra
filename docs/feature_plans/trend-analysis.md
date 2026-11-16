# trend-analysis — B42: this session against the lifter's own rolling history

**Branch:** `trend-analysis` (from `main`)
**Build step:** B42 — covers **ANA-5** (volume/intensity compared against the user's own trend;
DoD: the analysis shows this session against the user's rolling history once enough data exists)
and completes **LOG-10** (optional RPE per set, feeding intensity analysis; the RPE box shipped
in B10 — this step is "the intensity analysis that reads it", which must use RPE when present
and still work when it is absent).
**Depends on:** B18 (the analysis engine: `_shared/analysis`, `analyze-workout`,
`workout_analyses`, the request pass, the analysis screen).

## Step definition of done (from the Build order)

The analysis compares the session's volume and intensity (using RPE when present) against the
user's rolling history once enough sessions exist. The trend section is **absent below the
threshold** and **its numbers match history above it**.

## Scope check

The scope is right as written and this plan stays inside it. Three readings settled up front:

- **"Rolling history" is session-count-based, not calendar-based.** The window is the lifter's
  previous N finished sessions, not "the last 30 days": a twice-a-month lifter would never
  cross a calendar threshold, and ANA-5 is about *their own* trend, whatever their cadence.
  (Grilled below, G1.)
- **"The section is absent below the threshold" is a storage fact, not a screen trick.** Below
  the threshold the trend columns are null on the stored row and the local computation returns
  no trend, so no surface anywhere can show a half-baked comparison.
- **"Its numbers match history above it"** is proven the B18 way: the same shared rules run on
  both runtimes over the same rows, fixture tests hand-compute the expected averages, and a
  both-paths test pins the fake server's stored row equal to the phone's local computation.

One deliberate extension inside the spirit of the scope: **existing analyses are upgraded.**
A bumped `ANALYSIS_ENGINE_VERSION` plus one extra clause in `workoutsNeedingAnalysis` makes the
existing request pass re-request rows computed by version 1, so old workouts grow their trend
section over a few syncs (bounded by the existing `ANALYSIS_BATCH_LIMIT = 10` per sync, exactly
like the pre-B18 backfill). Without this, ANA-5 would hold only for workouts finished after B42
ships — "the analysis shows this session against the user's rolling history" would be false for
every analysis that already exists. (G8.)

## Shape of the thing

No new tables, no new functions, no new sync machinery. The B18 engine grows a trend rule in
its one home, and every existing path carries it:

1. **`_shared/analysis/trend.ts`** (new) — the trend rules: which previous sessions count as
   history, the per-session measures (volume, mean RPE, load per rep), the rolling averages,
   and the thresholds. Pure, deterministic, Deno-clean, imported by `analysis.ts` so
   `buildAnalysis` returns the trend fields as part of the one analysis object. Both runtimes
   run this exact code — the server stores what the phone would compute (B18's contract,
   unchanged).
2. **`analyze-workout`** — the handler gains one read (`readHistory`): the caller's previous
   finished workouts and their sets, bounded and paged like every other read. The Deno wiring
   implements it with the existing `selectIn` helpers; the fake transport implements it over
   its in-memory rows. No rule lives in the handler (B18's discipline).
3. **`workout_analyses`** — six new nullable columns (server migration + device mirror V15).
   Null means "not computable" (below threshold, or no RPE anywhere); non-null means the
   comparison existed when the row was computed.
4. **The analysis screen** — a new "Against your trend" card between the summary card and the
   muscle map, rendered only when the analysis carries a trend, with every weight through
   `displayWeight` and every sentence worded as an estimate.

## The trend, precisely (the rules in `trend.ts`)

### What counts as history

For the workout being analyzed, its history candidates are the lifter's **own finished
workouts strictly before it**, ordered newest first. "Before" is the pair
`(started_at, id) < (workout.started_at, workout.id)` — the id tie-break keeps two workouts
with identical start stamps in one fixed order on both runtimes.

- **Qualifying session:** a candidate with **at least one logged set**. An empty finish (B18's
  `empty` copy state) is a saved moment, not training; letting it drag a rolling average toward
  zero would make the comparison lie. (G4.)
- **`TREND_WINDOW_SESSIONS = 10`** — the rolling window: the 10 most recent qualifying
  sessions. Why 10: it spans at least two full cycles of the common 3–5-day splits, so the
  average blends leg days with push days instead of comparing today's squats against
  yesterday's curls; and it is recent enough that a detrained month ago doesn't haunt the
  number. A product constant, not a performance claim — no copy cites it as science.
- **`TREND_MIN_SESSIONS = 5`** — the threshold ("once enough sessions exist"): below 5
  qualifying history sessions, no trend is computed and every trend column stays null. Why 5:
  fewer than one full split cycle means the average is dominated by whatever session types
  happen to be in it, and the comparison would mostly measure which day of the split it is.
- **`TREND_SCAN_LIMIT = 40`** — both readers fetch at most the 40 most recent *finished*
  candidates (plus their sets) and hand them to `trend.ts`, which filters empties and takes the
  first 10 qualifying. The cap bounds the read on both runtimes; a lifter with 31+ consecutive
  empty finishes before a window's worth of real sessions would compute a smaller history —
  deterministic on both sides, because the cap and the filter live in the shared module and
  both readers use the same cap. (G5.)

History is read **relative to the analyzed workout**, so re-analyzing an old workout (the
version-upgrade backfill) compares it against the sessions that preceded *it* — its honest
trend at the time — not against today's history. Deterministic forever, whenever recomputed.

**The shared module owns the final selection** (G13): `trend.ts` re-sorts the candidates it is
handed by `(timestampMs(started_at) desc, id desc)` and re-applies the strictly-before filter
with the same compare, so the readers only have to *over-fetch* (their own order + cap) and can
never fork the result through serialization differences — the device database holds both
locally written stamps (`…Z`) and server-pulled ones (`…+00:00`), whose raw text does not sort
like their instants. `timestampMs` (B18's one parser) is the compare on both runtimes.

### The per-session measures

Computed by `trend.ts` for the analyzed session and for each history session, from raw `sets`
rows (so no caller pre-digests anything):

- **Volume (kg)** — `sessionVolumeKg` from `@training-math`, the one volume home (warm-ups and
  unloaded sets add 0), rounded like B18 (`roundToIncrement(v, 0.001)`).
- **Mean RPE** — the average `rpe` over **non-warm-up sets whose `rpe` is a finite number
  between 1 and 10** (the server CHECK's range; out-of-range device leftovers are ignored
  rather than poisoning the average). Bodyweight and timed sets count — an RPE-9 set of
  pull-ups is intense work, and LOG-10 is about the lifter's rating, not the bar. Null when no
  set carries one. Rounded to 2 decimals (`roundToIncrement(v, 0.01)`) so the stored
  `numeric(4,2)` can never disagree with a locally computed value.
- **Load per rep (kg)** — the intensity measure when RPE is absent: session volume divided by
  the summed reps of the sets that contributed volume (same `setVolumeKg > 0` rule, so the two
  numbers always describe the same sets). "How heavy was the average rep" — rises when the
  lifter works heavier for fewer reps even if tonnage holds still. Null when no set carries
  load. Rounded to 3 decimals.

### The comparison

Only computed when qualifying history sessions ≥ `TREND_MIN_SESSIONS`; otherwise the whole
trend is null (the absent section):

- **`trend_sessions`** — how many qualifying sessions the averages cover (5–10).
- **`trend_volume_avg_kg`** — the mean of the history sessions' volumes (every qualifying
  session has one, possibly 0).
- **`trend_rpe_avg`** — the mean of the history sessions' mean RPEs, over the sessions that
  have one; null unless at least **`TREND_MIN_MEASURE_SESSIONS = 3`** of them do (below 3, one
  odd session owns the average).
- **`trend_load_per_rep_avg_kg`** — same rule over the sessions' load-per-rep values (≥ 3
  contributing sessions, else null).
- **`session_rpe_avg`**, **`session_load_per_rep_kg`** — the analyzed session's own two
  intensity measures, stored **whenever computable, independent of the threshold** (they are
  facts about this session; B44's deload rules and B46's charts read them without recomputing).

Deltas are **not stored** — the screen derives "about +12%" from the stored pair, so there is
one source of truth and nothing to drift.

**Which intensity line shows (the LOG-10 rule):** RPE when both sides have it
(`session_rpe_avg` and `trend_rpe_avg` non-null); else load per rep when both sides have that;
else no intensity line — and the volume comparison still renders, so the analysis "still works
when absent". The preference lives in one shared function (`trendCopy`, below), not in the
screen.

### Engine version

`ANALYSIS_ENGINE_VERSION` goes to **2**, and "older rules" joins the staleness rule in **both**
places that already have one (the B18 symmetry):

- `workoutsNeedingAnalysis` treats `engine_version < ANALYSIS_ENGINE_VERSION` as needing
  recompute (alongside the existing missing/stale rules) — the whole upgrade story: no job, no
  migration of row contents, the existing pass refreshes 10 per sync.
- `analysisForScreen` treats a stored row with `engine_version < ANALYSIS_ENGINE_VERSION` like
  a stale row and renders the local computation instead (G12). Without this, a version-1 row —
  "fresh" forever by its timestamps — would block the trend section on every pre-B42 workout
  until the upgrade pass reaches it, and **forever** on a phone that stays offline. With it,
  the screen shows the version-2 analysis at once and the stored row catches up on sync,
  invisible as always.

### What the trend deliberately does not know (recorded, accepted)

- **History edits don't re-stamp this workout.** Editing last Tuesday's workout changes the
  trend a *recompute* would produce, but the stored row keeps the comparison as computed — the
  B18 "new-PR staleness is by workout only" class (its deviation 11). The screen shows the
  stored row while it is fresh by this workout's own stamp. Self-corrects whenever this
  workout's analysis is recomputed for any reason.
- **A phone mid-backfill computes from the history it has.** A reinstalled device that hasn't
  pulled everything yet would locally compute a thinner trend than the server's; the screen
  prefers the stored (server) row whenever it is present and fresh, so this only shows offline
  on a half-synced phone, and heals on sync. (Same rows → same numbers still holds; the rows
  differ.)
- **Split-aware comparisons** (leg day vs recent leg days) are not built — ANA-5 says "the
  user's own trend", session-grain; per-exercise trends are B46's charts.

## Data model

### Server migration — `backend/supabase/migrations/<version>_analysis_trend.sql`

Applied live via `mcp__supabase__apply_migration`, file renamed to the recorded version
(pipeline convention). Six nullable columns on `public.workout_analyses`:

```sql
alter table public.workout_analyses
  -- Bounds mirror TREND_MIN_SESSIONS / TREND_WINDOW_SESSIONS in _shared/analysis/trend.ts —
  -- change them together (the limits.ts precedent).
  add column trend_sessions            integer       check (trend_sessions between 5 and 10),
  add column trend_volume_avg_kg       numeric(10,3) check (trend_volume_avg_kg >= 0),
  add column trend_rpe_avg             numeric(4,2)  check (trend_rpe_avg between 1 and 10),
  add column trend_load_per_rep_avg_kg numeric(8,3)  check (trend_load_per_rep_avg_kg >= 0),
  add column session_rpe_avg           numeric(4,2)  check (session_rpe_avg between 1 and 10),
  add column session_load_per_rep_kg   numeric(8,3)  check (session_load_per_rep_kg >= 0);
```

No RLS change (the B18 posture — owner select only, service-role writes — already covers new
columns), no new index, no new trigger. RPE is sensitive-adjacent but lives inside the same
owner-only row as everything else here; no extra privacy machinery is warranted.

### Device mirror — schema V15 (`frontend/src/db/schema.ts`)

```sql
alter table workout_analyses add column trend_sessions integer;
alter table workout_analyses add column trend_volume_avg_kg real;
alter table workout_analyses add column trend_rpe_avg real;
alter table workout_analyses add column trend_load_per_rep_avg_kg real;
alter table workout_analyses add column session_rpe_avg real;
alter table workout_analyses add column session_load_per_rep_kg real;
```

`MIGRATIONS` gains V15; `TABLE_COLUMNS.workout_analyses` (and `fromSqlRow`'s typing) gain the
six columns, so the existing generic pull/save machinery (`saveServerAnalysesTx`, the
`workout_analyses` pull cursor) carries them with **no sync code changes**. Still pull-only,
still no outbox lines, ever.

### `AnalysisSet` gains `rpe`

The shared `AnalysisSet` type (and the three set readers: the Deno `selectIn` columns, the
phone's `readAnalysisInput` query, the fake transport) add `rpe: number | null`. The device
`sets` table and the server table both already have the column (B10) — nothing else moves.

## The reads (one shape, two runtimes)

`AnalysisInput` gains `history: readonly TrendSessionInput[]` where
`TrendSessionInput = { id: string; started_at: string; sets: readonly AnalysisSet[] }` —
the ≤ 40 newest finished candidates strictly before the analyzed workout, newest first,
**unfiltered** (the shared module does the qualifying/windowing, so the selection rule can
never fork between runtimes).

- **Edge function** (`analyze-workout/index.ts`): `readHistory(workout)` — one paged read of
  `workouts` (`user_id = caller`, `ended_at not null`, the `(started_at, id)` strictly-before
  filter as a PostgREST `or(started_at.lt.…, and(started_at.eq.…, id.lt.…))`, ordered
  `started_at desc, id desc`, limit 40), then its entries and sets through the existing
  `selectIn` helpers, grouped per workout. The handler passes it to `buildAnalysis`; still no
  rules in the handler.
- **Phone** (`frontend/src/analysis/analysis.ts` → `readAnalysisInput`): one SQL read of the
  candidate workouts (same order, same strictly-before pair, `limit 40`), one joined read of
  their sets, grouped. Runs inside the existing `localAnalysis` path, so the offline screen
  and the staleness math change not at all.
- **Fake transport**: implements `readHistory` over its in-memory rows through the real
  `handler.ts` (the B18 arrangement, deviation 7), so app-level Jest exercises the whole
  request end to end.

## The words — `trendCopy` in `_shared/analysis/copy.ts`

The trend lines are **built from the stored numbers at render time, not stored as strings**.
B18's G2 settled that the *headline/message* are stored because the stored analysis must be a
complete artifact (posts link to it); the trend lines are pure arithmetic restatements of six
stored numbers, so storing their prose would be a second copy of the same fact. One shared
function keeps the wording deterministic and in one reviewable home:

- `trendCopy(trend)` returns the comparison lines as structured parts (label + the delta
  sentence + which measure), e.g. volume: *"About 12% more than your recent average"* /
  *"About 8% less than your recent average"* / *"Right around your recent average"* (within
  ±2% reads as "around" — a named constant); intensity (RPE): *"Average RPE 7.5 — about 0.5
  above your recent sessions"* (RPE deltas are absolute, not percentages — a percentage of a
  10-point scale reads as nonsense); intensity (load per rep): the volume-style percent
  wording. The volume percent line only exists when `trend_volume_avg_kg > 0` (no dividing by
  an all-bodyweight history); weights themselves are rendered by the screen through
  `displayWeight` — **no units and no weights inside the shared strings** (the B18 copy rule).
- Every sentence is worded as an estimate ("about", "around") — CLAUDE.md's wording rule.
  These are descriptive statistics of the lifter's own logged data, not performance claims, so
  no citation is required; the copy makes no effect claims ("you're getting stronger") at all,
  and the headline/message states stay untouched (ANA-4's four states don't change, so no copy
  re-review of B18 strings is triggered).
- The existing banned-word tripwire test extends over the new strings.

## The screen — "Against your trend"

`frontend/src/app/analysis/[id].tsx`: one new `Card` between the summary card and the muscle
map, rendered **only when** the analysis carries a trend (`trend_sessions != null`) **and** at
least one comparison line exists. Contents:

- A header line naming the basis: "Compared with your last N sessions".
- **Volume row:** this session's volume (already on screen above) against
  `trend_volume_avg_kg` via `displayWeight`, with `trendCopy`'s delta sentence.
- **Intensity row** (when `trendCopy` picked one): the RPE pair or the load-per-rep pair
  (weights through `displayWeight`), with its sentence.

Below the threshold, with no stored trend and no locally computable one, the card simply never
renders — the DoD's absence, observable on screen and in the row. Old stored rows
(version 1, all-null trend columns) show no section until the pass upgrades them; the screen
never computes a trend to patch over a stored row (stored-vs-local selection logic is
untouched).

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_analysis_trend.sql` | new — six nullable columns + CHECKs (applied live, renamed to recorded version) |
| `backend/supabase/functions/_shared/analysis/trend.ts` (+ `trend.test.ts`) | new — measures, window, thresholds, `buildTrend`; the four constants |
| `backend/supabase/functions/_shared/analysis/summary.ts` | edit — `AnalysisSet.rpe`; `AnalysisInput.history`; (types only — numbers stay in trend.ts) |
| `backend/supabase/functions/_shared/analysis/analysis.ts` (+ test) | edit — `buildAnalysis` includes the trend fields; `ANALYSIS_ENGINE_VERSION = 2` |
| `backend/supabase/functions/_shared/analysis/copy.ts` (+ test) | edit — `trendCopy`, the ±2% "around" constant; tripwire covers new strings |
| `backend/supabase/functions/_shared/analysis/index.ts` | edit — re-export trend types/functions |
| `backend/supabase/functions/analyze-workout/handler.ts` (+ tests in `functions/tests/`) | edit — `AnalyzeDeps.readHistory`; passes history to `buildAnalysis` |
| `backend/supabase/functions/analyze-workout/index.ts` | edit — `readHistory` over `selectIn`/paged reads; `rpe` in the sets select; `ANALYSIS_COLUMNS` + new columns; redeploy via `deploy_edge_function` |
| `frontend/src/db/schema.ts` (+ test) | edit — V15 |
| `frontend/src/db/dao.ts` (+ test) | edit — `WorkoutAnalysisRow` + `TABLE_COLUMNS` gain the six columns |
| `frontend/src/analysis/analysis.ts` (+ test) | edit — history read in `readAnalysisInput`; `rpe` in the sets read; `workoutsNeedingAnalysis` and `analysisForScreen` treat `engine_version < ANALYSIS_ENGINE_VERSION` as stale |
| `frontend/src/test-utils/fakeTransport.ts` | edit — history + rpe through the real handler |
| `frontend/src/app/analysis/[id].tsx` | edit — the trend card |
| `frontend/src/__tests__/analysis.test.tsx` | edit — trend-section route tests (route tests never live in `src/app/`) |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) — columns; trend section + history data path |
| `docs/BUILD_LIST.md` | not this branch — statuses flip at Gate 2 |

Builder footguns (precedent): regenerate typed routes with `npx expo start --offline` (~150 s)
**before** `tsc --noEmit` → lint → Jest (no new route this time, but the generated file goes
stale regardless); **apply the migration via MCP *before* redeploying the function** — the
redeployed upsert writes the six columns, so deploying first would 500 every analyze call
against the live table (the old deployed function keeps working against the migrated table,
since its upsert names no new columns — the safe order is migrate → deploy); rename the
migration file to the recorded version via `list_migrations`; confirm `verify_jwt` stays on
after the deploy; if a full-suite Jest run hits the 30 s timeouts, rerun with
`--maxWorkers=50%` (Gate 2 reruns cold at default workers).

## How each definition of done becomes observably true

- **Step DoD "absent below the threshold":** fixtures with 0 and 4 qualifying history sessions
  → `buildAnalysis` returns null trend fields, the stored row's columns are null, the screen
  renders no trend card (route test). A 5th qualifying session flips all three (the boundary
  is tested on both sides).
- **Step DoD "its numbers match history above it":** fixtures with hand-computed expectations —
  6 mixed sessions (one empty to prove exclusion, one bodyweight-only, varying RPE coverage) —
  pin `trend_volume_avg_kg`, both RPE averages, both load-per-rep values to hand-worked
  numbers; the B18 both-paths test extends: fake-server stored row equals the phone's local
  computation field for field, trend columns included.
- **ANA-5:** above threshold the screen shows the comparison (route test asserts the card, the
  "last N sessions" line, and the delta sentence); below it, nothing. The version-2 upgrade
  tests: a stored version-1 row is re-requested by the pass and comes back with trend fields;
  and the screen renders the local version-2 computation (trend included) over a fresh stored
  version-1 row (G12).
- **LOG-10 "uses RPE when present":** a session + history with RPE → the intensity line is the
  RPE comparison (fixture pins the averages; route test pins the rendering).
- **LOG-10 "still works when absent":** the same session with every `rpe` null → analysis
  still computed, volume line intact, intensity falls back to load per rep; a history with
  < 3 RPE sessions → RPE arm null, fallback shown; no load either (all bodyweight, no RPE) →
  volume-only card; nothing computable → no card, analysis otherwise unchanged.
- **Gate 2 probe** (recorded here for the gate): seed a throwaway user with 6 finished
  workouts via SQL (varying volume/RPE, one empty), get a JWT, call `analyze-workout` over
  HTTP for the newest → 200 with trend fields matching a hand computation (5 qualifying
  sessions; the empty one excluded); call it for the user's 3rd workout → trend columns null
  (only 2 qualifying sessions precede it); confirm a PostgREST write to the new columns is
  still refused; clean the rows up.

## Testing (beyond the inline notes)

All Jest, node SQLite driver, fake transport — never the live project. Additional cases:
tie-broken `(started_at, id)` ordering (two history workouts sharing a start stamp — both
runtimes pick the same 10); the scan cap (41 candidates → the 40 newest considered);
out-of-range `rpe` on a device row ignored by the mean; rounding round-trips (stored
`numeric(4,2)`/`real` vs recomputed — the `roundToIncrement` discipline keeps them equal);
`workoutsNeedingAnalysis` ordering unchanged (version-upgrade candidates obey the same
newest-first batch cap and pending-outbox guard); V15 migration on a populated V14 database
keeps existing rows readable with null trend columns.

## Out of scope (and where it lands)

- **Deload / next-session recommendations** reading these numbers — B44 (Blocked; it inherits
  `session_rpe_avg` and the trend columns as inputs).
- **Long-term e1RM / volume charts** — B46 (profile trends; depends on B42's data honesty, not
  on more columns here).
- **Recovery-aware adjustments and any cited performance figures** — B56.
- **Calendar-window trends, split-aware or per-exercise comparisons, median instead of mean,
  bodyweight-informed volume** — not built; each is a one-place change in `trend.ts` if device
  evidence ever asks.
- **Trend lines on share cards or posts** — the share card and post flow are untouched.
- **Realtime/notification anything** — unchanged B18 posture.

## Risks a reviewer should weigh

1. **Two history readers must hand the shared module the same candidates.** The final
   ordering, tie-break and strictly-before filter live in `trend.ts` (G13), so a reader fork
   only matters at the scan cap's boundary: the *fetch* (filter, order, cap 40) is spelled
   twice — PostgREST in `index.ts`, SQL in `analysis.ts` — and the device's mixed timestamp
   serializations (`…Z` vs `…+00:00`) can order the 40th candidate differently than the server
   would. Silently breaks "numbers match history" only for lifters past 40 candidates with a
   format-skewed boundary row. The both-paths fixture test must include a same-stamp tie and a
   cap-overflow case — review should confirm it does, and that the shared re-sort/re-filter is
   actually what both paths flow through.
2. **The version-2 recompute wave touches every existing analysis row.** Bounded (10 per sync,
   existing cap) and idempotent (upsert), but every active lifter's next syncs will re-run the
   function ~once per historical workout, each call now also reading up to 40 workouts' sets.
   Review should sanity-check the read sizes (selectIn chunking) and that the pass's
   newest-first order + pending-outbox guard still hold, so the wave can't starve fresh
   workouts (new-workout analyses are the newest, so they go first — confirm the query keeps
   that true for version-upgrade candidates too).
3. **The product constants are judgment calls** (window 10, threshold 5, measure minimum 3,
   ±2% "around", load-per-rep as the RPE fallback, mean not median, empty sessions excluded).
   All are named constants with one-line rationales in `trend.ts`, none is cited as science in
   copy, and Gate 1/Tristen can overrule any of them cheaply before code exists. The one that
   most changes the product feel is the threshold (5): lower it and the section appears in a
   lifter's first week with noisier numbers.

## Grilling decisions (settled)

Run in the planner session at full severity (headless; Gate 1 is where Tristen overrules).
Questions that changed or sharpened the plan:

- **G1 — "Rolling history: sessions or days?"** Days ("last 30 days") was worked through and
  rejected: a low-frequency lifter never crosses a day-based threshold even with months of
  honest history, and a vacation empties the window entirely, making the section flicker in
  and out. Session-count windows degrade gracefully for every cadence and are what "the user's
  own trend" means for a logger whose unit of work is the session. Calendar windows remain a
  one-place change in `trend.ts`.
- **G2 — "Mean or median?"** Mean. Median is more outlier-robust, but with a 10-session window
  the realistic outlier (one marathon session) moves the mean by ≤ ~10% of its own excess, the
  copy words everything as "about", and mean matches the "your recent average" wording a
  lifter expects. Median is a one-line swap in `trend.ts` if device evidence asks.
- **G3 — "Why not store the delta percentages?"** Because they are pure functions of two stored
  numbers; storing them adds columns that can disagree with their inputs after any rounding
  change. The screen (through `trendCopy`) derives them — one source of truth. This also
  answered "why not store the trend sentences": same reason, prose edition; and B18's G2
  precedent (store copy) was re-examined, not blindly copied — its argument was artifact
  completeness for *posts linking to analyses*, and nothing links to trend prose.
- **G4 — "Do empty finishes count as history?"** No. An accidental or ceremonial finish with
  zero sets is not training; one of them inside the window drags the volume average down and
  manufactures a flattering "+25% above your average" for a normal session — an uncited,
  wrong-feeling performance pat. Excluding them is the honest reading of "sessions". The
  qualifying rule (≥ 1 set) lives in `trend.ts`, tested.
- **G5 — "The scan cap forks determinism — a 41-empties lifter gets different numbers than an
  uncapped read would give."** Conceded and accepted: the cap must exist (both runtimes need a
  bounded read), it lives in one shared constant used by both readers, and the affected case —
  31+ empty finishes interleaved before the window fills — is pathological. The alternative
  (loop pages until 10 qualifying found) makes the edge function's work unbounded on exactly
  the pathological accounts. The both-paths test pins the capped behaviour.
- **G6 — "Is load-per-rep real intensity, or a made-up stat to dodge the RPE-absent case?"**
  It is the standard load-based proxy (average weight per working rep — rises as the lifter
  works heavier for fewer reps) and is computed from the same sets as the volume number, so it
  can't contradict it. Alternatives examined: e1RM-relative session intensity (needs a
  per-exercise 1RM reference that shifts over time — a research project, not a step), and
  omitting intensity entirely without RPE (fails the scope's "compares volume **and**
  intensity … *using RPE when present*", which presumes intensity exists without it). The
  screen labels it plainly ("load per rep") — no pretense that it is RPE.
- **G7 — "Bodyweight sets carry RPE into the average, but contribute nothing to volume — is
  the comparison incoherent?"** No: the two arms measure different things on purpose. RPE is
  the lifter's own effort rating and is honest for bodyweight work (LOG-10 put the box on
  every set); volume is external load by the B06 definition. A bodyweight-heavy session reads
  "volume below average, RPE above" — which is exactly what happened.
- **G8 — "Is the version-2 recompute of old rows scope creep?"** No — it is ANA-5's own DoD
  applied to rows that already exist: "the analysis shows this session against the user's
  rolling history once enough data exists" must hold when a lifter opens last month's
  analysis. The machinery is one clause in an existing query feeding an existing bounded pass;
  nothing new runs. The wave's cost is weighed in Risks (2).
- **G9 — "Six columns — why not one jsonb `trend`?"** Columns. B44 (deload rules) and B46
  (profile trends) read these numbers server-side and on-device; typed columns with CHECKs are
  queryable, self-documenting in the ERD, and the mirror machinery carries them generically.
  A jsonb blob would re-introduce parse-at-every-reader (the `new_prs` wart, which exists for
  a genuinely list-shaped value — the trend is six scalars).
- **G10 — "Does `session_rpe_avg` stored below the threshold leak a half-built feature?"** No
  surface renders it outside the trend card; it is stored because it is a per-session fact
  (computable with zero history) that B44 needs, and recomputing it later would force another
  engine-version wave. Deliberate, documented in the migration comment.
- **G11 — "The threshold constants are uncited numbers — does CLAUDE.md's citation rule
  bite?"** No: the rule governs *numeric performance claims in product copy* ("estimated 3%
  stronger"). Window sizes are product tuning, not claims; the copy never names them as
  science, and every delta sentence is worded as an estimate. Checked every new string against
  the rule; the only numbers in copy are the lifter's own session count, averages and deltas.
- **G12 — "What does a fresh version-1 stored row do to the screen after V2 ships?"** The
  sharpest catch of this grilling: it blocks the trend section — forever, on a phone that
  stays offline — because `analysisForScreen` prefers any stored row that is fresh by
  timestamps, and version 1 stays timestamp-fresh until the upgrade pass replaces it. Settled:
  "computed by older rules" joins the staleness rule in the screen's preference too, mirroring
  the request pass. Verified in `frontend/src/analysis/analysis.ts` that both places share the
  `isStale` seam, so this is one clause each, not new machinery.
- **G13 — "The two readers spell the strictly-before filter twice — in SQL text comparison and
  PostgREST timestamptz. Same rows?"** Checked in the repo: the device stores locally written
  stamps as `…Z` and server-pulled ones as `…+00:00`, whose *text* does not sort like their
  instants, while Postgres compares real timestamps — so reader-side selection alone could
  fork at the margins. Settled: readers over-fetch only; `trend.ts` re-sorts and re-filters
  every candidate with `timestampMs` + id tie-break (the one parser both runtimes already
  share), making the shared module the only place selection semantics live. Residual fork
  confined to the scan-cap boundary (Risk 1).
- **G14 — "Deploy and migration race."** The redeployed function upserts the six new columns,
  so deploy-before-migrate would 500 every analyze call; migrate-before-deploy is safe in both
  directions (the old function names no new column; the new columns are nullable). Recorded as
  a builder footgun with the safe order.
- **Scope verdict (planner):** right as written — see below for what the build changed.

## Build notes and deviations (builder)

1. **Reader filter is "no later than + not this id", not the strict pair.** Both readers fetch
   `started_at <= workout.started_at and id <> workout.id` (server: PostgREST `.lte().neq()`;
   phone: `julianday(started_at) <= julianday(?) and id <> ?`), ordered newest first, limit 40.
   The strict `(started_at, id) <` tie-break lives only in `trendHistory`. Same-instant
   later-id rows are over-fetched identically on both sides (they can use a cap slot, never
   change the window otherwise). Avoids a quoted PostgREST `or(…)` filter, and the phone compares
   instants (`julianday`), not text — the G13 concern handled at the fetch too.
2. **`AnalysisInput.history` is required; `buildSummary` takes `Omit<AnalysisInput, 'history'>`**
   so a reader can't forget it while summary-only callers stay simple. `AnalysisSet.rpe` is
   required (`number | null`).
3. **Trend lines carry their numbers.** `TrendLine` = `{ measure, label, value, average,
   sentence }`; the screen formats `value`/`average` (`formatWeight` — the app's
   `displayWeight` + unit helper — for kg, one decimal for RPE). The RPE sentence holds only the
   delta ("About 0.5 above your recent sessions") and both RPEs are rounded to the one decimal
   shown **before** the delta is worked out, so the printed pair and the sentence always agree
   (review finding). Load-per-rep uses "heavier / lighter".
4. **Named constant `TREND_AROUND_RPE = 0.2`** (RPE "right around" band) beside the plan's
   `TREND_AROUND_PERCENT = 2`. Both sentences round the size, then apply direction (so ±x.5
   rounds symmetrically).
5. **Rows from a NEWER engine than the app are kept** (`engine_version < ANALYSIS_ENGINE_VERSION`
   is the only "older rules" test), so an old app build never loops re-requesting a newer row.
6. **The edge function coerces `weight_kg` and `rpe` to numbers** on every set read
   (`asAnalysisSet`), so a numeric arriving as text could never make the server skip an RPE the
   phone counts. `toAnalysisRow` likewise coerces the six trend numerics.
7. **`MIN_SET_RPE` / `MAX_SET_RPE` are now exported from `@training-math`'s index** — the RPE
   validity range in `sessionMeasures` reuses the set CHECK's constants rather than retyping 1–10.
8. **Deploy:** migration applied first (`20261116023347`, renamed to the recorded version), then
   `analyze-workout` redeployed as v3 (ACTIVE, `verify_jwt` true) with comment-stripped copies of
   the repo files (code identical), the whole `_shared/analysis` + `_shared/training-math` graph.
9. **Review (code-review skill, both axes) findings and outcomes:** RPE pair/sentence rounding
   mismatch → fixed (3); `sessionMeasures` summed `setVolumeKg` itself → now `sessionVolumeKg`
   (one volume home); version-1 rows' batch-cap / pending-guard untested → test added; the six
   columns spelled field-by-field in `buildAnalysis` → spread. Not changed (judgement calls):
   the fake transport restating the reader's fetch (it must mirror the real read), the six column
   names listed in each storage layer (the existing per-layer pattern), `copy.ts` holding both
   copy families (the file is "every string the analysis shows"). The version-2 upgrade (G8) is argued above as the DoD's
  own requirement rather than an addition; everything else that touches these numbers (deload,
  charts, recovery) stays with its own step.
