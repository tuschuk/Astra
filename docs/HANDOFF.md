# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B43, B46 merged; pipeline on B47)

**Thirty-nine pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2 has programs, runs, the Teams family,
program visibility, the Marketplace, trend analysis, Tool Kit prefill and profile trends. B44
(deload rules — needs Tristen's rule definitions) and B45 (strength grades — needs the Strength
Level licence) are Blocked and skipped. The pipeline is running **B47 push-notifications**.
Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list
is at the end.

**B46 profile-trends (merged, Gate 2 record):** no migration, no server change, no new
dependency. `workout/trendSeries.ts` is the data home — `volumeSeries` (every finished workout
with at least one set, volume through `sessionVolumeKg`; all-bodyweight sessions kept at 0,
empty finishes excluded), `e1rmSeries(exerciseId)` (best e1RM per session through
`recordsFromSets`, so the chart's peak can never disagree with the stored PR; sessions with no
qualifying set contribute no point), `trendExercises` (exercises with ≥ 1 qualifying set,
newest first, soft-deleted customs kept — the B31 stance; the SQL prefilter takes
`MAX_EPLEY_REPS` as a parameter after a review finding), `filterWindow` / `windowStartMs`
(3 / 6 / 12 months back from the time of the last read — a lint rule forbids `Date.now()` in
render); `components/profile/chartLayout.ts` is pure geometry (`buildChartLayout`, `valueAxis`
with 3–5 round ticks chosen in the display unit, `chartSentence` for the screen reader,
`MAX_MARKERS = 40`; volume axis starts at 0, e1RM axis spans min → max padded; empty / single /
flat cases as data); `TrendChart.tsx` draws one layout with `react-native-svg` only;
`TrendsSection.tsx` + `useTrendData.ts` (window chips, Volume card, e1RM card with an exercise
picker; a failed re-read keeps what is shown); `ProfileView` gains a fourth **Trends** tab on
the own profile only, loaded behind the existing db guard and re-read on focus (the "update
after a new workout" rule); `groupThousands` and `shortDateLabel` moved into `format.ts`. Gate 2
reran in order: regenerate typed routes → `tsc` clean → lint clean → Jest 165 suites / 1753
tests on a cold cache at default workers; `mmdc` rendered the flowchart (OK); ERD untouched.
Statuses: B46 Built; YOU-7 In progress (trends half; grades half is B45). Device-only: You →
Trends after a few workouts; finish another in airplane mode and return → newest point on the
right; flip to lb → round axis labels; judge the SVG's look, label spacing and the exercise
chips' sideways scroll. **Product calls recorded:** e1RM per exercise (no whole-body proxy);
Trends only on your own profile (a chart from the sets a viewer may see would misrepresent real
history); volume from local sets rather than the pull-only mirror; windows are months back from
the last read; no charting library; chart interaction and a richer accessibility bar belong to
B49.

**Earlier:** B43 tool-kit-prefill (TK-6), B42 trend-analysis (ANA-5, LOG-10), B41
marketplace-featured (MKT-2, MKT-3), B40 marketplace-browse (MKT-1, MKT-4, MKT-5), B39
program-visibility (PRG-4), B38 team-moderation (TEAM-4), B37 team-coaching (TEAM-3, TEAM-5),
B36 teams (TEAM-1, TEAM-2; SOC-10 / YOU-6 Teams halves), B35 run-program (PRG-3, LOG-1), B34
program-builder (PRG-1, PRG-2), B32 export-and-delete-account (NFR-6), B31 custom-exercises
(LIB-5), B30 library-card-history (LIB-4), B29 library-filters-and-detail (LIB-1, LIB-3), B28
share-cards (LOG-8, SOC-6), B27 moderation-and-safety (SOC-8, NFR-7), B26 post-privacy (YOU-5),
B25 profile (YOU-1, YOU-2, YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9), B23
votes-and-comments (SOC-4, SOC-5), B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post
(LOG-7), B20 posts-and-feed (SOC-1, SOC-3; LOG-13), B19 muscle-map (ANA-3), B18
analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer (TK-5), B16
tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14 edit-delete-workouts
(LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09 logger-screen
(LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06
training-math, B05 auth-and-signup. Details in each plan file.

**B47 push-notifications** (planning now): Expo push tokens stored per device; notification
settings per event (follows, comments, votes, Team pushes); sent from an edge function on
insert. Completes YOU-4 (In progress — Units, Account and Privacy shipped in B15 / B26; the
Notifications section is this step). Step DoD: each toggle stops exactly its notification.
Depends on B23, B36. Standing inputs for its planner: **spend no money** — Expo's push service
(`exp.host/--/api/v2/push/send`) is free; `expo-notifications` and `expo-constants` are already
dependencies (B17's timer uses local notifications in `toolkit/timerAlerts.ts`); push delivery
to a **real device needs platform credentials** — Android FCM (free, a Firebase project) and iOS
APNs (an Apple Developer membership, which costs money) — so the plan must work in Expo Go for
Tristen's device check (Expo Go uses Expo's own credentials) and record that production iOS
push is a credential Tristen provides, never a purchase the pipeline makes; if the planner finds
anything billable, the step is Blocked with the reason. Schema: `push_tokens (user_id, token,
platform, device label, created_at, last_seen_at)` owner-only RLS, upserted on sign-in and on
token refresh, deleted on sign-out and by B32's account deletion cascade; **settings per
event** — columns on `user_settings` (owner RLS exists; it syncs like the units toggle) or a
small `notification_settings` table: `notify_follows`, `notify_comments`, `notify_votes`,
`notify_team_pushes` booleans default true, shown as toggles in Settings → Notifications (the
B15 Settings screen; the section YOU-4 names); **sending** — one edge function (`notify`)
called by database webhooks / triggers on insert into `follows`, `comments`, `votes`,
`team_posts` (the planner picks between Supabase Database Webhooks → function, which needs
no secret in SQL, and `pg_net` from a trigger; either reads the recipient's settings and tokens
with the service role, honours the toggle, and posts to Expo's API with batching and receipt
handling — retries bounded, nothing speculative); recipients: the followed user, the post /
program author, the team's members (not the actor); **privacy** — the payload must carry no
sensitive data (no body data, no progress-pic content; names and counts only) and must respect
blocks and mutes (a muted / blocked actor triggers nothing — reuse `private.blocked_either`
and the mute table); the device registers for permission on first relevant moment, never on
launch; a tapped notification deep-links to the existing route (post comments, profile, team
page); the Gate 2 probe — insert a follow / comment / vote / team push as another user and read
the function's log or a `notification_log` table; toggle off → nothing sent; the DoD "each
toggle stops exactly its notification" is pinned by function tests with fakes and a live probe
with two throwaway users (no real device delivery can be probed from the session — record
that the delivery itself is Tristen's device check in Expo Go). No new dependency expected
beyond what exists; the ERD gains the tokens table / settings columns; the flowchart gains the
Settings → Notifications section and the insert → function → Expo path.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B46 not yet on it — B31, B34, B35, B39 and B42
add device schema V11–V15, migrated on open). To update: stop the server (`netstat -ano |
findstr :8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout
--detach main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in
B30–B46), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps; both launchers write stderr to
`automation/state/builder.err.log` / `planner.err.log` (gitignored) since the B42 builder died
after its work — recovery recipe in PIPELINE.md. Check order: `expo start --offline` ~150 s →
`tsc` → lint → Jest; Gate 2 frees ports 8097–8099, renders the diagrams with `mmdc`, and runs
live HTTP probes through the PowerShell tool with the throwaway-JWT recipe (persistent probe
rows deleted afterwards; an UPDATE whose RLS check fails raises 42501). Builders have hit Jest
30 s timeouts under full-suite load at default workers and rerun with `--maxWorkers=50%`; Gate
2's cold-cache default-worker runs have passed every time. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 43 (B46); B47 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3,
B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4,
B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9, B35 ≈ $19.3,
B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6, B39 ≈ $14.5, B40 ≈ $13.9, B41 ≈ $18.9, B42 ≈ $7.4
planner + an unreported builder, B43 ≈ $12.1, B46 ≈ $12.8 (≈ $568 reported for thirty-nine
steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B46 first):
sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile;
log a multi-exercise workout, one-tap Repeat, force-kill and Resume; mid-workout after a logged
set, open the Tool Kit: 1RM, RPE, %1RM and Plates arrive prefilled; overwrite one, close, reopen
→ it sticks; finish in airplane mode → analysis with muscle map → Share → share sheet → post the
PNG to another app and judge it → Next → Post / Skip; View workout → PR badges; History; Edit
and Delete; Settings → kg toggle, Privacy, Export your data (share sheet → open the JSON
elsewhere); Tool Kit timer; Home → Latest / Hot and a flair chip → Share a photo → vote /
comment → make a post private → ⋯ Report → an author's profile → Follow, Re-share their post (a
follower of yours sees it), Mute, Block → unblock; Find lifters; Library → a muscle chip and an
equipment chip → tap a card → detail → PRs and sessions under the Tips, Show older sessions →
New exercise in airplane mode → it appears in Library and picker → log a set → its card → edit →
delete → history keeps the name; Workout → Your programs → New program → weeks / workouts /
exercises with targets → kill → reopen intact → Who can see this: each chip in airplane mode,
kill, reopen (sticks) → reconnect (column in Supabase) → Team → tick a team (share row in
Supabase) → Published; Workout → Start from a program → run card → Start next session → finish →
next session offered → Stop; Communities → Create a team (open) → second account joins → Team
feed and Home chips → switch to Invite only → Invite → join via invite → profile Teams section;
owner → Make coach on the second account; coach → Announce, push a program (member Saves it),
push a workout (member Starts it), Assign a program (member taps Start → Workout tab shows the
run); coach opens the member's profile → History shows a private workout → tap → full session;
owner → Hide from Team feed on the member's post → Unhide → Remove from team → cannot rejoin
once invite-only → Remove a push → Delete team; second account → Marketplace → the published
program is listed → search a word of its name → tap → author / weeks / days per week /
breakdown → upvote → comment → A reads it → Featured → Week shows it → chips switch windows →
un-vote → score drops on next focus → Save and Start → Workout tab shows the run → Start next
session opens Day 1 with targets; after five or more logged sessions, open the newest analysis →
the "Against your trend" card; **You → Trends: Volume and estimated-1RM charts, window chips,
exercise chips; finish another workout in airplane mode → newest point on the right; flip to lb
→ round axis labels; judge the look**; Marketplace and the comments screen in airplane mode →
connection messages; reconnect → rows and objects in Supabase; sign out; with a throwaway
account: Settings → Delete account → type DELETE → lands on sign-in, the email no longer signs
in, a reopened app has an empty device database. Flips B05–B46 and their features to Done as
each holds. (2) **Moderation:** pick an appeal email for `docs/CONTENT_POLICY.md`; call
`moderate` once with your signed-in token on a throwaway post (probe list in DEFERRED). (3)
Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of
record; the session's toggle was declined by the permission layer). (4) **The Blocked steps the
pipeline is skipping:** B33 (video provider), B44 (define the accumulated-fatigue deload rule
and the next-session intensity rule), B45 (Strength Level data licence); B51 (Denver gym
import), B55 and B56 later; **and, for B47, whether you hold Apple push credentials** — the
pipeline will not buy an Apple Developer membership, so iOS push beyond Expo Go waits on you.
(5) Whether to grant `mmdc` (and Deno) to headless runs. (6) Product readings to confirm or
overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM" label (B13); muscle
shading by max (B19); one post per workout and own posts on Home (B20); post visibility
inherits the workout's, no caption (B21); 10 MiB images, PR post = photo + New PR flair (B22);
votes and comments online-only, 500-char comments (B23); feed preference per phone, sticky
flair filter (B24); public-read avatars, username editable (B25); post / workout visibility
lockstep, three options, body-data control deferred (B26); whole-person mute, viewer-relative
tallies, reports outlive content (B27); export own content only, no photo-post export, no
re-share chains, re-shares hidden from their own owner once the original is hidden (B28);
muscle filter matches any involvement ordered hardest-first, region ∧ muscle may be empty on
purpose, no detail link from the logger's picker (B29); PRs below the coaching content on the
card, history screen kept as the logger's deep link, grow-the-limit show-more (B30); soft delete
for customs, customs never match a region chip, no create-from-picker, no muscle-map shading
for customs (B31); export contents (own rows only; votes, comments, follows, blocks, mutes,
reports and photo binaries out; kg as stored), sweep-before-delete, moderator accounts refuse
self-delete, no grace period, other devices of a deleted account keep their local copy (B32);
programs — soft delete on all four tables, `target_sets` required but reps / load / RPE
optional, weeks unnamed, swap-style move buttons, explicit Save targets, a new slot starts at 3
sets, `export-data` not yet exporting programs (B34); runs — finishing the last session ends the
run (no loop), restarting begins at Week 1, advancing is one-way, targets as entry notes, no
server one-active constraint, a deleted pointed-at session slides the run forward, `export-data`
not yet exporting runs (B35); teams — open teams have a public roster and invite-only rosters
are members-only, a blocked lifter can still join your open team (never sees your posts), team
names not unique, no ownership transfer, invites are per-user rows, members can leave but
owners cannot (B36); coaching — coaches see members' private workouts (blocks win; PRs, posts,
photos, analyses and body data stay closed; members are told on the team page), the owner is
implicitly a coach, assignments are accepted with one tap and copy the program, the coach's
custom exercises do not copy, coach access ignores mutes, Coach's corner shows the newest 20
pushes (B37); moderation — removal is not a ban, a hide is curation (the post stays visible on
Home and the profile), re-shares of a hidden post stay until hidden too, no hide reasons or
log, team deletion behind a plain confirm (B38); program visibility — "friends" means
followers, blocks cut only the followers arm, mutes ignored, a Team program with no shares is
private in effect, shares persist when the author leaves the team or switches visibility, a
soft-deleted program vanishes for everyone but the author (B39); Marketplace — no description
column, name + author cards, whole-word search without ranking or author search, Show more
re-reads a longer list, blocked authors not filtered, a warning line rather than a confirm
before replacing a running program (B40); featured / votes / comments — only on published
programs, downvotes allowed, rolling 7 / 30 / 365-day windows, a flipped vote keeps its original
timestamp, top 10, no arrows on cards, program-comment reporting deferred, no realtime (B41);
trend — last 10 sessions with a threshold of 5, mean not median, empty finishes excluded, RPE
when present else load per rep, deltas derived at render time, history edits do not re-stamp an
existing trend, old rows upgrade 10 per sync (B42); Tool Kit prefill — the exercise with the
newest logged set, warm-ups and drops count as the source set, the stored e1RM in the 1RM boxes,
the percent box never seeded, typed values survive until something new is logged, tab-tile
opens never prefilled (B43); **profile trends** — e1RM per exercise, Trends only on your own
profile, volume from local sets, windows from the last read, no charting library, interaction
and richer accessibility left to B49 (B46).

Next pipeline step after B47 merges: **B48 direct-messages** (check the Build order table for
the exact branch name; it needs Supabase Realtime, which is included in the existing project).
