# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B32, B34–B36 merged; pipeline on B37)

**Thirty-one pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2 has programs, runs and Teams. The
pipeline is running **B37 team-coaching**. Gates are delegated to the session (CLAUDE.md,
"Autonomous sessions"). Tristen's hands-on list is at the end.

**B36 teams (merged, Gate 2 record):** migration `20261115212541_teams.sql` (applied live,
confirmed at Gate 2): enums `team_join_mode (open, invite)` and `team_role (owner, coach,
member)`; `teams` (server uuid, `created_by` cascade, name 1–80, `join_mode` default open,
`moddatetime`), `team_members` (PK team+user, role default member, `joined_at`),
`team_invites` (PK team+user); SECURITY DEFINER helpers `private.is_team_member`,
`is_team_owner`, `team_mode`, `has_team_invite`; triggers `on_team_created` (writes the owner
row) and `on_team_member_created` (consumes the invite); policies — teams readable by any
signed-in user, insert as self, update owner-only with **UPDATE revoked on the table and granted
back on `name` and `join_mode` only** (builder deviation: the plan's column revoke was a no-op
under Supabase's table grant); members select = own rows ∪ members see the roster ∪ open teams
have a public roster, insert = self as `member` when open or invited, delete = leave unless
owner; invites insert owner-only and refused across a block, select/delete by invitee or owner.
Online-only, no device tables (the B23 precedent). App: `social/teams.ts` (createTeam with
`assertValidTeamName` from `@training-math`, `loadTeamsOf`, `loadTeam`, `loadTeamMembers`,
`searchTeams` via the imported `sanitizeSearchTerm`, `joinTeam`, `leaveTeam`, `setJoinMode`,
`myInvites`, `teamInvitees`, `inviteToTeam`, `removeInvite`), `components/teams/TeamListItem`,
`components/social/usePostListActions.ts` (the third-copy extraction — now used by Home, the
profile and the team page), routes `app/team/new.tsx`, `app/team/[id]/index.tsx` (team page:
Join / Leave / owner switch / Invite lifters / roster / Team feed through `loadFeedPage` with the
roster as author list — no visibility widened), `app/team/[id]/invite.tsx`; Communities tab
rewritten (Your teams, Invites, Create, Find teams; Gyms card still the placeholder); "Your
teams" chip row on Home; Teams section on every profile. **Gate 2 live probe (three simulated
users, rolled back):** owner row by trigger; default open; joiner gets `member`; member switch 0
rows, owner switch 1; owner leave 0; uninvited user sees 0 roster rows of an invite-only team
and is refused joining (42501); invitee sees the invite, joins, invite consumed; members see
the roster (3) and can leave (1); forged owner row refused (42501); owner rewriting
`created_by` refused (permission denied). Builder also probed the feed shape live (followers-only
post visible only to a member who follows). Gate 2 reran in order: regenerate typed routes →
`tsc` clean → lint clean → Jest 141 suites / 1502 tests on a cold cache at default workers;
`mmdc` rendered both diagrams (OK). Statuses: B36 Built; TEAM-1, TEAM-2 Built; SOC-10, YOU-6 In
progress (Teams halves done, Gym halves are B50). Device-only: two accounts — create a team,
the other joins (open), switch to invite-only, invite, join via invite, Team feed on both, Home
chips, profile Teams section, leave. **Product calls recorded:** open teams have a public
roster, invite-only rosters are members-only; a blocked lifter can still join your open team
and see the roster (never your posts) — a one-line join-policy block check if wanted; no team
names uniqueness; no ownership transfer (creator's account deletion deletes the team).

**Earlier:** B35 run-program (PRG-3, LOG-1), B34 program-builder (PRG-1, PRG-2), B32
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

**B37 team-coaching** (planning now): coach pushes programs, workouts and announcements to the
Team; assigns a program to a member, which becomes that member's active run; coaches read
members' logs through RLS and members cannot. Step DoD: pushed content reaches members, an
assignment sets the active program, and a non-coach's log read is refused. Covers TEAM-3,
TEAM-5. Depends on B36, B35. Standing inputs for its planner: **the `coach` role exists in the
enum but nothing grants it** — B36 left role changes to B37 (`team_members` has no update
policy), so the first decision is who makes a coach (the owner, via an owner-only update policy
on `team_members.role` restricted to `coach`/`member` — never `owner`) and whether the owner is
implicitly a coach; **reading members' logs** means widening `workouts` select (today
`private.workout_visible(user_id, visibility)` — the one visibility home; a coach arm must live
there or in a sibling helper, never a second spelling, and must respect blocks and the
`private` visibility: the planner decides whether a coach sees a member's *private* workouts —
the PRD reading is that coaching implies log access, but body data and progress pics stay
out), plus `workout_exercises` / `sets` (readable through their workout today) and
`personal_records` (owner-only today — a coach arm or leave PRs out, recorded); **assigning a
program**: `program_runs` insert is self-only today and `programs` are author-only readable
(B34; B39 adds visibility) — a coach assignment needs (i) the member to be able to read the
coach's program (a Team-scoped read arm on the four program tables, which is **B39's
territory** — the planner must coordinate: either B37 ships a minimal "programs pushed to a
Team are readable by its members" arm that B39 widens, or assignment copies the program; note
B34's recorded constraint that program children must stay author-only readable **or** the
device's standalone pull shape changes — a pushed program readable by members would be pulled
onto every member's phone by the current bare pulls, so the planner must either keep pushed
programs out of the sync mirror (read online, like the feed) or change the pull), and (ii) a
run created for the member — by a `security definer` function / edge function acting for the
coach, or by the member accepting an assignment (`team_assignments` row the member's phone
turns into `startProgramRun` on their own device — the cleaner reading under offline-first and
the self-only run insert; the planner weighs both); **pushed content** — a `team_posts` or
`announcements` table (coach-written, member-readable, online-only like Teams) with kinds
`announcement | program | workout`, shown on the team page above the feed; **the Gate 2
probe** — four simulated users: owner, coach, member, outsider: coach reads a member's workout
rows, member cannot read another member's non-visible rows, outsider reads none; member
accepts / receives an assignment and `readActiveRun` would resolve it; announcements readable
by members only. Limits for announcement text in `@training-math` `limits.ts`. No new
dependency expected; the ERD gains the new tables and policy arms; the flowchart gains the
coaching paths.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B36 not yet on it — B31, B34 and B35 add device
schema V11–V13, migrated on open). To update: stop the server (`netstat -ano | findstr :8081`
→ `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`,
`npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in B30–B36), then
`npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps. Check order: `expo start --offline` ~150 s → `tsc`
→ lint → Jest; Gate 2 frees ports 8097 / 8099, renders the diagrams with `mmdc`, and runs live
HTTP probes through the PowerShell tool with the throwaway-JWT recipe (both recorded in
PIPELINE.md). Builders have hit Jest 30 s timeouts under full-suite load at default workers and
rerun with `--maxWorkers=50%`; Gate 2's cold-cache default-worker runs have passed every time.
Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry
<id>`, `trigger`). Executions 4/5 (B05) through 35 (B36); B37 is next. Reported costs: B05 ≈
$12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2,
B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5,
B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1,
B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9,
B35 ≈ $19.3, B36 ≈ $16.9 (≈ $456 for thirty-one steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B36 first):
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
kill → reopen intact; Workout → Start from a program → run card → Start next session → finish →
next session offered → Stop; **Communities → Create a team (open) → from a second account Find
teams → Join → both see the Team feed and the Home "Your teams" chip → owner switches to Invite
only → Invite lifters → the invitee joins from Communities → Invites; profile Teams section;
Leave**; reconnect → rows and objects in Supabase; sign out; with a throwaway account: Settings
→ Delete account → type DELETE → lands on sign-in, the email no longer signs in, a reopened app
has an empty device database. Flips B05–B36 and their features to Done as each holds. (2)
**Moderation:** pick an appeal email for `docs/CONTENT_POLICY.md`; call `moderate` once with your
signed-in token on a throwaway post (probe list in DEFERRED). (3) Supabase Dashboard →
Authentication → Providers → Email → turn "Confirm email" off (plan of record; the session's
toggle was declined by the permission layer). (4) The six external blockers — B33 video provider
is the step the pipeline skipped. (5) Whether to grant `mmdc` (and Deno) to headless runs. (6)
Product readings to confirm or overrule: no bodyweight rep-record PR book (B10/B13); the bare
"e1RM" label (B13); muscle shading by max (B19); one post per workout and own posts on Home
(B20); post visibility inherits the workout's, no caption (B21); 10 MiB images, PR post = photo
+ New PR flair (B22); votes and comments online-only, 500-char comments (B23); feed preference
per phone, sticky flair filter (B24); public-read avatars, username editable (B25); post /
workout visibility lockstep, three options, body-data control deferred (B26); whole-person mute,
viewer-relative tallies, reports outlive content (B27); export own content only, no photo-post
export, no re-share chains, re-shares hidden from their own owner once the original is hidden
(B28); muscle filter matches any involvement ordered hardest-first, region ∧ muscle may be
empty on purpose, no detail link from the logger's picker (B29); PRs below the coaching content
on the card, history screen kept as the logger's deep link, grow-the-limit show-more (B30);
soft delete for customs, customs never match a region chip, no create-from-picker, no
muscle-map shading for customs (B31); export contents (own rows only; votes, comments, follows,
blocks, mutes, reports and photo binaries out; kg as stored), sweep-before-delete, moderator
accounts refuse self-delete, no grace period, other devices of a deleted account keep their
local copy (B32); programs — soft delete on all four tables, no visibility column until B39,
`target_sets` required but reps / load / RPE optional, weeks unnamed, no description,
swap-style move buttons, explicit Save targets, a new slot starts at 3 sets, `export-data` not
yet exporting programs (B34); runs — finishing the last session ends the run (no loop),
restarting begins at Week 1, advancing is one-way, targets as entry notes, no server
one-active constraint, a deleted pointed-at session slides the run forward, `export-data` not
yet exporting runs (B35); **teams** — open teams have a public roster and invite-only rosters
are members-only, a blocked lifter can still join your open team (never sees your posts), team
names not unique, no ownership transfer (the creator's account deletion deletes the team),
invites are per-user rows rather than codes, members can leave but owners cannot, no team
deletion until B38 (B36).

Next pipeline step after B37 merges: **B38 team-moderation** (check the Build order table for
the exact branch name).
