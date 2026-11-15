-- ============================================================================
-- B26 post privacy: the lifter chooses who sees each post (YOU-5) and who sees
-- new progress pics by default (the Settings Privacy section, YOU-4 / NFR-5).
--
-- Enforcement does not change here. A post's readers are still decided by the
-- posts select policy through private.workout_visible(user_id, visibility),
-- and a photo's readers by the post-images storage policy, which reads the
-- citing post's visibility through the same helper on every fetch. This
-- migration adds the CHOICE:
--   1. user_settings.progress_pic_visibility — the default a new progress pic
--      is born with (mirrored on the phone, because posting works offline);
--   2. the B22 lock that forced every progress pic private comes off;
--   3. a workout post and its workout keep the same visibility when the post's
--      visibility is changed, so a post made private can't leave its session
--      readable on the owner's profile History.
-- ============================================================================

-- 1. The lifter's choice for new progress pics. Private by default: the
--    sensitive class keeps its B22 posture unless the owner says otherwise.
alter table public.user_settings
  add column progress_pic_visibility public.workout_visibility not null default 'private';

-- 2. The B22 lock comes off (B22's migration named this step for it). What the
--    owner chose is enforced by the same RLS as every other post.
alter table public.posts drop constraint posts_progress_pic_private;

-- 3. Lockstep: when a workout post's visibility changes, its workout follows in
--    the same transaction.
--    Invoker rights (NOT security definer): the posts update policy already
--    guarantees the updater wrote the post, and its check requires they own
--    the workout (private.owns_workout), so the workouts owner-update policy
--    passes. The trigger gains no power the user lacks. The workouts
--    moddatetime trigger bumps updated_at, so the owner's other devices pick
--    the change up on their next download.
create or replace function private.sync_workout_visibility_with_post()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.workouts
    set visibility = new.visibility
    where id = new.workout_id
      and visibility is distinct from new.visibility;
  return new;
end;
$$;

comment on function private.sync_workout_visibility_with_post() is
  'B26: keeps a workout''s visibility equal to its post''s when the post''s visibility changes. Invoker rights.';

-- Fires only when the visibility actually changed, so a retried upload of the
-- same post row (B21's upsert) is a no-op here.
create trigger sync_workout_visibility
  after update of visibility on public.posts
  for each row
  when (new.workout_id is not null and new.visibility is distinct from old.visibility)
  execute function private.sync_workout_visibility_with_post();
