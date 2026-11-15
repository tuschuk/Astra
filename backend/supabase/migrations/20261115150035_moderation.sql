-- ============================================================================
-- B27 moderation and safety (SOC-8, NFR-7): mute, the report queue, who the
-- founder is, and author-level filtering of comments and votes.
--
-- Blocks already exist (identity migration): the `blocks` table, the
-- auto-unfollow trigger and private.blocked_either, consulted by
-- private.workout_visible so a block hides posts, workouts, PRs and photos in
-- both directions. This migration adds:
--   1. `mutes` — "I don't want to see this person; don't tell them". One-way,
--      keeps follows, spelled once in private.muted_by_viewer and consulted by
--      workout_visible beside the blocks clause, so a mute hides the muted
--      lifter's content from the muter on every surface;
--   2. private.author_visible — comments and votes are filtered by who WROTE
--      them, not only by their post, so a blocked/muted lifter's comment on a
--      third person's post disappears too. Consequence (plan G3): a post's
--      score is the sum of the votes the viewer may see;
--   3. `moderators` — who the founder is, as rows (seeded live, never here);
--   4. `reports` — the queue. Target ids are plain uuids (no FK) so a report
--      outlives the content it is about; the reported account is stamped by a
--      trigger from the true content row, never taken from the client.
-- Content and account removal is the `moderate` server function (service
-- role), so no app write policy for removal exists here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. mutes
-- ----------------------------------------------------------------------------
create table public.mutes (
  muter_id   uuid not null references public.profiles (id) on delete cascade,
  muted_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);

alter table public.mutes enable row level security;

-- A mute is private to the muter: only they see, add or remove it. The muted
-- lifter is never told (no policy lets them read the row).
create policy "users manage their own mute list"
  on public.mutes for all
  to authenticated
  using (muter_id = (select auth.uid()))
  with check (muter_id = (select auth.uid()));

-- Has the current viewer muted `author`? The one home of the mute rule.
-- Security definer for the same reason as blocked_either: a policy must get a
-- truthful answer whatever table it is evaluated under.
create or replace function private.muted_by_viewer(author uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mutes m
    where m.muter_id = (select auth.uid()) and m.muted_id = author
  )
$$;

-- workout_visible, re-created with one added clause: the viewer has not muted
-- the owner. `create or replace` keeps every dependent policy (workouts,
-- posts, sets, post-images storage, can_view_post, can_view_workout) pointing
-- at the new body. Rule now reads:
--   * You always see your own.
--   * A block in either direction hides everything.
--   * A lifter you muted is hidden from you (one way — they still see you).
--   * Otherwise: 'public' is open to any signed-in user, 'followers' requires
--     that the viewer follows the owner, 'private' is owner-only.
create or replace function private.workout_visible(owner uuid, vis public.workout_visibility)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    owner = (select auth.uid())
    or (
      not exists (
        select 1 from public.blocks b
        where (b.blocker_id = owner and b.blocked_id = (select auth.uid()))
           or (b.blocker_id = (select auth.uid()) and b.blocked_id = owner)
      )
      and not private.muted_by_viewer(owner)
      and (
        vis = 'public'
        or (
          vis = 'followers'
          and exists (
            select 1 from public.follows f
            where f.follower_id = (select auth.uid()) and f.followee_id = owner
          )
        )
      )
    )
$$;

-- ----------------------------------------------------------------------------
-- 2. author-level filtering of comments and votes
-- ----------------------------------------------------------------------------
-- May the viewer see something AUTHORED by `author` on someone else's post?
-- Your own always; otherwise no block either way and not muted by you.
create or replace function private.author_visible(author uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select author = (select auth.uid())
      or (not private.blocked_either(author, (select auth.uid()))
          and not private.muted_by_viewer(author))
$$;

drop policy "votes visible with their post" on public.votes;
-- A vote shows with its post, unless its voter is blocked/muted for the
-- viewer. post_scores and post_hot_scores are security_invoker, so the tally
-- a viewer sees is the sum of the votes they may see (plan G3).
create policy "votes visible with their post and voter"
  on public.votes for select
  to authenticated
  using (private.can_view_post(post_id) and private.author_visible(user_id));

drop policy "comments visible with their post" on public.comments;
create policy "comments visible with their post and author"
  on public.comments for select
  to authenticated
  using (private.can_view_post(post_id) and private.author_visible(user_id));

comment on view public.post_hot_scores is
  'Feed ranking for the Hot sort (B24, SOC-11): Reddit''s published hot formula over net votes. security_invoker; same columns as the feed reads from posts. Since B27 the net votes are those the viewer may see (votes by lifters blocked either way or muted by the viewer are left out), so ranks can differ slightly between viewers.';

-- ----------------------------------------------------------------------------
-- 3. moderators — who the founder is
-- ----------------------------------------------------------------------------
create table public.moderators (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.moderators enable row level security;

create policy "users see their own moderator row"
  on public.moderators for select
  to authenticated
  using (user_id = (select auth.uid()));
-- No insert/update/delete policies: rows are written by migration or service
-- role only. The founder's row is seeded live on each project, never here.

-- Is the current user a moderator? Used by the reports select policy.
create or replace function private.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.moderators md where md.user_id = (select auth.uid())
  )
$$;

-- ----------------------------------------------------------------------------
-- 4. reports — the queue
-- ----------------------------------------------------------------------------
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  target_kind      text not null check (target_kind in ('post', 'comment')),
  -- No FK on purpose (plan G5): a report outlives the content it is about —
  -- an author deleting their post must not erase the reports about it.
  target_id        uuid not null,
  -- Stamped by the trigger below from the true content row; never trusted
  -- from the client.
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  -- Mirrors docs/CONTENT_POLICY.md's categories and REPORT_REASONS in
  -- frontend/src/social/moderation.ts — change the three together.
  reason           text not null check (reason in
                     ('spam', 'harassment', 'nudity', 'not-training', 'impersonation', 'other')),
  details          text check (char_length(details) <= 500),
  status           text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at       timestamptz not null default now(),
  -- One report per lifter per piece of content: a re-tap lands on the same row.
  unique (reporter_id, target_kind, target_id)
);

-- The founder's queue query: open reports, oldest first.
create index reports_open_idx on public.reports (status, created_at);

alter table public.reports enable row level security;

-- You report as yourself, about content you can actually see. The exists()
-- subqueries run as the reporter, so each table's own select policy
-- (visibility + author filtering) is the gate — the rule isn't spelled again.
create policy "users report what they can see"
  on public.reports for insert
  to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (
      (target_kind = 'post' and exists (select 1 from public.posts p where p.id = reports.target_id))
      or (target_kind = 'comment' and exists (select 1 from public.comments c where c.id = reports.target_id))
    )
  );

create policy "moderators read the queue"
  on public.reports for select
  to authenticated
  using (private.is_moderator());
-- No app update/delete policies: the founder works the queue with the service
-- role (dashboard) or the `moderate` server function.

-- Stamps the reported account from the real post/comment row, so a report can
-- never be pointed at an innocent lifter. Definer so it reads the true row;
-- visibility was already proven by the insert policy at the reporter's rights.
create or replace function private.stamp_reported_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
begin
  if new.target_kind = 'post' then
    select p.user_id into author from public.posts p where p.id = new.target_id;
  else
    select c.user_id into author from public.comments c where c.id = new.target_id;
  end if;
  if author is null then
    raise exception 'That content is gone';
  end if;
  new.reported_user_id := author;
  return new;
end
$$;

create trigger reports_stamp_reported_user
  before insert on public.reports
  for each row execute function private.stamp_reported_user();
