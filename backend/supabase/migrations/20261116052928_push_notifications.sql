-- =============================================================================
-- B47 — Push notifications (YOU-4's Notifications section)
-- =============================================================================
-- Four social events send a push to the people they concern, each behind its own
-- switch in Settings → Notifications:
--   follows     → the followed lifter           (user_settings.notify_follows)
--   comments    → the post's author             (user_settings.notify_comments)
--   votes (+1)  → the post's author             (user_settings.notify_votes)
--   team_posts  → every member but the author   (user_settings.notify_team_pushes)
--
-- How a push travels: an AFTER INSERT trigger on each table queues one HTTP call
-- (pg_net — free, built into Supabase) to the `notify` server function carrying
-- only the new row's KEYS. The function trusts nothing in that call: it re-reads
-- the real row with the server key, works out who to tell, checks each person's
-- switch, blocks and mutes, and posts to Expo's free push service. No secret is
-- stored in SQL. A call that never arrives loses one notification, never data.
--
-- What this migration adds:
--   1. pg_net;
--   2. push_tokens — one row per phone that can receive pushes (owner reads and
--      deletes; writes only through register_push_token);
--   3. register_push_token(token, platform, device_name) — the one way in;
--   4. the four switches on user_settings, default on;
--   5. notification_log — one row per (event, source row, recipient): the
--      "already handled" key that makes a repeated call send nothing, and the
--      record of what happened. Server key only;
--   6. the trigger function and its four triggers.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. pg_net — queues HTTP calls from SQL, sent after the transaction commits.
-- ----------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- 2. push_tokens
-- ----------------------------------------------------------------------------
-- An Expo push token names one install of the app on one phone, not a person,
-- so the token itself is the key: if a different lifter signs in on that phone,
-- the row moves to them (see register_push_token). Deleted with the account.
create table public.push_tokens (
  token        text primary key
               check (char_length(token) <= 200
                      and token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android')),
  device_name  text check (char_length(device_name) <= 100),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "users read their own push tokens"
  on public.push_tokens for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Sign-out removes this phone's row (best effort, from the app).
create policy "users delete their own push tokens"
  on public.push_tokens for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update policies on purpose: a plain upsert of a token still owned by
-- the lifter who used this phone before would be refused forever (the conflict
-- update hits their row). register_push_token does it safely instead.

-- ----------------------------------------------------------------------------
-- 3. register_push_token — saves this phone's token for the signed-in lifter
-- ----------------------------------------------------------------------------
-- Called by the app when push is turned on, when Expo hands it a new token, and
-- on each start while push is on (which also refreshes last_seen_at). Whoever
-- owned the token before loses it — the phone is in someone else's hands now, so
-- their notifications must stop reaching it. Returns nothing.
create or replace function public.register_push_token(p_token text, p_platform text, p_device_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  -- The table's CHECKs validate the token, platform and device name; a bad value
  -- fails the insert with a check_violation the app reports as "couldn't turn on".
  insert into public.push_tokens as t (token, user_id, platform, device_name)
  values (p_token, me, p_platform, left(nullif(trim(p_device_name), ''), 100))
  on conflict (token) do update
    set user_id      = excluded.user_id,
        platform     = excluded.platform,
        device_name  = excluded.device_name,
        -- A token that changed hands starts a new life; the same owner keeps theirs.
        created_at   = case when t.user_id = excluded.user_id then t.created_at else now() end,
        last_seen_at = now();
end;
$$;

revoke execute on function public.register_push_token(text, text, text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The four switches (owner RLS on user_settings already covers them)
-- ----------------------------------------------------------------------------
alter table public.user_settings
  add column notify_follows     boolean not null default true,
  add column notify_comments    boolean not null default true,
  add column notify_votes       boolean not null default true,
  add column notify_team_pushes boolean not null default true;

-- ----------------------------------------------------------------------------
-- 5. notification_log — server key only (RLS on, no policies)
-- ----------------------------------------------------------------------------
-- source_key names the row that caused the event: the comment / team post id,
-- 'follower:followee' for a follow, 'post:voter' for a vote. The unique key is
-- the gate the function passes BEFORE sending: a repeated or forged call for the
-- same event inserts nothing, so it sends nothing.
create table public.notification_log (
  id           uuid primary key default gen_random_uuid(),
  event        text not null check (event in ('follow', 'comment', 'vote', 'team_push')),
  source_key   text not null check (char_length(source_key) <= 100),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id     uuid,
  status       text not null check (status in (
                 'sending', 'sent', 'send_failed', 'no_tokens',
                 'skipped_setting', 'skipped_block', 'skipped_mute', 'skipped_self')),
  -- Expo's per-message answers (ticket ids or errors), kept for checking receipts by hand.
  tickets      jsonb,
  created_at   timestamptz not null default now(),
  unique (event, source_key, recipient_id)
);

create index notification_log_recipient_idx on public.notification_log (recipient_id);

alter table public.notification_log enable row level security;

-- ----------------------------------------------------------------------------
-- 6. The trigger: queue a call to `notify` with the new row's keys
-- ----------------------------------------------------------------------------
-- Security definer so the queueing works whoever inserted the row (pg_net's
-- functions are not granted to app users). The project URL is public — it ships
-- inside the app — so it is written here; if a second environment ever exists it
-- moves to a config function. Only keys go out: never a comment's text.
create or replace function private.notify_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  -- Separate branches (not one CASE): each names only columns its own table has.
  if tg_table_name = 'follows' then
    payload := jsonb_build_object('event', 'follow',
      'keys', jsonb_build_object('follower_id', new.follower_id, 'followee_id', new.followee_id));
  elsif tg_table_name = 'comments' then
    payload := jsonb_build_object('event', 'comment', 'keys', jsonb_build_object('id', new.id));
  elsif tg_table_name = 'votes' then
    payload := jsonb_build_object('event', 'vote',
      'keys', jsonb_build_object('post_id', new.post_id, 'user_id', new.user_id));
  elsif tg_table_name = 'team_posts' then
    payload := jsonb_build_object('event', 'team_push', 'keys', jsonb_build_object('id', new.id));
  end if;

  if payload is not null then
    -- A failure to queue must never refuse the follow / comment / vote / post
    -- itself: the lifter's action matters more than the ping about it.
    begin
      perform net.http_post(
        url     := 'https://qczhvuzdxpmfztxrifyg.supabase.co/functions/v1/notify',
        body    := payload,
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    exception when others then
      raise warning 'notify_event: could not queue the push call: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke execute on function private.notify_event() from public, anon, authenticated;

create trigger notify_on_follow
  after insert on public.follows
  for each row execute function private.notify_event();

create trigger notify_on_comment
  after insert on public.comments
  for each row execute function private.notify_event();

-- Upvotes only: a downvote never pings anyone (a product call — plan decision 4).
create trigger notify_on_upvote
  after insert on public.votes
  for each row when (new.value = 1) execute function private.notify_event();

create trigger notify_on_team_post
  after insert on public.team_posts
  for each row execute function private.notify_event();
