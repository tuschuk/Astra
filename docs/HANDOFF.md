# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B20 merged; pipeline on B21)

**Sixteen pipeline steps are merged to `main`.** Phase 1's logging, analysis and Tool Kit are
built, and the first social step is in: posts, flairs, the Home feed and follow / unfollow. The
pipeline is running **B21 finish-to-post**. Gates are delegated to the session (CLAUDE.md,
"Autonomous sessions"). Tristen's hands-on list is at the end.

**B20 posts-and-feed (merged, Gate 2 record):** migration `20261115093217_posts_flairs.sql`
(applied live, confirmed at Gate 2): `flairs` (four seeded rows, `upvotes_only` true on Physique
Check, read-only to clients) and `posts` (client-generated id, `flair_id not null`, `workout_id
not null` + `unique (workout_id)`, `visibility` reusing `workout_visibility`, cascades from
workout and profile; select via `private.workout_visible(user_id, visibility)`, insert / update
require `owns_workout(workout_id)`). Builder's rolled-back live probe covered followers-only,
blocks both ways, foreign-workout insert refused, duplicate post refused, private workout
dropping out of the feed. App: `social/feed.ts` (followees + self, embedded workout tree with
`workouts!inner`, keyset pages of 20), `social/follows.ts` (sanitized `ilike` search, follow /
unfollow with block-refusal handling), `components/social/{PostCard,UserCard,LetterAvatar}`,
Home tab rewritten as the feed (reloads on focus, empty / offline states), `app/find-lifters.tsx`.
Sets print through `format.ts`, closing LOG-13's feed clause. No device schema or sync change.
Gate 2 reran in order: regenerate typed routes → `tsc` clean → lint clean → Jest 84 suites /
890 tests on a cold cache. Statuses: B20 Built; SOC-1, SOC-3, LOG-13 Built; SOC-7 In progress
(counts at B25). Not yet exercised through the real REST API with a user token: the embed
select, the keyset filter and the escaped search — the device check covers them.

**Earlier:** B19 muscle-map (ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9
part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units
(LOG-6), B14 edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12
workout-notes (LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14,
LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07
local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B21 finish-to-post** (planning now): after the analysis, a Post step with flair selection,
skippable, creating a workout post that links the workout and its analysis; DoD: the flow always
runs after finish and can be skipped at the post step. Standing inputs for its planner: posts
carry a client-generated id and `unique (workout_id)` so creating one is idempotent and "already
posted?" is answerable from the schema; `posts.visibility` should default to the workout's
visibility (B20's G7 — a public post over a private workout is invisible to everyone but the
owner); the flair picker renders `flairs` rows (never hard-coded names); posts are **not** in
the device mirror or outbox today — B21 decides whether an offline finish queues the post (the
outbox typing is `SyncedTable`; widening it is a deliberate call) or posts online-only with a
retry; `workout_analyses.id` = the workout id, so "links the workout and its analysis" needs no
new column unless the planner wants an explicit FK; the analysis screen already replaces onto
itself after Finish — the Post step hangs off it.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Update to the latest main: `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, `npm
ci` in `Astra-main\frontend`, then `npx expo start --lan`. Currently serving `3c901ad` (through
B13).

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start). Check
order: `expo start --offline` ~150 s → `tsc` → lint → Jest; Gate 2 frees ports 8097 / 8099 of
builders' leftover Expo processes. Session helper: `automation/state/pipe.mjs` (gitignored;
`latest`, `approve <id>`, `retry <id>`, `trigger`). Executions 4/5 (B05) through 20 (B20); B21
is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7, B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0,
B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5, B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5,
B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3 (≈ $219 for sixteen steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree first): sign up
under 18 → refused; sign up 18+; kill and reopen still signed in; log a multi-exercise workout
with every set type and notes, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → View workout → PR badges; History; Edit and Delete; Settings → kg
toggle; Tool Kit calculators and timer; Home → Find lifters → follow a second test account and
see its post (insert a `posts` row by SQL until B21 ships), search for a name containing `_`;
reconnect → rows in Supabase; sign out. Flips B05–B20 and their features to Done as each holds.
(2) Supabase Dashboard → Authentication → Providers → Email → turn "Confirm email" off (plan of
record; the session's toggle was declined by the permission layer). (3) The six external
blockers. (4) Whether to grant `mmdc` (and Deno) to headless runs. (5) Product readings to
confirm or overrule: no bodyweight rep-record PR book (B10/B13); the bare "e1RM" label on the
entry card and history (B13); muscle shading by max, not volume (B19); one post per workout and
your own posts on your own Home (B20).

Next pipeline step after B21 merges: **B22 image-posts-and-media-limits**.
