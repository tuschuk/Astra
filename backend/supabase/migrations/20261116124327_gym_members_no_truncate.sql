-- =============================================================================
-- B50 review fix — tighten the gym tables' leftover default grants
-- =============================================================================
-- Supabase grants every table's TRUNCATE, REFERENCES and TRIGGER privileges to
-- `authenticated` by default. The gyms migration already removed TRUNCATE on
-- gyms; this does the same for gym_members (TRUNCATE skips row-level security,
-- so "only your own row" would not apply to it), and drops REFERENCES/TRIGGER
-- on both — the app never needs them. PostgREST can't issue any of these, so
-- this is belt and braces: what a signed-in lifter may do to gym tables is now
-- exactly read (both), join / switch (user_id, gym_id) and leave (own row).
-- =============================================================================
revoke truncate, references, trigger on public.gym_members from authenticated;
revoke references, trigger on public.gyms from authenticated;
