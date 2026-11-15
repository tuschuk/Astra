# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B27 merged; pipeline on B28)

**Twenty-three pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer has posts, flairs, the Home feed, follows, finish-to-post, image upload,
votes, comments, profiles, per-post privacy and now moderation. The pipeline is running **B28
share-cards**. Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's
hands-on list is at the end.

**B27 moderation-and-safety (merged, Gate 2 record):** migrations
`20261115150035_moderation.sql` and `20261115151850_reports_not_self.sql` (applied live,
confirmed at Gate 2): `mutes` (owner-managed), `moderators` (self-select only; **Tristen's
profile row seeded live by the builder** — the statement with the id is in the B27 plan's build
record / the previous HANDOFF revision in git), `reports` (audit queue, no FK to content,
`reported_user_id` stamped by trigger, self-reports refused, moderator-read, visibility-gated
insert), `private.muted_by_viewer` folded into `private.workout_visible` (one home), new
`private.author_visible` on the `votes` and `comments` select policies. `moderate` edge function
(B18 shape, deployed v2, `verify_jwt` on; remove-post / remove-comment / remove-account,
moderator-only, 409 on a moderator target; Gate 2 confirmed no-token and anon-key calls get
401). App: ⋯ report sheet on others' cards and comments (six reasons mirroring
`docs/CONTENT_POLICY.md`), Mute / Block on others' profiles, `social/moderation.ts`. Builder's
three-user live probes covered reports, mute (one-directional, follow kept), block (both ways,
follows cut), and removal effects in SQL. Gate 2 reran in order: regenerate typed routes → `tsc`
clean → lint clean → Jest 110 suites / 1169 tests on a cold cache. Statuses: B27 Built; SOC-8
Built (DM clause at B48); NFR-7 Built (first signed-in removal call = Done). **Tristen owns:**
the appeal address in the content policy, and the first real `moderate` call with his token.

**Earlier:** B26 post-privacy (YOU-5), B25 profile (YOU-1, YOU-2, YOU-3, SOC-7), B24
feed-sort-and-filter (SOC-11, SOC-9), B23 votes-and-comments (SOC-4, SOC-5), B22 image-posts
(SOC-2, NFR-4 part), B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1, SOC-3; LOG-13), B19
muscle-map (ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17
tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14
edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes
(LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09
logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync
(FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B28 share-cards** (planning now): Strava-style workout image card rendered on device and sent
to the OS share sheet; in-app re-share of a post. DoD: the card posts legibly to another app and a
re-share appears in followers' feeds. Standing inputs for its planner: no share module is
installed yet — `react-native-view-shot` (capture a view to an image) and `expo-sharing` (OS
share sheet) are free; install only what is used and verify they work in Expo Go; the card's
numbers come from the analysis / summary (`@training-math` via the shared analysis module) and
`format.ts` — no new math, no new spelling; weights in the sharer's unit via `displayWeight`;
any performance copy on the card follows the citation / estimate rule (the card should state
facts, not claims); **in-app re-share** needs a schema decision — `posts.workout_id` is `unique`
(one post per workout, B20) and `posts_kind_shape` requires a kind-specific body, so a re-share is
most honestly a new post kind (`kind = 'reshare'` with a `shared_post_id` FK and the shape CHECK
widened by migration) whose visibility follows the original through the one helper (a re-share
of a post you can no longer see must disappear too) — the planner decides and keeps RLS as the
enforcement; re-shares render through `PostCard` by embedding the original; the share sheet
export carries no private data beyond what the sharer chooses (it is their own card); migrations
applied live and renamed; three-user live probe for the re-share visibility rule.

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
`trigger`). Executions 4/5 (B05) through 27 (B27); B28 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1,
B27 ≈ $16.4 (≈ $330 for twenty-three steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile; log a
multi-exercise workout, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Next → Post / Skip; View workout → PR badges; History; Edit and
Delete; Settings → kg toggle and Privacy; Tool Kit calculators and timer; Home → Latest / Hot
and a flair chip → Share a photo → vote / comment → make a post private → ⋯ Report a post and a
comment (then read them in the dashboard `reports` table) → an author's profile → Follow, Mute,
Block (content disappears, follow cut) → unblock; Find lifters; reconnect → rows and objects in
Supabase; sign out. Flips B05–B27 and their features to Done as each holds. (2) **Moderation:**
pick an appeal email for `docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in
token (remove a throwaway post) to prove the HTTP path — the plan's probe list is in DEFERRED.
(3) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of
record; the session's toggle was declined by the permission layer). (4) The six external
blockers. (5) Whether to grant `mmdc` (and Deno) to headless runs. (6) Product readings to
confirm or overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM" label (B13);
muscle shading by max (B19); one post per workout and own posts on Home (B20); post visibility
inherits the workout's, no caption (B21); 10 MiB images, PR post = photo + New PR flair (B22);
votes and comments online-only, 500-char comments (B23); feed preference per phone, sticky flair
filter (B24); public-read avatars, username editable, blocked lifters can read your counts (B25);
post and workout visibility in lockstep, three options, body-data control deferred (B26); mute
hides the whole person's content (not feed-only) and makes vote tallies viewer-relative where
blocks / mutes exist; reports have no FK to content and survive its deletion (B27).

Next pipeline step after B28 merges: **B29 library-filters-and-detail**.
