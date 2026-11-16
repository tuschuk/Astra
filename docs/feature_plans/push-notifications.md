# B47 — Push notifications (`push-notifications`)

Covers the Notifications part of **YOU-4** (its Units, Account and Privacy parts shipped in B15 /
B26 — this step completes the feature). Step DoD: **each toggle stops exactly its notification.**
Depends on B23 (comments, votes) and B36 (teams); B37's `team_posts` is the Team-push event source.

## What ships

Four social events generate a push notification to the people they concern, each behind its own
per-user toggle in Settings → Notifications:

| Event (insert into) | Recipient(s) | Toggle column | Tap opens |
|---|---|---|---|
| `follows` | the followed lifter | `notify_follows` | `/profile/[follower]` |
| `comments` | the post's author | `notify_comments` | `/post-comments/[post]` |
| `votes` (upvotes only) | the post's author | `notify_votes` | `/post-comments/[post]` |
| `team_posts` | every team member except the author | `notify_team_pushes` | `/team/[team]` |

Sending happens server-side: an `AFTER INSERT` trigger on each table calls the new `notify` edge
function through `pg_net`; the function re-reads the true rows with the service role, applies the
recipient's toggles, blocks and mutes, and posts to Expo's free push API
(`https://exp.host/--/api/v2/push/send`). The phone stores an Expo push token per device in a new
`push_tokens` table and shows the four toggles in Settings.

## Settled decisions (grilled Nov 16, 2026)

1. **Toggles are columns on `user_settings`, not a new table.** The row already exists per user,
   has owner RLS, patches offline through `patchUserSettingsTx`, and syncs through the existing
   settings push/pull phases. A `notification_settings` table would re-build all of that for four
   booleans. Default **true** for all four (notifications are opt-in at the OS layer already; a
   toggle exists to stop each one).
2. **Transport is a `pg_net` trigger committed in a migration, not a dashboard Database Webhook.**
   Dashboard webhooks are pg_net triggers under the hood but live outside the repo (not
   migration-tracked) and bake an auth header into the trigger definition. Our own trigger is in
   git and sends **no secret at all** — see 3.
3. **The `notify` function deploys with `verify_jwt: false` and authenticates by re-reading.**
   The trigger's payload is only `{ event, keys }`. The function trusts none of it: it re-reads
   the named row with the service role and derives recipients, names and routes from the true
   rows. A forged call can at worst ask for a notification about a row that genuinely exists, and
   the `notification_log` unique key makes that a no-op (see 5). No shared secret in SQL, no
   Vault wiring, nothing billable. The function always answers quickly and never echoes row data.
4. **Recipients, filtered in one place (the function):** never the actor themselves; nothing when
   `private.blocked_either(actor, recipient)`; nothing when the recipient has muted the actor
   (`mutes` row). Votes notify on **upvotes only** (`value = 1`) — a downvote ping would be a
   pure unpleasantness product-wise (product call for Tristen to overrule). Vote *flips*
   (UPDATE down→up) don't notify — the step's scope says "on insert", and a flip is a change of
   mind, not a new reaction.
5. **`notification_log` is the idempotence key and the probe surface.** One row per
   (event, source row, recipient) with a status: `sent`, `skipped_setting`, `skipped_block`,
   `skipped_mute`, `skipped_self`, `no_tokens`, `send_failed`. Unique on
   `(event, source_key, recipient_id)` — a replayed trigger or a forged re-call inserts nothing
   and sends nothing. Service-role-only (RLS on, no policies). This is what Gate 2's live probe
   reads, and it is *not* a speculative notification-center store — it exists for idempotence
   first; rows also record Expo ticket ids (jsonb) for manual receipt checks.
6. **Payload privacy:** title/body carry the actor's display name and the kind of act only —
   "Alex started following you", "Alex commented on your post", "Alex upvoted your post",
   "Alex posted to <team name>". **No comment text, no workout data, no photo, no body data**
   (CLAUDE.md privacy rule; the handoff's "names and counts only"). `data` carries only the
   in-app route path.
7. **Token lifecycle, and registration through a definer RPC.** `push_tokens` is keyed by the
   token string (an Expo token names a device+install, not a user), owner-only RLS for reads and
   deletes, FK → `profiles(id)` on delete cascade (B32's account deletion needs no change).
   Registration does **not** go through a plain upsert: on the B07-known account-switch phone,
   user B's upsert of a token still owned by signed-out user A's undeleted row would fail RLS
   forever (the on-conflict update hits A's row). Instead a `security definer` RPC
   `public.register_push_token(token, platform, device_name)` deletes any existing row for that
   token (whoever owned it) and inserts it for `auth.uid()` atomically — the token follows the
   signed-in user, which is also the correct privacy outcome (A's pushes stop reaching B's
   hands). The app calls it on successful registration, on Expo's token-refresh listener, and on
   app start when already registered (which also serves as the `last_seen_at` bump). Settings →
   Sign out best-effort deletes this device's row *before* the session clears and never blocks
   the sign-out (offline sign-out still works; the stale row is then cleaned by the next
   account's registration or by `DeviceNotRegistered`). A ticket-stage `DeviceNotRegistered`
   error makes the `notify` function delete that token row (the one cleanup Expo's docs require).
8. **Receipts: tickets handled, polling deferred.** Expo answers a send synchronously with
   tickets (errors like `DeviceNotRegistered` handled, see 7, and recorded in the log row).
   Receipt *polling* needs a scheduled job ≥ 15 min later — infrastructure nothing currently
   needs (the "add nothing speculative" rule). Ticket ids are stored so a session or probe can
   check receipts by hand; a pg_cron poller is deferred until evidence of silent delivery loss.
9. **Permission ask — "first relevant moment", never on launch:** the OS prompt is triggered
   (a) explicitly from Settings → Notifications ("Turn on push notifications" affordance shown
   while unregistered), and (b) once, after the lifter's first successful Post in the
   finish-to-post flow (the moment they've just shared something people will react to), gated by
   a kv-store flag so it never re-asks. On app start the app registers **silently** only when
   permission is already granted (e.g. granted earlier for the B17 timer) — no prompt, so the
   "never on launch" rule holds.
10. **The client degrades exactly like the B17 timer.** All `expo-notifications` access goes
    through one new guarded, lazily-loading port (the `toolkit/timerAlerts.ts` pattern).
    `timerAlerts.ts` itself is **not touched**: its loader stays its own, the new module grows
    its own small copy, and the two merge only when a third user appears (the repo's standing
    merge rule — refactoring a shipped, device-sensitive file inside a feature diff buys
    nothing). Registration
    needs an EAS `projectId` in `app.json` (`extra.eas.projectId`) which **does not exist yet**:
    creating one is free (`npx eas init`) but needs Tristen's Expo account, so the pipeline can't
    do it. Until it lands, registration reports `unavailable`, the Settings section still shows
    the four toggles (they are server data and the DoD's subject) plus a calm line that push
    needs setup, and nothing crashes. This is recorded as Tristen's hands-on item, **not** a
    Blocked step — nothing here costs money.
11. **Expo Go reality (SDK 58):** remote push is not supported in Expo Go on **Android** — a
    local development build is needed there. iOS Expo Go still delivers via Expo's credentials
    once a projectId exists. Production iOS needs an Apple Developer membership — **a credential
    Tristen provides, never a purchase the pipeline makes**. None of this gates the step's DoD,
    which is proven server-side (tests + live probe of `notification_log`); real-device delivery
    is Tristen's device check.
12. **The project URL is hardcoded in the trigger migration** (it is public knowledge — it ships
    inside the app bundle). One live project, no Supabase branches in use; if a second
    environment ever appears, the URL moves to a `private.*` config function then.

## Files

### Backend

- `backend/supabase/migrations/<ts>_push_notifications.sql`
  - `create extension pg_net with schema extensions;` (available, not yet installed; free).
  - `push_tokens` (`token text primary key`, `user_id uuid not null references profiles on
    delete cascade`, `platform text check in ('ios','android')`, `device_name text null`,
    `created_at`, `last_seen_at`); index on `user_id`; RLS: owner select / delete only — writes
    go through `public.register_push_token(token, platform, device_name)`, a `security definer`
    function (empty `search_path`, the repo's definer habits) that refuses unauthenticated
    callers, validates its inputs, deletes any row with this token and inserts it for
    `auth.uid()` (decision 7).
  - `alter table user_settings add column notify_follows boolean not null default true;` — and
    the other three (`notify_comments`, `notify_votes`, `notify_team_pushes`).
  - `notification_log` (`id uuid pk default gen_random_uuid()`, `event text check in
    ('follow','comment','vote','team_push')`, `source_key text`, `recipient_id uuid references
    profiles on delete cascade`, `actor_id uuid`, `status text`, `tickets jsonb`, `created_at`);
    `unique (event, source_key, recipient_id)`; RLS on, **no policies** (service role only).
  - `private.notify_event()` — one trigger function: builds `{ event, keys }` from `TG_TABLE_NAME`
    and NEW's key columns, `net.http_post` to `<project-url>/functions/v1/notify`,
    fire-and-forget. Four `AFTER INSERT` triggers: `follows`, `comments`, `votes`, `team_posts`.
    (Failures land in `net._http_response`; a lost call loses one notification, never data.)
- `backend/supabase/functions/notify/index.ts` — wiring only (service-role client from the
  injected `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env, request parsing, 200/405 shape).
- `backend/supabase/functions/notify/handler.ts` — the decisions, deps-injected (the
  `analyze-workout` pattern): re-read the source row by its keys; derive actor, recipients and
  route; read each recipient's `user_settings` toggles, `blocked_either`, `mutes`, `push_tokens`;
  write `notification_log` rows (insert … on conflict do nothing — the dedupe gate *before*
  sending); batch messages ≤ 100 per Expo request; apply ticket errors.
- `backend/supabase/functions/notify/expoPush.ts` — the Expo API shape: message building,
  chunking, ticket parsing. Pure, unit-testable.
- `backend/supabase/functions/tests/notify.test.ts` — fakes, no network. **The DoD matrix is
  pinned here:** for each of the four events × each of the four toggles off, exactly the matching
  notification is skipped (`skipped_setting`) and the other three still send; plus: actor ==
  recipient skipped; blocked either way skipped; recipient-muted-actor skipped; downvote ignored;
  team push fans out to members minus author; a second identical call sends nothing (log
  conflict); > 100 tokens split into two Expo requests; `DeviceNotRegistered` ticket deletes the
  token; payload contains no comment body.

### Frontend

- `frontend/src/db/schema.ts` — **V16**: `alter table user_settings add column notify_follows
  integer not null default 1;` ×4 (device mirror of the server columns).
- `frontend/src/db/userSettings.ts` — widen `UserSettingsRow` / `UserSettingsFields` /
  `DEFAULT_USER_SETTINGS` with the four booleans; parse 0/1 ↔ boolean fail-open to true (a
  damaged value must not silence notifications the lifter never turned off… and must not spam
  either — default matches the server default, true).
- `frontend/src/sync/transport.ts`, `supabaseTransport.ts`, `test-utils/fakeTransport.ts` — the
  settings pull select list and push update body gain the four columns (same whole-row patch
  semantics; `pushUserSettings` already sends every settable field together).
- `frontend/src/settings/notificationSettings.ts` — read + toggle, the `privacySettings.ts`
  pattern: `patchUserSettingsTx` + outbox line in one transaction (offline-first; syncs on
  reconnect).
- `frontend/src/notifications/notificationsModule.ts` — the one guarded lazy
  `require('expo-notifications')` loader shared by push registration (moved/generalised from the
  timer's private copy only if that stays a true move, not a fork — otherwise the two loaders
  stay two small files and `timerAlerts.ts` is untouched; builder's call, recorded in this file).
- `frontend/src/notifications/pushRegistration.ts` — the port (timerAlerts shape):
  `registerForPush` (permission check/ask → `getExpoPushTokenAsync({ projectId })` → upsert row
  with platform + `expo-constants` device name), `silentRegisterIfGranted` (app start),
  refresh-listener wiring, `unregisterPush` (delete this token's row, best-effort), all
  returning quiet `unavailable` when the module, permission or projectId is missing. Online-only
  writes (a token is per-device server state, not training data; a failed upsert retries next
  app start).
- `frontend/src/notifications/notificationNav.ts` + `frontend/src/app/_layout.tsx` — notification
  response listener: a tapped notification's `data.path` goes through `router.push` after
  validating it against the three known route shapes (never navigate to an arbitrary string).
- `frontend/src/app/settings.tsx` — Notifications section between Privacy and Account: four
  switches (follows / comments / votes / Team pushes) backed by `notificationSettings.ts`,
  optimistic flip with revert-on-error (the unit/privacy pattern); plus the permission state:
  "Turn on push notifications" (asks) / "Push notifications are on for this device" / the
  needs-setup line when `unavailable`.
- `frontend/src/notifications/askOnce.ts` — `maybeAskForPushOnce()`: a kv-store flag gates a
  single lifetime ask; called from the two screens that perform a Post —
  `app/post-workout/[id].tsx` (workout posts, B21) and `app/new-post.tsx` (image posts, B22) —
  in their post-success paths.
- Sign-out in `settings.tsx` → best-effort `unregisterPush()` before `signOut()`; a failure
  (offline) is swallowed and sign-out proceeds (decision 7).
- Tests alongside each: `notificationSettings.test.ts`, `pushRegistration.test.ts` (fake module:
  granted / denied / no projectId / refresh / unregister), `notificationNav.test.ts` (path
  validation), `settings.test.tsx` additions (toggles flip, revert on error, section renders
  while unavailable), schema V16 migration test, transport/pull/push widening tests.

### Docs (builder's step 7)

- `docs/diagrams/database-erd.md` — `push_tokens`, `notification_log`, the four `user_settings`
  columns, the four triggers + `notify` function noted.
- `docs/diagrams/app-flow.md` — Settings → Notifications section; the insert → trigger →
  `notify` → Expo → device path; the tap → deep-link path.
- `docs/BUILD_LIST.md` status flips happen at Gate 2, not by the builder.

## How the DoD becomes observably true

- **"Each toggle stops exactly its notification"** — pinned three ways:
  1. the `notify.test.ts` matrix (4 events × 4 toggles, above);
  2. Gate 2's live probe: two throwaway users (the B32 recipe), a `push_tokens` row with a
     syntactically valid fake token for the recipient, then as the actor insert a follow, a
     comment, an upvote and a `team_posts` row → four `notification_log` rows for the recipient
     with the expected statuses; flip one toggle off, repeat its event on a fresh source row →
     that event logs `skipped_setting` (or, equivalently, no `sent` row) while the other three
     still log `sent`; plus the RPC probe: `register_push_token` as user A, then the same token
     as user B → one row, owned by B (the account-switch guarantee); probe rows deleted
     afterwards;
  3. the Settings screen test proving each switch writes exactly its own column.
- **YOU-4 completion** — the Settings screen now has all four areas; the Notifications section
  takes effect immediately on this device's copy and syncs like the unit toggle (a toggle flipped
  offline reaches the server on reconnect — same honesty as every other setting; the server reads
  its own copy when sending).
- **Delivery to a real phone** is Tristen's device check (Built → Done), needing: `npx eas init`
  (free) for a projectId, then iOS Expo Go or a local Android development build. Recorded in the
  handoff's hands-on list.

## Out of scope (deliberately)

- DM notifications — B48 (which depends on this step).
- An in-app notification center / inbox, badges, grouping, quiet hours, per-team or per-person
  granularity — no PRD line asks for them.
- Receipt polling on a schedule (see decision 8) and send retries beyond pg_net's single queued
  attempt — deferred until evidence.
- Notifying on vote flips, downvotes, re-shares, assignment pushes (`team_assignments`), or
  follower-of-follower events — inserts into the four named tables only.
- **Marketplace program votes / comments (B41 tables).** The handoff's recipient line ("the
  post / program author") can be read as including them; the step's scope and the standing
  trigger list name only `follows`, `comments`, `votes`, `team_posts`, so program social events
  are out. They would ride the same toggles and the same function via two more triggers — a
  natural later step once wanted. Flagged for Tristen rather than silently widened.
- Quote of comment text in the push body — excluded by the privacy stance (decision 6).
- Wiping another device's tokens on password change / global sign-out — the per-device delete on
  local sign-out plus `DeviceNotRegistered` cleanup covers the launch reality.

## Grilling record (Nov 16, 2026 — autonomous session, both roles)

The interactive grilling skill was invoked but this is a headless pipeline run, so the plan was
attacked with the same severity in-session. What the grilling changed or confirmed:

- **Found and fixed a real flaw:** the original plain-upsert token registration deadlocks on the
  B07 account-switch phone (RLS refuses user B's conflict-update of user A's stale row, forever).
  Replaced with the `register_push_token` definer RPC — decision 7 rewritten, migration and test
  lists updated.
- **Settled an ambiguity instead of absorbing it:** program votes/comments excluded with the
  reasoning recorded (Out of scope) — the handoff phrase admitted both readings.
- **Settled the loader question the draft had left to the builder:** `timerAlerts.ts` untouched;
  two small guarded loaders until a third user appears.
- **Pinned the ask-once placement** to the two real Post screens (`post-workout/[id]`,
  `new-post.tsx`) after checking where `createPost` is actually called.
- **Challenged `notification_log` as speculative — kept:** it is the idempotence/replay cap that
  makes `verify_jwt: false` safe (risk 1) and the Gate 2 probe surface; it is not a notification
  center.
- **Challenged skipping the edge function entirely** (pg_net straight to Expo's API from the
  trigger): refused — ticket handling and token cleanup need response processing pg_net doesn't
  give, and the scope itself mandates "sent from an edge function".
- **Confirmed transactional safety:** `net.http_post` queues inside the inserting transaction, so
  a rolled-back insert (e.g. a downvote the upvote-only trigger refuses) sends nothing.
- **Confirmed the scope is right as written** — nothing widened, nothing narrowed: tokens per
  device ✓, four per-event settings ✓, edge function on insert ✓; upvote-only votes is a product
  reading within "votes", recorded for Tristen to overrule.

## Risks (reviewer: read these first)

1. **`verify_jwt: false` on `notify`.** The function is reachable unauthenticated by design
   (triggers can't mint user JWTs without a secret in SQL, which is worse). Safety rests on:
   payload treated as untrusted keys only, service-role re-read of true rows, the
   `notification_log` unique key capping any replay at zero additional sends, and a payload that
   never echoes data back. Reviewer should confirm the handler can't be made to send arbitrary
   text or leak row existence through its responses (always the same 200/204 shape).
2. **Four booleans ride the existing settings sync.** `pushUserSettings` sends the *whole*
   settable field set; a device that hasn't migrated to V16 yet must not strip the columns of a
   row downloaded from the server (pull writes whole rows — V16 runs before any pull on open, so
   order is safe, but the widening touches push, pull, fake and schema in lockstep — the classic
   mirrored-shape hazard, like `limits.ts`).
3. **The permission / projectId degradation path.** Three independent reasons registration can
   be `unavailable` (no module in Expo Go Android, no OS permission, no projectId). The Settings
   section must stay fully functional for toggles in all three, and the app-start silent
   registration must never prompt. Easy to get a stray prompt-on-launch wrong — the tests fake
   all three states.
