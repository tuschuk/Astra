# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B25 merged; pipeline on B26)

**Twenty-one pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer has posts (workout, progress pic, PR photo), flairs, the Home feed with
Latest / Hot and a flair filter, follows, finish-to-post, image upload, votes, comments and real
profiles. The pipeline is running **B26 post-privacy**. Gates are delegated to the session
(CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B25 profile (merged, Gate 2 record):** migration `20261115130809_profile_reads_and_avatars.sql`
(applied live, confirmed at Gate 2): `public.follow_counts(profile_id)` SECURITY DEFINER,
aggregates only, `search_path` pinned, execute revoked from `anon`; `private.can_view_set(sid)`;
`personal_records` select policy swapped to `user_id = me or can_view_set(source_set_id)`
(owner clause first, sync untouched; builder's four-viewer live matrix: owner 3 / follower 2 /
stranger 1 / blocked 0); public-read `avatars` bucket (5 MiB, jpeg/png/webp) with owner-folder
insert / update / delete and an own-folder select the Storage delete path needs (D1);
`profiles_avatar_in_own_folder` CHECK. App: `components/profile/ProfileView.tsx` shared by the
You tab (rewritten) and `app/profile/[id].tsx` — five header facts, `FollowButton` (extracted
from `UserCard`), Posts / History / PRs tabs (own history and PRs from SQLite and offline,
others online under RLS; history paged to the first workout via a new before-cursor on
`listPastWorkouts`); `app/edit-profile.tsx` (name, username, bio, avatar via picker; 23505 on
the username constraint → "taken"; a newly uploaded avatar is deleted if the row update fails);
`social/{profile,avatars,profileLimits,ownProfileCache}.ts`, `workout/prList.ts` (`groupPrs`,
kept out of the social layer), `Avatar.tsx` used by cards; author header and Find-lifters rows
tap through to profiles. Nine deviations recorded. Gate 2 reran in order: regenerate typed
routes → `tsc` clean → lint clean → Jest 105 suites / 1095 tests on a cold cache. Statuses: B25
Built; YOU-1, YOU-2, YOU-3, SOC-7 Built. Not exercised live: a no-auth fetch of an avatar public
URL and a > 5 MiB avatar refused by the bucket (device check).

**Earlier:** B24 feed-sort-and-filter (SOC-11, SOC-9), B23 votes-and-comments (SOC-4, SOC-5), B22
image-posts (SOC-2, NFR-4, NFR-5 part), B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1,
SOC-3; LOG-13), B19 muscle-map (ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11;
NFR-9 part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15
settings-and-units (LOG-6), B14 edit-delete-workouts (LOG-9), B13 exercise-history-and-prs
(LOG-4, LOG-5), B12 workout-notes (LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10
set-types (LOG-14, LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3),
B07 local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan
file.

**B26 post-privacy** (planning now): per-post private toggle enforced by RLS; privacy section in
Settings for progress-pic and body-data visibility. DoD: a private post is invisible to any
other user through the API, not just hidden in the UI. Standing inputs for its planner: posts
already carry `visibility` (`workout_visibility` enum) and `posts` RLS already enforces it
through `private.workout_visible` — B26 adds the *controls*, not the enforcement; B22's
`posts_progress_pic_private` CHECK locks progress pics to `private` and **B26 is the step that
relaxes it** (a "progress-pic visibility" setting — the planner decides whether that is a
`user_settings` column (`default_workout_visibility` exists on the server but only `unit` is
mirrored; B15's push / pull phases are the pattern) or per-post only); post visibility was set
to inherit the workout's at B21 (G7) — the toggle should keep the two from diverging into the
"public post over private workout = invisible husk" state, or own that state deliberately; the
posts table has owner `update` RLS already (B20), so a private toggle is an `update` of
`visibility` through the user's own post row (online, like votes); **body-data visibility**:
`user_body_data` is owner-only by RLS (B02) and nothing reads it yet — a Settings control with no
reader would be speculative, so the planner should scope "body-data visibility" to what a reader
(B38+ grades, B46 trends) will need and say so; the Storage read policy on `post-images` already
follows the post's visibility, so a toggled-private image post hides its object too — probe it
live; Settings gets its Privacy section (YOU-4's third area); migrations applied live and renamed.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Update to the latest main: `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, `npm
ci` in `Astra-main\frontend`, then `npx expo start --lan`. Currently serving `3c901ad` (through
B13).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest; Gate 2 frees ports 8097 / 8099.
Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`,
`trigger`). Executions 4/5 (B05) through 25 (B25); B26 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5 (≈ $295 for
twenty-one steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile (name,
username, bio, photo; > 5 MB refused; open the avatar's public URL in a browser); log a
multi-exercise workout with every set type and notes, one-tap Repeat, force-kill and Resume;
finish in airplane mode → analysis with muscle map → Next → Post / Skip; View workout → PR
badges; History; Edit and Delete; Settings → kg toggle; Tool Kit calculators and timer; Home →
Latest / Hot and a flair chip (kill and reopen → same choice) → Share a photo → vote / comment →
tap an author → their profile (counts, Posts / History / PRs) → Follow → count moves; Find
lifters; You → History and PRs offline; reconnect → rows and objects in Supabase; sign out.
Flips B05–B25 and their features to Done as each holds. (2) Supabase Dashboard → Authentication →
Providers → Email → turn "Confirm email" off (plan of record; the session's toggle was declined
by the permission layer). (3) The six external blockers. (4) Whether to grant `mmdc` (and Deno)
to headless runs. (5) Product readings to confirm or overrule: no bodyweight rep-record PR book
(B10/B13); the bare "e1RM" label (B13); muscle shading by max (B19); one post per workout and own
posts on Home (B20); post visibility inherits the workout's, no caption (B21); progress pics
always private until B26, 10 MiB cap (B22); votes and comments online-only, 500-char comments
(B23); feed preference per phone, sticky flair filter (B24); public-read avatars, username
editable in Edit profile, a blocked lifter can still read your two counts (B25).

Next pipeline step after B26 merges: **B27 moderation-and-safety**.
