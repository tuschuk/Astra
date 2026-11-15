-- ============================================================================
-- B27 review fix: a lifter can't report their own content.
--
-- The reports insert policy only checks that the reporter can SEE the
-- content, and everyone can see their own posts — so without this, the API
-- would accept a self-report (the app never offers one). The check reads the
-- reported account the before-insert trigger stamped from the real content
-- row, so it can't be dodged by sending a different id.
-- ============================================================================
alter table public.reports
  add constraint reports_not_self check (reporter_id <> reported_user_id);
