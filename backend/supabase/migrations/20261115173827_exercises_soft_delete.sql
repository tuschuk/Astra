-- ---------------------------------------------------------------------------
-- B31 custom exercises: deleting a custom exercise is a soft delete.
--
-- A lifter can create, edit and delete their own (private) exercises. "Delete"
-- stamps `deleted_at` instead of removing the row, because the row is still
-- pointed at by the lifter's logged history (`workout_exercises`) and records
-- (`personal_records`). Keeping it means:
--   * past sessions and PRs keep the exercise's name forever;
--   * the delete is an ordinary UPDATE, so it syncs through the phone's
--     existing upload queue and reaches the lifter's other phones through the
--     existing download — no new tombstone channel;
--   * nothing on a phone can be left pointing at a row the server removed
--     (which would refuse every later upload of that workout).
-- The app hides stamped rows from the Library and the logger's picker.
-- Full reasoning: docs/feature_plans/custom-exercises.md.
--
-- No policy changes: "users update their own exercises" already lets exactly
-- the owner set the stamp, and the select policy keeps the row visible to its
-- owner only (other users never see it, deleted or not).
-- ---------------------------------------------------------------------------

alter table public.exercises
  add column deleted_at timestamptz;

-- Only a user's custom exercise can be deleted; the shared library can never
-- carry the stamp, by any path.
alter table public.exercises
  add constraint exercises_deleted_customs_only
    check (deleted_at is null or owner_id is not null);

comment on column public.exercises.deleted_at is
  'Set when the owner deletes their custom exercise (B31). The row stays so logged history and PRs keep its name; the app hides it from the library and the picker.';
