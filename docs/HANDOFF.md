# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B43, B46–B50 merged; pipeline on B52)

**Forty-three pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider) and every P0 feature is Built. Phase 2 has
programs, runs, the Teams family, program visibility, the Marketplace, trend analysis, Tool Kit
prefill, profile trends, push notifications, direct messages, the accessibility pass and now the
Gyms core. B44 (deload rules), B45 (strength grades) and B51 (Denver gym import) are Blocked and
skipped. The pipeline is running **B52 gym-leaderboards**. Gates are delegated to the session
(CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B50 gyms-core (merged, Gate 2 record):** two migrations applied live and recorded
(`20261116123049_gyms.sql`, `20261116124327_gym_members_no_truncate.sql`). PostGIS 3.3.7 is
now installed in `extensions`. `gyms (id, name, address, location geography(Point,4326),
created_at)` with a GIST index is readable by any signed-in user and writable by nobody but
migrations: no insert / update / delete policy and the table privileges revoked, so GYM-7's "no
claim or manage path" is structural (probed: insert, update and delete as a user → 42501; anon
select → 42501). Six **fictional** fixture rows ("Sample Gym · Capitol Hill / Highlands / RiNo /
Lakewood / Aurora / Boulder") at real Denver-area points, each commented `FIXTURE — replaced by
B51`; the spread is deliberately asymmetric so a lng/lat inversion cannot pass. `gym_members
(user_id PK → profiles cascade, gym_id → gyms cascade, joined_at)`: the primary key on `user_id`
is the one-active-gym rule; join and switch are the same upsert on `user_id`; leave is a
delete; select is public to signed-in users (the recorded product call, below); insert / update /
delete policies are owner-only; **column grants `insert (user_id, gym_id)` and `update
(user_id, gym_id)`** so `joined_at` has no client writer (Gate 1 fixed the planner's `update
(gym_id)`: PostgREST's upsert SETs the conflict column too, so the switch would have failed) and
a `before update` trigger restamps `joined_at` only when `gym_id` changes; TRUNCATE / REFERENCES
/ TRIGGER revoked by the second migration. `gyms_near(lat, lng, max_rows)` is a `security
invoker` SQL function returning `distance_m` in metres ordered ascending, EXECUTE for
authenticated only. **Probed live:** `gyms_near` from downtown → Capitol Hill 1 393 m first,
Boulder 38 889 m last; from Boulder → Boulder 0 m first (the (lng, lat) ordering is right); as a
real throwaway login over REST with `on_conflict=user_id` and `Prefer: resolution=merge-
duplicates`: join → row, switch → still one row with the new gym and a later server
`joined_at`, re-join of the same gym → `joined_at` unchanged, forged `joined_at` → 403, join as
another user → 42501 (RLS), anon `gyms_near` → 401, leave → zero rows; a second user reads the
roster and the first user's gym and cannot delete their row. Probe users and rows deleted;
`get_advisors` unchanged from before the step. **App:** `social/gyms.ts` (`nearbyGyms` via
`rpc('gyms_near')`, `gymOf`, `loadGym`, `loadGymMembers`, `joinGym` upsert with explicit
`onConflict: 'user_id'`, `leaveGym`, `formatDistance` in miles); the directory at `app/gyms`
asks for **foreground** location only when opened (`expo-location`, the step's one new
dependency, with its `app.json` plugin and permission sentence), coarse accuracy, 10 s cap,
denied / failed → downtown Denver with a one-line notice; coordinates live in screen state only;
the gym page at `app/gym/[id]` (Join, Switch behind a confirm naming the gym being left, Leave,
Members, Gym feed = `loadFeedPage` over the roster with the shared post actions); Communities'
Gyms card shows "Your gym" and **Find your gym**; Home's chip row is renamed **"Your groups"**
with the gym chip first; every profile gains a Gym section; a shared `GymListItem` row. Builder
deviations (in the plan): the second grants migration, `_layout.tsx` route registration, the
`app.json` plugin, the shared row component, the 10 s location cap, Communities holding back the
"join a gym" invite while offline, the fake social client learning `gyms` / `gym_members` /
`rpc`; the gym page copies the team page's feed paging (a shared hook deferred to a third
member-feed surface). **Gate 2 reran in order:** `expo start --offline` → `tsc` clean → lint
clean → Jest 182 suites / 2007 tests on a cold cache at default workers; `mmdc` rendered both
diagrams (OK). **Statuses:** B50 Built; GYM-2, GYM-7 Built; SOC-10 and YOU-6 Built (both halves
shipped); GYM-1 In progress (directory and query shipped, the real Denver set is B51, Blocked).
**Pipeline incident, recorded in `docs/PIPELINE.md`:** the Gate 1 session fixed the plan on the
branch and switched back to `main` before approving; the builder refused ("wrong branch"), the
execution ended success with nothing built, and the builder was re-run by hand with the launcher
(`cmd //c …/run-builder.cmd`, $9.04). Rule: a Gate 1 fix leaves the tree on the step's branch.
**Product calls recorded for Tristen:** gym membership is **public to every signed-in user**
(anyone can see which gym a lifter belongs to — a rough home-location signal; the one-arm
members-only fallback is noted in DEFERRED); the user's location is never stored; fixture names
are fictional; miles only; no map, no name search, no member counts on directory rows, no Hot
sort on the Gym feed; "N members" heading on the gym page like the team page.

**Earlier:** B49 accessibility-pass (NFR-10 — contrast helper and palette-pair test,
`accentText`, font-scale caps on display chrome, heading roles, one-sentence rows; control
outlines exempt from the 3:1 rule is Tristen's call), B48 direct-messages (SOC-12), B47
push-notifications (YOU-4 complete), B46 profile-trends (YOU-7 trends half), B43 tool-kit-prefill
(TK-6), B42 trend-analysis (ANA-5, LOG-10), B41 marketplace-featured (MKT-2, MKT-3), B40
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

**B52 gym-leaderboards** (planning now): `leaderboard_entries` keyed by gym, member, exercise
(squat, bench press, deadlift) and sex division; a board view showing one best verified row per
member; entries stay with their gym when the member switches. Verified rows arrive only through
B53 (which depends on Blocked B33), so this step is tested with fixture rows. Step DoD: with
fixture entries, each board shows two divisions ranked by absolute weight, one row per member,
and a member's rows stay on the old board after a switch. Covers GYM-3 (part), GYM-6 (part),
GYM-8, GYM-9 (part). Depends on B50, B13. Standing inputs for its planner: **the table carries
`gym_id` itself** (never derived through `gym_members`, which is what makes "stays with the old
Gym on a switch" true — the B50 plan's B52 note); the three exercises are the catalog's uuidv5
ids for the squat / bench press / deadlift slugs (one home: `library/`), pinned by a CHECK or a
lookup rather than free text; **weight stored in kg** like every other load (display through the
existing unit setting); **the division is the lifter's own choice**, never inferred — check
whether `profiles` already has a field for it (if a column is added it is user-set, optional,
and body-adjacent enough to be treated as the lifter's own data: visible only through the board
rows the lifter chose to submit, never on the profile by default); **no user write path in
B52** — entries are verified rows from B53, so in B52 the table has a select policy for
authenticated and no insert / update / delete policies for users, and the fixture rows are
inserted by the migration against the fixture gyms (clearly marked, deleted when B51 re-seeds via
the cascade from `gyms`); "one best row per member per exercise per division" is a `distinct on`
view (or `max` with a tie rule — record which) that the board reads ordered by weight
descending; the board is a tab or section on the existing gym page (`app/gym/[id]`), reading
online-only like the rest of Gyms; the probe — two throwaway users with fixture entries, each
board shows two divisions and one row per member, user A switches gyms and A's rows still read
under the old gym, user inserts / updates / deletes on `leaderboard_entries` → 42501; the ERD
gains the table and the view, the flowchart the board on the gym page; no new dependency. After
B52: B53 depends on B33 (Blocked) so is skipped; B54 hydration-and-sleep (depends on B15) is
next; B55 and B56 Blocked.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B50 not yet on it — B31, B34, B35, B39, B42, B47
and B48 add device schema V11–V17, migrated on open). To update: stop the server (`netstat -ano
| findstr :8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout
--detach main`, **`npm ci` in `Astra-main\frontend` (B50 added `expo-location` to the
lockfile)**, then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; the "Pick next item" script skips Blocked steps; both launchers write
stdout and stderr to `automation/state/{builder,planner}.{out,err}.log` (gitignored), replay
stdout for n8n and preserve the exit code; **a Gate 1 plan fix must leave the tree on the
step's branch** (B50's lesson; the manual builder re-run recipe is in the doc). Check order:
`expo start --offline` ~150 s → `tsc` → lint → Jest; Gate 2 frees ports 8097–8099, renders the
diagrams with `mmdc`, and runs live HTTP probes through the PowerShell tool with the
throwaway-JWT recipe (`Invoke-RestMethod`, not `Invoke-WebRequest`, which prompts in
non-interactive mode; persistent probe rows deleted afterwards; an UPDATE whose RLS check fails
raises 42501; `pg_net` deliveries can take up to a minute). Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 48 (B50; its builder re-run by hand); B52 is next. Reported costs:
B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9,
B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4,
B19 ≈ $8.5, B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5,
B26 ≈ $19.1, B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3,
B34 ≈ $21.9, B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6, B39 ≈ $14.5, B40 ≈ $13.9,
B41 ≈ $18.9, B42 ≈ $7.4 planner + an unreported builder, B43 ≈ $12.1, B46 ≈ $12.8,
B47 ≈ $21.2, B48 ≈ $21.9, B49 ≈ $14.6 plus the failed first planner, B50 ≈ $14.3 ($5.05
planner, $0.21 aborted builder, $9.04 manual builder) (≈ $640 reported for forty-three steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B50 first and
run `npm ci`): sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You →
Edit profile; log a multi-exercise workout, one-tap Repeat, force-kill and Resume; mid-workout
after a logged set, open the Tool Kit: 1RM, RPE, %1RM and Plates arrive prefilled; finish in
airplane mode → analysis with muscle map → Share → share sheet → Next → Post / Skip; View
workout → PR badges; History; Edit and Delete; Settings → kg toggle, Privacy ("Who can message
you"), Export your data, Notifications (five switches; "Turn on push" after `eas init`); Tool Kit
timer; Home → Latest / Hot and a flair chip → Share a photo → vote / comment → make a post
private → ⋯ Report → an author's profile → Follow, Re-share, Mute, Block → unblock, Message →
thread → send; Find lifters; Library → chips → a card → detail → PRs and sessions → New exercise
in airplane mode → log → card → edit → delete; Workout → Your programs → New program → weeks /
workouts / exercises → kill → reopen intact → Who can see this → Team → Published; Workout →
Start from a program → run card → Start next session → finish → Stop; Communities → Create a
team → second account joins → Team feed and Home chips → Invite only → Invite → join via invite;
owner → Make coach; coach → Announce, push a program (Save), push a workout (Start), Assign
(Start → run); coach opens the member's private workout from their profile; owner → Hide from
Team feed → Unhide → Remove from team → Remove a push → Delete team; second account →
Marketplace → the published program → search → page → upvote → comment → Featured → Save and
Start; after five sessions → the "Against your trend" card; You → Trends charts; Home → Messages
with both threads open → live delivery, mutual-follows setting, block / unblock; after `npx eas
init`: a second account follows, comments, upvotes, posts to a shared Team and messages → five
pushes; accessibility: VoiceOver, then TalkBack, then maximum text size through the four core
flows (the script in the B49 plan) — judge the lighter small red and the font caps; **Gyms:
Communities → Find your gym → allow location (order sensible from where you stand) → deny or
revoke it → the "downtown Denver" line; Join a gym; on another gym's page tap Switch → the
confirm names the old gym → Home's "Your groups" row, your profile and Communities all show the
new one; Home chip → gym page → Gym feed shows members' posts; Leave**; airplane mode on the
online surfaces → connection messages; reconnect → rows and objects in Supabase; sign out;
throwaway account → Delete account → type DELETE → clean sign-in. Flips B05–B50 and their
features to Done as each holds. (2) **Moderation:** pick an appeal email for
`docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on a throwaway post
(probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers → Email → turn
"Confirm email" off (plan of record; the session's toggle was declined by the permission layer).
(4) **The Blocked steps the pipeline is skipping:** B33 (video provider), B44 (define the
accumulated-fatigue deload rule and the next-session intensity rule), B45 (Strength Level data
licence), B51 (choose the Denver gym data source — B50 ships a fictional fixture until then),
B55 and B56 later; plus `npx eas init` (free) and, for production iOS push, Apple push
credentials — never a pipeline purchase. (5) Whether to grant `mmdc` (and Deno) to headless
runs. (6) Product readings to confirm or overrule: no bodyweight rep-record PR book (B10/B13);
the bare "e1RM" label (B13); muscle shading by max (B19); one post per workout and own posts on
Home (B20); post visibility inherits the workout's, no caption (B21); 10 MiB images, PR post =
photo + New PR flair (B22); votes and comments online-only, 500-char comments (B23); feed
preference per phone, sticky flair filter (B24); public-read avatars, username editable (B25);
post / workout visibility lockstep, three options, body-data control deferred (B26);
whole-person mute, viewer-relative tallies, reports outlive content (B27); export own content
only, no photo-post export, no re-share chains, re-shares hidden from their own owner once the
original is hidden (B28); muscle filter matches any involvement ordered hardest-first, region ∧
muscle may be empty on purpose, no detail link from the logger's picker (B29); PRs below the
coaching content on the card, history screen kept as the logger's deep link, grow-the-limit
show-more (B30); soft delete for customs, customs never match a region chip, no
create-from-picker, no muscle-map shading for customs (B31); export contents (own rows only;
votes, comments, follows, blocks, mutes, reports and photo binaries out; kg as stored),
sweep-before-delete, moderator accounts refuse self-delete, no grace period, other devices of a
deleted account keep their local copy (B32); programs — soft delete on all four tables,
`target_sets` required but reps / load / RPE optional, weeks unnamed, swap-style move buttons,
explicit Save targets, a new slot starts at 3 sets, `export-data` not yet exporting programs
(B34); runs — finishing the last session ends the run (no loop), restarting begins at Week 1,
advancing is one-way, targets as entry notes, no server one-active constraint, a deleted
pointed-at session slides the run forward, `export-data` not yet exporting runs (B35); teams —
open teams have a public roster and invite-only rosters are members-only, a blocked lifter can
still join your open team (never sees your posts), team names not unique, no ownership transfer,
invites are per-user rows, members can leave but owners cannot (B36); coaching — coaches see
members' private workouts (blocks win; PRs, posts, photos, analyses and body data stay closed;
members are told on the team page), the owner is implicitly a coach, assignments are accepted
with one tap and copy the program, the coach's custom exercises do not copy, coach access
ignores mutes, Coach's corner shows the newest 20 pushes (B37); moderation — removal is not a
ban, a hide is curation (the post stays visible on Home and the profile), re-shares of a hidden
post stay until hidden too, no hide reasons or log, team deletion behind a plain confirm (B38);
program visibility — "friends" means followers, blocks cut only the followers arm, mutes
ignored, a Team program with no shares is private in effect, shares persist when the author
leaves the team or switches visibility, a soft-deleted program vanishes for everyone but the
author (B39); Marketplace — no description column, name + author cards, whole-word search
without ranking or author search, Show more re-reads a longer list, blocked authors not
filtered, a warning line rather than a confirm before replacing a running program (B40);
featured / votes / comments — only on published programs, downvotes allowed, rolling 7 / 30 /
365-day windows, a flipped vote keeps its original timestamp, top 10, no arrows on cards,
program-comment reporting deferred, no realtime (B41); trend — last 10 sessions with a threshold
of 5, mean not median, empty finishes excluded, RPE when present else load per rep, deltas
derived at render time, history edits do not re-stamp an existing trend, old rows upgrade 10 per
sync (B42); Tool Kit prefill — the exercise with the newest logged set, warm-ups and drops count
as the source set, the stored e1RM in the 1RM boxes, the percent box never seeded, typed values
survive until something new is logged, tab-tile opens never prefilled (B43); profile trends —
e1RM per exercise, Trends only on your own profile, volume from local sets, windows from the
last read, no charting library (B46); push — upvotes only, vote flips and program social events
do not notify, names and the act only in payloads, default-on switches, one lifetime prompt
after the first Post and never on launch, no receipt polling, a stuck `sending` row is never
retried, the open `notify` endpoint relies on re-reading and the log key rather than a shared
secret (B47); direct messages — the mutual-follows setting gates starting a conversation, not
every send (block is the remedy), two-person only, a muted sender's message still lands but its
push is skipped, message reporting deferred, no receipts / typing / edit / delete / groups /
media, sends appear on server confirmation, at most 100 conversations listed (B48);
accessibility — control outlines exempt from the 3:1 non-text contrast rule, `#ff4d4d` as the
small-text red, font caps 1.2–2× on display chrome only, non-core flows audited only through
the shared primitives, no accessibility lint plugin, one spoken sentence per chart (B49);
**gyms — membership public to every signed-in user (members-only is a one-arm change), location
asked only when the directory opens and never stored, downtown-Denver fallback when denied,
fictional fixture until B51, miles only, Home's row renamed "Your groups", switch behind a
confirm, no map / name search / member counts / Hot sort (B50).**

Next pipeline step after B52 merges: **B54 hydration-and-sleep** (B53 waits on Blocked B33;
check the Build order table for the exact branch name).
