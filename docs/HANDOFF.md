# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B21 merged; pipeline on B22)

**Seventeen pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer has posts, flairs, the Home feed, follows and the finish-to-post flow.
The pipeline is running **B22 image-posts**, the first Supabase Storage step. Gates are
delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the
end.

**B21 finish-to-post (merged, Gate 2 record):** no server migration. Finish replaces to
`/analysis/[id]?post=1` (finish mode shows **Next**; old workouts never re-offer); Next pushes
`app/post-workout/[id].tsx` — flair chips from the device `flairs` mirror (pull-only, replace-all,
refreshed last in each pull, failure non-fatal and recorded as `PullResult.flairsError`), Post or
Skip. `social/createPost.ts` writes the device `posts` row + outbox line in one transaction
(id from `lib/ids.ts`, visibility inherited from the workout, refuses unfinished / foreign /
already-posted / unknown-flair) and `notifyLocalWrite`. Device schema V8 (`flairs`, `posts` with
`unique (workout_id)`); `OutboxTable` gains `'posts'`; `pushPostsPhase` runs after the settings
phase (so a post can never precede its workout), maps 23505 to "another device posted" and drops
the local row; `deletePostsTx` keeps the queue clean on local delete **and** tombstone (builder
extended the plan). Eight deviations recorded, all tightenings. Gate 2 reran in order: regenerate
typed routes → `tsc` clean → lint clean → Jest 87 suites / 928 tests on a cold cache. Statuses:
B21 Built; LOG-7 Built. Not yet exercised through the real REST API with a user token: the
`posts` upsert path and the `flairs` select (device check).

**Earlier:** B20 posts-and-feed (SOC-1, SOC-3; SOC-7 part; LOG-13 closed), B19 muscle-map
(ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer
(TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14
edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes
(LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09
logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync
(FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B22 image-posts** (planning now): Supabase Storage bucket for post images with RLS; size cap
enforced on device and by bucket policy; background upload with retry; progress-pic and PR post
types; progress pics private by default (per-user visibility setting arrives in B26). DoD: an
over-limit image is rejected with a clear message and an accepted one uploads while the user
keeps using the app. Standing inputs for its planner: **spend no money** — Supabase Storage on
the existing free tier only, no CDN add-on, no image service; no media module is installed yet
(`expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-image` are all free
Expo modules — install only what is used); B20 left `posts.workout_id not null` and no `kind`
column for B22 to relax by migration when the second post type exists; a bucket is created by
migration (`insert into storage.buckets` + `storage.objects` policies, applied live via MCP and
renamed to the recorded version), and the object path must encode the owner so RLS can gate it;
**progress pics are sensitive (CLAUDE.md privacy rule)**: private-by-default enforced by Storage
RLS and post RLS, never client-side only, and the Physique Check flair stays upvotes-only (B23
reads `flairs.upvotes_only`); "background upload with retry" should ride the existing outbox /
engine pattern (an upload phase, idempotent by object path), not a new scheduler; the feed card
(B20) renders images for the new types; form-check *video* stays blocked (B33).

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
`trigger`). Executions 4/5 (B05) through 21 (B21); B22 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4 (≈ $232 for seventeen steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Next → Post step → Post (lands once after reconnecting) / Skip; View
workout → PR badges; History; Edit and Delete; Settings → kg toggle; Tool Kit calculators and
timer; Home → Find lifters → follow a second test account and see its post; reconnect → rows in
Supabase; sign out. Flips B05–B21 and their features to Done as each holds. (2) Supabase
Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of record; the
session's toggle was declined by the permission layer). (3) The six external blockers. (4)
Whether to grant `mmdc` (and Deno) to headless runs. (5) Product readings to confirm or
overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM" label on the entry card
and history (B13); muscle shading by max, not volume (B19); one post per workout and own posts
on Home (B20); post visibility inherits the workout's, no caption (B21).

Next pipeline step after B22 merges: **B23 votes-and-comments**.
