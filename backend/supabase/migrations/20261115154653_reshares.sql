-- B28 share-cards: in-app re-shares (SOC-6).
--
-- A re-share is a post of its own (kind = 'reshare') that points at the post it
-- passes on through `shared_post_id`. It has no workout and no photo: the card
-- shows the original inside it. Votes, comments and reports on a re-share are on
-- the re-share row, so the existing machinery (post_scores, post_hot_scores,
-- votes, comments, reports) works on it unchanged.
--
-- Who may see a re-share: exactly the people who may see BOTH the re-share and
-- the original. The second half goes through the existing
-- `private.can_view_post` helper, so the visibility rule (blocks, mutes,
-- followers, private) keeps its one home in `private.workout_visible`. If the
-- original's author makes it private, blocks the viewer, or deletes it, the
-- re-share disappears too (deletion through the FK cascade).
--
-- Server rules on a new re-share (trigger, B27 pattern): the original must
-- exist and be visible to the resharer, must not itself be a re-share (no
-- chains — the app re-shares the original instead), and must not be the
-- resharer's own post. The trigger stamps the re-share's flair from the
-- original, never trusting the client, so a Physique Check re-share stays
-- upvote-only through the existing flair-driven vote trigger.

-- 1. The pointer to the original. The original dies -> its re-shares die.
alter table public.posts
  add column shared_post_id uuid references public.posts (id) on delete cascade;

create index posts_shared_post_id_idx on public.posts (shared_post_id);

comment on column public.posts.shared_post_id is
  'B28: for kind = ''reshare'', the post this re-shares (never itself a re-share). Null for every other kind.';

-- 2. The kind list gains 'reshare' (name verified in pg_constraint before dropping).
alter table public.posts drop constraint posts_kind_check;
alter table public.posts add constraint posts_kind_check
  check (kind in ('workout', 'progress-pic', 'pr', 'reshare'));

-- 3. Each kind's body: a re-share carries only its pointer.
alter table public.posts drop constraint posts_kind_shape;
alter table public.posts add constraint posts_kind_shape check (
  (kind = 'workout' and workout_id is not null and image_path is null and shared_post_id is null)
  or (kind in ('progress-pic', 'pr') and image_path is not null and workout_id is null and shared_post_id is null)
  or (kind = 'reshare' and shared_post_id is not null and workout_id is null and image_path is null)
);

-- 4. One re-share per lifter per post (a double tap lands on 23505).
create unique index posts_reshare_unique on public.posts (user_id, shared_post_id)
  where shared_post_id is not null;

-- 5. Read rule: the re-share's own visibility AND the original's.
-- can_view_post is security definer, so reading posts inside it does not recurse.
drop policy "posts readable per their visibility" on public.posts;
create policy "posts readable per their visibility" on public.posts
  for select to authenticated
  using (
    private.workout_visible(user_id, visibility)
    and (shared_post_id is null or private.can_view_post(shared_post_id))
  );

-- Insert: as yourself, your own workout, and only re-share what you can see.
drop policy "users post as themselves" on public.posts;
create policy "users post as themselves" on public.posts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (workout_id is null or private.owns_workout(workout_id))
    and (shared_post_id is null or private.can_view_post(shared_post_id))
  );

-- 6. Re-share sanity and the flair stamp.
create or replace function private.reshare_shape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.posts%rowtype;
begin
  select * into original from public.posts p where p.id = new.shared_post_id;
  if not found then
    raise exception 'That post is gone';
  end if;
  if original.kind = 'reshare' then
    raise exception 'Re-share the original post instead';
  end if;
  if original.user_id = new.user_id then
    raise exception 'You can''t re-share your own post';
  end if;
  -- Visibility as the resharer (definer rights would otherwise see everything).
  if not private.can_view_post(new.shared_post_id) then
    raise exception 'That post is gone';
  end if;
  new.flair_id := original.flair_id;
  return new;
end
$$;

comment on function private.reshare_shape() is
  'B28: before a re-share is inserted or updated, refuses chains, self re-shares and originals the resharer cannot see, and copies the original''s flair onto it.';

-- Insert AND update: the owner's update policy would otherwise let a hand-rolled
-- request re-point a re-share or swap its flair after the fact (a downvotable
-- flair on Physique Check content). The B26 visibility chip only changes
-- `visibility`, which passes through untouched.
create trigger posts_reshare_shape
  before insert or update on public.posts
  for each row when (new.kind = 'reshare')
  execute function private.reshare_shape();

-- 7. The Hot view carries every column FEED_SELECT hangs an embed on, so it
-- gains shared_post_id. A new column can't be inserted with create or replace,
-- so drop and recreate (one transaction), then restore its grant and comment.
drop view public.post_hot_scores;
create view public.post_hot_scores
  with (security_invoker = true) as
  select
    p.id,
    p.user_id,
    p.flair_id,
    p.workout_id,
    p.shared_post_id,
    p.kind,
    p.image_path,
    p.visibility,
    p.created_at,
    sign(coalesce(v.score, 0)::double precision)
      * log(greatest(abs(coalesce(v.score, 0)), 1)::double precision)
      + ((extract(epoch from p.created_at) - 1134028003) / 45000.0)::double precision
      as hot_score
  from public.posts p
  left join (
    select votes.post_id, sum(votes.value) as score
    from public.votes
    group by votes.post_id
  ) v on v.post_id = p.id;

comment on view public.post_hot_scores is
  'Feed ranking for the Hot sort (B24, SOC-11): Reddit''s published hot formula over net votes. security_invoker; same columns as the feed reads from posts (B28 added shared_post_id). Since B27 the net votes are those the viewer may see (votes by lifters blocked either way or muted by the viewer are left out), so ranks can differ slightly between viewers.';

grant select on public.post_hot_scores to authenticated;
