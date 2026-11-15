# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B19 merged; pipeline on B20)

**Fifteen pipeline steps are merged to `main` and Phase 1's logging, analysis and Tool Kit are all
built.** The pipeline is running **B20 posts-and-feed**, the first social step. Gates are delegated
to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B19 muscle-map (merged, Gate 2 record):** `_shared/analysis/muscles.ts` (`combineMuscleLoads`,
per-muscle max, generic keys — the one home of the aggregation rule), `frontend/src/analysis/
muscles.ts` (performed slots → catalog slugs → intensities; custom exercises contribute nothing;
visibility-guarded like its neighbours), `components/MuscleMap.tsx` + `muscleMapPaths.ts` (two
hand-authored SVG figures, twelve regions, opacity `0.25 + 0.75 × intensity`, `MUSCLE_NAMES`,
canonical order, accessibility label), "Muscles trained" card on the analysis screen inside the
existing keyed focus-read. No migration, no sync change, no new dependency. Gate 2 reran in
order: regenerate typed routes → `tsc` clean → lint clean → Jest 77 suites / 842 tests on a
cold cache. Statuses: B19 Built; ANA-3 Built (figure legibility = device check). Product reading
recorded for Tristen: shading is per-muscle **max**, not volume-weighted — one-function swap if
wanted.

**Earlier:** B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer
(TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14
edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes
(LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12; LOG-13 In progress until the feed), B10
set-types (LOG-14, LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3),
B07 local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan
file.

**B20 posts-and-feed** (planning now): `posts` and `flairs` tables (launch flairs as rows: WOD,
Physique Check, New PR, Form Check), one flair per post, RLS that honors blocks; workout post
type; Home feed of followed users newest first with pagination; follow / unfollow from a user
card. DoD: a followed user's workout post appears on Home in reverse-chronological order and a
stranger's does not. Standing inputs for its planner: `follows`, `blocks`, `workout_visibility`
enum and `private.workout_visible(owner, vis)` exist since B02 (`20261114100000_identity.sql`,
`20261114100100_training.sql`); feed reads are server-side (other users' data is never mirrored
— the device mirror holds the user's own rows only), so the feed is an online read with no
outbox; the feed must print sets through `format.ts` helpers (`formatSet` / `formatDropSet` /
`supersetRuns` / `groupDropSets`) so LOG-13's "and the feed" closes and the one-spelling rule
holds; Physique Check posts take upvotes only (CLAUDE.md privacy rule — B22 builds votes, but
the flair row / post type must not preclude it); the muscle map and analysis are reusable
components if a workout post shows them (B21 owns finish-to-post); migrations applied live via
MCP and renamed to the recorded version.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Update to the latest main: `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, `npm
ci` in `Astra-main\frontend`, then `npx expo start --lan`. Currently serving `3c901ad` (through
B13).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest (Gate 2 also frees port 8099 if a
builder's Expo process lingers). Session helper: `automation/state/pipe.mjs` (gitignored;
`latest`, `approve <id>`, `retry <id>`, `trigger`). Executions 4/5 (B05) through 19 (B19); B20
is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0,
B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5,
B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5 (≈ $204 for fifteen steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
the analysis screen with the muscle map (bench-only → chest, shoulders, triceps only) → View
workout → PR badges; History; Edit and Delete a saved workout; Settings → kg toggle; Tool Kit
calculators and timer; reconnect → workouts, `personal_records` and one `workout_analyses` row
per finished workout in Supabase; sign out. Flips B05–B19 and their features to Done as each
holds. (2) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email" off
(plan of record; the session's toggle was declined by the permission layer). (3) The six external
blockers. (4) Whether to grant `mmdc` (and Deno) to headless runs. (5) Product readings to
confirm or overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM" label on the
entry card and history (B13); muscle shading by max, not volume (B19).

Next pipeline step after B20 merges: **B21 finish-to-post**.
