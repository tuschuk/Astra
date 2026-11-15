-- ============================================================================
-- sync_tombstones — the list of rows that stopped existing (LOG-9, B14)
-- ============================================================================
-- What this migration does, in plain language:
--   Once a lifter can delete a workout (or an edit removes a personal record),
--   their OTHER phones need to hear about it. A download can only see rows
--   that exist — it cannot see an absent row. So every time a workout or a
--   personal record is deleted, a trigger writes one small "tombstone" line
--   here: which table, which row id, whose, and when. Other devices read the
--   tombstones after their bookmark and delete those rows locally.
--
--   Why only workouts and personal records: when a set or an exercise slot is
--   removed, its workout is re-stamped too (the touch-the-root rule), and
--   every other device re-downloads that whole workout and drops what is no
--   longer there. A deleted workout or a deleted record has no surviving
--   parent to carry that news, so they get tombstones.
--
--   Triggers, not the app, write tombstones — so deletes that CASCADE (a
--   deleted workout takes its sets, and the personal records citing those
--   sets) are recorded too, with no help from the phone.
--
--   Privacy: owner-only read; nobody writes here except the trigger. A
--   tombstone holds only ids and a time, no training data.
--
--   Retention: unbounded for now — rows are a few dozen bytes. Cleanup is
--   noted in docs/DEFERRED.md for when it is measured to matter.
--
--   The keep-best trigger on personal_records is deliberately NOT changed: a
--   legitimate demotion (an edit or delete lowered a record) is uploaded as
--   delete-then-insert, which that BEFORE UPDATE trigger never sees. See
--   docs/feature_plans/edit-delete-workouts.md.
-- ============================================================================

create table public.sync_tombstones (
  -- Server-assigned and strictly increasing: a download asks for "every
  -- tombstone after id N", which can never skip one at a page boundary.
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  tbl        text not null check (tbl in ('workouts', 'personal_records')),
  row_id     uuid not null,
  deleted_at timestamptz not null default now()
);

-- "This lifter's tombstones after id N" — the only read pattern.
create index sync_tombstones_user_idx on public.sync_tombstones (user_id, id);

alter table public.sync_tombstones enable row level security;

-- Owner-only read. No insert / update / delete policies at all: only the
-- trigger below writes here.
create policy "users read their own tombstones"
  on public.sync_tombstones for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Writes one tombstone for the deleted row. SECURITY DEFINER because the
-- table has no write policies for users.
--
-- The profile check: when a whole account is deleted, the profile goes first
-- and its workouts cascade after it. A tombstone for a user who no longer
-- exists is useless (no device of theirs will ever ask), and inserting one
-- would break the account deletion on the user_id foreign key — so it is
-- skipped.
-- ----------------------------------------------------------------------------
create or replace function private.record_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where id = old.user_id) then
    insert into public.sync_tombstones (user_id, tbl, row_id)
    values (old.user_id, tg_table_name, old.id);
  end if;
  return old;
end;
$$;

-- Row-level AFTER DELETE triggers also fire for rows removed by a cascade.
create trigger record_tombstone
  after delete on public.workouts
  for each row execute function private.record_tombstone();

create trigger record_tombstone
  after delete on public.personal_records
  for each row execute function private.record_tombstone();

comment on table public.sync_tombstones is
  'One line per deleted workout or personal record, written by triggers, so the owner''s other devices can delete their copies.';
