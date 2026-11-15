# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B24 merged; pipeline on B25)

**Twenty pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer has posts (workout, progress pic, PR photo), flairs, the Home feed with
Latest / Hot and a flair filter, follows, finish-to-post, image upload, votes and comments. The
pipeline is running **B25 profile**. Gates are delegated to the session (CLAUDE.md, "Autonomous
sessions"). Tristen's hands-on list is at the end.

**B24 feed-sort-and-filter (merged, Gate 2 record):** migration
`20261115122437_post_hot_scores.sql` (applied live, confirmed at Gate 2): `post_hot_scores`
security-invoker view carrying the feed's full column contract plus `hot_score` = Reddit's
published hot formula (cited in the SQL; Gate 2 checked the ordering property directly: 3 votes
at 1 h > 0 votes now > 10 votes at 13 h > 0 votes at 2 h). App: `social/feedPrefs.ts` (sort +
flair per user in the device key-value store, hydrated before the first request),
`loadFeedPage(client, me, authors, sort, flairId, after)` with sort-tagged keyset cursors
(`latest` on created_at/id, `hot` on hot_score/id) and one flair clause in both orders; Hot
reads the view with the same `FEED_SELECT` — the author embed now names its FK
(`profiles!posts_user_id_fkey`) because the view made `profiles` reachable two ways (D1; the
fallback was not needed); Home gained Latest / Hot chips, a flair chip row from the device mirror
(stale id → All), a filtered-empty state with "Show all posts", and a list shown only under the
chips it was loaded for. Gate 2 reran in order: regenerate typed routes → `tsc` clean → lint
clean → Jest 95 suites / 1033 tests on a cold cache. Statuses: B24 Built; SOC-11, SOC-9 Built.
Still open from the plan: `explain analyze` on the ranked read once real accounts have votes
(rewrite if slow = lateral per-post sums, view body only).

**Earlier:** B23 votes-and-comments (SOC-4, SOC-5), B22 image-posts (SOC-2, NFR-4, NFR-5 part),
B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1, SOC-3; SOC-7 part; LOG-13), B19
muscle-map (ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17
tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14
edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes
(LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09
logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync
(FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B25 profile (built on branch `profile`, awaiting Gate 2):** migration
`20261115130809_profile_reads_and_avatars.sql` applied live — `public.follow_counts(profile_id)`
(security definer, two counts only, execute for `authenticated`), `personal_records` select widened
to "own, or the source set's workout is visible to you" (`private.can_view_set` →
`can_view_workout`), a public-read `avatars` bucket (5 MiB, jpeg/png/webp, owner-folder writes +
an owner-folder select so deletes work — deviation D1), and the `profiles_avatar_in_own_folder`
CHECK. Probed live at build (rolled back): PR matrix owner 3 / follower 2 / stranger 1 / blocked 0,
counts = `count(*)` for every viewer, anon refused, foreign folder refused (CHECK and 42501). Not
probed: the no-auth public URL fetch and an over-limit upload (need a real upload — Gate 2 or the
device run). App: the You tab and `profile/[id]` share `ProfileView` (five facts, Follow with a
count re-read, Posts / History / PRs tabs; own History + PRs from SQLite, others' online);
`edit-profile` (name, username, bio, photo). Builder's checks: typed routes regenerated → `tsc`
clean → lint clean → Jest 105 suites / 1095 tests. Plan deviations D1–D9 are in the plan file.

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
`trigger`). Executions 4/5 (B05) through 24 (B24); B25 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4 (≈ $274 for twenty steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Next → Post / Skip; View workout → PR badges; History; Edit and
Delete; Settings → kg toggle; Tool Kit calculators and timer; Home → Latest / Hot and a flair
chip (kill and reopen → same choice) → Share a photo → vote / comment → Find lifters → follow a
second test account; reconnect → rows and objects in Supabase; sign out. Flips B05–B24 and
their features to Done as each holds. (2) Supabase Dashboard → Authentication → Providers →
Email → turn "Confirm email" off (plan of record; the session's toggle was declined by the
permission layer). (3) The six external blockers. (4) Whether to grant `mmdc` (and Deno) to
headless runs. (5) Product readings to confirm or overrule: no bodyweight rep-record PR book
(B10/B13); the bare "e1RM" label (B13); muscle shading by max (B19); one post per workout and own
posts on Home (B20); post visibility inherits the workout's, no caption (B21); PRs on a profile follow the
source workout's visibility, avatars are public, blocked lifters still see counts (B25); progress pics
always private until B26, 10 MiB cap (B22); votes and comments online-only, 500-char comments,
individual votes visible to post viewers (B23); feed preference kept per phone, not roamed; the
flair filter is sticky (B24).

Next pipeline step after B25 merges: **B26 post-privacy**.
