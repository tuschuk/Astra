-- ============================================================================
-- Program votes and comments — the read rules, matched to post votes (B41 fix)
-- ============================================================================
-- What this migration does, in plain language:
--
--   Two corrections to the read (select) rules of program_votes and
--   program_comments, found at B41's review, before anything used them:
--
--   1. The post tables' parity rule from B27: a vote or comment is also
--      filtered by WHO wrote it (`private.author_visible` — yours, or no block
--      either way and not muted by you). Without it, a lifter you blocked or
--      muted would still show up in a program's comments and in its score —
--      unlike on a post. So program_scores, like post_scores, sums the votes
--      the viewer may see.
--
--   2. You can always read your OWN vote and comment rows. Postgres applies a
--      table's select rule to the rows a DELETE ... WHERE looks at, so without
--      this arm, once a program stopped being visible to you (unpublished,
--      say) your "remove my vote" quietly removed nothing. Your own rows reveal
--      nothing new — you wrote them — and the program itself stays hidden
--      (program_scores reads programs under your own rules).
-- ============================================================================

drop policy "program votes visible with their program" on public.program_votes;
create policy "program votes visible with their program and voter, or your own"
  on public.program_votes for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (private.can_view_program(program_id) and private.author_visible(user_id))
  );

drop policy "program comments visible with their program" on public.program_comments;
create policy "program comments visible with their program and author, or your own"
  on public.program_comments for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (private.can_view_program(program_id) and private.author_visible(user_id))
  );
