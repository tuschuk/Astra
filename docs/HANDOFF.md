# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B17 merged; pipeline on B18)

**Thirteen pipeline steps are merged to `main`.** The P0 logging path is complete on screen,
Settings has a synced kg/lb toggle, and the Tool Kit has its four calculators plus the five-mode
timer. The pipeline is running **B18 analysis-engine** — the first Supabase edge function. Gates
are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at
the end.

**B17 tool-kit-timer (merged, Gate 2 record):** `toolkit/timer.ts` (pure timestamp engine —
state is `startedAt` / `pausedAt` / `pausedTotalMs`, every frame derived from `Date.now()`;
stopwatch, countdown, EMOM, AMRAP, Tabata; `snapshot`, `endsAtMs`, pure transitions),
`toolkit/timerStore.ts` (module-level singleton that keeps running while the sheet is closed;
schedules / cancels the zero alert through an injected port), `toolkit/timerAlerts.ts` (the only
`expo-notifications` import, lazy and guarded; one fixed alert id so a booking survives an app
kill *and* can be cancelled after relaunch — review fix; Android channel; permission never
blocks the clock; generation guard against a pause during the permission dialog),
`components/toolkit/TimerScreen.tsx` (wall-timer digits, locked mode chips while a run exists,
presets, accessibility announcements). Workout tab's Timer tile is live. One new dependency,
`expo-notifications ~58.1.9`, local only. Nine deviations recorded. Gate 2 reran in order:
regenerate typed routes → `tsc` clean → lint clean → Jest 68 suites / 761 tests on a cold cache.
Statuses: B17 Built; TK-5 Built (both-platform backgrounding + notification = device run).

**Earlier:** B16 tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14
edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes
(LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12; LOG-13 In progress until the feed), B10
set-types (LOG-14, LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3),
B07 local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan
file.

**B18 analysis-engine (built on branch `analysis-engine`, awaiting Gate 2):** shared rules
`_shared/analysis` (`@analysis`: summary, four-state copy, `NOT_MEDICAL_ADVICE`, engine v1);
edge function `analyze-workout` (`handler.ts` logic + Deno `index.ts`), **deployed live v2,
verify_jwt on**, owner-only (404 for anyone else's workout — a review fix); migration
`20261115080420_workout_analyses.sql` applied live and RLS-probed (owner read only, no client
writes); device schema V7 mirror; engine request pass after each successful pull (≤ 10/sync);
fourth pull bookmark; analysis screen (`app/analysis/[id].tsx`) after Finish and from the saved
workout's Analysis button. `npm run lint` now covers `backend/supabase/functions`. Builder
checks: routes regenerated → tsc clean → lint clean → Jest 74 suites / 817 tests. Gate 2 still
owes the two live HTTP probes (no-token refused; signed-in invoke + cross-user 404) — curl was
not permitted to the builder. Deviations and the review record are in the plan file.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Update to the latest main: `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, then
restart the server from `Astra-main\frontend` with `npx expo start --lan` (B17 added a native
dependency, `expo-notifications`, so run `npm ci` in that folder first). Currently serving
`3c901ad` (through B13).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 17 (B17); B18 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0 (≈ $174 for thirteen steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
PR badges; History; Edit and Delete a saved workout (PR promotion); Settings → kg toggle; Tool
Kit calculators in airplane mode; timer in every mode backgrounded ≥ 2 min and a countdown's
notification at zero, on iOS and Android (if Expo Go on Android won't load `expo-notifications`,
the timer must still run and the alert check needs a development build); reconnect and check
Supabase; sign out. Flips B05–B17 and their features to Done as each holds. (2) Supabase
Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of record; the
session's toggle was declined by the permission layer). (3) The six external blockers. (4)
Whether to grant `mmdc` to headless runs. (5) Two product readings to confirm or overrule: no
bodyweight rep-record PR book (B10/B13); the bare "e1RM" label on the entry card and history
(B13) now that the full citation lives on the 1RM calculator (B16).

Next pipeline step after B18 merges: **B19 muscle-map**.
