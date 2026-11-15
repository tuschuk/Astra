# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B30 merged; pipeline on B31)

**Twenty-six pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer is complete through share cards / re-shares; the library has filters, a
detail card and the lifter's history on it. The pipeline is running **B31 custom-exercises**.
Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list
is at the end.

**B30 library-card-history (merged, Gate 2 record):** no migration, no new dependency, no
network. The body of B13's `exercise-history/[exerciseId]` screen was extracted into
`components/workout/ExerciseHistorySection.tsx` — the one place that reads (`currentPrs`,
`exerciseSessions`, optionally `exerciseInfo`) and draws a lifter's PRs and sessions for an
exercise; the history screen is now Back + the section (`showName`), and the Library exercise
card renders the same section under its Tips with `exerciseId = libraryExerciseId(slug)` (the
uuidv5 mapping, the only bridge from catalog slug to device id). "Show older sessions" re-reads
with a grown `limit` through the existing parameter (no cursor machinery) until the end is
reached, so LIB-4's "complete history" is literally true. Deviations recorded in the plan: name
heading inside the section behind `showName`; `pageSize` prop (tests only); a failed show-more
read keeps the shown list; a missing route param shows the failure line; the `lb` test helper
moved to `test-utils/loggerTestKit.tsx`. Settled: `exercise-history/[exerciseId]` stays the
logger's deep link and does **not** redirect to the detail route (slug vs uuid keys; customs in
B31 have history but no catalog card — B31 revisits deliberately). Gate 2 reran in order:
regenerate typed routes → `tsc` clean → lint clean → Jest 117 suites / 1242 tests on a cold
cache (no act warnings); `mmdc` rendered the updated `app-flow.md` (one chart, OK). Statuses:
B30 Built; LIB-4 Built. Device-only: a logged exercise's card legible at phone width, show-more
on a long history, a never-logged exercise's card; PR placement (under Tips today — a one-file
swap if PRs should lead).

**Earlier:** B29 library-filters-and-detail (LIB-1, LIB-3), B28 share-cards (LOG-8, SOC-6), B27
moderation-and-safety (SOC-8, NFR-7), B26 post-privacy (YOU-5), B25 profile (YOU-1, YOU-2,
YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9), B23 votes-and-comments (SOC-4, SOC-5),
B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1,
SOC-3; LOG-13), B19 muscle-map (ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9
part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units
(LOG-6), B14 edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12
workout-notes (LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14,
LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07
local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B31 custom-exercises** (planning now): create, edit and delete a private exercise
(`owner_id`, synced; RLS already isolates it); it appears in the library and logger and collects
history and PRs. Step DoD: another user cannot read it through the API. Covers LIB-5. Standing
inputs for its planner: the server side mostly exists — `public.exercises` (migration
`20261114100100_training.sql`) has `owner_id uuid references profiles on delete cascade`,
`exercises_owner_idx`, and policies "library and own exercises are readable" (`owner_id is null
or owner_id = auth.uid()`), "users create their own exercises" and "users update their own
exercises" (check whether a **delete** policy exists; if not, that is the step's migration, and
decide delete vs soft-delete given `workout_exercises` rows that reference the custom); pull
sync already brings `exercises` the user can see (`sync/pull.ts`, `pullStandalone`), so the
planner must decide whether customs are a `SyncedTable` written through the outbox (the
offline-first rule says creation must work with no signal, so yes — the pattern is B12/B14's
outbox ops) and how the device `exercises` table's shape (seeded by `seedLocal.ts` under
uuidv5 ids, `SEED_TIMESTAMP`) fits a user-created row (v4 id from `expo-crypto`, as B08 does);
the **Library tab still reads the bundled catalog, not `astra.db`** (recorded gap, app-flow
line ~332) — customs have no catalog entry, so B31 must settle how they surface on the Library
tab (a "Your exercises" section read from the device table, or the long-deferred switch of the
Library to the device table; the former is the smaller, honest step) and in the logger's
`ExercisePicker` (which already searches the device table? — verify); the exercise detail route
resolves catalog slugs only, so a custom's card is a decision (B30 recorded that
`exercise-history/[exerciseId]` is where a custom's history lives today; a custom detail surface
could be that screen with Edit / Delete added, or a new `exercise/[id]` branch keyed by uuid);
`ExerciseHistorySection` takes any device exercise id, so history and PRs on a custom come free
once the row exists; PR detection (B13) keys on exercise id and needs nothing new; the DoD's
"another user cannot read it through the API" is probed live at Gate 2 with two throwaway users
(the B27/B28 precedent) — the planner should name the probe. No new dependency expected; the ERD
changes only if a policy or column is added; the flowchart gains the create / edit / delete path
and the custom-exercise data path through the outbox.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30 not yet on it). To update: stop the server
(`netstat -ano | findstr :8081` → `taskkill /PID <pid> /F`), `git -C
C:\Users\trist\Astra\Astra-main checkout --detach main`, `npm ci` in `Astra-main\frontend` if
`package-lock.json` changed, then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest; Gate 2 frees ports 8097 / 8099 and
renders `app-flow.md` with `mmdc` when the builder could not. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 30 (B30); B31 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3,
B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4,
B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6 (≈ $363 for twenty-six steps).

**Tristen's hands-on list:** (1) **device run** via the QR: sign up under 18 → refused; sign up
18+; kill and reopen still signed in; You → Edit profile; log a multi-exercise workout, one-tap
Repeat, force-kill and Resume; finish in airplane mode → analysis with muscle map → Share →
share sheet → post the PNG to another app and judge it → Next → Post / Skip; View workout → PR
badges; History; Edit and Delete; Settings → kg toggle and Privacy; Tool Kit calculators and
timer; Home → Latest / Hot and a flair chip → Share a photo → vote / comment → make a post
private → ⋯ Report → an author's profile → Follow, Re-share their post (a follower of yours sees
it), Mute, Block → unblock; Find lifters; Library → a muscle chip and an equipment chip (does the
header leave room for cards at phone width?) → tap a card → detail screen legibility → (after
updating the worktree to B30) PRs and sessions under the Tips, Show older sessions → Back;
reconnect → rows and objects in Supabase; sign out. Flips B05–B30 and their features to Done as
each holds. (2) **Moderation:** pick an appeal email for `docs/CONTENT_POLICY.md`; call
`moderate` once with your signed-in token on a throwaway post (probe list in DEFERRED). (3)
Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of
record; the session's toggle was declined by the permission layer). (4) The six external
blockers. (5) Whether to grant `mmdc` (and Deno) to headless runs. (6) Product readings to
confirm or overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM" label (B13);
muscle shading by max (B19); one post per workout and own posts on Home (B20); post visibility
inherits the workout's, no caption (B21); 10 MiB images, PR post = photo + New PR flair (B22);
votes and comments online-only, 500-char comments (B23); feed preference per phone, sticky flair
filter (B24); public-read avatars, username editable (B25); post / workout visibility lockstep,
three options, body-data control deferred (B26); whole-person mute, viewer-relative tallies,
reports outlive content (B27); export own content only, no photo-post export, no re-share
chains, re-shares hidden from their own owner once the original is hidden (B28); muscle filter
matches any involvement ordered hardest-first, region ∧ muscle may be empty on purpose, no
detail link from the logger's picker (B29); PRs below the coaching content on the card, history
screen kept as the logger's deep link, grow-the-limit show-more rather than cursor paging (B30).

Next pipeline step after B31 merges: **B32** (check the Build order table for the exact name).
