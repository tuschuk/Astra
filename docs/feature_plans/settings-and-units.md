# settings-and-units — B15: Settings screen and the kg/lb toggle (LOG-6, YOU-4 part)

**Branch:** `settings-and-units` (from `main`)
**Build step:** B15 — covers LOG-6 (whole: switching units converts display everywhere without
corrupting stored data; the conversion math and kg storage already shipped in B06/B07, the toggle
is this step) and YOU-4 (partial: the Units and Account areas of Settings; Notifications is B47,
Privacy is B26).
**Depends on:** B09 (`frontend/src/settings/displayUnit.ts` — the one seam every weight display
and parse already goes through), and through it B08/B07 (store + device SQLite + sync) and B06
(`@training-math` — `displayWeight`, `lbToKg`, `WeightUnit`).

## Step definition of done (from the Build order)

Switching units converts every displayed weight without changing a stored kg value.

## Scope check

The step scope matches the Covers list; nothing to widen or narrow. One reading settled here:
"account section (email, sign out)" **moves** the sign-out button and signed-in email that have
sat on the You tab since FND-2 into the Settings screen — it does not duplicate them. The You tab
gains the profile's settings (gear) button that opens the screen; one home for sign-out, as
YOU-4 wants it. Email **change** stays deferred (NFR-6, per DEFERRED); the account section shows
the email and signs out, nothing more.

## What exists already (why this step is small)

- Server: `user_settings` (B02, `…_identity.sql`) — `user_id` PK → profiles, `unit text not null
  default 'lb' check in ('kg','lb')`, `default_workout_visibility`, `updated_at` with a
  `moddatetime` trigger. RLS: owner **select** and **update** only — no client insert; the row is
  created by the signup trigger in the same transaction as the account. No server migration
  needed.
- Math: `@training-math/units` — exact `lbToKg` on entry, `displayWeight(kg, unit)` on display.
  Storage is always kg, rounded only by B08's storage rounding. **A unit switch therefore never
  rewrites a stored value by construction**; this step adds no math anywhere.
- Seam: `useDisplayUnit()` is already called by all four weight-showing screens (logger, saved
  workout, edit workout, exercise history), which pass `unit` down to every component. Rewiring
  the hook converts the whole app.

## Approach

`user_settings` does **not** join the five-table generic mirror. That machinery is keyed on an
`id` column end to end (outbox `row_id` semantics are fine, but `upsertSql` conflicts on `id`,
`getRowsByIds` selects by `id`, pull cursors order by `(updated_at, id)`, and the transport's
`upsert` needs insert permission that `user_settings`' RLS deliberately withholds). Forcing a
`user_id`-keyed, update-only, one-row-per-user table through it means special cases in every
layer. Instead: a **mirrored one-row table with its own tiny sync phases**, riding the existing
engine, outbox and triggers.

### 1. Device schema V6 (`frontend/src/db/schema.ts`)

```sql
create table user_settings (
  user_id    text primary key not null,
  unit       text not null,
  updated_at text not null
);
```

Only the columns this step syncs. `default_workout_visibility` is deliberately left out — B26
adds it (device migration + its own write path) when something reads it; mirroring it now would
be a column no code touches and a stale-clobber risk once B26 syncs it. No CHECKs, like the rest
of the mirror (the server enforces them). Column names match the server's, so a row is a straight
copy.

### 2. The row module and the unit store

**`frontend/src/db/userSettings.ts` (new, db layer):** owns the row shape and its SQL —
`UserSettingsRow { user_id, unit, updated_at }`, `readUserSettingsRow(db, userId)`,
`writeUserSettingsRowTx(tx, row)` (plain three-column upsert on the `user_id` key). Both
`settings/` and `sync/` import from here, so the dependency arrows stay
UI → settings → db ← sync — the sync layer never imports from `settings/` (settled in grilling
Q3; the first draft had push.ts reading the unit out of the store).

**`frontend/src/settings/unitStore.ts` (new):** one module owns the signed-in user's unit as an
in-memory snapshot over the SQLite row, with `subscribe`/`getSnapshot` for React (the B08/B09
`useSyncExternalStore` pattern).

- `hydrate(db, userId)` — reads the local row once per signed-in user (no row → the server
  default `'lb'`, matching the column default); idempotent per user; hydrating a different user
  replaces the snapshot wholesale (the account-change story). Called from `useSync` (§5).
- `setUnit(db, userId, unit)` — the toggle's write path. In **one transaction**: write the local
  row (`updated_at` stamped now, via `writeUserSettingsRowTx`) and
  `enqueueTx(tx, 'user_settings', userId, now)` — the outbox line's `row_id` is the `user_id`,
  the row's real key. Then update the snapshot, notify React subscribers, and
  `notifyLocalWrite(db, ['user_settings'])` so the engine's debounced push runs. Offline-first
  falls out: the row and the outbox line are on disk before anything touches the network, and
  the engine's reconnect trigger sends it later.
- `applyPulled(row)` — called (via the engine callback, §4) when a sync downloads the settings
  row. **Ignores a row whose `user_id` is not the hydrated user's** — an account switch mid-sync
  must never stamp the new user's snapshot with the old user's unit (grilling Q5); pinned by a
  test.

`displayUnit.ts` is rewired as B09 designed: `useDisplayUnit()` becomes
`useSyncExternalStore(unitStore.subscribe, unitStore.getSnapshot)` — still no arguments, so **no
caller changes**. `DEFAULT_DISPLAY_UNIT` stays the documented server default and the snapshot's
pre-hydration value.

### 3. Outbox typing widens, behavior doesn't

`outbox.ts`'s functions currently take `tbl: SyncedTable`. A new exported union
`OutboxTable = SyncedTable | 'user_settings'` widens `enqueueTx`, `pendingRows`, `acknowledge`,
`rowsWithPendingChanges`, `dropLinesTx` and `notifyLocalWrite`/`LocalWriteListener`'s parameter
types. The outbox *table* already stores `tbl` as text — no device migration, no behavior change,
and the watermark semantics come free: a toggle flipped while a push is in flight queues a newer
line the acknowledgement doesn't clear, exactly like any other edit.

### 4. Sync: one push phase, one pull phase

`SyncTransport` gains two operations (both implemented in `supabaseTransport.ts` and the test
fake):

- `pullUserSettings(userId): Promise<UserSettingsRow | null>` —
  `select user_id, unit, updated_at … eq user_id … maybeSingle()`. One row; **no cursor, no
  paging, no tombstones** — it can't be deleted while the account exists, and re-reading one row
  per sync costs nothing. (This is why none of the bookmark machinery is borrowed.)
- `pushUserSettings(userId, unit): Promise<void>` — an **`update`** (never upsert — RLS allows no
  insert, and the signup trigger guarantees the row exists) of `{ unit }` by `user_id`, without
  `updated_at` (the server's `moddatetime` stamps it, same rule as every push). RLS scopes the
  update: a *previous* account's leftover pending line updates zero rows, succeeds, and is
  cleared — a stale line can't wedge the queue (the B07 account-switch caveat applies no worse
  here than anywhere else).

`push.ts`: after the five table passes, a settings phase — read
`pendingRows(db, 'user_settings')`, and for each (in practice one) read the local row with
`readUserSettingsRow` (db layer, §2) and call `transport.pushUserSettings(rowId, row.unit)`,
then `acknowledge` up to the watermark. A pending line whose local row is gone uploads nothing
and is cleared, like any other. Count it in `PushResult` as `userSettings`.

`pull.ts`: a settings pass inside `pullChanges` — fetch the row, and inside a transaction apply
it **unless the row has a pending outbox change** (`rowsWithPendingChanges` — the same
edit-wins-until-pushed rule as `applyRows`). Count in `PullResult`.

**Surfacing a pulled change to React without coupling sync → settings:** `SyncEngineOptions`
gains an optional `onUserSettingsPulled?: (row: UserSettingsRow) => void`, threaded into
`pullChanges`. `useSync` passes the unit store's updater. The sync layer keeps importing only
from `db/`; the dependency arrow stays UI → both.

### 5. Root wiring (`useSync.ts` / `_layout.tsx`)

`useSync` already opens the database per signed-in user; it additionally calls
`unitStore.hydrate(db, userId)` before starting the engine (via a new `SyncDeps`-injectable so
tests keep their fakes), and passes `onUserSettingsPulled` into the engine. No new provider, no
new effect in `_layout.tsx`.

### 6. Screens

- **Settings screen** (`frontend/src/app/settings.tsx`, new route in the root stack's signed-in
  `Stack.Protected` guard): two sections.
  - **Units** — a two-option segmented row (kg | lb) built from existing primitives (pressable
    chips in the logger's established style; no new dependency, no new generic component until a
    third segmented control exists). Tapping calls `setUnit`; the highlighted option is the
    snapshot, so the change is visible instantly and every mounted weight re-renders through
    `useDisplayUnit`. The options carry `accessibilityRole`/`accessibilityState.selected` so a
    screen reader announces which unit is active (NFR-10).
  - **Account** — the signed-in email (read-only) and the Sign out button, moved from the You
    tab (same `useAuth().signOut`, same error surface; the root guard still handles navigation).
  - No Notifications or Privacy placeholders: the diagrams rule would mark them scaffolding, and
    a settings row that does nothing is worse than its absence. They arrive with B47/B26.
- **You tab** (`you.tsx`): gains the settings (gear) icon button in the header (the "profile
  button" the scope names) navigating to `/settings`; loses the inline email + Sign out (moved,
  not duplicated). Its top-of-file comment updates to match.
- `_layout.tsx`: one `Stack.Screen name="settings"` line in the signed-in guard.

## Files to create or change

| File | Change |
|---|---|
| `frontend/src/db/schema.ts` (+ test) | V6 migration: local `user_settings` table (§1) |
| `frontend/src/db/userSettings.ts` (+ test) | new — `UserSettingsRow`, read / write-in-transaction helpers (§2) |
| `frontend/src/settings/unitStore.ts` (+ test) | new — snapshot store, `hydrate` / `setUnit` / `applyPulled` (§2) |
| `frontend/src/settings/displayUnit.ts` | rewire `useDisplayUnit` to the store; callers untouched (§2) |
| `frontend/src/sync/outbox.ts` | widen table types to `OutboxTable` (§3) |
| `frontend/src/db/dao.ts` | `notifyLocalWrite` / `LocalWriteListener` take `OutboxTable` (§3) |
| `frontend/src/sync/transport.ts` | `pullUserSettings` / `pushUserSettings` + `UserSettingsRow` (§4) |
| `frontend/src/sync/supabaseTransport.ts` (+ test) | implement both (§4) |
| `frontend/src/sync/push.ts` (+ test) | settings push phase + `PushResult.userSettings` (§4) |
| `frontend/src/sync/pull.ts` (+ test) | settings pull pass + `PullResult.userSettings` + the callback (§4) |
| `frontend/src/sync/engine.ts` (+ test) | `onUserSettingsPulled` option threaded to the pull (§4) |
| `frontend/src/sync/useSync.ts` (+ test) | hydrate the store; pass the callback (§5) |
| `frontend/src/test-utils/fakeTransport.ts` | the two new operations on the fake |
| `frontend/src/app/settings.tsx` | new — the Settings screen (§6) |
| `frontend/src/app/(tabs)/you.tsx` (+ its tests) | gear button; email/sign-out move out (§6) |
| `frontend/src/app/_layout.tsx` | declare the `settings` route |
| `frontend/src/__tests__/settings.test.tsx` | new — route tests (below) |
| `docs/diagrams/app-flow.md` | Document step — You → Settings → toggle/sign-out paths; the settings sync path |
| `docs/diagrams/database-erd.md` | Document step — note `user_settings` now device-mirrored (server ERD unchanged) |
| `docs/BUILD_LIST.md` | untouched — status flips at Gate 2 |

## Data model impact

**No server migration** — table, defaults, RLS and signup trigger shipped with B02. Device:
schema V6 adds the three-column `user_settings` mirror. `.expo/types/router.d.ts` regeneration
applies as always (new `settings` route; builder runs `npx expo start` before `tsc`, per the
established order).

## How each definition of done becomes observably true

- **Step DoD / LOG-6** — `settings.test.tsx` route test: render a screen showing a seeded set
  (e.g. 100 kg shown as "220.5 lb"), flip the toggle, assert the same screen now shows "100 kg"
  **and** the `sets.weight_kg` value in SQLite is byte-identical; flip back and the display
  returns exactly, proving no drift. Unit-store tests pin: `setUnit` writes the row + one outbox
  line in one transaction; hydrate returns `'lb'` with no row; a pulled row updates subscribers;
  a pulled row never overwrites a pending local change; a pulled row for another user is
  ignored. Push/pull tests: offline toggle → reconnect → the fake server's row is updated
  exactly once; a toggle on the fake server lands in the local row and the snapshot via the
  callback. Entry parsing already goes through `lbToKg` (B08/B09) — the flow test flips the unit
  mid-workout and asserts each entry stored **exactly what its unit implies** (`100` typed in kg
  stores `100`; `220.5` typed in lb stores `lbToKg(220.5)`, not 100 — display rounding never
  feeds storage), and that the flip changed no already-stored value.
- **YOU-4 (this step's part)** — the Settings screen exists, reached from the profile's gear
  button; the Units and Account areas take effect immediately (toggle re-renders every mounted
  weight in the same frame via the store; Sign out ends the session as before — asserted in the
  route tests). Notifications and Privacy are recorded as B47/B26's, so YOU-4 stays In progress
  at Gate 2.
- **Synced** — the push/pull tests above, plus the Gate 2 live probe (toggle on device →
  `user_settings.unit` changes in Supabase; edit it in Supabase → next sync shows it on device).

## Out of scope (this branch)

- Notifications and Privacy sections (B47, B26) — not even placeholders.
- `default_workout_visibility` mirroring (B26).
- Email change, password reset, account deletion (NFR-6 — already in DEFERRED).
- Any new weight math — `@training-math` already has everything; this step adds zero conversion
  code.
- Per-exercise or per-set unit overrides; a kg/lb choice on the plate calculator (B16 reads the
  same `useDisplayUnit`).
- Profile editing (YOU-1/B25) — the You tab only gains the gear button.

## Risks a reviewer should weigh

1. **The update-only push.** `pushUserSettings` is an `update … eq user_id` with no insert
   fallback. It relies on the signup trigger having created the row — true for every account this
   schema has ever made. A zero-row update (possible only for a previous account's leftover line
   under the current session's RLS) is treated as success and cleared; that is deliberate
   (anti-wedge, matching B07's account-switch stance) and is pinned by a test so the behavior is
   chosen, not accidental.
2. **Pre-hydration flash.** Between app launch and the one-row SQLite read, `useDisplayUnit`
   returns `'lb'`. For a kg user this could flash converted numbers for a frame or two on a cold
   start. Hydration starts in `useSync` before the engine and is one indexed read; accepted
   rather than blocking render on it. If it is ever visible on a device, gate the splash on
   hydration (one `await` in the existing ready path) — noted, not built.
3. **The one-row pull has no cursor — correctness rests on the pending-change guard.** The pull
   always fetches the row and applies it only when no outbox line is pending. The race "toggle
   locally while the pull's transaction is open" is the same one `applyRows` already carries for
   every table, and the same test pattern covers it. Reviewers should check the settings pass
   runs inside a transaction with the pending check, not before it.

## Grilling decisions (settled before code)

Run via `mattpocock-skills:grilling`; headless pipeline run, so the planner played both sides at
full severity (B08/B09 precedent). What changed or was pinned:

- **"Why mirror at all — why not write Supabase directly and cache in memory?"** Because the DoD
  says synced *and* CLAUDE.md says offline-first: a toggle flipped in airplane mode must survive
  an app kill and land on the server later. That is a durable local row plus a queued upload —
  the outbox, by definition. A hand-rolled dirty flag in `sync_state` would re-implement the
  outbox's watermark badly (a toggle during an in-flight push would be lost).
- **"Why not make it the sixth SyncedTable?"** Drafted that way first; rejected above (§Approach)
  — the generic machinery is `id`-keyed and insert-based at every layer; `user_settings` is
  `user_id`-keyed and update-only by deliberate RLS. Five special cases beat one honest module.
- **"Is widening the outbox types scope creep?"** No runtime change — the column is already
  text. The alternative (a second queue table for settings) duplicates machinery the step
  explicitly exists to reuse.
- **"Settings in `sync_state`?"** No — `sync_state` is sync bookkeeping; a user preference keyed
  by user, synced to a server table of the same name, belongs in a mirror table following the
  repo's straight-copy convention.
- **"Conflict story when two devices toggle offline?"** Last write to reach the server wins
  (server `updated_at` is its clock; the pull's pending-change guard protects an unsent local
  toggle). For a two-value preference, converging on *either* device's choice is correct; no
  per-column merge is built.
- **"Who owns the local row's SQL — doesn't push.ts reading the unit out of the store invert
  your dependency story?"** It did, in the first draft. Fixed by `db/userSettings.ts` (§2): the
  row shape and its read/write SQL live in the db layer, imported by both `settings/` and
  `sync/`. The sync layer never imports from `settings/`.
- **"Your flow test was wrong: `lbToKg(220.5) ≠ 100`."** Caught — 220.5 is a *rounded display*
  value, so "stores the same kg" was unassertable as written. The test now pins the honest
  property: each entry stores exactly what its unit implies, and a flip changes no stored value.
- **"A pulled settings row during an account switch?"** `applyPulled` ignores a row whose
  `user_id` isn't the hydrated user's — one guard, pinned by a test, so a stopping engine's last
  pull can never stamp the new user's snapshot with the old user's unit.
- **"Does the toggle rewrite stored weights?"** It can't touch them: `setUnit` writes one row in
  `user_settings` and nothing else; conversion happens in `displayWeight` at render. The DoD test
  asserts byte-identical `weight_kg` anyway, so the property is pinned, not just argued.
- **"Screen-reader story for the toggle?"** (NFR-10 is standing.) The two options carry
  `accessibilityRole`/`accessibilityState.selected`; one line in §6 so the builder can't miss it.
- **"Why move sign-out off the You tab instead of leaving both?"** Two sign-out buttons two taps
  apart is clutter now and a divergence risk later (error handling in two places). YOU-4 names
  Settings as account's home. The You tab comment and tests move with it.
- **"Placeholder rows for Notifications/Privacy?"** Rejected — dead settings erode trust, and the
  living-diagrams rule would brand them scaffolding. B47/B26 add their sections when they work.
- **"Does the active workout's entry row handle a mid-workout flip?"** Yes by construction: the
  input row parses with the unit at submit time (`{ value, unit }` into the store, exact
  `lbToKg`), and the displayed history re-renders from kg. A test flips the unit mid-logging and
  asserts both entries stored exactly.
- **"Expo typed-routes staleness again?"** Known, recurring (B06–B14): the builder regenerates
  with `npx expo start` (~150 s) before `tsc`, and Gate 2 re-runs the same order cold.
