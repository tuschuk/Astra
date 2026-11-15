# analysis-engine — B18: the deterministic post-workout analysis

**Branch:** `analysis-engine` (from `main`)
**Build step:** B18 — covers **ANA-1** (analysis generated on completion, attached to the workout),
**ANA-2** (session summary: total volume, sets, duration, new PRs), **ANA-4** (motivational,
encouraging tone in every state), **ANA-11** (scripted rules, no AI model), **NFR-9 part** (the
not-medical-advice statement on the analysis surface; the nutrition surface is B55's).
**Depends on:** B13 (`personal_records` + PR detection on finish), and through it B06–B12
(`@training-math` incl. `volume.ts`, the sync engine, the logger and saved-workout screens).

## Step definition of done (from the Build order)

Every finished workout gets exactly one analysis whose numbers match the logged data;
edge-function tests use fixtures.

## Scope check

The step scope is right as written and this plan stays inside it. Two readings settled up front:

- **"Run when a finished workout syncs"** is read as *the device that synced it asks the server
  to analyze it, right after the sync* — not a database webhook firing inside Postgres. The
  grilling (G1) weighs the webhook alternative; the client-driven design wins on testability,
  on the B07 transport seam, and on adding no new server machinery beyond the function itself.
- **"Exactly one analysis"** is a table invariant, not a process promise: the analysis row's
  primary key **is the workout id**, so no sequence of retries, crashes or multi-device races
  can produce two. Regeneration after a B14 edit *replaces* the one row (G5) — still exactly one.

One deliberate extension inside the spirit of the scope: a workout **edited after** its analysis
exists (B14 shipped edits) gets its analysis **recomputed**, because ANA-2's DoD says the
numbers match the logged data — a stale analysis would fail that DoD the moment an edit lands.

## Shape of the thing

Three layers, one brain:

1. **`backend/supabase/functions/_shared/analysis/`** — the deterministic rules module (pure
   TS, Deno-clean, same constraints as `training-math`, which it imports for volume). Input:
   the workout row, its sets, and the `personal_records` rows citing this workout's sets.
   Output: the complete analysis — numbers *and* the chosen encouraging copy. **Both the edge
   function and the phone run this exact code**, which is what makes the offline requirement
   ("the screen shows the locally computed summary and fills in the server analysis when
   synced") free of a mirrored copy: same inputs → byte-identical analysis, so the server row
   "filling in" is invisible unless the data actually differed.
2. **Edge function `analyze-workout`** (`backend/supabase/functions/analyze-workout/index.ts`)
   — a thin Deno wrapper: authenticate the caller, read the workout tree and PR rows *as the
   caller* (RLS scopes it to their own data), run the shared module, upsert the row into
   `workout_analyses` with the service role, return the row. No model inference anywhere
   (ANA-11): the function is arithmetic over rows plus a copy lookup table.
3. **`workout_analyses` table** (server, RLS: owner read, no client writes) plus a device
   mirror pulled — never pushed — by the existing sync machinery, and an **analysis screen**
   (`frontend/src/app/analysis/[id].tsx`) that opens after finish and from any saved workout,
   carrying the not-medical-advice statement.

### Why the edge function exists at all, when the phone can compute the same thing

ANA-11 and `docs/ARCHITECTURE.md` fix the decision: analysis is scripted rules **in server
functions**. The server row is the durable artifact later steps attach to (B21 links posts to
it; B42 extends the engine). The phone's local computation is the offline *view* of the same
rules, not a second engine — one module, two runtimes, which is exactly the arrangement
`training-math` was built for and the reason B06 left Deno verification to this step.

## The analysis, precisely (the shared module)

`backend/supabase/functions/_shared/analysis/` — files:

```
summary.ts   — buildSummary(workout, sets, prRows): the numbers
copy.ts      — pickCopy(summary): the tone state + headline/message strings; NOT_MEDICAL_ADVICE
analysis.ts  — buildAnalysis(...): summary + copy + ANALYSIS_ENGINE_VERSION, one call
index.ts     — public API re-exports (imported as `@analysis` from the app, by path from Deno)
*.test.ts    — Jest fixtures beside each file (mirror rule)
```

**The numbers** (`buildSummary`) — every one from existing single-home math:

- `total_volume_kg` — `sessionVolumeKg` from `@training-math` over the workout's sets (B10's
  one volume home: warm-ups and weightless sets contribute 0, exactly as the PR screen counts).
  Rounded to 3 decimals via `roundToIncrement(v, 0.001)` so the server `numeric` round-trip
  can never disagree with a locally computed value (the B13 precedent).
- `total_sets` — every logged set; `working_sets` — the non-warm-up ones (so the screen can say
  "18 sets · 3 warm-up" without re-deriving the warm-up rule).
- `duration_seconds` — `ended_at − started_at`, whole seconds, floored at 0 (the schema CHECK
  already forbids negative, this is belt-and-braces against clock weirdness in old rows).
- `new_prs` — the `personal_records` rows whose `source_set_id` belongs to this workout's sets:
  `{ kind, reps, value_kg, exercise_id, exercise_name }` each. **This is the settled "new PRs"
  rule** (G3): current-best rows citing this workout's sets. Right after finish — ANA-2's
  moment — these are exactly the PRs flagged that session, matching the saved-workout badges
  B13 ships (same rows, same reading). A single diff rule everywhere; no PR event log is built.

**The copy** (`pickCopy`) — a deterministic state machine over the summary, no randomness (same
workout → same words, forever — determinism is what makes the offline/local and server copies
identical). States, by precedence, each with a fixed headline + message, all first-person-free,
all encouraging (ANA-4):

1. **PR day** (`new_prs.length > 0`) — celebrates, names the count.
2. **Weighted work done** (`total_volume_kg > 0`) — solid-session copy.
3. **Work logged, no external load** (sets logged; volume 0 — bodyweight, timed, warm-up-only)
   — "work is work" copy that treats bodyweight and conditioning sessions as complete sessions,
   not failed weighted ones.
4. **Empty finish** (no sets) — gentle "showing up counts" copy, no instruction to do better.

Copy rules the builder must hold to (and the review's Copy pass checks): **no shaming, no
negative framing of any state** (ANA-4's DoD is a copy review); **no numeric performance claim**
("you got 5% stronger") anywhere — the CLAUDE.md citation rule makes uncited claims a bug, so
the copy states facts from the summary and encouragement without effect sizes; **no embedded
weights or units in copy strings** — numbers render on screen through `displayWeight` in the
user's unit, so a kg string can never be shown to a lb user.

`NOT_MEDICAL_ADVICE` — the statement's one home, exported from `copy.ts` so B55's nutrition
surface later imports the same string (NFR-9's "every surface" stays one constant).

`ANALYSIS_ENGINE_VERSION = 1` — stored on every row. It makes "deterministic" checkable
(analysis = f(workout data, version)) and gives B42 a lever to extend rows without guessing
which rules produced old ones.

**Frontend wiring for `@analysis`** mirrors `@training-math` exactly: tsconfig path, metro
`resolveRequest` alias + the `_shared/analysis` watch folder, jest `moduleNameMapper` + a
testMatch pattern reaching `_shared/analysis` (the existing patterns only reach
`_shared/training-math`).

## Data model

### Server migration — `backend/supabase/migrations/<version>_workout_analyses.sql`

Applied live with `mcp__supabase__apply_migration`, file renamed to the recorded version via
`list_migrations` (pipeline convention).

```sql
create table public.workout_analyses (
  -- The workout's own id: one analysis per workout, by key. Cascade: a deleted
  -- workout takes its analysis with it (there is nothing to reopen it from).
  id                 uuid primary key references public.workouts (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  engine_version     integer not null,
  total_volume_kg    numeric(10, 3) not null check (total_volume_kg >= 0),
  total_sets         integer not null check (total_sets >= 0),
  working_sets       integer not null check (working_sets >= 0 and working_sets <= total_sets),
  duration_seconds   integer not null check (duration_seconds >= 0),
  new_prs            jsonb not null default '[]'::jsonb,
  headline           text not null,
  message            text not null,
  -- The workout's updated_at the numbers were computed from — the staleness test
  -- after a B14 edit (see "When analyses are requested").
  workout_updated_at timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index workout_analyses_user_updated_idx
  on public.workout_analyses (user_id, updated_at, id);  -- the pull bookmark's index
```

Plus the standard `moddatetime` trigger on `updated_at`, and RLS: enabled, **owner `select`
only** (`user_id = (select auth.uid())`) — *no* insert/update/delete policies, so PostgREST
clients cannot write analyses at all; only the edge function's service-role client can. That is
what makes "the analysis pipeline is server-function code" (ANA-11) enforced, not aspirational:
a buggy or hostile client cannot plant a row the engine didn't compute. (`total_volume_kg` gets
`numeric(10,3)`: a 99,999 kg session fits; sets' own `numeric(8,3)` caps a single weight.)

No tombstone wiring: analyses die only with their workout, whose tombstone already removes the
local tree — the device mirror row is deleted in the same existing path (one line in
`applyTombstone`'s workout branch alongside sets and records).

### Device mirror — schema V7 (`frontend/src/db/schema.ts`)

```sql
create table workout_analyses (
  id                 text primary key not null,
  user_id            text not null,
  engine_version     integer not null,
  total_volume_kg    real not null,
  total_sets         integer not null,
  working_sets       integer not null,
  duration_seconds   integer not null,
  new_prs            text not null,     -- JSON, parsed at the read edge
  headline           text not null,
  message            text not null,
  workout_updated_at text not null,
  created_at         text not null,
  updated_at         text not null
);
create index workout_analyses_user_idx on workout_analyses (user_id);
```

No device CHECKs or FKs beyond the mirror's precedent. `MIGRATIONS` gains V7.

**Pull-only, never pushed:** `workout_analyses` joins `RowByTable`/`TABLE_COLUMNS` so the
generic `upsertRowsTx`/`applyRows` machinery applies, but **not** `SYNC_ORDER` — it has no push
pass, no outbox lines ever (nothing on the phone writes it except pull-apply and the saved
function response, both server-sourced). The `jsonb` column travels as a JSON string into the
mirror's text column (the transport stringifies the object PostgREST returns — the one column
where device and server types differ; called out so the builder normalizes it in the transport,
not in every reader).

## The edge function — `analyze-workout`

`backend/supabase/functions/analyze-workout/index.ts` (+ `deno.json` if the deploy needs one):

- **Input:** `POST { workoutId: string }`, called through `supabase.functions.invoke` so the
  user's JWT rides along. JWT verification on (the default).
- **Reads as the caller:** a supabase-js client built from the request's `Authorization` header
  (`SUPABASE_URL` / `SUPABASE_ANON_KEY` env vars the runtime injects). RLS means it can only
  ever read the caller's own workout, sets and PR rows — the function needs no ownership checks
  of its own, and can never be tricked into analyzing (or leaking) someone else's workout.
- **Refuses** (4xx, with a reason string): workout not found / not visible (404), or
  `ended_at is null` (422 — only finished workouts are analyzed; ANA-1 is about completion).
- **Computes** by handing the rows to `buildAnalysis` from `../_shared/analysis/index.ts` —
  the function body contains no rules, which is what keeps the fixture tests honest.
- **Writes with the service role** (`SUPABASE_SERVICE_ROLE_KEY` env var): a single
  `upsert ... on conflict (id) do update` keyed on the workout id. Upsert, not insert-ignore,
  so a regeneration after an edit replaces the row (G5). The service-role client is created
  with no session persistence and used for this one statement.
- **Returns** the stored row (200) so the caller can save it locally without waiting for a pull.
- **Error shape:** non-2xx + `{ error: string }`; the client treats any failure as "try again
  on a later sync" — the self-healing request rule below makes a dropped invocation harmless.

`supabase/config.toml` gains `[functions.analyze-workout]` with `verify_jwt = true` (explicit,
even though it is the default, so the security posture is in the repo). The config governs
local serving only: the **deployed** function's JWT setting is fixed at deploy time, so the
builder confirms the `deploy_edge_function` call (or its result) leaves verification on, and
the Gate 2 probe includes an unauthenticated invoke being refused.

### When analyses are requested (the client side)

`frontend/src/analysis/` — new module:

- **`localAnalysis(db, userId, workoutId)`** — reads the workout, its sets and the PR rows
  citing its sets from device SQLite and runs the same `buildAnalysis`. This is the offline
  screen content. Returns null for an unfinished workout.
- **`storedAnalysis(db, userId, workoutId)`** — the mirror row, parsed (`new_prs` JSON →
  typed array), or null.
- **`analysisRequestPass(db, transport, userId)`** — the sync engine's new last phase, after
  push and pull: find finished workouts of this user that either have **no** analysis row or a
  **stale** one (`workout_updated_at < workouts.updated_at` — both server stamps once synced,
  so the compare is honest), **and** have no pending outbox lines anywhere in their tree or
  their PR rows (an unsent change means the server would compute from data this phone has
  already superseded — wait for the next run, when the push has landed). For each (newest
  first, capped at `ANALYSIS_BATCH_LIMIT = 10` per run so a reinstalled device backfills over a
  few syncs instead of hammering), call the transport's `requestAnalysis(workoutId)` and save
  the returned row via the pull-apply path. Failures are logged and dropped — the next sync
  retries, same policy as everything else in the engine.
- **Transport:** `SyncTransport` gains `requestAnalysis(workoutId): Promise<WorkoutAnalysisRow>`
  (the real one wraps `functions.invoke('analyze-workout')`; the fake computes through the same
  shared `buildAnalysis` over its in-memory rows — the fake *is* a reference server, which is
  what lets Jest prove end-to-end numbers-match without the network) and
  `pullWorkoutAnalyses(userId, after, limit)` for the cursor pass.
- **Pull:** a fourth standalone cursor (`pull_cursor:workout_analyses`), pulled after personal
  records (it cites nothing locally, but its content *refers* to PR rows — ordering it after
  keeps a pulled analysis from naming records the device hasn't seen yet). `PullResult` gains
  the count. This is what makes ANA-1's "forever" true on a reinstalled or second device: the
  rows come down with everything else.

Why the request lives in the **engine** and not in `finish()`: finish must stay offline-pure
(NFR-1) and already commits the workout + PR rows; the sync that uploads them is the first
moment the server can see the data, and the engine already owns "runs after every successful
sync". The finish screen still gets its analysis instantly — locally computed (identical by
construction), with the server row arriving on the sync that the finish write itself triggers.

### The staleness/regeneration rule (B14 interplay)

An edit or delete through B14 re-stamps or tombstones the workout. Delete: cascade removes the
analysis everywhere (server FK; device via the tombstone path). Edit: the next
`analysisRequestPass` sees `workout_updated_at < workouts.updated_at` and re-requests; the
function recomputes from the post-edit tree and upserts; other devices get the new row via the
pull cursor (fresh `updated_at`). One wrinkle accepted and documented: between the edit and the
re-request, the stored row briefly disagrees with the edited data — the screen's
pending-lines-first freshness rule (see the screen section) renders the local computation in
exactly that window, so no user ever *sees* stale numbers (G5).

## The analysis screen — `frontend/src/app/analysis/[id].tsx`

Declared in the root stack's signed-in guard like `workout/[id]`. `id` is the workout id.

- **Content:** headline + message (the copy); the numbers — volume via `displayWeight` in the
  user's unit, set counts, duration formatted h:mm; the new-PR list (kind-labelled, same
  format helpers as B13's badges and panel); a link to the saved workout ("View workout"); and
  the **not-medical-advice statement** (`NOT_MEDICAL_ADVICE` from `@analysis`) as a muted
  footer, present in every state (NFR-9).
- **Data path:** on mount and on focus, read `storedAnalysis`; show it when it is present and
  fresh, else show `localAnalysis`. The screen never triggers a sync and never talks to the
  engine (G11 — `useSync` returns void; screens have no engine handle, and don't need one:
  opening the app foregrounded it, which already requested a sync, and the local analysis is
  identical to the server row by construction, so there is nothing to wait for). "Fresh" is a
  fact check before a clock check: a workout whose tree or PR rows have **pending outbox
  lines** always renders locally (the stored row predates the unsent edit — no timestamp
  compare, device stamps never race server stamps); with nothing pending, the stored row wins
  unless the workout's `updated_at` is newer than its `workout_updated_at` — both server
  stamps by then, so the compare is honest (G5). A workout with `ended_at` null renders
  nothing but a redirect back (the route is only linked from finished workouts; the guard is
  for a stale deep link). Offline forever = local analysis forever, fully functional (the
  step's offline DoD).
- **Openings:** `finish()` in `active-workout.tsx` now replaces to `/analysis/[id]` (the
  analysis screen's "View workout" pushes the saved view, and back from the analysis lands on
  the Workout tab — same replace discipline as today); the saved-workout screen
  (`workout/[id].tsx`) gains an "Analysis" action for every **finished** workout — that is
  "opens after finish and from any past workout" (ANA-1), including workouts finished before
  B18 shipped (their first open computes locally and requests the server row — the backfill
  needs no job, same shape as B13's PR seeding).

## Deno verification + the `_shared` lint target (deferred here from B06/B07)

- **Deno:** the builder runs `deno check` over `analyze-workout/index.ts` (which pulls in both
  shared modules) — installing Deno locally if absent (free, no paid anything; recorded in the
  handoff for Tristen's machine either way). If installation fights the sandbox, the fallback
  verification is the real `deploy_edge_function` (the MCP deploy bundles and type-checks), and
  the plan records which one ran. This closes B06's "Deno-clean by construction but never
  loaded under Deno".
- **Lint:** `frontend/eslint.config.js` (or a thin root-level config, whichever `expo lint`
  tolerates — builder's call, recorded) gains the `_shared/` directories so `npm run lint`
  reaches them, replacing the hand-run eslint invocation recorded in DEFERRED.md. The
  `import/no-unresolved` exemption stays scoped to the shared dirs (the resolver still can't
  see `frontend/node_modules` from there). The edge-function file itself may need
  `deno`-global ignores (`Deno.serve`) — an eslint ignore scoped to `functions/*/index.ts` is
  acceptable; deno's own `deno check` covers those files.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_workout_analyses.sql` | new — table, index, moddatetime, owner-select-only RLS (applied live, renamed to recorded version) |
| `backend/supabase/functions/_shared/analysis/{summary,copy,analysis,index}.ts` (+ tests) | new — the rules module (G2: copy lives here too) |
| `backend/supabase/functions/analyze-workout/index.ts` | new — the thin Deno handler |
| `backend/supabase/functions/tests/analyze_workout.test.ts` | new — fixture tests over `buildAnalysis` + the refusal rules (CLAUDE.md's server-function test home; jest testMatch gains the path) |
| `backend/supabase/config.toml` | edit — `[functions.analyze-workout] verify_jwt = true` |
| `frontend/tsconfig.json`, `metro.config.js`, `jest.config.js` | edit — `@analysis` alias + roots/testMatch for `_shared/analysis` and `functions/tests` |
| `frontend/eslint.config.js` | edit — lint reaches `_shared/` (deferred item) |
| `frontend/src/db/schema.ts` (+ test) | edit — V7 mirror table |
| `frontend/src/db/dao.ts` (+ test) | edit — `WorkoutAnalysisRow`, `RowByTable`, `TABLE_COLUMNS` (NOT `SYNC_ORDER`) |
| `frontend/src/sync/transport.ts`, `supabaseTransport.ts`, `test-utils/fakeTransport.ts` | edit — `requestAnalysis`, `pullWorkoutAnalyses`; fake computes via shared module |
| `frontend/src/sync/pull.ts` (+ test) | edit — fourth cursor + pass; tombstone branch also deletes the local analysis row; `PullResult` count |
| `frontend/src/sync/engine.ts` (+ test) | edit — `analysisRequestPass` as the run's last phase |
| `frontend/src/analysis/analysis.ts` (+ test) | new — `localAnalysis`, `storedAnalysis`, `analysisRequestPass`, staleness rule, `ANALYSIS_BATCH_LIMIT` |
| `frontend/src/app/analysis/[id].tsx` | new — the screen |
| `frontend/src/__tests__/analysis.test.tsx` | new — route/flow tests (route tests never live in `src/app/`) |
| `frontend/src/app/active-workout.tsx` | edit — finish lands on `/analysis/[id]` |
| `frontend/src/app/workout/[id].tsx` | edit — "Analysis" action on finished workouts |
| `frontend/src/app/_layout.tsx` | edit — declare the route in the signed-in guard |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) — new table/RLS; finish→analysis path, request pass, screen |
| `docs/DEFERRED.md` | edit — close the B06 Deno-verification and `_shared`-lint items |

Builder footguns (precedent): regenerate typed routes with `npx expo start --offline` (~150 s)
**before** `tsc --noEmit` → lint → Jest — this step adds a route. Apply the migration via MCP,
then rename the file to the recorded version. Keep the edge function free of rules: if a line
in `index.ts` computes a number or picks a string, it belongs in `_shared/analysis`.

## How each definition of done becomes observably true

- **Step DoD "every finished workout gets exactly one analysis"** — PK-by-workout-id makes
  "exactly one" structural; "every" is the request pass + screen-open self-heal, proven in
  Jest: finish offline → local analysis renders; transport heals → one sync → the fake server
  holds exactly one row; repeated syncs and a re-request change nothing (idempotent upsert);
  a second finished workout with a dead transport gets its row on the next successful run.
- **Step DoD "numbers match the logged data"** — fixture tests compute expected
  volume/sets/duration by hand per fixture and assert both `buildAnalysis` output and the
  screen's rendered numbers; an end-to-end Jest run asserts the fake-server row equals the
  locally computed analysis field for field (same module, but the test pins it stays true).
- **Step DoD "edge-function tests use fixtures"** — `backend/supabase/functions/tests/`
  fixtures: multi-exercise weighted session; PR session (rows citing its sets); warm-up-only;
  bodyweight-only; timed/score-only; empty finish; unfinished workout refused; each pinning
  the full analysis object including copy state.
- **ANA-1** — finish lands on the analysis screen (flow test); "Analysis" opens from a saved
  workout, including one finished pre-B18 (test seeds a finished workout with no row → screen
  renders locally and a sync creates the row); reinstall-shaped test: a fresh device pulls the
  row by cursor. "Forever" = the row survives everything but its workout's deletion.
- **ANA-2** — the numbers tests above, plus: the new-PR list on the analysis equals the PR
  badges' rows on the saved workout for the same session (one rule, asserted equal).
- **ANA-4** — every copy state's strings live in one file (`copy.ts`); the Review step's copy
  pass reads them all against "no shaming, no negative framing"; a unit test asserts every
  reachable state yields a non-empty headline+message and that a banned-word list
  (`only`, `just`, `fail`, `at least`, `better than last time`…) stays out of them — a coarse
  tripwire, not the review itself. Final judgment is the copy review in the Review step,
  recorded in this file.
- **ANA-11** — the pipeline is `_shared/analysis` + the thin handler: no model call, no
  network beyond Supabase reads/writes, no randomness, no clock (duration comes from the rows).
  The RLS write lockdown enforces that no other writer exists. Reviewer greps the function
  tree for fetch/model/temperature-shaped anything.
- **NFR-9 (part)** — the statement renders on the analysis screen in every state (route test
  asserts its presence with and without data); one exported constant for B55 to reuse.

## Testing (beyond the inline notes)

All Jest, node SQLite driver, fake transport — never the live project. Key cases not already
named: staleness — edit a synced workout (B14 path), next pass re-requests, row replaced,
`engine_version` and numbers updated, still one row; pending-outbox guard — a tree with unsent
lines is skipped by the pass until pushed; batch cap — 25 finished workouts backfill 10 per
run; unit display — a kg analysis renders in lb via `displayWeight` (numbers only in the
screen, never in copy); tombstone — deleting the workout removes the local analysis row;
`new_prs` JSON round-trips through the text column. The live function gets a Gate 2 probe:
deploy via `deploy_edge_function`, invoke as a real signed-in test user against a seeded
workout, assert the row, invoke again (unchanged), assert cross-user invocation returns 404
and that PostgREST writes to `workout_analyses` are refused.

## Out of scope (and where it lands)

- **Muscle map on the analysis screen** — B19 (next step, extends this screen).
- **Finish→post flow, linking posts to analyses** — B21.
- **Trend comparisons, RPE-aware intensity analysis** — B42 (extends the engine; its section
  is absent below a history threshold — nothing here pre-builds that).
- **Recovery-aware figures and any numeric performance-impact claims** — B56, blocked on the
  cited evidence base; this step's copy contains no such figures at all.
- **Nutrition's NFR-9 surface** — B55 (imports the same constant).
- **Database webhooks / pg_net auto-invocation** — not built (G1); the upgrade path if
  client-driven requests ever prove insufficient.
- **Copy variety (multiple strings per state), localization** — deferred until asked; variety
  must stay deterministic (e.g. keyed on workout id), noted for whoever adds it.
- **Realtime "analysis ready" push to the screen** — the focus re-read covers it; machinery
  waits for evidence.

## Risks a reviewer should weigh

1. **The staleness rule is the correctness linchpin** (G5). "Numbers match the logged data"
   after B14 edits hangs on `workout_updated_at` vs the workout's `updated_at` in two places
   (the request pass, and the screen's local-vs-stored preference). Both compare server stamps
   against server stamps only after a sync has landed; the pending-outbox guard is what keeps
   a half-pushed edit from producing a confidently wrong server row. A reviewer should trace
   the edit→push→re-request→pull cycle end to end in the tests.
2. **The service-role write is the one place this codebase bypasses RLS.** It is scoped to a
   single upsert of a row the function just computed for the authenticated caller, with reads
   done under the caller's own JWT. A reviewer should confirm the service client is created
   per-request, used for exactly one statement, and that `user_id` comes from the workout row
   read under RLS — never from the request body.
3. **First real Deno consumer of `_shared`.** `@training-math` was built Deno-clean but never
   loaded under Deno; this step stakes an edge function on it plus a new module under the same
   constraints, with Metro/tsconfig/jest wiring extended to a second alias. If `deno check` or
   the deploy bundler rejects something (an import quirk, a tsconfig assumption), the fix must
   land in the module without breaking the three frontend resolvers — the cross-runtime
   contract is the riskiest moving part, and it is exactly the verification B06 deferred here.

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session (headless: the question tree worked
at full severity, every checkable claim verified in the repo; Gate 1 is where Tristen
overrules). Questions that changed or sharpened the plan:

- **G1 — "'Run when a finished workout syncs' — isn't that a database webhook, not a client
  request?"** The webhook reading (pg_net + a trigger on `workouts`) was worked through and
  rejected: it fires on the *first* workouts push pass, before sets and PR rows arrive (push
  order is workouts → children → records → workouts-re-touch), so it computes wrong numbers
  and relies on the re-touch pass re-firing it to self-correct; it cannot run under the Jest
  fake at all (an HTTP hop out of Postgres); and it adds extension + secret-management
  machinery for zero user-visible gain over "the sync that uploaded it asks next". The
  client-driven pass satisfies the scope's words — the request happens *when the finished
  workout syncs* — and the screen-open self-heal covers every missed case. Recorded as the
  upgrade path, not built.
- **G2 — "Does the copy belong in the shared module, or is only math shared?"** First draft
  kept copy client-side (unit-safety argument) with the server storing numbers only. Rejected:
  the scope says the edge function produces the summary *with encouraging copy*, and a
  copy-less server row would make the stored analysis incomplete as an artifact (B21 posts
  link to it). Settled: copy lives in `_shared/analysis`, strings carry no numbers or units
  (the unit-safety point survives as a copy rule), the function stores rendered strings, and
  the screen renders numbers itself through `displayWeight`.
- **G3 — "What exactly is a 'new PR' on the server, with no before/after to diff?"** The
  server is a passive store of client-computed records (B13), so a true temporal diff doesn't
  exist server-side. Settled: rows citing this workout's sets — identical to B13's badge
  semantics, exact at the moment ANA-2 cares about (right after finish), honest later ("PRs
  this workout still holds"), and recomputable deterministically forever. An event log to get
  the temporal answer was rejected again (B13 already declined it; still no reader).
- **G3a — "Why snapshot `exercise_name` into `new_prs` instead of joining on render?"** The
  analysis is a frozen artifact meant to reopen forever; B31 makes custom exercises deletable,
  after which an `exercise_id` in old JSON dangles (the same reason DEFERRED.md wants a name
  snapshot on `workout_exercises`). A name string per PR entry keeps every old analysis
  renderable with no join and no "Deleted exercise" holes. The screen still renders *weights*
  live through `displayWeight` — only the name is frozen.
- **G4 — "PK = workout id, or its own id + unique constraint?"** PK-is-workout-id. "Exactly
  one analysis" becomes a key fact instead of a process promise; upsert-by-id is the idempotent
  write the sync machinery already assumes; the pull machinery's generic `id` handling works
  unchanged. A separate id column would exist only to be unique-constrained back into this
  exact shape.
- **G5 — "What happens when B14 edits a workout that already has an analysis?"** The sharpest
  catch of this grilling: without regeneration, ANA-2's DoD ("numbers match the logged data
  exactly") silently dies the first time someone edits a synced workout. Settled: the
  `workout_updated_at` staleness rule, upsert regeneration, and the screen preferring local
  computation when its inputs are newer than the stored row. Weighed against "scope creep":
  the alternative — an analysis that contradicts the workout it is attached to — fails a
  covered feature's DoD, so this is the scope, not creep.
- **G6 — "Why can't the client just write the analysis row itself? It computes the same
  thing."** Because ANA-11 says the pipeline is server-function code, and an RLS-writable
  analyses table would make the server row merely advisory (any client could write anything).
  The lockdown (owner-select-only, service-role writes) is what turns ANA-11 from a code-style
  claim into a database fact. The phone's computation is a *view*, never a *write*.
- **G7 — "Is the engine_version column speculative?"** Challenged and kept: it is read today —
  fixture tests pin version-1 outputs, and the staleness/regeneration story needs "which rules
  made this row" to be a fact rather than a guess. One integer column with a current reader is
  not the Redis rule.
- **G8 — "Does the request pass belong in the sync engine, or in finish()?"** Engine. finish()
  must work with no signal (NFR-1) and already has two jobs committed atomically; a
  request-at-finish would be a third that *requires* the network and dies with the app. The
  engine's pass is retried by every later sync for free and catches the backfill (pre-B18
  workouts, reinstalls) that finish-time invocation never could.
- **G9 — "Working_sets: scope says 'sets' — is splitting warm-ups out scope creep?"** Kept,
  minimal: ANA-4's no-shaming review interacts with honest numbers (a 10-set session that was
  7 warm-ups reads dishonestly as 10 working sets), the warm-up rule already exists in the
  volume home, and it is one integer column; the screen may show it as secondary text. The
  alternative (deriving it client-side from sets) re-implements a server-stored number locally
  — the mirrored-copy smell this repo keeps killing.
- **G11 — "How does the screen trigger the analysis request, with no engine handle?"** It
  doesn't — checked in the repo: `useSync` returns void and no screen anywhere reaches the
  engine. First draft had the screen fire a one-shot sync; cut. Creation is entirely the
  engine's pass, driven by the triggers that already exist (the finish write itself debounces a
  sync; opening the app foregrounds it). The screen is a pure read of stored-else-local, and
  since the two are identical by construction, nothing user-visible is lost. Exposing the
  engine to screens would be new machinery with no observable gain — the "nothing speculative"
  rule applied to plumbing.
- **G12 — "Device clock skew can poison any local-vs-server timestamp compare."** The catch
  behind the screen rule's final shape: an offline edit's device stamp compared against a
  server `workout_updated_at` lies in either direction when the phone's clock is wrong.
  Settled: facts before clocks — pending outbox lines (a pure local fact) decide first, and
  the timestamp compare only ever runs between two *server* stamps (post-sync), where it is
  honest. The request pass already had this shape; the screen rule now matches it.
- **G10 — "The banned-word test is copy review theater."** Partly conceded: the test is a
  tripwire against regressions, not the review. The DoD's copy review happens in the Review
  step by reading `copy.ts` in full, and its verdict is recorded in this plan file — the test
  exists so a later copy edit can't silently reintroduce what the review removed.
- **Scope verdict:** right as written, with the G5 regeneration extension argued above as
  required by ANA-2's own DoD rather than added to it. Everything else that touches analyses
  (muscle map, posts, trends, recovery) stays with its own step.
