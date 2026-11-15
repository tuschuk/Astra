# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B32, B34–B38 merged; pipeline on B39)

**Thirty-three pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2 has programs, runs and the whole Teams
family (create, coaching, moderation). The pipeline is running **B39 program-visibility**.
Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list
is at the end.

**B38 team-moderation (merged, Gate 2 record):** migration `20261115232206_team_moderation.sql`
(applied live, confirmed at Gate 2): delete policy "owners remove members" on `team_members`
(`is_team_owner(team_id) and role <> 'owner'`, OR-ing with B36's leave arm — the owner row is
untouchable by everyone, owner included); SECURITY DEFINER trigger `on_team_member_removed`
(`private.handle_team_member_removed`) — on any membership delete it clears the member's
`team_assignments`, and when `auth.uid()` is not the departing member (a removal) also their
standing `team_invites` row, so removal from an invite-only team sticks while a voluntary leave
keeps the invite (B36 G12); new `team_feed_hides` (team, post, hidden_by; insert / delete
owner-only, select for feed readers — members or anyone when the team is open; FKs cascade
from teams and posts; builder added an index on `post_id`); delete arm "owners remove pushes"
on `team_posts`; delete policy "owners delete their teams" (every team-scoped table cascades).
App: `teams.ts` gains `removeMember`, `hideTeamPost`, `unhideTeamPost`, `teamFeedHides`,
`deleteTeam`; `confirmRemoveMember.ts`, `confirmDeleteTeam.ts`; the team page loads the hide set
with the first feed page, filters hidden posts out for everyone but the owner (who sees a
"Hidden" marker with Unhide), adds Hide from Team feed under each post, Remove from team on
non-owner roster rows, Remove on any push, and Delete team behind a plain confirm. **A hide is
curation, not privacy:** the post stays visible on Home and the author's profile to everyone
posts RLS already admits. **Gate 2 live probe (owner, coach, two members, outsider; rolled
back):** coach / member / outsider removals 0 rows, member deleting the team 0; owner removal 1
row with the removed member's assignments and invite gone; owner cannot remove the owner row;
owner hide lands and the post still reads on Home; outsider reads the open team's hide list;
coach unhide 0, owner unhide 1; owner deletes the coach's push (1), coach cannot delete the
owner's (0); voluntary leave clears assignments and keeps the invite; owner deletes the team →
every team-scoped row gone, the member's post survives; coach hide and a removed member's
rejoin to an invite-only team both refused (42501). Gate 2 reran in order: regenerate typed
routes → `tsc` clean → lint clean → Jest 148 suites / 1555 tests on a cold cache at default
workers; `mmdc` rendered both diagrams (OK). Statuses: B38 Built; TEAM-4 Built. Device-only: two
accounts — hide a post on the owner's phone and compare the member's Team feed with their Home,
unhide, remove a member and confirm they cannot rejoin once invite-only, remove a push, delete
the team, judge the layout. **Product calls recorded:** removal is not a ban (an open team can
be rejoined; invite-only is the keep-out tool); hiding never changes a post's visibility; a
member's re-share of a hidden post is a separate post and stays until hidden too; no hide
reasons, moderation log or notice to the author; team deletion included on B36's explicit
deferral.

**Earlier:** B37 team-coaching (TEAM-3, TEAM-5), B36 teams (TEAM-1, TEAM-2; SOC-10 / YOU-6
Teams halves), B35 run-program (PRG-3, LOG-1), B34 program-builder (PRG-1, PRG-2), B32
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

**B39 program-visibility** (planning now): program visibility column — private, friends
(followers), Team, published — enforced by RLS. Step DoD: each level is verified through the API
with two users. Covers PRG-4. Depends on B34, B36. Standing inputs for its planner — this step
has a **recorded hard constraint from B34** that governs its whole shape: the device pulls the
three program child tables (`program_weeks`, `program_workouts`, `program_exercises`) **bare**
(`supabaseTransport.ts` `pullProgramRows` filters `user_id` only on `programs`; the children
rely on author-only select policies to return the caller's rows and nobody else's). Widening the
children's select policies to followers / Team members / everyone would make every reader's next
sync ingest other authors' program rows into their device mirror. So the planner must choose
and record one of: (a) **readers read shared programs online, never through the sync mirror** —
keep every program-table select policy author-only for the *mirror* path and expose shared
programs through a different read (B37's `public.team_program_payload` is exactly this shape: a
SECURITY DEFINER JSON RPC gated by visibility; B39 generalises it to `program_payload(program)`
whose gate reads the new `visibility` column — private: author; followers: author or a follower
not blocked; team: author or a member of a team the program is shared with; published: any
signed-in user — and B40's Marketplace list reads `programs` rows themselves, so the **`programs`
parent** select policy can be widened to the visibility rule because its pull is user-filtered
client-side, while the children stay author-only and travel only inside the JSON), or (b) change
the pull shape so children are fetched through their parent with an author filter (touches
every sync consumer; B34 and B35 both recorded this as the costly alternative). The handoff's
recommendation is (a). Schema: `programs.visibility` enum `program_visibility (private,
followers, team, published)` default private (B34 shipped no column on purpose), a
`program_team_shares (program_id, team_id)` table for the Team level (a program can be shared
with more than one team; the author must be a member; `is_team_member` gates readers), server
CHECK / limits unchanged; the `visibility` column is a `SyncedTable` column (add to
`TABLE_COLUMNS`, device schema V14, migrates on open) so the author edits it offline and it
syncs; the author's UI is a visibility chip row on the program page (the B26 post-visibility
chips pattern) plus a Team picker when `team` is chosen; B37's team pushes keep working (its
RPC gate can additionally honour the new column, or B39 subsumes `team_program_payload` into
the general RPC — the planner records which, and keeps the B37 behaviour that a pushed /
assigned program is readable by the team regardless of the column); "published" surfaces
nothing yet beyond RLS (B40 lists them); `export-data` still exports neither programs nor runs
(recorded). Gate 2 probe: two users through SQL claims **and** through the HTTP API with a real
throwaway JWT (the step DoD says "through the API": the PIPELINE.md recipe) — for each level,
the non-author reads the `programs` row and the payload as the policy predicts, never a child
row directly; a published program's rows do **not** appear in a non-author's pulled mirror
(verify by reading children bare as the other user → 0). No new dependency expected; the ERD
gains the enum, column and shares table; the flowchart gains the visibility controls and the
online shared-program read path. After B39: B40 marketplace-browse (full-text search over
published programs, Save and Start — `createProgramFromPayload` from B37 is the copy shape).

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B38 not yet on it — B31, B34 and B35 add device
schema V11–V13, migrated on open). To update: stop the server (`netstat -ano | findstr :8081`
→ `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`,
`npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in B30–B38), then
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
Executions 4/5 (B05) through 37 (B38); B39 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3,
B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4,
B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9, B35 ≈ $19.3,
B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6 (≈ $489 for thirty-three steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B38 first):
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
feed and Home chips → switch to Invite only → Invite → join via invite → profile Teams section;
owner → Make coach on the second account; coach → Announce, push a program (member Saves it),
push a workout (member Starts it), Assign a program (member taps Start → Workout tab shows the
run); coach opens the member's profile → History shows a private workout → tap → full session;
**owner → Hide from Team feed on the member's post (member's Team feed drops it, their Home
keeps it) → Unhide → Remove from team → the removed member cannot rejoin once invite-only →
Remove a push → Delete team**; reconnect → rows and objects in Supabase; sign out; with a
throwaway account: Settings → Delete account → type DELETE → lands on sign-in, the email no
longer signs in, a reopened app has an empty device database. Flips B05–B38 and their features
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
tables, no visibility column until B39, `target_sets` required but reps / load / RPE optional,
weeks unnamed, no description, swap-style move buttons, explicit Save targets, a new slot starts
at 3 sets, `export-data` not yet exporting programs (B34); runs — finishing the last session
ends the run (no loop), restarting begins at Week 1, advancing is one-way, targets as entry
notes, no server one-active constraint, a deleted pointed-at session slides the run forward,
`export-data` not yet exporting runs (B35); teams — open teams have a public roster and
invite-only rosters are members-only, a blocked lifter can still join your open team (never
sees your posts), team names not unique, no ownership transfer (the creator's account deletion
deletes the team), invites are per-user rows rather than codes, members can leave but owners
cannot (B36); coaching — coaches see members' private workouts (blocks win; PRs, posts, photos,
analyses and body data stay closed; members are told on the team page), the owner is
implicitly a coach, assignments are accepted with one tap and copy the program (coach edits do
not follow), the coach's custom exercises do not copy, coach access ignores mutes, Coach's
corner shows the newest 20 pushes (B37); **moderation** — removal is not a ban, a hide is
curation (the post stays visible on Home and the profile), re-shares of a hidden post stay
until hidden too, no hide reasons or log, team deletion behind a plain confirm (B38).

Next pipeline step after B39 merges: **B40 marketplace-browse** (check the Build order table
for the exact branch name).
