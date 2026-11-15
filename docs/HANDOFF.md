# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B26 merged; B27 built on its branch, awaiting Gate 2)

**Twenty-two pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer has posts (workout, progress pic, PR photo), flairs, the Home feed with
Latest / Hot and a flair filter, follows, finish-to-post, image upload, votes, comments, real
profiles and per-post privacy. **B27 moderation-and-safety is built and committed on branch
`moderation-and-safety`** (not merged). Gates are delegated to the session (CLAUDE.md,
"Autonomous sessions"). Tristen's hands-on list is at the end.

**B27 build record (for Gate 2):** migrations `20261115150035_moderation.sql` and
`20261115151850_reports_not_self.sql`, both **applied live** (versions match `list_migrations`):
`mutes`, `moderators`, `reports` (+ `reports_stamp_reported_user` trigger, `reports_not_self`
CHECK), `private.muted_by_viewer` / `author_visible` / `is_moderator`, `workout_visible`
re-created with the mute clause, votes / comments read policies re-created with author
filtering. **Founder seeded live:** `insert into public.moderators (user_id) values
('41d64fbd-d9cd-4050-92e7-fa3ed2b76262');` (the project's one real account). Edge function
**`moderate` deployed v2**, `verify_jwt` on, from the repo files. App: `social/moderation.ts`,
`ReportSheet`, ⋯ report on others' post cards (Home, profile) and comment rows, Mute / Block on
others' profiles, `docs/CONTENT_POLICY.md`. Live probes (synthetic users, rolled back / deleted):
report stamping, dedupe, ghost and self refusals, moderator-only queue, mute one-way with follows
kept, block both ways with follows cut, third party unaffected, removal cascades in SQL. **Not
probed:** the `moderate` function over HTTP (session's `curl` declined) — see DEFERRED. Checks:
`tsc` clean, lint clean, Jest 110 suites / 1169 tests. Gate 2 should flip SOC-8 to Built with the
note "block cuts DMs lands at B48", and NFR-7 to Built once the HTTP probe passes.

**B26 post-privacy (merged, Gate 2 record):** migration `20261115141242_post_privacy.sql`
(applied live, confirmed at Gate 2): `user_settings.progress_pic_visibility` (default
`private`), B22's `posts_progress_pic_private` CHECK dropped, trigger `sync_workout_visibility`
(after update of `posts.visibility`, invoker rights) keeping a workout post's workout in
lockstep. App: device schema V10 (settings column), `patchUserSettingsTx` so the unit and privacy
settings cannot clobber each other (the `pushUserSettings` update now carries both),
`settings/privacySettings.ts`, `social/postPrivacy.ts` (`setPostVisibility`: scoped online
update, then local `posts` / `workouts` mirror rows updated without outbox lines so a later
offline workout edit cannot push the old visibility back; `VISIBILITY_WORDS` / `VISIBILITY_ORDER`
one home for the wording), owner-only visibility chip with an inline three-option chooser on
`PostCard` (Home and profile Posts), Settings → Privacy (progress-pic default; body data stated
as owner-only, control deferred to the first reader), Share a photo caption reads the setting,
`ChoiceChips` moved to `components/ui/`. Builder's three-user live probe covered private,
followers and reversal for both tables and the storage object. Gate 2 reran in order: regenerate
typed routes → `tsc` clean → lint clean → Jest 107 suites / 1130 tests on a cold cache. Statuses:
B26 Built; YOU-5 Built; NFR-5 In progress (recovery data B54; body-data choice deferred to its
first reader); YOU-4 In progress (Notifications B47).

**Earlier:** B25 profile (YOU-1, YOU-2, YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9),
B23 votes-and-comments (SOC-4, SOC-5), B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post
(LOG-7), B20 posts-and-feed (SOC-1, SOC-3; LOG-13), B19 muscle-map (ANA-3), B18 analysis-engine
(ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators
(TK-1..4), B15 settings-and-units (LOG-6), B14 edit-delete-workouts (LOG-9), B13
exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09 logger-screen
(LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06
training-math, B05 auth-and-signup. Details in each plan file.

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
`trigger`). Executions 4/5 (B05) through 26 (B26); B27 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1
(≈ $314 for twenty-two steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile; log a
multi-exercise workout with every set type and notes, one-tap Repeat, force-kill and Resume;
finish in airplane mode → analysis with muscle map → Next → Post / Skip; View workout → PR
badges; History; Edit and Delete; Settings → kg toggle and Privacy (set Followers offline,
reconnect, post a progress pic, a follower sees it); Tool Kit calculators and timer; Home →
Latest / Hot and a flair chip → Share a photo → vote / comment → make a post private and confirm
it vanishes for a second account, photo included → tap an author → their profile → Follow; Find
lifters; reconnect → rows and objects in Supabase; sign out. Flips B05–B26 and their features to
Done as each holds. (2) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm
email" off (plan of record; the session's toggle was declined by the permission layer). (3) The
six external blockers. (4) Whether to grant `mmdc` (and Deno) to headless runs. (5) Product
readings to confirm or overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM"
label (B13); muscle shading by max (B19); one post per workout and own posts on Home (B20); post
visibility inherits the workout's, no caption (B21); 10 MiB images, PR post = photo + New PR
flair (B22); votes and comments online-only, 500-char comments (B23); feed preference per phone,
sticky flair filter (B24); public-read avatars, username editable, blocked lifters can read your
counts (B25); post and workout visibility in lockstep, three options not two, body-data control
deferred (B26); whole-content mute, per-viewer vote tallies, the six report reasons, and an appeal
email address for the content policy (B27). (6) B27 device check: report a post and a comment
from a second account (rows in `reports`), mute then block that account from its profile and
confirm its posts and comments vanish; then call `moderate` with your own token to remove a post.

Next pipeline step after B27 merges: **B28 share-cards**.
