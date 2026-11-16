# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 16, 2026 — B05–B32, B34–B43, B46, B47 merged; pipeline on B48)

**Forty pipeline steps are merged to `main`.** Every P0 step through B32 is Built (B33
video-service is Blocked on the video provider), and YOU-4 — the last P0 feature — is now Built
with B47. Phase 2 has programs, runs, the Teams family, program visibility, the Marketplace,
trend analysis, Tool Kit prefill, profile trends and push notifications. B44 (deload rules) and
B45 (strength grades) are Blocked and skipped. The pipeline is running **B48 direct-messages**.
Gates are delegated to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list
is at the end.

**B47 push-notifications (merged, Gate 2 record):** migration `20261116052928_push_notifications.sql`
(applied live, confirmed at Gate 2): `pg_net` enabled; `push_tokens (token pk, user_id cascade,
platform, device_name, created_at, last_seen_at)` with owner-only select / delete and writes
only through `public.register_push_token(token, platform, device_name)` — SECURITY DEFINER,
refuses signed-out callers, deletes any row holding that token and inserts it for the caller
(the account-switch fix; EXECUTE for authenticated only); four `user_settings` columns
`notify_follows / _comments / _votes / _team_pushes` default true (device schema V16, synced
with the other settings); `notification_log (event, source_key, recipient_id unique, actor_id,
status, tickets)` with RLS on and no policies (service role only) — the idempotence key and the
probe surface; `private.notify_event()` trigger function posting `{ event, keys }` through
`net.http_post` to the `notify` function, with `AFTER INSERT` triggers `notify_on_follow`,
`notify_on_comment`, `notify_on_upvote`, `notify_on_team_post`. Edge function **`notify`** (v1,
`verify_jwt = false` by design, reasoning in `config.toml`): re-reads the real rows with the
service role, derives recipients (never the actor), skips on blocks either way, on the
recipient's mute, on the switch, and when no tokens; claims the log row (`sending`) before
calling Expo's free push API in batches; records tickets; deletes a token Expo reports as
`DeviceNotRegistered`; answers every POST with the same empty 204. App:
`notifications/pushRegistration.ts` (guarded lazy `expo-notifications` port — permission check /
ask → token → RPC; `unavailable` when the module, permission or the EAS project id is missing;
Expo Go on Android reports unavailable because remote push cannot work there),
`usePushNotifications.ts`, `notificationNav.ts` (a tapped push opens the profile, the post's
comments or the team page — the path is validated against the three known shapes), `askOnce.ts`
(one lifetime prompt after the first Post from `post-workout/[id]` or `new-post`, never on
launch; not consumed while push is unavailable), `settings/notificationSettings.ts`
(`patchUserSettingsTx` + outbox, the privacy-settings pattern); Settings → Notifications with the
four switches and the push state line; sign-out deletes this device's token best-effort first.
**Gate 2 live probes:** schema and grants as planned; `register_push_token` moved a token from
user A to user B atomically (one row, owned by B) and refused an anonymous caller; end to end
through the real triggers — four events by actor A against recipient R produced four log rows
(each `send_failed` with Expo's `DeviceNotRegistered` ticket for the fake token, after which the
token row was deleted), all four `pg_net` calls answered 204; with `notify_follows` off, a second
actor's follow logged `skipped_setting` while their comment still went through (the DoD, live);
a direct replay of a real event and a forged event for a non-existent row added no rows and both
answered 204, as did an unknown event and a malformed body; probe users and all cascaded rows
deleted. `pg_net` delivery latency varied from under eight seconds to about fifty. Gate 2 reran
in order: regenerate typed routes → `tsc` clean → lint clean → Jest 171 suites / 1844 tests on
a cold cache at default workers; `mmdc` rendered both diagrams (OK). Statuses: B47 Built; YOU-4
Built. **Device-only and Tristen's:** run `npx eas init` in `frontend/` (free, needs the Expo
account) so the app has a project id; on iOS Expo Go or an Android development build, Settings
→ Notifications → Turn on push; from a second account follow, comment, upvote and post to a
shared Team → four pushes, each opening the right screen; flip one switch → only that kind
stops. **Product calls recorded:** upvotes only (no downvote pings), vote flips do not notify,
program votes and comments do not notify (B41 tables are out of scope — a natural later step via
two more triggers), payloads carry names and the act only (no comment text, no training or body
data), default-on switches, no receipt polling, a log row stuck at `sending` is never retried,
Settings re-registers the token on each visit, the deployed function is a comment-trimmed copy
(a redeploy from the repo replaces it harmlessly). **Hardening noted for later evidence:** the
open `notify` endpoint can be hammered without a login; a Vault-held shared header (Vault is
installed and free) is the recorded fix if abuse ever appears.

**Earlier:** B46 profile-trends (YOU-7 trends half), B43 tool-kit-prefill (TK-6), B42
trend-analysis (ANA-5, LOG-10), B41 marketplace-featured (MKT-2, MKT-3), B40 marketplace-browse
(MKT-1, MKT-4, MKT-5), B39 program-visibility (PRG-4), B38 team-moderation (TEAM-4), B37
team-coaching (TEAM-3, TEAM-5), B36 teams (TEAM-1, TEAM-2; SOC-10 / YOU-6 Teams halves), B35
run-program (PRG-3, LOG-1), B34 program-builder (PRG-1, PRG-2), B32 export-and-delete-account
(NFR-6), B31 custom-exercises (LIB-5), B30 library-card-history (LIB-4), B29
library-filters-and-detail (LIB-1, LIB-3), B28 share-cards (LOG-8, SOC-6), B27
moderation-and-safety (SOC-8, NFR-7), B26 post-privacy (YOU-5), B25 profile (YOU-1, YOU-2,
YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9), B23 votes-and-comments (SOC-4, SOC-5),
B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1,
SOC-3; LOG-13), B19 muscle-map (ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9
part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units
(LOG-6), B14 edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12
workout-notes (LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14,
LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07
local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B48 direct-messages** (planning now): `conversations` and `messages` tables with RLS; Supabase
Realtime delivery; anyone-can-message by default, limitable to mutual follows, enforced
server-side; a block cuts messaging. Step DoD: messages arrive in real time and both the setting
and the block are enforced by the API. Covers SOC-12. Depends on B27, B47. Standing inputs for
its planner: **nothing Realtime exists yet** — no channel subscription anywhere in the app and
the `supabase_realtime` publication holds zero tables, so the migration must `alter publication
supabase_realtime add table public.messages` and the app subscribes with `supabase.channel(...)
.on('postgres_changes', …)` (Realtime is part of the existing project, free at launch scale —
"spend no money"; Realtime respects RLS when the client is authenticated, so the policies are
the whole delivery wall); schema — `conversations (id, created_at)` + `conversation_members
(conversation_id, user_id)` for two participants (or a `(user_a, user_b)` pair with a
canonical ordering and a unique key — the planner picks; two-person DMs only, no groups — SOC-12
says "direct"), `messages (id client uuid, conversation_id, sender_id, body ≤ a `limits.ts` cap
mirroring the CHECK, created_at)`; RLS — members read their conversations and messages; a
member inserts a message as themselves; **the privacy setting** — a `user_settings.dm_policy`
enum (`anyone | mutual_follows`) default anyone (the B47 switches precedent: synced setting, a
Settings → Privacy control), enforced by the **insert policy / a `private.can_message(sender,
recipient)` helper** (one home: not blocked either way via `private.blocked_either`, and when the
recipient's policy is mutual follows, both `follows` rows exist — note no mutual-follow helper
exists yet; the planner writes it once); a block also hides the existing conversation (read
policy consults the helper) so "a block cuts messaging" holds both ways; **messages are
online-only** (the Teams / votes precedent: a server-read surface; the device keeps no mirror,
no outbox — the planner records this reading against offline-first: logging and the Tool Kit
are unaffected); push: B47's `notify` gains a fifth event (`message`) and switch
`notify_messages` — or B48 records that DM pushes are a follow-up — the planner decides and
records; payload privacy — the push carries the sender's name only, never the message text;
UI — a Messages entry (You tab or Home header), a conversation list, a thread screen with a
composer, "Message" on a profile when `can_message` allows; moderation — reporting a message
needs the `reports` CHECK widened (B41 deferred the same for program comments) — decide or
defer explicitly; the Gate 2 probe — two throwaway users over the API with real JWTs: a message
lands, a third user reads nothing, a blocked pair is refused (42501), a recipient on mutual-follows
refuses a non-mutual sender and accepts after the follow-back, Realtime is verified by the
client subscription in a Jest fake plus the publication membership live (the session cannot
hold a websocket open; record that live real-time delivery is Tristen's two-device check). No
new dependency expected (`@supabase/supabase-js` includes Realtime); the ERD gains the tables,
enum and helper; the flowchart gains the Messages surfaces and the Realtime path.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B47 not yet on it — B31, B34, B35, B39, B42 and
B47 add device schema V11–V16, migrated on open). To update: stop the server (`netstat -ano |
findstr :8081` → `taskkill /PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout
--detach main`, `npm ci` in `Astra-main\frontend` if `package-lock.json` changed (it did not in
B30–B47), then `npx expo start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps; both launchers write stderr to
`automation/state/builder.err.log` / `planner.err.log` (gitignored) since the B42 builder died
after its work — recovery recipe in PIPELINE.md. Check order: `expo start --offline` ~150 s →
`tsc` → lint → Jest; Gate 2 frees ports 8097–8099, renders the diagrams with `mmdc`, and runs
live HTTP probes through the PowerShell tool with the throwaway-JWT recipe (persistent probe
rows deleted afterwards; an UPDATE whose RLS check fails raises 42501; `pg_net` deliveries can
take up to a minute, so re-read before concluding). Builders have hit Jest 30 s timeouts under
full-suite load at default workers and rerun with `--maxWorkers=50%`; Gate 2's cold-cache
default-worker runs have passed every time. Session helper: `automation/state/pipe.mjs`
(gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`). Executions 4/5 (B05) through
44 (B47); B48 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5,
B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0,
B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3, B21 ≈ $13.4, B22 ≈ $17.0,
B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4, B28 ≈ $17.1, B29 ≈ $8.5,
B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3, B34 ≈ $21.9, B35 ≈ $19.3, B36 ≈ $16.9, B37 ≈ $20.5,
B38 ≈ $11.6, B39 ≈ $14.5, B40 ≈ $13.9, B41 ≈ $18.9, B42 ≈ $7.4 planner + an unreported
builder, B43 ≈ $12.1, B46 ≈ $12.8, B47 ≈ $21.2 (≈ $589 reported for forty steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B47 first):
sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile;
log a multi-exercise workout, one-tap Repeat, force-kill and Resume; mid-workout after a logged
set, open the Tool Kit: 1RM, RPE, %1RM and Plates arrive prefilled; finish in airplane mode →
analysis with muscle map → Share → share sheet → post the PNG to another app → Next → Post /
Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle, Privacy, Export
your data, **Notifications (four switches save; "Turn on push" after `eas init`)**; Tool Kit
timer; Home → Latest / Hot and a flair chip → Share a photo → vote / comment → make a post
private → ⋯ Report → an author's profile → Follow, Re-share, Mute, Block → unblock; Find lifters;
Library → chips → a card → detail → PRs and sessions → New exercise in airplane mode → log → card →
edit → delete; Workout → Your programs → New program → weeks / workouts / exercises → kill →
reopen intact → Who can see this → Team → tick a team → Published; Workout → Start from a program
→ run card → Start next session → finish → Stop; Communities → Create a team → second account
joins → Team feed and Home chips → Invite only → Invite → join via invite; owner → Make coach;
coach → Announce, push a program (Save), push a workout (Start), Assign (Start → run); coach
opens the member's private workout from their profile; owner → Hide from Team feed → Unhide →
Remove from team → Remove a push → Delete team; second account → Marketplace → the published
program → search → page → upvote → comment → Featured → Save and Start; after five sessions →
the "Against your trend" card; You → Trends charts; **after `npx eas init`: a second account
follows, comments, upvotes and posts to a shared Team → four pushes, each tap opening the right
screen; flip one switch → only that kind stops**; airplane mode on the online surfaces →
connection messages; reconnect → rows and objects in Supabase; sign out; throwaway account →
Delete account → type DELETE → clean sign-in. Flips B05–B47 and their features to Done as each
holds. (2) **Moderation:** pick an appeal email for `docs/CONTENT_POLICY.md`; call `moderate`
once with your signed-in token on a throwaway post (probe list in DEFERRED). (3) Supabase
Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of record; the
session's toggle was declined by the permission layer). (4) **The Blocked steps the pipeline is
skipping:** B33 (video provider), B44 (define the accumulated-fatigue deload rule and the
next-session intensity rule), B45 (Strength Level data licence); B51 (Denver gym import), B55
and B56 later; **and for push: `npx eas init` (free) plus, for production iOS, Apple push
credentials — the pipeline will not buy an Apple Developer membership.** (5) Whether to grant
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
from local sets, windows from the last read, no charting library (B46); **push** — upvotes only,
vote flips and program social events do not notify, names and the act only in payloads,
default-on switches, one lifetime prompt after the first Post and never on launch, no receipt
polling, a stuck `sending` row is never retried, the open `notify` endpoint relies on
re-reading and the log key rather than a shared secret (B47).

Next pipeline step after B48 merges: **B49 accessibility-pass** (check the Build order table
for the exact branch name).
