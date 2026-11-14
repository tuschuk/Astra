# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026, pipeline builder run for B05)

**B05 auth-and-signup is built on branch `auth-and-signup` and waiting at Gate 2.** Nothing is
merged. `main` is untouched and no BUILD_LIST status was changed.

What landed (the full list is in the commit; deviations are in `docs/feature_plans/auth-and-signup.md`,
under "Build deviations"):

- A supabase-js client (`frontend/src/lib/supabase.ts`). The session is saved in AsyncStorage and
  tokens refresh only while the app is in the foreground.
- `AuthProvider` / `useAuth` (`frontend/src/auth/`), which handles restore, sign in, sign up and
  sign out.
- An 18+ age gate (`auth/age.ts`) that matches Postgres's `current_date - interval '18 years'`
  boundary, including Feb 29.
- `(auth)` sign-in / sign-up screens behind `Stack.Protected`. The splash stays up until the
  session restore finishes.
- A Sign out button on You.
- The migration `20261114130000_signup_birthdate_gate.sql`, which makes the signup trigger refuse
  a missing or under-18 birthdate and stamp `user_body_data.birthdate`.
- Both diagrams updated.

Verified: `npx jest` (15 suites, 126 tests), `npx tsc --noEmit` and `npm run lint` all clean in
`frontend/`.

**Not done, because the builder run could not use the Supabase MCP (permission declined). Tristen
does these at Gate 2:**

1. **Apply the migration live.** Run Supabase MCP `apply_migration` with the contents of
   `backend/supabase/migrations/20261114130000_signup_birthdate_gate.sql`, or paste it into the
   SQL editor.
2. **Probe it.** First, a raw `signUp` with `options.data.birthdate` under 18 must fail and leave
   no `auth.users` row. Second, an 18+ signup must create `profiles`, `user_settings` and
   `user_body_data` rows, with birthdate set on the body-data row.
3. **Create `frontend/.env`** from `frontend/.env.example`: the project URL plus the publishable
   key.
4. **Check Auth → Providers → Email.** Confirmation should be off per the plan, so that "sign up,
   then signed in" holds. Check the password minimum too: if it isn't 6, change
   `frontend/src/auth/password.ts`.
5. **Device check on iOS and Android.** Run `npx expo start` from `frontend/`; it also regenerates
   the gitignored typed routes. Then: sign up under 18 and see it refused, sign up 18+, kill the
   app, reopen still signed in, sign out, sign in.
6. Then merge `auth-and-signup` with `--no-ff` and flip B05, FND-2 and NFR-8 in `docs/BUILD_LIST.md`.

Still outstanding from before: the n8n-mcp `WEBHOOK_SECURITY_MODE=moderate` one-liner (see
DEFERRED), running the app on a device to flip FND-1 and FND-4, and the six external blockers.

The next pipeline step after B05 merges is **B06 training-math**.
