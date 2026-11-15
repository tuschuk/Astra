# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B29 merged; pipeline on B30)

**Twenty-five pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer is complete through share cards / re-shares; the library steps have
begun. The pipeline is running **B30 library-card-history**. Gates are delegated to the session
(CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B29 library-filters-and-detail (merged, Gate 2 record):** no migration, no new dependency, no
network — the bundled catalog is the only data source. App: `library/muscles.ts` is now the one
home of muscle vocabulary (`MUSCLE_ORDER`, `MUSCLE_NAMES`, `rankMuscles`; moved out of
`components/muscleMapPaths.ts` with no re-export left behind — the B19 review decision);
`catalog.ts` gained `filterExercises` (AND of region / muscle / equipment; a muscle filter orders
hardest-trained first), `exerciseById`, `EQUIPMENT_ORDER` (typed `Record` so a new equipment
kind fails `tsc` until it gets a chip) and `BODY_REGION_LABELS`; `cueFormat.ts` splits the
founder's `**bold**` cue markers into spans; the Library tab has two sideways-scrolling
single-select chip rows (12 muscles, 6 equipment kinds) under the region chips, cards are tappable
with a chevron; new read-only route `app/exercise/[id]` (slug id, signed-in only) shows name,
region, equipment, pattern(s), ranked muscles, the five coaching steps and tips, with a not-found
state and Back on every state. Deviations D1–D5 recorded in the plan (equipment order and region
labels in `catalog.ts`, region dot + label, `ChipRow<T>` helper, card `testID`, detail test over
all 151 exercises). Gate 2 reran in order: regenerate typed routes → `tsc` clean → lint clean →
Jest 116 suites / 1232 tests on a cold cache; `mmdc` rendered the updated `app-flow.md` (one
chart, OK). Statuses: B29 Built; LIB-1, LIB-3 Built. Device-only: header height at phone width
(four region chips + two scroll rows + search before the first card; fallback is a "Filters"
disclosure), detail legibility, card tap feel.

**Earlier:** B28 share-cards (LOG-8, SOC-6), B27 moderation-and-safety (SOC-8, NFR-7), B26
post-privacy (YOU-5), B25 profile (YOU-1, YOU-2, YOU-3, SOC-7), B24 feed-sort-and-filter
(SOC-11, SOC-9), B23 votes-and-comments (SOC-4, SOC-5), B22 image-posts (SOC-2, NFR-4 part),
B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1, SOC-3; LOG-13), B19 muscle-map (ANA-3),
B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer (TK-5), B16
tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14 edit-delete-workouts
(LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09 logger-screen
(LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06
training-math, B05 auth-and-signup. Details in each plan file.

**B30 library-card-history** (planning now): the exercise detail screen shows the lifter's
current PRs and full logged history for that movement. DoD: the numbers match B13's records.
Covers LIB-4. Standing inputs for its planner: B13 already built the whole data path and a
screen for it — `app/exercise-history/[exerciseId].tsx` (keyed by the **server uuidv5 exercise
id**, reached from the logger's last-time panel) reads `exerciseSessions` / `exerciseInfo` from
`workout/history.ts`, `currentPrs` from `workout/prs.ts`, and formats with `formatPrLine`,
`formatDropSet`, `groupDropSets`, `workoutDateLabel` in `workout/format.ts`; the detail route is
keyed by the **catalog slug**, and `libraryExerciseId(slug)` in `library/uuidv5.ts` is the one
mapping between the two (the same ids `seedLocal.ts` wrote into the device's `exercises` table).
The planner's main call is how the two screens relate: B30's step row says the *detail* shows
PRs and history, so the natural shape is to reuse B13's queries and formatting in the detail
screen (one home for the "Current PRs" card and the session list — a second rendering of the
same numbers must come from the same functions, not copies) and decide whether
`exercise-history/[exerciseId]` stays as the logger's deep link or redirects to the detail route.
Everything reads the phone's database only (offline by construction); no migration, no sync
change, no new dependency expected; the ERD is untouched; the flowchart's Library branch gains
the history section. Route tests live in `src/__tests__/`; B13's data functions already have
tests, so B30's tests are the detail screen with seeded history and the slug → id mapping.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Update to the latest main: `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, `npm
ci` in `Astra-main\frontend` (several native modules were added since B13), then `npx expo start
--lan`. Currently serving `3c901ad` (through B13).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest; Gate 2 frees ports 8097 / 8099.
Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`,
`trigger`). Executions 4/5 (B05) through 29 (B29); B30 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1,
B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5 (≈ $356 for twenty-five steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile; log a
multi-exercise workout, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Share → share sheet → post the PNG to another app and judge it →
Next → Post / Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle and
Privacy; Tool Kit calculators and timer; Home → Latest / Hot and a flair chip → Share a photo →
vote / comment → make a post private → ⋯ Report → an author's profile → Follow, Re-share their
post (a follower of yours sees it), Mute, Block → unblock; Find lifters; Library → a muscle chip
and an equipment chip (does the header leave room for cards at phone width?) → tap a card →
detail screen legibility → Back; reconnect → rows and objects in Supabase; sign out. Flips
B05–B29 and their features to Done as each holds. (2) **Moderation:** pick an appeal email for
`docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on a throwaway post
(probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers → Email → turn
"Confirm email" off (plan of record; the session's toggle was declined by the permission layer).
(4) The six external blockers. (5) Whether to grant `mmdc` (and Deno) to headless runs. (6)
Product readings to confirm or overrule: no bodyweight rep-record PR book (B10/B13); the bare
"e1RM" label (B13); muscle shading by max (B19); one post per workout and own posts on Home
(B20); post visibility inherits the workout's, no caption (B21); 10 MiB images, PR post = photo
+ New PR flair (B22); votes and comments online-only, 500-char comments (B23); feed preference
per phone, sticky flair filter (B24); public-read avatars, username editable (B25); post /
workout visibility lockstep, three options, body-data control deferred (B26); whole-person mute,
viewer-relative tallies, reports outlive content (B27); export own content only, no photo-post
export, no re-share chains, re-shares hidden from their own owner once the original is hidden
(B28); muscle filter matches any involvement ordered hardest-first, region ∧ muscle may be
empty on purpose, no detail link from the logger's picker (B29).

Next pipeline step after B30 merges: **B31 custom-exercises** (check the Build order table for
the exact name).
