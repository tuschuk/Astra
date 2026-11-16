# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B43, B46–B48 merged; pipeline on B49)

**Forty-one pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider) and every P0 feature is Built. Phase 2 has
programs, runs, the Teams family, program visibility, the Marketplace, trend analysis, Tool Kit
prefill, profile trends, push notifications and direct messages. B44 (deload rules) and B45
(strength grades) are Blocked and skipped. The pipeline is running **B49 accessibility-pass**.
Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list
is at the end.

**B48 direct-messages (merged, Gate 2 record):** migrations `20261116063026_direct_messages.sql`
and `20261116070550_direct_messages_server_time.sql` (both applied live, confirmed at Gate 2):
`private.can_message(sender, recipient)` — one home: not self, not blocked either way, and when
the recipient's `user_settings.dm_policy` is `mutual_follows` both `follows` rows exist (the
first mutual-follow spelling in the repo, definer because follows RLS hides others' edges);
`public.can_message_user(target)` RPC (EXECUTE for authenticated only) for the profile button;
`user_settings.dm_policy text default 'anyone'` (CHECK anyone | mutual_follows) and
`notify_messages boolean default true` (device schema V17); `conversations (id client uuid,
user_a < user_b, unique pair, created_at, last_message_at)` — select = membership ∧ `not
blocked_either`, insert = membership ∧ `can_message`, no update / delete; `messages (id client
uuid, conversation_id, sender_id, body ≤ 2000 non-blank, created_at)` — select and insert reach
`conversations` by RLS-checked subquery so the block wall is spelled once; triggers
`stamp_last_message` (definer, maintains `last_message_at`), `messages_server_time` and a
conversations twin (review fix: client timestamps are overwritten with `now()` so a future-dated
message cannot pin an inbox), `notify_on_message`; `alter publication supabase_realtime add
table public.messages` — the first table in the publication; `notification_log` event CHECK
widened with `message`; `notify` redeployed as **v2** with the fifth event ("〈name〉 sent you a
message", route `/messages/<sender>`, never the text). App: `social/messages.ts`
(`MESSAGE_MAX_LENGTH`, server-way `messageLength`, `orderedPair`, `canMessageUser`,
`canOpenThread`, `conversationWith`, `getOrCreateConversation` with the 23505 re-read,
`sendMessage`, `listMessages` newest-50 grow-the-limit, `listConversations` ≤ 100 by
`last_message_at` nulls last), `social/useThread.ts` (one `postgres_changes` INSERT channel
filtered by conversation, dedupe by id, channel removed on unmount, re-read on focus), routes
`app/messages/index.tsx` and `app/messages/[userId].tsx` (thread keyed by the other lifter,
scrolls to newest, sends appear on server confirmation), a Messages button in Home's header
actions, "Message" on other lifters' profiles when `can_message_user` allows or a thread
already exists (review fix for replies), Settings → Privacy "Who can message you" chips and a
fifth Notifications switch, `notificationNav` accepts the `/messages/<uuid>` route. Messages are
online-only (no mirror, no outbox — the recorded reading). **Gate 2 live probes:** schema,
policies, helpers, triggers and publication as planned; SQL (rolled back) — non-mutual
`can_message_user` false then true after the follow-back, the recipient reads the thread, an
outsider reads nothing, a block hides the thread from both sides and `can_message_user` goes
false, unblock restores the history, a non-mutual conversation insert and a blocked send are
refused (42501); **HTTP API with real throwaway JWTs** — non-mutual start 403 → after the
follow-back 201 → message 201 (stamping `last_message_at`) → recipient reads it → outsider
reads `[]` for both tables and is refused sending into the thread → a forged `sender_id` is
refused → after the recipient blocks the sender: send 403, both inboxes `[]`, `can_message_user`
false, while the sender can still start a conversation with an unrelated user who allows
anyone; the notification log for the recipient shows the old `follow` path still working through
notify v2 and the new `message` event logged; probe users and all cascaded rows deleted. Gate 2
reran in order: regenerate typed routes → `tsc` clean → lint clean → Jest 175 suites / 1920
tests on a cold cache at default workers; `mmdc` rendered both diagrams (OK). Statuses: B48
Built; SOC-12 Built. **Device-only and Tristen's:** two accounts with both threads open —
messages appear without a refresh (the live websocket is the one DoD leg a headless session
cannot hold open); the setting, block / unblock, and the message push once `eas init` is done.
**Product calls recorded:** the mutual-follows setting gates conversation *creation*, not every
send (a later flip does not silence existing threads — block is the remedy); two-person
conversations only; message reporting deferred to land with program-comment reporting; no read
receipts, typing indicators, edit / delete, groups or media; `export-data` does not export
messages (the standing export-widening item).

**Earlier:** B47 push-notifications (YOU-4 complete), B46 profile-trends (YOU-7 trends half),
B43 tool-kit-prefill (TK-6), B42 trend-analysis (ANA-5, LOG-10), B41 marketplace-featured
(MKT-2, MKT-3), B40 marketplace-browse (MKT-1, MKT-4, MKT-5), B39 program-visibility (PRG-4),
B38 team-moderation (TEAM-4), B37 team-coaching (TEAM-3, TEAM-5), B36 teams (TEAM-1, TEAM-2;
SOC-10 / YOU-6 Teams halves), B35 run-program (PRG-3, LOG-1), B34 program-builder (PRG-1,
PRG-2), B32 export-and-delete-account (NFR-6), B31 custom-exercises (LIB-5), B30
library-card-history (LIB-4), B29 library-filters-and-detail (LIB-1, LIB-3), B28 share-cards
(LOG-8, SOC-6), B27 moderation-and-safety (SOC-8, NFR-7), B26 post-privacy (YOU-5), B25 profile
(YOU-1, YOU-2, YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9), B23
votes-and-comments (SOC-4, SOC-5), B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post
(LOG-7), B20 posts-and-feed (SOC-1, SOC-3; LOG-13), B19 muscle-map (ANA-3), B18
analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9 part), B17 tool-kit-timer (TK-5), B16
tool-kit-calculators (TK-1..4), B15 settings-and-units (LOG-6), B14 edit-delete-workouts
(LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12 workout-notes (LOG-3), B11
supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14, LOG-15), B09 logger-screen
(LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07 local-store-and-sync (FND-3), B06
training-math, B05 auth-and-signup. Details in each plan file.

**B49 accessibility-pass** (planning now): labels, roles, focus order, dynamic type and contrast
across the core flows (log, feed, profile, library). Step DoD: a VoiceOver and TalkBack
walkthrough and a contrast check pass. Covers NFR-10. Depends on B28. Standing inputs for its
planner: the app already uses `accessibilityRole` / `accessibilityLabel` / `accessibilityState`
in about 270 places (chips, buttons, the muscle map and the trend charts speak one sentence
each), but **nothing handles dynamic type** — no `allowFontScaling` / `maxFontSizeMultiplier`
anywhere, and the theme's `type` scale (`frontend/src/theme`) is fixed points; the planner
should audit the core flows the step names (logger and entry cards, Home feed and `PostCard`,
`ProfileView`, Library tab and the exercise detail) for missing labels and roles, header /
section semantics, touch-target size, focus order of modals and sheets (`ToolKitSheet`,
`ProgramPickerSheet`, the confirm dialogs), and dynamic type (let text scale, cap multipliers
where layout breaks, make rows grow); **contrast** is checked against the theme's palette
(`colors` in `frontend/src/theme`) with WCAG 2.1 AA ratios computed by a small pure function in
a test — a Jest test over the palette pairs the app actually uses is the "contrast check
passes" half that a session can prove; the VoiceOver / TalkBack walkthrough is Tristen's device
check (record that Built → Done is his); **no numeric claims, no new dependency** (a contrast
helper is a few lines; no accessibility library); tests — RNTL queries by role and label across
the core screens, the contrast test, snapshot-free; the ERD is untouched; the flowchart gains
nothing structural (a note on the accessibility sentence pattern at most); the plan should be
scoped as fixes to what the audit finds, not a redesign, and must list the screens touched. After
B49: B50 gyms-core (PostGIS `gyms` with distance sort — PostGIS is an extension on the existing
project, free; the location permission ask follows the B47 "never on launch" posture).

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B48 not yet on it — B31, B34, B35, B39, B42, B47
and B48 add device schema V11–V17, migrated on open). To update: stop the server (`netstat -ano
| findstr :8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout
--detach main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in
B30–B48), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps; both launchers write stderr to
`automation/state/builder.err.log` / `planner.err.log` (gitignored) since the B42 builder died
after its work — recovery recipe in PIPELINE.md. Check order: `expo start --offline` ~150 s →
`tsc` → lint → Jest; Gate 2 frees ports 8097–8099, renders the diagrams with `mmdc`, and runs
live HTTP probes through the PowerShell tool with the throwaway-JWT recipe (persistent probe
rows deleted afterwards; an UPDATE whose RLS check fails raises 42501; `pg_net` deliveries can
take up to a minute). Builders have hit Jest 30 s timeouts under full-suite load at default
workers and rerun with `--maxWorkers=50%`; Gate 2's cold-cache default-worker runs have passed
every time. Session helper: `automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`,
`retry <id>`, `trigger`). Executions 4/5 (B05) through 45 (B48); B49 is next. Reported costs:
B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9,
B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4,
B19 ≈ $8.5, B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5,
B26 ≈ $19.1, B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3,
B34 ≈ $21.9, B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5, B38 ≈ $11.6, B39 ≈ $14.5, B40 ≈ $13.9,
B41 ≈ $18.9, B42 ≈ $7.4 planner + an unreported builder, B43 ≈ $12.1, B46 ≈ $12.8,
B47 ≈ $21.2, B48 ≈ $21.9 (≈ $611 reported for forty-one steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B48 first):
sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile;
log a multi-exercise workout, one-tap Repeat, force-kill and Resume; mid-workout after a logged
set, open the Tool Kit: 1RM, RPE, %1RM and Plates arrive prefilled; finish in airplane mode →
analysis with muscle map → Share → share sheet → Next → Post / Skip; View workout → PR badges;
History; Edit and Delete; Settings → kg toggle, Privacy (**"Who can message you"**), Export your
data, Notifications (five switches; "Turn on push" after `eas init`); Tool Kit timer; Home →
Latest / Hot and a flair chip → Share a photo → vote / comment → make a post private → ⋯ Report
→ an author's profile → Follow, Re-share, Mute, Block → unblock, **Message → thread → send**;
Find lifters; Library → chips → a card → detail → PRs and sessions → New exercise in airplane
mode → log → card → edit → delete; Workout → Your programs → New program → weeks / workouts /
exercises → kill → reopen intact → Who can see this → Team → Published; Workout → Start from a
program → run card → Start next session → finish → Stop; Communities → Create a team → second
account joins → Team feed and Home chips → Invite only → Invite → join via invite; owner → Make
coach; coach → Announce, push a program (Save), push a workout (Start), Assign (Start → run);
coach opens the member's private workout from their profile; owner → Hide from Team feed →
Unhide → Remove from team → Remove a push → Delete team; second account → Marketplace → the
published program → search → page → upvote → comment → Featured → Save and Start; after five
sessions → the "Against your trend" card; You → Trends charts; **Home → Messages: with the
second account's thread open on both phones, messages appear without a refresh; set "mutual
follows" on one account → the other (not followed back) sees no Message button and the API
refuses; block → the thread vanishes for both; unblock → it returns**; after `npx eas init`: a
second account follows, comments, upvotes, posts to a shared Team and messages → five pushes,
each tap opening the right screen; flip one switch → only that kind stops; airplane mode on the
online surfaces → connection messages; reconnect → rows and objects in Supabase; sign out;
throwaway account → Delete account → type DELETE → clean sign-in. Flips B05–B48 and their
features to Done as each holds. (2) **Moderation:** pick an appeal email for
`docs/CONTENT_POLICY.md`; call `moderate` once with your signed-in token on a throwaway post
(probe list in DEFERRED). (3) Supabase Dashboard → Authentication → Providers → Email → turn
"Confirm email" off (plan of record; the session's toggle was declined by the permission layer).
(4) **The Blocked steps the pipeline is skipping:** B33 (video provider), B44 (define the
accumulated-fatigue deload rule and the next-session intensity rule), B45 (Strength Level data
licence); B51 (Denver gym import), B55 and B56 later; plus `npx eas init` (free) and, for
production iOS push, Apple push credentials — never a pipeline purchase. (5) Whether to grant
`mmdc` (and Deno) to headless runs. (6) Product readings to confirm or overrule: no bodyweight
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
vanishes for everyone but the author (B39); Marketplace — no description column, name + author
cards, whole-word search without ranking or author search, Show more re-reads a longer list,
blocked authors not filtered, a warning line rather than a confirm before replacing a running
program (B40); featured / votes / comments — only on published programs, downvotes allowed,
rolling 7 / 30 / 365-day windows, a flipped vote keeps its original timestamp, top 10, no
arrows on cards, program-comment reporting deferred, no realtime (B41); trend — last 10
sessions with a threshold of 5, mean not median, empty finishes excluded, RPE when present else
load per rep, deltas derived at render time, history edits do not re-stamp an existing trend,
old rows upgrade 10 per sync (B42); Tool Kit prefill — the exercise with the newest logged set,
warm-ups and drops count as the source set, the stored e1RM in the 1RM boxes, the percent box
never seeded, typed values survive until something new is logged, tab-tile opens never
prefilled (B43); profile trends — e1RM per exercise, Trends only on your own profile, volume
from local sets, windows from the last read, no charting library (B46); push — upvotes only,
vote flips and program social events do not notify, names and the act only in payloads,
default-on switches, one lifetime prompt after the first Post and never on launch, no receipt
polling, a stuck `sending` row is never retried, the open `notify` endpoint relies on re-reading
and the log key rather than a shared secret (B47); **direct messages** — the mutual-follows
setting gates starting a conversation, not every send (block is the remedy for an existing
thread), two-person only, a muted sender's message still lands but its push is skipped, message
reporting deferred with program-comment reporting, no receipts / typing / edit / delete / groups
/ media, sends appear on server confirmation, the list shows at most 100 conversations (B48).

Next pipeline step after B49 merges: **B50 gyms-core** (check the Build order table for the
exact branch name; PostGIS is a free extension on the existing project).
