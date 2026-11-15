# profile — B25: own and others' profiles

**Branch:** `profile` (from `main`)
**Build step:** B25 — covers **YOU-1** (profile: photo, name, bio, follower and following
counts), **YOU-2** (user's posts and full workout history on the profile), **YOU-3** (PRs by
exercise), and the rest of **SOC-7** (one-way follows; profiles show follower/following counts —
the table + RLS shipped in B02, the Follow/Following card in B20; the counts are this step's).
**Depends on:** B13 (`personal_records` + the PR read model and format helpers), B20 (posts,
feed machinery, `UserCard`, follows module), and through them B22 (the storage-bucket pattern
and `expo-image-picker` / `expo-file-system`, already installed) and B24 (`loadFeedPage`).

## Step definition of done (from the Build order)

Own and others' profiles: avatar (storage bucket), name, bio, follower and following counts,
follow button, posts, workout history, PRs by exercise. **All five header facts render, counts
equal the `follows` rows, PRs equal B13's records.**

## Scope readings settled up front

- **"All five header facts render" is satisfiable only if they can be *set*.** Signup seeds
  `display_name` from the email; `bio`, `avatar_url` and `username` are born null and nothing in
  the app can change any of them — B02's comment says "username is chosen during onboarding",
  and no onboarding step exists anywhere in the Build order. So this step includes a minimal
  **Edit profile** screen (display name, bio, avatar, username). Username is the one field the
  scope sentence doesn't name ("name, bio") — included because every existing social surface
  already prints `@username` (today blank for every account forever), the profiles table already
  carries the constraint, and no other step will ever own it. Flagged as this plan's borderline
  call, the B20 "Find lifters" shape. Gate 1 can strike the username field alone with no other
  change.
- **Another user's follower/following counts cannot be counted client-side.** `follows` select
  RLS shows only rows the viewer is part of (B20 G12 standing input), so a client count of
  someone else's rows would be silently wrong. The counts come from a new
  `public.follow_counts(profile_id)` RPC — SECURITY DEFINER, returns exactly two integers,
  never widens row visibility (handoff standing input honored). Counts equal the `follows` rows
  by construction (`count(*)` over the real table).
- **PRs on another's profile require the B13 select-policy widening, and the widening inherits
  workout visibility.** B13 recorded "the select policy widens in B25 with the profile privacy
  model in hand". The rule: a `personal_records` row is visible to whoever may view the workout
  holding its `source_set_id` — public workout → everyone, followers-only → followers, private →
  owner, blocks honored — all through `private.can_view_workout`, the visibility rule's one
  home. No body data is touched (strength *grades* would need bodyweight; a PR list doesn't).
- **"Workout history … respecting post privacy"** (YOU-2) is read per the handoff: another
  user's history is their *workouts* as workout RLS already filters them (`workout_visible`,
  server-side, read online, never mirrored). Post privacy is respected on the posts section by
  the same posts RLS the feed uses. Nothing is enforced client-side.
- **Own profile vs. others' — who reads what from where.** Other people's data is never
  mirrored on the device (standing input), so their profile is an online surface throughout.
  The lifter's *own* history and PRs already live in device SQLite — the own profile reads them
  locally (offline-capable, like the Workout tab), while the own header + counts + posts are
  online reads like Home. A small kv-store warm cache (the `feedPrefs` device-mirror precedent)
  keeps the own name/bio/avatar rendering offline; counts and posts show the standard offline
  message. A sync-mirrored `profiles` table was weighed and rejected (G3).
- **The avatar bucket is public-read** (handoff explicitly allows it if argued): a profile —
  including its photo — is the account's public face, `profiles` select is already `using
  (true)` for all signed-in users, and avatars are not in CLAUDE.md's sensitive classes
  (progress pics, body data, recovery data). Public read removes the Bearer-header `<Image>`
  risk B22 carried (its recorded fallback concern) and lets the CDN cache. Writes stay
  RLS-gated to the owner's folder. Progress pics and post images stay in the private
  `post-images` bucket, untouched.
- **Entry points for others' profiles:** tapping the author header on any `PostCard`, and
  tapping a result row in Find lifters. Both lead to `/profile/[id]`; opening your own id there
  shows the own-profile view (edit, no follow button). The You tab shows the same profile view
  for `me`. No other navigation is added.

## Data model impact (one migration)

`backend/supabase/migrations/<version>_profile_reads_and_avatars.sql` — applied live via MCP,
file renamed to the recorded version (pipeline convention). No device schema change, no dao
change, no new sync table.

**1. Follow counts, without widening `follows`:**

```sql
create or replace function public.follow_counts(profile_id uuid)
returns table (followers bigint, following bigint)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*) from public.follows f where f.followee_id = profile_id),
    (select count(*) from public.follows f where f.follower_id = profile_id);
$$;
revoke execute on function public.follow_counts(uuid) from anon, public;
grant execute on function public.follow_counts(uuid) to authenticated;
```

Definer because the counts deliberately include rows the viewer may not see; it returns only
the two aggregates, so no row data leaks. Both directions are indexed (`follows` pk +
`follows_followee_idx`). An RPC over a definer view: it is the narrowest possible surface (two
numbers for one id) and PostgREST-callable as `client.rpc('follow_counts', …)`. Anyone
signed in can read anyone's counts — consistent with `profiles` being readable by all
signed-in users; a blocked viewer can already see the profile row today.

**2. `personal_records` select widens to source-workout visibility (the B13 hand-off):**

```sql
create or replace function private.can_view_set(sid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.sets s
    join public.workout_exercises we on we.id = s.workout_exercise_id
    where s.id = sid and private.can_view_workout(we.workout_id)
  )
$$;

drop policy "users read their own records" on public.personal_records;
create policy "records readable with their source workout"
  on public.personal_records for select to authenticated
  using (user_id = (select auth.uid()) or private.can_view_set(source_set_id));
```

The owner clause stays first so the sync pull (filtered `user_id = me`) never runs the helper.
Write policies untouched. The pull's own-user filter means widened reads never contaminate the
device mirror (`pullPersonalRecords` filters on the signed-in user — builder re-confirms).

**3. The `avatars` bucket (B22 pattern, public read):**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,  -- 5 MiB; mirrored in mediaLimits.ts
        array['image/jpeg', 'image/png', 'image/webp']);
```

Storage RLS on `storage.objects` (scoped `bucket_id = 'avatars'`): **insert/update/delete** —
owner's folder only (`(storage.foldername(name))[1] = (select auth.uid())::text`). No select
policy needed: the bucket is public-read by configuration. Object path:
`<user_id>/<random-uuid>.<ext>` — a **new name per upload**, so RN's image cache never shows a
stale avatar (the URL changes); the previous object is deleted best-effort after the profile
row update lands (a stray object is storage, not correctness — the B22 stance).

**4. `avatar_url` holds a path in the owner's own folder, by CHECK** (the B22
`posts_image_in_own_folder` precedent — hygiene here rather than privacy, since the bucket is
public, but it keeps a profile from wearing someone else's upload or an arbitrary URL):

```sql
alter table public.profiles add constraint profiles_avatar_in_own_folder
  check (avatar_url is null or avatar_url like id::text || '/%');
```

`avatar_url` therefore stores the **bucket path**, not a full URL; the app builds the public
URL (`<supabaseUrl>/storage/v1/object/public/avatars/<path>`) in one place. Existing rows all
have null `avatar_url`, so the CHECK lands clean.

## App modules

| Module | What it does |
|---|---|
| `social/profile.ts` (new) | The profile's online reads, injected-client pattern. `loadProfileHeader(client, me, profileId)` — the `profiles` row, the `follow_counts` RPC, and (for another user) whether `me` follows them, shaped into one `ProfileHeader`. `updateProfile(client, me, fields)` — the owner's update of display name / bio / username / avatar path; maps 23505 on username to "That username is taken", CHECK violations to field messages, connection failures to the standard calm sentence. `loadWorkoutHistory(client, me, profileId, after)` — another user's **finished** workouts, newest first, keyset-paged on `(started_at, id)` (a sibling of `beforeCursorFilter` pointing at `started_at`), each with its entries' exercise names (`workout_exercises(id, position, exercise:exercises(name))`); RLS filters invisible sessions; someone else's custom exercise embeds null → "Custom exercise" (B20 precedent). `loadProfilePrs(client, profileId)` — their `personal_records` with `exercise:exercises(name)` embedded, grouped per exercise; the widened RLS decides what comes back. All raw shapes typed once at the seam (the `RawFeedPost` discipline, G11/B20). |
| `social/avatars.ts` (new) | The avatar's one home: `avatarObjectPath(userId, mimeType)` (fresh uuid name), `avatarPublicUrl(supabaseUrl, path)`, `uploadAvatar(config, accessToken, localUri, path, mimeType)` via `FileSystem.uploadAsync` (the B22 streamed-upload pattern, bearer + apikey headers), `deleteAvatar(…)` best-effort. File-system calls behind the same injectable-seam style as `postImages.ts` so Jest fakes one small module. |
| `social/mediaLimits.ts` (edit) | Gains `MAX_AVATAR_BYTES = 5 * 1024 * 1024` + `checkAvatarImage(…)` with its user-facing refusal — the cap's app-side home, mirrored by hand in the migration line (the established `limits.ts`/`mediaLimits` precedent, each side commented to change together). |
| `social/profileLimits.ts` (new) | The profile text rules, one home: display name ≤ 50, bio ≤ 300, username `^[A-Za-z0-9_]{3,30}$` — mirrored by hand from the B02 CHECKs (same precedent), with field-level messages shared by screen and tests. |
| `social/ownProfileCache.ts` (new) | kv-store warm cache of the own header (username, display name, bio, avatar path), **keyed by user id** (the B07 account-switch rule: every UI read filters by the signed-in user, so a switched account never sees the previous one's name) — written on every successful own-header load, read at You-tab mount so the lifter's identity renders offline; counts are online-only and show a placeholder with the standard offline line. The `feedPrefs` device-mirror precedent; not a sync table (G3). |
| `workout/prs.ts` (edit) | `allCurrentPrs(db, userId)` — every stored record of the user grouped per exercise with names from the local `exercises` mirror, ordered by exercise name; the own profile's PR list, read offline. Formatting stays in `format.ts` (`formatPrLine`) — no new spelling of PR text. |
| `workout/history.ts` (edit) | `listPastWorkouts` gains an optional before-cursor (`started_at`, `id`) page parameter so the own history section can page past the first 100 — YOU-2 says the **complete** history is browsable, and a hard cap would make the 101st workout unreachable (G13). The Workout tab keeps calling it without a cursor, unchanged. |

`FEED_SELECT`'s author embed and `searchLifters`' select each gain `avatar_url` (B20 recorded
"avatar images are B25" for exactly this). `PersonName` consumers are untouched; the avatar
travels beside it.

## Screens and components

| Piece | What it does |
|---|---|
| `components/social/Avatar.tsx` (new) | The one avatar renderer: the public-URL image when a path is set, else `LetterAvatar`'s initial. Sized variants for card rows and the profile header. `PostCard` and `UserCard` swap their `LetterAvatar` for it. |
| `components/profile/ProfileView.tsx` (new) | The whole profile body, used by both routes. Header: avatar, display name, `@username`, bio, Followers / Following counts (the five facts); counts re-read after a follow/unfollow so the number matches the action. Own profile: an **Edit profile** button; another's: the Follow/Following button (same optimistic flip + calm refusal as `UserCard`, through the same `follows.ts` functions). A profile id whose row doesn't come back (deleted account, bad link) shows a calm "This lifter isn't available" state, never a spinner. Below, three `ChoiceChips` sections — **Posts** (`loadFeedPage(client, me, [profileId], 'latest', null, cursor)` rendered as `PostCard`s with infinite scroll — the B24 machinery with an author list of one), **History** (own: `listPastWorkouts` from SQLite, paged by its new cursor, rows tappable through to `workout/[id]`; others: `loadWorkoutHistory` pages, not tappable — their workout has no local row and no detail screen, the B20 stance), **PRs** (own: `allCurrentPrs`; others: `loadProfilePrs`; both printed per exercise through `formatPrLine` in the viewer's display unit). Online sections degrade to the standard "needs a connection" + Retry. |
| `app/(tabs)/you.tsx` (rewrite) | The placeholder becomes `ProfileView` for `me`, keeping the gear → Settings button exactly where it is. |
| `app/profile/[id].tsx` (new) | Another lifter's profile (or your own, opened via a card) — `ProfileView` with the route id; declared in the signed-in guard. |
| `app/edit-profile.tsx` (new) | Display name, bio and username boxes (validated through `profileLimits`, server CHECKs the law; a username, once set, can be changed but not cleared — the empty box gets a field message, so a claimed handle can't silently vanish from every card that prints it), avatar: current picture + **Change photo** via `expo-image-picker` (square crop, `quality` set so iOS re-encodes HEIC — the B22 G9 arrangement; size checked through `checkAvatarImage` at pick, over-limit → clear message, Save disabled). Save: upload the new avatar (if changed), then `updateProfile` with the new path; the old object deleted best-effort after. Online-only — offline shows the standard calm message (the comments precedent); nothing queues. |
| `components/social/PostCard.tsx` (edit) | Author header becomes tappable → `/profile/[authorId]`; avatar image. |
| `components/social/UserCard.tsx` (edit) | Row tappable → the lifter's profile (the Follow button keeps its own press); avatar image. |

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_profile_reads_and_avatars.sql` | new — `follow_counts` RPC, `can_view_set`, PR select policy swap, `avatars` bucket + storage RLS, `profiles_avatar_in_own_folder` CHECK |
| `frontend/src/social/profile.ts` (+ test) | new — header/history/PRs reads, `updateProfile` |
| `frontend/src/social/avatars.ts` (+ test) | new — path, public URL, upload/delete |
| `frontend/src/social/mediaLimits.ts` (+ test) | edit — avatar cap + check |
| `frontend/src/social/profileLimits.ts` (+ test) | new — name/bio/username rules |
| `frontend/src/social/ownProfileCache.ts` (+ test) | new — kv warm cache of the own header |
| `frontend/src/social/feed.ts` (+ test) | edit — `avatar_url` in the author embed |
| `frontend/src/social/follows.ts` (+ test) | edit — `avatar_url` in search results |
| `frontend/src/workout/prs.ts` (+ test) | edit — `allCurrentPrs` |
| `frontend/src/workout/history.ts` (+ test) | edit — before-cursor paging on `listPastWorkouts` |
| `frontend/src/components/social/Avatar.tsx` (+ test) | new — image-or-initial renderer |
| `frontend/src/components/profile/ProfileView.tsx` (+ test) | new — the shared profile body |
| `frontend/src/components/social/PostCard.tsx` (+ test) | edit — tappable author, avatar |
| `frontend/src/components/social/UserCard.tsx` (+ test) | edit — tappable row, avatar |
| `frontend/src/app/(tabs)/you.tsx` | rewrite — `ProfileView` for me |
| `frontend/src/app/profile/[id].tsx`, `app/edit-profile.tsx` | new — routes, declared in the signed-in guard (`app/_layout.tsx`) |
| `frontend/src/__tests__/you-profile.test.tsx`, `profile.test.tsx`, `edit-profile.test.tsx` | new — route tests (never in `src/app/`) |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) — RPC, policy change, bucket, CHECK; profile routes and their data paths |

Builder footguns (precedent B09–B24): `npx expo start --offline` (~150 s) **before**
`tsc --noEmit` → lint → Jest (two new routes — the stale `router.d.ts` trap applies for
certain). Apply the migration live via MCP, rename to the recorded version; if a
`storage.objects` policy is refused on ownership, the B22 fallback (dashboard/Management API,
SQL kept in the file) applies. The fake social client must grow `rpc(...)` support for
`follow_counts`. Jest never touches the live project; picker/FileSystem fakes follow the B22
seam style.

## How each definition of done becomes observably true

- **Step DoD, header:** the `you-profile` and `profile` route tests render a seeded profile
  and assert all five facts — avatar (image for a set path, initial otherwise), name, bio,
  and both counts — from the fake client's profile row + rpc reply.
- **Step DoD, counts:** `loadProfileHeader` test — counts come from the rpc, not from
  client-visible rows (the fake returns counts larger than the rows the viewer could see).
  Live, Gate 2 seeds follows among synthetic users and checks `follow_counts` equals
  `count(*)` per direction, as two different viewers.
- **Step DoD, PRs:** own — `allCurrentPrs` over a seeded device db matches the
  `personal_records` rows B13's finish wrote, grouped per exercise; shown through
  `formatPrLine`. Others — `loadProfilePrs` test, plus the Gate 2 live matrix (below). "PRs
  equal B13's records" is literal: both reads return rows of B13's table, no recomputation.
- **YOU-1:** the five facts above, plus the edit screen tests: valid save updates the row
  (fake), over-limit bio/name/username refused client-side with field messages, taken username
  (23505) → "taken" message, over-limit avatar refused with the `mediaLimits` message, Save
  disabled.
- **YOU-2:** posts section test — a seeded author's posts render as cards, respecting what the
  fake (standing in for RLS) returns; history section test — own history from local rows
  (tappable), another's from paged online rows; **"complete" is literal on both sides** — a
  seeded history longer than one page is walked to its oldest session through the cursor
  (local and online variants); a session the viewer may not see simply isn't in the reply
  (RLS), asserted live at Gate 2 rather than faked.
- **YOU-3:** the PR proofs above.
- **SOC-7 (completion):** counts on both profiles; follow/unfollow from the other-profile
  header flips state and counts refresh; a block-refused follow shows the calm message
  (`UserCard` logic reused).
- **Gate 2 live probes (SQL + REST via MCP, synthetic users, rolled back / cleaned up):**
  `follow_counts` equals the rows; PR visibility matrix — a PR sourced from a public workout
  visible to a stranger and a follower, from a followers-only workout visible to the follower
  only, from a private workout owner-only, and hidden entirely across a block; the widened
  policy still shows owners every own row (sync pull unaffected); avatar upload into another's
  folder refused (42501); `avatar_url` citing another's folder refused by CHECK; an avatar
  object readable through the public URL with **no** auth header (that is the bucket's
  contract); an over-limit avatar refused by `file_size_limit`.

## Out of scope (and where it lands)

- **Follower / following *lists*** (tapping a count to see who) — not named by the scope;
  another user's lists aren't even readable under follows RLS today. A later SOC step decides
  whether counts open lists and what RLS that needs.
- **Privacy settings, per-post private toggle, progress-pic visibility** — B26 (depends on
  this step).
- **Block / mute / report from the profile** — B27.
- **Profile trends charts** — B46. **Strength grades** (needs body data + licence) — B38+.
- **Body data on the profile** — never; owner-only by RLS (B02), not a profile fact.
- **Tapping through to another user's workout detail** — unchanged B20 stance; their workouts
  have no local row and no online detail screen yet.
- **Deleting posts from the profile, post detail screens** — later SOC steps.
- **Account fields** (email change, password) — NFR-6's step; Settings keeps the account
  section.
- **Avatar moderation / resizing pipeline** — nothing speculative; the cap and mime list are
  the launch guard.

## Risks a reviewer should weigh

1. **The `personal_records` policy swap is a live privacy change on real data.** The new
   select policy must keep the owner clause airtight (sync depends on it) while opening
   exactly workout-visibility and nothing more. The Gate 2 matrix (public / followers /
   private / blocked, as three users) is the non-negotiable check, and the owner-first `or`
   keeps the pull's cost unchanged.
2. **`follow_counts` is the repo's first client-callable SECURITY DEFINER function.** The
   surface is two aggregates, but definer + `public` schema means anyone signed in can call it
   for any id. The body must stay aggregate-only (no row data), `search_path` pinned, execute
   revoked from `anon`/`public` — reviewer should hold it against the B02 definer-helper
   precedents.
3. **The public avatars bucket is a deliberate loosening of the B22 pattern.** The argument
   (public face, non-sensitive class, simpler rendering) is recorded above; if Gate 1
   overrules, the fallback is the B22 arrangement — private bucket + authenticated URL with
   headers through `Avatar.tsx`'s one seam — with no other plan change. Either way the write
   path stays owner-folder RLS and the own-folder CHECK stops cross-citing.

## Grilling decisions (settled)

Worked in the planner session at full severity (the `mattpocock-skills:grilling` question
tree, the session holding both sides per the autonomous-session delegation); every checkable
claim verified in the repo, not assumed.

- **G1 — "Username editing: scope names 'name, bio', not username. Widening?"** Attacked
  hardest. Without it, `@username` stays null for every account for the life of the product —
  no onboarding step exists in the Build order (checked: no step names username), and B02
  explicitly deferred the choice to a flow that was never scheduled. The field costs one box
  on a screen this step builds anyway, the constraint already lives in the schema, and 23505
  is the only new failure mode. Alternatives: a separate micro-step (process overhead for one
  input box), or onboarding (a real flow nobody scoped). Settled: in, flagged at the top for
  Gate 1 — strikeable alone.
- **G2 — "Why an RPC for counts instead of a definer view?"** A view would work, but it is a
  second queryable surface with definer semantics to reason about forever (B24 deliberately
  used `security_invoker` for its view; a definer view here would be the repo's first), and
  the profile needs exactly two numbers for one id. The RPC is the narrowest honest surface.
  Checked: both count directions are indexed; `revoke from anon` is spelled because functions
  default to `PUBLIC` execute.
- **G3 — "Own header: why a kv cache instead of mirroring `profiles` through sync, like
  `user_settings` (B15)?"** The settings mirror earns its machinery because the unit changes
  how *every* screen renders offline. The own header renders one screen; counts and posts on
  that screen are online regardless; and a sync mirror means a schema version, dao table,
  pull cursor and push phase for a row that changes a few times a year. The kv warm cache is
  ~the `feedPrefs` precedent and twenty lines. If profile data ever needs to roam into offline
  logic, that evidence buys the mirror. Settled: kv cache; edit stays online-only (the
  comments/votes precedent for social writes).
- **G4 — "Is widening PR reads to workout visibility *the* profile privacy model, or a guess?"**
  It is the only rule that doesn't invent policy: PRs derive from sets; the sets' workouts
  already carry the user's own visibility choice, enforced in `workout_visible`'s one home.
  Any alternative (a new per-user "PRs public" flag) is B26's territory — a *setting* — and
  nothing stops B26 adding one on top (the policy would gain a clause). The handoff's
  constraint ("respect the workout visibility of the source set") is satisfied literally.
  Checked: `can_view_workout`, `entry_workout` and the B13 indexes exist as assumed; the pull
  filters by `user_id` so widened reads can't reach the device mirror.
- **G5 — "A stranger's profile shows PRs from public workouts — does the lifter expect that?"**
  Yes by construction: the same stranger could already open the public workout from the feed
  and read the same sets with the PR badges B13 ships. The policy reveals nothing the workout
  didn't. A lifter who logs private workouts shows nothing. Noted for Tristen's product-reading
  list anyway.
- **G6 — "Public avatars bucket: the repo's privacy posture is RLS-everything. Defend it."**
  Held. The avatar is definitionally the public face (shown beside every post to anyone
  signed in); `profiles` is already world-readable-in-app; CLAUDE.md's sensitive classes don't
  include it. Public-read removes a per-image auth header (B22's own recorded risk) and the
  object name (uuid path) is unguessable in practice — and guessing it yields a picture the
  user chose as public. The *write* path keeps full owner-folder RLS. Risk 3 records the
  one-seam fallback if overruled.
- **G7 — "New object name per upload — why not upsert one path?"** A fixed path + `x-upsert`
  is the B22 arrangement, but avatars are *replaced*, not retried: RN's image cache keys on
  the URL, so a stable URL shows the old picture until an app restart, and cache-busting query
  params defeat the CDN the public bucket just bought. A fresh uuid name per change makes
  staleness impossible; the orphan is deleted best-effort (the B22 stray-file stance, recorded
  there as acceptable).
- **G8 — "Why is the history section two code paths (local for own, online for others)?"**
  Because the alternative is worse on both sides: online-for-own makes the You tab's history
  need signal for data that is sitting in SQLite (and `listPastWorkouts` + tap-through already
  exist); local-for-others is impossible (never mirrored). The renderer is shared; only the
  row source differs. Same shape for PRs. Accepted as the honest cost of the
  own-data-local / others-online architecture.
- **G9 — "Does `loadFeedPage` really serve the posts section unchanged?"** Checked against
  `feed.ts`: it takes `authorIds` as a parameter (B24 signature), so `[profileId]` is a
  one-element author list — no new query shape, keyset paging, scores, votes and cards all
  ride along. A stranger's private/followers posts drop out via posts RLS, which is YOU-2's
  "respecting post privacy" made literal. One subtlety: `.eq('my_vote.user_id', me)` stays
  correct for any author.
- **G10 — "The five facts render even when null?"** Yes — the header renders placeholders
  (initial avatar, "Add a bio" hint on the own profile, blank handle) rather than hiding
  rows; YOU-1's DoD says *render*, and the edit screen is how they stop being null. The route
  tests assert the null-state renders too.
- **G11 — "`follow_counts` on every profile open — N+1 worry?"** One RPC per profile view
  (not per card), two indexed counts. Nothing to pre-optimize; the B23 `post_scores` stance
  (measure, then rewrite) applies.
- **G12 — facts checked in the repo:** (a) `follows` RLS select is participant-only — the
  client cannot count others (the RPC is necessary, not convenient). (b) `profiles` CHECKs:
  username regex `^[A-Za-z0-9_]{3,30}$`, display_name ≤ 50, bio ≤ 300 — `profileLimits`
  mirrors exactly these. (c) `personal_records` select policy is the B13 owner-only one;
  write policies cite `owns_set` and are untouched. (d) `expo-image-picker` ~58.0.10 and
  `expo-file-system` ~58.0.13 are installed (no new dependency; spend-no-money holds — the
  bucket rides the existing free tier). (e) `formatPrLine` exists in `format.ts`;
  `currentPrs`/`TABLE_COLUMNS.personal_records` exist for `allCurrentPrs` to reuse. (f)
  `FEED_SELECT`'s author embed names its FK (`profiles!posts_user_id_fkey`) — adding
  `avatar_url` inside it is safe for both `posts` and the `post_hot_scores` view read. (g)
  `UserCard` exposes the optimistic follow flip this plan reuses on the profile header. (h)
  The You tab's gear button and floating-profile-button spacing survive the rewrite
  (`layout.minTouchTarget` pattern kept).
- **G13 — "YOU-2 says *complete* history; `listPastWorkouts` caps at 100."** Caught in the
  second pass: the B09 cap was fine for the Workout tab's recent list, but a profile claiming
  the complete history must reach workout 101. Settled: the own section pages the local query
  with a before-cursor (same `(started_at, id)` shape as the online one), rather than raising
  the cap (a growing unbounded read) or leaving the DoD quietly false. The Workout tab is
  untouched.
- **G14 — smaller second-pass catches, settled in place:** the own-header kv cache is keyed
  by user id (B07 account-switch rule); a set username can be changed but not cleared; a
  profile id with no row renders a calm not-found state; counts re-read after the header's
  own follow/unfollow so the number never contradicts the button.
- **Scope verdict:** right as written, with one flagged inclusion (username, G1) and one
  argued loosening (public avatar bucket, G6 — invited by the handoff). The Edit profile
  screen is the minimal surface that makes the five facts settable at all; follower lists,
  privacy settings and block UI stay with their steps. Nothing narrowed.
