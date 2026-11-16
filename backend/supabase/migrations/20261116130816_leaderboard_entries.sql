-- =============================================================================
-- B52 — Gym leaderboards (GYM-3 part, GYM-6 part, GYM-8, GYM-9 part)
-- =============================================================================
-- A gym's leaderboard: for each of three lifts (squat, bench, deadlift), the
-- best VERIFIED weight each member has put up at that gym, ranked heaviest
-- first, split into two divisions (male / female) — absolute weight only, no
-- bodyweight or age classes (GYM-8).
--
-- What a row is: one member's current best at one gym for one lift — "one row
-- per member" is the unique index below, and a newly verified heavier lift
-- REPLACES the old row (an upsert on that key, written by B53's verification
-- flow). It is NOT a personal_records row: PRs are private and can be demoted
-- when a workout is edited; a board row is a public, verified result that
-- stays put.
--
-- Why the division is stored on the row: a lifter's sex lives in
-- user_body_data, which is owner-only because it is sensitive. A public board
-- can't read it and must not leak it, so the division is stamped on the entry
-- when it is verified (B53 asks the lifter to pick when they submit) and then
-- frozen. user_body_data is never read or widened here.
--
-- Why entries stay when a member switches gyms (GYM-9): rows are keyed by
-- gym_id and nothing moves them. Switching rewrites gym_members only, so the
-- old board keeps the member's rows and the new board has none for them.
-- Deleting an ACCOUNT does remove them (profiles cascade): full content
-- deletion beats board stickiness.
--
-- Nobody can write this table from the app — not even the row's own lifter.
-- There is a read policy and nothing else, and the write privileges are
-- revoked (TRUNCATE skips row-level security, so it goes too). Rows come from
-- migrations, probes, and — later — B53's server-side writer.
-- =============================================================================

create table public.leaderboard_entries (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- The three ranked lifts. Change together with LIFTS in
  -- frontend/src/social/leaderboards.ts.
  lift        text not null check (lift in ('squat', 'bench', 'deadlift')),
  -- The same spelling as user_body_data.sex, so the two can never drift; change
  -- together with DIVISIONS in frontend/src/social/leaderboards.ts. Not null:
  -- you can't be on a board without a division ("every user picks").
  division    text not null check (division in ('male', 'female')),
  -- Kilograms, the storage unit everywhere (the personal_records.value_kg shape).
  weight_kg   numeric(8, 3) not null check (weight_kg > 0),
  -- When the entry earned its place. Also the tie-breaker: on equal weight the
  -- earlier verification ranks first.
  verified_at timestamptz not null,
  created_at  timestamptz not null default now()
);

-- One board row per member per lift per gym (GYM-3's "one row per member"), and
-- the key B53's replace-the-old-best upsert targets (GYM-6). Leading gym_id also
-- serves the board read's filter.
create unique index leaderboard_entries_book_idx
  on public.leaderboard_entries (gym_id, user_id, lift);
-- Account deletion (cascade from profiles) finds a lifter's rows by this.
create index leaderboard_entries_user_idx on public.leaderboard_entries (user_id);

alter table public.leaderboard_entries enable row level security;

-- Boards are public to signed-in lifters — including entries of people who have
-- since left the gym (GYM-9 keeps them). Deliberately NO insert, update or
-- delete policy.
create policy "leaderboards are readable by signed-in users"
  on public.leaderboard_entries for select to authenticated
  using (true);

-- Belt and braces: remove the write privileges outright (Supabase grants them by
-- default), so only read remains for signed-in lifters and nothing for anon.
revoke all on public.leaderboard_entries from anon;
revoke insert, update, delete, truncate, references, trigger on public.leaderboard_entries from authenticated;
grant select on public.leaderboard_entries to authenticated;
