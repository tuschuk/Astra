# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05–B09 merged; pipeline on B10)

**Five pipeline steps are merged to `main` and the whole P0 logging path is on screen**: sign up /
sign in, Workout tab → full-screen logger (library search, reps and weight, one-tap Repeat,
remove / reorder, "last time") → finish → read-only saved workout, over the kill-safe device store
and the outbox sync engine. The pipeline is running **B10 set-types**. Gates are delegated to the
session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end — the device run
is now the single most valuable thing only he can do.

**B09 logger-screen (merged, Gate 2 record):** `app/(tabs)/workout.tsx` (start / resume /
discard, newest 100 finished workouts), `app/active-workout.tsx` (the logger),
`app/workout/[id].tsx` (read-only saved workout), `components/workout/{EntryCard, ExercisePicker,
WorkoutListItem}`, `workout/{activeWorkoutSession, useActiveWorkout, history, format}.ts`,
`settings/displayUnit.ts` (pinned to `'lb'` until B15 rewires it), `db/useAppDatabase.ts`. Every
write goes through B08's store; every read is user-filtered. No schema change. Nine build
deviations recorded in the plan file; the review fixed a stale tab error, a previous-workout flash
on the saved screen and a double-tap reorder. Gate 2 reran, in the right order: regenerate typed
routes → `tsc` clean → Jest 46 suites / 388 tests on a cold cache → lint clean. Statuses: B09
Built; LOG-2, NFR-2 Built; LOG-1, LOG-5 In progress.

**Root cause of the typed-routes footgun (B09 builder):** running Jest rewrites the gitignored
`.expo/types/router.d.ts` with a stale route list. Check order is now in the builder prompt:
`expo start --offline` ~100 s → `tsc` → `lint` → `jest`. Gate 2 follows the same order.

**Earlier today:** B08 active-workout-store (NFR-3 Built), B07 local-store-and-sync (FND-3
Built), B06 training-math (`@training-math`), B05 auth-and-signup (migration applied and probed
live). Details in each plan file.

**B10 set-types** (planning now): warm-up toggle per set (excluded from PRs and volume by the math
module), bodyweight exercises log reps without a weight, optional RPE per set (LOG-10 pulled
forward because `sets.rpe` exists). Note for its planner: `limits.ts` already validates `rpe`
1–10 and `is_warmup` rides through the store; session volume math lands *in* `@training-math`
(`volume.ts`), never beside it (B06/B07 record).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Session
helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`,
`trigger`). Executions: 4/5 (B05), 6 (B06), 7 (B07), 8 (B08), 9 (B09); B10 is next. Reported
costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0.

**Tristen's hands-on list:** (1) **device run** (`cd frontend && npx expo start`): sign up under
18 → refused; sign up 18+; kill and reopen still signed in; start a workout, add two exercises,
log sets, one-tap Repeat, force-kill mid-workout and relaunch → Resume shows everything; finish in
airplane mode, reconnect, see the workout once in Supabase; sign out / sign in. Flips B05–B09 and
FND-1..4, NFR-1..3, NFR-8, LOG-2 to Done as each holds. (2) Supabase Dashboard → Authentication →
Providers → Email → turn "Confirm email" off (plan of record; the session's toggle was declined by
the permission layer). (3) The six external blockers. (4) Whether to grant `mmdc` to headless runs.

Next pipeline step after B10 merges: **B11** (check with `pipeline.mjs next --dry-run`).
