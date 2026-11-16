# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B43, B46–B50, B52 merged; pipeline on B54)

**Forty-four pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider) and every P0 feature is Built. Phase 2 has
programs, runs, the Teams family, program visibility, the Marketplace, trend analysis, Tool Kit
prefill, profile trends, push notifications, direct messages, the accessibility pass, the Gyms
core and the Gym leaderboard. B44 (deload rules), B45 (strength grades) and B51 (Denver gym
import) are Blocked and skipped; B53 (PR verification) waits on Blocked B33. The pipeline is
running **B54 hydration-and-sleep**, the first Recovery step. Gates are delegated to the session
(CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B52 gym-leaderboards (merged, Gate 2 record):** one migration applied live and recorded
(`20261116130816_leaderboard_entries.sql`). `leaderboard_entries (id, gym_id → gyms cascade,
user_id → profiles cascade, lift check in squat/bench/deadlift, division check in male/female,
weight_kg numeric(8,3) > 0, verified_at, created_at)` with a unique index on (gym_id, user_id,
lift) — the "one row per member per lift" rule — and a user index for the deletion cascade.
Select for authenticated only; insert / update / delete / truncate / references / trigger revoked
from users, so the board is read-only by construction until B53's server-side writer exists.
The division is a snapshot stamped on the entry at verification; `user_body_data` is never read
or widened. No fixture seed in the migration (fixture rows need auth users). **Probed live** with
two throwaway users and four fixture rows at the Capitol Hill fixture gym: the REST read
(`profile:profiles(username,display_name)` embed resolves without an FK hint; `order=weight_kg.
desc,verified_at.asc,id.asc`) returned the squat tie with the earlier verification first and the
women's bench row in its division; own insert / patch / delete → 403; anon read → 401; after the
member switched gyms over the B50 REST upsert, the old board still held their 2 rows and the new
board 0 (GYM-9); deleting the users cascaded every row away (NFR-6). Builder's SQL probe added:
duplicate (gym, user, lift) → 23505, upsert on the key replaced the value leaving one row
(GYM-6's mechanics), bad lift or division → 23514. Probe users and rows deleted; `get_advisors`
unchanged. **App:** `social/leaderboards.ts` (`LIFTS`, `LIFT_LABELS`, `DIVISIONS`,
`DIVISION_LABELS` "Men" / "Women", `LEADERBOARD_SELECT`, `loadBoard` per lift with limit 200,
`splitBoard` numbering each division positionally, weights through `formatWeight`), the board
screen at `app/gym/[id]/leaderboard` (three lift chips, both division sections always rendered,
"No verified PRs yet." when empty, pull-to-refresh, offline message + Retry), a Leaderboard row
on the gym page, route registered. Builder deviations (in the plan): `loadBoard` throws like the
other gym reads; each lift re-read on focus and chip tap with the kept board shown meanwhile;
`GYM_MISSING` moved into `social/gyms.ts`; subtitle and pull-to-refresh added. Gate 1 added one
note: the 200 cap applies before the division split, so a lopsided gym could starve the smaller
division's tail — accepted at launch scale, fix recorded (one read per lift and division).
**Gate 2 reran in order:** `expo start --offline` → `tsc` clean → lint clean → Jest 184 suites /
2024 tests on a cold cache at default workers; `mmdc` rendered both diagrams (OK). **Statuses:**
B52 Built; GYM-8 Built (its DoD — exactly two divisions ranked by absolute weight — is
observable now; the pick-your-division screen is B53's submission gate); GYM-3, GYM-6, GYM-9 In
progress until B53 writes real verified rows. **Product calls recorded for Tristen:** boards
public to every signed-in user (an entrant's division is public once they enter a sex-divided
board; members-only would hide your own old board after a switch); every real board reads "No
verified PRs yet." in both divisions until B53 lands (B53 depends on Blocked B33 — overrule the
sequencing if an empty surface should not ship); "Men" / "Women" labels over `male` / `female`
data; ties ordered by earlier verification with positional ranks (no shared "T-1"); top 200 per
lift; no coefficients ever (GYM-8).

**Earlier:** B50 gyms-core (GYM-1 part, GYM-2, GYM-7, SOC-10 / YOU-6 Gym halves — PostGIS,
public membership, location never stored, fictional fixture until B51), B49 accessibility-pass
(NFR-10), B48 direct-messages (SOC-12), B47 push-notifications (YOU-4), B46 profile-trends
(YOU-7 trends half), B43 tool-kit-prefill (TK-6), B42 trend-analysis (ANA-5, LOG-10), B41
marketplace-featured (MKT-2, MKT-3), B40 marketplace-browse (MKT-1, MKT-4, MKT-5), B39
program-visibility (PRG-4), B38 team-moderation (TEAM-4), B37 team-coaching (TEAM-3, TEAM-5),
B36 teams (TEAM-1, TEAM-2), B35 run-program (PRG-3, LOG-1), B34 program-builder (PRG-1, PRG-2),
B32 export-and-delete-account (NFR-6), B31 custom-exercises (LIB-5), B30 library-card-history
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

**B54 hydration-and-sleep** (planning now): `hydration_logs` and `sleep_logs` with owner-only
RLS; per-input opt-in toggles in Settings; delete-my-data per input; manual entry UI; no
health-platform code. Step DoD: daily totals are correct and switching an input off can delete
its data. Covers REC-2 (fluid intake against a user-set daily target with a visible running
total), REC-3 (sleep logged by hand, no wearable or health-platform code), REC-4 (each input
toggles independently and switching one off can delete its data on request), NFR-5 (part:
recovery data treated as sensitive). Depends on B15. Standing inputs for its planner: **recovery
data is sensitive** (CLAUDE.md privacy rule, NFR-5) — owner-only RLS on both tables, never
readable by coaches (B37's `coach_reads_logs` must not widen), never in posts, feeds or exports
to others, no visibility setting because there is nothing to share; **it is logging**, so the
offline-first rule applies: device tables (schema bump to V18) written locally and synced through
the existing outbox like workouts (`SYNC_ORDER` gains the two tables; the planner records
whether the pull is standalone like programs or part of the main pass), with the daily total
computed on the device from local rows; **one home for the day rule** — the day boundary
(device-local midnight, recorded) and the total live in one module used by the entry screen and
any later analysis (B56, Blocked); hydration stored in **millilitres** with a user-set daily
target in ml (display ml, or fl oz when the unit setting is lb — record the call), sleep stored
as **start and end timestamps or minutes** (record which; manual entry only, no imports, no
`expo-health` or similar dependency — the step adds no dependency); **per-input opt-in** = two
independent switches on `user_settings` (the B15 / B47 precedent for synced settings), default
**off** (opt-in, not opt-out), entry UI hidden until switched on; **delete my data per input** =
an explicit "Delete all hydration data" / "Delete all sleep data" action behind a confirm that
deletes the server rows and the device rows (hard delete, not soft; tombstones or a server-side
delete RPC so a second device also drops them — the planner records the mechanism), offered when
switching off and from Settings; `export-data` (B32) must include the user's own hydration and
sleep rows (NFR-6 "full export") and `delete-account`'s sweep must cover both tables — record
whether B54 updates the functions or defers to a follow-up with a DEFERRED entry; **the entry
surface** — the planner picks between a Recovery section on the You tab and tiles on the Workout
tab, recorded, with a running daily total and target progress for hydration and last night's
duration for sleep; **no numeric performance claims** anywhere (a hydration target is the user's
own number; no "drink X for Y% more strength" copy); the Gate 2 probe — two throwaway users:
owner reads own rows, the other user and a team coach read nothing, inserts for another user →
42501, the per-input delete removes exactly that input's rows and nothing else, the daily total
over rows straddling local midnight; ERD gains the two tables and the settings columns, the
flowchart the entry screens, Settings switches and the sync path. After B54: B55 nutrition and
B56 recovery-aware-analysis are Blocked (food database; cited evidence base), B53 waits on B33,
B51 on the data source — **the Build order is then exhausted until Tristen unblocks a step**, so
the session ends with the handoff after B54's Gate 2.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B52 not yet on it — B31, B34, B35, B39, B42, B47
and B48 add device schema V11–V17, migrated on open). To update: stop the server (`netstat -ano
| findstr :8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout
--detach main`, **`npm ci` in `Astra-main\frontend` (B50 added `expo-location` to the
lockfile)**, then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; the "Pick next item" script skips Blocked steps; both launchers write
stdout and stderr to `automation/state/{builder,planner}.{out,err}.log` (gitignored), replay
stdout for n8n and preserve the exit code; a Gate 1 plan fix must leave the tree on the step's
branch (B50's lesson; the manual builder re-run recipe is in the doc). Check order: `expo start
--offline` ~150 s → `tsc` → lint → Jest; Gate 2 frees ports 8097–8099, renders the diagrams
with `mmdc`, and runs live HTTP probes through the PowerShell tool with the throwaway-JWT recipe
(`Invoke-RestMethod`, or `Invoke-WebRequest -UseBasicParsing`; persistent probe rows deleted
afterwards; an UPDATE whose RLS check fails raises 42501; `pg_net` deliveries can take up to a
minute). Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`,
`retry <id>`, `trigger`). Executions 4/5 (B05) through 49 (B52); B54 is next. Reported costs:
B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9,
B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4,
B19 ≈ $8.5, B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5,
B26 ≈ $19.1, B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3,
B34 ≈ $21.9, B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6, B39 ≈ $14.5, B40 ≈ $13.9,
B41 ≈ $18.9, B42 ≈ $7.4 planner + an unreported builder, B43 ≈ $12.1, B46 ≈ $12.8,
B47 ≈ $21.2, B48 ≈ $21.9, B49 ≈ $14.6 plus the failed first planner, B50 ≈ $14.3 (including
the aborted and manual builders), B52 ≈ $10.3 (≈ $650 reported for forty-four steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B52 first and
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
flows (the script in the B49 plan) — judge the lighter small red and the font caps; Gyms:
Communities → Find your gym → allow location (order sensible from where you stand) → deny or
revoke it → the "downtown Denver" line; Join a gym; on another gym's page tap Switch → the
confirm names the old gym → Home's "Your groups" row, your profile and Communities all show the
new one; Home chip → gym page → Gym feed shows members' posts; **gym page → Leaderboard → "No
verified PRs yet." under both Men and Women, the three chips, pull to refresh, airplane mode →
Retry**; Leave the gym; airplane mode on the online surfaces → connection messages; reconnect →
rows and objects in Supabase; sign out; throwaway account → Delete account → type DELETE → clean
sign-in. Flips B05–B52 and their features to Done as each holds. (2) **Moderation:** pick an
appeal email for `docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on a
throwaway post (probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers →
Email → turn "Confirm email" off (plan of record; the session's toggle was declined by the
permission layer). (4) **The Blocked steps the pipeline is skipping:** B33 (video provider — and
B53 PR verification behind it, which is what fills every gym's empty leaderboard), B44 (define
the accumulated-fatigue deload rule and the next-session intensity rule), B45 (Strength Level
data licence), B51 (choose the Denver gym data source — B50 ships a fictional fixture until
then), B55 (food database), B56 (cited evidence base); plus `npx eas init` (free) and, for
production iOS push, Apple push credentials — never a pipeline purchase. **Once B54 merges the
Build order is exhausted until one of these is unblocked.** (5) Whether to grant `mmdc` (and
Deno) to headless runs. (6) Product readings to confirm or overrule: no bodyweight rep-record PR
book (B10/B13); the bare "e1RM" label (B13); muscle shading by max (B19); one post per workout
and own posts on Home (B20); post visibility inherits the workout's, no caption (B21); 10 MiB
images, PR post = photo + New PR flair (B22); votes and comments online-only, 500-char comments
(B23); feed preference per phone, sticky flair filter (B24); public-read avatars, username
editable (B25); post / workout visibility lockstep, three options, body-data control deferred
(B26); whole-person mute, viewer-relative tallies, reports outlive content (B27); export own
content only, no photo-post export, no re-share chains, re-shares hidden from their own owner
once the original is hidden (B28); muscle filter matches any involvement ordered hardest-first,
region ∧ muscle may be empty on purpose, no detail link from the logger's picker (B29); PRs
below the coaching content on the card, history screen kept as the logger's deep link,
grow-the-limit show-more (B30); soft delete for customs, customs never match a region chip, no
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
the shared primitives, no accessibility lint plugin, one spoken sentence per chart (B49); gyms —
membership public to every signed-in user (members-only is a one-arm change), location asked
only when the directory opens and never stored, downtown-Denver fallback when denied, fictional
fixture until B51, miles only, Home's row renamed "Your groups", switch behind a confirm, no map
/ name search / member counts / Hot sort (B50); **leaderboards — public to signed-in users, the
division frozen on the entry at verification, "Men" / "Women" labels, ties by earlier
verification with positional ranks, top 200 per lift, empty boards shipping until B53, no
coefficients (B52).**

Next pipeline step after B54 merges: **none runnable** — every remaining step (B33, B44, B45,
B51, B53, B55, B56) is Blocked or depends on a Blocked step; unblocking is Tristen's edit to the
Status cell.
