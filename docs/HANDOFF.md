# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B42 merged; pipeline on B43)

**Thirty-seven pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2 has programs, runs, the Teams family,
program visibility, the whole Marketplace and trend analysis. The pipeline is running **B43
tool-kit-prefill**. Gates are delegated to the session (CLAUDE.md, "Autonomous sessions").
Tristen's hands-on list is at the end.

**B42 trend-analysis (merged, Gate 2 record):** migration `20261116023347_analysis_trend.sql`
(applied live, confirmed at Gate 2): six nullable columns on `workout_analyses` — `trend_sessions`
(5–10), `trend_volume_avg_kg`, `trend_rpe_avg` (1–10), `trend_load_per_rep_avg_kg`,
`session_rpe_avg`, `session_load_per_rep_kg` — no policy change (owner-read, function-written).
Engine: `_shared/analysis/trend.ts` is the one home (`TREND_WINDOW_SESSIONS = 10`,
`TREND_MIN_SESSIONS = 5`, `TREND_MIN_MEASURE_SESSIONS = 3`, `TREND_SCAN_LIMIT = 40`;
`sessionMeasures`, `trendHistory` — which re-sorts and re-filters the over-fetched candidates by
`(timestampMs, id)` so the two readers can never fork — and `buildTrend`); history = the
lifter's previous finished workouts with at least one set, newest first; volume compared to the
rolling mean, intensity = mean working-set RPE when this session and ≥ 3 history sessions carry
it, else load per rep (volume ÷ counted reps), else the volume line alone (LOG-10 complete);
`ANALYSIS_ENGINE_VERSION = 2` and "older rules" joins the staleness rule in both the request
pass (old rows upgrade 10 per sync through the existing machinery) and the screen's stored-vs-
local choice; `trendCopy` builds estimate-worded lines ("About 12% more than your recent
average", "right around" within 2% / 0.2 RPE) at render time from the stored numbers; the
`analyze-workout` function redeployed as **v3** (`verify_jwt` on) with a bounded history read
(`started_at <= … and id <> …`, newest first, limit 40 — builder deviation 1); device schema V15
mirrors the columns through `TABLE_COLUMNS`; the analysis screen gains the "Against your trend"
card. Builder deviations 1–9 recorded in the plan's "Build notes and deviations"; its review ran
(rounding mismatch fixed, `sessionVolumeKg` reused, a missing test added). **The builder run
exited non-zero after its Document step without committing** (n8n kept no stderr); Gate 2 ran
the check chain on its tree (green), added the DEFERRED entry it had not written, committed
the work on the branch as the build commit, and recorded the recovery recipe plus stderr capture
in both launchers in `docs/PIPELINE.md`. **Gate 2 live probe over the API with a throwaway JWT:**
seven seeded workouts (one empty, one without RPE, varying loads) → the newest's analysis
returned `trend_sessions 5`, `trend_volume_avg_kg 1660`, `trend_rpe_avg 7.5`,
`trend_load_per_rep_avg_kg 104`, `session_rpe_avg 8`, `session_load_per_rep_kg 120` — every
value matching the hand computation with the empty session excluded; the third workout returned
null trend fields with its own session measures; a client PATCH to a trend column changed
nothing; the stored row read back at engine version 2. Gate 2 reran in order: regenerate typed
routes → `tsc` clean → lint clean → Jest 159 suites / 1683 tests on a cold cache at default
workers; `mmdc` rendered both diagrams (OK). Statuses: B42 Built; ANA-5, LOG-10 Built.
Device-only: with five or more logged sessions the card shows "Compared with your last N
sessions" and the volume and RPE lines; fewer sessions → no card; a session without RPE falls
back to load per rep; airplane mode renders the local computation and the synced row matches.
**Product calls recorded:** session-count windows (10) rather than calendar windows; threshold
5; mean not median; empty finishes excluded; load per rep as the RPE fallback; deltas derived
at render time, never stored; history edits do not re-stamp an existing trend; the version-2
recompute wave is bounded at 10 per sync.

**Earlier:** B41 marketplace-featured (MKT-2, MKT-3), B40 marketplace-browse (MKT-1, MKT-4,
MKT-5), B39 program-visibility (PRG-4), B38 team-moderation (TEAM-4), B37 team-coaching (TEAM-3,
TEAM-5), B36 teams (TEAM-1, TEAM-2; SOC-10 / YOU-6 Teams halves), B35 run-program (PRG-3,
LOG-1), B34 program-builder (PRG-1, PRG-2), B32 export-and-delete-account (NFR-6), B31
custom-exercises (LIB-5), B30 library-card-history (LIB-4), B29 library-filters-and-detail
(LIB-1, LIB-3), B28 share-cards (LOG-8, SOC-6), B27 moderation-and-safety (SOC-8, NFR-7), B26
post-privacy (YOU-5), B25 profile (YOU-1, YOU-2, YOU-3, SOC-7), B24 feed-sort-and-filter
(SOC-11, SOC-9), B23 votes-and-comments (SOC-4, SOC-5), B22 image-posts (SOC-2, NFR-4 part),
B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1, SOC-3; LOG-13), B19 muscle-map (ANA-3),
B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer (TK-5), B16
tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14 edit-delete-workouts
(LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09 logger-screen
(LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06
training-math, B05 auth-and-signup. Details in each plan file.

**B43 tool-kit-prefill** (planning now): calculators open prefilled from the exercise in
progress and the user's stored PRs. Step DoD: observed on a mid-workout open for each
calculator. Covers TK-6. Depends on B16, B13. Standing inputs for its planner: the Tool Kit is
`components/toolkit/ToolKitSheet.tsx` (four calculators — 1RM, RPE, intensity, plate loader —
and the timer; it already takes an `initialTool` prop) opened from the logger
(`app/active-workout.tsx`, a floating button) and from the Workout tab tiles; calculator state
and input parsing live in `frontend/src/toolkit/` (`inputs.ts`, `session.ts`, `plateRack.ts`,
`timer*.ts`) over the `@training-math` module (e1RM, plate math — the one home; no new math);
the "exercise in progress" is the logger's current entry — the planner must settle how the
sheet learns which entry is in focus (the last set logged or the entry whose set box is active;
the active-workout store exposes the entries and their sets; pass `prefill` props into the
sheet rather than having the sheet read the store), and what each calculator takes: 1RM ←
the last logged set's weight and reps (display unit); RPE ← the last set's weight, reps and RPE;
intensity ← the lifter's current best e1RM for that exercise (`currentPrs(db, user, exerciseId)`
from `workout/prs.ts`, B13 — read on the phone, works offline) as the 1RM reference plus the
set's load; plate loader ← the last set's weight (the rack is already per-phone in kv-store);
when nothing is in progress (Workout tab tiles) the calculators open empty as today; prefill is
a starting value the lifter can overwrite, never a lock; units go through `useDisplayUnit`; the
Gate 2 check is Jest (a seeded workout with a logged set → each calculator's initial fields) and
Tristen's device observation ("observed on a mid-workout open for each calculator" is the DoD —
record that the Built → Done flip is his). No migration, no sync change, no new dependency
expected; the ERD is untouched; the flowchart gains the prefill data path. After B43: B44 and
B45 are Blocked, B46 profile-trends (depends on B25, B42 — now unblocked), B47 push
notifications (depends on B23, B36).

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B42 not yet on it — B31, B34, B35, B39 and B42
add device schema V11–V15, migrated on open). To update: stop the server (`netstat -ano |
findstr :8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout
--detach main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in
B30–B42), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps; **both launchers now write stderr to
`automation/state/builder.err.log` / `planner.err.log`** (gitignored) after the B42 builder
died after its work without a recorded reason — the recovery recipe (check chain on the dirty
tree, fill DEFERRED, commit the build on the branch, continue Gate 2; never `retry` on a dirty
tree) is in PIPELINE.md. Check order: `expo start --offline` ~150 s → `tsc` → lint → Jest; Gate 2
frees ports 8097–8099, renders the diagrams with `mmdc`, and runs live HTTP probes through the
PowerShell tool with the throwaway-JWT recipe (persistent probe rows deleted afterwards; an
UPDATE whose RLS check fails raises 42501 rather than updating zero rows). Builders have hit
Jest 30 s timeouts under full-suite load at default workers and rerun with `--maxWorkers=50%`;
Gate 2's cold-cache default-worker runs have passed every time. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 41 (B42, builder node errored after its work); B43 is next.
Reported costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7,
B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0,
B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4,
B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6,
B32 ≈ $15.3, B34 ≈ $21.9, B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6, B39 ≈ $14.5,
B40 ≈ $13.9, B41 ≈ $18.9, B42 planner ≈ $7.4 + a builder whose cost was not reported because
the node errored (≈ $543 reported for thirty-seven steps, plus the B42 builder).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B42 first):
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
its name → tap → author / weeks / days per week / breakdown → upvote → comment → A reads it →
Featured → Week shows it → chips switch windows → un-vote → score drops on next focus → Save and
Start → Workout tab shows the run → Start next session opens Day 1 with targets; **after five or
more logged sessions, open the newest analysis → the "Against your trend" card (last N sessions,
volume line, RPE line); a session logged without RPE → load-per-rep line; airplane mode → the
card still renders; reconnect → the stored row carries engine version 2 and the same numbers**;
Marketplace and the comments screen in airplane mode → connection messages; reconnect → rows
and objects in Supabase; sign out; with a throwaway account: Settings → Delete account → type
DELETE → lands on sign-in, the email no longer signs in, a reopened app has an empty device
database. Flips B05–B42 and their features to Done as each holds. (2) **Moderation:** pick an
appeal email for `docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on a
throwaway post (probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers →
Email → turn "Confirm email" off (plan of record; the session's toggle was declined by the
permission layer). (4) The six external blockers — B33 video provider is the step the pipeline
skipped; B44 and B45 are the next Blocked steps the pipeline will skip. (5) Whether to grant
`mmdc` (and Deno) to headless runs. (6) Product readings to confirm or overrule: no bodyweight
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
program (B40); featured / votes / comments — only on published programs, downvotes allowed,
rolling 7 / 30 / 365-day windows, a flipped vote keeps its original timestamp, top 10, no
arrows on cards, program-comment reporting deferred, no realtime (B41); **trend** — last 10
sessions with a threshold of 5, mean not median, empty finishes excluded, RPE when present else
load per rep, deltas derived at render time, history edits do not re-stamp an existing trend,
old rows upgrade 10 per sync (B42).

Next pipeline step after B43 merges: **B46 profile-trends** (B44 and B45 are Blocked; check the
Build order table for the exact branch name).
