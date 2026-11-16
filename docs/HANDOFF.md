# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B43, B46–B49 merged; pipeline on B50)

**Forty-two pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider) and every P0 feature is Built. Phase 2 has
programs, runs, the Teams family, program visibility, the Marketplace, trend analysis, Tool Kit
prefill, profile trends, push notifications, direct messages and the accessibility pass. B44
(deload rules) and B45 (strength grades) are Blocked and skipped. The pipeline is running **B50
gyms-core**, the first Gyms step. Gates are delegated to the session (CLAUDE.md, "Autonomous
sessions"). Tristen's hands-on list is at the end.

**B49 accessibility-pass (merged, Gate 2 record):** no migration, no server change, no new
dependency; 40 files, all prop / style / token changes. `theme/contrast.ts` (pure WCAG 2.1
`parseColor`, `compositeOver`, `relativeLuminance`, `contrastRatio`) and `contrast.test.ts`,
which asserts every information-bearing palette pair the app draws — 4.5:1 for text, 3:1 for
icons and non-text controls — with exemptions commented (hairlines, and **control outlines**:
input / ghost-button / chip borders measure 1.7:1 and 1.4:1 and are exempted because every
control is identified by its text label — **Tristen's call**, recorded as deviation 1). The
brand red `#cc0404` as small text was ≈ 3.3:1 and fails; a new `accentText` token (`#ff4d4d`,
≈ 5.9:1) now carries every small red label (History link, Superset / PR badges, analysis section
labels, Flair, the active tab label, plus one line each in the new-post composer and the
Marketplace program page); buttons, fills, borders and icons keep `accent`. Dynamic type: text
scales with the phone's setting; `fontScaleCaps` in `tokens.ts` caps only display chrome
(display / title 1.4, section title 1.6, timer 1.2, stat value 1.6, labels and buttons 2) through
the `ui/Text`, `Button` and `TextField` primitives, body / input / card text uncapped; fixed
text-bearing heights became `minHeight`; tab labels shrink to fit rather than wrap. Screen
readers: section labels and exercise names are headings; each logged set reads as one sentence
("Set 2: Warm-up, 8 × 225 lb, then 8 × 185 lb" via `spokenSetText`, pinned against the real
formatter) with its buttons separately reachable; post author rows say handle and age; comments
read as one sentence; the flair is reachable; a refused vote is announced; the profile button
meets Android's 48 dp and the ⋯ report buttons have full tap areas. Focus order: the Tool Kit and
exercise picker sheets open on their title with Close / Cancel next — nothing needed fixing.
Review fixed a duplicated spoken-label helper, a hidden formatter coupling, two names, missing
tests and the styling guide (`docs/styling_guide.md` now agrees with the new token). Gate 2 reran
in order: regenerate typed routes → `tsc` clean → lint clean → Jest 177 suites / 1976 tests on a
cold cache at default workers (the builder's two load timeouts did not recur); `mmdc` rendered
the flowchart (OK); ERD untouched. Statuses: B49 Built; NFR-10 Built. **Device-only and
Tristen's (Built → Done):** with VoiceOver, then TalkBack, then once more at maximum text size —
(1) log a two-exercise workout with a warm-up toggle and a set note, open the Tool Kit, finish to
the analysis; (2) swipe the Home feed — a workout post, a photo post, vote, comments, an author
profile; (3) You — tabs, stats, Trends (each chart speaks a sentence); (4) Library — chips,
search, an exercise detail, Your history. Pass = every control announced with a sensible name /
role / state, nothing unreachable or trapped, no clipped text; also judge whether `#ff4d4d`
still reads as the brand red and whether the caps feel right at 200%. **Product calls
recorded:** control outlines exempt from the 3:1 non-text rule; caps are judgment until a phone
renders 200%; non-core flows (teams, marketplace, messages, programs, settings, auth) inherit
the primitive fixes only; no accessibility lint plugin; one spoken sentence per chart is the
bar.

**Earlier:** B48 direct-messages (SOC-12), B47 push-notifications (YOU-4 complete), B46
profile-trends (YOU-7 trends half), B43 tool-kit-prefill (TK-6), B42 trend-analysis (ANA-5,
LOG-10), B41 marketplace-featured (MKT-2, MKT-3), B40 marketplace-browse (MKT-1, MKT-4, MKT-5),
B39 program-visibility (PRG-4), B38 team-moderation (TEAM-4), B37 team-coaching (TEAM-3,
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

**B50 gyms-core (built on its branch, awaiting Gate 2):** migrations `20261116123049_gyms.sql`
and `20261116124327_gym_members_no_truncate.sql` are **applied live** (PostGIS in `extensions`,
`gyms` + a fictional six-gym "Sample Gym · …" fixture, `gym_members` with PK `user_id`,
restamp trigger, `gyms_near` invoker RPC; grants trimmed to read / join / switch / leave).
Probed live, SQL and a REST upsert with a throwaway user’s real JWT (cleaned up): sort from two
origins correct, switch keeps one row and restamps `joined_at`, `joined_at` writes / writes to
`gyms` / acting for another user / anon all refused. App: `social/gyms.ts`, the directory
(`app/gyms`, `expo-location` foreground, Denver fallback), the gym page (`app/gym/[id]`: Join /
Switch with confirm / Leave, Members, Gym feed), Communities’ Gyms half, Home’s row renamed
**Your groups** with the gym chip first, and the profile’s Gym section. Builder checks: tsc, lint
and Jest (182 suites / 2007 tests) green; `mmdc` declined by the permission layer. Deviations and
the review outcome are in the plan file; device checks are in DEFERRED.
After B50: B51 is Blocked (gym data source), B52 gym-leaderboards (depends on B50, B13), B53
PR-verification depends on B33 (Blocked), B54 hydration-and-sleep, B55 and B56 Blocked.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B49 not yet on it — B31, B34, B35, B39, B42, B47
and B48 add device schema V11–V17, migrated on open). To update: stop the server (`netstat -ano
| findstr :8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout
--detach main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in
B30–B49; B50 will add `expo-location`), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps; **both launchers now write stdout and stderr to
`automation/state/{builder,planner}.{out,err}.log`** (gitignored), replay stdout for n8n and
preserve the exit code — after the B42 builder died post-work and the B49 planner died at 256 s
with no output (a one-off; the model answered a smoke test seconds later; `git branch -D` the
empty branch from `main`, then `pipe.mjs retry <id>` — the retry ran as a new execution with
`retryOf` set and succeeded). Check order: `expo start --offline` ~150 s → `tsc` → lint → Jest;
Gate 2 frees ports 8097–8099, renders the diagrams with `mmdc`, and runs live HTTP probes
through the PowerShell tool with the throwaway-JWT recipe (persistent probe rows deleted
afterwards; an UPDATE whose RLS check fails raises 42501; `pg_net` deliveries can take up to a
minute). Builders have hit Jest 30 s timeouts under full-suite load at default workers and rerun
with `--maxWorkers=50%`; Gate 2's cold-cache default-worker runs have passed every time.
Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`,
`trigger`). Executions 4/5 (B05) through 47 (B49, a retry of 46); B50 is next. Reported costs:
B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9,
B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4,
B19 ≈ $8.5, B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5,
B26 ≈ $19.1, B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3,
B34 ≈ $21.9, B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6, B39 ≈ $14.5, B40 ≈ $13.9,
B41 ≈ $18.9, B42 ≈ $7.4 planner + an unreported builder, B43 ≈ $12.1, B46 ≈ $12.8,
B47 ≈ $21.2, B48 ≈ $21.9, B49 ≈ $14.6 plus the failed first planner (≈ $626 reported for
forty-two steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B49 first;
run `npm ci` once B50 lands): sign up under 18 → refused; sign up 18+; kill and reopen still
signed in; You → Edit profile; log a multi-exercise workout, one-tap Repeat, force-kill and
Resume; mid-workout after a logged set, open the Tool Kit: 1RM, RPE, %1RM and Plates arrive
prefilled; finish in airplane mode → analysis with muscle map → Share → share sheet → Next →
Post / Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle, Privacy
("Who can message you"), Export your data, Notifications (five switches; "Turn on push" after
`eas init`); Tool Kit timer; Home → Latest / Hot and a flair chip → Share a photo → vote /
comment → make a post private → ⋯ Report → an author's profile → Follow, Re-share, Mute, Block
→ unblock, Message → thread → send; Find lifters; Library → chips → a card → detail → PRs and
sessions → New exercise in airplane mode → log → card → edit → delete; Workout → Your programs →
New program → weeks / workouts / exercises → kill → reopen intact → Who can see this → Team →
Published; Workout → Start from a program → run card → Start next session → finish → Stop;
Communities → Create a team → second account joins → Team feed and Home chips → Invite only →
Invite → join via invite; owner → Make coach; coach → Announce, push a program (Save), push a
workout (Start), Assign (Start → run); coach opens the member's private workout from their
profile; owner → Hide from Team feed → Unhide → Remove from team → Remove a push → Delete team;
second account → Marketplace → the published program → search → page → upvote → comment →
Featured → Save and Start; after five sessions → the "Against your trend" card; You → Trends
charts; Home → Messages with both threads open → live delivery, mutual-follows setting, block /
unblock; after `npx eas init`: a second account follows, comments, upvotes, posts to a shared
Team and messages → five pushes; **accessibility: VoiceOver, then TalkBack, then maximum text
size through the four core flows (the script in the B49 plan) — judge the lighter small red
and the font caps**; airplane mode on the online surfaces → connection messages; reconnect →
rows and objects in Supabase; sign out; throwaway account → Delete account → type DELETE →
clean sign-in. Flips B05–B49 and their features to Done as each holds. (2) **Moderation:** pick
an appeal email for `docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on
a throwaway post (probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers →
Email → turn "Confirm email" off (plan of record; the session's toggle was declined by the
permission layer). (4) **The Blocked steps the pipeline is skipping:** B33 (video provider), B44
(define the accumulated-fatigue deload rule and the next-session intensity rule), B45
(Strength Level data licence); B51 (choose the Denver gym data source — B50 ships a fixture
until then), B55 and B56 later; plus `npx eas init` (free) and, for production iOS push, Apple
push credentials — never a pipeline purchase. (5) Whether to grant `mmdc` (and Deno) to headless
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
**accessibility** — control outlines exempt from the 3:1 non-text contrast rule, `#ff4d4d` as
the small-text red, font caps 1.2–2× on display chrome only, non-core flows audited only through
the shared primitives, no accessibility lint plugin, one spoken sentence per chart (B49).

Next pipeline step after B50 merges: **B52 gym-leaderboards** (B51 is Blocked; check the Build
order table for the exact branch name).
