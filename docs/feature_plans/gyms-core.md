# gyms-core — B50: Gyms core (directory, join/switch, Gym feed, profile line)

**Branch:** `gyms-core` (from `main`)
**Build step:** B50 — covers **GYM-1** (part: the distance-sorted directory; the real Denver
import is B51, Blocked on the data source), **GYM-2** (join any Gym, no proof of membership, one
active Gym, Gym feed reachable from Home), **GYM-7** (community-run pages, no claim/manage flow),
the Gym half of **SOC-10** (Gym feed surfaced on Home) and the Gym half of **YOU-6** (profile
shows the user's Gym).
**Depends on:** B36 (the Team feed pattern this step mirrors: `loadFeedPage` with a roster-derived
author list, the group page shape, Home's chip row, the profile's group section).

## Step definition of done (from the Build order)

PostGIS `gyms` table and `gym_members` (one active per user) with RLS; distance-sorted directory
from the user's location, seeded with a small fixture until B51; join and switch; Gym feed from
Home; Gym on the profile; no claim or manage flow anywhere. **Joining a second Gym switches the
active one and the feed works like a Team feed.**

## Scope readings settled up front

- **Gyms are not Teams with coordinates.** No join modes, no roles, no invites, no owner —
  PRD: anyone can join any Gym, pages are community-run, owners cannot claim or manage them
  (GYM-7). The enforcement of GYM-7 is structural: **no insert/update/delete policy exists on
  `gyms` for any user**, so there is nothing to claim and no path to manage. The app ships no
  admin UI because there is no admin concept.
- **One active Gym per user is the primary key.** `gym_members.user_id` is the primary key, so a
  second membership row cannot exist. Join = upsert on `user_id`; switch = the same upsert
  (the new `gym_id` replaces the old); leave = delete. The DoD's "joining a second Gym switches
  the active one" is a property of the schema, not of client logic.
- **The Gym feed widens nothing** (the B36 G5 reading, re-used verbatim): it is the ordinary
  `loadFeedPage` read narrowed to the Gym's member ids. `private.workout_visible` and the posts
  policies are untouched; joining a Gym never changes who may see a post. A member's
  followers-only post shows in the Gym feed only to members who follow them.
- **Gyms are server-authoritative and online-only** (the B36/B23 precedent): directory, join,
  switch, feed and profile line all need a connection and degrade to the standard "needs a
  connection" message. No device tables, no outbox, no device-schema bump, no `SYNC_ORDER`
  change. The offline-first rule governs logging and the Tool Kit, which don't change.
- **Membership is public.** `gym_members` is readable by any signed-in user (recorded per the
  handoff's "the planner records which"). Reasons: YOU-6 shows the Gym on *every* profile to any
  viewer, the gym page's roster and feed need member ids for any visitor (a join-decision aid,
  like an open team's public roster — and every Gym is "open"), and B52's leaderboards are public
  by nature. Joining a Gym is therefore a public act and the gym page makes that visible. What
  stays protected is unchanged: posts RLS still decides which of a member's posts a viewer sees.
- **The user's location is sensitive and never stored.** `expo-location` (an Expo SDK module,
  free — the step's one new dependency) asks for **foreground** permission only when the lifter
  opens the directory (the B47 "never on launch" posture). The coordinates travel only as
  parameters of the `gyms_near` RPC and are kept in screen state; no row, no column, no log on
  our side persists them. Denied or unavailable → the directory sorts from downtown Denver
  (39.7392, −104.9903) and says so in one line; the distance sort stays observable either way.
- **The fixture is fictional.** The seed is ~6 Denver-area gyms with real-looking coordinates but
  **invented names** (no real business's name or brand), each row commented `FIXTURE — replaced
  by B51` in the migration. B51 replaces the set wholesale when Tristen picks the data source.

## Data model (one migration: `postgis` + `gyms` + `gym_members` + `gyms_near`)

### PostGIS

```sql
create extension if not exists postgis with schema extensions;
```

Available on the live project (3.3.7), not yet installed; free. Installed into `extensions`
(Supabase's convention), so every PostGIS name below is schema-qualified — the repo's standing
`set search_path = ''` discipline makes bare names fail anyway.

### `gyms`

```sql
create table public.gyms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  address    text not null check (char_length(address) between 1 and 200),
  location   extensions.geography(point, 4326) not null,
  created_at timestamptz not null default now()
);
create index gyms_location_idx on public.gyms using gist (location);
```

RLS on. Policies: **select to authenticated using (true)** — and nothing else. No insert, update
or delete policy for any user; rows are written only by migrations (service role). Belt and
braces for GYM-7: `revoke insert, update, delete on public.gyms from authenticated, anon;`
(the B36 deviation's lesson: table grants, not column revokes). No `created_by`, no owner, no
join mode — a Gym is a place, not a group anyone administers.

The seed block inserts the fixture rows (fictional names, real Denver-area coordinates via
`extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography`) in the
same migration, clearly commented as fixture data B51 replaces.

### `gym_members`

```sql
create table public.gym_members (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  gym_id    uuid not null references public.gyms (id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index gym_members_gym_idx on public.gym_members (gym_id);
```

Policies:

```sql
select: to authenticated using (true)                 -- public membership (scope reading above)
insert: with check (user_id = (select auth.uid()))    -- join
update: using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()))    -- switch (the upsert's conflict arm)
delete: using (user_id = (select auth.uid()))         -- leave
```

A tiny `before update` trigger resets `joined_at = now()` when `gym_id` changes, so "member
since" is honest after a switch (the client never writes timestamps — the B48 server-time
posture). And the posture is enforced, not polite (settled under grilling, G9): the migration
revokes table-level INSERT/UPDATE on `gym_members` from `authenticated, anon` and grants back
only `insert (user_id, gym_id)` and `update (user_id, gym_id)` — the B36 deviation's table-revoke +
column-grant pattern (a bare column revoke is a no-op) — so `joined_at` has exactly one writer:
the default and the trigger. **`user_id` must be in the UPDATE grant** (Gate 1 fix): PostgREST
builds an upsert as `on conflict (user_id) do update set <every payload column> = excluded.<col>`,
so the switch arm rewrites `user_id` to itself; with `update (gym_id)` alone every switch would
fail with 42501. Rewriting `user_id` to itself is harmless, and the update policy's `with check
(user_id = auth.uid())` still forbids pointing the row at anyone else. `on delete cascade` from `profiles` keeps B32's account deletion complete; cascade
from `gyms` means a B51 re-seed that deletes fixture rows also drops fixture memberships
(acceptable: fixture members are test users; recorded for B51's plan).

B52 note (from the PRD: "verified PRs stay on the old Gym's board when a member switches"):
leaderboard submissions will be their own table keyed by `gym_id` + `user_id`, so switching —
which only rewrites this one row — strands nothing. B50 just avoids any design that would make
membership history load-bearing.

### `gyms_near` — the distance sort (the one RPC)

PostgREST cannot order by a computed distance, so the directory read is a database function:

```sql
create or replace function public.gyms_near(lat double precision, lng double precision, max_rows integer default 50)
returns table (id uuid, name text, address text, distance_m double precision)
language sql stable security invoker
set search_path = ''
as $$
  select g.id, g.name, g.address,
         extensions.st_distance(
           g.location,
           extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
         ) as distance_m
  from public.gyms g
  order by distance_m asc
  limit least(greatest(max_rows, 1), 100);
$$;
revoke execute on function public.gyms_near from public, anon;
grant execute on function public.gyms_near to authenticated;
```

`security invoker`: the function runs under the caller's RLS (gyms are readable by every
signed-in user, so invoker works and is the least-privilege choice — no definer needed, no
secrets). Geography distance is metres by definition. **`st_makepoint` takes (lng, lat) — x
first** — the classic inversion bug; a probe step and a unit test on the client formatter pin
the ordering against the fixture's known geography (see the probe list). No radius filter: the
launch dataset is Denver-only by construction (GYM-1's 50-mile rule is a property of the B51
import, not of this query), so a traveling user still finds the Denver set rather than an empty
screen.

## Shared limits

`backend/supabase/functions/_shared/training-math/limits.ts` is **not** touched: no user ever
types a gym name or address (rows come from migrations), so there is no client-side validation
to mirror. No training math is involved anywhere in this step.

## App modules and screens

### `frontend/src/social/gyms.ts` (+ `gyms.test.ts`) — the one module that talks Gyms to the server

Injected-client pattern (`teams.ts` / `feed.ts`); RLS decides; refusals map to calm messages:

- `nearbyGyms(client, lat, lng)` — `client.rpc('gyms_near', { lat, lng })`, returns
  `{ id, name, address, distanceM }[]` in server order.
- `gymOf(client, userId)` — the one `gym_members` row for a user with its gym embedded
  (`gym:gyms(id,name,address)`), or null. Serves Home's chip (me), the profile section (anyone),
  and the gym page's "your gym" state.
- `loadGym(client, gymId)` — one gym row (name, address), null when missing.
- `loadGymMembers(client, gymId)` — the roster with profile names (the `MEMBER_SELECT` embed
  shape from `teams.ts`), newest first; also the source of the feed's author ids.
- `joinGym(client, me, gymId)` — **upsert** `{ user_id: me, gym_id: gymId }` with
  `onConflict: 'user_id'` spelled explicitly (G11). Join and switch are the same call; the
  primary key makes a second row impossible. The conflict arm passes the update policy, the
  insert arm the insert policy — both check `user_id = auth.uid()`.
- `leaveGym(client, me)` — delete own row.
- `formatDistance(distanceM)` — metres → "0.8 mi" / "12 mi" (one decimal under 10 miles).
  Miles only at launch (Denver); a kg-units pairing with km is a later product call, recorded.
- `GYMS_OFFLINE` — the standard connection sentence, this module's copy of the B36 pattern.

### Location (inside the directory screen, not a new module)

`expo-location`: on opening the directory, `requestForegroundPermissionsAsync()` →
`getCurrentPositionAsync({ accuracy: Accuracy.Low })` (coarse is plenty for a gym list).
Denied / failed / timed out → `DENVER = { lat: 39.7392, lng: -104.9903 }` and the line
"Showing gyms near downtown Denver — allow location access to sort from where you are."
Coordinates live in screen state only. Jest mocks `expo-location` (the `expo-notifications`
mocking precedent).

### Screens

| Piece | What it does |
|---|---|
| `app/(tabs)/communities.tsx` (edit, Gyms half) | The Gyms card becomes the entry: the viewer's gym as a row ("Your gym" → gym page) when they have one, plus **Find your gym** → `/gyms`. The Teams half is untouched. |
| `app/gyms/index.tsx` (new) | The **directory**: asks for location (fallback above), calls `nearbyGyms`, lists every gym as a row — name, address, "2.3 mi" — sorted by the server; tap → `/gym/[id]`. Offline → the standard message + Retry. |
| `app/gym/[id]/index.tsx` (new) | The **gym page**, modeled on the team page minus everything owner/invite/coach: name, address; **Join this gym** (not a member), **Switch to this gym** behind a one-line confirm naming the current gym (member elsewhere — the confirm is the app's honesty about the one-gym rule, the schema is the enforcement; it lives as `components/gyms/confirmSwitchGym.ts`, the `confirmDeleteTeam` mockable-module precedent), **Leave** (member here); the **Members** list (names → profiles); the **Gym feed** — `loadGymMembers` ids → `loadFeedPage(client, me, ids, 'latest', null, cursor)` with the same `PostCard`s, paging and `usePostListActions` wiring the team page uses. No settings, no claim, no manage — by construction there is nothing to render. |
| `app/(tabs)/index.tsx` (Home, edit) | **SOC-10 Gym half:** the existing chip row gains the gym chip — `gymOf(client, me)` loaded alongside `loadTeamsOf`, one chip with the gym's name → `/gym/[id]`, first in the row; the row's label becomes **"Your groups"** (it now holds both kinds) and renders when the lifter has teams, invites **or a gym**. No gym, no teams → no row, zero cost to the feed. Expected test fallout, not regressions: `home-feed.test.tsx` label assertions and the B49 spoken labels that say "Your teams" update to the new wording. |
| `components/profile/ProfileView.tsx` (edit) | **YOU-6 Gym half:** a **Gym** section beside the Teams section — the shown lifter's gym as one tappable row (name → gym page), read with `gymOf(client, profileId)` (RLS: readable for any profile). No gym → the section is absent, like Teams. |

Route tests in `frontend/src/__tests__/` (expo-router rule): `gyms-directory.test.tsx`,
`gym.test.tsx`; `communities.test.tsx`, `home-feed.test.tsx` / profile tests extended where they
assert the new chip/section. Module tests beside their files.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_gyms.sql` | new — postgis extension, `gyms` + fixture seed, `gym_members`, policies, revokes, `gyms_near`, joined_at trigger, indexes |
| `frontend/package.json` / lockfile | edit — add `expo-location` (the step's one new dependency) |
| `frontend/src/social/gyms.ts` (+ `gyms.test.ts`) | new — every gym read/write + `formatDistance` |
| `frontend/src/app/gyms/index.tsx` | new — the directory (location ask + fallback live here) |
| `frontend/src/app/gym/[id]/index.tsx` | new — gym page + Gym feed |
| `frontend/src/components/gyms/confirmSwitchGym.ts` | new — the switch confirm (mockable-module precedent) |
| `frontend/src/app/(tabs)/communities.tsx` | edit — Gyms half becomes the entry |
| `frontend/src/app/(tabs)/index.tsx` | edit — gym chip in the (renamed) "Your groups" row |
| `frontend/src/components/profile/ProfileView.tsx` (+ tests) | edit — Gym section |
| `frontend/src/__tests__/gyms-directory.test.tsx`, `__tests__/gym.test.tsx` | new — route tests |
| `docs/diagrams/database-erd.md` | edit (Document step) — postgis, two tables, RPC, policies |
| `docs/diagrams/app-flow.md` | edit (Document step) — Communities → Gyms → directory → gym page → feed; Home chip; profile section |

Builder footguns (B09+ precedent): new routes — regenerate typed routes with `npx expo start
--offline` (~150 s) **before** `tsc --noEmit` → lint → Jest. Apply the migration live via MCP,
then rename the file to the version `list_migrations` records. `npm install expo-location` runs
from `frontend/` (`npx expo install expo-location` picks the SDK-matched version). Tests use
hand-rolled fakes — the fake client gains an `rpc` method for `gyms_near` (it only has table
reads today). If the full suite hits the 30 s Jest timeout, rerun with `--maxWorkers=50%`.
SQL footgun (G10): in a `language sql` function with `returns table (id, name, …)`, the output
parameter names are in scope inside the body — an unqualified `name` or `id` is "ambiguous", so
every column stays `g.`-qualified; `order by distance_m` is safe (the select-list alias wins).

## Offline / sync / privacy / rules check

- **Offline-first:** untouched where it applies; Gyms are online-only social surfaces and every
  screen degrades to the standard connection message. Logging and the Tool Kit unaffected.
- **One home:** no training math anywhere in this step; the feed read, post cards and action
  wiring are reused from `feed.ts` / `usePostListActions`, not re-implemented; the membership
  rule lives once, in the `gym_members` schema.
- **RLS, never client-side:** who can read gyms and memberships, and that nobody can write
  `gyms`, are policies (plus grants); the one-active rule is the primary key. The app only
  mirrors them.
- **Privacy:** the user's location is requested late, used once, sent only as RPC parameters,
  never stored; membership is public by recorded decision (above); no progress-pic / body /
  recovery data is touched; the Gym feed re-filters through untouched posts RLS.
- **Nothing speculative:** no maps, no gym search by name, no member counts, no realtime, no Hot
  sort on the Gym feed (Latest only, the Team feed precedent), no radius filter, no membership
  history table. One new dependency, justified and free.
- **No AI, no numeric performance claims, 18+ unaffected.** Fixture names are fictional — no
  real gym's name or brand (CLAUDE.md impersonation rule).

## Migration / Gate 2 probe (the standing recipe, two throwaway users A and B)

1. `gyms_near(39.7392, −104.9903)` returns the full fixture ordered by ascending `distance_m`;
   the nearest row matches the fixture gym placed closest to downtown — and the same call from a
   far point (e.g. 40.0150, −105.2705, Boulder) reorders accordingly. Proves the sort **and**
   the (lng, lat) ordering inside the function.
2. A joins gym 1 → one `gym_members` row. A joins gym 2 → **still one row**, `gym_id` = gym 2,
   `joined_at` moved forward (the switch trigger). The step DoD at the API — **run the switch
   through the REST upsert (`Prefer: resolution=merge-duplicates`, `on_conflict=user_id`) with
   the real JWT, not only SQL**, so the column grant under PostgREST's SET list is what is
   proven. A writing `joined_at` on insert or update → refused (the G9 column grants). A's upsert
   with `user_id` = B → refused (the update policy's `with check`).
3. B reads the gym page's pieces: the `gyms` row, the roster (sees A), A's profile gym line
   (`gym_of` read as B). Feed shape: A's public post returned by the member-id posts query; A's
   followers-only post only when B follows A; a non-member's post never.
4. A inserts / updates / deletes on `gyms` → refused (42501 / permission denied) — GYM-7's "no
   claim or manage path" proven at the API. A inserting a `gym_members` row for B → refused.
5. Anon key alone: `gyms` select and `gyms_near` both refused.
6. A leaves → zero rows. Probe rows rolled back / deleted afterwards.

## How each definition of done becomes observably true

- **Step DoD / GYM-2:** probe step 2 (one row, switched) is the enforcement proof; Jest pins the
  app side — `joinGym` upserts, the gym page offers Switch with the confirm when a member
  elsewhere, the Gym feed renders members' posts through the real `PostCard` (fake client:
  member's post shown, non-member's absent), reachable Home → gym chip → gym page → feed.
- **GYM-1 (this step's part):** the directory screen lists the fixture sorted by server-returned
  distance with the Denver fallback line when permission is denied (route test: fake location
  denied → fallback coords passed to the rpc, line shown; fake granted → user coords passed).
  The Denver-area *completeness* half stays Blocked with B51.
- **GYM-7:** probe step 4, plus the absence check: no route, button or module function writes
  `gyms` — grep-level observable (`from('gyms')` appears only in reads).
- **SOC-10 (Gym half):** Home route test — with a membership, the "Your groups" row shows the
  gym chip; tapping routes to `/gym/[id]`, whose feed is the Team-feed read.
- **YOU-6 (Gym half):** ProfileView test — a lifter with a gym shows the Gym section linking to
  the gym page; without one, no section.

## Out of scope (and where it lands)

- The real Denver gym list (data source, importer, re-seed) — **B51** (Blocked on Tristen's
  choice). The fixture's cascade-on-delete note above is for that plan.
- Leaderboards, PR submissions, video verification, pending-submission feed rows — **B52 / B53**.
- Gym search by name, member counts on directory rows, maps or a map view (ARCHITECTURE.md:
  "gyms render as a distance-sorted list, no maps"), km display for kg users, realtime, Hot
  sort / flair filter on the Gym feed — later, on evidence or product call.
- Any claim / verify / manage / edit flow for gyms — **never** (GYM-7); corrections to gym data
  happen by migration (B51's importer is the steward).
- Notifying anyone on join; gym descriptions, photos, hours, websites — not in the PRD's launch
  cut.

## Risks a reviewer should weigh

1. **Public membership** is a privacy posture being set in a schema step: any signed-in user can
   see which Gym any lifter belongs to (a rough home-location signal). It follows from YOU-6 +
   GYM-2's public pages and matches the open-team roster precedent, but it is a product call —
   if Tristen wants membership visible only to fellow members, the select policy gains one arm
   and YOU-6's Gym line quietly vanishes on strangers' profiles (the section is already
   absent-when-empty, so the UI degrades cleanly). Flagged for Gate 1.
2. **The (lng, lat) argument order** inside `gyms_near` — `st_makepoint` is x-first — is the
   kind of inversion that passes every "does it return rows" test and ships a wrong sort. Probe
   step 1's two-origin check and the fixture's deliberately asymmetric geography exist to catch
   exactly this; the builder must not weaken them.
3. **PostGIS enters the schema** (an extension install on the live project, in `extensions`,
   with schema-qualified names under `set search_path = ''`). Low risk per se — free, supported,
   reversible — but it is the repo's first migration whose SQL can't be eyeballed against an
   existing pattern; the probe is the safety net, and `get_advisors` should run after apply.

## Build deviations and review outcome (builder, Nov 16, 2026)

Applied live as `20261116123049_gyms.sql` (versions match `list_migrations`). Every probe step
passed — SQL as two synthetic users (rolled back) and the REST upsert with a throwaway user's
real JWT (deleted afterwards): `gyms_near` from downtown → Capitol Hill first (1 393 m), from
Boulder → Boulder first (0 m); join → 201, switch → 200 with one row, new `gym_id`, `joined_at`
moved; re-join same gym → `joined_at` unchanged; upsert with `joined_at` → 42501; upsert for
another user → 42501 (RLS); `gyms` POST / PATCH / DELETE → 42501; anon `gyms` and `gyms_near` →
42501; leave → zero rows. `get_advisors` (security) lists nothing new.

1. **Second migration `20261116124327_gym_members_no_truncate.sql`** (review fix): Supabase's
   default grants left TRUNCATE / REFERENCES / TRIGGER on `gym_members` (and REFERENCES /
   TRIGGER on `gyms`) for `authenticated`. PostgREST can't issue them, but TRUNCATE skips RLS,
   so they are revoked; the live grants are now exactly select+delete and column insert/update
   `(user_id, gym_id)` on `gym_members`, select on `gyms`.
2. **`app/_layout.tsx`** registers `gyms/index` and `gym/[id]/index` in the signed-in guard — the
   file table missed it; every route needs it.
3. **`app.json`** gains the `expo-location` config plugin with the foreground permission sentence
   (iOS requires one); no background location.
4. **`components/gyms/GymListItem.tsx`** (+ test) — one gym row shared by the directory,
   Communities and the profile instead of three inline copies.
5. **Location timeout** of 10 s on `getCurrentPositionAsync` (the plan's "timed out → Denver").
6. **Communities while the gym is unreadable** (review fix): the "join a gym" card shows only when
   the server said "no gym"; offline it is held back (the Teams half shows the connection line).
7. **Fake social client** gains `gyms` / `gym_members` (upsert on `user_id`, server join time,
   restamp on switch, `gym:` / `profile:` embeds); `gyms_near` is test-supplied through `rpc`.
8. The gym page heads its roster "N members", like the team page (the plan's "no member counts"
   was about directory rows; the count is just the loaded roster's length). Kept.
9. Not done, recorded in DEFERRED: extracting a shared member-feed hook from the team and gym
   pages (review judgement call — two copies now).

## Grilling decisions (settled)

- **G1 — "Does B50 need PostGIS at all, or would `earthdistance`/`cube` (or a haversine in SQL)
  do for six fixture rows?"** For six rows, anything works. But GYM-1's definition of done names
  a PostGIS query, ARCHITECTURE.md fixes PostGIS as the geospatial answer, and B51 imports a
  real dataset onto whatever B50 ships — switching geography types then would be a second
  migration touching live data. Installing PostGIS now is the stack decision already made;
  deferring it buys one cheaper migration today at the price of a riskier one later. Kept.
- **G2 — "Is `joined_at`'s reset trigger speculative? Nothing renders joined_at."** Half-kept:
  the trigger is three lines and prevents the only write path from recording a falsehood
  (switch ≠ member-since). The alternative — client writes `joined_at` — violates the B48
  server-time posture; dropping the column entirely was considered, but "member since" is
  standard group furniture and B52 may read it. The trigger stays; if the grilled reviewer
  prefers, dropping the *display* (already not planned) costs nothing.
- **G3 — "Why rename Home's row to 'Your groups'? SOC-10 doesn't ask for it."** Because a row
  labeled "Your teams" containing a gym chip is wrong the moment it renders. The alternatives —
  two stacked rows (vertical cost on Home for at most one gym chip) or a conditional label
  (two states to test for one word) — cost more than the one-word rename. The B49 heading-role
  and spoken-label work carries over mechanically. Kept; recorded as the step's one visible
  change to an existing surface beyond additions.
- **G4 — "The switch confirm: client-side theater?"** No — the schema enforces the one-gym rule
  regardless; the confirm exists because an upsert that silently abandons your old gym (and,
  after B52, its leaderboard context) is a surprise. One `Alert.alert` naming the current gym.
  The B40 "warning line before replacing a running program" precedent, upgraded to a confirm
  because leaving a community is less reversible in feel. Settled.
- **G5 — "`security invoker` vs `definer` for `gyms_near`?"** Invoker. The handoff allowed
  either; definer is only needed when the caller's RLS would hide rows the function must see —
  here the caller can read every gym. Invoker keeps the function inside the caller's privileges
  (no privilege surface to audit) and the anon revoke still gates it. Settled.
- **G6 — "Fixture names: why not real Denver gyms, for realism?"** CLAUDE.md's impersonation
  rule (and plain courtesy to real businesses) — a fake feed attached to a real gym's name is
  exactly the harm the rule names. Fictional names, real-ish coordinates, `FIXTURE` comments.
  Settled; B51's licensed data replaces them.
- **G7 — "Scope check: is the directory screen GYM-1 creep, given B51 is Blocked?"** No — the
  step's scope sentence names the distance-sorted directory seeded with a fixture, and GYM-2's
  join flow needs somewhere to find a gym. The *coverage* claim stays honest: GYM-1 remains
  partial (In progress), its completeness Blocked on B51.
- **G8 — facts checked in the repo:** `loadFeedPage(client, me, authorIds, sort, flairId,
  after)` takes an arbitrary author list (`feed.ts:466`) — the Gym feed slots in untouched.
  `usePostListActions` exists and is already shared by Home / profile / team page (B36 G11), so
  the gym page is user four of the hook, not a new copy. `expo-location` is absent from
  `frontend/package.json` — a real addition, as the handoff said. Communities' Gyms half is a
  placeholder card expecting exactly this step. The migration naming / live-apply / rename
  recipe is the standing one. No table named `gyms` exists in any migration.
- **G9 — "`joined_at` is forgeable: the policies check rows, not columns."** Caught in the
  second grilling pass. (Gate 1 amended the grant to `update (user_id, gym_id)` — see the
  `gym_members` section — because PostgREST's upsert SETs the conflict column too.) A user could insert a 1999 `joined_at` (cosmetic lie, but the plan's own
  B48 citation says the server owns time). Closed with the B36 deviation pattern: table-level
  revoke of INSERT/UPDATE on `gym_members`, grant back `insert (user_id, gym_id)` and
  `update (gym_id)` only. Two migration lines; also stops any future column sneaking in
  writable by default.
- **G10 — returns-table name ambiguity** in `gyms_near` recorded as a builder footgun (an
  unqualified column reference inside the function body collides with the output parameters).
- **G11 — `onConflict: 'user_id'` spelled explicitly** in `joinGym` rather than relying on the
  upsert default resolving to the primary key.
- **G12 — "Mark the viewer's own gym on directory rows?"** No — scope discipline. Communities
  already shows "Your gym" above the Find entry and the gym page states membership; a `gymOf`
  read on the directory would be creep. Revisit on device evidence.
- **Scope verdict:** right as written. One visible change beyond additions (the Home row label,
  G3), one recorded product call (public membership, Risk 1), nothing narrowed; GYM-1 stays
  partial by design.
