# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B39 merged; pipeline on B40)

**Thirty-four pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2 has programs, runs, the Teams family
and program visibility. The pipeline is running **B40 marketplace-browse**, the first Marketplace
step. Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on
list is at the end.

**B39 program-visibility (merged, Gate 2 record):** migration
`20261115235525_program_visibility.sql` (applied live, confirmed at Gate 2): enum
`program_visibility (private, followers, team, published)`; `programs.visibility` default
private; `program_team_shares (program_id, team_id)` — insert `owns_program and is_team_member`,
select author or member, delete author; SECURITY DEFINER `private.program_visible(pid, owner,
vis, deleted)` is the one rule (author always, else live and: published → any signed-in user;
followers → a follower not blocked either way; team → a member of a shared team; blocks do not
cut the team or published arms, mutes play no part); the `programs` select policy is now
"visible programs are readable" using that rule; **the three child tables stay author-only** so
the device's bare child pulls can never ingest another author's rows (B34's constraint,
restated in the migration header); `private.program_tree_json` is the one gate-free tree
builder, used by the new `public.program_payload(p_program)` (gated by `program_visible`,
EXECUTE revoked from PUBLIC / anon, granted to authenticated) and by B37's
`team_program_payload`, whose own gate is unchanged. Device schema V14 adds `visibility` to the
mirror; `TABLE_COLUMNS.programs` carries it so the chips work offline and sync. App:
`programs.ts` `setProgramVisibility`, `PROGRAM_VISIBILITY_WORDS` / `_ORDER`; `social/
programShares.ts` (list / share / unshare, online); `components/programs/
ProgramVisibilitySection.tsx` on the program page — Only you / Followers / Team / Published chips
with a meaning line, a team toggle list when Team is chosen (standard offline message), and a
"Still shared with N teams you left — Stop sharing" row (review fix). Copied programs start
private. **Gate 2 probes:** SQL (rolled back; A, B, C, team T) — private: B 0 / null;
followers: follower reads row + payload, non-follower 0 / null, blocked follower 0; team:
member reads row + payload (slot 100 kg), non-member 0 / null; published: anyone reads row +
payload, **bare child reads 0**; soft-deleted: author still reads, others 0 / null; B37
regression: a private program pushed to T still returns through `team_program_payload` while
the general RPC returns null; C sharing A's program and A sharing with a team A is not in both
refused (42501); anon RPC → permission denied. **HTTP API pass with a real throwaway JWT**
(persistent probe rows, cleaned up after): the published row reads, the private row does not,
weeks / workouts / exercises read as empty, an embed returns `program_weeks: []`, `rpc/
program_payload` returns the full tree for the published program and `null` for the private
one; no-token RPC → 401, no-token table read → `[]`. Gate 2 reran in order: regenerate typed
routes → `tsc` clean → lint clean → Jest 151 suites / 1576 tests on a cold cache at default
workers; `mmdc` rendered both diagrams (OK). Statuses: B39 Built; PRG-4 Built. Device-only:
each chip in airplane mode surviving kill and reopen, the column landing after reconnect,
ticking a team creating a share row, a second account in that team reading the payload (on
device after B40). **Product calls recorded:** "friends" = followers; blocks cut the followers
arm only; mutes ignored; a team program with no shares is private in effect; shares persist when
the author leaves the team or switches visibility; no reader-facing screen until B40.

**Earlier:** B38 team-moderation (TEAM-4), B37 team-coaching (TEAM-3, TEAM-5), B36 teams
(TEAM-1, TEAM-2; SOC-10 / YOU-6 Teams halves), B35 run-program (PRG-3, LOG-1), B34
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

**B40 marketplace-browse** (planning now): Marketplace tab lists published programs with
Postgres full-text search; program page shows author, length, days per week and every workout;
Save and Start makes it the active program. Step DoD: any published program is findable and
startable in one action. Covers MKT-1, MKT-4, MKT-5. Depends on B39, B35. Standing inputs for
its planner: the Marketplace tab (`app/(tabs)/marketplace.tsx`) is a **placeholder skeleton**
with fake cards; **no full-text search exists anywhere yet** (no tsvector columns, no
`textSearch` calls) — the planner adds a generated `tsvector` column (or expression index) on
`programs.name` plus whatever searchable text exists (there is **no program description
column** — B34 deferred it to "when something reads it"; B40 is that something, so a nullable
`description` with a CHECK and a `limits.ts` entry is in scope if the planner wants
searchable text beyond the name, recorded either way), a GIN index, and a PostgREST
`textSearch` (`websearch`) query filtered to `visibility = 'published'` — the `programs` read
policy already admits published rows to any signed-in user (B39), so the list needs no new
policy; **the program page reads content online through `public.program_payload`** (B39 built it
as the reader path; no client wrapper exists yet — B40 writes the parse once, in
`social/programs...` or beside `teamCoaching.ts`'s payload parsing, reusing its shape-check
discipline rather than copying it); "author, length, days per week" come from the `programs`
row (author via `profiles` embed, `profiles` select is public) and from the payload (weeks
count, workouts per week); **Save and Start = `createProgramFromPayload` (B37, copies the tree
into the lifter's own programs; slots the phone cannot log copy with null exercise id) →
`startProgramRun` (B35)** — exactly the B37 accept flow, so the planner should extract that
sequence into one shared function rather than a second copy (the Marketplace page and the team
assignment banner are then two callers of one "save and start" home); a plain "Save" (copy
without starting) is the B37 push-save precedent; blocked authors' published programs may be
filtered client-side (recorded B39 option); counts, featured, votes and comments are **B41**;
offline: the Marketplace is an online surface (the feed precedent) with the standard message,
while the saved copy and the run are device-local afterwards; the Gate 2 probe: a published
program is found by a word of its name through the API (`programs?select=...&vis=eq.published&
name_fts=...` or the `fts` column), a private one is not, a throwaway user's save-and-start
yields a run on real SQLite in Jest (the B35 four-session flow as precedent). No new dependency
expected; the ERD gains the search column / index (and description if added); the flowchart
gains the Marketplace tab → program page → Save and Start path.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B39 not yet on it — B31, B34, B35 and B39 add
device schema V11–V14, migrated on open). To update: stop the server (`netstat -ano | findstr
:8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach
main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in
B30–B39), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps. Check order: `expo start --offline` ~150 s → `tsc`
→ lint → Jest; Gate 2 frees ports 8097–8099, renders the diagrams with `mmdc`, and runs live
HTTP probes through the PowerShell tool with the throwaway-JWT recipe (both recorded in
PIPELINE.md; persistent probe rows must be deleted afterwards — uuid columns need `id::text
like` in cleanup counts). Builders have hit Jest 30 s timeouts under full-suite load at default
workers and rerun with `--maxWorkers=50%`; Gate 2's cold-cache default-worker runs have passed
every time. Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`,
`retry <id>`, `trigger`). Executions 4/5 (B05) through 38 (B39); B40 is next. Reported costs:
B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9,
B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4,
B19 ≈ $8.5, B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5,
B26 ≈ $19.1, B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3,
B34 ≈ $21.9, B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6, B39 ≈ $14.5 (≈ $503 for
thirty-four steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B39 first):
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
kill → reopen intact → **Who can see this: each chip in airplane mode, kill, reopen (sticks) →
reconnect (column in Supabase) → Team → tick a team (share row in Supabase)**; Workout → Start
from a program → run card → Start next session → finish → next session offered → Stop;
Communities → Create a team (open) → second account joins → Team feed and Home chips → switch to
Invite only → Invite → join via invite → profile Teams section; owner → Make coach on the second
account; coach → Announce, push a program (member Saves it), push a workout (member Starts it),
Assign a program (member taps Start → Workout tab shows the run); coach opens the member's
profile → History shows a private workout → tap → full session; owner → Hide from Team feed on
the member's post (member's Team feed drops it, their Home keeps it) → Unhide → Remove from team
→ the removed member cannot rejoin once invite-only → Remove a push → Delete team; reconnect →
rows and objects in Supabase; sign out; with a throwaway account: Settings → Delete account →
type DELETE → lands on sign-in, the email no longer signs in, a reopened app has an empty device
database. Flips B05–B39 and their features to Done as each holds. (2) **Moderation:** pick an
appeal email for `docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on a
throwaway post (probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers →
Email → turn "Confirm email" off (plan of record; the session's toggle was declined by the
permission layer). (4) The six external blockers — B33 video provider is the step the pipeline
skipped. (5) Whether to grant `mmdc` (and Deno) to headless runs. (6) Product readings to
confirm or overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM" label (B13);
muscle shading by max (B19); one post per workout and own posts on Home (B20); post visibility
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
optional, weeks unnamed, no description, swap-style move buttons, explicit Save targets, a new
slot starts at 3 sets, `export-data` not yet exporting programs (B34); runs — finishing the
last session ends the run (no loop), restarting begins at Week 1, advancing is one-way, targets
as entry notes, no server one-active constraint, a deleted pointed-at session slides the run
forward, `export-data` not yet exporting runs (B35); teams — open teams have a public roster and
invite-only rosters are members-only, a blocked lifter can still join your open team (never
sees your posts), team names not unique, no ownership transfer, invites are per-user rows,
members can leave but owners cannot (B36); coaching — coaches see members' private workouts
(blocks win; PRs, posts, photos, analyses and body data stay closed; members are told on the
team page), the owner is implicitly a coach, assignments are accepted with one tap and copy the
program, the coach's custom exercises do not copy, coach access ignores mutes, Coach's corner
shows the newest 20 pushes (B37); moderation — removal is not a ban, a hide is curation (the
post stays visible on Home and the profile), re-shares of a hidden post stay until hidden too,
no hide reasons or log, team deletion behind a plain confirm (B38); **program visibility** —
"friends" means followers, blocks cut only the followers arm, mutes ignored, a Team program
with no shares is private in effect, shares persist when the author leaves the team or
switches visibility, a soft-deleted program vanishes for everyone but the author, nobody has a
screen to read a shared program until B40 (B39).

Next pipeline step after B40 merges: **B41 marketplace-featured-votes-comments** (check the
Build order table for the exact branch name).
