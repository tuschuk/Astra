# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B41 merged; pipeline on B42)

**Thirty-six pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2 has programs, runs, the Teams family,
program visibility and the whole Marketplace (browse, program page, Save and Start, featured,
votes, comments). The pipeline is running **B42 trend-analysis**. Gates are delegated to the
session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B41 marketplace-featured (merged, Gate 2 record):** two migrations applied live and confirmed:
`20261116012712_program_votes_comments.sql` — helpers `private.can_view_program(pid)` (mirrors
`can_view_post` over the B39 `program_visible` rule) and `private.program_published(pid)` (the
write gate); `program_votes (program_id, user_id) value in (-1, 1)` and `program_comments (body
1–500, not blank — the same `commentLimits.ts` module as post comments)`, `moddatetime`
triggers; inserts and vote changes only on **published, live** programs and only as yourself,
deletes owner-only; `program_scores` security-invoker view (every visible program with `score`,
`score_week`, `score_month`, `score_year` as rolling 7 / 30 / 365-day net-vote sums,
`comment_count`, plus the Marketplace read's columns so the shelf reads through the view with
the author embed). `20261116015334_program_social_reads.sql` (builder, from its own finding and
review) — select policies gain `or own row` and `private.author_visible(user_id)` so blocked /
muted lifters' votes and comments drop out like posts', and own-row deletes work after an
unpublish. App: `votes.ts` and `comments.ts` extended by internal parameterisation
(`castProgramVote`, `clearProgramVote`, `loadProgramComments`, `addProgramComment`);
`marketplace.ts` gains `loadFeaturedPrograms` (`FEATURED_WINDOW_COLUMNS`, `FEATURED_LIMIT = 10`)
and `loadProgramPage(client, me, id)` with score, comment count and the viewer's own vote;
`components/social/VoteControl.tsx` (the optimistic arrows extracted from `PostFooter`, used by
posts and the program page) and `CommentsPane.tsx` (the list + composer extracted from the post
comments screen, used by both comments routes); Marketplace tab gains the **Featured** section
(Week · Month · Year · All time chips, top 10 with scores, shown only with a blank search, hidden
when nothing is published, re-read on focus); the program page gains the social row on
published programs only; new route `app/program-comments/[id].tsx` with no report affordance.
**Gate 2 probes:** SQL (rolled back; planted votes 8 / 40 / 400 days back) — P1 scores 2 / 3 /
4 / 5 across week / month / year / all against P2's 1 / 1 / 1 / 1; a flipped vote moves every
window containing it by two and reverses the week ranking (`b_flip_rows` 1); editing another
user's vote or comment changes 0 rows; a private program's comments and score row are
invisible to others; voting or commenting on a private program → 42501; blank and 501-char
comments → 23514; changing a vote after unpublish → 42501 (the UPDATE check refuses); blocking a
user drops their vote and comment (2 → 1 votes, 1 → 0 comments); own vote delete after
unpublish → 1 row. **HTTP API pass with real throwaway JWTs** (rows cleaned up): vote and
comment on a published program → 201, on a private one → 403 / 42501, voting as someone else →
403, un-vote → 200, the featured read **through the view with the author embed** → 200 ranked
rows (the plan's fallback was not needed), anon view read → `[]`. Gate 2 reran in order:
regenerate typed routes → `tsc` clean → lint clean → Jest 158 suites / 1646 tests on a cold
cache at default workers; `mmdc` rendered both diagrams (OK). Statuses: B41 Built; MKT-2, MKT-3
Built. Device-only: account B upvotes A's published program (arrow lights, survives leaving and
reopening), comments, A reads it; Featured → Week shows it with its score, the chips switch
windows, after B un-votes the score drops on next focus; airplane mode → connection messages.
**Product calls recorded:** votes and comments only on published programs; downvotes allowed
(programs have no flair); rolling windows rather than calendar ones; a flipped vote keeps its
original timestamp (not gameable into "this week"); top 10; no vote arrows on cards; reporting
program comments deferred (the `reports` CHECK is posts / comments only — founder recourse is
the dashboard until a moderation follow-up); no realtime (focus re-read). **Hygiene noted:** the
three score views (`post_scores`, `post_hot_scores`, `program_scores`) carry Supabase's default
full table grant to `anon` and `authenticated` rather than SELECT only — harmless (non-updatable
joins, invoker RLS underneath, anon reads `[]`) but a one-line `revoke all … grant select` tidy
for a later migration.

**Earlier:** B40 marketplace-browse (MKT-1, MKT-4, MKT-5), B39 program-visibility (PRG-4), B38
team-moderation (TEAM-4), B37 team-coaching (TEAM-3, TEAM-5), B36 teams (TEAM-1, TEAM-2; SOC-10
/ YOU-6 Teams halves), B35 run-program (PRG-3, LOG-1), B34 program-builder (PRG-1, PRG-2), B32
export-and-delete-account (NFR-6), B31 custom-exercises (LIB-5), B30 library-card-history
(LIB-4), B29 library-filters-and-detail (LIB-1, LIB-3), B28 share-cards (LOG-8, SOC-6), B27
moderation-and-safety (SOC-8, NFR-7), B26 post-privacy (YOU-5), B25 profile (YOU-1, YOU-2,
YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9), B23 votes-and-comments (SOC-4, SOC-5),
B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1,
SOC-3; LOG-13), B19 muscle-map (ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9
part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units
(LOG-6), B14 edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12
workout-notes (LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14,
LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07
local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B42 trend-analysis** (planning now): the analysis compares the session's volume and intensity
(using RPE when present) against the user's rolling history once enough sessions exist. Step
DoD: the section is absent below the threshold and its numbers match history above it. Covers
ANA-5 (Not started) and completes LOG-10 (In progress — the RPE box shipped in B10; "the
intensity analysis that reads it is B42"). Depends on B18. Standing inputs for its planner:
**the analysis engine has one home** — `backend/supabase/functions/_shared/analysis/`
(`analysis.ts` with `buildAnalysis(input)` and `ANALYSIS_ENGINE_VERSION = 1`, `summary.ts`
for the numbers, `copy.ts` for the words, `muscles.ts` for the map) is run by the deployed
`analyze-workout` edge function **and** by the phone (`frontend/src/analysis/analysis.ts`
imports the same module so the analysis screen works offline) — any trend rule lives there,
deterministic, **no AI**, and raises the engine version; `workout_analyses` rows (id = workout
id, `engine_version`, `total_volume_kg`, `total_sets`, `working_sets`, `duration_seconds`,
`new_prs`, `headline`, `message`, `workout_updated_at`) are owner-read, function-written, and
mirrored to the device; the planner must settle: (a) **what "rolling history" means** — the
lifter's previous N finished workouts (or a time window) read from the device database (offline
path) and from the server (function path) through one shared query shape; the **threshold**
below which the section is absent (a named constant with a one-line published-source
rationale if any number is claimed in copy — CLAUDE.md's rule that every numeric performance
claim cites a source and is worded as an estimate); (b) **intensity** — with RPE present, mean
RPE of working sets (and/or e1RM-relative load through the `@training-math` e1RM — the one
home); without RPE, intensity falls back to load-relative measures or the intensity line is
omitted ("still works when absent" is LOG-10's DoD); (c) the comparison itself — this session's
volume and intensity versus the rolling mean (or median) as a percentage delta, worded as an
estimate, with the four-state copy pattern from B18 extended rather than copied; (d) **where the
history comes from on each path** — the phone has the lifter's finished workouts in `astra.db`
(B13's `exerciseSessions` / history reads are the precedent); the edge function reads
`workouts` + `sets` for the caller through its token (the `analyze-workout` handler already
reads the workout tree — it gains a bounded history read, paged); both paths must produce
identical numbers (a Jest test over one fixture history pins it — the step DoD "its numbers
match history"); (e) **storage** — whether the trend numbers are new columns on
`workout_analyses` (a migration, mirrored on the device V15, `TABLE_COLUMNS`) or live inside a
jsonb `trend` column; a new column set is the honest shape for later readers (B44 deload rules,
B46 profile trends); (f) **recompute** — a bumped `ANALYSIS_ENGINE_VERSION` lets old rows be told
apart; the analysis screen shows the trend section only when the row carries it; (g) the Gate 2
probe — seed a throwaway user with N+1 finished workouts via SQL, call `analyze-workout` over
HTTP with its JWT, and check the trend fields against a hand computation; below the threshold
the fields are null / absent. No new dependency expected; the ERD gains the columns; the
flowchart gains the trend section and its data path. After B42: B43 tool-kit-prefill (TK-6),
then B44 is Blocked, B45 Blocked, B46 profile-trends (depends on B42).

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B41 not yet on it — B31, B34, B35 and B39 add
device schema V11–V14, migrated on open). To update: stop the server (`netstat -ano | findstr
:8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach
main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in
B30–B41), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps. Check order: `expo start --offline` ~150 s → `tsc`
→ lint → Jest; Gate 2 frees ports 8097–8099, renders the diagrams with `mmdc`, and runs live
HTTP probes through the PowerShell tool with the throwaway-JWT recipe (both recorded in
PIPELINE.md; persistent probe rows are deleted afterwards). A probe note: an UPDATE whose RLS
`with check` fails raises 42501 instead of updating zero rows, so put such cases in their own
rolled-back call. Builders have hit Jest 30 s timeouts under full-suite load at default workers
and rerun with `--maxWorkers=50%`; Gate 2's cold-cache default-worker runs have passed every
time. Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry
<id>`, `trigger`). Executions 4/5 (B05) through 40 (B41); B42 is next. Reported costs: B05 ≈
$12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1,
B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9,
B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6, B39 ≈ $14.5, B40 ≈ $13.9, B41 ≈ $18.9
(≈ $536 for thirty-six steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B41 first):
sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile;
log a multi-exercise workout, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Share → share sheet → post the PNG to another app and judge it →
Next → Post / Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle,
Privacy, Export your data (share sheet → open the JSON elsewhere); Tool Kit calculators and
timer; Home → Latest / Hot and a flair chip → Share a photo → vote / comment → make a post
private → ⋯ Report → an author's profile → Follow, Re-share their post (a follower of yours sees
it), Mute, Block → unblock; Find lifters; Library → a muscle chip and an equipment chip → tap a
card → detail → PRs and sessions under the Tips, Show older sessions → New exercise in airplane
mode → it appears in Library and picker → log a set → its card → edit → delete → history keeps
the name; Workout → Your programs → New program → weeks / workouts / exercises with targets →
kill → reopen intact → Who can see this: each chip in airplane mode, kill, reopen (sticks) →
reconnect (column in Supabase) → Team → tick a team (share row in Supabase) → Published; Workout
→ Start from a program → run card → Start next session → finish → next session offered → Stop;
Communities → Create a team (open) → second account joins → Team feed and Home chips → switch to
Invite only → Invite → join via invite → profile Teams section; owner → Make coach on the second
account; coach → Announce, push a program (member Saves it), push a workout (member Starts it),
Assign a program (member taps Start → Workout tab shows the run); coach opens the member's
profile → History shows a private workout → tap → full session; owner → Hide from Team feed on
the member's post → Unhide → Remove from team → cannot rejoin once invite-only → Remove a push →
Delete team; second account → Marketplace → the published program is listed → search a word of
its name → tap → author / weeks / days per week / breakdown → **upvote (arrow lights, survives
leaving and reopening) → comment → A reads it → Featured → Week shows it with its score → chips
switch windows → un-vote → score drops on next focus** → Save and Start → Workout tab shows the
run → Start next session opens Day 1 with targets; Marketplace and the comments screen in
airplane mode → connection messages; reconnect → rows and objects in Supabase; sign out; with a
throwaway account: Settings → Delete account → type DELETE → lands on sign-in, the email no
longer signs in, a reopened app has an empty device database. Flips B05–B41 and their features
to Done as each holds. (2) **Moderation:** pick an appeal email for `docs/CONTENT_POLICY.md`;
call `moderate` once with your signed-in token on a throwaway post (probe list in DEFERRED).
(3) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of
record; the session's toggle was declined by the permission layer). (4) The six external
blockers — B33 video provider is the step the pipeline skipped. (5) Whether to grant `mmdc`
(and Deno) to headless runs. (6) Product readings to confirm or overrule: no bodyweight
rep-record PR book (B10/B13); the bare "e1RM" label (B13); muscle shading by max (B19); one
post per workout and own posts on Home (B20); post visibility inherits the workout's, no caption
(B21); 10 MiB images, PR post = photo + New PR flair (B22); votes and comments online-only,
500-char comments (B23); feed preference per phone, sticky flair filter (B24); public-read
avatars, username editable (B25); post / workout visibility lockstep, three options, body-data
control deferred (B26); whole-person mute, viewer-relative tallies, reports outlive content
(B27); export own content only, no photo-post export, no re-share chains, re-shares hidden from
their own owner once the original is hidden (B28); muscle filter matches any involvement
ordered hardest-first, region ∧ muscle may be empty on purpose, no detail link from the logger's
picker (B29); PRs below the coaching content on the card, history screen kept as the logger's
deep link, grow-the-limit show-more (B30); soft delete for customs, customs never match a
region chip, no create-from-picker, no muscle-map shading for customs (B31); export contents
(own rows only; votes, comments, follows, blocks, mutes, reports and photo binaries out; kg as
stored), sweep-before-delete, moderator accounts refuse self-delete, no grace period, other
devices of a deleted account keep their local copy (B32); programs — soft delete on all four
tables, `target_sets` required but reps / load / RPE optional, weeks unnamed, swap-style move
buttons, explicit Save targets, a new slot starts at 3 sets, `export-data` not yet exporting
programs (B34); runs — finishing the last session ends the run (no loop), restarting begins at
Week 1, advancing is one-way, targets as entry notes, no server one-active constraint, a
deleted pointed-at session slides the run forward, `export-data` not yet exporting runs (B35);
teams — open teams have a public roster and invite-only rosters are members-only, a blocked
lifter can still join your open team (never sees your posts), team names not unique, no
ownership transfer, invites are per-user rows, members can leave but owners cannot (B36);
coaching — coaches see members' private workouts (blocks win; PRs, posts, photos, analyses and
body data stay closed; members are told on the team page), the owner is implicitly a coach,
assignments are accepted with one tap and copy the program, the coach's custom exercises do
not copy, coach access ignores mutes, Coach's corner shows the newest 20 pushes (B37);
moderation — removal is not a ban, a hide is curation (the post stays visible on Home and the
profile), re-shares of a hidden post stay until hidden too, no hide reasons or log, team
deletion behind a plain confirm (B38); program visibility — "friends" means followers, blocks
cut only the followers arm, mutes ignored, a Team program with no shares is private in effect,
shares persist when the author leaves the team or switches visibility, a soft-deleted program
vanishes for everyone but the author (B39); Marketplace — no description column, name + author
cards, whole-word search without ranking or author search, Show more re-reads a longer list,
blocked authors not filtered, a warning line rather than a confirm before replacing a running
program, deep links to followers- or team-shared programs open on the same page (B40);
**featured / votes / comments** — votes and comments only on published programs, downvotes
allowed, rolling 7 / 30 / 365-day windows, a flipped vote keeps its original timestamp, top 10,
no arrows on cards, program-comment reporting deferred, no realtime (B41).

Next pipeline step after B42 merges: **B43 tool-kit-prefill** (check the Build order table for
the exact branch name).
