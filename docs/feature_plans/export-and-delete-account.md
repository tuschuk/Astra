# export-and-delete-account (B32)

Covers **NFR-6** (Export training data; delete account and content — whole feature).
Step DoD: the export contains every workout, set and PR; after deletion nothing of the user
remains. Depends on B25 (profile/avatars) — merged.

## What exists (explored Nov 15, 2026)

- **Edge-function precedents.** `analyze-workout` (B18): caller-token client for reads so RLS
  scopes everything, `selectIn` helper that pages id-chunked reads past the 1000-row cap.
  `moderate` (B27): service-role client, `auth.admin.deleteUser`, and a storage sweep
  (`listFolder`/`removeObjects` over `ACCOUNT_BUCKETS = ['post-images', 'avatars']`, paged at
  1000). Its `remove-account` action is almost exactly the delete this step needs — minus the
  moderator gate, plus a self-service one. Both functions split wiring (`index.ts`) from a
  dependency-injected `handler.ts` tested with fakes in `backend/supabase/functions/tests/`.
- **Cascade graph, verified live (pg_constraint + information_schema, Nov 15, 2026)** — the
  NFR-6 row's "(verified)" note now actually is:
  - `public.profiles.id → auth.users.id` **ON DELETE CASCADE** (checked via `pg_constraint`;
    `information_schema` hides it because the API role can't read `auth`).
  - Every table referencing `profiles` cascades: workouts, workout_exercises (via workouts),
    sets (via workout_exercises), personal_records (user_id; also exercise_id→exercises CASCADE
    and source_set_id→sets CASCADE), workout_analyses, posts, votes, comments, follows (both
    sides), blocks (both sides), mutes (both sides), reports (**both** reporter_id and
    reported_user_id — so reports about the account vanish too, which is what "nothing of the
    user remains" wants), moderators, sync_tombstones, user_body_data, user_settings, and
    custom `exercises` (owner_id CASCADE).
  - `posts.shared_post_id → posts` CASCADE: **other users' re-shares of the deleted user's
    posts are deleted too** (a re-share has no content of its own — acceptable, recorded).
  - `workout_exercises.exercise_id → exercises` is SET NULL — irrelevant here since the owner's
    workouts cascade away in the same statement, but it means deleting a user's customs never
    touches anyone else's rows (customs are private anyway).
  - `storage.objects` has **no FK to auth.users** — nothing blocks the admin delete, and
    nothing cascades: the two bucket folders must be swept by hand (the `moderate` precedent).
  - All auth-schema children of `auth.users` cascade (sessions, identities, mfa, one-time
    tokens…) except `auth.scim_users` (NO ACTION) — SCIM is unused on this project (no rows,
    no SSO), so it cannot block the delete.
- **RLS facts that shape the export** (pg_policies, live): the owner-select on `exercises` has
  no `deleted_at` filter, so soft-deleted customs export fine. `reports` has **no self-select**
  (moderators only) — a caller-token export cannot include them. Own `votes`/`comments` are
  readable only while their post is visible (`can_view_post`), so "my votes on now-hidden
  posts" are unreadable by design.
- **App side.** Settings (`frontend/src/app/settings.tsx`) has the Account card (email + Sign
  out). `signOut({ scope: 'local' })` clears the session before any network call. The device
  database is `astra.db` (`db/database.ts` caches one driver promise; no close/wipe helper
  exists). `expo-sqlite/kv-store` holds the auth session, plate rack, feed prefs and the own-
  profile cache. Waiting post photos live in `documents/post-images/` (`social/postImages.ts`).
  `expo-sharing` + `expo-file-system/legacy` are already dependencies (B22/B28). Edge functions
  are called with `client.functions.invoke` (sends the user's token). Connectivity comes from
  `expo-network` (sync engine); route-file tests live in `frontend/src/__tests__/`.

## Approach

Two new edge functions, one new Settings flow each, and a device wipe that runs after a
successful delete. No migration — the schema already cascades (verified above), so the ERD is
untouched; `app-flow.md` gains the two paths.

### 1. `export-data` edge function (caller token — RLS does the scoping)

`backend/supabase/functions/export-data/{index.ts,handler.ts}` + `tests/export_data.test.ts`,
`verify_jwt = true` in `config.toml` (the other two functions' pattern).

- **POST, empty body.** Identify the caller from the token (`auth.getUser`). All reads use the
  caller-token client, so RLS guarantees the export can only ever contain the caller's own
  rows — no service role anywhere in this function.
- **Reads** (each with the `selectIn`/paged pattern from `analyze-workout`, keyed by
  `user_id` — or walking workout → entry → set ids — so no table is cut off at the row cap):
  `profiles` (own row), `user_settings`, `user_body_data`, custom `exercises`
  (`owner_id = me`, **including soft-deleted** — they still name past history),
  `workouts` with their `workout_exercises` and `sets` nested, `personal_records`,
  `workout_analyses`, and `posts` the user authored (rows only: flair, visibility,
  `image_path`, `workout_id`, `shared_post_id` — no photo binaries).
- **Shape:** one JSON document
  `{ format: 'astra-export', version: 1, exportedAt, user: { id, email }, profile, settings,
  bodyData, customExercises, workouts: [ { …, exercises: [ { …, sets: [...] } ] } ],
  personalRecords, analyses, posts }`. Exercise names for library movements ride along as a
  small `exerciseNames` id→name map (same trick as the analysis function), and a `flairs`
  id→name map does the same for post flairs, so the document is
  readable without the app. Weights stay in kg as stored, flagged by a top-level
  `units: 'kg'` note — an export is data, not display.
- **Readings (recorded):** the export is *the user's own rows only* (RLS-enforced). Included
  beyond strict training data: profile, settings, body data and authored post rows — all
  user-owned, all gone on deletion, so this is their last chance to keep them. Excluded:
  follows/blocks/mutes (social graph, not training data), votes and comments (social; not even
  fully readable under RLS once a post hides), reports (moderation records; no self-select),
  photo binaries (JSON export; the paths are included). For Tristen's product-reading list.
- **Answers:** 200 with the document; 401 without a valid login; 405 non-POST; 500 on a read
  failure (retryable). No inputs beyond the token, so no 400s.

### 2. `delete-account` edge function (service role, self-service)

`backend/supabase/functions/delete-account/{index.ts,handler.ts}` + `tests/delete_account.test.ts`,
`verify_jwt = true`.

- **POST `{ confirm: 'DELETE' }`.** The body must carry the literal confirmation (400
  otherwise) — a server-side belt to the client's typed gate, so no stray `invoke` can delete
  an account.
- **The target is always the caller.** The request names no user id at all — the only account
  this function can delete is the one the verified token belongs to. Service role is used for
  the sweep and the auth delete only, after the caller is identified.
- **Moderator guard kept:** if the caller is in `moderators`, answer 409 (the `moderate`
  reading — the founder removes themself from `moderators` first if they ever mean it).
- **Order — sweep first, then delete:**
  1. list + remove everything under `<user_id>/` in `post-images` and `avatars`
     (reuse the `moderate` sweep shape);
  2. `auth.admin.deleteUser(user_id)` — cascades through `profiles` to every row (verified
     above).
  Sweep-before-delete (the handoff's order, and deliberately not `moderate`'s) because a
  failure must leave the account intact and the flow retryable: once the auth user is gone the
  caller's token stops verifying, so a delete-then-failed-sweep could never be retried by the
  user and would strand orphan objects. Any failure → 500, nothing half-deleted that matters
  (a swept-but-live account just re-sweeps nothing on retry).
- **Answers:** 200 `{ deleted: { userId, filesRemoved } }`; 400 bad/missing confirmation; 401;
  405; 409 moderator; 500 retryable.

### 3. Settings → Export your data (app)

`frontend/src/account/exportData.ts` (the flow's one home) + a button in the Account card of
`settings.tsx`.

- Button **Export your data** → `functions.invoke('export-data')` → write the JSON to
  `cacheDirectory/astra-export-<yyyy-mm-dd>.json` (`expo-file-system/legacy`, the B22 pattern)
  → `Sharing.shareAsync(uri, { mimeType: 'application/json' })` (the B28 pattern). Busy state
  on the button; calm error line on failure. After the share sheet resolves (shared or
  cancelled), delete the cache file best-effort — the document holds body data, and the
  privacy posture says it shouldn't linger where nothing will ever read it again.
- **Offline:** the server read needs a connection; a failed invoke shows "Exporting needs a
  connection. Try again when you're online." (checked by attempt, not by a pre-flight — the
  invoke's failure is the truth; same wording style as the feed's offline line).
- **Honest about sync lag:** the export is the server's copy. The screen's small print says
  "Includes everything that has synced to your account." A workout logged offline moments ago
  is on the phone, not yet in the export — the sync engine uploads on reconnect as always, and
  the user can simply export again. No forced pre-export sync (the engine already syncs on
  connect; duplicating that trigger here would be a second code path for nothing).

### 4. Settings → Delete account (app)

`frontend/src/app/delete-account.tsx` (danger flow gets its own screen; its test in
`frontend/src/__tests__/delete-account.test.tsx` per the route-test rule) +
`frontend/src/account/deleteAccount.ts` + a red **Delete account** entry in Settings' Account
card.

- The screen names the signed-in email (so there is no doubt *which* account dies), states
  plainly what goes (account, workouts, PRs, posts, photos — everything, forever) and suggests
  exporting first (link back to the export button's card). The user **types DELETE** to enable
  the red button — the typed gate the handoff asks for.
- Button → `functions.invoke('delete-account', { body: { confirm: 'DELETE' } })`. Offline or
  failed → calm error, nothing changes (the function is atomic-enough per the order above;
  retry is safe). The screen never deletes anything device-side before the server's 200.
- **On 200, wipe the device:** new `frontend/src/db/wipeDevice.ts` (named export
  `wipeDeviceData`):
  1. `signOut({ scope: 'local' })` first — drops the dead session and flips the root guard;
  2. close the app database handle and delete `astra.db` (add `closeAppDatabase()` to
     `db/database.ts` that closes the cached driver and clears the singleton;
     `SQLite.deleteDatabaseAsync(DATABASE_NAME)`);
  3. clear `expo-sqlite/kv-store` (session already gone; this clears plate rack, feed prefs,
     own-profile cache);
  4. delete the `documents/post-images/` waiting folder.
  Every step wrapped so a failure logs and continues — the account is already gone; the wipe
  must be best-effort, not a wall between the user and the sign-in screen. (This also covers
  the B07 "account switch leaves old rows" hazard for the delete path specifically.)
- An in-progress active workout is simply wiped with the rest — the screen's warning covers it.

### 5. Tests

- **Backend (fakes, never the real project):** `export_data.test.ts` — document shape, every
  table present, nesting correct, paging exercised (a >1-page fake), soft-deleted customs
  included, caller-only (the fake asserts reads filter by the caller). `delete_account.test.ts`
  — confirmation gate (400), moderator 409, sweep-before-delete order, both buckets swept,
  auth delete called with the caller's id, failure → 500 with the account untouched,
  retry-after-partial-sweep succeeds.
- **Frontend (Jest + RNTL):** export flow (invoke → file write → share, mocked expo modules;
  offline failure message), delete screen (button disabled until DELETE typed; success calls
  the function then `wipeDeviceData`; failure wipes nothing), `wipeDeviceData` unit test
  (order, best-effort on step failure), `closeAppDatabase` behaviour, settings.tsx additions.

### 6. Documentation

Plain-language comments on both handlers, the two flows and the wipe helper (the Documentation
rules bite hardest on deletion code). `docs/diagrams/app-flow.md`: Settings → Export (function
→ share sheet) and Settings → Delete account (typed gate → function → wipe → sign-in) paths,
plus the two function nodes. ERD: untouched (no schema change). `config.toml`: two
`verify_jwt = true` blocks.

## How the DoDs become observably true

- **"Export produces the user's complete training data" / "every workout, set and PR":** the
  backend test seeds a fake with N workouts/entries/sets/PRs (across page boundaries) and
  asserts the document carries exactly all of them. Gate 2: call `export-data` over HTTP with a
  seeded throwaway user's token and diff the counts against SQL counts.
- **"Deletion removes account and content — the schema cascades (verified)":** the cascade
  graph above is the verification, done live this session. Gate 2 probe (the handoff's): create
  a throwaway auth user by SQL insert (the B05 precedent — signup email validation rejects
  MX-less domains), **with `email_confirmed_at = now()` and
  `encrypted_password = crypt('<pw>', gen_salt('bf'))` set in the insert**, so the password
  grant hands back a real JWT even though email confirmation is ON in the live project (the
  probe needs the throwaway's own token to call the functions). Seed a row in **every**
  user-owned table plus one object in each bucket, call `delete-account` with its token, then `select count(*)` per table filtered to that user
  and list both bucket folders → all zero, and `auth.users` no longer has the row.
- **"After deletion nothing of the user remains":** same probe; plus the device wipe tests.

## Out of scope

- **Email change and password reset** (DEFERRED notes them near NFR-6) — not in this step's
  scope line; password reset already earmarked as its own small step. They stay in DEFERRED.
- Export of photo binaries (paths only), scheduled/emailed exports, CSV or other formats.
- A grace period / soft account deletion ("undo within 30 days") — the PRD asks for deletion,
  not suspension; add only on a product call.
- Votes, comments, follows, blocks, mutes, reports in the export (reading recorded above).
- Cancelling a booked rest-timer notification on delete (B17 already leaves it on sign-out;
  the booked alert fires once and references nothing).
- Wiping local data on *account switch* (B07 deferred item) — only the delete path wipes here.

## Risks

1. **The export's completeness depends on RLS, not on code review alone.** Mitigation: the
   caller-token-only rule (no service role in `export-data`), plus the Gate 2 live diff of
   export counts vs SQL counts for a seeded user.
2. **A huge history vs function limits.** Paged reads keep queries safe; the response is one
   JSON body. At launch scale (hundreds of workouts, thousands of sets) this is well under
   edge-function response limits; revisit with streaming/Storage-upload export only on
   evidence (Add-nothing-speculative).
3. **Token validity mid-delete.** The caller's JWT is verified before the sweep; the auth
   delete is last, so no step runs with a dead caller. The app treats only a 200 as deleted.
4. **Partial wipe on device** (step 2–4 failing) leaves stray local data on a signed-out
   phone. Best-effort by design; the data is unreadable in-app (every query filters by the
   signed-in user) and the next sign-in of any account gets a fresh or migrated database.
5. **The deleted user's other devices** keep their local mirror and will 401 on every sync
   forever (their sessions were cascaded away). That is the known B07 "account switch" class —
   stray local rows on a phone the account left — and is accepted here the same way; the wipe
   runs only on the device that asked for the deletion.

## Settled by grilling (Nov 15, 2026)

- **Why an edge function for export at all** (vs the app reading PostgREST itself): the step's
  scope mandates it, and it is also the right call — the server is the system of record, the
  device mirror lacks profile/body-data/votes tables entirely, and one server-side document
  keeps the export's shape independent of app versions. Recorded, not just inherited.
- **Sweep-before-delete order** (vs `moderate`'s delete-first): settled by the retryability
  argument above; `moderate` keeps its own order because its caller (a moderator) survives the
  target's deletion and can always retry — this function's caller does not.
- **No pre-flight network check for either flow:** the invoke's own failure is the offline
  signal; a pre-flight `expo-network` read would be a second source of truth that can disagree
  (the handoff's "refused offline" is satisfied — an offline delete refuses itself and changes
  nothing).
- **`confirm: 'DELETE'` in the body** (vs token-only): one line of server-side insurance that a
  bug can't delete an account by calling the wrong function name. Kept.
- **Moderator 409 kept for self-service delete:** consistency with `moderate`, founder-typo
  protection; removing oneself from `moderators` is the deliberate extra step.
- **Email in the export:** yes — it's the user's own address delivered to themselves.
- **`auth.scim_users` NO ACTION FK:** checked — table unused (no SSO/SCIM on this project);
  cannot block the delete. If Supabase ever auto-populates it, the delete would 500 loudly and
  the probe would catch it.
- **Not reusing `moderate`'s `remove-account` for self-service:** it is moderator-gated and
  409s on self-delete by design; folding a self-service arm into the founder's removal tool
  would mix two authorization models in one function. Two functions, one model each.
- **The storage sweep is a second copy** (~10 lines against injected deps, mirroring
  `moderate`'s): extracting it to `_shared/` would mean redeploying the probed B27 function
  for no behaviour change. Kept as a copy with a comment; merge when a third appears (the
  repo's standing convention).
- **Flairs map in the export** and **best-effort delete of the export's cache file** after the
  share sheet: both added by the grilling (readability without the app; body data shouldn't
  linger in cache).
- **The delete screen names the signed-in email**, so the typed gate confirms *which* account.

## Build notes and deviations (builder, Nov 15, 2026)

- **Paging moved into the export handler.** The plan put `selectIn`-style paging in the wiring;
  the handler now owns paging (500-row pages) and id-chunking (100 ids) over a one-page
  `readPage` dependency, so the Jest fake — which caps replies at 1000 rows like the API — proves
  nothing is cut off (1,260 sets / 600 PRs across pages and chunks). `index.ts` is one request
  per call. Every owner read is filtered by the caller's id on top of RLS: RLS alone lets a
  lifter read other people's *public* workouts.
- **`account/functionCalls.ts` added** (not in the plan): `callFunction` sorts an invoke result
  into ok / offline (`FunctionsFetchError` or a throw) / failed-with-status, shared by the export
  and delete flows. The delete flow maps 409 to "A moderator account can't be deleted here."
- **`closeAppDatabase()` became `deleteAppDatabase()`, on a testable holder.** Review found that
  `useSync` opens the database even when signed out, so the sign-out (wipe step 1) can make it
  ask for `astra.db` between the close and the file delete. `db/database.ts` now builds its
  singleton with `createDatabaseHolder(opener)`; `close(afterClose)` runs "delete the file" after
  closing and makes any `open()` asked for meanwhile wait, then open a fresh empty database. The
  wipe's close + delete are therefore one step. `SqlDriver` gained an optional `closeAsync`
  (queued behind pending work in `createSerializedDriver`); `expoDriver.ts` gained
  `deleteExpoDatabase`. (Dynamic `import()` doesn't run under this Jest, which is also why the
  holder is a factory.)
- **Sign-out failure is detected.** `AuthProvider.signOut` reports `{ ok: false }` instead of
  throwing; `wipeDeviceData` now treats that as a failed step and returns `{ signedOut }`. If the
  server deleted the account but the phone couldn't sign out, the screen says "Your account was
  deleted. Close Astra and open it again." and stays locked.
- **Export checks `Sharing.isAvailableAsync` first** (a local capability check, not a network
  pre-flight) and says "This phone can't share files from Astra." instead of calling the server.
- **UI:** Export and Delete sit in the Account card (outline buttons — the outline variant is the
  brand-red border; the screen's Delete my account is the solid-red primary). The delete screen's
  "link back" is an **Export your data first** button that returns to Settings.
- **`social/postImages.ts` exports `localPostImagesFolder`** so the wipe reuses the one path.
- **500 wording** of `delete-account` says "It is still here — try again" (a partial sweep may
  have removed photos, so "nothing was lost" was untrue); redeployed as v2.
- **Deployed:** `export-data` v1 and `delete-account` v2, both `verify_jwt: true`, via the
  Supabase MCP (comments trimmed in the deployed copies; the repo files are the source of record).
- **Live verification done by the builder:** a rolled-back SQL transaction with two throwaway
  users and a row in every user-owned table (profiles, settings, body data, custom exercise,
  workout, entry, set, PR, analysis, post, the other user's re-share, votes, comments both ways,
  mute, block, report, tombstone): after `delete from auth.users` every count is 0 and the other
  user's profile remains. Not done: the HTTP probe (outbound `curl` declined) — in DEFERRED for
  Gate 2. No migration; the ERD is unchanged.
- **Review (two-axis, `mattpocock-skills:code-review`):** fixed the two real bugs above, the
  placement, the export link, the duplicated folder path and the 500 wording; left as judgement
  calls (recorded in DEFERRED): the four-way duplication of the functions' HTTP helpers, the
  repeated ok-or-message result type, `CONFIRMATION_WORD` defined on both sides (the app would
  otherwise import from the backend handler), and the optional `closeAsync`.
