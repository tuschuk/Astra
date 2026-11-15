# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B32, B34, B35 merged; pipeline on B36)

**Thirty pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2's programs are built and runnable
(B34, B35). The pipeline is running **B36 teams**. Gates are delegated to the session
(CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B35 run-program (merged, Gate 2 record):** migration `20261115203159_program_runs.sql`
(applied live, confirmed at Gate 2): `program_runs` (client uuid, `user_id`, `program_id`
cascade, `next_week_position` / `next_workout_position` ≥ 0, `started_at`, `ended_at` ≥
`started_at`, `moddatetime`, owner-only RLS on all four verbs, **no one-active unique index** —
rejected as a poison-row trap for two offline phones; the module ends every visible active run
when a new one starts and every read takes the newest) and nullable
`workouts.program_workout_id references program_workouts on delete set null`. Device schema V13
mirrors both FK-free. **`SYNC_ORDER` reordered** so the four program tables push before
`workouts` (a linked workout could otherwise reach the server before its program workout and
wedge the queue); every FK verified to point backwards, delete phase unaffected. App:
`programs/programRuns.ts` is the one home (`startProgramRun`, `stopProgramRun`,
`readActiveRun`, pure `resolveNextSession` / `sessionAfter`, `advanceRunOnFinish`);
`workout/startProgramSession.ts` prefills through existing store operations only — title
"program — Week N · workout", each runnable slot's exercise added in order with its targets as
the entry note ("Target: 3 × 8 @ 225 lb · RPE 8" in the display unit), no pre-logged sets;
`draftPolicy.finish` includes the advanced (or ended) run row in its atomic transaction only
when the workout carries a program link, and ignores sessions started before the run (review
fix); `components/programs/ProgramPickerSheet.tsx`; the Workout tab's "Start from a program"
is enabled and a run card shows the program, "Next: Week N · workout", Start next session, Start
empty workout and Stop program. Finishing the last session **ends the run** (no loop) —
recorded for Tristen. **Gate 2 live probe:** user B reads / updates / deletes 0 runs and sees
none; a run forged under A's id is refused (42501); negative position and end-before-start
refused (23514); a workout naming a random program workout refused (23503). Gate 2 reran in
order: regenerate typed routes → `tsc` clean → lint clean → Jest 135 suites / 1457 tests on a
cold cache at default workers; `mmdc` rendered both diagrams (OK). Statuses: B35 Built; PRG-3,
LOG-1 Built. Device-only: build a two-week program, Start from a program in airplane mode, see
"Week 1 · Day A" prefilled with target notes, finish → the tab offers Day B, kill mid-session
and Resume, reconnect → run row and linked workouts in Supabase, Stop, finish the last session →
run ends; the run card at phone width.

**Earlier:** B34 program-builder (PRG-1, PRG-2), B32 export-and-delete-account (NFR-6), B31
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

**B36 teams** (planning now): `teams` and `team_members` (owner, coach, member roles) with RLS;
create a Team, open-join by default, creator switches to invite-only; Team feed of members'
posts reachable from Home and Communities; Teams listed on the profile. Step DoD: both join
modes work, only the creator switches them, and the feed is linked from Home. Covers TEAM-1,
TEAM-2, SOC-10 (part), YOU-6 (part). Depends on B20. Standing inputs for its planner: **nothing
team-shaped exists** — no tables, no device rows, no screens; the Communities tab
(`app/(tabs)/communities.tsx`) is a placeholder, Home (`app/(tabs)/index.tsx`) is the B20/B24
feed; `ARCHITECTURE.md` names "Teams (membership, roles, coach assignments)" as a Groups domain.
The planner must settle: (a) schema — `teams` (owner, name, join mode `open | invite`,
soft-delete or not), `team_members` (team, user, role `owner | coach | member`, joined_at; one
row per user per team; the owner row created with the team by trigger), invites for invite-only
(a `team_invites` table with an invite code or per-user rows, or defer invite issuance to the
join-mode switch alone — the DoD says "both join modes work", so invite-only must be joinable by
*someone*: the planner names the mechanism and keeps it minimal); RLS — teams readable by anyone
signed in (discoverable) or members only, membership rows readable by members, join = self-insert
allowed only when the team is open or the user holds an invite, role changes and join-mode switch
restricted to the owner (B38 adds removal / feed moderation, B37 adds coaching) — the ownership
rule lives once in a `private.*` helper the way `owns_program` does; (b) **the Team feed** —
members' posts, read **online through the API** like the Home feed (never mirrored; other
people's data is read online — the B20/B34 rule), so `private.workout_visible` / `can_view_post`
need a Team arm only if Team membership should *widen* who sees a followers-only post (the
planner should say no: the Team feed shows what the viewer can already see, filtered to
members — no visibility change, no policy rewrite, one query over `posts` with a member-id list,
reusing `social/feed.ts` paging); the Home entry is a Teams row or chip above the feed
(SOC-10 part) and Communities lists the user's Teams and a Create / Join flow; (c) **sync** —
teams and memberships are server-authoritative and online-only (create / join / switch need a
connection, the B23 votes-and-comments precedent), so no device tables, no outbox, no schema
bump — the planner should confirm this reading against offline-first (logging and the Tool Kit
must work offline; social actions already do not); (d) profile (`components/profile/
ProfileView.tsx`) lists the user's Teams as links (YOU-6 part); (e) limits — team name length
in `@training-math` `limits.ts` mirroring the CHECK; (f) the Gate 2 probe — two simulated
users: non-member cannot read members / switch join mode / join an invite-only team, member
can read, owner can switch, open join works (the B31/B34 rolled-back recipe). No new dependency
expected; the ERD gains the team tables; the flowchart gains the Communities / Home → Team
paths. B36 is P1 like the rest of Phase 2; B37 team-coaching and B38 team-moderation follow.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B35 not yet on it — B31, B34 and B35 add device
schema V11–V13, migrated on open). To update: stop the server (`netstat -ano | findstr :8081`
→ `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`,
`npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in B30–B35), then
`npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps. Check order: `expo start --offline` ~150 s → `tsc`
→ lint → Jest; Gate 2 frees ports 8097 / 8099, renders the diagrams with `mmdc`, and runs live
HTTP probes through the PowerShell tool with the throwaway-JWT recipe (both recorded in
PIPELINE.md). Builders have hit Jest 30 s timeouts under full-suite load at default workers
(`exercise-detail`'s 151-exercise loop is the usual victim) and rerun with `--maxWorkers=50%`;
Gate 2's cold-cache default-worker runs have passed every time. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 34 (B35); B36 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3,
B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4,
B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9, B35 ≈ $19.3
(≈ $439 for thirty steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B35 first):
sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile;
log a multi-exercise workout, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Share → share sheet → post the PNG to another app and judge it →
Next → Post / Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle,
Privacy, Export your data (share sheet → open the JSON elsewhere); Tool Kit calculators and
timer; Home → Latest / Hot and a flair chip → Share a photo → vote / comment → make a post
private → ⋯ Report → an author's profile → Follow, Re-share their post (a follower of yours sees
it), Mute, Block → unblock; Find lifters; Library → a muscle chip and an equipment chip (header
room at phone width?) → tap a card → detail legibility → PRs and sessions under the Tips, Show
older sessions → New exercise in airplane mode → it appears in Library and picker → log a set →
its card → edit → delete → history keeps the name; Workout → Your programs → New program → Add
week → Add workout → Add exercise (a library one and your custom) → targets → kill → reopen
intact; **Workout → Start from a program → pick it → run card → Start next session (title,
exercises, target notes) → finish → card offers the next session → Stop program; finish a
program's last session → run ends**; reconnect → rows (incl. the four program tables,
`program_runs`, the linked workouts) and objects in Supabase; sign out; with a throwaway
account: Settings → Delete account → type DELETE → lands on sign-in, the email no longer signs
in, a reopened app has an empty device database. Flips B05–B35 and their features to Done as
each holds. (2) **Moderation:** pick an appeal email for `docs/CONTENT_POLICY.md`; call
`moderate` once with your signed-in token on a throwaway post (probe list in DEFERRED). (3)
Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of
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
tables, no visibility column until B39, `target_sets` required but reps / load / RPE optional,
weeks unnamed, no description, swap-style move buttons, explicit Save targets, a new slot starts
at 3 sets, `export-data` not yet exporting programs (B34); **runs** — finishing the last session
ends the run (no loop to Week 1), restarting begins at Week 1, advancing is one-way (deleting a
finished session does not rewind), targets as entry notes rather than pre-logged or seeded sets,
no server one-active constraint (newest active run wins), a deleted pointed-at session slides
the run forward, `export-data` not yet exporting runs (B35).

Next pipeline step after B36 merges: **B37 team-coaching** (depends on B36 and B35; check the
Build order table for the exact branch name).
