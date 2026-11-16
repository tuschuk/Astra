-- =============================================================================
-- B48 — Direct messages (SOC-12)
-- =============================================================================
-- Two lifters can message each other. Three walls, all on the server:
--   1. Membership — only the two people in a conversation can read or write it.
--   2. Blocks — a block either way hides the whole conversation from both sides,
--      refuses every send, and (because Realtime re-checks these policies for
--      each subscriber) stops live delivery. Unblocking brings the history back.
--   3. The recipient's "who can message you" setting (user_settings.dm_policy):
--      'anyone' (default) or 'mutual_follows'. It decides who may START a
--      conversation with you. An existing conversation stays open — starting it
--      (or being started with under your policy at the time) is consent to the
--      thread, so a non-mutual recipient can still reply. Block is the remedy for
--      an unwanted existing thread (plan decision 2).
--
-- What this migration adds:
--   1. user_settings.dm_policy and user_settings.notify_messages;
--   2. private.can_message(sender, recipient) — the one home of the DM rule —
--      and public.can_message_user(target) — the app's polite question;
--   3. conversations (an ordered pair of lifters) and messages, with RLS;
--   4. a trigger keeping conversations.last_message_at (the inbox order);
--   5. Realtime: messages joins the supabase_realtime publication;
--   6. push: notify_event() gains a 'message' branch, a trigger on messages,
--      and notification_log accepts the 'message' event.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. The two settings (owner RLS on user_settings already covers them)
-- ----------------------------------------------------------------------------
alter table public.user_settings
  add column dm_policy text not null default 'anyone'
    check (dm_policy in ('anyone', 'mutual_follows')),
  add column notify_messages boolean not null default true;

-- ----------------------------------------------------------------------------
-- 2. can_message — may `sender` start a conversation with `recipient`?
-- ----------------------------------------------------------------------------
-- Yes when: they are two different, signed-in people; neither has blocked the
-- other; and either the recipient accepts messages from anyone, or the two
-- follow each other (both follows rows exist — the only place "mutual follows"
-- is spelled). Security definer: follows RLS hides other people's edges and
-- user_settings is owner-only, so an invoker-rights check would silently read
-- "no" (the blocked_either reasoning).
create or replace function private.can_message(sender uuid, recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select sender is not null
     and recipient is not null
     and sender <> recipient
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

-- The policies below call it as the signed-in lifter, so authenticated keeps EXECUTE.
revoke execute on function private.can_message(uuid, uuid) from public, anon;
grant execute on function private.can_message(uuid, uuid) to authenticated;

-- The profile's "Message" button asks this. It answers only yes/no — what the
-- caller would learn anyway by trying — never why. The policies below enforce
-- the same rule whether or not the app asked.
create or replace function public.can_message_user(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.can_message((select auth.uid()), target), false)
$$;

revoke execute on function public.can_message_user(uuid) from public, anon;
grant execute on function public.can_message_user(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. conversations and messages
-- ----------------------------------------------------------------------------
-- A conversation is one unordered pair of lifters, stored in a fixed order
-- (user_a < user_b) so each pair has exactly one row. Ids are made on the phone.
-- Either account's deletion removes the conversation and its messages.
create table public.conversations (
  id              uuid primary key,
  user_a          uuid not null references public.profiles (id) on delete cascade,
  user_b          uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  -- When the newest message was sent (trigger-kept); null until the first one.
  last_message_at timestamptz,
  check (user_a < user_b),
  unique (user_a, user_b)
);

-- user_a lookups ride the unique index's leading column; this covers user_b.
create index conversations_user_b_idx on public.conversations (user_b);

alter table public.conversations enable row level security;

-- The one spelling of "membership and no block". Every messages policy reaches
-- conversations through a subquery that runs under this policy.
create policy "members read their unblocked conversations"
  on public.conversations for select
  to authenticated
  using (
    ((select auth.uid()) = user_a or (select auth.uid()) = user_b)
    and not private.blocked_either(user_a, user_b)
  );

-- You start only conversations you are in, and only when can_message allows.
-- Nothing updates or deletes a conversation from the app (no policies).
create policy "members start conversations the recipient allows"
  on public.conversations for insert
  to authenticated
  with check (
    ((select auth.uid()) = user_a or (select auth.uid()) = user_b)
    and private.can_message(
          (select auth.uid()),
          case when user_a = (select auth.uid()) then user_b else user_a end)
  );

-- One message. 2000 characters at most and not blank — mirrored by
-- MESSAGE_MAX_LENGTH in frontend/src/social/messages.ts (change together).
create table public.messages (
  id              uuid primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null
                  check (char_length(body) <= 2000 and btrim(body) <> ''),
  created_at      timestamptz not null default now()
);

create index messages_thread_idx on public.messages (conversation_id, created_at desc, id);
create index messages_sender_idx on public.messages (sender_id);

alter table public.messages enable row level security;

-- You read a message when you can read its conversation (membership + block).
create policy "members read messages in their conversations"
  on public.messages for select
  to authenticated
  using (exists (select 1 from public.conversations c where c.id = messages.conversation_id));

-- You send as yourself, into a conversation you can currently read. A block
-- makes the conversation invisible, so the send fails with 42501.
create policy "members send as themselves"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (select 1 from public.conversations c where c.id = messages.conversation_id)
  );

-- ----------------------------------------------------------------------------
-- 4. last_message_at — the inbox's ordering key
-- ----------------------------------------------------------------------------
-- Definer because members have no update policy on conversations.
create or replace function private.stamp_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at)
   where id = new.conversation_id;
  return new;
end;
$$;

revoke execute on function private.stamp_conversation_last_message() from public, anon, authenticated;

create trigger stamp_last_message
  after insert on public.messages
  for each row execute function private.stamp_conversation_last_message();

-- ----------------------------------------------------------------------------
-- 5. Realtime — the open thread hears new messages live. Realtime checks the
--    select policy above for each subscriber, so only the two members hear.
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;

-- ----------------------------------------------------------------------------
-- 6. Push — a fifth event for B47's notify function
-- ----------------------------------------------------------------------------
alter table public.notification_log drop constraint notification_log_event_check;
alter table public.notification_log add constraint notification_log_event_check
  check (event in ('follow', 'comment', 'vote', 'team_push', 'message'));

-- Re-created with the 'message' branch; the other four are unchanged. Only keys
-- go out — never a message's text.
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
  elsif tg_table_name = 'messages' then
    payload := jsonb_build_object('event', 'message', 'keys', jsonb_build_object('id', new.id));
  end if;

  if payload is not null then
    -- A failure to queue must never refuse the act itself.
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

create trigger notify_on_message
  after insert on public.messages
  for each row execute function private.notify_event();
