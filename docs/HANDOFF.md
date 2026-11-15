# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B28 merged; pipeline on B29)

**Twenty-four pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built; the social layer is complete through posts, feed, follows, finish-to-post, images, votes,
comments, profiles, privacy, moderation and share cards / re-shares. The pipeline is running
**B29 library-filters-and-detail**, the first of the library steps. Gates are delegated to the
session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B28 share-cards (merged, Gate 2 record):** migrations `20261115154653_reshares.sql` and
`20261115160346_reshare_trigger_columns.sql` (applied live, confirmed at Gate 2):
`posts.shared_post_id` FK (cascade), kind check widened to `reshare`, `posts_kind_shape` widened,
partial unique `(user_id, shared_post_id)`, posts select policy gains `can_view_post(shared_post_id)`
(a re-share is visible only to those who may see both), insert policy requires the original to be
visible, `posts_reshare_shape` trigger (stamps the original's flair, refuses self / chain /
invisible originals, also guards updates of flair / pointer / kind), `post_hot_scores` recreated
with `shared_post_id` (grant, comment, security invoker intact). App: `app/share-card/[id].tsx` +
`components/share/ShareCard.tsx` (4:5 card from `analysisForScreen`, captured 1080×1350 via
`react-native-view-shot`, shared via `expo-sharing`; Share on the analysis screen and on own
workout posts), `social/reshare.ts`, feed reads originals in a **second request by id** (D1 —
the self-embed was refused live in both orders), `PostCard` renders re-shares with the original
embedded and an inline Re-share confirm, `setsSummaryLabel` / `sessionPrLine` moved into
`format.ts` so the card and analysis share one spelling. New deps: `react-native-view-shot`,
`expo-sharing` (free). Builder's three-user live probe covered stamping, double / self / chain
refusals, Physique Check downvote refusal on a re-share, private / mute / delete propagation.
Gate 2 reran in order: regenerate typed routes → `tsc` clean → lint clean → Jest 113 suites /
1205 tests on a cold cache. Statuses: B28 Built; LOG-8, SOC-6 Built. Device-only: whether
view-shot captures in Expo Go and PNG legibility in another app; a signed-in feed read with a
re-share on the page.

**Earlier:** B27 moderation-and-safety (SOC-8, NFR-7), B26 post-privacy (YOU-5), B25 profile
(YOU-1, YOU-2, YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9), B23 votes-and-comments
(SOC-4, SOC-5), B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post (LOG-7), B20
posts-and-feed (SOC-1, SOC-3; LOG-13), B19 muscle-map (ANA-3), B18 analysis-engine (ANA-1,
ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators
(TK-1..4), B15 settings-and-units (LOG-6), B14 edit-delete-workouts (LOG-9), B13
exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09 logger-screen
(LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06
training-math, B05 auth-and-signup. Details in each plan file.

**B29 library-filters-and-detail** (planning now): per-muscle and equipment filters on the Library
tab; exercise detail screen with coaching steps, tips, muscles worked and equipment from the
catalog. DoD: any launch exercise is findable by name, muscle or equipment in a few taps and its
card shows cues and muscles. Standing inputs for its planner: the catalog
(`frontend/src/library/exercises.ts`, 151 exercises with `muscles` intensities, `Equipment`
union, cues) is the one data source — no network, no migration, no new dependency; the Library
tab (`app/(tabs)/library.tsx`) already has cards, name search (`searchExercises`) and body-region
chips (B03) — B29 adds muscle and equipment filters and the detail route; `MUSCLE_NAMES` /
`MUSCLE_ORDER` currently live beside the muscle-map paths (`components/muscleMapPaths.ts`) — B19's
review recorded that they belong beside `MuscleKey` in the library module, and B29 is the natural
step to move them (one home for muscle vocabulary; the map imports from the library, never the
reverse); the detail screen is read-only catalog content (B30 adds the lifter's history to the
card; B31 adds custom exercises); the `ExercisePicker` in the logger may link to the same detail
screen if it is one line, but that is optional; `ChoiceChips` is in `components/ui/`; route
tests live in `src/__tests__/`.

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
`trigger`). Executions 4/5 (B05) through 28 (B28); B29 is next. Reported costs: B05 ≈ $12.1,
B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1,
B27 ≈ $16.4, B28 ≈ $17.1 (≈ $347 for twenty-four steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile; log a
multi-exercise workout, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Share → share sheet → post the PNG to another app and judge it →
Next → Post / Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle and
Privacy; Tool Kit calculators and timer; Home → Latest / Hot and a flair chip → Share a photo →
vote / comment → make a post private → ⋯ Report → an author's profile → Follow, Re-share their
post (a follower of yours sees it), Mute, Block → unblock; Find lifters; reconnect → rows and
objects in Supabase; sign out. Flips B05–B28 and their features to Done as each holds. (2)
**Moderation:** pick an appeal email for `docs/CONTENT_POLICY.md`; call `moderate` once with your
signed-in token on a throwaway post (probe list in DEFERRED). (3) Supabase Dashboard →
Authentication → Providers → Email → turn "Confirm email" off (plan of record; the session's
toggle was declined by the permission layer). (4) The six external blockers. (5) Whether to grant
`mmdc` (and Deno) to headless runs. (6) Product readings to confirm or overrule: no bodyweight
rep-record PR book (B10/B13); the bare "e1RM" label (B13); muscle shading by max (B19); one post
per workout and own posts on Home (B20); post visibility inherits the workout's, no caption
(B21); 10 MiB images, PR post = photo + New PR flair (B22); votes and comments online-only,
500-char comments (B23); feed preference per phone, sticky flair filter (B24); public-read
avatars, username editable (B25); post / workout visibility lockstep, three options, body-data
control deferred (B26); whole-person mute, viewer-relative tallies, reports outlive content
(B27); export own content only, no photo-post export, no re-share chains, re-shares hidden from
their own owner once the original is hidden (B28).

Next pipeline step after B29 merges: **B30 library-card-history**.
