# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B43 merged; pipeline on B46)

**Thirty-eight pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2 has programs, runs, the Teams family,
program visibility, the Marketplace, trend analysis and Tool Kit prefill. B44 (deload rules —
needs Tristen's rule definitions) and B45 (strength grades — needs the Strength Level licence)
are Blocked and skipped. The pipeline is running **B46 profile-trends**. Gates are delegated to
the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B43 tool-kit-prefill (merged, Gate 2 record):** no migration, no server change, no new
dependency. `frontend/src/toolkit/prefill.ts` is the one home: `focusedEntry(entries)` (the
entry holding the newest logged set, ties by entry then set position; else the last entry;
else null), `buildToolKitPrefill(entry, prs, displayUnit, rackUnit)` (pure — 1RM calculator ←
the source set's weight and reps; RPE and %1RM calculators' 1RM box ← the stored `e1rm` record
from `currentPrs`, falling back to `epleyE1rm` of the source set; RPE calculator chips ← the
set's reps / RPE when representable — RPE 7.3 seeds no chip; Plates ← the set's weight in the
**rack's** unit; every weight through `displayWeight`; zero gates), `applyToolKitPrefill`
(merges into the existing Tool Kit session **per calculator, apply-once per source key** of
exercise slot + set + values — builder deviation 1 after a review finding that a unit flip
re-seeded every calculator and wiped typed values), `resetToolKitPrefill` for tests. The
logger's floating Tool Kit button (`app/active-workout.tsx`) became async: `focusedEntry` →
`Promise.all(currentPrs, loadPlateRacks)` → apply → open; any thrown read logs a warning and
the sheet opens unfilled. The "RPE 6–10 in half steps" chip check moved into `@training-math`
`rpe.ts` as `isChartRpe` (builder deviation 2 — a copy the review caught; `percentOfOneRm` uses
it too). `ToolKitSheet`, the four calculators, the session module and the Workout tab tiles are
unchanged; tab-tile opens are never prefilled. Gate 2 reran in order: regenerate typed routes →
`tsc` clean → lint clean → Jest 160 suites / 1711 tests on a cold cache at default workers (the
builder's one load timeout did not recur); `mmdc` rendered the flowchart (OK); ERD untouched.
Statuses: B43 Built; TK-6 Built. **Device-only, and the DoD's wording makes it Tristen's:**
"observed on a mid-workout open for each calculator" — log a set (e.g. 225 × 5 @ 8), open the
Tool Kit → 1RM shows 225 × 5, RPE and %1RM show the stored e1RM with chips on 5 and 8, Plates
shows 225 in the rack's unit; overwrite one, close, reopen → it sticks; log another set → the new
numbers; airplane mode works; judge whether the open feels instant. **Product calls recorded:**
the exercise in progress is the one with the newest logged set (not the box last touched);
warm-ups and drops count as the source set; the RPE / %1RM 1RM box takes the stored e1RM, not
the set's weight; the percent box is never seeded (no load ÷ 1RM derivation outside the math
module); moving to a fresh exercise re-seeds only the 1RM boxes and leaves the previous
exercise's weight and plate target beside them.

**Earlier:** B42 trend-analysis (ANA-5, LOG-10), B41 marketplace-featured (MKT-2, MKT-3), B40
marketplace-browse (MKT-1, MKT-4, MKT-5), B39 program-visibility (PRG-4), B38 team-moderation
(TEAM-4), B37 team-coaching (TEAM-3, TEAM-5), B36 teams (TEAM-1, TEAM-2; SOC-10 / YOU-6 Teams
halves), B35 run-program (PRG-3, LOG-1), B34 program-builder (PRG-1, PRG-2), B32
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

**B46 profile-trends** (planning now): long-term e1RM and volume charts on the profile from real
history. Step DoD: the charts render from logged data and update after a new workout. Covers the
trends half of YOU-7 (the grades half is B45, Blocked). Depends on B25, B42. Standing inputs for
its planner: **the only drawing dependency is `react-native-svg`** (the muscle map) — draw the
charts with it (lines, axes, labels in `Svg`/`Path`/`Text`), no charting library ("add nothing
speculative"; a library is a Gate 1 question only if a measured need appears); **data sources
already exist** — per-session volume is `workout_analyses.total_volume_kg` (owner-read,
mirrored on the device since B18) and the trend columns (B42); e1RM over time comes from the
lifter's own sets through the one `@training-math` e1RM (`epleyE1rm`) — the planner decides
whether the e1RM chart is per exercise (the lifter picks an exercise; `personal_records` holds
only the *current* best per book, so a history needs the best e1RM per session computed from
`sets` — B13's `exerciseSessions` read is the precedent) or a whole-body proxy, and records the
reading; **own profile reads the phone** (offline), another lifter's profile reads online under
RLS (`workouts` / `sets` visibility rules — a coach sees members' private sessions, others see
what `workout_visible` admits; `workout_analyses` are owner-only, so another lifter's volume
chart must be computed from visible sets or omitted — the planner names which); the chart
section lives in `components/profile/ProfileView.tsx` beside History and PRs (the "Trends" word
belongs to YOU-7); time axis = session dates (newest right), a window selector (3 / 6 / 12
months / all) is optional and only if cheap; every label is the lifter's own numbers in the
display unit, no performance claims, no AI; "update after a new workout" = re-read on focus
(the established pattern); tests = pure data-to-points functions on fixtures (points, scale,
empty / single-session cases) plus a route test rendering the section over a seeded database;
Gate 2 is the check chain and a skim (no server surface). No migration, no sync change, no new
dependency expected; the ERD is untouched; the flowchart gains the Trends section and its data
path. After B46: B47 push-notifications (Expo push tokens, settings per event, sent from an
edge function on insert — **check that Expo's push service is free at launch scale before
planning; "spend no money"**), B48 direct-messages, B49 accessibility-pass, B50 gyms-core.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B43 not yet on it — B31, B34, B35, B39 and B42
add device schema V11–V15, migrated on open). To update: stop the server (`netstat -ano |
findstr :8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout
--detach main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in
B30–B43), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps; both launchers write stderr to
`automation/state/builder.err.log` / `planner.err.log` (gitignored) since the B42 builder died
after its work — recovery recipe in PIPELINE.md (check chain on the dirty tree, fill DEFERRED,
commit the build on the branch, continue Gate 2; never `retry` on a dirty tree). Check order:
`expo start --offline` ~150 s → `tsc` → lint → Jest; Gate 2 frees ports 8097–8099, renders the
diagrams with `mmdc`, and runs live HTTP probes through the PowerShell tool with the
throwaway-JWT recipe (persistent probe rows deleted afterwards; an UPDATE whose RLS check fails
raises 42501). Builders have hit Jest 30 s timeouts under full-suite load at default workers
and rerun with `--maxWorkers=50%`; Gate 2's cold-cache default-worker runs have passed every
time. Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry
<id>`, `trigger`). Executions 4/5 (B05) through 42 (B43); B46 is next (the picker skips B44 and
B45). Reported costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0,
B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5,
B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6,
B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6,
B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9, B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6,
B39 ≈ $14.5, B40 ≈ $13.9, B41 ≈ $18.9, B42 ≈ $7.4 planner + an unreported builder,
B43 ≈ $12.1 (≈ $555 reported for thirty-eight steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B43 first):
sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile;
log a multi-exercise workout, one-tap Repeat, force-kill and Resume; **mid-workout after a
logged set, open the Tool Kit: 1RM, RPE, %1RM and Plates arrive prefilled; overwrite one, close,
reopen → it sticks; log another set → new numbers**; finish in airplane mode → analysis with
muscle map → Share → share sheet → post the PNG to another app and judge it → Next → Post /
Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle, Privacy, Export
your data (share sheet → open the JSON elsewhere); Tool Kit timer; Home → Latest / Hot and a
flair chip → Share a photo → vote / comment → make a post private → ⋯ Report → an author's
profile → Follow, Re-share their post (a follower of yours sees it), Mute, Block → unblock; Find
lifters; Library → a muscle chip and an equipment chip → tap a card → detail → PRs and sessions
under the Tips, Show older sessions → New exercise in airplane mode → it appears in Library and
picker → log a set → its card → edit → delete → history keeps the name; Workout → Your programs
→ New program → weeks / workouts / exercises with targets → kill → reopen intact → Who can see
this: each chip in airplane mode, kill, reopen (sticks) → reconnect (column in Supabase) → Team →
tick a team (share row in Supabase) → Published; Workout → Start from a program → run card →
Start next session → finish → next session offered → Stop; Communities → Create a team (open) →
second account joins → Team feed and Home chips → switch to Invite only → Invite → join via
invite → profile Teams section; owner → Make coach on the second account; coach → Announce, push
a program (member Saves it), push a workout (member Starts it), Assign a program (member taps
Start → Workout tab shows the run); coach opens the member's profile → History shows a private
workout → tap → full session; owner → Hide from Team feed on the member's post → Unhide → Remove
from team → cannot rejoin once invite-only → Remove a push → Delete team; second account →
Marketplace → the published program is listed → search a word of its name → tap → author / weeks
/ days per week / breakdown → upvote → comment → A reads it → Featured → Week shows it → chips
switch windows → un-vote → score drops on next focus → Save and Start → Workout tab shows the run
→ Start next session opens Day 1 with targets; after five or more logged sessions, open the
newest analysis → the "Against your trend" card (volume line, RPE line; load-per-rep line for a
session without RPE; renders in airplane mode; the synced row carries engine version 2);
Marketplace and the comments screen in airplane mode → connection messages; reconnect → rows
and objects in Supabase; sign out; with a throwaway account: Settings → Delete account → type
DELETE → lands on sign-in, the email no longer signs in, a reopened app has an empty device
database. Flips B05–B43 and their features to Done as each holds. (2) **Moderation:** pick an
appeal email for `docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on a
throwaway post (probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers →
Email → turn "Confirm email" off (plan of record; the session's toggle was declined by the
permission layer). (4) **The Blocked steps the pipeline is skipping:** B33 (video provider),
B44 (define the accumulated-fatigue deload rule and the next-session intensity rule), B45
(Strength Level data licence); plus B51 (Denver gym import), B55 and B56 later. (5) Whether to
grant `mmdc` (and Deno) to headless runs. (6) Product readings to confirm or overrule: no
bodyweight rep-record PR book (B10/B13); the bare "e1RM" label (B13); muscle shading by max
(B19); one post per workout and own posts on Home (B20); post visibility inherits the workout's,
no caption (B21); 10 MiB images, PR post = photo + New PR flair (B22); votes and comments
online-only, 500-char comments (B23); feed preference per phone, sticky flair filter (B24);
public-read avatars, username editable (B25); post / workout visibility lockstep, three options,
body-data control deferred (B26); whole-person mute, viewer-relative tallies, reports outlive
content (B27); export own content only, no photo-post export, no re-share chains, re-shares
hidden from their own owner once the original is hidden (B28); muscle filter matches any
involvement ordered hardest-first, region ∧ muscle may be empty on purpose, no detail link from
the logger's picker (B29); PRs below the coaching content on the card, history screen kept as the
logger's deep link, grow-the-limit show-more (B30); soft delete for customs, customs never match
a region chip, no create-from-picker, no muscle-map shading for customs (B31); export contents
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
arrows on cards, program-comment reporting deferred, no realtime (B41); trend — last 10
sessions with a threshold of 5, mean not median, empty finishes excluded, RPE when present else
load per rep, deltas derived at render time, history edits do not re-stamp an existing trend,
old rows upgrade 10 per sync (B42); **Tool Kit prefill** — the exercise with the newest logged
set (not the box last touched), warm-ups and drops count as the source set, the stored e1RM in
the 1RM boxes rather than the set's weight, the percent box never seeded, typed values survive
until something new is logged, tab-tile opens never prefilled (B43).

Next pipeline step after B46 merges: **B47 push-notifications** (check the Build order table
for the exact branch name, and that Expo push costs nothing before approving its plan).
