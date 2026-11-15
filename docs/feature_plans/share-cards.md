# share-cards — B28: the workout image card and in-app re-shares

**Branch:** `share-cards` (from `main`)
**Build step:** B28 — covers **LOG-8** (External share card — image, Strava-style) and **SOC-6**
(Share posts inside Astra and to other platforms), both in full (one honest note on SOC-6's
export half, below).
**Depends on:** B21 (posts exist and the finish flow creates them; the feed shows them through
`PostCard`). Also leans on B18 (`analysisForScreen` — the card's numbers), B20/B22/B26/B27 (the
posts schema, `posts_kind_shape`, `private.workout_visible` / `private.can_view_post`).

## Step definition of done (from the Build order)

Strava-style workout image card rendered on device and sent to the OS share sheet; in-app
re-share of a post. **The card posts legibly to another app and a re-share appears in
followers' feeds.**

## Scope readings settled up front

- **The step is two features with different data paths, planned as two halves.** The share card
  (LOG-8) is entirely on-device: the lifter's own workout, read from SQLite, drawn as a view,
  captured to a PNG, handed to the OS share sheet. It works fully offline. The re-share (SOC-6)
  is a server post made from the feed, which only exists online — so it is a direct insert, the
  B23 votes/comments precedent, **not** outbox machinery. CLAUDE.md's offline-first rule names
  logging and the Tool Kit; B23 already settled that feed actions are online-only.
- **A re-share is a new post kind.** `posts.workout_id` is `unique` (one post per workout, B20)
  and `posts_kind_shape` requires a kind-specific body, so a re-share is honestly
  `kind = 'reshare'` with a `shared_post_id` FK to the original post and the shape CHECK widened
  by migration (the handoff's steer, confirmed against the schema). RLS stays the enforcement:
  a re-share of a post you can no longer see disappears too, through the **existing**
  `private.can_view_post` helper — the visibility rule is not spelled a second time.
- **SOC-6's "exported to the OS share sheet" is satisfied by the workout card.** The one card
  renderer serves both features: the analysis screen's Share button (LOG-8) and a Share action
  on the lifter's **own workout posts** in the feed (SOC-6) open the same screen, built from the
  device workout row — which own posts always have. Exporting a **photo post** as an image is
  out of scope (the photo is the lifter's own file; an image-of-an-image card earns nothing
  yet), and exporting **other people's** posts is refused on principle: the handoff's standing
  input — the share-sheet export carries no private data beyond what the sharer chooses, *it is
  their own card* — reads as "you export your own content". Someone else's followers-only post
  leaving the app as a PNG is a leak the feature must not build. (Grilled at G6.)
- **The card states facts, not claims.** Title/date, volume, sets, duration, PR lines — all
  through the existing analysis module and `format.ts` spellings, in the sharer's unit. No new
  math, no new wording, no performance claims — so CLAUDE.md's citation rule has nothing to
  cite. PR lines use `prBookLabel` exactly as the analysis screen does.
- **Two small free libraries are installed:** `react-native-view-shot` (capture a view to an
  image file — bundled in Expo Go) and `expo-sharing` (the OS share sheet — an Expo SDK
  module). Installed with `npx expo install` so versions match SDK 58; nothing else. The
  builder verifies the app still boots in Expo Go (`expo start --offline`); the actual
  capture-and-share needs a device, which is Tristen's check.

## Half 1 — the share card (LOG-8)

### The screen

`frontend/src/app/share-card/[id].tsx` — a new routed screen (declared in the signed-in guard),
opened with a workout id. It reads `analysisForScreen(db, userId, id)` — the same one-call read
the analysis screen uses, device-only, offline-capable — and shows:

- a **preview** of the card at screen width (what you see is what you share);
- a primary **Share** button: `captureRef` on the card view (PNG, captured at a fixed pixel
  width via the `width`/`height` options so the file is crisp regardless of the phone's screen),
  then `Sharing.shareAsync(uri, { mimeType: 'image/png' })`;
- the standard "isn't on this phone" empty state for a missing/foreign/unfinished workout, and a
  plain disabled state with one line if `Sharing.isAvailableAsync()` says no (emulators).

Entry points, both one line: the **analysis screen** gains a **Share** button (ghost, under View
workout — every finished workout passes through this screen, and the saved workout links to it,
so one surface covers "a completed workout exports"); a lifter's **own workout posts** in
`PostCard` gain a share action (below, SOC-6).

### The card itself

`frontend/src/components/share/ShareCard.tsx` — a pure view, props in, no reads: 4:5 portrait
(1080×1350 captured — the aspect Instagram, and so everyone else, shows without cropping), the
app's dark theme so it is legibly Astra's:

- Astra wordmark (text, the display font — no logo asset exists yet) and the date;
- the workout's title (or its date label);
- the three stats large: volume (sharer's unit via `formatWeight`), sets ("· n warm-up"),
  duration — the analysis screen's exact spellings;
- New PRs when the analysis has them (up to 3, `prBookLabel` + `formatWeight`, "+ n more");
  otherwise up to 3 exercise names with set counts, so a card without PRs still says what was
  done (names from the device rows; a deleted exercise prints the existing "Deleted exercise").

No muscle map on v1 of the card (hand-authored shapes, built to be replaced — not the face of
the app yet; one-line follow-up if Tristen wants it). No photos, no avatars, no network.

## Half 2 — the in-app re-share (SOC-6)

### Server migration (`backend/supabase/migrations/<ts>_reshares.sql`)

One migration, applied live by the builder via MCP and renamed to the recorded version:

1. `alter table public.posts add column shared_post_id uuid references public.posts (id) on
   delete cascade;` — the original dies, its re-shares die with it (the workout-post precedent:
   content posts die with their content). Plus an index on `shared_post_id` (the FK lookup and
   the embed path).
2. Widen the kind list: drop the B22 inline check on `kind` (`kind in
   ('workout','progress-pic','pr')`) and re-add with `'reshare'`. Its auto-generated name
   should be `posts_kind_check` — the builder verifies in the catalog
   (`pg_constraint` on `posts`) before dropping, never guesses.
3. Widen `posts_kind_shape`: the three existing arms each additionally require
   `shared_post_id is null`; the new arm —
   `kind = 'reshare' and shared_post_id is not null and workout_id is null and image_path is null`.
4. **One re-share per lifter per post:** `create unique index posts_reshare_unique on
   public.posts (user_id, shared_post_id) where shared_post_id is not null;` — a double tap or a
   retry lands on the same rule; the app maps 23505 to "already re-shared".
5. **Read rule:** drop and recreate `"posts readable per their visibility"`:
   `using (private.workout_visible(user_id, visibility) and (shared_post_id is null or
   private.can_view_post(shared_post_id)))`. `can_view_post` is already security definer, so no
   RLS recursion; it already folds in blocks, mutes, followers and private through
   `workout_visible` — the one home keeps being the one home. Net effect: a re-share is visible
   to exactly the people who may see **both** the re-share and the original.
6. **Insert sanity, the B27 trigger pattern** (`private.reshare_shape()`, BEFORE INSERT when
   `new.kind = 'reshare'`): the original must exist and be visible to the resharer
   (`can_view_post` — also added to the insert policy, mirroring "report what you can see"), must
   **not** itself be a re-share (no chains — the app re-shares the original instead, G4), and
   must not be the resharer's own post (no self-boosting, the `reports_not_self` precedent).
   The trigger also **stamps `new.flair_id` from the original's flair**, never trusting the
   client — so a re-share wears its original's flair, the flair feed filter stays truthful, and
   `upvotes_only` (Physique Check) follows the content automatically, keeping the CLAUDE.md
   rule data-driven with zero new vote machinery.
7. **Recreate `post_hot_scores`** (drop view / create view — `create or replace` cannot insert
   a column before `hot_score`) with `shared_post_id` in the column list, then **re-grant
   select to `authenticated` and re-add the view's comment** (last rewritten by B27 — a drop
   loses both): the view's own comment commands exactly this — every posts column FEED_SELECT hangs an embed on
   joins the view in the same commit. `post_scores` selects only `p.id` plus aggregates — no
   change; re-shares get score rows (votes/comments on a re-share are on the re-share) for free.
8. The B26 lockstep trigger already guards `new.workout_id is not null` — untouched.

### The app side

- **`frontend/src/social/reshare.ts`** (+ test): `resharePost(client, me, post)` — insert
  `{ id: newUuid(), user_id: me, kind: 'reshare', shared_post_id, flair_id (copied; trigger
  backstops), visibility: 'public', created_at }`; returns a typed result, never throws (the
  votes.ts shape): `ok` | `'already-reshared'` (23505) | `'failed'` (anything else — no signal,
  post gone, refused). On a re-share card, the action targets the **original's** id, so
  "re-sharing a re-share" re-shares the original (G4).
- **`feed.ts`:** `FEED_SELECT` gains `shared_post_id` and an `original:posts!posts_shared_post_id_fkey(…)`
  self-embed carrying the original's `id, created_at, kind, image_path, visibility`, flair,
  author and nested workout — the same inner shape the top level already asks for, minus votes
  and scores. `RawFeedPost` gains the two fields; `FeedPost` gains a
  `{ kind: 'reshare'; original: FeedOriginal }` variant, where `FeedOriginal` is the shaped
  workout-or-photo content plus author and flair (extracted from today's shaping so the
  workout/photo arm is written once and `toFeedPost` calls it at both depths). A re-share whose
  embedded original arrives null (RLS filtered an edge the posts policy missed, or a broken
  reply) shapes to null — dropped, the existing no-empty-cards rule. `PostKind` in `dao.ts`
  widens to include `'reshare'` (device rows never hold it — nothing writes one locally).
- **`PostCard`:** renders a re-share as: the normal header (resharer, date, flair chip, ⋯ report
  on others') plus a "re-shared from @original-author" line; the **original embedded** in a
  bordered inner panel — original author line (tappable to their profile) and the existing
  workout/photo body, reused as-is; then the normal footer — votes and comments belong to the
  re-share row (post_scores already counts them). The owner's visibility chip (B26) works
  unchanged. New footer action **Re-share** (`arrow-redo` icon) on other people's posts (never
  own — the server refuses anyway): confirm sheet → `resharePost` → one-line result ("Re-shared
  to your followers" / the refusal), feed refreshes on next focus as today. Reports on a
  re-share target the re-share; the B27 stamp trigger correctly blames the resharer.
- **Home (`(tabs)/index.tsx`) and ProfileView** pass the two new handlers (reshare, and
  share-own-workout-post → `router.push('/share-card/[id]')`); both read through the one
  `loadFeedPage`, so a re-share appears on Home and on the resharer's profile with no second
  reader.

## Data model impact

Server: the one migration above (posts column, two CHECK rewrites, partial unique index, select
+ insert policy rewrite, one trigger + function, `post_hot_scores` recreated with one more
column). **Device: no schema change at all** — re-shares never touch SQLite or the outbox, and
the share card only reads what is already there.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<ts>_reshares.sql` | new — everything under "Server migration" |
| `frontend/package.json` | edit — `npx expo install react-native-view-shot expo-sharing` |
| `frontend/src/components/share/ShareCard.tsx` (+ test) | new — the card view, props in |
| `frontend/src/app/share-card/[id].tsx` | new — preview + Share (capture → share sheet) |
| `frontend/src/__tests__/share-card.test.tsx` | new — route tests (never in `src/app/`) |
| `frontend/src/app/analysis/[id].tsx` | edit — Share button |
| `frontend/src/app/_layout.tsx` | edit — declare the route in the signed-in guard |
| `frontend/src/social/reshare.ts` (+ test) | new — `resharePost`, typed results |
| `frontend/src/social/feed.ts` (+ test) | edit — `FEED_SELECT` original embed; `FeedOriginal`; reshare shaping |
| `frontend/src/db/dao.ts` | edit — `PostKind` gains `'reshare'` (type only) |
| `frontend/src/components/social/PostCard.tsx` (+ test) | edit — re-share rendering, Re-share + Share actions |
| `frontend/src/app/(tabs)/index.tsx`, `frontend/src/components/profile/ProfileView.tsx` | edit — wire the two handlers |
| `frontend/src/test-utils/fakeSocialClient.ts` | edit — posts insert path (23505 on the pair), original embed in feed replies |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) — posts.shared_post_id, trigger, policies; share-card screen + re-share path |

Builder footguns (precedent B09–B27): `npx expo start --offline` (~150 s) → `tsc --noEmit` →
lint → Jest, in that order — this step adds a route. Apply the migration via MCP, then rename
the file to the version `list_migrations` records. Jest must mock `react-native-view-shot` and
`expo-sharing` (tiny manual mocks beside the existing expo mocks); the capture itself is
untestable in Jest and is pinned by the device check.

## How the definitions of done become observably true

Jest + fakes for everything below; live probes at Gate 2 / device:

- **LOG-8 / "the card posts legibly to another app":** route test — a finished device workout
  renders the preview with the workout's title, formatted volume/sets/duration and PR lines
  (asserted through the same `format.ts` spellings, kg and lb both); tapping Share calls the
  view-shot mock then the sharing mock with its uri and `image/png`; a foreign/missing id shows
  the empty state and no Share. ShareCard unit test: PRs shown capped with "+ n more"; no-PR
  card lists exercises; unit follows the setting. *Legibility on a real phone and in another
  app is the device half (Built → Done), by design unprovable in Jest.*
- **SOC-6 / "a re-share appears in followers' feeds":** feed test — a raw re-share row with an
  embedded original shapes to a reshare card (original's workout body, resharer's header);
  `resharePost` inserts the exact row (fake records it) and maps 23505 → `'already-reshared'`,
  other errors → `'failed'`; a re-share whose original is null is dropped. PostCard test —
  re-share renders original author + body + "re-shared" line; Re-share action absent on own
  posts, present on others'; confirm → handler called with the original's id (also from a
  re-share card). **Live (Gate 2, three users as B27):** A posts, B re-shares, C (follows B
  only) sees the re-share with A's workout in it; A makes the workout post private → C's feed
  drops the re-share (the policy's `can_view_post` arm, probed as SQL and through PostgREST);
  B re-shares twice → one row; B re-shares own post → refused; re-share of a re-share →
  refused; A's post deleted → the re-share is gone (cascade).
- **The flair stamp:** SQL probe — a re-share inserted with a wrong flair lands wearing the
  original's; a Physique Check re-share refuses a downvote (existing trigger, via the stamped
  flair).
- **Step DoD** = the two bullets above; device verification stays Tristen's.

## Out of scope (and where it lands)

- Exporting photo posts or other people's posts as images — not built (reading above; G6).
- A caption/comment on a re-share ("quote post") — a later SOC step if ever; today a re-share
  is the original, passed on.
- Un-resharing (deleting a re-share) — the delete-own-posts policy already allows it; UI lands
  with the post-deletion step (B27 noted the same for ordinary posts).
- Share-card theming/branding options, muscle map on the card, a logo asset — later polish.
- Notifying the original author of a re-share — notifications are B47.
- Deep links back into Astra from a shared image — needs published store links; nothing to link
  to yet.

## Risks a reviewer should weigh

1. **The self-embed through PostgREST is the plan's one unproven server behaviour.**
   `original:posts!posts_shared_post_id_fkey(…)` nested four levels deep, read both from
   `posts` and through the recreated `post_hot_scores` view (B24 showed views resolve embeds
   through the carried FK columns, and that hint spellings can need adjusting live — the
   `!posts_user_id_fkey` lesson). The builder must probe the exact select against the live
   project early (a SQL-seeded re-share suffices) and record the working spelling; the fallback
   if a view-path embed refuses is a second request for originals by id, `loadPostScores`-style.
2. **Recreating `post_hot_scores` drops and re-adds a live view.** Seconds of window where a
   Hot read fails if it races the migration — acceptable on a pre-launch project, but the
   builder applies it as one migration (one transaction) and re-grants select; Gate 2 re-probes
   a Hot read.
3. **The capture is untestable until a phone runs it.** view-shot in Expo Go, share-sheet
   behaviour, PNG legibility at 1080×1350, Android content-URI handling — all device-only.
   Mitigations: both libraries are the ecosystem standard and Expo-Go-bundled/SDK-matched; the
   screen shows the exact view it captures (no hidden-view divergence); failure degrades to a
   message, never a crash. If Expo Go still can't capture, the card screen ships and LOG-8
   stays Built-not-Done until a dev build — recorded rather than worked around.

## Build record (builder, Nov 15, 2026) — deviations from the plan

- **Migrations:** `20261115154653_reshares.sql` (everything under "Server migration";
  `posts_kind_check` verified in `pg_constraint` before the drop) and
  `20261115160346_reshare_trigger_columns.sql` (review fix, below). Both applied live, files
  renamed to the recorded versions.
- **D1 — originals come in a second request (Risk 1's fallback).** Probed live with the publishable
  key: `original:posts!posts_shared_post_id_fkey(…)` is refused on `posts` (PGRST200 — the
  constraint-name hint finds no self-relationship) and through `post_hot_scores` the relationship is
  ambiguous both ways under one name (PGRST201); a `!shared_post_id` column hint parses on `posts`
  but not through the view. So `FEED_SELECT` carries only `shared_post_id`, and `loadOriginals`
  reads `posts?select=POST_CONTENT_SELECT&id=in.(…)` beside the scores request, only when the page
  has re-shares — one code path for both orders. RLS still decides: an original the viewer can't
  see doesn't come back and the re-share is dropped (it is already hidden by the read rule).
- **D2 — the trigger also guards updates.** `posts_reshare_shape` fires before insert **or an
  update naming `shared_post_id`, `flair_id` or `kind`** — otherwise the owner's update policy
  would let a hand-rolled request swap a re-share's flair (a downvotable flair on Physique Check
  content) or re-point it. Review found the first version (any update) also blocked a
  visibility-only update once the original went private; the second migration narrowed it to
  those columns. Probed: flair swap still lands on the original's flair; a visibility update on a
  hidden re-share now simply matches no row (the select policy hides the re-share from its own
  owner too — "visible to exactly who may see both" — and the B26 chip reports "can't be changed").
- **D3 — the confirm "sheet" is an inline confirm row** under the footer ("Re-share this post to
  your followers?" · Cancel · Re-share now), the B26 visibility-chooser pattern, rather than a
  modal. Same behaviour: asks first, one send, one-line result.
- **D4 — shared spellings moved into `workout/format.ts`** (review): `setsSummaryLabel` ("5 sets ·
  1 warm-up") and `sessionPrLine` ("Squat · 5RM · 225 lb", with `DELETED_EXERCISE`) are now used
  by both the analysis screen and the card, so "the analysis screen's exact spellings" can't drift.
- **D5 — Share on a feed card** appears on the viewer's own **workout** posts only (as planned), and
  Re-share is also hidden on a re-share of the viewer's own post (`canReshare`), since the server
  would refuse it.
- **Card styling:** maroon→black gradient, the "New PR(s)" heading in gold (brand red on the
  maroon band read too faintly), a thin red stripe at the foot; sizes scale from a 360-pt design
  width so every phone draws the same card. `shareAsync` also gets `UTI: 'public.png'` (iOS) and a
  dialog title (Android).
- **Live probes run by the builder** (three synthetic users in one rolled-back transaction):
  stamped flair; double re-share → 23505; self re-share and re-share-of-a-re-share refused; a
  downvote on the Physique Check re-share refused; C (follows B only) sees B's re-share and it is in
  the Hot view with `shared_post_id`; A makes the original private → hidden from C and from B, and
  a new re-share of it is refused; C mutes A → hidden, unmute → back; original deleted → re-share
  gone. **Not probed:** the full feed select through PostgREST as a signed-in user (no user token in
  the builder session) — the anon-key probe showed both selects parse (`posts` 200; originals
  request uses the same content select the feed already used).

## Grilling decisions (settled)

Run via `mattpocock-skills:grilling` in the planner session, self-answered at full severity
(the pipeline's planner holds the delegated decisions — CLAUDE.md, "Autonomous sessions");
every checkable claim verified in the repo. Revisions made in place: the hot-view recreate
re-adds its grant and B27 comment; the kind CHECK's auto-generated name is verified in the
catalog before dropping, not guessed.

- **G1 — "Why a new post kind at all? A re-share could be a row in a `reshares` join table."**
  Worked both ways. A join table means the feed query unions two shapes, `post_scores` /
  `post_hot_scores` / votes / comments / reports all need a second content type or re-shares
  can't be voted on, commented, reported or ranked — four features' machinery duplicated vs.
  one CHECK widened. The kind column was built for exactly this (B22's comment: "a later step
  relaxes it when another kind exists"). Settled: post kind, as the handoff steered.
- **G2 — "Queue re-shares offline like B21 queued workout posts?"** No. B21's queue exists
  because the post offer is one-shot at finish and finishes happen offline by design. A
  re-share is tapped on a feed card, and the feed only renders online; there is no offline
  moment where the action is possible but lost. B23 settled this exact question for votes and
  comments. Online-only direct insert; the typed-refusal UX is the votes one.
- **G3 — "The select policy now runs `can_view_post` (an EXISTS with more EXISTS inside) per
  posts row — feed cost?"** Checked: the arm is `shared_post_id is null or …`, so every
  existing post short-circuits on a null column; only re-share rows pay, and only for rows
  already passing their own visibility. `author_visible` on every vote/comment row (B27) is
  the standing precedent for this cost shape at launch scale. Revisit on evidence, like
  everything else.
- **G4 — "Re-share chains: A re-shares B's re-share of C."** Refused at the server (trigger)
  and redirected in the app: the Re-share action on a re-share card targets the original's id.
  Chains would make visibility transitive (walk the chain in RLS — recursion, cost) for zero
  product value; every mainstream implementation collapses to the original. Recorded so a
  later "quote post" step revisits deliberately.
- **G5 — "Stamping the flair server-side is new trigger machinery; the app already sends the
  right flair."** Kept: without it, a hand-rolled insert could put a downvotable flair on a
  Physique Check re-share, quietly voiding a CLAUDE.md privacy rule that B20–B23 spent three
  steps keeping data-driven. One SELECT in a BEFORE trigger, the `stamp_reported_user`
  pattern exactly. The copied flair in the app's insert stays — the row is honest even in
  tests against fakes.
- **G6 — "Why can't I export someone else's post? Screenshots exist."** Screenshots are the
  viewer's act outside the app; a Share button is Astra's act, and building it for
  followers-only or physique content makes the app the leak. The standing input ("it is their
  own card") settles it: export is for your own content. Own **photo** posts are also left out
  (not for privacy — the photo is the sharer's own file already in their camera roll; a card
  wrapper earns nothing yet). Noted honestly against SOC-6, whose DoD ("a post can be
  re-shared in-app and exported to the OS share sheet") is true: workout posts export, every
  post re-shares.
- **G7 — "Is `visibility: 'public'` the right birth value for a re-share, when B21 copied the
  workout's?"** Yes: a re-share shares no content of the resharer's own — the sensitive thing
  is the original, and the policy's `can_view_post` arm keeps its rules in force whatever the
  re-share's own visibility says. The owner can still tighten it with the B26 chip (policy
  verified to allow updates on `workout_id is null` rows). Copying the original's visibility
  was rejected: a 'followers' copy would mean the *original author's* followers gate stamped
  as the *resharer's* followers gate — same word, wrong people.
- **G8 — facts checked in the repo:** (a) `posts_kind_shape` and the inline kind CHECK are as
  B22 wrote them; `workout_id` is already nullable; the partial-unique-index pattern is new
  but `posts_workout_unique` shows nulls-distinct behaviour is relied on already. (b)
  `private.can_view_post` is security definer, reads the true posts row, and routes through
  `workout_visible`, which since B27 includes blocks **and** mutes — a re-share by a muted
  lifter is hidden by the policy's first arm, a re-share **of** a muted lifter's post by the
  `can_view_post` arm. Both probes are in the test list. (c) `post_hot_scores`' column list
  carries every FEED_SELECT embed column; its own comment demands the new column join it in
  the same commit; `post_scores` needs nothing. (d) The B26 lockstep trigger fires only
  `when (new.workout_id is not null …)`. (e) `loadFeedPage` is the one feed reader (Home +
  ProfileView), so re-shares reach both surfaces from one change. (f) `lib/ids.ts` exports
  `newUuid`. (g) Neither `react-native-view-shot` nor `expo-sharing` is installed; view-shot
  is on Expo Go's bundled-modules list and expo-sharing is an SDK module — both free, no
  services, no accounts (the no-spend rule holds). (h) `analysisForScreen` returns analysis +
  workout for exactly the card's needs, offline. (i) The moderate function's remove-post
  deletes the posts row — the new FK cascade takes re-shares with it, nothing to change.
- **Scope verdict (planner):** right as written. The one deliberate narrowing — OS export of
  photo posts and of other people's posts — is recorded against SOC-6 with its reasoning, and
  the step DoD is untouched by it. The one place the plan spends beyond the obvious is the
  flair-stamp trigger (G5), bought to keep an existing hard rule unbreakable rather than for
  this feature's own sake.
