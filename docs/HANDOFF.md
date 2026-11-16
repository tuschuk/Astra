# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B40 merged; pipeline on B41)

**Thirty-five pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider); Phase 2 has programs, runs, the Teams family,
program visibility and the first Marketplace surface. The pipeline is running **B41
marketplace-featured**. Gates are delegated to the session (CLAUDE.md, "Autonomous sessions").
Tristen's hands-on list is at the end.

**B40 marketplace-browse (merged, Gate 2 record):** migration `20261116004257_marketplace_search.sql`
(applied live, confirmed at Gate 2): `programs.search tsvector generated always as
(to_tsvector('simple', name)) stored`, GIN index `programs_search_idx`, partial index
`programs_published_idx (created_at desc, id desc) where visibility = 'published' and deleted_at
is null`. **No new policy, RPC or device schema** — B39 opened the server; the generated column
is **not** in `TABLE_COLUMNS.programs` and must stay out (sync selects named columns). App:
`social/marketplace.ts` (`loadPublishedPrograms` with `eq visibility published`, `is deleted_at
null`, `textSearch('search', words, websearch / simple)`, newest-first, grow-the-limit paging;
`loadProgramPage` = row read + `rpc('program_payload')` parsed by the **imported**
`parseProgramPayload`; pure `programFacts` / `programFactsLine` — "N weeks · M days/week", a
range when weeks differ); `programs/saveAndStart.ts` is the one Save-and-Start home
(`saveAndStartProgram` = `createProgramFromPayload` then `startProgramRun`, copy failure throws,
run failure returns `started: false`; `saveProgramOnly` added by review) and the team
assignment accept flow now calls it; `components/programs/ProgramPayloadView.tsx` is the weeks →
workouts → slots renderer extracted from `TeamProgramSheet`; the Marketplace tab is rewritten
(debounced search, browse list of name + author cards, Show more, standard offline message, the
featured skeleton removed — B41's); new route `app/marketplace-program/[id].tsx` (author line →
profile, facts line, full breakdown, **Save and Start** → Workout tab, Save to my programs, own
program → Open in editor, "This will replace your current program" when a run is active, spent
buttons after success, a Go-to-Workout button when exercises were skipped so the count stays
visible). `screens.test.tsx` deleted (its only case was the placeholder). **Gate 2 probes:** SQL
(rolled back) — the author's unfiltered search sees 3 (own private and deleted included by the
author arm); another user's browse-shape search returns exactly the published program, their
unfiltered search also 1 (RLS alone hides private and deleted), the private program's own word
finds 0, a junk query with quotes and operators does not error. **HTTP API pass with a real
throwaway JWT** (probe rows cleaned up): `search=wfts(simple).<word>` with the browse filters
returns the published program, without filters still only the published one, the private
program's word returns `[]`, the browse list and the `profiles` author embed work, no-token
search → `[]`. Gate 2 reran in order: regenerate typed routes → `tsc` clean → lint clean → Jest
155 suites / 1609 tests on a cold cache at default workers; `mmdc` rendered both diagrams (OK).
Statuses: B40 Built; MKT-1, MKT-4, MKT-5 Built. Device-only: account A publishes a program;
account B finds it on the Marketplace and by a word of its name, opens the page (author, weeks,
days per week, breakdown), Save and Start → Workout tab shows the run → Start next session opens
A's Day 1 with targets; Marketplace in airplane mode shows the connection message; B's copy
survives kill and reopen and syncs. **Product calls recorded:** no `description` column yet
(lands with the first reader, likely B41 cards); browse cards show name + author only (child
tables are author-only, so counts would cost N RPCs); search matches whole words only, no
relevance ranking, no author search; blocked authors' published programs are not filtered; no
confirm before replacing a running program (a warning line instead); a deep link to a
followers- or team-shared program opens on this page with Save and Start.

**Earlier:** B39 program-visibility (PRG-4), B38 team-moderation (TEAM-4), B37 team-coaching
(TEAM-3, TEAM-5), B36 teams (TEAM-1, TEAM-2; SOC-10 / YOU-6 Teams halves), B35 run-program
(PRG-3, LOG-1), B34 program-builder (PRG-1, PRG-2), B32 export-and-delete-account (NFR-6), B31
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

**B41 marketplace-featured** (planning now): program votes and comments following the post
pattern; featured section ranked by popularity over week, month, year and all time. Step DoD:
all four windows rank correctly and update as votes change. Covers MKT-2, MKT-3. Depends on
B40, B23. Standing inputs for its planner: **the post pattern to follow** — `votes (post_id,
user_id) value in (-1, 1)` with owner-only writes and a trigger that enforces upvote-only from
the post's flair, `comments` (body ≤ 500 via `commentLimits.ts` mirroring the CHECK, readable
while the post is visible), `security_invoker` views `post_scores` and `post_hot_scores` (the
latter carries the cited Reddit hot formula with its epoch constant), app modules `social/
votes.ts`, `comments.ts`, `commentLimits.ts` and the shared `usePostListActions` hook; the
planner must choose between **separate `program_votes` / `program_comments` tables** (the
straightforward reading of "exactly as feed posts do" — same shapes keyed by `program_id`,
readable where `private.program_visible(...)` passes, writes only on published programs so a
vote cannot leak a private program's existence, owner-only writes, one program_scores view) and
a polymorphic target column on the existing tables (rejected by default: it would widen the
post tables' RLS and triggers for a different visibility rule — record the choice); the
**featured section** needs vote counts over time windows: a `security_invoker` view (or four) of
`sum(value)` over `program_votes` filtered by `created_at >= now() - interval` for week / month /
year plus all-time, ordered desc then newest, limited — read online by the Marketplace tab above
the browse list (the "Featured this week" skeleton B40 removed is the surface; four chips choose
the window); "update as votes change" is satisfied by re-reading on focus / after a vote (the
B23 pattern — no realtime, nothing speculative); downvotes on programs follow MKT-3's "exactly as
feed posts" (up and down, since programs have no flair) — record it; comments on programs need a
comments screen — reuse the B23 `post-comments/[id]` screen shape with a program variant or a
shared component (the third-copy rule applies if a third list appears); moderation of program
comments falls under B27's global `reports` (the planner names whether `reports` grows a
`program_id` / `program_comment_id` target or defers); limits — comment body cap already in
`commentLimits.ts` (reuse, do not copy); the Gate 2 probe — two users: voting on a published
program lands, on a private program is refused, the featured view ranks a program with two
upvotes above one with one for the window that contains them and not for a window that
excludes them (insert with an old `created_at` as postgres to test windows), a vote change
re-ranks, a non-author cannot read comments on a program they cannot see. No new dependency
expected; the ERD gains the tables and views; the flowchart gains the featured section, votes
and comments on the program page.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B40 not yet on it — B31, B34, B35 and B39 add
device schema V11–V14, migrated on open). To update: stop the server (`netstat -ano | findstr
:8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach
main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in
B30–B40), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps. Check order: `expo start --offline` ~150 s → `tsc`
→ lint → Jest; Gate 2 frees ports 8097–8099, renders the diagrams with `mmdc`, and runs live
HTTP probes through the PowerShell tool with the throwaway-JWT recipe (both recorded in
PIPELINE.md; persistent probe rows are deleted afterwards). Builders have hit Jest 30 s timeouts
under full-suite load at default workers and rerun with `--maxWorkers=50%`; Gate 2's cold-cache
default-worker runs have passed every time. Session helper: `automation/state/pipe.mjs`
(gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`). Executions 4/5 (B05) through
39 (B40); B41 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5,
B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0,
B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0,
B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5,
B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9, B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5,
B38 ≈ $11.6, B39 ≈ $14.5, B40 ≈ $13.9 (≈ $517 for thirty-five steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B40 first):
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
reconnect (column in Supabase) → Team → tick a team (share row in Supabase) → **Published**;
Workout → Start from a program → run card → Start next session → finish → next session offered
→ Stop; Communities → Create a team (open) → second account joins → Team feed and Home chips →
switch to Invite only → Invite → join via invite → profile Teams section; owner → Make coach on
the second account; coach → Announce, push a program (member Saves it), push a workout (member
Starts it), Assign a program (member taps Start → Workout tab shows the run); coach opens the
member's profile → History shows a private workout → tap → full session; owner → Hide from Team
feed on the member's post → Unhide → Remove from team → cannot rejoin once invite-only → Remove
a push → Delete team; **second account → Marketplace → the published program is listed → search a
word of its name → tap → author / weeks / days per week / breakdown → Save and Start → Workout
tab shows the run → Start next session opens Day 1 with targets; Marketplace in airplane mode →
connection message**; reconnect → rows and objects in Supabase; sign out; with a throwaway
account: Settings → Delete account → type DELETE → lands on sign-in, the email no longer signs
in, a reopened app has an empty device database. Flips B05–B40 and their features to Done as
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
vanishes for everyone but the author (B39); **Marketplace** — no description column, name +
author cards, whole-word search without ranking or author search, Show more re-reads a longer
list, blocked authors not filtered, a warning line rather than a confirm before replacing a
running program, deep links to followers- or team-shared programs open on the same page (B40).

Next pipeline step after B41 merges: **B42 trend-analysis** (check the Build order table for
the exact branch name).
