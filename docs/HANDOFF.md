# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B32, B34–B37 merged; pipeline on B38)

**Thirty-two pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2 has programs, runs, Teams and Team
coaching. The pipeline is running **B38 team-moderation**. Gates are delegated to the session
(CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B37 team-coaching (merged, Gate 2 record):** migration `20261115222643_team_coaching.sql`
(applied live, confirmed at Gate 2): `team_members` update policy "owners change member roles"
(owner only, never the owner row, `with check role in (coach, member)`) with UPDATE revoked on
the table and granted back on `role` only; helpers `private.is_team_coach` (owner ∪ coach),
`user_in_team`, `coach_reads_logs` (shared team where the caller coaches and no block either
way); **workouts select policy** = `workout_visible(...) or coach_reads_logs(user_id)`;
**D1 (builder deviation, verified live):** the plan's coach arm in `can_view_workout` would
have let coaches read PRs (records read through it), so a sibling `private.can_read_workout_log`
carries the arm and `workout_exercises` / `sets` select through it while `can_view_workout` is
unchanged; enum `team_post_kind (announcement, program, workout)`; `team_posts` (coach-insert
with `owns_program` guards, member-read, author-delete, CHECK biconditionals on the payload
columns); `team_assignments` (coach-insert for a member not blocked, assignee / coach read and
delete; consumed by the member's Start); definer RPCs `public.team_program_payload` and
`team_workout_payload` returning JSON to members of a team the program was pushed to or
assigned within, EXECUTE revoked from PUBLIC / anon and granted to authenticated (the internal
`private.program_workout_json` keeps PUBLIC EXECUTE but only postgres has USAGE on `private`,
so app roles cannot reach it). App: `social/teamCoaching.ts` (pushes, assignments, payload fetch
and parse), `teams.ts` `setMemberRole`, `programs/copyProgram.ts` (payload → member-owned
program in one transaction; slots the phone cannot log copy with `exercise_id = null`),
`workout/startPushedWorkout.ts`, `components/teams/TeamProgramSheet.tsx`, `CoachPushSheet.tsx`,
`useTeamCoaching.tsx`, `ProgramPickerSheet` `onPick` mode, team page (assignment banner,
Coach's corner, Push to team, role badges with Make / Remove coach, Assign a program, the
"Coaches of this team can see your training log" notice), tappable History rows on others'
profiles → new `app/session/[id].tsx` read-only workout view. Announcement cap
`MAX_TEAM_ANNOUNCEMENT_LENGTH = 2000` in `@training-math` `limits.ts`. **Gate 2 live probe
(owner, coach, two members, outsider; rolled back):** member self-promotion 0 rows, owner
promotion 1; a plain member reads 0 of another member's private workout, the coach reads it and
its set (1 / 1) and 0 of the member's posts; members see the pushes (2), the outsider 0; the
assignee's payload carries the program name and a slot's kg; the assignee sees the assignment,
another member does not but gets the pushed program's payload; the outsider's payload is null;
promote-to-owner, pushing someone else's program and an outsider's assignment refused (42501);
anon RPC call → permission denied; after a block the coach reads 0 (1 before). Gate 2 reran in
order: regenerate typed routes → `tsc` clean → lint clean → Jest 146 suites / 1542 tests on a
cold cache at default workers; `mmdc` rendered both diagrams (OK). Statuses: B37 Built; TEAM-3,
TEAM-5 Built. Device-only: two accounts — Make coach, Announce, push a program → Save, push a
workout → Start, Assign → Start → Workout tab shows the run, coach opens a member's private
workout from their profile History, block or leave hides it. **Product calls recorded:** coaches
see members' *private* workouts (blocks win; PRs, posts, photos, analyses, body data stay
closed; members are told on the team page); the owner is implicitly a coach; assignment is
accepted by the member with one tap (never auto-started); assignment copies the program (coach
edits do not follow); coach access ignores mutes.

**Earlier:** B36 teams (TEAM-1, TEAM-2; SOC-10 / YOU-6 Teams halves), B35 run-program (PRG-3,
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

**B38 team-moderation** (planning now): owners remove members and remove posts from the Team
feed. Step DoD: both actions work and are refused for non-owners by RLS. Covers TEAM-4. Depends
on B36. Standing inputs for its planner: today `team_members` delete = "members leave teams"
(`user_id = auth.uid() and role <> 'owner'`) — removal is an owner-only delete arm on another
member's row (never the owner row; decide whether a removed member may rejoin an open team at
once, and whether removal also deletes their standing invite / assignments — cascades on
`team_members` do not exist, so the planner names what a removal cleans up); **the Team feed is
not a table** — it is members' regular `posts` filtered to the roster through `loadFeedPage`
(B36), so "remove a post from the Team feed" cannot be a `posts` delete (the author owns the
post; B27's `moderate` function and `reports` cover global moderation) — the honest shape is a
`team_feed_hides` (team_id, post_id, hidden_by) table the owner writes, applied as an exclusion
in the team page's feed query (online read; the Home feed is untouched), plus owner deletion of
`team_posts` pushes (today author-only delete — add an owner arm); team deletion is "B38's
family" per the B36 plan (a `teams` delete policy owner-only with the existing cascades; the
planner decides whether it is in scope — TEAM-4 does not name it, so it is a deliberate
inclusion or a recorded deferral); all rules live once in `private.is_team_owner` (exists);
online-only like Teams; limits — none new unless a hide reason is stored; the Gate 2 probe is
the B36/B37 recipe — owner removes a member (1 row), a coach or member removing (0 rows / 42501),
the owner row cannot be removed, owner hides a member's post and the team page's query excludes
it while Home still shows it, non-owner hide refused, owner deletes a coach's push. No new
dependency expected; the ERD gains the hides table and policy arms; the flowchart gains the
moderation controls on the team page. After B38: B39 program-visibility (B34's recorded
constraint: program children must stay author-only readable or the device's standalone pull
changes; B37's RPCs are team-scoped stopgaps B39 can subsume), then B40 Marketplace.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B37 not yet on it — B31, B34 and B35 add device
schema V11–V13, migrated on open). To update: stop the server (`netstat -ano | findstr :8081`
→ `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`,
`npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in B30–B37), then
`npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps. Check order: `expo start --offline` ~150 s → `tsc`
→ lint → Jest; Gate 2 frees ports 8097–8099 (builders sometimes leave an Expo process on 8099
and fall back to 8098), renders the diagrams with `mmdc`, and runs live HTTP probes through the
PowerShell tool with the throwaway-JWT recipe (both recorded in PIPELINE.md). Builders have hit
Jest 30 s timeouts under full-suite load at default workers and rerun with `--maxWorkers=50%`;
Gate 2's cold-cache default-worker runs have passed every time. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 36 (B37); B38 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3,
B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4,
B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9, B35 ≈ $19.3,
B36 ≈ $16.9, B37 ≈ $20.5 (≈ $477 for thirty-two steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B37 first):
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
next session offered → Stop; Communities → Create a team (open) → second account joins → Team
feed and Home chips → switch to Invite only → Invite → join via invite → profile Teams section →
Leave; **owner → Make coach on the second account; coach → Announce, push a program (member
Saves it), push a workout (member Starts it), Assign a program (member taps Start → Workout tab
shows the run); coach opens the member's profile → History shows a private workout → tap →
full session; member blocks or leaves → hidden again**; reconnect → rows and objects in
Supabase; sign out; with a throwaway account: Settings → Delete account → type DELETE → lands on
sign-in, the email no longer signs in, a reopened app has an empty device database. Flips
B05–B37 and their features to Done as each holds. (2) **Moderation:** pick an appeal email for
`docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on a throwaway post
(probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers → Email → turn
"Confirm email" off (plan of record; the session's toggle was declined by the permission layer).
(4) The six external blockers — B33 video provider is the step the pipeline skipped. (5) Whether
to grant `mmdc` (and Deno) to headless runs. (6) Product readings to confirm or overrule: no
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
tables, no visibility column until B39, `target_sets` required but reps / load / RPE optional,
weeks unnamed, no description, swap-style move buttons, explicit Save targets, a new slot starts
at 3 sets, `export-data` not yet exporting programs (B34); runs — finishing the last session
ends the run (no loop), restarting begins at Week 1, advancing is one-way, targets as entry
notes, no server one-active constraint, a deleted pointed-at session slides the run forward,
`export-data` not yet exporting runs (B35); teams — open teams have a public roster and
invite-only rosters are members-only, a blocked lifter can still join your open team (never
sees your posts), team names not unique, no ownership transfer (the creator's account deletion
deletes the team), invites are per-user rows rather than codes, members can leave but owners
cannot, no team deletion until B38 (B36); **coaching** — coaches see members' private workouts
(blocks win; PRs, posts, photos, analyses and body data stay closed; members are told on the
team page), the owner is implicitly a coach, assignments are accepted with one tap and copy the
program (coach edits do not follow), the coach's custom exercises do not copy, coach access
ignores mutes, Coach's corner shows the newest 20 pushes (B37).

Next pipeline step after B38 merges: **B39 program-visibility** (check the Build order table
for the exact branch name).
