# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05–B08 merged; pipeline on B09)

**Four pipeline steps are merged to `main`; the pipeline is running B09 logger-screen**, the first
step that puts a screen on the stack built so far. Gates are delegated to the session (CLAUDE.md,
"Autonomous sessions"). Tristen's hands-on list is at the end.

**B08 active-workout-store (merged, Gate 2 record):** `frontend/src/workout/activeWorkout.ts` —
start, resume (`loadActiveWorkout`), add/remove/reorder exercise, log/update/remove set,
repeat-last-set, finish, discard, `subscribe`/`getSnapshot`/`getStatus`. Every mutation is one
committed SQLite transaction and the snapshot is re-read from the file. Drafts stay out of the
outbox; `finish` stamps `ended_at` (clamped ≥ `started_at`) and enqueues the whole tree in one
transaction via the new `writeLocalTree`, waking the sync engine. Server CHECKs on `sets` are
mirrored once in `@training-math/limits.ts` (with storage rounding: kg to 0.01, RPE to 0.1) so a
server-refusable row never reaches the outbox. v4 ids via `expo-crypto` (`frontend/src/lib/ids.ts`,
injectable). No server or device schema migration. Seven build deviations recorded in the plan
file (all tightenings). Gate 2 reran Jest 37 suites / 332 tests on a cold cache, lint clean, tsc
clean after regenerating `.expo/types/router.d.ts` (it goes stale during every builder run; the
builder prompt explains the fix). Statuses: B08 Built; NFR-3 Built; LOG-1, LOG-2, NFR-2 In progress.

**Earlier today:** B07 local-store-and-sync (device SQLite + outbox sync engine; FND-3 Built),
B06 training-math (the one math module, `@training-math`), B05 auth-and-signup (migration applied
and probed live). Details in each plan file.

**B09 logger-screen** (planning now): Workout tab starts an empty workout; the active-workout
screen adds exercises by library search, logs sets in the user's unit, repeats the last set in one
tap, removes and reorders; finish opens the saved workout; the Workout tab lists past workouts.
Rules recorded for it by B07/B08: call `loadActiveWorkout` on launch or when opening the tab; offer
resume-or-discard when `startActiveWorkout` refuses; offer discard instead of finishing an empty
workout; every query filters by the signed-in `user_id`; write only through the DAO / store.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Session
helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`,
`trigger`). Executions: 4/5 (B05), 6 (B06), 7 (B07), 8 (B08); B09 is next. Reported costs: B05
≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5.

**Tristen's hands-on list:** (1) device runs — once B09 merges, the whole P0 logging path is
checkable on a phone: sign up (under 18 refused), sign in, kill and reopen signed in, log a
multi-exercise workout in airplane mode, force-kill mid-workout and relaunch, reconnect and see
the workout once in Supabase — flips B05–B08 and FND-1..4, NFR-1..3, NFR-8 to Done as each holds;
(2) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of
record; the session's toggle was declined by the permission layer); (3) the six external
blockers; (4) whether to grant `mmdc` to headless runs.

Next pipeline step after B09 merges: **B10 set-types** (check with `pipeline.mjs next --dry-run`).
