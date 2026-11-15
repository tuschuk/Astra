# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B22 merged; pipeline on B23)

**Eighteen pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer has posts (workout, progress pic, PR photo), flairs, the Home feed,
follows, finish-to-post and image upload through a private Storage bucket. The pipeline is
running **B23 votes-and-comments**. Gates are delegated to the session (CLAUDE.md, "Autonomous
sessions"). Tristen's hands-on list is at the end.

**B22 image-posts (merged, Gate 2 record):** migration `20261115105852_post_images.sql` (applied
live, confirmed at Gate 2): `posts.kind` (`workout` / `progress-pic` / `pr`), `workout_id` nullable,
`image_path`, CHECKs `posts_kind_shape`, `posts_image_in_own_folder` (closes the cite-someone-
else's-object leak), `posts_progress_pic_private` (B26 relaxes it when the choice exists);
insert / update policies allow a null workout; private bucket `post-images` (10 MiB
`file_size_limit`, jpeg/png/webp) with four `storage.objects` policies (own-folder insert /
update / delete; select = owner or anyone the citing post is visible to via
`private.workout_visible`). Gate 2 also confirmed an anonymous read is refused and the bucket is
not exposed on the public endpoint. App: device schema V9 rebuilds `posts`; `mediaLimits.ts`
(the cap and its one refusal sentence, size rounded up); `postImages.ts` (document-dir copy,
streamed upload with `x-upsert`, authenticated image source with Bearer + apikey);
`createImagePost`; `pushPostsPhase` uploads the object before the row and settles-drops only
unsendable posts; feed left-embeds workouts and the card renders image bodies; `app/new-post.tsx`
(Share a photo). New deps: `expo-image-picker`, `expo-file-system` (free). Builder's rolled-back
two-user probe passed every privacy case. Gate 2 reran in order: regenerate typed routes → `tsc`
clean → lint clean → Jest 90 suites / 970 tests on a cold cache. Statuses: B22 Built; SOC-2,
NFR-4, NFR-5 In progress (video type B33; video limits B33; visibility choice B26, recovery
B54). Not exercised live: a real signed-in Storage upload, the bucket refusing a >10 MiB HTTP
upload, iOS picker returning JPEG not HEIC, Bearer-header `<Image>` rendering (fallback = signed
URLs behind `postImageSource`) — all in the device check.

**Earlier:** B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1, SOC-3; SOC-7 part; LOG-13),
B19 muscle-map (ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17
tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14
edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes
(LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09
logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync
(FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B23 votes-and-comments** (planning now): `votes` (one per user per post, net score view) and
`comments` tables with RLS; no downvote control on Physique Check posts and a database check that
rejects one. DoD: scores tally correctly and a downvote on a Physique Check post is refused by
the API. Standing inputs for its planner: `flairs.upvotes_only` is the data the refusal must read
(never a hard-coded flair name) — a trigger or CHECK joining `posts → flairs`; vote / comment
visibility follows the post's (`private.workout_visible(p.user_id, p.visibility)` through the
post row — one home); votes and comments are server-side reads/writes like the feed (not in the
device mirror; an offline vote is a product call — the B20/B21 precedent is online-only for
reads and outbox for the user's own creations); comments are user text, so length caps mirrored
in one app module; the Physique Check UI simply has no downvote control, and the API refusal is
the enforcement; migrations applied live via MCP and renamed.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Update to the latest main: `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, `npm
ci` in `Astra-main\frontend` (B17 and B22 added native modules), then `npx expo start --lan`.
Currently serving `3c901ad` (through B13).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest; Gate 2 frees ports 8097 / 8099.
Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`,
`trigger`). Executions 4/5 (B05) through 22 (B22); B23 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0 (≈ $249 for eighteen steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Next → Post / Skip; View workout → PR badges; History; Edit and
Delete; Settings → kg toggle; Tool Kit calculators and timer; Home → Share a photo (progress pic
private, PR photo public, >10 MB refused, iPhone picker returns JPEG, images render) → Find
lifters → follow a second test account and see its posts; reconnect → rows and objects in
Supabase; sign out. Flips B05–B22 and their features to Done as each holds. (2) Supabase
Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of record; the
session's toggle was declined by the permission layer). (3) The six external blockers. (4)
Whether to grant `mmdc` (and Deno) to headless runs. (5) Product readings to confirm or
overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM" label on the entry card
and history (B13); muscle shading by max, not volume (B19); one post per workout and own posts
on Home (B20); post visibility inherits the workout's, no caption (B21); progress pics *always*
private until B26, 10 MiB image cap, PR post = photo with the New PR flair (B22).

Next pipeline step after B23 merges: **B24 feed-sort-and-filter**.
