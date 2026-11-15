# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B31 merged; pipeline on B32)

**Twenty-seven pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit
are built; the social layer is complete through share cards / re-shares; the library has
filters, a detail card, the lifter's history on it, and private custom exercises. The pipeline
is running **B32 export-and-delete-account**. Gates are delegated to the session (CLAUDE.md,
"Autonomous sessions"). Tristen's hands-on list is at the end.

**B32 export-and-delete-account (built on its branch, awaiting Gate 2):** edge functions
`export-data` (v1, caller token only, paged, owner-filtered) and `delete-account` (v2, service
role after `getUser`, sweep `post-images` + `avatars` then `auth.admin.deleteUser`) deployed with
`verify_jwt` on; Settings → Account gained Export your data and Delete account; new screen
`app/delete-account.tsx`; device wipe `db/wipeDevice.ts`. Cascade proven in a rolled-back SQL
probe; the HTTP probe is for Gate 2 (see the plan's Build notes and DEFERRED). No migration.

**B31 custom-exercises (merged, Gate 2 record):** migration
`20261115173827_exercises_soft_delete.sql` (applied live, confirmed at Gate 2): `exercises.
deleted_at timestamptz` + CHECK `exercises_deleted_customs_only` (`deleted_at is null or owner_id
is not null`); no policy changes (the four owner policies already existed). **Delete is a soft
delete** — settled in the plan after verifying that hard delete wedges the push queue (PR rows
cascade on exercise delete; `sync_tombstones` has no exercises channel) and erases history
names; the exercise-name snapshot item went back to DEFERRED. Device schema V11 adds the column;
`TABLE_COLUMNS.exercises` carries it so the transport needs nothing. App: `library/
customExercises.ts` is the one home for custom reads and writes (create / update / soft delete
through `writeLocal`, `listCustomExercises` filters `deleted_at is null`, `getCustomExercise`,
pure `filterCustomExercises`; history readers deliberately do not filter deleted rows so past
sessions keep their name); `useCustomExercises` loader shared by the Library tab and both
logging screens; `components/library/CustomExerciseForm.tsx` (name validated by
`assertValidExerciseName` from `@training-math` `limits.ts`, mirroring the server's 1–80 CHECK;
optional equipment and muscle chip rows), `CustomPill`, `confirmDeleteCustomExercise`;
"Your exercises" section with a New exercise button above the catalog count on the Library tab;
`ExercisePicker` takes the custom rows and `onPick` now hands back `{ deviceId, name }` (the
logging screens dropped their own `libraryExerciseId` calls); `exercise/[id]` grew a second
branch — catalog miss → device read → custom card with Edit / Delete and the shared
`ExerciseHistorySection`. **Gate 2 live probe (two simulated users in one rolled-back
transaction):** the other user reads 0 rows by id, sees 0 customs and exactly the 151 library
rows, and updates / soft-deletes / hard-deletes 0 rows; stamping a library row is refused by the
CHECK. Gate 2 reran in order: regenerate typed routes → `tsc` clean → lint clean → Jest 120
suites / 1284 tests on a cold cache (the builder's one load-induced timeout did not recur);
`mmdc` rendered both diagrams (OK). Statuses: B31 Built; LIB-5 Built. Device-only: airplane-mode
create → appears in Library and picker → log a set → card shows session + PR → edit name →
delete → gone from Library and picker, history still names it → reconnect → row in Supabase with
`deleted_at`; form and section at phone width.

**Earlier:** B30 library-card-history (LIB-4), B29 library-filters-and-detail (LIB-1, LIB-3),
B28 share-cards (LOG-8, SOC-6), B27 moderation-and-safety (SOC-8, NFR-7), B26 post-privacy
(YOU-5), B25 profile (YOU-1, YOU-2, YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9),
B23 votes-and-comments (SOC-4, SOC-5), B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post
(LOG-7), B20 posts-and-feed (SOC-1, SOC-3; LOG-13), B19 muscle-map (ANA-3), B18
analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer (TK-5), B16
tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14 edit-delete-workouts
(LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09 logger-screen
(LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06
training-math, B05 auth-and-signup. Details in each plan file.

**B32 export-and-delete-account** (planning now): edge function exporting the user's complete
training data as JSON; delete-account flow through a service-role edge function that removes
the auth user, every row and every storage object. Step DoD: the export contains every workout,
set and PR; after deletion nothing of the user remains. Covers NFR-6 (whose row notes "the
schema cascades on account deletion (verified)"). Depends on B25. Standing inputs for its
planner: two edge functions exist to copy the shape from — `analyze-workout` (user-token,
`_shared/analysis`) and `moderate` (service role + `moderators` check; B27) — plus
`backend/supabase/functions/tests/`; `profiles.id references auth.users on delete cascade`, so
deleting the auth user (admin API, service role) cascades profiles → workouts →
workout_exercises → sets, personal_records, posts, votes, comments, follows, reports, mutes,
blocks, custom `exercises` (owner_id cascade) — the planner must **verify every table's FK**
rather than trust the row note (watch `reports` which B27 made outlive content, `posts.
shared_post_id` cascade, `moderators`), and must handle what SQL cascades do not: storage
objects in the private `post-images` bucket and the public-read `avatars` bucket (list and
remove under the user's prefix before deleting the auth user), and the device: after a
successful delete the app must sign out and wipe `astra.db` and the kv session store (B07's
local store; check whether a wipe helper exists); export is the user's own rows only (RLS does
the scoping if the function runs with the caller's token — prefer that over service role for
the export), as one JSON document — workouts with exercises and sets, personal_records,
custom exercises, workout_analyses, profile, posts the user authored (the row says "complete
training data"; the planner decides whether social rows belong in it and records the reading);
sizing: `expo-sharing` and `expo-file-system` are already available (B28) to hand the JSON to
the OS share sheet, so no new dependency should be needed; delete needs a typed confirmation
in Settings (the account section exists at `app/settings.tsx` with Sign out) and must be
refused offline (service call); the Gate 2 probe is a throwaway auth user with rows in every
table plus one storage object, deleted through the function, then `select count(*)` across
every table and the two buckets → all 0 (the B05 precedent for creating a throwaway user by SQL
insert into `auth.users`, since signup email validation rejects MX-less domains). No new
dependency expected; the ERD changes only if a helper function or policy is added; the
flowchart gains the Settings → Export / Delete paths and the two function data paths; the new
functions deploy with `mcp__supabase__deploy_edge_function` (the B18/B27 precedent). **Spend no
money:** both functions run on the existing free Supabase project.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30 and B31 not yet on it — B31 adds device schema
V11, which the app migrates on open). To update: stop the server (`netstat -ano | findstr
:8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach
main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in B30 or
B31), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest; Gate 2 frees ports 8097 / 8099 and
renders the diagrams with `mmdc` when the builder could not. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 31 (B31); B32 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3,
B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4,
B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6 (≈ $383 for twenty-seven steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B31 first):
sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile;
log a multi-exercise workout, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Share → share sheet → post the PNG to another app and judge it →
Next → Post / Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle and
Privacy; Tool Kit calculators and timer; Home → Latest / Hot and a flair chip → Share a photo →
vote / comment → make a post private → ⋯ Report → an author's profile → Follow, Re-share their
post (a follower of yours sees it), Mute, Block → unblock; Find lifters; Library → a muscle chip
and an equipment chip (header room at phone width?) → tap a card → detail legibility → PRs and
sessions under the Tips, Show older sessions → New exercise in airplane mode → it appears in
Library and picker → log a set → its card → edit → delete → history keeps the name → reconnect →
rows (incl. the `deleted_at` custom) and objects in Supabase; sign out. Flips B05–B31 and their
features to Done as each holds. (2) **Moderation:** pick an appeal email for
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
empty on purpose, no detail link from the logger's picker (B29); PRs below the coaching content
on the card, history screen kept as the logger's deep link, grow-the-limit show-more (B30);
**soft delete for customs** (row kept, hidden from Library and picker, history and PRs keep the
name, a deleted custom's PRs still show in the profile PR list, no undelete), customs never
match a region chip, no create-from-picker, no muscle-map shading for customs (B31).

Next pipeline step after B32 merges: **B33** is Blocked (video provider) — the pipeline's
"Pick next item" skips Blocked steps; check the Build order table for the next runnable one.
