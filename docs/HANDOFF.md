# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B18 merged; pipeline on B19)

**Fourteen pipeline steps are merged to `main`.** The P0 logging path is complete on screen,
Settings has a synced kg/lb toggle, the Tool Kit has four calculators plus the timer, and every
finished workout now gets a deterministic analysis from the first deployed edge function. The
pipeline is running **B19 muscle-map**. Gates are delegated to the session (CLAUDE.md,
"Autonomous sessions"). Tristen's hands-on list is at the end.

**B18 analysis-engine (merged, Gate 2 record):** `backend/supabase/functions/_shared/analysis/`
(`summary.ts` numbers via `@training-math`, `copy.ts` four deterministic encouraging states +
`NOT_MEDICAL_ADVICE`, `analysis.ts` + `ANALYSIS_ENGINE_VERSION = 1`), run by both the
`analyze-workout` edge function (`handler.ts` pure request logic + `index.ts` Deno wrapper:
reads as the caller, **404 unless the caller owns the workout** — review-found security fix,
service-role upsert of the one row) and the phone (identical local computation for offline).
Migration `20261115080420_workout_analyses.sql`: PK = workout id (one row structurally), owner
`select` only, no client writes, moddatetime; confirmed live. Function deployed (version 2,
ACTIVE, `verify_jwt: true`); Gate 2 confirmed no-token and anon-key-only calls are refused
(401). Device schema V7 pull-only mirror (`MirroredTable`, never uploaded by type); fourth pull
cursor; `analysisRequestPass` runs after a successful pull, ≤ 10 per sync, skips trees with
pending outbox lines; staleness by `workout_updated_at` regenerates after a B14 edit.
`app/analysis/[id].tsx` opens after Finish and from the saved workout's Analysis button, local
analysis when fresher, statement in every state. `npm run lint` now also lints
`backend/supabase/functions` (`lint:functions`); Deno verification = the real deploy bundle
(B06's deferral closed; local `deno check` still wants Deno installed on this machine). Eleven
deviations recorded. Gate 2 reran in order: regenerate typed routes → `tsc` clean → lint clean →
Jest 74 suites / 817 tests on a cold cache. Statuses: B18 Built; ANA-1, ANA-2, ANA-4, ANA-11
Built; NFR-9 In progress (nutrition surface at B55). Still to run with a real signed-in user:
invoke on a seeded workout → 200 + one row; on another user's public workout → 404 (device check).

**Earlier:** B17 tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units
(LOG-6), B14 edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12
workout-notes (LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12; LOG-13 In progress until
the feed), B10 set-types (LOG-14, LOG-15), B09 logger-screen (LOG-2, NFR-2), B08
active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06 training-math, B05
auth-and-signup. Details in each plan file.

**B19 muscle-map** (planning now): SVG body diagram on the analysis screen shaded from the
session's exercises using the catalog's muscle intensities; DoD: a bench-only session highlights
chest, shoulders and triceps and nothing else. Standing inputs for its planner:
`react-native-svg 15.16.0` is already a dependency (no new package); the catalog
(`frontend/src/library/`) carries per-exercise muscle intensities; the shading rule (how a
session's sets aggregate into per-muscle intensity) is *training math* and belongs in
`@training-math` or `_shared/analysis` — one home, importable by the server if the analysis row
ever stores it — never computed in the component; the analysis screen already renders local or
stored analysis, so the map's input is the workout's sets + the catalog, not the analysis row
(unless the planner decides to persist a muscle summary, which would be a column by migration).

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Update to the latest main: `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, `npm
ci` in `Astra-main\frontend` (B17 added `expo-notifications`), then `npx expo start --lan`.
Currently serving `3c901ad` (through B13).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 18 (B18); B19 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4 (≈ $196 for fourteen steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
the analysis screen (headline, volume in your unit, sets, duration, New PRs, statement) → View
workout → PR badges; History; Edit and Delete a saved workout (PR promotion; the analysis
regenerates after an edit); Settings → kg toggle; Tool Kit calculators and timer (backgrounded,
notification at zero); reconnect → workouts, `personal_records` and exactly one
`workout_analyses` row per finished workout in Supabase; sign out. Flips B05–B18 and their
features to Done as each holds. (2) Supabase Dashboard → Authentication → Providers → Email →
turn "Confirm email" off (plan of record; the session's toggle was declined by the permission
layer). (3) The six external blockers. (4) Whether to grant `mmdc` (and Deno) to headless runs.
(5) Two product readings to confirm or overrule: no bodyweight rep-record PR book (B10/B13); the
bare "e1RM" label on the entry card and history (B13) now that the full citation lives on the
1RM calculator (B16).

Next pipeline step after B19 merges: **B20 posts-and-feed** (the first social step).
