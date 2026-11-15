# image-posts — B22: image posts and media limits

**Branch:** `image-posts` (from `main`)
**Build step:** B22 — covers parts of **SOC-2** (post types: the progress-pic and PR types; the
workout type shipped in B20/B21, the form-check *video* type stays blocked on the video service
choice, B33), **NFR-4** (media size limits and background upload for images; video length limits
land with video), and **NFR-5** (progress pics are sensitive: private by default, enforced by
RLS — the per-user visibility *setting* arrives in B26).
**Depends on:** B20 (the `posts` table + RLS, the Home feed and PostCard that must render the
new types) and through B21 the device `posts` mirror, the outbox posts phase and `createPost.ts`
that this step extends.

## Step definition of done (from the Build order)

Supabase Storage bucket for post images with RLS; size cap enforced on device and by bucket
policy; background upload with retry; progress-pic and PR post types; progress pics are private
by default (the per-user visibility setting arrives in B26). **An over-limit image is rejected
with a clear message and an accepted one uploads while the user keeps using the app.**

## Scope readings settled up front

- **What a "PR post" is in this step: an image post wearing the New PR flair.** It cannot be a
  link to a `personal_records` row — that table is readable by its owner only (B13 RLS, verified),
  so an embedded record would be invisible to every viewer and the feed card would render
  nothing. The workout-with-a-PR story already exists (a B21 workout post with the `new-pr`
  flair); what SOC-2's PR *type* adds is the photo of the moment. So both new types are the same
  machinery — an image post — differing in default flair and default visibility. Recorded so
  B28 (share cards) knows nothing richer exists yet.
- **Progress pics are private by default, and in B22 "default" is "always": there is no UI to
  choose anything else until B26 (post privacy) ships the toggle.** Enforcement is server-side —
  a CHECK on the posts row (a progress-pic post must be `private`) plus Storage RLS that gates
  the image by the post's visibility — never client-side only (CLAUDE.md privacy rule). B26
  relaxes the CHECK by migration when the user-facing choice exists. A private post is still
  worth making: the owner sees it on their own Home (the `workout_visible` owner clause), so the
  pic is logged today and becomes shareable when B26 lands.
- **"Background upload" means the sync engine's outbox, not an OS background task.** The DoD
  sentence is "uploads while the user keeps using the app": the Post button writes the row, the
  file reference and the outbox line locally and returns at once; the engine uploads on its next
  pass (triggered by `notifyLocalWrite`, retried every sync). This is the handoff's standing
  input ("ride the existing outbox / engine pattern, an upload phase idempotent by object path,
  not a new scheduler") and it is what every other upload in the app already does. An upload
  that survives the app being *closed* would need a native background-task module and a dev
  build — not asked, not in scope, works against the Expo Go check loop.
- **No caption, no visibility picker, no image editing/cropping, no multiple images.** None is
  named by the step scope; captions were refused in B20/B21 too; the visibility picker is
  explicitly B26. One image per post keeps the schema a column instead of a table.
- **The feed renders the new types** (SOC-2's "rendered in the feed" clause for the two types
  this step owns): the PostCard grows an image body, and the feed query/types widen. The video
  type stays blocked (B33) and nothing here pre-builds for it beyond the `kind` column being
  text.

## Data model impact

### Server migration (one file, applied live via MCP then renamed to the recorded version)

**1. `posts` grows a type.** B20 left `workout_id not null` for exactly this step to relax:

```sql
alter table public.posts add column kind text not null default 'workout'
  check (kind in ('workout', 'progress-pic', 'pr'));
alter table public.posts alter column workout_id drop not null;
alter table public.posts add column image_path text;

-- Shape: a workout post is a workout and nothing else; an image post is an image and
-- nothing else. (unique (workout_id) stays — Postgres ignores nulls in unique.)
alter table public.posts add constraint posts_kind_shape check (
  (kind = 'workout' and workout_id is not null and image_path is null)
  or (kind in ('progress-pic', 'pr') and image_path is not null and workout_id is null)
);
-- A post may only cite an image in its author's own folder — without this, a post citing
-- someone else's object path would make the storage read policy leak that person's picture.
alter table public.posts add constraint posts_image_in_own_folder
  check (image_path is null or image_path like user_id::text || '/%');
-- Progress pics are private, full stop, until B26 ships the user-facing choice. B26 drops
-- or relaxes this constraint in its own migration.
alter table public.posts add constraint posts_progress_pic_private
  check (kind <> 'progress-pic' or visibility = 'private');
-- The storage read policy looks a post up by its image path.
create index posts_image_path_idx on public.posts (image_path) where image_path is not null;
```

The `kind` default `'workout'` back-fills every existing row correctly and keeps B21's
`pushPost` upsert honest while old clients exist (they never send image columns).

**2. Insert/update policies learn that `workout_id` can be null.** Today's `with check` calls
`private.owns_workout(workout_id)` unconditionally, which is false for null — image posts would
be refused. Recreate both policies with
`(workout_id is null or private.owns_workout(workout_id))`; the shape CHECK guarantees null
only ever means "image post". The select and delete policies are untouched — visibility keeps
flowing through `private.workout_visible`, its one home.

**3. The bucket, as data, with the cap as policy:**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', false, 10485760,  -- 10 MiB; mirrored in mediaLimits.ts
        array['image/jpeg', 'image/png', 'image/webp']);
```

Private bucket: nothing is readable by URL alone; every read runs RLS as the signed-in user.
The server-side cap (`file_size_limit`) is the enforcement the device check merely fronts.

**4. Storage RLS on `storage.objects`** (scoped `bucket_id = 'post-images'` throughout):

- **insert** — owners upload only into their own folder:
  `(storage.foldername(name))[1] = (select auth.uid())::text`. The object path encodes the
  owner (handoff standing input): `<user_id>/<post_id>.<ext>`.
- **update** — same own-folder rule (a retried idempotent upload is an upsert on the path).
- **select** — the owner, or anyone the citing post is visible to:
  `(storage.foldername(name))[1] = (select auth.uid())::text or exists (select 1 from
  public.posts p where p.image_path = name and private.workout_visible(p.user_id,
  p.visibility))`. The visibility rule stays in its one home; a progress pic is unreadable by
  anyone but the owner because its post is `private` by CHECK. An object whose row hasn't
  arrived yet (upload raced ahead of the row push) is owner-only — nothing leaks in the gap.
- **delete** — owner only. (No code path deletes images yet: post deletion UI is a later SOC
  step, and workout deletion only cascades *workout* posts, which have no image. Orphan cleanup
  lands with the first deleter — noted in Out of scope.)

**Risk flagged for the builder:** on hosted Supabase, `create policy on storage.objects` in a
migration can fail with "must be owner of table objects" depending on grants. If the MCP apply
refuses, the fallback is applying the four policies through the dashboard/Management API and
keeping them in the migration file as the record — the builder must probe them live either way.

### Device schema V9 (`frontend/src/db/schema.ts`)

SQLite cannot drop a NOT NULL, so V9 rebuilds the device `posts` table (create-copy-drop-rename
inside the migration's transaction): `workout_id text unique` (nullable now; SQLite unique also
ignores nulls), plus `kind text not null default 'workout'` and `image_path text`. Columns keep
server names (`TABLE_COLUMNS` discipline); existing rows carry over with `kind = 'workout'`.
The local *file* location is **not** a column: it is derived from the post id
(`postImageFileUri(postId)` below), so the mirror stays exactly the server shape.

## Media limits — one home (`frontend/src/social/mediaLimits.ts`)

A tiny module, the single spelling of the cap on the app side (the `limits.ts` precedent: the
migration mirrors the number by hand, each side commented to change together):

- `MAX_POST_IMAGE_BYTES = 10 * 1024 * 1024` and `POST_IMAGE_MIME_TYPES`.
- `checkPostImage({ byteSize, mimeType })` → ok, or a refusal with the user-facing message
  ("This photo is N MB — the limit is 10 MB.") so screen and tests share the wording.

Not in `@training-math` — these are media rules, not training math; that module keeps its one
job.

## Creating an image post

**Entry:** a **Share a photo** action beside "Find lifters" in the Home header →
`app/new-post.tsx` (declared in the signed-in guard).

**The screen:** two type chips — **Progress pic** and **PR** (the two kinds, preselecting
visibility + flair as below); a **Choose photo** button opening `expo-image-picker` (library
pick, `quality` set so iOS re-encodes HEIC to JPEG); the picked image previewed; a line stating
the privacy fact for the chosen type ("Progress pics are private — only you can see this post
for now" / "PR photos post publicly"); **Post** and **Cancel**.

- **Size check on device, at pick time:** the asset's `fileSize` (or
  `FileSystem.getInfoAsync`) through `checkPostImage`; over-limit → the clear message, Post
  stays disabled. This is the step-DoD rejection; the bucket's `file_size_limit` is the law
  behind it.
- **Post** calls `createImagePost` (below) and replaces to Home. On a connected phone the post
  appears on Home within the engine's debounce; offline it is queued like any write and Home
  shows its standing offline message meanwhile.
- **Empty flairs mirror** (fresh install that has never synced — near-unreachable, same state
  B21's Post step guards): Post disabled with the one-line "flairs haven't synced" explanation,
  exactly the B21 arrangement, so the screen can never drive `createImagePost` into its
  `unknown-flair` refusal.

**`createImagePost(db, userId, kind, pickedImage)`** in `social/createPost.ts`, the
`createWorkoutPost` shape:

1. Re-validates the size (the screen's check is UX; this one is the module's contract) and the
   flair for the kind exists on the phone (`physique-check` for progress pics, `new-pr` for PR —
   flair *ids* in code are sanctioned precedent from B20/B21; names stay data).
2. Copies the picked file to `FileSystem.documentDirectory + 'post-images/<postId>.<ext>'` —
   picker URIs live in a cache the OS may purge; a queued upload must survive days offline and
   app restarts.
3. In **one transaction**: inserts the device `posts` row (`kind`, `image_path =
   '<userId>/<postId>.<ext>'`, `workout_id` null, visibility `'private'` for progress-pic /
   `'public'` for pr, flair as above, id from `lib/ids.ts`) and `enqueueTx(tx, 'posts', id,
   now)`. Then `notifyLocalWrite(db, ['posts'])`. Copy-then-insert order means a kill between
   the two leaves only a harmless stray file, never a row without its image.

`createWorkoutPost` passes `kind: 'workout'`, `image_path: null` — one row shape everywhere.

## Background upload with retry (the posts phase grows an image leg)

`pushPostsPhase` (sync/push.ts) stays last and keeps its contract; per pending post row:

1. If the row has an `image_path`, call `transport.uploadPostImage(image_path, localFileUri,
   mimeType)` **before** `pushPost` — the server CHECK requires the citing row to name an
   existing path, and uploading first means the object exists (owner-only readable) by the time
   the row lands. Idempotent by object path (handoff standing input): the real transport sends
   `x-upsert: true`, so a retry after a lost reply overwrites the same object, never duplicates.
2. `transport.pushPost(row)` as today (upsert on id). The 23505 → `PostAlreadyExistsError`
   mapping only ever fires for workout posts (the unique is on `workout_id`); its settled-drop
   path is untouched.
3. On acknowledge, best-effort delete the local file — the server copy is now the source the
   feed reads; a failed delete is retried next time the row would push (nothing pending → the
   file is swept opportunistically; a stray file is storage, not correctness).
4. **Missing local file at push time** (OS wiped the directory, or a half-created post): the
   post can never succeed, so it is settled-dropped like a 23505 (`deletePostsTx`) instead of
   wedging the queue behind it — the B21 anti-wedge rule applied to the new failure.
5. Any other failure (no signal, server error, over-limit refused by the bucket): throw, lines
   kept, next sync retries — the standard policy, which **is** the "with retry" of the DoD.

**Transport:** `uploadPostImage` joins `SyncTransport`. The Supabase implementation uses
`FileSystem.uploadAsync` against `/storage/v1/object/post-images/<path>` with the session's
bearer token and `x-upsert: true` — a native streamed upload, no 10 MB base64 string in JS
memory, and it proceeds while the user keeps using the app (the DoD's second clause).
`fakeTransport` grows an in-memory object store (path → bytes/mime, upsert semantics, a
switchable failure) so Jest can prove ordering, retry and idempotency.

## Rendering image posts (feed + card)

- **`FEED_SELECT`** adds `kind, image_path` and changes the workout embed from
  `workouts!inner` to a plain (left) embed — `!inner` would drop every image post (null
  `workout_id`). The inner join's old job (hide a workout post whose workout went private) moves
  one step: `toFeedPost` drops a `kind = 'workout'` raw post whose workout embed is null. That
  filter is UX, not security — the workout *content* is already withheld by workouts RLS; the
  client only declines to render the empty husk, exactly what `!inner` did server-side.
- **`FeedPost`** becomes a discriminated shape: kind, the image path for image posts, the
  workout block for workout posts. `RawFeedPost` widens accordingly (nullable workout).
- **Image URL:** `postImageUrl(path)` in `social/postImages.ts` builds
  `<supabaseUrl>/storage/v1/object/authenticated/post-images/<path>`; the card renders RN's
  own `Image` (no new dependency) with `source={{ uri, headers: { Authorization: 'Bearer
  <access token>' } }}` — every fetch runs storage RLS as the viewer; there are no public URLs
  to leak. Signed URLs were weighed and rejected (G6 below). The token comes from the session
  the screen already has (`useAuth`).
- **`PostCard`** renders the image body (fixed card width, capped height, `resizeMode:
  'cover'`, a plain placeholder while loading / on error) for image posts and the exercise list
  for workout posts; header (author, flair chip, date) is shared and unchanged. A progress-pic
  card shows a small "Only you can see this" line on the owner's own post, so the current
  privacy state is never a surprise.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_post_images.sql` | new — posts kind/image_path/checks, policy recreate, bucket, storage RLS |
| `frontend/src/db/schema.ts` (+ test) | edit — V9: rebuild device `posts` (nullable workout_id, kind, image_path) |
| `frontend/src/db/dao.ts` (+ test) | edit — `PostRow` gains `kind`/`image_path`; `TABLE_COLUMNS` |
| `frontend/src/social/mediaLimits.ts` (+ test) | new — the cap and its message, one home |
| `frontend/src/social/createPost.ts` (+ test) | edit — `createImagePost`; `createWorkoutPost` fills the new columns |
| `frontend/src/social/postImages.ts` (+ test) | new — local file path, copy/delete helpers, `postImageUrl` |
| `frontend/src/sync/transport.ts` | edit — `uploadPostImage`; `PostPushRow` reflects the wider row |
| `frontend/src/sync/supabaseTransport.ts` (+ test) | edit — the streamed storage upload with `x-upsert` |
| `frontend/src/sync/push.ts` (+ test) | edit — image leg of the posts phase; missing-file settled drop; post-ack file delete |
| `frontend/src/test-utils/fakeTransport.ts` | edit — in-memory object store with upsert + failure switch |
| `frontend/src/social/feed.ts` (+ test) | edit — `FEED_SELECT`, widened types, left-embed drop rule |
| `frontend/src/components/social/PostCard.tsx` (+ test) | edit — image body, owner privacy line |
| `frontend/src/app/new-post.tsx` | new — the Share a photo screen |
| `frontend/src/app/(tabs)/index.tsx` | edit — Share a photo header action |
| `frontend/src/app/_layout.tsx` | edit — declare `new-post` in the signed-in guard |
| `frontend/src/__tests__/new-post.test.tsx` | new — route test (never in `src/app/`) |
| `frontend/package.json` | edit — add `expo-image-picker`, `expo-file-system` (free Expo modules, the two actually used) |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) — posts columns, bucket + storage RLS; Share-a-photo path and image upload data path |

Builder footguns (precedent B09–B21): `npx expo start --offline` (~150 s) **before**
`tsc --noEmit` → lint → Jest — this step adds a route. Apply the migration live via MCP, rename
the file to the version `list_migrations` records, and if the storage policies are refused on
ownership, apply them via dashboard/Management API and keep the SQL in the file as the record.
Jest never touches the real project: picker and FileSystem are mocked at the module seam
(`postImages.ts` wraps them so tests fake one small module, not the native APIs everywhere).
One more: this Expo SDK ships `expo-file-system`'s new `File`/`Directory` API at the package
root with `uploadAsync`/`documentDirectory` under `expo-file-system/legacy` — check what the
installed version actually exports before writing `postImages.ts`; either namespace is fine
behind that seam, old docs' import paths are not.

## How the definitions of done become observably true

- **Step DoD, rejection half:** a `new-post` route test picks a fake over-limit asset →
  the exact `mediaLimits` message renders, Post disabled, nothing written; a `mediaLimits`
  unit test pins the boundary (at the cap passes, one byte over refuses). Gate 2 probes the
  server half: an over-limit upload against the live bucket is refused by `file_size_limit`.
- **Step DoD, upload half:** a push test — image post queued, one sync → the fake transport
  holds the object (upload before row, asserted by recorded order) and the row; the screen
  returned before any of it (the route test asserts Post navigates immediately, upload work
  all inside the engine). Retry: upload succeeds, row push fails → next sync re-uploads to the
  same path (upsert) and lands the row; nothing duplicated.
- **SOC-2 (this step's part):** feed + PostCard tests render a progress-pic post and a pr post
  from seeded raw rows (image body, right flair chips) alongside a workout post; a
  `createImagePost` test proves creation; the push test proves upload — created, uploaded,
  rendered, for both new types.
- **NFR-4 (image part):** the two DoD bullets above are exactly its clauses.
- **NFR-5 (this step's part):** `createImagePost` test — a progress-pic post is born
  `visibility 'private'`, a pr post `'public'`. Gate 2 probes the enforcement live as two
  users: B's progress-pic post invisible to A in feed and by direct select; the object
  unreadable by A through the authenticated URL (storage RLS); B's pr photo visible to A both
  ways; A cannot upload into B's folder; A cannot create a post citing B's object path
  (`posts_image_in_own_folder`); a progress-pic post with `visibility 'public'` is refused by
  CHECK.
- **Offline:** create an image post with the fake transport dead → row, outbox line and the
  copied file survive a simulated relaunch; transport healed → one sync → object + row on the
  fake server exactly once; a second sync changes nothing.

## Out of scope (and where it lands)

- Form-check **video** posts, video length limits — blocked on the video service choice (B33).
- The per-user / per-post visibility controls, relaxing `posts_progress_pic_private` — **B26**.
- Captions on posts, multiple images, cropping/filters — never asked; later SOC decision.
- Deleting image posts (and the storage-object cleanup that must ride with it), reporting —
  the later SOC step that builds post deletion; until then no orphaned objects can arise from
  deletes because nothing deletes image posts.
- Avatars and profile images — **B25** (may reuse the bucket pattern, not this bucket).
- Upvotes-only enforcement for Physique Check — **B23** (reads `flairs.upvotes_only`; the
  progress-pic flair default here makes that pairing real).
- OS-level background upload (app closed) — speculative until evidence; the outbox already
  resumes on next launch.
- Pulling image posts / multi-device post state — unchanged from B21 (no reader exists).

## Risks a reviewer should weigh

1. **Storage RLS is this repo's first `storage.objects` surface and carries the whole privacy
   claim.** The select policy's subquery (`posts.image_path = name` + `workout_visible`) must
   be right, performant (the partial index), and actually *creatable* by migration (the
   ownership caveat above). Gate 2's two-user probes of object reads are the non-negotiable
   check; if the policies can't land by SQL, the dashboard fallback must still end in the same
   probes passing.
2. **The authenticated-URL-with-headers render path.** RN `Image` with per-source headers works
   on both platforms but is less beaten than public/signed URLs, and header-carrying cache
   behavior differs by platform. If a device shows broken images, the recorded fallback is
   batch signed URLs (`createSignedUrls`) behind the same `postImageUrl` seam — one module
   changes, no card or feed rework.
3. **The posts phase now does two-step work (object, then row) with a settled-drop for missing
   files.** The orderings proven in tests — upload-before-row, training-before-posts (B21),
   drop-only-when-truly-unsendable — are what keep the queue un-wedgeable; a regression here
   blocks every later social upload. The `x-upsert` retry path and the 23505 path must stay
   distinct and both covered.

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session at full severity, the session
holding both sides per the autonomous-session delegation (B20/B21 precedent). Checkable claims
verified in the repo, not assumed.

- **G1 — "A `kind` column: B20 called that speculative. What changed?"** The second and third
  types now exist in this step — exactly the condition B20 named for the migration ("relaxes
  this with its own migration when a second type exists"). Deriving type from column shape
  (`workout_id` vs `image_path` null-ness) was weighed as the no-new-column alternative:
  it works today but makes every consumer spell the inference, and the shape CHECK needs the
  disjunction written out anyway; one explicit `kind` is the cheaper reading everywhere else.
- **G2 — "Why no `personal_record` link on a PR post?"** Checked, not assumed:
  `personal_records` select RLS is owner-only (B13), so an embedded record is invisible to all
  viewers; widening that RLS is a real privacy decision (records reveal bodyweight-adjacent
  data) belonging to a step that owns it. A PR photo with the `new-pr` flair delivers SOC-2's
  type without it. Recorded for B28.
- **G3 — "Is the progress-pic CHECK (`always private`) too strong for 'private by
  default'?"** The alternatives: a client-side default (violates "never client-side only" the
  moment any client misbehaves) or a trigger defaulting the value (same effect as the CHECK but
  silently rewriting what the client said — worse). Since no UI can express another choice
  until B26, the CHECK states exactly what is true and makes Gate 2's probe trivial; B26's
  migration relaxes it the day the choice exists. Kept, flagged to Gate 1 since it is the one
  place this plan is *stricter* than the scope sentence.
- **G4 — "The own-folder CHECK on `image_path` — isn't storage insert RLS enough?"** No:
  insert RLS stops A *uploading* into B's folder, but without the row CHECK, A could *cite*
  B's existing object in A's own public post, and the storage select policy ("a visible post
  cites it") would then open B's private pic to everyone. Caught in grilling; the constraint is
  the fix, and the Gate 2 probe list gained the citing attack.
- **G5 — "Losing `!inner` reintroduces client-side filtering — B20 made a point of the
  opposite."** Examined: the inner join was never the security boundary — workouts RLS is, and
  still filters the embed. `!inner` only decided *presentation* (drop vs empty husk) and now
  can't be expressed server-side for a mixed feed (PostgREST has no per-kind conditional
  join). The drop moves into `toFeedPost` with a test pinning it; RLS enforcement is unmoved.
- **G6 — "Signed URLs vs authenticated URL + header?"** Signed URLs add a round trip per feed
  page (batchable), expire mid-scroll, and their creation is itself RLS-gated — two moving
  parts for the same enforcement. The header path is one URL builder and zero extra requests,
  with per-fetch RLS. Less-trodden on RN, so the signed-URL fallback is designed in behind the
  same seam (risk 2) instead of being a rewrite. Settled: headers first.
- **G7 — "10 MiB: who says?"** No published standard to cite (and CLAUDE.md's citation rule is
  about performance claims in product copy, not caps). Phone JPEGs run 2–8 MB; 10 MiB admits
  essentially every single photo while bounding free-tier storage (1 GB ≈ 100+ posts at worst
  case, launch-plausible). It is one constant in one module mirrored in one migration line;
  changing it is a two-line diff. Gate 1 may re-set the number freely.
- **G8 — "Why copy the picked file instead of uploading from the picker URI?"** The picker URI
  is cache the OS may purge, and the upload may be days away (airplane-mode queue). The copy
  into `documentDirectory` is the only way the offline promise survives a purge + relaunch.
  Cost: one transient duplicate file, deleted after ack (and the missing-file settled-drop
  covers the copy being lost anyway).
- **G9 — "HEIC from iPhones will break Android viewers."** Caught in grilling: the bucket's
  mime list (jpeg/png/webp) deliberately excludes HEIC, and the picker is configured with a
  `quality` value, which makes iOS re-encode to JPEG. The builder must verify the re-encode on
  the real picker; if an HEIC ever slips through the picker unconverted, `checkPostImage`
  refuses it by mime with a clear message rather than posting a pic half the feed can't render.
- **G10 — "Does the Home header take a second action gracefully?"** Checked: the header row is
  a `SectionLabel` + one ghost Button; a second ghost Button fits the row's flex layout. Phone-
  width feel is Tristen's device check, as with every screen so far.
- **G11 — facts checked in the repo:** (a) posts insert/update policies call
  `owns_workout(workout_id)` unconditionally — null would refuse; the policy recreate is
  mandatory, not optional. (b) `unique (workout_id)` is a table constraint; Postgres treats
  nulls as distinct — image posts coexist with it untouched. (c) Device `posts` has
  `workout_id text not null unique` — SQLite needs the rebuild migration, add-column alone
  can't do it. (d) `pushPostsPhase` reads rows via `getRowsByIds(db, 'posts', …)` and strips
  `updated_at` by hand — the wider `PostRow` flows through without signature changes;
  `PostAlreadyExistsError` is only thrown on 23505, which only the workout unique can raise.
  (e) `FEED_SELECT` / `RawFeedPost` / `toFeedPost` are the single seam the feed shape changes
  at; `PostCard` is the single card. (f) No storage bucket or `storage.objects` policy exists
  in any migration today; `post-images` collides with nothing. (g) `expo-image-picker` and
  `expo-file-system` are absent from `package.json`; both are free Expo SDK modules (spend-no-
  money holds; only the two used are added — `expo-image-manipulator` and `expo-image` are
  deliberately not installed). (h) `flairs` seed has `physique-check` and `new-pr` — the two
  default flairs exist as data on every phone via the B21 mirror.
- **G12 — late-round catches (settled in grilling, plan revised in place):** (a) a B21-era
  client pushing posts without the new columns keeps working — the server's `kind` default and
  null `image_path` satisfy the shape CHECK, so no compatibility shim; (b) the new-post screen
  gains B21's empty-flairs guard (Post disabled with an explanation) so it can never drive
  `createImagePost` into `unknown-flair`; (c) the `expo-file-system` legacy-namespace footgun
  is recorded for the builder; (d) a client lying about content-type can store non-image bytes —
  blast radius is one broken `<Image>` (no script-bearing mime is in the allow-list), and
  server-side sniffing would be unmeasured new infrastructure: accepted.
- **Scope verdict (planner):** right as written. The one addition beyond the literal scope
  sentence is the Share-a-photo screen — but the two post types must be *creatable* (SOC-2's
  own DoD wording) and no existing surface can create a post without a finished workout, so a
  minimal creation screen is the smallest honest reading, same shape as B20's Find-lifters
  call. The one place stricter than scope is the progress-pic CHECK (G3), flagged. Nothing
  else widened; video, captions, visibility controls and avatars explicitly refused.
