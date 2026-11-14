-- ============================================================================
-- Signup birthdate gate — the server-side half of the 18+ rule (NFR-8)
-- ============================================================================
-- What this migration does, in plain language:
--   Astra is 18+ only. The sign-up screen already refuses an under-18
--   birthdate with a clear message, but anyone holding the app's publishable
--   key could skip the screen and call the signup API directly. So the
--   database itself now refuses: the signup trigger (which already creates
--   each new user's profile, settings and body-data rows) reads the birthdate
--   the app sends along with the signup, and
--     * no birthdate, or one that isn't a real date  -> signup is refused
--     * younger than 18 today                         -> signup is refused
--     * otherwise                                     -> stored in
--                                                        user_body_data.birthdate
--   "Refused" means the trigger raises an error, which rolls back the whole
--   signup: no auth account is left behind. Supabase reports this to the app
--   as a generic "Database error saving new user"; the app's own screen is
--   what shows the friendly 18+ message.
--
--   A check constraint also stops a later edit from setting an under-18
--   birthdate. Using today's date inside a constraint is safe in this
--   direction: a row that passes today can only pass more easily tomorrow.
--
--   Consequence (accepted in the plan): every account creation path must now
--   send `birthdate` in the user metadata — including dashboard/admin-created
--   users and test/probe scripts (admin createUser supports user_metadata).
--
--   The birthdate also lingers in auth.users.raw_user_meta_data. That copy is
--   transport only — the trigger reads it exactly once. The canonical,
--   RLS-protected value is user_body_data.birthdate; never read age from
--   metadata.
-- ============================================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_birthdate text := new.raw_user_meta_data ->> 'birthdate';
  -- v_ prefix: keeps the variable distinct from the birthdate column.
  v_birthdate   date;
begin
  -- 1. A birthdate must be present and be a real calendar date (YYYY-MM-DD).
  if raw_birthdate is null or raw_birthdate !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'signup refused: a birthdate (YYYY-MM-DD) is required'
      using errcode = 'check_violation';
  end if;
  begin
    v_birthdate := raw_birthdate::date;
  exception when others then
    raise exception 'signup refused: birthdate is not a valid date'
      using errcode = 'check_violation';
  end;

  -- 2. 18 or older today. `current_date - interval '18 years'` lands on the
  --    same calendar day 18 years ago (Feb 29 clamps to Feb 28) — the app's
  --    age gate (frontend/src/auth/age.ts) uses exactly the same rule.
  if v_birthdate > (current_date - interval '18 years')::date then
    raise exception 'signup refused: Astra is 18+'
      using errcode = 'check_violation';
  end if;

  -- 3. The three per-user rows, as before — now with the birthdate stamped.
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- A friendly starting display name from the email; the user can change it.
    -- Truncated to 50 chars so an unusually long email can never fail the
    -- profiles check constraint and thereby break signup itself.
    nullif(left(split_part(coalesce(new.email, ''), '@', 1), 50), '')
  );
  insert into public.user_settings (user_id) values (new.id);
  insert into public.user_body_data (user_id, birthdate) values (new.id, v_birthdate);
  return new;
end;
$$;

-- No later edit can set an under-18 (or future) birthdate either. Null stays
-- allowed so rows created before this migration remain valid.
alter table public.user_body_data
  add constraint user_body_data_birthdate_18_plus
  check (birthdate is null or birthdate <= (current_date - interval '18 years')::date);
