-- ============================================================================
-- Comments: "not blank" means no visible character at all (B23 review fix)
-- ============================================================================
-- What this migration does, in plain language:
--   The comments table (votes_comments migration) refused a body made only of
--   spaces with `btrim(body) <> ''`. But btrim strips only the space
--   character, so a body of just line breaks or tabs still got through — a
--   blank bubble. This swaps that clause for "contains at least one
--   non-whitespace character" (`body ~ '\S'`). The 1–500 character cap is
--   unchanged. Mirrored by commentBodyError in
--   frontend/src/social/commentLimits.ts, which already trims all whitespace.
-- ============================================================================

alter table public.comments drop constraint comments_body_check;

alter table public.comments
  add constraint comments_body_check
  check (char_length(body) between 1 and 500 and body ~ '\S');
