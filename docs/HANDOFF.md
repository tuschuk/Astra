# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B23 merged; pipeline on B24)

**Nineteen pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer has posts (workout, progress pic, PR photo), flairs, the Home feed,
follows, finish-to-post, image upload, votes with a net score and comments. The pipeline is
running **B24 feed-sort-and-filter**. Gates are delegated to the session (CLAUDE.md,
"Autonomous sessions"). Tristen's hands-on list is at the end.

**B23 votes-and-comments (merged, Gate 2 record):** migrations `20261115114409_votes_comments.sql`
and `20261115115739_comments_body_not_blank.sql` (applied live, confirmed at Gate 2): `votes`
(PK `(post_id, user_id)`, value ±1), `comments` (flat, oldest-first, CHECK 1–500 chars with a
visible character), `post_scores` security-invoker view (score + comment_count),
`private.can_view_post(pid)` (visibility through the post row → `workout_visible`),
`votes_upvote_only` trigger on insert **and** update reading `flairs.upvotes_only`,
`posts_flair_guard` against retagging a downvoted post. RLS: 4 vote + 3 comment policies, no
comment update. App: `social/votes.ts` (upsert on the PK, P0001 → typed refusal, `nextVote` /
`voteDelta`), `social/comments.ts`, `social/commentLimits.ts` (the cap's one app home), feed reads
`my_vote` as a filtered alias embed and scores in a **second request by post ids** (D1 — live
PostgREST refused embedding the view, the plan's listed fallback), `PostFooter` on the card (no
down arrow when the flair row says upvotes-only), `app/post-comments/[id].tsx`. Online-only by
decision (no mirror, no outbox). Builder's rolled-back live probes covered tallies, every
downvote path, block / followers rules. Gate 2 reran in order: regenerate typed routes → `tsc`
clean → lint clean → Jest 94 suites / 1008 tests on a cold cache. Statuses: B23 Built; SOC-4,
SOC-5 Built.

**Earlier:** B22 image-posts (SOC-2, NFR-4, NFR-5 part), B21 finish-to-post (LOG-7), B20
posts-and-feed (SOC-1, SOC-3; SOC-7 part; LOG-13), B19 muscle-map (ANA-3), B18 analysis-engine
(ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators
(TK-1..4), B15 settings-and-units (LOG-6), B14 edit-delete-workouts (LOG-9), B13
exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09 logger-screen
(LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06
training-math, B05 auth-and-signup. Details in each plan file.

**B24 feed-sort-and-filter** (planning now): chronological / ranked toggle (Reddit-style hot
score in a Postgres view) persisted per user; filter the feed by flair (SOC-9 pulled forward).
DoD: toggle and filter change the results and survive relaunch. Standing inputs for its
planner: the hot score is **training-adjacent math only in the sense of being a formula** — it is
a ranking formula with one home in the Postgres view, and any published formula it borrows is
cited in a code comment (CLAUDE.md's citation rule is about product copy, but one home still
holds); `post_scores` sums every vote before filtering and B23 recorded "measure when B24 builds
the hot view"; `user_settings` has `unit` and `default_workout_visibility` on the server but the
device mirror (B15, schema V6) carries only `unit` — persisting the sort per user means either a
new `user_settings` column + mirror + the B15 push/pull phase, or a device-only preference (the
plate-rack precedent, kv-store) — the planner decides against "nothing speculative" and the
DoD's "survive relaunch" (device-only satisfies it); the flair filter is one query clause
(`flair_id = …`) over rows, names from data; PostgREST would not embed `post_scores` (B23 D1), so
a ranked feed likely reads the view / a new view directly rather than embedding; B20's keyset
pagination must keep working under a ranked order (hot score + id tiebreak).

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
`trigger`). Executions 4/5 (B05) through 23 (B23); B24 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6 (≈ $262 for nineteen steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Next → Post / Skip; View workout → PR badges; History; Edit and
Delete; Settings → kg toggle; Tool Kit calculators and timer; Home → Share a photo (progress pic
private, PR photo public, >10 MB refused, iPhone picker returns JPEG, images render) → vote
up / down / unvote (Physique Check shows no down arrow) → Comment → Find lifters → follow a
second test account, see and comment on its posts; reconnect → rows and objects in Supabase;
sign out. Flips B05–B23 and their features to Done as each holds. (2) Supabase Dashboard →
Authentication → Providers → Email → turn "Confirm email" off (plan of record; the session's
toggle was declined by the permission layer). (3) The six external blockers. (4) Whether to
grant `mmdc` (and Deno) to headless runs. (5) Product readings to confirm or overrule: no
bodyweight rep-record PR book (B10/B13); the bare "e1RM" label (B13); muscle shading by max
(B19); one post per workout and own posts on Home (B20); post visibility inherits the workout's,
no caption (B21); progress pics always private until B26, 10 MiB cap, PR post = photo + New PR
flair (B22); votes and comments online-only, 500-char comments, individual votes visible to
anyone who sees the post (B23).

Next pipeline step after B24 merges: **B25 profile**.
