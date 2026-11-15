# post-privacy — B26: per-post visibility and the Settings privacy section

**Branch:** `post-privacy` (from `main`)
**Build step:** B26 — covers **YOU-5** (visibility controls: public-by-default account, any
single post can be made private), part of **NFR-5** (the *user-set* visibility choice for
progress pics; body data and recovery data are covered elsewhere — see the scope readings), and
part of **YOU-4** (the Privacy section of Settings).
**Depends on:** B22 (the `posts_progress_pic_private` CHECK this step relaxes, the `post-images`
storage policy that follows a post's visibility, `mediaLimits`/`createImagePost`) and B25
(profiles and the own-profile Posts tab, a surface the toggle appears on).

## Step definition of done (from the Build order)

Per-post private toggle enforced by RLS; privacy section in Settings for progress-pic and
body-data visibility. **A private post is invisible to any other user through the API, not just
hidden in the UI.**

## What already exists (B26 adds controls, not enforcement)

Verified in the repo, not assumed:

- `posts` carries `visibility public.workout_visibility` and its select policy is
  `using (private.workout_visible(user_id, visibility))` — a private post is *already*
  invisible to everyone but its author through the API, probed live as two users at B20/B22.
- The `post-images` storage select policy reads the citing post's visibility through the same
  helper, so a post toggled private hides its photo too — by construction, to be probed live.
- `posts` has an owner `update` policy (B20, recreated B22), so changing `visibility` on your
  own row is an ordinary PostgREST update; RLS refuses it on anyone else's row.
- `posts_progress_pic_private` (B22) CHECK-locks progress pics to `private` — **B26 is the step
  that drops it**, the day the user-facing choice exists (B22's own recorded handoff).
- `user_settings.default_workout_visibility` exists on the server but only `unit` is mirrored on
  the phone (B15); device workouts are born `visibility 'public'` (hardcoded in
  `activeWorkout.ts`), and nothing anywhere changes a workout's or a post's visibility after
  creation — B26 introduces the first changer.
- `FeedPost` already carries `visibility` and the author's id, and `PostCard` already takes
  `viewerId` (the B22 "Only you can see this post" line) — the card can render an owner-only
  control without a feed-shape change.

## Scope readings settled up front

- **The per-post control offers all three visibilities (Public / Followers / Private), not a
  binary toggle.** The enum, the RLS and the storage policy already enforce `followers`
  end-to-end (same `workout_visible` home); YOU-5's "can be made private" is the subset the DoD
  names. A binary toggle would be the same code with one option hidden, and would strand a
  followers-visibility progress pic (possible via the new Settings default) with no way back to
  followers once toggled. Cost of the third option: one more chip.
- **Changing a workout post's visibility also changes its workout's visibility (lockstep), by a
  server trigger.** B21 (G7) made post visibility *inherit* the workout's at birth; the handoff
  orders this step to keep the two from diverging or own the divergence deliberately. Divergence
  is a real privacy hole, not a cosmetic state: B25's profile History tab shows another user's
  workouts under workout RLS, so "post private, workout still public" would hide the feed card
  while the same session stays readable on the owner's public History — the lifter pressed
  "private" and the content stayed visible. Lockstep in the other direction also prevents the
  "public post over a private workout" husk (dropped client-side, confusing to the owner).
  So: *the post's visibility is the workout's visibility, changed together, in one server
  transaction* (trigger below). Photo posts have no workout; nothing extra happens. Flagged for
  Gate 1 as the plan's main product reading; the alternative (post-only, History divergence
  accepted and documented) is a one-trigger deletion if overruled.
- **The toggle is an online write, like every social write** (votes, comments, follows, profile
  edit — the established precedent). The surfaces that show the control (Home feed, profile
  Posts tab) are server-read and unreachable offline, so an offline toggle would be a control
  the lifter can never reach; a queued-but-unpushed post isn't on those surfaces either, so the
  online update can never race its own insert. Offline-first governs logging and the Tool Kit
  (CLAUDE.md); it is not violated here.
- **The Settings progress-pic choice is a `user_settings` column, mirrored on the phone.** The
  handoff left the planner the choice between a settings column and per-post-only. It must be a
  stored, mirrored setting because `createImagePost` runs *offline* (airplane-mode posting is a
  B22-proven path) and has to know what visibility a new progress pic is born with — a
  server-side-only setting would be unreadable at creation time. Per-post-only (a picker on the
  Share-a-photo screen) would also leave the step scope's literal words — "privacy section in
  Settings for progress-pic … visibility" — unbuilt. The column rides B15's existing settings
  push/pull phases; no new sync machinery.
- **"Body-data visibility" ships as a stated fact, not a control — a deliberate narrowing of
  the scope sentence, said here as CLAUDE.md requires.** `user_body_data` is owner-only by RLS
  (B02) and *nothing in the product reads it yet* — no grades (B38+), no trends (B46). A
  visibility picker for data nothing can show anyone is a control with no observable effect:
  untestable, speculative (the handoff's standing input says exactly this). The Privacy section
  therefore shows a Body data row stating "Only you — body data never leaves your account", and
  the user-set *choice* lands with the first step that gives body data a reader, which also
  knows what granularity the choice needs (per-field? per-consumer?). NFR-5 stays `In progress`
  (it waits on B54 recovery data regardless); Gate 2 should reword NFR-5's DoD note to record
  that the body-data choice moved out of B26 with this rationale.
- **No creation-time visibility picker on the Share-a-photo screen.** The Settings default
  decides what a progress pic is born with; the per-post control changes any post afterward.
  Between them every reachable state is reachable; a third surface for the same choice is
  scope the step doesn't name. The screen's privacy caption becomes *true* instead
  of hardcoded (it reads the setting: "Only you can see this post" / "Your followers can see
  this post" / "Anyone on Astra can see this post").
- **"Public-by-default account"** (YOU-5's first clause) is already true — accounts post
  publicly unless the lifter chooses otherwise (`default_workout_visibility` default `'public'`,
  device workouts born public, PR photos born public; progress pics are the deliberate
  sensitive-class exception, born from the new setting whose default is `private`). No
  account-wide private switch is named by any P0 feature; none is built.

## Data model impact

### Server migration (one file, applied live via MCP then renamed to the recorded version)

```sql
-- 1. The lifter's choice for new progress pics. Private by default: the sensitive class
--    keeps its B22 posture unless the owner says otherwise. Mirrored on the phone
--    (schema V10) because posting runs offline.
alter table public.user_settings
  add column progress_pic_visibility public.workout_visibility not null default 'private';

-- 2. The B22 lock comes off: visibility of a progress pic is now the owner's choice.
--    (B22's migration comment names this step for exactly this.) Enforcement of whatever
--    the owner chose is unchanged: posts select RLS + the storage read policy, both through
--    private.workout_visible.
alter table public.posts drop constraint posts_progress_pic_private;

-- 3. A workout post and its workout stay in lockstep when the post's visibility changes.
--    Invoker rights (NOT security definer): the posts update policy already guarantees the
--    updater is the post's author, and the author owns the workout (insert policy's
--    owns_workout check), so the workouts owner-update policy passes; the trigger gains no
--    power the user lacks. The workouts moddatetime trigger bumps updated_at, so other
--    devices pick the change up on their next pull.
create or replace function private.sync_workout_visibility_with_post()
returns trigger language plpgsql set search_path = ''
as $$
begin
  update public.workouts
    set visibility = new.visibility
    where id = new.workout_id and visibility is distinct from new.visibility;
  return new;
end;
$$;

create trigger sync_workout_visibility
  after update of visibility on public.posts
  for each row
  when (new.workout_id is not null and new.visibility is distinct from old.visibility)
  execute function private.sync_workout_visibility_with_post();
```

Nothing else moves: no policy changes, no new table, no storage changes. The direction
workout→post needs no trigger because nothing changes a workout's visibility except this
trigger (the first per-workout visibility control, if one is ever scoped, brings the mirror
trigger with it — recorded in Out of scope).

### Device schema V10 (`frontend/src/db/schema.ts`)

```sql
alter table user_settings add column progress_pic_visibility text not null default 'private';
```

Plain add-column (no rebuild); existing rows get `'private'`, matching the server default. The
V6 comment's expectation that `default_workout_visibility` "joins when B26 gives it a reader"
is corrected in place: B26's reader is the *progress-pic* column; `default_workout_visibility`
still has no device reader and stays unmirrored (workouts are born `'public'` hardcoded).

## App changes

### Settings row widens without the two settings clobbering each other

`db/userSettings.ts`: `UserSettingsRow` gains `progress_pic_visibility: WorkoutVisibility`;
`parseVisibility(value)` joins `parseUnit` (anything unrecognized → `'private'`, the safe
default for a damaged file); `writeUserSettingsRowTx` writes/replaces the full row (used by
pull, which always has the whole server row).

**The clobber trap, named for the builder:** `unitStore.setUnit` today constructs a whole row
from scratch — with the widened upsert it would silently reset `progress_pic_visibility` to the
default every time the unit is toggled. Both setters therefore go through one new
`patchUserSettingsTx(tx, userId, patch, now)` — read the current row inside the transaction
(defaults if none), merge the patch, write the merged row, `enqueueTx` — and `setUnit` is
rewritten onto it. A unit toggle then provably preserves the privacy choice and vice versa
(unit test pins exactly this).

Sync carries the column with no structural change:

- `transport.pushUserSettings` signature widens to take the row's two settable fields and the
  Supabase implementation updates `{ unit, progress_pic_visibility }` (still a plain update,
  never an insert). An old client updating only `{ unit }` can't clobber the new column —
  recorded compatibility, no shim.
- `pullUserSettings`'s select adds the column, parsed through `parseVisibility`.
- `fakeTransport` mirrors both. The push/pull phases themselves are untouched — they move the
  row, not its columns.

### Progress pics are born from the setting

`createPost.ts`: `IMAGE_POST_DEFAULTS` keeps the flairs; the visibility of a new post comes
from `imagePostVisibility(db, userId, kind)` — `'pr'` → `'public'` (unchanged), `'progress-pic'`
→ the settings row's `progress_pic_visibility` (no row yet → `'private'`). Read on the phone, so
airplane-mode posting keeps working; the server CHECK that used to force `private` is gone, and
the born visibility is whatever the lifter chose.

### The per-post control (`social/postPrivacy.ts`, new)

`setPostVisibility(client, db, me, post, next)` — the votes/`updateProfile` online-write shape,
never throws, returns done-or-refusal:

1. `client.from('posts').update({ visibility: next }).eq('id', post.id).eq('user_id', me)
   .select('id')` — zero rows back means the post is gone or not mine ("This post can't be
   changed right now"); a connection failure returns the standard calm sentence. RLS is the
   enforcement; the `eq('user_id', me)` is belt-and-braces, not security.
2. The server trigger has already moved the workout (workout posts) in the same transaction.
3. On success, bring the *local mirrors* in step, without outbox lines (the server already
   knows): the local `posts` row if this phone created the post, and — the load-bearing one —
   the local `workouts` row for a workout post. Without the workout update, a later offline
   edit of that workout (B14) would push the stale `'public'` visibility back up in its full-row
   upsert and silently undo the lifter's choice. With it, the next push carries the new value.
   The remaining hole — device B holds a stale copy and edits offline before its next pull — is
   the same multi-device last-write-wins race B14 recorded and accepted; noted, accepted,
   self-heals on pull.

### UI

| Piece | Change |
|---|---|
| `components/social/PostCard.tsx` | Own posts (viewerId === author.id) grow a visibility control in the card: a small chip showing the current state ("Public" / "Followers" / "Only you"), tappable; tapping opens a three-option chooser (modal sheet, each option with its one-line meaning); choosing calls `setPostVisibility` through a new `onChangeVisibility` callback prop — optimistic flip, calm revert + message on refusal (the FollowButton/votes pattern). The B22 `ONLY_YOU_LINE` on own progress pics is subsumed by the chip ("Only you" state) — one home for "who can see this", its tests updated rather than duplicated. Other people's cards are pixel-identical. |
| `app/(tabs)/index.tsx`, `components/profile/ProfileView.tsx` | Wire `onChangeVisibility` where each already wires `onVote` (Home feed; profile Posts tab). A toggled-private post stays on the owner's own screens (owner always sees own posts) with its chip now reading "Only you" — nothing vanishes in front of the lifter. |
| `app/settings.tsx` | A **Privacy** section between Units and Account: **Progress pics** — "Who can see new progress pics" with Private / Followers / Public choices (default Private), bound to the mirrored setting, saved offline exactly like the unit (patch + enqueue + `notifyLocalWrite`; error line on a failed local save). A small line notes existing posts are changed on the post itself. **Body data** — a static row: "Only you. Body data never leaves your account." No control (see scope readings). |
| `app/new-post.tsx` | The progress-pic privacy caption reads the settings row instead of hardcoding "private", and the PR caption stays "PR photos post publicly". |

The three-choice chips reuse `ChoiceChips`, which moves from `components/toolkit/` to
`components/ui/` in this step — B24 recorded the move for "a tidy-up pass"; this step makes it
a four-consumer component (Tool Kit, Home, Settings, the card sheet if it fits), which is the
rule-of-three met. Pure move + import updates, no behavior change. If the card's sheet wants a
different shape than chips, the sheet is its own small component and only Settings reuses
`ChoiceChips`.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_post_privacy.sql` | new — settings column, drop `posts_progress_pic_private`, lockstep trigger |
| `frontend/src/db/schema.ts` (+ test) | edit — V10 add-column; fix the V6 comment |
| `frontend/src/db/userSettings.ts` (+ test) | edit — widened row, `parseVisibility`, `patchUserSettingsTx` |
| `frontend/src/settings/unitStore.ts` (+ test) | edit — `setUnit` through the patch helper (no clobber) |
| `frontend/src/settings/privacySettings.ts` (+ test) | new — read the current choice, `setProgressPicVisibility(db, userId, v)` (patch + enqueue + notify); no reactive store — only Settings and post-creation read it, both on demand |
| `frontend/src/sync/transport.ts` | edit — `pushUserSettings` carries both fields |
| `frontend/src/sync/supabaseTransport.ts` (+ test) | edit — update both columns; pull selects + parses the new one |
| `frontend/src/test-utils/fakeTransport.ts` | edit — mirror both |
| `frontend/src/social/createPost.ts` (+ test) | edit — progress-pic visibility from the setting |
| `frontend/src/social/postPrivacy.ts` (+ test) | new — `setPostVisibility` + local-mirror updates |
| `frontend/src/components/social/PostCard.tsx` (+ test) | edit — owner visibility chip + chooser; `ONLY_YOU_LINE` subsumed |
| `frontend/src/components/ui/ChoiceChips.tsx` | moved from `components/toolkit/` (imports updated) |
| `frontend/src/app/(tabs)/index.tsx`, `components/profile/ProfileView.tsx` (+ tests) | edit — wire `onChangeVisibility` |
| `frontend/src/app/settings.tsx`, `frontend/src/__tests__/settings.test.tsx` | edit — Privacy section |
| `frontend/src/app/new-post.tsx`, `frontend/src/__tests__/new-post.test.tsx` | edit — caption reads the setting |
| `frontend/src/test-utils/fakeSocialClient.ts` | edit — `update` on `posts` with eq-chaining + select, if not already supported |
| `docs/diagrams/database-erd.md`, `docs/diagrams/app-flow.md` | edit (Document step) — column, dropped CHECK, trigger; toggle and Settings data paths |

Builder footguns (precedent B09–B25): no new routes, but run `npx expo start --offline`
(~150 s) → `tsc --noEmit` → lint → Jest in that order anyway (the stale `router.d.ts` trap).
Apply the migration live via MCP, rename the file to the version `list_migrations` records.
Jest never touches the live project. The `settings.test.tsx` route test gets the database
through the established harness; the privacy chips need `db` to be present like the unit toggle.

## How each definition of done becomes observably true

- **Step DoD ("a private post is invisible to any other user through the API"):** the
  enforcement is the existing, live-probed posts RLS — this step proves it holds for *toggled*
  states. Jest: `setPostVisibility` issues exactly the scoped update and reports refusals;
  the card shows the control to the owner only (a viewer's card has no control — pinned).
  **Gate 2 live probe (two synthetic users, cleaned up):** B toggles a public workout post
  private → A's feed select and direct `posts` select return nothing, and B's *workout* is gone
  from A's view of B's History (the trigger's lockstep, both tables checked); B toggles a
  progress pic to `followers` → follower A sees the post row **and can fetch the storage
  object**, stranger C gets neither (the handoff's "probe it live" for the object following the
  post); toggle back private → both dark again; A updating B's post refused by RLS (0 rows).
- **YOU-5:** any single own post — workout, progress pic, PR photo — has the control on its
  card (Jest renders all three kinds as owner and flips one); privacy enforced server-side per
  the probes above; public-by-default recorded in scope readings (no code to write).
- **YOU-4 (privacy part):** the Settings Privacy section exists and takes effect immediately —
  Jest: choose Followers in Settings (fake db, offline transport), then `createImagePost` a
  progress pic → the row is born `followers`, queued, and the pushed row carries it; the unit
  test for `patchUserSettingsTx` pins that a unit toggle preserves the choice and vice versa.
- **NFR-5 (this step's part):** the user-set visibility choice for progress pics exists
  end-to-end: Settings default (above) + per-post change (probes above), all enforced by the
  same RLS that was probed as two users at B22, re-probed toggled at Gate 2. Body data: the
  Settings row states the owner-only fact; the *choice* is recorded as moving to the first
  reader step (scope readings) — Gate 2 updates the BUILD_LIST wording.
- **Offline:** the Settings choice is saved and queued with the transport dead, survives a
  simulated relaunch, and one healed sync lands it on the (fake) server exactly once — the B15
  unit test shape, re-run for the new column.

## Out of scope (and where it lands)

- **Default workout visibility** (a Settings choice for new *workouts*) and any per-workout
  visibility picker — not named by this step; lands with a future privacy pass, which also
  brings the workout→post lockstep trigger. `default_workout_visibility` stays unmirrored.
- **Body-data visibility control** — the first step that reads body data (B38+ grades, B46
  trends); recorded in scope readings.
- **Recovery-data visibility** — B54.
- **Account-wide private switch** — no P0 feature names one.
- **Block / mute / report, founder moderation** — B27.
- **Notifications section of Settings** — B47.
- **Creation-time visibility picker on Share a photo** — covered by default + per-post control.
- **Deleting posts, "remove photo"** — the later SOC deletion step (B25 leftover rides there).
- **Feed preference roaming** (`user_settings` column for Latest/Hot, B24 G1) — still nothing
  asks for it; not bundled in even though this step touches the settings row.

## Risks a reviewer should weigh

1. **Dropping `posts_progress_pic_private` converts a CHECK-enforced guarantee into a
   user-set one.** After this migration the only thing keeping a progress pic private is its
   row's `visibility` under the same RLS as everything else — which is the design, but it means
   the Gate 2 probe matrix (post row *and* storage object, as owner / follower / stranger,
   across a toggle in both directions) is the non-negotiable proof that nothing leaks in the
   new states. The storage policy was written (B22) to follow visibility dynamically; this step
   is the first time any state but `private` exercises it for progress pics.
2. **The lockstep trigger is the repo's first trigger that writes a second table on a user's
   update, with invoker rights.** The RLS reasoning (post author ⇒ workout owner ⇒ workouts
   update policy passes) must hold in the live project, and the client-side mirror update in
   `setPostVisibility` is what stops a later offline workout edit pushing the old visibility
   back. Both halves need their tests (trigger probed live; mirror pinned in Jest), and the
   accepted multi-device race should be re-read at review.
3. **The settings row now has two writers through one upsert.** The read-modify-write
   `patchUserSettingsTx` is what keeps `setUnit` from resetting the privacy choice (and the
   reverse); a regression here silently flips a sensitive-class default. The clobber test
   (toggle unit → privacy unchanged; change privacy → unit unchanged; both offline-queued and
   pushed as one row) is small and load-bearing.

## Grilling decisions (settled)

Worked in the planner session at full severity (the `mattpocock-skills:grilling` question
tree, the session holding both sides per the autonomous-session delegation); every checkable
claim verified in the repo, not assumed.

- **G1 — "Lockstep trigger: you're changing a workout the user didn't tap. Defend it."** The
  alternative states were walked: post-only private leaves the session readable on the public
  History tab (B25 ships that surface — checked) after the lifter pressed "private"; that is a
  privacy astonishment in the sensitive direction. The symmetric astonishment (making a post
  public re-publicizes the workout) is the lifter's explicit action on a card that *shows the
  workout's content* — the card is the workout, to the user. B21 already fused the two at
  birth ("the two can never disagree" — `createWorkoutPost`'s own comment); this keeps that
  sentence true after the first mutation exists. Flagged as the plan's main product reading
  for Gate 1; removal is one trigger + one probe if overruled.
- **G2 — "Why a trigger and not two client updates?"** Two updates lose atomicity (a failure
  between them creates exactly the divergence this step exists to prevent, invisibly), and the
  invariant would live in app code where the *next* writer of `posts.visibility` can forget
  it. The trigger is the server-side single home, the same reasoning that put visibility in
  `workout_visible`. Invoker rights over definer: the trigger should gain no power the updater
  lacks; ownership is already guaranteed by the posts policies (checked: insert requires
  `owns_workout`, update requires author). Risk 2 carries the live-probe obligation.
- **G3 — "Three options or two? YOU-5 only says private."** Three. Enforcement for
  `followers` exists end-to-end (checked: `workout_visible` handles it; the storage policy
  delegates to it), the Settings default can legitimately be `followers` (a progress pic for
  followers only is a mainline physique-community expectation), and a binary per-post toggle
  would turn a followers pic public with no road back. The DoD's "private is invisible" is a
  subset, fully probed.
- **G4 — "Settings column vs per-post only — the handoff left it open."** Column, because
  `createImagePost` is offline (B22-proven path) and must know the born visibility; the step
  scope's words name a Settings section for it; and the mirrored-settings machinery exists
  (B15) so the marginal cost is one column riding existing phases. Per-post-only was the
  cheaper build but leaves the scope sentence unbuilt and makes every progress pic born
  `private` forever with a manual flip each time — the setting is the product.
- **G5 — "Body data: the scope sentence says a visibility control. You're shipping a
  sentence."** Yes, deliberately, and the plan says so where CLAUDE.md requires ("if the scope
  is wrong, say so in the plan"). A control over data with no reader has no observable effect —
  it cannot meet any definition of done, violates "add nothing speculative", and the handoff's
  standing input instructed exactly this narrowing. The Privacy section states the stronger
  fact ("only you, always"), which is the *current truth* and the strictest possible setting;
  the choice ships when a reader exists to make it mean something. NFR-5's BUILD_LIST wording
  is corrected at Gate 2 so the ledger matches.
- **G6 — "The clobber trap: did you invent `patchUserSettingsTx` or is it needed?"** Checked
  in code, not assumed: `unitStore.setUnit` writes `{ user_id, unit, updated_at }` through an
  upsert whose `do update set` clause will, once widened, replace every named column — so
  either the upsert names only its caller's columns (two near-identical SQL spellings, the
  mirrored-copy smell) or writes go through one read-merge-write helper. The helper is
  smaller and testable. The push side has the same property server-side (one update naming
  both columns) and is safe because the local row is always merged first.
- **G7 — "Why is the toggle online-only in an offline-first app?"** Social writes are online
  by established precedent (votes B23, comments B23, follows B20, profile edit B25 — all
  recorded in their plans), and the control's only surfaces are server-read feeds, unreachable
  offline; an offline toggle would be unreachable UI. The *setting* (which is reachable
  offline, in Settings) is mirrored and queue-synced. Checked: a not-yet-pushed post appears on
  no server-read surface, so the online update cannot race its own insert.
- **G8 — "Does anything else write `posts.visibility` or `workouts.visibility` that this step
  breaks?"** Checked: nothing. Workouts are born `'public'` (one literal in
  `activeWorkout.ts`); posts inherit at creation (`createWorkoutPost`) or are born from
  defaults (`createImagePost`); B14's edit surface touches sets/title/notes, never visibility.
  The trigger and `setPostVisibility` are the only movers, so the lockstep invariant has
  exactly one entry point.
- **G9 — "The local-mirror update after a toggle — why not enqueue it and let sync carry it?"**
  Enqueueing would push a row the server already has (harmless) but, for workouts, would also
  re-upsert *every* column from a local row that may be mid-edit — gratuitous writes and a
  wider race surface. The server is already authoritative (the toggle just landed there); the
  mirror update exists only so later pushes carry truth. No outbox line is the smaller,
  correct write. The multi-device stale-edit race stands either way and is B14's accepted
  class.
- **G10 — "`ONLY_YOU_LINE` removal: a tested behavior disappears."** Subsumed, not removed:
  the owner's private post still states "Only you" — now via the chip, on every own post kind,
  not only progress pics — and the tests move with the behavior. Keeping both line and chip
  would say the same fact twice on one card.
- **G11 — facts checked in the repo:** (a) the posts update policy survives a visibility
  change on image posts (`workout_id is null or owns_workout` — B22's recreate); (b)
  `FEED_SELECT` already returns `visibility` and `PostCard` already takes `viewerId`; (c)
  SQLite `alter table add column` with `not null default` is legal (V10 needs no rebuild);
  (d) the settings pull has no bookmark (read whole each time), so the new column needs no
  cursor thought; (e) `fakeSocialClient` supports `update().eq()` chains for profiles (B25) —
  posts update support is an extension, not new machinery; (f) `ChoiceChips`' move was
  pre-recorded by B24 as a wanted tidy-up; (g) moddatetime on `workouts` bumps `updated_at`
  on the trigger's update, so B-device pulls converge; (h) the storage select policy reads
  visibility per-fetch (no caching layer in between), so a toggle changes object readability
  immediately.
- **G12 — late catches settled in place:** the chooser must disable its options while a change
  is in flight (double-tap sends one update); a refusal reverts the optimistic chip with the
  calm message; the Settings line "existing posts are changed on the post itself" prevents the
  misreading that the default rewrites history; `parseVisibility`'s unknown-value fallback is
  `'private'` (fail closed, it guards a sensitive class) while `parseUnit`'s stays `'lb'` —
  the asymmetry is deliberate and commented.
- **G13 — second-round catches (settled in place):** (a) the Settings privacy chips re-read
  the row on screen focus so a pull that lands mid-session isn't shown stale — but no reactive
  store (two on-demand readers don't earn one; the unit's store exists because every screen
  shows weights); (b) a retried `pushPost` upsert re-updating the same visibility cannot
  re-fire the lockstep trigger — the `when (… is distinct from …)` guard makes it a no-op,
  checked against B21's retry path; (c) the local workout-mirror update does not invent an
  `updated_at` — the next pull overwrites with the server's authoritative row regardless, and
  the mirror exists only so interim pushes carry truth.
## Builder deviations (B26 build)

- **D1 — the per-post chooser expands inline under the chip, not a modal sheet.** Same three
  `ChoiceChips` options, disabled while a change is in flight, revert + message on refusal. It
  shows the *chosen* option's one-line meaning under the chips; every option's meaning is in its
  screen-reader label ("Followers: Your followers can see this post"). Inline is simpler, needs no
  sheet component, and keeps the card's context visible.
- **D2 — `ONLY_YOU_LINE` removed (subsumed, as G10 planned).** The chip reads "Only you"; the
  sentence "Only you can see this post" lives once, in `VISIBILITY_WORDS` (`social/postPrivacy.ts`),
  shared by the card, Settings and Share a photo.
- **D3 — `IMAGE_POST_DEFAULTS` keeps only the flair**; visibility comes from the new
  `imagePostVisibility(db, userId, kind)`.
- **D4 — Share a photo's progress-pic line adds where the choice is changed:** "Your followers can
  see this post. Choose who sees new progress pics in Settings." (`privacyLine` replaces the
  `PRIVACY_LINES` constant).
- **D5 — one order everywhere: Only you · Followers · Public** (most private first,
  `VISIBILITY_ORDER`), on the card and in Settings.
- **D6 — review fixes beyond the plan:** after an accepted change, Home and ProfileView also rewrite
  their stored post lists (`withPostVisibility`), so a FlatList card rebuilt after scrolling can't
  show the old audience; `setPostVisibility` calls `notifyLocalWrite(['posts','workouts'])` after
  the local mirror so phone-read screens redraw; `visibilityTargetOf(post)` is the one home for
  "post → change target"; a stale refusal line clears when the chooser is toggled.
- **D7 — live probe done at build time, not left to Gate 2** (three synthetic users, deleted after;
  recorded in `docs/diagrams/database-erd.md` → Post privacy). It confirmed the invoker-rights
  trigger works under `authenticated`, though that role has no `usage` on the `private` schema —
  a trigger function is called by its id, not looked up by name.
- **D8 — `fakeTransport` no longer imitates the dropped `posts_progress_pic_private` CHECK**, and
  `fakeSocialClient` answers `update(…).select()` with the changed rows.

- **Scope verdict (planner):** right as written, with one deliberate narrowing said out loud
  (body data, G5) and one product reading flagged for Gate 1 (lockstep, G1). The three-option
  control (G3) is the same machinery as the named toggle, not a widening; the `ChoiceChips`
  move is a pre-recorded tidy-up this step finally earns. Nothing else added; default workout
  visibility explicitly refused.
