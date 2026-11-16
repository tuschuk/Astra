-- =============================================================================
-- B48 follow-up — the server's clock is the only clock for direct messages
-- =============================================================================
-- Found in B48's code review: the insert policies check WHO writes a message or
-- conversation, but a client could also send its own `created_at` (and, on a new
-- conversation, `last_message_at`). A message dated in the far future would sort
-- wrongly in the thread and — through the greatest() stamp — pin its
-- conversation to the top of both inboxes for good.
--
-- Fix: a BEFORE INSERT trigger on each table overwrites those columns with the
-- server's values, whatever the client sent. Nothing in the app sends them.
-- =============================================================================

create or replace function private.stamp_message_server_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

revoke execute on function private.stamp_message_server_time() from public, anon, authenticated;

create trigger messages_server_time
  before insert on public.messages
  for each row execute function private.stamp_message_server_time();

-- A new conversation starts now and has had no message yet (the AFTER INSERT
-- trigger on messages is the only thing that moves last_message_at).
create or replace function private.stamp_conversation_server_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.last_message_at := null;
  return new;
end;
$$;

revoke execute on function private.stamp_conversation_server_time() from public, anon, authenticated;

create trigger conversations_server_time
  before insert on public.conversations
  for each row execute function private.stamp_conversation_server_time();
