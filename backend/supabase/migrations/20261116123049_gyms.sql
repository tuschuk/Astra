-- =============================================================================
-- B50 — Gyms core (GYM-1 part, GYM-2, GYM-7; SOC-10 / YOU-6 Gym halves)
-- =============================================================================
-- A Gym is a place, not a group anyone runs. Anyone signed in can see every
-- gym, join any gym (no proof of membership) and belong to exactly one at a
-- time. Nobody — no member, no gym owner — can create, edit, claim or delete a
-- gym: rows come only from migrations (B51 replaces the fixture below with the
-- real Denver-area list). That absence of any write path IS the GYM-7 rule.
--
-- What this migration adds:
--   1. PostGIS (into the `extensions` schema, Supabase's convention);
--   2. gyms — name, address, a geography point; read-only for every user;
--   3. a small FICTIONAL fixture of Denver-area gyms (replaced by B51);
--   4. gym_members — one row per lifter (the primary key is user_id, so a
--      second gym can only REPLACE the first: join and switch are one upsert);
--      membership is public to signed-in users (YOU-6 shows it on profiles);
--   5. a trigger that restarts joined_at when a lifter switches gyms, and
--      column grants so joined_at has no client writer;
--   6. gyms_near(lat, lng) — every gym, nearest first (the directory read).
--
-- The user's location is never stored: it arrives only as gyms_near's
-- arguments and nothing here writes it anywhere.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. PostGIS
-- ----------------------------------------------------------------------------
create extension if not exists postgis with schema extensions;

-- ----------------------------------------------------------------------------
-- 2. gyms — read-only for every user (GYM-7: nothing to claim or manage)
-- ----------------------------------------------------------------------------
create table public.gyms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  address    text not null check (char_length(address) between 1 and 200),
  -- Longitude/latitude on the WGS 84 globe; distances on geography are metres.
  location   extensions.geography(point, 4326) not null,
  created_at timestamptz not null default now()
);
create index gyms_location_idx on public.gyms using gist (location);

alter table public.gyms enable row level security;

-- Every signed-in lifter can see every gym. There is deliberately NO insert,
-- update or delete policy, and the grants below remove the privileges too.
create policy "gyms are readable by signed-in users"
  on public.gyms for select to authenticated
  using (true);

revoke insert, update, delete, truncate on public.gyms from authenticated, anon;
revoke all on public.gyms from anon;

-- ----------------------------------------------------------------------------
-- 3. FIXTURE — fictional gyms at real Denver-area coordinates. Replaced by B51.
-- ----------------------------------------------------------------------------
-- Names are invented on purpose (no real business's name or brand). The spread
-- is asymmetric — one gym a mile from downtown, one in Boulder ~25 miles out —
-- so a sort with longitude and latitude swapped can't pass for a right one.
-- st_makepoint takes (longitude, latitude): x first.
insert into public.gyms (name, address, location) values
  -- FIXTURE — replaced by B51
  ('Sample Gym · Capitol Hill', 'Capitol Hill, Denver, CO',
    extensions.st_setsrid(extensions.st_makepoint(-104.9780, 39.7310), 4326)::extensions.geography),
  -- FIXTURE — replaced by B51
  ('Sample Gym · Highlands', 'Highland, Denver, CO',
    extensions.st_setsrid(extensions.st_makepoint(-105.0110, 39.7620), 4326)::extensions.geography),
  -- FIXTURE — replaced by B51
  ('Sample Gym · RiNo', 'River North, Denver, CO',
    extensions.st_setsrid(extensions.st_makepoint(-104.9800, 39.7680), 4326)::extensions.geography),
  -- FIXTURE — replaced by B51
  ('Sample Gym · Lakewood', 'Lakewood, CO',
    extensions.st_setsrid(extensions.st_makepoint(-105.0814, 39.7047), 4326)::extensions.geography),
  -- FIXTURE — replaced by B51
  ('Sample Gym · Aurora', 'Aurora, CO',
    extensions.st_setsrid(extensions.st_makepoint(-104.8319, 39.7294), 4326)::extensions.geography),
  -- FIXTURE — replaced by B51
  ('Sample Gym · Boulder', 'Boulder, CO',
    extensions.st_setsrid(extensions.st_makepoint(-105.2705, 40.0150), 4326)::extensions.geography);

-- ----------------------------------------------------------------------------
-- 4. gym_members — one active gym per lifter (GYM-2)
-- ----------------------------------------------------------------------------
-- user_id is the primary key: a lifter has at most one row, so "joining a
-- second gym switches the active one" is a property of the table. Join and
-- switch are the same upsert on user_id; leave is a delete. Cascades: deleting
-- an account (profiles) or a gym (a B51 re-seed) removes the membership.
create table public.gym_members (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  gym_id    uuid not null references public.gyms (id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index gym_members_gym_idx on public.gym_members (gym_id);

alter table public.gym_members enable row level security;

-- Membership is public to signed-in users: profiles show every lifter's gym
-- (YOU-6) and a gym page lists its roster and feed for any visitor. Which of a
-- member's POSTS a viewer sees is still decided by the posts policies alone.
create policy "gym memberships are readable by signed-in users"
  on public.gym_members for select to authenticated
  using (true);

create policy "lifters join a gym as themselves"
  on public.gym_members for insert to authenticated
  with check (user_id = (select auth.uid()));

-- The upsert's conflict arm (switching gyms): only your own row, kept yours.
create policy "lifters switch their own gym"
  on public.gym_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "lifters leave their own gym"
  on public.gym_members for delete to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. joined_at belongs to the server
-- ----------------------------------------------------------------------------
-- Clients may write only user_id and gym_id. user_id must be in the UPDATE
-- grant because PostgREST's upsert SETs every payload column (including the
-- conflict column) on the conflict arm; the update policy still forbids
-- pointing the row at anyone else.
revoke all on public.gym_members from anon;
revoke insert, update on public.gym_members from authenticated;
grant insert (user_id, gym_id) on public.gym_members to authenticated;
grant update (user_id, gym_id) on public.gym_members to authenticated;

-- Switching gyms restarts "member since": a switch is a new membership, not an
-- old one moved. Re-joining the gym you're already in changes nothing.
create or replace function private.gym_members_restamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.gym_id is distinct from old.gym_id then
    new.joined_at := now();
  end if;
  return new;
end;
$$;

create trigger gym_members_restamp
  before update on public.gym_members
  for each row execute function private.gym_members_restamp();

-- ----------------------------------------------------------------------------
-- 6. gyms_near — the directory, nearest first (GYM-1)
-- ----------------------------------------------------------------------------
-- PostgREST can't order by a computed distance, so the directory read is this
-- function. Runs as the caller (security invoker): every signed-in lifter can
-- read every gym anyway, so no extra privilege is needed. The caller's
-- coordinates are only arguments — nothing is stored. No radius filter: the
-- launch set is Denver-only by construction (B51's import), so a lifter far
-- away still gets the list rather than an empty screen. distance_m is metres.
-- Every column is g.-qualified: the output names (id, name, address) would
-- otherwise be ambiguous inside the body.
create or replace function public.gyms_near(lat double precision, lng double precision, max_rows integer default 50)
returns table (id uuid, name text, address text, distance_m double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.id, g.name, g.address,
         extensions.st_distance(
           g.location,
           extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
         ) as distance_m
  from public.gyms g
  order by distance_m asc
  limit least(greatest(max_rows, 1), 100);
$$;

revoke execute on function public.gyms_near(double precision, double precision, integer) from public, anon;
grant execute on function public.gyms_near(double precision, double precision, integer) to authenticated;
