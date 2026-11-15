-- ============================================================================
-- Post images (B22) — progress-pic and PR photo posts, and where their
-- pictures live
-- ============================================================================
-- What this migration does, in plain language:
--   Until now every post shared a finished workout. This adds two more kinds
--   of post, both of which are ONE PHOTO instead of a workout:
--     - 'progress-pic' — a physique progress photo. Sensitive (CLAUDE.md
--       privacy rule): for now it is ALWAYS private — only its owner can see
--       it — until a later step (B26) gives lifters a visibility choice;
--     - 'pr'           — a photo of a personal-record moment, posted
--       publicly.
--   The photos themselves live in a private Supabase Storage bucket,
--   `post-images`, under a folder named after the owner's user id:
--   `<user_id>/<post_id>.<ext>`. Nothing in the bucket is readable by link
--   alone; every read runs the rules below as the signed-in viewer:
--     - you may upload, replace or delete only inside your own folder;
--     - you may read a photo if it is yours, or if a post you are allowed to
--       see cites it. "Allowed to see" is the same `private.workout_visible`
--       rule workouts and posts already use — written once, reused here.
--   The size cap (10 MiB) and the allowed picture formats are set on the
--   bucket itself, so the server refuses an over-limit upload even if the
--   phone's own check were skipped. The phone's copy of the number is
--   `frontend/src/social/mediaLimits.ts` — change the two together.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- posts: a kind, an optional workout, an optional image
-- ----------------------------------------------------------------------------
-- Every existing post is a workout post, which the default fills in.
alter table public.posts add column kind text not null default 'workout'
  check (kind in ('workout', 'progress-pic', 'pr'));
-- Image posts share no workout. (The one-post-per-workout unique rule stays:
-- Postgres treats nulls as distinct, so any number of image posts coexist.)
alter table public.posts alter column workout_id drop not null;
-- Where the post's photo is in the `post-images` bucket; null for workout posts.
alter table public.posts add column image_path text;

-- A workout post is a workout and nothing else; an image post is an image and
-- nothing else.
alter table public.posts add constraint posts_kind_shape check (
  (kind = 'workout' and workout_id is not null and image_path is null)
  or (kind in ('progress-pic', 'pr') and image_path is not null and workout_id is null)
);

-- A post may only cite a photo in its author's own folder. Without this, a
-- lifter could cite someone else's private photo in their own public post,
-- and the bucket's read rule ("a visible post cites it") would open it up.
alter table public.posts add constraint posts_image_in_own_folder
  check (image_path is null or image_path like user_id::text || '/%');

-- Progress pics are private, full stop, until B26 ships the lifter's choice;
-- B26 relaxes or drops this constraint in its own migration.
alter table public.posts add constraint posts_progress_pic_private
  check (kind <> 'progress-pic' or visibility = 'private');

-- The bucket's read rule looks a post up by its image path.
create index posts_image_path_idx on public.posts (image_path) where image_path is not null;

-- The write rules learn that `workout_id` may be null (an image post). The
-- shape check above guarantees null only ever means "image post", and the
-- own-folder check ties the image to its author.
drop policy "users post as themselves" on public.posts;
create policy "users post as themselves"
  on public.posts for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (workout_id is null or private.owns_workout(workout_id))
  );

drop policy "users update their own posts" on public.posts;
create policy "users update their own posts"
  on public.posts for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (workout_id is null or private.owns_workout(workout_id))
  );

-- ----------------------------------------------------------------------------
-- The bucket, with its size cap and allowed formats
-- ----------------------------------------------------------------------------
-- 10 MiB = 10 * 1024 * 1024 bytes. Mirrored by MAX_POST_IMAGE_BYTES in
-- frontend/src/social/mediaLimits.ts. HEIC is deliberately absent: half the
-- feed's phones could not show it (the picker re-encodes iPhone photos to JPEG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp']);

-- ----------------------------------------------------------------------------
-- Who may do what with the bucket's files
-- ----------------------------------------------------------------------------
-- Upload only into your own folder (the first path segment is your user id).
create policy "post images: owners upload into their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Replace only your own files — a retried upload overwrites the same path.
create policy "post images: owners replace their own files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Read your own files, or any file cited by a post you may see. A photo whose
-- post hasn't arrived yet (the upload goes first) is readable by its owner only.
create policy "post images: readable with their post"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.posts p
        where p.image_path = storage.objects.name
          and private.workout_visible(p.user_id, p.visibility)
      )
    )
  );

-- Delete only your own files. (Nothing deletes post images yet; post deletion
-- arrives with a later step, which brings the file cleanup with it.)
create policy "post images: owners delete their own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
