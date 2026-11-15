-- ============================================================================
-- Votes and comments (B23) — reacting to a post
-- ============================================================================
-- What this migration does, in plain language:
--   A *vote* is one lifter's thumbs-up (+1) or thumbs-down (-1) on one post.
--   Each lifter has at most one vote per post — changing your mind replaces
--   it, it never adds a second. A post's *score* is the sum of its votes
--   ("net score": ups minus downs), read from the `post_scores` view (SOC-4).
--
--   Some flairs take upvotes only — today just "Physique Check" (CLAUDE.md
--   privacy rule). Which ones is data (`flairs.upvotes_only`), never a flair
--   name in code. A trigger refuses any downvote on such a post, so the API
--   itself says no, whatever the app shows.
--
--   A *comment* is a short piece of text on a post, shown oldest first (SOC-5).
--
--   Who can see votes and comments: exactly whoever can see the post they hang
--   on. The visibility rule is NOT written again; it goes through the post row
--   to `private.workout_visible`, its one home (blocks, followers, private).
--
--   Nothing here is mirrored on the phone: votes and comments are read and
--   written online only, like the feed they appear on.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The visibility helper: "may the current user see this post?"
-- ----------------------------------------------------------------------------
-- Mirrors private.can_view_workout. Security definer so it reads the true
-- post row; the visibility decision is still workout_visible's, as the
-- current user.
create or replace function private.can_view_post(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid and private.workout_visible(p.user_id, p.visibility)
  )
$$;

-- ----------------------------------------------------------------------------
-- votes — one row per user per post
-- ----------------------------------------------------------------------------
create table public.votes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Up or down, nothing else.
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The one-vote-per-user-per-post rule. (Its index also serves "all votes
  -- on this post", post_id being the leading column.)
  primary key (post_id, user_id)
);

create trigger set_updated_at
  before update on public.votes
  for each row execute function extensions.moddatetime (updated_at);

alter table public.votes enable row level security;

-- Seeing a post means seeing its score truthfully, so every viewer of the
-- post may read all its votes — the tally is the same number for everyone.
create policy "votes visible with their post"
  on public.votes for select
  to authenticated
  using (private.can_view_post(post_id));

create policy "users vote as themselves"
  on public.votes for insert
  to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_post(post_id));

create policy "users change their own votes"
  on public.votes for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.can_view_post(post_id));

create policy "users remove their own votes"
  on public.votes for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- The upvote-only rule (the step's database check)
-- ----------------------------------------------------------------------------
-- Refuses a downvote — new or changed from an upvote — on a post whose flair
-- takes upvotes only. Reads the flag through posts → flairs, so a future
-- upvote-only flair needs no code change. Security definer so it sees the
-- true rows, not the voter's filtered view. The app recognises the refusal by
-- its SQLSTATE, P0001 (plain `raise exception`).
create or replace function private.vote_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.value = -1 and exists (
    select 1 from public.posts p
    join public.flairs f on f.id = p.flair_id
    where p.id = new.post_id and f.upvotes_only
  ) then
    raise exception 'This post takes upvotes only';
  end if;
  return new;
end
$$;

create trigger votes_upvote_only
  before insert or update on public.votes
  for each row execute function private.vote_allowed();

-- The back door the rule above would leave open: re-flairing a post that
-- already has downvotes *to* an upvote-only flair. Nothing in the app changes
-- a post's flair today, so this simply refuses that change.
create or replace function private.flair_change_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.flair_id <> old.flair_id
     and exists (select 1 from public.flairs f where f.id = new.flair_id and f.upvotes_only)
     and exists (select 1 from public.votes v where v.post_id = new.id and v.value = -1) then
    raise exception 'This flair takes upvotes only and the post has downvotes';
  end if;
  return new;
end
$$;

create trigger posts_flair_guard
  before update of flair_id on public.posts
  for each row execute function private.flair_change_allowed();

-- ----------------------------------------------------------------------------
-- comments — flat, in conversation order
-- ----------------------------------------------------------------------------
create table public.comments (
  -- Server-generated: comments are written online only, so no retry needs a
  -- client-chosen id (unlike posts).
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- 1–500 characters, and not just spaces (a blank bubble is not a comment).
  -- (Tightened to "not just whitespace" by …_comments_body_not_blank.sql.)
  -- Mirrored by COMMENT_MAX_CHARS in frontend/src/social/commentLimits.ts —
  -- change the two together.
  body       text not null check (char_length(body) between 1 and 500 and btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A post's comments, oldest first, id as the tiebreak — the screen's order.
create index comments_post_created_idx on public.comments (post_id, created_at, id);
create index comments_user_idx on public.comments (user_id);

create trigger set_updated_at
  before update on public.comments
  for each row execute function extensions.moddatetime (updated_at);

alter table public.comments enable row level security;

create policy "comments visible with their post"
  on public.comments for select
  to authenticated
  using (private.can_view_post(post_id));

-- You may comment only as yourself, and only on a post you can see.
create policy "users comment as themselves"
  on public.comments for insert
  to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_post(post_id));

-- No update policy on purpose: there is no editing, so RLS refuses updates.
create policy "users delete their own comments"
  on public.comments for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- post_scores — the net score (and comment count) of every post
-- ----------------------------------------------------------------------------
-- security_invoker: the viewer's own RLS applies to posts, votes and comments,
-- so the view grants no new reading power. Built on posts so every visible
-- post has a row (score 0, not missing), and so the feed can embed it.
create view public.post_scores
  with (security_invoker = true) as
  select p.id as post_id,
         coalesce(v.score, 0)::int     as score,
         coalesce(c.comments, 0)::int  as comment_count
  from public.posts p
  left join (select post_id, sum(value) as score from public.votes group by post_id) v
    on v.post_id = p.id
  left join (select post_id, count(*) as comments from public.comments group by post_id) c
    on c.post_id = p.id;

grant select on public.post_scores to authenticated;
