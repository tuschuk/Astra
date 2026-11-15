-- B28 share-cards, review fix: narrow the re-share trigger's update half.
--
-- `posts_reshare_shape` (previous migration) ran before ANY update of a
-- re-share, re-checking that the resharer can still see the original. Once the
-- original's author made it private or blocked the resharer, the resharer could
-- no longer change their own re-share's audience with the B26 visibility chip
-- (the update failed with "That post is gone"), even though the read rule
-- already hides the re-share from everyone.
--
-- The update half exists only to stop a re-share being re-pointed or its flair
-- swapped after the fact, so it now fires only when an update names one of
-- those columns (or `kind`). A visibility-only update passes straight through.
-- Inserts are checked exactly as before.

drop trigger posts_reshare_shape on public.posts;

create trigger posts_reshare_shape
  before insert or update of shared_post_id, flair_id, kind on public.posts
  for each row when (new.kind = 'reshare')
  execute function private.reshare_shape();
