# B48 — Direct messages (`direct-messages`)

Covers **SOC-12** (non-partial): direct messages; default anyone-can-message, limitable to
mutual follows; blocking blocks DMs. Feature DoD: **DMs deliver in real time, the privacy
setting is enforced server-side, and blocked users cannot message.** Step DoD: **messages
arrive in real time and both the setting and the block are enforced by the API.**
Depends on B27 (blocks, `blocked_either`, mutes, reports posture) and B47 (the `notify`
function and its trigger/switch pattern, which this step extends with a fifth event).

## What ships

Two lifters can message each other. A thread is reached from the other lifter's profile
("Message", shown when the server says messaging is allowed) or from a conversation list
behind a Messages button on Home. New messages in an open thread arrive live over Supabase
Realtime. A new `user_settings.dm_policy` choice in Settings → Privacy limits who may *start*
a conversation with you — anyone (default) or only mutual follows. A block hides the whole
conversation and refuses every send, both directions. A message push notification
("Alex sent you a message" — never the text) rides B47's `notify` function behind a fifth
switch, `notify_messages`.

## Settled decisions (grilled Nov 16, 2026 — record at the end)

1. **Two-person conversations as an ordered pair, not a membership table.**
   `conversations (id, user_a, user_b)` with `check (user_a < user_b)` and
   `unique (user_a, user_b)`. SOC-12 says *direct* messages; a `conversation_members` table
   exists only to serve group chats no PRD line asks for ("add nothing speculative"). The
   pair makes "the conversation with X" a single unique-index lookup, and every RLS policy a
   two-column comparison instead of a membership join. If group chat is ever a feature, it is
   a new table and a migration — nothing here blocks it.
2. **The privacy setting gates conversation *creation*; blocks gate everything, always.**
   `private.can_message(sender, recipient)` (one home: not self, no block either way, and —
   when the recipient's `dm_policy` is `mutual_follows` — both `follows` rows exist) is
   enforced by the **conversations insert policy**. The **messages insert policy** requires
   only that the sender is a member of a conversation they can currently *see* — and the
   conversations select policy itself requires membership **and** `not blocked_either`, so a
   block cuts sending, reading and Realtime delivery in one place without the rule being
   spelled twice. Why creation-only for the setting: if every send re-checked the recipient's
   policy, then after A (policy `mutual_follows`) messages non-mutual B, B could not reply —
   a broken one-way thread. Starting a conversation, or being started with under your then-
   current policy, is consent to the thread; the kill switch for an unwanted existing thread
   is block (the DoD's own remedy). Consequence, accepted and recorded: flipping to
   `mutual_follows` later does not silence conversations that already exist — it stops new
   ones. Gate 1 can overrule cheaply (add `can_message` to the messages insert policy, one
   clause), at the price of the broken-reply edge.
3. **A block hides the existing conversation both ways.** The conversations select policy is
   membership ∧ `not private.blocked_either(user_a, user_b)`. Messages policies reach
   conversations through RLS-checked subqueries, so the history disappears for both sides,
   sends are refused (the insert's `exists` finds no row → 42501), and Realtime stops
   delivering (postgres_changes re-checks RLS per subscriber). Unblocking restores reads —
   filtering never deletes (the B27 G15 posture).
4. **`dm_policy` is a `user_settings` text column (`'anyone' | 'mutual_follows'`, default
   `'anyone'`), not an enum type.** The `unit` column's exact precedent: text + CHECK, owner
   RLS already in place, synced by the existing settings push/pull, mirrored on the device
   (schema **V17**), patched offline through `patchUserSettingsTx` + outbox. The control is a
   two-chip row in Settings → Privacy. The *enforcement* is server-side only (`can_message`
   reads the server's copy); the phone's mirror exists so Settings works offline like every
   other setting.
5. **Mutual follows means both `follows` rows exist.** No mutual-follow helper exists yet
   anywhere; it is written once, inside `can_message` (two `exists` subqueries against
   `public.follows` under `security definer` — follows RLS only shows a user their own edges,
   so a definer helper is required, the `blocked_either` reasoning). No second home.
6. **Messages are online-only** — no SQLite mirror, no outbox, no device schema change beyond
   the two `user_settings` columns. The settled posture for server-read social surfaces
   (votes, comments, teams, marketplace): a DM exists to reach *another person*, which takes
   a connection by nature. Offline, the Messages screens show the standing calm connection
   message; logging and the Tool Kit are untouched, so the offline-first rule is intact.
   Recorded reading, not an accident.
7. **Threads are keyed by the other lifter, conversations are created on first send.** The
   thread route is `/messages/[userId]` (the *other* user's id). Opening it looks up the
   conversation by the unique pair; none yet → an empty thread ("Say hello"); the first send
   runs get-or-create (insert, on 23505 re-read — the `castVote` race posture) then inserts
   the message. No empty `conversations` rows from a tapped-but-never-used Message button,
   no separate "new conversation" route, and the push deep link is simply the sender's id.
8. **Realtime: one channel per open thread.** The migration runs
   `alter publication supabase_realtime add table public.messages;` (the publication exists
   and holds zero tables today — this is the first Realtime use in the app). The thread
   screen subscribes with
   `client.channel(…).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.<id>' }, …)`
   and unsubscribes on unmount. Realtime respects RLS for authenticated clients
   (supabase-js v2 forwards the session token), so the policies are the entire delivery
   wall — a third party's subscription receives nothing. The conversation *list* re-reads on
   focus (the Home/teams pattern) rather than holding a second subscription; the step DoD
   ("messages arrive in real time") is about the open thread. No new dependency:
   `@supabase/supabase-js` already includes the Realtime client.
9. **DM pushes ship here as B47's fifth event** (the handoff offered either way — decided:
   in). One more branch in `private.notify_event()`, an `AFTER INSERT` trigger on
   `messages`, a `notify_messages` switch (default true, Settings → Notifications fifth row),
   and a `message` event in the `notify` handler: recipient = the other member, payload
   "〈sender name〉 sent you a message" with route `/messages/<sender_id>` — **never the
   message text** (B47 decision 6, the CLAUDE.md privacy rule). The handler's standing
   filters apply unchanged: self, block (defense in depth — the insert already refused),
   recipient's mute, switch off, no tokens. Nuance recorded: B27 settled that *mute does not
   cut DMs*, so a muted sender's message still lands in the thread — but the push about it is
   skipped, exactly as pushes already behave for every event. The builder redeploys `notify`
   from the repo (replacing the comment-trimmed v1 — recorded as harmless in the handoff).
10. **Reporting a message is explicitly deferred** (the handoff asked for a decision).
    Widening `reports.target_kind` is a CHECK migration, two policy arms, the stamp trigger
    and a `moderate` redeploy — the same package B41 already deferred for program comments.
    The two should land together in one small moderation step. Until then the user's tool
    against an abusive DM is block (immediate, total — hides the thread and stops sends), and
    the founder's is the dashboard (service role reads messages). Deferred, not forgotten:
    recorded in DEFERRED at the end of the build.
11. **Message cap 2000 chars, trimmed non-blank** — a CHECK in the migration, mirrored by
    `MESSAGE_MAX_LENGTH` in `social/messages.ts` with a change-together comment (the
    `mediaLimits` / comment-cap precedent; this is social data, so the cap does *not* live in
    training-math's `limits.ts`). Client message ids are uuids generated on the phone (the
    posts precedent) so a retried send cannot double-insert.
12. **Ordering and the list read.** `conversations.last_message_at` (nullable timestamptz) is
    maintained by a definer `AFTER INSERT` trigger on messages — the conversation list's one
    ordering key, so the list is a single PostgREST read:
    `conversations?select=…,messages(sender_id,body,created_at)&messages.order=created_at.desc&messages.limit=1&order=last_message_at.desc`
    plus a profiles embed for the other member's name/avatar. Not speculative: an unordered
    inbox is unusable, and the alternative (a per-row `max(created_at)` aggregate) can't be
    expressed as a PostgREST order. The thread reads newest 50 with a grow-the-limit "Show
    older messages" (the B30 precedent); keyset paging when evidence calls for it. The list
    orders `last_message_at` descending **with nulls last** (get-or-create and the first
    message are two statements, so a crash between them can leave an empty conversation;
    such a row sorts to the bottom and renders as "No messages yet" — harmless, and healed
    by the next send into it).
13. **Out of scope** (each with its trigger): read receipts / unread badges (no PRD line;
    revisit on device evidence), typing indicators, message editing or deletion (delete lands
    with the post/comment-deletion UI family), group chats (new tables when a PRD line
    exists), reporting a message (10), realtime on the conversation list or feed, muting a
    conversation (mute-the-person exists; B27 settled it does not cut DMs), media in
    messages (NFR-4's media pipeline is for posts; a DM image feature is its own step).

## Data model (one migration: `<ts>_direct_messages.sql`)

```sql
-- May `sender` start a conversation with `recipient`? One home for the rule.
-- Definer: follows RLS hides other people's edges and user_settings is owner-only,
-- so an invoker-rights check would silently read "no".
create or replace function private.can_message(sender uuid, recipient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select sender <> recipient
     and sender is not null
     and not private.blocked_either(sender, recipient)
     and (
       coalesce((select s.dm_policy from public.user_settings s
                 where s.user_id = recipient), 'anyone') = 'anyone'
       or (exists (select 1 from public.follows f
                   where f.follower_id = sender and f.followee_id = recipient)
           and exists (select 1 from public.follows f
                       where f.follower_id = recipient and f.followee_id = sender))
     )
$$;

-- The profile's "Message" button asks this; the policies above enforce it regardless.
create or replace function public.can_message_user(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_message((select auth.uid()), target)
$$;
-- revoke from public/anon, grant execute to authenticated (the register_push_token pattern).

alter table public.user_settings
  add column dm_policy text not null default 'anyone'
    check (dm_policy in ('anyone', 'mutual_follows'));

create table public.conversations (
  id              uuid primary key,                -- client-generated (posts precedent)
  user_a          uuid not null references public.profiles (id) on delete cascade,
  user_b          uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,                     -- trigger-maintained; list ordering
  check (user_a < user_b),                         -- one canonical row per pair
  unique (user_a, user_b)
);
create index conversations_user_b_idx on public.conversations (user_b);
-- (user_a lookups ride the unique index's leading column.)

create table public.messages (
  id              uuid primary key,                -- client-generated
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null
                  check (char_length(body) <= 2000 and btrim(body) <> ''),
  created_at      timestamptz not null default now()
);
create index messages_thread_idx on public.messages (conversation_id, created_at desc, id);

alter publication supabase_realtime add table public.messages;
```

RLS (both tables `enable row level security`):

- `conversations` **select**: `(user_a = auth.uid() or user_b = auth.uid()) and not
  private.blocked_either(user_a, user_b)` — membership and the block wall, the one spelling
  every other policy leans on.
- `conversations` **insert**: `(user_a = auth.uid() or user_b = auth.uid()) and
  private.can_message(auth.uid(), case when user_a = auth.uid() then user_b else user_a end)`
  — you create only pairs you are in, only when the recipient's policy and blocks allow.
  (The CHECK enforces canonical order; no update/delete policies — nothing edits a
  conversation.)
- `messages` **select**: `exists (select 1 from public.conversations c where c.id =
  conversation_id)` — the subquery runs at the reader's rights, so conversations' own select
  policy (membership + block) is the whole rule, not spelled again (the B27 reports-policy
  pattern).
- `messages` **insert**: `sender_id = auth.uid() and exists (select 1 from
  public.conversations c where c.id = conversation_id)` — send as yourself, into a
  conversation you can currently see; a block makes the row invisible and the send a 42501.
  No update/delete policies this step (13).

A definer `AFTER INSERT` trigger on `messages` stamps
`conversations.last_message_at = new.created_at` (definer because members have no
conversations update policy), and the B47-shape `AFTER INSERT` trigger
`notify_on_message` queues `{ event: 'message', keys: { id } }` to `notify` via the extended
`private.notify_event()`. `notification_log.event` CHECK gains `'message'` — the B47 CHECK
is inline and unnamed, so the migration drops it by its auto-generated name
(`notification_log_event_check`) and re-creates it widened; `user_settings` gains
`notify_messages boolean not null default true`.

All `auth.uid()` calls in policies are written `(select auth.uid())` (the repo's standing
per-row-initplan habit).

## Files to create or change

### Backend

| File | Change |
|---|---|
| `backend/supabase/migrations/<ts>_direct_messages.sql` | new — everything above: `can_message`, `can_message_user`, `dm_policy`, `conversations`, `messages`, RLS, triggers (`last_message_at`, notify), publication add, `notify_event()` re-create with the fifth branch, `notification_log` CHECK widen, `notify_messages` column |
| `backend/supabase/functions/notify/handler.ts` | edit — `message` event: re-read the message + conversation with the service role, recipient = other member, title/body = sender's name + "sent you a message", route `/messages/<sender_id>`; standing filters unchanged |
| `backend/supabase/functions/notify/index.ts` | edit — accept the `message` payload keys |
| `backend/supabase/functions/tests/notify.test.ts` | edit — message event rows in the matrix: sent / switch off / blocked / muted / self / no tokens; payload carries no body text |

### Frontend

| File | Change |
|---|---|
| `frontend/src/db/schema.ts` | edit — **V17**: `user_settings` gains `dm_policy text default 'anyone'`, `notify_messages integer default 1` |
| `frontend/src/db/userSettings.ts` | edit — widen row/fields/defaults; parse fail-safe to the server defaults |
| `frontend/src/sync/transport.ts`, `supabaseTransport.ts`, `test-utils/fakeTransport.ts` | edit — settings select list + push body gain both columns (the B47 lockstep set; `settableFields` feeds them) |
| `frontend/src/settings/dmSettings.ts` (+ test) | new — read + set `dm_policy`, the `privacySettings.ts` pattern (patch + outbox in one tx) |
| `frontend/src/settings/notificationSettings.ts` (+ test) | edit — `notify_messages` joins `NOTIFY_FIELDS` |
| `frontend/src/social/messages.ts` (+ test) | new — online-only, client-as-parameter: `MESSAGE_MAX_LENGTH`, `conversationWith(client, me, other)` (pair lookup), `getOrCreateConversation` (insert → 23505 re-read; 42501 → refused result), `listConversations` (the embed read, decision 12), `listMessages` (newest 50, grow-the-limit), `sendMessage` (uuid id; refusal maps to a calm line), `canMessageUser` (the RPC) |
| `frontend/src/social/useThread.ts` (+ test) | new — thread state: initial read, the Realtime channel subscribe/unsubscribe on the conversation id, appending INSERT payloads (dedupe by id against own optimistic send), re-read on reconnect/focus |
| `frontend/src/app/messages/index.tsx` (+ test in `src/__tests__/`) | new — conversation list: avatar/name, last line preview, time; tap → thread; empty state; connection message offline |
| `frontend/src/app/messages/[userId].tsx` (+ test in `src/__tests__/`) | new — the thread: inverted list, composer (cap from `MESSAGE_MAX_LENGTH`), send states, "Say hello" empty thread, refusal lines ("You can't message this lifter" — one calm sentence for block/policy alike) |
| `frontend/src/app/(tabs)/index.tsx` | edit — a Messages button in Home's header actions row (beside "Share a photo" / "Find lifters") → `/messages` |
| `frontend/src/components/profile/ProfileView.tsx` (+ test) | edit — "Message" button with the follow/mute/block group on other people's profiles, rendered only when `can_message_user` answers true (a failed read hides it — the B27 no-guessing posture) → `/messages/[userId]` |
| `frontend/src/app/settings.tsx` (+ test) | edit — Privacy section: "Who can message you" two-chip row (`dmSettings.ts`); Notifications section: fifth switch "Messages" |
| `frontend/src/notifications/notificationNav.ts` (+ test) | edit — fourth valid route shape `/messages/<uuid>` |
| `frontend/src/test-utils/` fake client | edit — `channel()` fake recording `on(...)` args and letting tests push INSERT payloads; messages/conversations tables in the fake |

### Docs (builder's Document step)

- `docs/diagrams/database-erd.md` — both tables, columns, keys, RLS rules, `dm_policy` +
  `notify_messages`, `can_message` / `can_message_user`, the two triggers, the publication
  membership note.
- `docs/diagrams/app-flow.md` — Messages list + thread screens, the profile/Home entries, the
  send path (app → PostgREST insert → RLS), the delivery path (insert → Realtime → open
  thread; insert → trigger → `notify` → Expo → tap → deep link), the offline message posture.

Builder footguns (standing list): new routes → `npx expo start --offline` (~150 s) before
`tsc` → lint → Jest; apply the migration via MCP then rename the file to the recorded
version; redeploy `notify` from the repo; Jest full-suite under load may need
`--maxWorkers=50%` (Gate 2 reruns cold at defaults).

## How the DoDs become observably true

- **"Messages arrive in real time"** — three layers, honestly split:
  1. Jest: `useThread` against the fake channel — subscribes with the exact
     `postgres_changes` args (schema/table/event/filter), an injected INSERT payload appears
     in the thread once (dedupe), unsubscribes on unmount.
  2. Live (builder/Gate 2): `select * from pg_publication_tables where pubname =
     'supabase_realtime'` lists `public.messages`; a sent message read back over PostgREST
     by the recipient's JWT within the same probe.
  3. A live two-phone websocket delivery cannot be held open by a headless session —
     **recorded as Tristen's device check** (two accounts, both threads open, messages appear
     without refresh). The step is Built on 1+2; SOC-12 goes Done at the device check, the
     standing Built→Done split.
- **"The privacy setting is enforced server-side"** — Gate 2 probe with two throwaway users
  over the REST API (real JWTs, the B32 recipe): B sets `dm_policy = 'mutual_follows'`;
  non-mutual A's conversation insert → 42501; B follows A back (A already follows B) → the
  same insert succeeds; the `can_message_user` RPC answers false then true in step. Nothing
  client-side is the wall — the app's hidden button is a courtesy.
- **"Blocked users cannot message" / "a block cuts messaging"** — Gate 2: with a
  conversation and messages in place, B blocks A → A's `conversations` read returns zero
  rows, A's message insert → 42501, B's read also empty (both ways), A's fresh
  conversation insert → 42501 (`can_message`); unblock → history visible again. Jest pins
  the app-side refusal mapping.
- **"DM push behind its switch"** — the notify matrix in Jest (event × switch × filters);
  Gate 2 live: a message between probe users writes a `notification_log` row
  (`event = 'message'`), switch off → `skipped_setting` on a fresh message, replay adds
  nothing; probe rows and users deleted after.
- **Settings sync** — V17 migration test; transport lockstep tests; Settings screen tests
  (chip writes exactly `dm_policy`; fifth switch writes exactly `notify_messages`).

## Offline / privacy / rules check

- **Offline-first:** logging and the Tool Kit untouched; Messages is an online surface by
  the settled posture (decision 6), with the standing connection message. The two new
  settings patch offline and sync like every other setting.
- **RLS, never client-side:** every wall (membership, block, policy) is a policy or a
  definer helper; Realtime delivery itself is RLS-checked. The app only hides buttons the
  server would refuse anyway.
- **One home:** blocks stay in `blocked_either`; the DM rule lives once in `can_message`;
  mutual-follows is spelled once, inside it; membership+block is spelled once (conversations
  select) and reached by subquery everywhere else; the cap is one constant mirroring one
  CHECK.
- **Privacy:** pushes carry a name and the act only, never message text; `notification_log`
  stays service-role-only; messages are readable only by their two members (and the service
  role — the founder's dashboard, as everywhere).
- **Nothing speculative:** no receipts, no typing, no groups, no unread counters, no list
  realtime, no message search (13). `last_message_at` is justified by the list's one read.
- **No AI, no numeric claims, training math untouched.**

## Out of scope

See decision 13; plus — per the B41/B48 reports item — message reporting (10), and any
message retention/cleanup job (rows are small; the account-deletion cascade already removes
a lifter's conversations and messages via the profiles FKs — B32 needs no change, but
`export-data` gains messages only with the standing programs/runs widening, recorded in
DEFERRED's B34 item... **correction, recorded honestly:** `export-data` does not export
messages this step; it joins the standing export-widening item).

## Risks (reviewer: read these first)

1. **First Realtime use in the app — the delivery claim rests on configuration, not code.**
   The publication add, RLS-checked `postgres_changes`, and supabase-js forwarding the
   session token to the websocket have never been exercised in this repo. The Jest fake pins
   our side only. If RLS-filtered delivery misbehaves (e.g. the subscriber token not
   refreshing on session renewal), the fallback is re-read-on-event or polling-on-focus —
   but that is a DoD change and must come back to a gate, not be slipped in. Mitigation: the
   builder keeps the subscription narrow (INSERT + conversation filter), `useThread` re-reads
   on focus anyway (belt and braces for a missed event), and Gate 2 verifies the publication
   and policies live even though the websocket itself waits for the device check.
2. **The creation-only policy reading (decision 2).** "Limitable to mutual follows" is
   enforced when a conversation starts, not per send. Defended above (broken-reply edge),
   but it is a product reading of SOC-12's one sentence: an existing thread survives a later
   policy flip, and the remedy is block. If Gate 1 reads it stricter, the change is one
   clause in the messages insert policy — decide before code, not after.
3. **`notify_event()` is re-created and `notify` redeployed** — the shared push path for
   five live event kinds. A mistake in the re-created trigger function or the widened
   handler breaks pushes for follows/comments/votes/team posts too, and the deployed
   function's drift (comment-trimmed v1) means the redeploy must come from the repo. The
   notify test matrix covers all five events; Gate 2's live probe should re-run one
   pre-existing event (e.g. a follow) alongside the message event to prove the old paths
   still log `sent`.

## Grilling record (Nov 16, 2026 — headless pipeline session, grilled in-session at full severity)

The `mattpocock-skills:grilling` posture applied by the planner session (headless run; no
interactive user). Checkable claims verified against the repo: the identity migration
(`blocked_either`, follows RLS, `user_settings` shape), the B47 migration (`notify_event()`
branches, `notification_log` CHECK, switch columns), `privacySettings.ts` /
`notificationSettings.ts` (the settings patterns named), `ProfileView.tsx` (the action-row
seam), Home's header actions row, `lib/supabase.ts` (supabase-js v2), and a repo-wide grep
proving **no** `channel(`/`postgres_changes` call exists yet.

- **G1 — "Pair table forecloses groups; members table costs one join. Why bet?"** Because
  the join is not the real cost — the policies are. With members, *every* message policy
  becomes `exists (membership)` with its own RLS recursion hazard (membership read policy
  consulting membership), a classic Postgres RLS trap needing a definer helper to break.
  The pair needs none of that, and SOC-12 plus "nothing speculative" both point at it.
  Settled: pair.
- **G2 — "Creation-only enforcement is a loophole: set `anyone`, collect a spammer, flip to
  `mutual_follows`, they can still message you."** True, and block exists precisely for
  that person — one tap, total. The alternative (per-send checks) breaks legitimate threads
  (the non-mutual reply edge in decision 2) to close a loophole whose victim already holds
  the stronger tool. Settled: creation-only, flagged as risk 2 for Gate 1.
- **G3 — "Why is the list read one embed instead of a view?"** Because PostgREST expresses
  it directly (top-1 embedded messages + profiles) and `last_message_at` gives the order; a
  view is machinery with no current justification. The trigger that maintains
  `last_message_at` was challenged as denormalization — kept: the alternative order-by is
  inexpressible in PostgREST, and the trigger is five definer lines.
- **G4 — "`can_message_user` RPC leaks relationship state (blocked/policy) to any signed-in
  user."** It answers only a boolean the sender would learn by trying anyway (the insert's
  42501), and it does not say *why*. Same information surface, politer path. Kept.
- **G5 — "Fifth push event widens the step's scope — the scope sentence says tables, RLS,
  Realtime, setting, block."** The handoff's standing input for B48 explicitly offers the
  fifth event as the planner's decision, and the marginal cost is one trigger branch + one
  column + one handler case on infrastructure B47 built for exactly this. A messenger that
  never pings is half-shipped on mobile. Decided: in, recorded as decision 9; the DoD does
  not depend on it, so a Gate 1 strike-out shrinks the diff without touching the step DoD.
- **G6 — "Realtime per-subscriber RLS checks are a known scaling cliff."** At launch scale
  (one open thread per active user, INSERT-only, filtered) this is far below any documented
  threshold, and the architecture doc names Supabase Realtime as the DM carrier. Revisit on
  measured evidence, like everything else (the Redis rule). Recorded in risk 1's fallback.
- **G7 — "Why newest-50 grow-the-limit instead of proper keyset paging in a chat, where
  scrollback is normal?"** The B30/B40 precedent: grow-the-limit is one state variable and
  correct; keyset is a measured-need upgrade. The thread index `(conversation_id,
  created_at desc, id)` is already shaped for keyset when that day comes.
- **G8 — "Does a message to a conversation whose other account was *deleted* break
  anything?"** The profiles FK cascades the conversation and its messages away with either
  account (B32 unchanged); a thread with a deleted account simply vanishes — the teams
  "creator deletion cascades the team" posture. Accepted; no tombstone UI.
- **G9 — "Optimistic send vs Realtime echo: the sender's own INSERT arrives on their
  channel too."** Pinned in the plan: `useThread` dedupes by message id (client uuid), so
  the echo is a no-op. A test covers it (send, then inject the same id).
- **G10 — "Is the Home-header Messages entry enough? The handoff floated the You tab too."**
  Home's header actions row already holds exactly this kind of entry ("Share a photo",
  "Find lifters" — verified in `index.tsx`). One entry, one home; the push deep link and the
  profile button are the other doors. Settled: Home header only.
- **G11 — "Cheaper still: no `conversations` table at all — messages carry a `(sender,
  recipient)` pair and threads are derived."** Rejected: the conversation list becomes a
  `DISTINCT ON` over normalized pairs, which PostgREST cannot express (it would force a view
  or an RPC — more machinery, not less), every policy re-derives the pair, and there is no
  row to hang `last_message_at` or a future per-thread feature on. The table is the policy
  anchor and the list read.
- **G12 — "Decision 7 claims no empty conversations exist; is that true under a crash?"**
  No — get-or-create and the first message insert are two statements, so an empty row with
  null `last_message_at` is possible, and Postgres sorts nulls *first* under `desc`. Fixed
  in decision 12: nulls-last ordering, and the list tolerates the row ("No messages yet").
- **G13 — "Does widening `notification_log`'s event CHECK work as an ADD?"** No — B47's
  CHECK is inline/unnamed; it must be dropped by its auto-generated name and re-created.
  Spelled in the data-model section so the builder doesn't discover it at apply time.
- **Scope verdict:** right as written. Nothing narrowed; one deliberate, flagged widening
  (the fifth push event, G5) grounded in the handoff's explicit offer; the reports widening
  explicitly deferred rather than silently absorbed (decision 10).

## Build record and deviations (builder, Nov 16, 2026)

Shipped as planned, with these deliberate differences (each recorded here, not slipped in):

1. **A second migration, `20261116070550_direct_messages_server_time.sql`** (code-review fix).
   The insert policies check *who* writes, but a client could send its own `created_at` (and a
   new conversation's `last_message_at`). A future-dated message would sort wrongly and, through
   the `greatest()` stamp, pin its conversation to the top of both inboxes for good. `BEFORE
   INSERT` triggers on both tables now overwrite those columns with server values. Probed live:
   a forged 2099 timestamp is replaced.
2. **The `last_message_at` stamp uses `greatest(coalesce(last_message_at, new.created_at),
   new.created_at)`** rather than a plain assignment, so an out-of-order insert can't move the
   inbox order backwards. It is harmless now that `created_at` is server time.
3. **An extra index, `messages_sender_idx (sender_id)`**, covers the account-deletion cascade
   through `messages.sender_id` (the advisor's unindexed-FK class).
4. **`private.can_message` keeps EXECUTE for `authenticated`** (revoked from public/anon). The
   policies call it as the signed-in lifter, so a revoke from `authenticated` would break every
   insert.
5. **The profile's Message button asks `canOpenThread`, not just `can_message_user`** (spec
   review). Taken literally, a non-mutual lifter who was messaged by someone set to
   `mutual_follows` had no Message button on that person's profile, even though decision 2 says
   they may reply. `canOpenThread` = the RPC **or** an existing conversation the viewer can see.
   A block hides the conversation, so the button still hides on a block.
6. **The thread is a `ScrollView` that scrolls itself to the end on every content-size change,
   not an inverted `FlatList`.** Same outcome (newest in view on open, on send, on a live
   arrival) with no list virtualisation, which is fine at 50-message pages (grow-the-limit). Move
   to an inverted FlatList if long threads lag on a device.
7. **Sends are confirmed, not optimistic.** The message appears when the server returns it
   (about one round trip, with "Sending…" on the button). The id-dedupe against the live echo
   that the plan asked for is in place and tested.
8. **The thread re-reads on focus only, not on network reconnect.** A thread left open across a
   signal drop picks up missed messages on the next focus, or from the live channel once
   supabase-js reconnects it. A reconnect listener can be added if a device check shows a gap.
9. **Message length is counted in code points everywhere** (`messageLength`, matching the
   server's `char_length`), and the composer has no `maxLength`. The box's UTF-16 count would
   have refused emoji early. A counter and a "too long" line guide instead, as for comments.
10. **A dedicated test fake, `test-utils/fakeMessagesClient.ts`**, instead of more branches in
    `fakeSocialClient.ts`. DMs need a signed-in identity and Realtime channels, which that fake has
    no notion of. The profile tests still use the social fake, through its `rpc` option.
11. **The conversation list reads at most 100 conversations** (no paging). Revisit when someone
    reaches that.
12. **`notify` v2 was deployed with comment-trimmed `handler.ts` / `expoPush.ts`** (the bundle
    upload). The logic is byte-for-byte the repo's, and `index.ts` is the repo copy. This is the
    same posture as B47's v1.
13. **The two new routes are declared in the root layout's signed-in guard** (`messages/index`,
    `messages/[userId]`). The plan's file table missed `_layout.tsx`. `sync/transport.ts` needed
    no change: the types flow through `UserSettingsFields`.

Review (the `mattpocock-skills:code-review` skill, two axes). The findings fixed are items 1, 5, 6
and 9 above, plus a `useThread` docstring and a `Pick<Message>` for the list's last line. The
findings left as judgement calls are: `setDmPolicy` is the fourth copy of the "patch + outbox +
notify" sequence (the settings precedent); `UNIQUE_VIOLATION` / `RLS_REFUSED` are redeclared
rather than imported from `teams.ts`; the settings row's non-switch fields are still listed in
several places (Shotgun Surgery). `messageTime` stays local to the thread screen.
