-- ============================================================================
-- Identity: profiles, sensitive body data, settings, blocks, follows
-- ============================================================================
-- What this migration does, in plain language:
--   Every person who signs up gets three rows created automatically — a public
--   profile (the face they show the app), a private body-data row (sex,
--   birthdate, bodyweight — needed later for strength grades), and a settings
--   row (display units, default workout privacy). It also creates the two
--   relationship tables the social layer is built on: blocks, and follows
--   (one-way, like Strava). Blocks come first because the follow rules need to
--   consult them.
--
--   Every table has row-level security (RLS) switched on in the same breath it
--   is created, so there is never a moment where data sits unprotected. RLS is
--   the real enforcement point for privacy in Astra — never the client.
-- ============================================================================

-- --- Extensions -------------------------------------------------------------
-- citext: case-insensitive text, so "Tristen" and "tristen" are the same
-- username. moddatetime: keeps updated_at columns current automatically.
create extension if not exists citext with schema extensions;
create extension if not exists moddatetime with schema extensions;

-- A schema for helper functions that the API must NOT expose. Supabase's
-- auto-generated API only serves the `public` schema, so anything in `private`
-- is reachable from SQL (policies, triggers) but not from the client.
create schema if not exists private;

-- --- Shared types -----------------------------------------------------------
-- Who may see a workout. Defined here (not in the training migration) because
-- user_settings stores each user's default choice.
create type public.workout_visibility as enum ('public', 'followers', 'private');

-- ============================================================================
-- profiles — the public identity of a user
-- ============================================================================
-- One row per account, keyed by the auth user's id. Holds ONLY information
-- that is fine for other signed-in users to see. Anything sensitive lives in
-- user_body_data instead.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  -- Username is chosen during onboarding, so it starts out null. Unique and
  -- case-insensitive once set. 3–30 chars: letters, digits, underscore.
  username     extensions.citext unique
               check (username ~ '^[A-Za-z0-9_]{3,30}$'),
  display_name text check (char_length(display_name) <= 50),
  bio          text check (char_length(bio) <= 300),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create trigger set_updated_at
  before update on public.profiles
  for each row execute function extensions.moddatetime (updated_at);

-- Any signed-in user may look at profiles (it is the public face of an
-- account). Row creation happens via the signup trigger below, so there is no
-- client insert policy. Only the owner may edit their profile.
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ============================================================================
-- user_body_data — sensitive, owner-only
-- ============================================================================
-- Sex, birthdate and bodyweight feed the strength-grade math later, but they
-- are body data (NFR-5): no other user may ever read them through the API.
-- Kept as a separate table (not profile columns) precisely so RLS can wall it
-- off completely — there is deliberately NO policy that lets anyone else in.
create table public.user_body_data (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  sex           text check (sex in ('male', 'female')),
  birthdate     date,
  -- Stored in kilograms always; the app converts for display using
  -- user_settings.unit. One canonical unit in the database.
  bodyweight_kg numeric(5, 2) check (bodyweight_kg > 0),
  updated_at    timestamptz not null default now()
);

alter table public.user_body_data enable row level security;

create trigger set_updated_at
  before update on public.user_body_data
  for each row execute function extensions.moddatetime (updated_at);

create policy "users read their own body data"
  on public.user_body_data for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "users update their own body data"
  on public.user_body_data for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================================
-- user_settings — per-user preferences
-- ============================================================================
create table public.user_settings (
  user_id                    uuid primary key references public.profiles (id) on delete cascade,
  -- Display unit for weights. Storage is always kg; this only affects display.
  unit                       text not null default 'lb' check (unit in ('kg', 'lb')),
  -- The visibility a newly logged workout starts with.
  default_workout_visibility public.workout_visibility not null default 'public',
  updated_at                 timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create trigger set_updated_at
  before update on public.user_settings
  for each row execute function extensions.moddatetime (updated_at);

create policy "users read their own settings"
  on public.user_settings for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "users update their own settings"
  on public.user_settings for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================================
-- Signup trigger — creates the three per-user rows atomically with signup
-- ============================================================================
-- Why a database trigger instead of app code: if the app crashed right after
-- account creation, the account would exist with no profile. The trigger makes
-- profile creation part of the same transaction as the signup itself.
-- SECURITY DEFINER lets it write the rows even though the signing-up user has
-- no insert policies; the empty search_path is a safety habit for definer
-- functions (everything referenced is schema-qualified).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- A friendly starting display name from the email; the user can change it.
    -- Truncated to 50 chars so an unusually long email can never fail the
    -- profiles check constraint and thereby break signup itself.
    nullif(left(split_part(coalesce(new.email, ''), '@', 1), 50), '')
  );
  insert into public.user_settings (user_id) values (new.id);
  insert into public.user_body_data (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ============================================================================
-- blocks — "I never want to see or be seen by this person"
-- ============================================================================
-- Only the blocker can see or manage their block list; the blocked person is
-- never told. Workout visibility, follow creation and (later) the feed check
-- this table in both directions.
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

create policy "users manage their own block list"
  on public.blocks for all
  to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

-- Is there a block in EITHER direction between these two users?
-- SECURITY DEFINER is essential: blocks' RLS only shows a row to its blocker,
-- so an ordinary query by the blocked person would not see it — and a policy
-- that asked "has this person blocked me?" would silently get "no". This
-- helper sees the whole table and answers truthfully.
create or replace function private.blocked_either(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks x
    where (x.blocker_id = a and x.blocked_id = b)
       or (x.blocker_id = b and x.blocked_id = a)
  )
$$;

-- Blocking someone severs any follow relationship in both directions, in the
-- same transaction. SECURITY DEFINER because the blocker may not otherwise be
-- allowed to delete the other person's follow row. (The follows table is
-- created just below; the function body is only checked when it runs.)
create or replace function private.handle_new_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows f
  where (f.follower_id = new.blocker_id and f.followee_id = new.blocked_id)
     or (f.follower_id = new.blocked_id and f.followee_id = new.blocker_id);
  return new;
end;
$$;

create trigger on_block_created
  after insert on public.blocks
  for each row execute function private.handle_new_block();

-- ============================================================================
-- follows — one-way follow relationships (the Strava model)
-- ============================================================================
-- "A follows B" is a single row. No approval step at launch: following takes
-- effect immediately. The 'followers' workout visibility reads this table.
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- The primary key already indexes follower_id lookups; this covers the other
-- direction ("who follows me?").
create index follows_followee_idx on public.follows (followee_id);

alter table public.follows enable row level security;

-- Either side of the relationship can see it.
create policy "users see follows they are part of"
  on public.follows for select
  to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

-- You can only create follows where YOU are the follower, and not when a
-- block exists in either direction (checked via the definer helper — see the
-- comment on private.blocked_either for why a plain subquery would not work).
create policy "users follow as themselves"
  on public.follows for insert
  to authenticated
  with check (
    follower_id = (select auth.uid())
    and not private.blocked_either(follower_id, followee_id)
  );

-- Unfollow someone (you are the follower) or remove a follower (you are the
-- followee).
create policy "users remove follows they are part of"
  on public.follows for delete
  to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
