# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B32 and B34 merged; pipeline on B35)

**Twenty-nine pipeline steps are merged to `main`.** Every P0 step through B32 is Built; B33
video-service is Blocked (video provider); Phase 2 has begun with B34 program-builder. The
pipeline is running **B35 run-program**. Gates are delegated to the session (CLAUDE.md,
"Autonomous sessions"). Tristen's hands-on list is at the end.

**B34 program-builder (merged, Gate 2 record):** migration `20261115193156_programs.sql`
(applied live, confirmed at Gate 2): `programs`, `program_weeks`, `program_workouts`,
`program_exercises` — client uuid PKs, `position` ordering, `deleted_at` soft delete on all four,
`moddatetime` triggers, CHECKs (name 1–100, workout name ≤ 100, position ≥ 0, target_sets ≥ 1,
reps ≥ 0, weight ≥ 0, RPE 1–10), `program_exercises.exercise_id` nullable `on delete set null`,
RLS on all four verbs through chained SECURITY DEFINER helpers `private.owns_program`,
`week_program`, `workout_week` (so B39 widens one select rule per table); **no `visibility`
column** (B39 adds it with its own policy rewrite). Device schema V12 mirrors the four tables
with **no local foreign keys** (review finding: another phone's week can arrive before its
program within one sync, so the orphan waits unseen until the parent lands; reads walk down from
the program). Sync: four `SyncedTable`s appended to `SYNC_ORDER`, pulled parents-first through
one generic `pullProgramRows` standalone pass per table (safe only while program rows stay
author-only readable — recorded for B39), soft deletes ride the existing upsert push/pull, no
tombstones. App: `programs/programs.ts` is the one home (create / rename / delete program, add /
remove week, add / rename / remove workout, add / update / move / remove exercise,
`listPrograms`, `readProgramTree`, `readProgramWorkout`; every write checks ownership and
liveness and validates through new `@training-math` limits `assertValidProgramName`,
`assertValidProgramWorkoutName`, `assertValidProgramTargets`, `assertValidProgramPosition`;
moving an exercise renumbers only changed rows; adding refuses an exercise id the phone does not
hold as library or live custom), `components/programs/` (`NewProgramForm`, `AutosaveNameField`,
`ProgramExerciseCard` with an explicit Save targets button, `confirmProgramRemoval`), routes
`app/programs.tsx`, `app/program/[id].tsx`, `app/program-workout/[id].tsx`, and a **Your
programs** button on the Workout tab ("Start from a program" stays disabled for B35). **Gate 2
live probe (two simulated users, rolled back):** user B reads 0 rows by id in all four tables,
sees 0 program rows unfiltered, updates 0 and deletes 0; B's inserts into A's tree and a program
forged under A's id are refused (42501); empty name and RPE 11 refused by CHECKs; A's tree
intact with weight stored in kg. Gate 2 reran in order: regenerate typed routes → `tsc` clean →
lint clean → Jest 132 suites / 1417 tests on a cold cache at default workers (no timeout);
`mmdc` rendered both diagrams (OK). Statuses: B34 Built; PRG-1, PRG-2 Built. Device-only: author
a program in airplane mode → kill → reopen intact → reconnect → rows in Supabase; the editor at
phone width (week sections, target boxes, picker). Recorded gaps: `export-data` does not export
programs yet (deletion cascades already); B39 must keep program children author-only readable or
change the pull shape.

**Earlier:** B32 export-and-delete-account (NFR-6), B31 custom-exercises (LIB-5), B30
library-card-history (LIB-4), B29 library-filters-and-detail (LIB-1, LIB-3), B28 share-cards
(LOG-8, SOC-6), B27 moderation-and-safety (SOC-8, NFR-7), B26 post-privacy (YOU-5), B25 profile
(YOU-1, YOU-2, YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9), B23 votes-and-comments
(SOC-4, SOC-5), B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post (LOG-7), B20
posts-and-feed (SOC-1, SOC-3; LOG-13), B19 muscle-map (ANA-3), B18 analysis-engine (ANA-1,
ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators
(TK-1..4), B15 settings-and-units (LOG-6), B14 edit-delete-workouts (LOG-9), B13
exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09 logger-screen
(LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06
training-math, B05 auth-and-signup. Details in each plan file.

**B35 run-program (built on branch `run-program`, awaiting Gate 2):** migration
`20261115203159_program_runs.sql` **applied live by the builder** — `program_runs` (position pair
`next_week_position` / `next_workout_position`, `started_at`, `ended_at` with a ≥ start CHECK,
owner-only RLS on all four verbs, no one-active unique index by design) and nullable
`workouts.program_workout_id` (`on delete set null`). Builder's live probe (rolled back): a
synthetic second user reads / updates / deletes 0 runs, forging under A's id 42501, CHECKs 23514,
a random `program_workout_id` 23503. Device schema V13. `SYNC_ORDER` **reordered** so programs →
weeks → program workouts upload before workouts (a linked workout must not out-run its program
workout). App: `programs/programRuns.ts` (start / stop / readActiveRun newest-wins / position rule
/ advanceRunOnFinish, every end time clamped), `workout/startProgramSession.ts` (title + exercises
+ "Target: …" entry notes, no pre-logged sets), `draftPolicy.finish` advances the run in the same
`writeLocalTree` transaction, `ProgramPickerSheet`, and the Workout tab's run card (Start next
session / Start empty workout / Stop program). Finishing the last session ends the run (no loop —
a product reading for Tristen). Deviations in the plan's "Build notes". Gate 2: rerun checks,
render both diagrams (`mmdc` was not available to the builder), probe the migration's policies
once more if wanted.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B34 not yet on it — B31 and B34 add device schema
V11 and V12, migrated on open). To update: stop the server (`netstat -ano | findstr :8081` →
`taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`,
`npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in B30–B34), then
`npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps. Check order: `expo start --offline` ~150 s → `tsc`
→ lint → Jest; Gate 2 frees ports 8097 / 8099, renders the diagrams with `mmdc`, and runs live
HTTP probes through the PowerShell tool with the throwaway-JWT recipe (both recorded in
PIPELINE.md). Builders have hit Jest 30 s timeouts under full-suite load at default workers
(`exercise-detail`'s 151-exercise loop is the usual victim) and rerun with `--maxWorkers=50%`;
Gate 2's cold-cache default-worker runs have passed every time. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 33 (B34); B35 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3,
B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4,
B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9 (≈ $420 for
twenty-nine steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B34 first):
sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile;
log a multi-exercise workout, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Share → share sheet → post the PNG to another app and judge it →
Next → Post / Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle,
Privacy, Export your data (share sheet → open the JSON elsewhere); Tool Kit calculators and
timer; Home → Latest / Hot and a flair chip → Share a photo → vote / comment → make a post
private → ⋯ Report → an author's profile → Follow, Re-share their post (a follower of yours sees
it), Mute, Block → unblock; Find lifters; Library → a muscle chip and an equipment chip (header
room at phone width?) → tap a card → detail legibility → PRs and sessions under the Tips, Show
older sessions → New exercise in airplane mode → it appears in Library and picker → log a set →
its card → edit → delete → history keeps the name; **Workout → Your programs → New program →
Add week → Add workout → Add exercise (a library one and your custom) → targets → kill → reopen
intact** → reconnect → rows (incl. the `deleted_at` custom and the four program tables) and
objects in Supabase; sign out; with a throwaway account: Settings → Delete account → type DELETE
→ lands on sign-in, the email no longer signs in, a reopened app has an empty device database.
Flips B05–B34 and their features to Done as each holds. (2) **Moderation:** pick an appeal email
for `docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on a throwaway post
(probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers → Email → turn
"Confirm email" off (plan of record; the session's toggle was declined by the permission layer).
(4) The six external blockers — B33 video provider is the step the pipeline skipped. (5) Whether
to grant `mmdc` (and Deno) to headless runs. (6) Product readings to confirm or overrule: no
bodyweight rep-record PR book (B10/B13); the bare "e1RM" label (B13); muscle shading by max
(B19); one post per workout and own posts on Home (B20); post visibility inherits the workout's,
no caption (B21); 10 MiB images, PR post = photo + New PR flair (B22); votes and comments
online-only, 500-char comments (B23); feed preference per phone, sticky flair filter (B24);
public-read avatars, username editable (B25); post / workout visibility lockstep, three options,
body-data control deferred (B26); whole-person mute, viewer-relative tallies, reports outlive
content (B27); export own content only, no photo-post export, no re-share chains, re-shares
hidden from their own owner once the original is hidden (B28); muscle filter matches any
involvement ordered hardest-first, region ∧ muscle may be empty on purpose, no detail link from
the logger's picker (B29); PRs below the coaching content on the card, history screen kept as the
logger's deep link, grow-the-limit show-more (B30); soft delete for customs, customs never match
a region chip, no create-from-picker, no muscle-map shading for customs (B31); export contents
(own rows only; votes, comments, follows, blocks, mutes, reports and photo binaries out; kg as
stored), sweep-before-delete, moderator accounts refuse self-delete, no grace period, other
devices of a deleted account keep their local copy (B32); **programs** — soft delete on all
four tables, no visibility column until B39, `target_sets` required but reps / load / RPE
optional, weeks unnamed ("Week N"), no program description, swap-style move buttons rather than
drag, explicit Save targets, a new slot starts at 3 sets, `export-data` not yet exporting
programs (B34); **running programs** — finishing the last session ends the run (no loop),
targets as entry notes rather than pre-filled sets, positions slide when the author edits
mid-run, restart always begins at Week 1, an empty workout during a run moves nothing (B35).
Device check for B35 is in DEFERRED.

Next pipeline step after B35 merges: **B36 teams** (check the Build order table for the exact
branch name).
