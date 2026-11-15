# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05–B15 merged; pipeline on B16)

**Eleven pipeline steps are merged to `main`.** The P0 logging path is complete on screen (sign up /
sign in → Workout tab → logger with every set type, notes, last time + PRs → finish → saved
workout with PR badges → exercise history → edit / delete with PR recompute) and the app now has
a Settings screen with a synced kg/lb toggle. The pipeline is running **B16 tool-kit-calculators**.
Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is
at the end.

**B15 settings-and-units (merged, Gate 2 record):** no server migration (`user_settings`, its RLS
and the signup trigger shipped in B02; Gate 2 confirmed owner `select` + `update` policies, the
`unit` CHECK and the `lb` default live). Device schema V6 mirrors a three-column `user_settings`
row; `db/userSettings.ts` owns its SQL; `settings/unitStore.ts` is the snapshot store
(`hydrate` / `setUnit` / `applyPulled` / `reset`, version-guarded, reset on sign-out);
`useDisplayUnit()` now reads it so all four weight screens convert with no caller changes;
dedicated push (update-only, zero rows = cleared) and pull (one row, pending-guarded) phases on
the existing engine. Settings screen (`app/settings.tsx`) from the You tab's gear button: Units
(radio group, accessible) + Account (email, Sign out — moved from You, not duplicated). Nine
deviations recorded, all tightenings. Gate 2 reran in order: regenerate typed routes → `tsc`
clean → lint clean → Jest 55 suites / 630 tests on a cold cache. Statuses: B15 Built; LOG-6
Built; YOU-4 In progress (Privacy B26, Notifications B47).

**Earlier today:** B14 edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4,
LOG-5), B12 workout-notes (LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12; LOG-13 In
progress until the feed), B10 set-types (LOG-14, LOG-15), B09 logger-screen (LOG-2, NFR-2), B08
active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06 training-math, B05
auth-and-signup. Details in each plan file.

**B16 tool-kit-calculators** (planning now): a Tool Kit sheet that opens from the active workout
in one tap and closes without losing the user's place; 1RM, RPE, intensity and plate-loader
screens over `@training-math`; fully offline. Standing inputs for its planner: every formula is
already in the module (`epleyE1rm`, `weightForReps`, `workingWeightFromRpe` reps 1–12 / RPE
6–10, `workingWeightFromPercent` 0–150 %, `loadBar` with per-side inventory, `roundToIncrement`);
weights display and parse through `useDisplayUnit` / `displayWeight` / `lbToKg`; **product copy
that states a 1RM estimate must cite the Epley source and be worded as an estimate** (CLAUDE.md
rule — B13 left the bare "e1RM" label to Tristen; the calculator is where the citation belongs);
a plate inventory needs a home (device-only setting or `user_settings` column by migration —
planner decides; nothing speculative).

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Update to the latest main: `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, then
restart the server from `Astra-main\frontend` with `npx expo start --lan`. Currently serving
`3c901ad` (through B13).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 15 (B15); B16 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0 (≈ $149 for eleven steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
PR badges; History; Edit and Delete a saved workout (PR promotion); Settings → kg toggle across
every screen, offline, synced; reconnect and check Supabase; sign out. Flips B05–B15 and their
features to Done as each holds. (2) Supabase Dashboard → Authentication → Providers → Email →
turn "Confirm email" off (plan of record; the session's toggle was declined by the permission
layer). (3) The six external blockers. (4) Whether to grant `mmdc` to headless runs. (5) Two
product readings to confirm or overrule: no bodyweight rep-record PR book (B10/B13); the "e1RM"
label counts as "worded as an estimate" without an on-screen citation (B13; B16 adds the
citation in calculator copy).

Next pipeline step after B16 merges: **B17 tool-kit-timer**.
