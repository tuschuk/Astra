# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — B05–B16 merged; pipeline on B17)

**Twelve pipeline steps are merged to `main`.** The P0 logging path is complete on screen, Settings
has a synced kg/lb toggle, and the Tool Kit's four calculators are live offline from a floating
button in the logger and from the Workout tab tiles. The pipeline is running **B17
tool-kit-timer**. Gates are delegated to the session (CLAUDE.md, "Autonomous sessions").
Tristen's hands-on list is at the end.

**B16 tool-kit-calculators (merged, Gate 2 record):** `components/toolkit/ToolKitSheet.tsx` (a
full-screen Modal over the mounted logger — no route, so "keeps your place" by construction),
`OneRmCalculator` (Epley estimate + 2–10 rep table + the Epley (1985) citation printed with every
answer), `RpeCalculator` (bounded chips reps 1–12 / RPE 6–10, loadable snap, % of 1RM),
`IntensityCalculator` (0–150 %, bounds message), `PlateLoader` (rack's unit, editable per-unit
rack persisted device-side in `expo-sqlite/kv-store` — not synced, not per-user, by recorded
decision), shared `ChoiceChips` / `WeightField` / `ResultCard`, `toolkit/{session,plateRack,
inputs}.ts`. Zero new math — every number is `@training-math`'s, and tests compute expectations
through the module. Import graph has no transport / Supabase / network module (the offline
proof, re-checked at Gate 2). Eight deviations recorded (shared input reader, chip component,
persisted rack unit, solver bounds). Gate 2 reran in order: regenerate typed routes → `tsc` clean
→ lint clean → Jest 64 suites / 696 tests on a cold cache. Statuses: B16 Built; TK-1..TK-4
Built; NFR-1 In progress (flips on the airplane-mode device run).

**Earlier today:** B15 settings-and-units (LOG-6), B14 edit-delete-workouts (LOG-9), B13
exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12; LOG-13 In progress until the feed), B10 set-types
(LOG-14, LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07
local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B17 tool-kit-timer** (planning now): count-up, countdown, EMOM, AMRAP and Tabata, timestamp-based
so they stay accurate while backgrounded, with a local notification at zero. Standing inputs for
its planner: the Tool Kit sheet has an `initialTool` seam and a placeholder Timer tile on the
Workout tab (B16 left both for B17); timer state belongs with `toolkit/session.ts`'s pattern
(timestamps, not tick counts — `Date.now()` at start/pause, derive the display); `expo-notifications`
is the free Expo module for a *local* scheduled notification (no push service, no paid tier, no
server) — verify it still works in Expo Go for local notifications on SDK 58 before relying on
it for the device check; nothing speculative (no sound packs, no background tasks beyond the
scheduled notification).

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
Executions 4/5 (B05) through 16 (B16); B17 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5 (≈ $162 for twelve steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
PR badges; History; Edit and Delete a saved workout (PR promotion); Settings → kg toggle across
every screen; Tool Kit in airplane mode (floating button clear of the Log button with the
keyboard up); reconnect and check Supabase; sign out. Flips B05–B16 and their features to Done
as each holds. (2) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email"
off (plan of record; the session's toggle was declined by the permission layer). (3) The six
external blockers. (4) Whether to grant `mmdc` to headless runs. (5) Two product readings to
confirm or overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM" label on the
entry card and history (B13) now that the full citation lives on the 1RM calculator (B16).

Next pipeline step after B17 merges: **B18 analysis-engine** (the first server function).
