# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05–B14 merged; pipeline on B15)

**Ten pipeline steps are merged to `main`.** The P0 logging path is complete on screen: sign up /
sign in → Workout tab → full-screen logger (warm-ups, bodyweight, RPE, supersets, drop sets,
timed / scored work, title + notes, last time + current PRs per exercise) → finish → saved workout
with PR badges → exercise history → **edit or delete past workouts with PR recompute and
cross-device deletion**. The pipeline is running **B15 settings-and-units**. Gates are delegated
to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B14 edit-delete-workouts (merged, Gate 2 record):** migration
`20261115045638_sync_tombstones.sql` (applied live, confirmed at Gate 2): `sync_tombstones`
(owner-only read, no client write, filled by `AFTER DELETE` triggers on `workouts` and
`personal_records`, skips users whose profile is gone so account deletion still works). Keep-best
trigger kept unchanged; demotions travel as delete-then-insert. Device schema V5: outbox `op`
column; per-op watermarks; push runs a delete phase (reverse `SYNC_ORDER`) before upserts; the
engine applies tombstones **before every push** (review-found fix: otherwise an unsent edit
resurrected a deleted workout), then pushes, then pulls with tree reconciliation and a final
tombstone pass, all guarded by pending outbox lines. `activeWorkout.ts` gained a `WritePolicy`
seam (draft behavior byte-identical — B08/B13 suites pass unmodified); `editWorkout.ts` provides
`openWorkoutForEdit` / `deleteWorkout` with `recomputeRecords` in the same transaction as each
edit. Screens: Edit / Delete on the saved workout, `app/edit-workout/[id].tsx` reusing the logger
surface, shared `WorkoutDetailsFields`. Eight deviations recorded; known limits in DEFERRED
(inline set editing, a small resurrection window needing a server guard, the accepted
multi-device demotion race, tombstone retention). Gate 2 reran in order: regenerate typed routes
(150 s) → `tsc` clean → lint clean → Jest 52 suites / 594 tests on a cold cache. Statuses: B14
Built; LOG-9 Built.

**Earlier today:** B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12; LOG-13 In progress until the feed), B10 set-types
(LOG-14, LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07
local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B15 settings-and-units** (planning now): settings screen from the profile button; kg/lb toggle
backed by `user_settings.unit` and synced; conversion only at display through `@training-math`;
account section (email, sign out). Standing inputs: `settings/displayUnit.ts` is the one seam
B09 left for B15 to rewire (every weight display and parse already goes through it); the server
column `user_settings.unit` exists (B02) but `user_settings` is not in the device mirror yet —
B15 decides whether to mirror the table (schema V6 + `TABLE_COLUMNS` + sync) or read/write it
directly; B08's storage rounding (kg to 0.01) means a unit switch never rewrites stored values.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` (detached HEAD —
it must **never** have `main` checked out, or the pipeline's `git checkout main` in this repo
fails; recorded in `docs/PIPELINE.md`). Expo dev server runs detached from its `frontend/` on
port 8081 (`--lan`), QR at `C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png`
encoding `exp://192.168.0.11:8081`. To update it to the latest main:
`git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, then restart the server
(`cd Astra-main\frontend; npx expo start --lan`). Currently serving commit `3c901ad` (through B13).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order for gates and builders: `expo start --offline` ~150 s → `tsc` → lint → Jest. Session
helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`,
`trigger`). Executions 4/5 (B05) through 14 (B14); B15 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1 (≈ $136 for ten steps).

**Tristen's hands-on list:** (1) **device run** via the QR above (update the worktree first to
include B14): sign up under 18 → refused; sign up 18+; kill and reopen still signed in; log a
multi-exercise workout with every set type and notes, one-tap Repeat, force-kill and Resume;
finish in airplane mode → PR badges; History from an entry card; Edit a saved workout and Delete
a PR-holding one → next best set badged; reconnect, see workouts, `personal_records` and
`sync_tombstones` rows in Supabase; sign out / sign in. Flips B05–B14 and their features to Done
as each holds. (2) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email"
off (plan of record; the session's toggle was declined by the permission layer). (3) The six
external blockers. (4) Whether to grant `mmdc` to headless runs. (5) Two product readings to
confirm or overrule: no bodyweight rep-record PR book (B10/B13); the "e1RM" label counts as
"worded as an estimate" without an on-screen Epley citation (B13).

Next pipeline step after B15 merges: **B16 tool-kit-calculators**.
