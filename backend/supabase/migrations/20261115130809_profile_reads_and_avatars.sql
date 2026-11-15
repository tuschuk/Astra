-- ============================================================================
-- Profile reads and avatars (B25) — what a lifter's profile needs from the
-- server
-- ============================================================================
-- What this migration does, in plain language:
--   A profile shows five header facts (photo, name, bio, follower count,
--   following count), the lifter's posts, their workout history and their
--   personal records. Most of that is already readable. Four things were not:
--
--   1. Follower / following COUNTS of someone else. The `follows` table only
--      shows a viewer the rows they are part of (B20), so the app cannot count
--      another lifter's followers itself. `public.follow_counts(profile_id)`
--      returns exactly two numbers — never a row — so nobody learns WHO
--      follows whom, only how many.
--   2. Another lifter's PRs. Records were owner-only (B13). Now a record is
--      readable by anyone who may see the workout holding the set it cites:
--      a PR from a public workout is public, from a followers-only workout is
--      for followers, from a private workout stays the owner's. Blocks hide
--      everything. The decision is `private.can_view_workout`'s — the one home
--      of workout visibility — so nothing new is invented here.
--   3. Profile photos. A new `avatars` storage bucket. It is PUBLIC-READ: a
--      profile photo is the account's public face (shown beside every post),
--      and avatars are not one of the sensitive classes (progress pics, body
--      data, recovery data stay private). Uploads, replacements and deletes
--      are still limited to the owner's own folder. 5 MiB cap, JPEG/PNG/WebP —
--      mirrored by MAX_AVATAR_BYTES in frontend/src/social/mediaLimits.ts;
--      change the two together.
--   4. `profiles.avatar_url` now holds a path inside the owner's own folder of
--      that bucket (never someone else's upload, never an arbitrary link).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Follow counts, without widening `follows`
-- ----------------------------------------------------------------------------
-- Security definer on purpose: the counts include rows the caller may not
-- see. It returns only the two aggregates, so no row data leaks. Both
-- directions are indexed (the follows primary key, follows_followee_idx).
create or replace function public.follow_counts(profile_id uuid)
returns table (followers bigint, following bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.follows f where f.followee_id = profile_id),
    (select count(*) from public.follows f where f.follower_id = profile_id);
$$;

-- Functions are executable by PUBLIC by default; only signed-in users may ask.
revoke execute on function public.follow_counts(uuid) from public, anon;
grant execute on function public.follow_counts(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. personal_records: readable with their source workout
-- ----------------------------------------------------------------------------
-- May the current user see the workout this set belongs to? Security definer
-- so the lookup isn't re-filtered by sets / entries RLS; the visibility
-- decision itself is can_view_workout's, evaluated as the current user.
create or replace function private.can_view_set(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sets s
    join public.workout_exercises we on we.id = s.workout_exercise_id
    where s.id = sid and private.can_view_workout(we.workout_id)
  )
$$;

-- The owner clause comes first so the sync download (filtered to the
-- signed-in user) short-circuits without running the helper. Write policies
-- are untouched: only the owner writes, citing their own sets.
drop policy "users read their own records" on public.personal_records;
create policy "records readable with their source workout"
  on public.personal_records for select
  to authenticated
  using (user_id = (select auth.uid()) or private.can_view_set(source_set_id));

-- ----------------------------------------------------------------------------
-- 3. The avatars bucket (public read), and who may write to it
-- ----------------------------------------------------------------------------
-- 5 MiB = 5 * 1024 * 1024 bytes. Mirrored by MAX_AVATAR_BYTES in
-- frontend/src/social/mediaLimits.ts. No HEIC, as for post images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp']);

-- Anyone reads avatars through the bucket's PUBLIC URL, which serves objects
-- without a token or RLS (that is what `public = true` means). Through the
-- authenticated API the owner can still list/select their own folder — the
-- Storage API needs that select right to delete an object (it reads the row
-- it removes), so the best-effort cleanup of a replaced photo works.
-- Writes are owner-folder only.
create policy "avatars: owners read their own folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: owners upload into their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: owners replace their own files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars: owners delete their own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ----------------------------------------------------------------------------
-- 4. avatar_url is a path in the owner's own folder
-- ----------------------------------------------------------------------------
-- The B22 posts_image_in_own_folder precedent: a profile can't wear someone
-- else's upload or an arbitrary URL. The app builds the public address from
-- this path in one place (frontend/src/social/avatars.ts).
alter table public.profiles add constraint profiles_avatar_in_own_folder
  check (avatar_url is null or avatar_url like id::text || '/%');
