-- ============================================================================
-- B24 — post_hot_scores: how the feed ranks posts when the lifter picks "Hot"
-- (SOC-11). Chronological ("Latest") stays a plain read of `posts`.
--
--   The formula is Reddit's published "hot" ranking (open-sourced in reddit's
--   r2/lib/db/_sorts.pyx; walked through in Amir Salihefendic's "How Reddit
--   ranking algorithms work"): newer beats older, votes lift a post roughly
--   logarithmically, and every 12.5 hours of age (45000 s) costs as much as a
--   10x vote lead. 1134028003 is Reddit's arbitrary epoch offset, kept so the
--   formula matches its source verbatim; it shifts every score equally and
--   never changes the order.
--
--   Votes only — no comment weight (B24 plan, G5). A post with no votes ranks
--   purely by age, so among zero-vote posts "Hot" reads newest first.
--
--   This view is the hot score's one home: the app never computes it, only
--   echoes the number back as a paging bookmark.
--
--   Column list = the feed's contract: every posts column the app's
--   FEED_SELECT names (kind, image_path, visibility, created_at), plus every
--   foreign-key column an embed hangs on (flair_id, user_id, workout_id, and
--   id for the votes reverse join), kept untouched so PostgREST can embed the
--   author, flair, workout and the viewer's vote through the view. A future
--   posts column that joins FEED_SELECT joins this view in the same commit.
--
--   security_invoker, like post_scores: the viewer's own posts/votes RLS
--   filters the rows, so the view can only rank what the viewer may already
--   see. Every viewer of a post may read all its votes, so the score is the
--   same for everyone.
-- ============================================================================

create view public.post_hot_scores
  with (security_invoker = true) as
  select p.id,
         p.user_id,
         p.flair_id,
         p.workout_id,
         p.kind,
         p.image_path,
         p.visibility,
         p.created_at,
         (sign(coalesce(v.score, 0)) * log(greatest(abs(coalesce(v.score, 0)), 1))
            + (extract(epoch from p.created_at) - 1134028003) / 45000.0
         )::double precision as hot_score
  from public.posts p
  left join (select post_id, sum(value) as score
             from public.votes group by post_id) v
    on v.post_id = p.id;

comment on view public.post_hot_scores is
  'Feed ranking for the Hot sort (B24, SOC-11): Reddit''s published hot formula over net votes. security_invoker; same columns as the feed reads from posts.';

grant select on public.post_hot_scores to authenticated;
