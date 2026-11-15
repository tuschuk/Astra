-- ============================================================================
-- Posts and flairs (B20) — what the Home feed is made of
-- ============================================================================
-- What this migration does, in plain language:
--   A *post* is a lifter sharing one finished workout to the feed. Every post
--   carries exactly one *flair* — a label such as "WOD" or "New PR" — and the
--   list of flairs is rows in a table, not words in the app's code, so adding
--   a flair later is a data change (SOC-3).
--
--   Who can see a post: exactly the people who could see a workout with the
--   same owner and visibility. The rule is NOT written again here; the posts
--   policy calls the same `private.workout_visible` helper the workouts table
--   uses, so blocks (either direction), "followers only" and "private" behave
--   identically for posts and workouts.
--
--   Who can write a post: only its author, and only about a workout the author
--   owns — nobody can publish someone else's workout under their own name.
--
--   Nothing here is mirrored on the phone: the feed is read from the server.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- flairs — the label list, as data
-- ----------------------------------------------------------------------------
create table public.flairs (
  -- A stable, readable slug ('wod', 'physique-check', ...). Founder-curated
  -- data, so the slug never changes once shipped.
  id           text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  -- What the chip on a post shows.
  name         text not null check (char_length(name) between 1 and 40),
  -- Display order in pickers.
  position     smallint not null unique,
  -- Physique Check posts take upvotes only (CLAUDE.md privacy rule). Votes
  -- arrive in a later step and read this column, so the rule stays data.
  upvotes_only boolean not null default false
);

alter table public.flairs enable row level security;

-- Anyone signed in may read the list. There are no write policies: a new
-- flair is added by a migration, never from the app.
create policy "flairs are readable"
  on public.flairs for select
  to authenticated
  using (true);

insert into public.flairs (id, name, position, upvotes_only) values
  ('wod',            'WOD',            1, false),
  ('physique-check', 'Physique Check', 2, true),
  ('new-pr',         'New PR',         3, false),
  ('form-check',     'Form Check',     4, false);

-- ----------------------------------------------------------------------------
-- posts — one feed item
-- ----------------------------------------------------------------------------
create table public.posts (
  -- Client-generated, like workouts.id: posts will be created on the phone
  -- right after Finish (possibly offline), and a retried upload must land on
  -- the same row. No default on purpose.
  id         uuid primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Exactly one flair per post: one required column.
  flair_id   text not null references public.flairs (id),
  -- The workout this post shares. Required while the workout post is the
  -- only kind of post; a later step relaxes it when another kind exists.
  -- Deleting the workout deletes its post.
  workout_id uuid not null references public.workouts (id) on delete cascade,
  -- Who may see the post. Reuses the workouts' enum (same three values, same
  -- meaning) so the one visibility helper serves both.
  visibility public.workout_visibility not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One post per workout: sharing the same session twice is a double-post.
  constraint posts_workout_unique unique (workout_id)
);

-- The feed reads "these authors' posts, newest first" — this index matches
-- that order exactly, including the id tiebreak used for paging.
create index posts_user_created_idx on public.posts (user_id, created_at desc, id desc);
create index posts_flair_idx on public.posts (flair_id);

create trigger set_updated_at
  before update on public.posts
  for each row execute function extensions.moddatetime (updated_at);

alter table public.posts enable row level security;

-- Read: the workout rule, from its one home (blocks, followers, private).
create policy "posts readable per their visibility"
  on public.posts for select
  to authenticated
  using (private.workout_visible(user_id, visibility));

-- Write: authors only, and only about a workout they own.
create policy "users post as themselves"
  on public.posts for insert
  to authenticated
  with check (user_id = (select auth.uid()) and private.owns_workout(workout_id));

create policy "users update their own posts"
  on public.posts for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.owns_workout(workout_id));

create policy "users delete their own posts"
  on public.posts for delete
  to authenticated
  using (user_id = (select auth.uid()));
