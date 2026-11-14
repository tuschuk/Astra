# auth-and-signup — B05: Auth and signup (FND-2 part 2, NFR-8)

**Branch:** `auth-and-signup` (from `main`)
**Build step:** B05 — covers FND-2 (partial: auth screens + supabase-js wiring; schema/RLS landed
in B02 `supabase-schema`) and NFR-8 (whole: 18+ age gate at signup).
**Depends on:** B02 (merged) — identity migrations, signup trigger, RLS, live project
`qczhvuzdxpmfztxrifyg.supabase.co`.

## Step definition of done (from the Build order)

A new user signs up (under-18 refused with a clear message), signs in, kills the app, reopens
still signed in; Jest covers the gate and session logic with a fake client.

## Scope note — one deliberate clarification

The step scope reads frontend-only ("supabase-js client and env config in `frontend/`"), but
NFR-8's definition of done is "Signup **cannot complete** for anyone under 18". A client-side
check alone does not make that true: anyone holding the publishable key can call
`auth.signUp` directly and skip the screen. This plan therefore includes **one small backend
migration** extending the existing `private.handle_new_user()` trigger so the *server* refuses
an under-18 (or missing) birthdate. The client gate provides the clear message; the trigger
makes the DoD literally true. This is a scope clarification, not a widening — without it the
step would mark NFR-8 done on an unenforced rule. Everything else stays inside the stated scope.

## Approach

### 1. Dependencies (frontend)

- `@supabase/supabase-js` — the client library (Architecture: "Supabase's generated API and
  client library").
- `@react-native-async-storage/async-storage` — session persistence store. This is the storage
  adapter Supabase's own Expo guide uses. (SecureStore was considered — see Grilling decisions.)
- `react-native-url-polyfill` — supabase-js needs full WHATWG `URL`/`URLSearchParams`; Hermes'
  built-in is still partial. The builder verifies whether RN 0.88 ships enough; if it does, the
  polyfill is dropped rather than carried speculatively.

No date-picker dependency: birthdate is entered as three labeled numeric fields (see §5).

### 2. Client module and env config — `frontend/src/lib/supabase.ts`

- Config from `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (the publishable
  key — safe to embed in a client; RLS is the enforcement point, per B02). Values live in
  `frontend/.env` (already gitignored by the root `.env` pattern); a committed
  `frontend/.env.example` documents both names with placeholders. The module throws a clear
  error at startup if either is missing — a blank screen with a silent 401 is the alternative.
- Client options: `auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true,
  detectSessionInUrl: false }` (no web URL sessions in a native app).
- An `AppState` listener calls `supabase.auth.startAutoRefresh()` when the app is active and
  `stopAutoRefresh()` when backgrounded — the supabase-js RN pattern that keeps the access token
  fresh without a background timer.
- The module exposes a `createSupabaseClient()` factory plus the app's singleton. The factory is
  the test seam: tests construct fakes shaped like the client; nothing in tests ever imports the
  singleton or touches the network (Testing rules).

### 3. Auth state — `frontend/src/auth/`

- `AuthProvider` (React context) owns the session: on mount it calls
  `supabase.auth.getSession()` (a **local read** of the persisted session — no network, so a
  signed-in user opens the app with no signal; offline-first holds) and subscribes to
  `onAuthStateChange` for sign-in/sign-out/token-refresh transitions. State is
  `{ status: 'restoring' | 'signedOut' | 'signedIn', session }`.
- The root layout keeps the splash screen up until fonts **and** session restore resolve, so the
  user never sees a sign-in flash before being routed into the tabs.
- The provider accepts an injectable client (defaulting to the singleton) — the fake-client seam
  the Jest tests use.

### 4. Route protection — auth-gated route group

expo-router v6 `Stack.Protected` in `src/app/_layout.tsx` (inside `AuthProvider`):

- `(auth)` group — `src/app/(auth)/sign-in.tsx`, `src/app/(auth)/sign-up.tsx` — guarded by
  "no session".
- `(tabs)` group — the existing five-tab app — guarded by "session exists".

Killing and relaunching the app restores the session from AsyncStorage and lands the user
straight in the tabs; signing out flips the guard and lands on sign-in. Route files stay
logic-thin: each screen composes components from `src/components/auth/`, and their RNTL tests
live in `src/__tests__/` (route-file exception in CLAUDE.md).

### 5. Screens (existing primitives: `Screen`, `Heading`, `Body`, `Button`, `Card`)

- **Sign-in:** email + password, primary Button, inline error text for bad credentials
  (supabase error mapped to friendly copy), link to sign-up.
- **Sign-up:** email, password (with minimum-length hint matching the project's auth policy),
  birthdate as three labeled numeric fields (month / day / year — no new dependency, identical
  on both platforms, trivially testable), link to sign-in.
  - Client gate: if the entered birthdate is invalid or under 18, the submit is refused with the
    clear message — "Astra is 18+. You must be 18 or older to create an account." — and
    `signUp` is never called.
  - On submit, birthdate travels in `signUp`'s `options.data` (user metadata) so the signup
    trigger can store and enforce it server-side in the same transaction as account creation.
- **Sign-out:** a button on the You screen (the profile is its natural home; the screen already
  exists as a placeholder). Calls `supabase.auth.signOut()`; the guard does the routing.

### 6. Age gate logic — `frontend/src/auth/age.ts`

A pure function, e.g. `isAtLeast18(birthdate: ISODate, today: ISODate): boolean`, plus the
birthdate-field → ISO date validation. Pure and injectable-`today` so Jest can pin every
boundary (see Testing). This is account/auth logic, not training math, so it does **not** live
in the future shared training-math module (B06) — one home, but the right home.

### 7. Backend migration — extend the signup trigger (the server-side half of NFR-8)

One new migration, `backend/supabase/migrations/<ts>_signup_birthdate_gate.sql`:

- `private.handle_new_user()` additionally reads `new.raw_user_meta_data->>'birthdate'`:
  - missing or unparseable → `raise exception` (signup rolls back — an account can never exist
    without a birthdate on record);
  - younger than 18 (`birthdate > current_date - interval '18 years'`) → `raise exception`
    (NFR-8 enforced at the database, not the client);
  - otherwise written to `user_body_data.birthdate` in the same insert the trigger already does.
- A check constraint on `user_body_data.birthdate`
  (`birthdate is null or birthdate <= current_date - interval '18 years'`) so a later *edit*
  can't set an under-18 date either. Time-dependent checks are safe in this direction: rows only
  become more valid as time passes, never less.
- Note: when the trigger raises, supabase-js surfaces an opaque "Database error saving new
  user" — the *clear message* of the step DoD is the client gate's job; the trigger is the
  backstop that makes "cannot complete" true. Both are needed; neither alone satisfies the DoD.
- Known consequence, accepted: any signup path that sends no birthdate metadata is refused —
  that includes future OAuth providers until they're taught to collect one, **and**
  dashboard/admin-created users and RLS-probe scripts, which must now pass `birthdate` in
  `user_metadata` (the admin `createUser` API supports it; a re-run of the B02 probe needs this
  one-line addition). Softening to "enforce only when present" was rejected: it reopens the
  exact bypass the trigger exists to close.

Applying the migration to the live project happens via the Supabase MCP
(`apply_migration`) during the build, mirroring how B02/B04 landed, and is verified with a live
probe (under-18 signup refused, 18+ signup creates all three rows with birthdate stamped).

### 8. Email confirmation — decision needed at Gate 1

The step DoD is "signs up, signs in, kills the app, reopens still signed in" — no email step.
**Plan of record: confirmation emails stay off for launch.** The project's *current* setting is
unknown: this planner session tried to read it (Management API `config/auth`) and the
permission layer declined the call, so the builder reads it live before coding the copy — and
the password-minimum hint on the sign-up screen comes from the same config read, never
hardcoded. If confirmation is on, Tristen flips it off (one toggle under Auth → Providers →
Email) or says at Gate 1 that it stays on. The sign-up flow still handles the confirmation-on shape gracefully (session `null`
after `signUp` → route to sign-in with a "check your email" notice) so a later policy flip is
copy, not code. If Tristen wants confirmation **on** at launch, say so at Gate 1 — the DoD's
"signs up, signs in" then includes an email hop and the builder tests that path instead.

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/lib/supabase.ts` | new — client factory + singleton, env validation, auto-refresh wiring |
| `frontend/.env.example` | new — documents the two `EXPO_PUBLIC_*` names |
| `frontend/.env` | new, **not committed** — real URL + publishable key (fetched via Supabase MCP `get_project_url` / `get_publishable_keys`) |
| `frontend/src/auth/AuthProvider.tsx` | new — session context, restore + change subscription |
| `frontend/src/auth/age.ts` | new — 18+ gate + birthdate validation (pure) |
| `frontend/src/auth/age.test.ts` | new — boundary tests |
| `frontend/src/auth/AuthProvider.test.tsx` | new — fake-client session-logic tests |
| `frontend/src/app/_layout.tsx` | edit — wrap in `AuthProvider`, `Stack.Protected` groups, splash waits for restore |
| `frontend/src/app/(auth)/sign-in.tsx`, `(auth)/sign-up.tsx`, `(auth)/_layout.tsx` | new — route files, logic-thin |
| `frontend/src/components/auth/SignInForm.tsx`, `SignUpForm.tsx`, `BirthdateInput.tsx` | new — the actual screens' content |
| `frontend/src/__tests__/auth-screens.test.tsx` | new — RNTL: gate message shown, signUp not called under 18, forms submit |
| `frontend/src/app/(tabs)/you.tsx` | edit — sign-out button |
| `frontend/package.json` | edit — the dependencies in §1 |
| `backend/supabase/migrations/<ts>_signup_birthdate_gate.sql` | new — §7 |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit — trigger/constraint change; auth screens + session data path (Document step, after review) |
| `docs/BUILD_LIST.md` | **not touched** — status flips are Tristen's at Gate 2 |

## Data model impact

No new tables, no new columns. `user_body_data.birthdate` (exists since B02) gains a check
constraint and is now populated at signup by the extended trigger. `profiles` / `user_settings`
rows keep arriving through the same trigger — unchanged behavior, observed by the existing B02
probe expectations.

## How each definition of done becomes observably true

- **NFR-8 "Signup cannot complete for anyone under 18":** client refuses with the clear message
  before any network call (Jest-asserted: fake client's `signUp` never invoked); the trigger
  refuses a direct API attempt (live probe during the build: a raw `signUp` with an under-18
  birthdate in metadata fails and no `auth.users` row remains).
- **FND-2 (this step's part) "auth screens and supabase-js wiring":** sign-up creates an
  account whose profile / settings / body-data rows exist (live probe); sign-in and sign-out
  work from the screens; session survives relaunch (restore path Jest-tested with a fake client
  returning a stored session; the real kill-and-reopen is Tristen's device check, same
  Built-not-Done ceiling as B01).
- **Step DoD Jest clause:** `age.test.ts` (boundaries: 18th birthday today passes, tomorrow's
  18th fails, Feb 29 birthdays, invalid dates) and `AuthProvider.test.tsx` (restoring → signedIn
  with persisted session, → signedOut without; sign-in/sign-out transitions; subscription
  cleanup) — all against fakes, no network, per Testing rules.

## Out of scope (this branch)

- Password reset / "forgot password", email change, account deletion UI (NFR-6's UI lands with
  the You/settings features). Password reset will deserve its own small step — flagged for
  DEFERRED.md at session end rather than silently dropped.
- OAuth / social sign-in (not in the PRD at launch).
- Username onboarding and profile editing (YOU items) — `username` stays null at signup, as B02
  designed.
- Collecting sex / bodyweight at signup — they stay null until the features that need them
  (strength grades) add their own onboarding; the 18+ gate only needs birthdate.
- SQLite/offline sync (B07) — auth state persistence here is supabase-js's own session store.
- Rate limiting / captcha on auth endpoints — Supabase project-level settings, revisit if abuse
  appears ("add nothing speculative").

## Risks a reviewer should weigh

1. **The trigger change can break signup entirely** — it runs inside account creation; a bug
   refuses every signup, and the raised-exception path must be probed live (both refusal and
   success) before Gate 2.
2. **`Stack.Protected` + splash-hold interplay** — getting restore-before-first-route wrong
   shows a sign-in flash or, worse, strands the splash. The B01 lesson (font errors must not
   strand the splash) applies: restore failure must resolve to `signedOut`, never hang.
3. **Email-confirmation project setting** — if it's on and nobody flips it, "signs up, signs
   in" fails at Gate 2 verification even though the code is right. Decided at Gate 1 (§8).

## Grilling decisions (settled before code)

Grilled in-session by the planner (`mattpocock-skills:grilling` invoked; this is a headless
pipeline run, so the planner played both sides at full severity — anything only Tristen can
decide is flagged for Gate 1 rather than assumed).

- **Guard on `getSession()`, not `getUser()`.** Supabase docs call the local session
  "unverified" and point at `getUser()` — but `getUser()` is a network round-trip, and gating
  app entry on it would lock a signed-in user out of their own app in a dead zone
  (offline-first, NFR-1). The local session only gates *navigation*; every real data access is
  re-verified server-side by RLS with the token itself. Client-side gating is never the
  enforcement point anyway (CLAUDE.md privacy rule) — so the "unverified" session guards UI
  and nothing else.
- **AsyncStorage now; maybe `expo-sqlite/kv-store` at B07.** B07 brings expo-sqlite regardless,
  and its kv-store is an AsyncStorage drop-in — so this dependency could be avoided by pulling
  expo-sqlite forward. Rejected for now: pulling a storage engine into the auth step couples
  two steps for the sake of one import, and AsyncStorage is Supabase's own documented Expo
  pattern with a shipped Jest mock. Consolidating onto kv-store is a one-line adapter swap
  noted for B07, not speculation carried here.
- **Birthdate in `auth.users` metadata is transport, not a second home.** The canonical value
  is `user_body_data.birthdate` (RLS-walled, per B02). The metadata copy is how the value
  crosses into the signup transaction; it lingers afterwards, and a user editing their own
  metadata later changes nothing — the trigger read it exactly once. Not a mirrored-copy
  violation (that rule guards training math), but recorded so nobody ever reads age from
  metadata.
- **`Stack.Protected` fallback.** If expo-router ~58.0.31 lacks `Stack.Protected` at
  typecheck, the fallback is the classic `<Redirect>` guard in each group's `_layout` driven by
  the same AuthProvider state — identical behavior, no plan change.
- **Why not SecureStore for tokens?** Supabase sessions exceed SecureStore's 2 KB value limit;
  the documented workaround (AES key in SecureStore, ciphertext in AsyncStorage) adds a crypto
  dependency and real failure modes for marginal gain on a device-local store. AsyncStorage is
  Supabase's own documented Expo pattern. Revisit only with a measured threat, not
  speculatively.
- **Why a trigger exception and not a Before-User-Created auth hook?** The hook is a separate
  Supabase feature with its own config surface; the trigger already exists, already owns the
  per-user rows, and keeps enforcement in one migration-reviewed place. Same transaction, less
  machinery.
- **Why three text fields and not a date picker?** `@react-native-community/datetimepicker`
  renders different UIs per platform, is awkward under RNTL, and is a new dependency for one
  field. Three numeric inputs are identical on both platforms and testable. If UX review later
  wants a picker, it's an isolated component swap (`BirthdateInput`).
- **Why does the client compute age at all if the server enforces?** The clear refusal message
  (step DoD) must appear instantly and offline-independently; the server's error is opaque by
  design (no information leak about why a signup failed beyond our own UI copy).
- **Timezone honesty:** the client gates on the device's local date, the trigger on the
  server's `current_date` (UTC). Within ±1 day of the 18th birthday these can disagree for a
  few hours; the strict side (server UTC) wins, which is the defensible direction for a legal
  gate.
