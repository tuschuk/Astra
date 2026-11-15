# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 15, 2026 — B05–B32 merged; pipeline on B34)

**Twenty-eight pipeline steps are merged to `main`.** Every P0 step through B32 is Built: Phase
1 logging, analysis and Tool Kit; the social layer through share cards; the library through
custom exercises; export and account deletion. B33 video-service is Blocked (video provider),
so the pipeline is running **B34 program-builder**, the first Phase 2 step. Gates are delegated
to the session (CLAUDE.md, "Autonomous sessions"). Tristen's hands-on list is at the end.

**B32 export-and-delete-account (merged, Gate 2 record):** no migration (the cascade graph was
verified live by the planner table by table: `profiles → auth.users` CASCADE and every
user-owned table cascades from `profiles`; `posts.shared_post_id` CASCADE means other users'
re-shares of a deleted user's posts go too; storage has no FK so the buckets are swept by
hand). Two edge functions deployed and ACTIVE with `verify_jwt`: **`export-data`** (v1) runs
only with the caller's token — RLS scopes it and every read also filters to the caller because
public workouts of others would otherwise be readable — and pages/chunks past the 1000-row cap,
returning one JSON document (`format: 'astra-export'`, `version: 1`, `units: 'kg'`, user,
profile, settings, bodyData, customExercises incl. soft-deleted, workouts → exercises → sets,
personalRecords, analyses, authored posts rows, plus `exerciseNames` and `flairs` id→name maps);
**`delete-account`** (v2) requires `{ confirm: "DELETE" }` (400 otherwise), refuses moderators
(409), sweeps `post-images` and `avatars` under the caller's prefix **first**, then
`auth.admin.deleteUser` — sweep-first so any failure leaves the account intact and retryable.
App: `account/functionCalls.ts` (tells offline from server refusal), `account/exportData.ts`
(invoke → cache file → `expo-sharing` → delete the cache file), `account/deleteAccount.ts`,
new route `app/delete-account.tsx` (names the signed-in email, button locked until DELETE is
typed, wipes the device only after the 200), `db/wipeDevice.ts` (sign out → `deleteAppDatabase`
→ clear kv-store → delete waiting photos, each best-effort; a failed sign-out shows "Close Astra
and open it again"), `deleteAppDatabase` in `db/database.ts` (replaces the planned close — the
sync hook reopens the db right after sign-out, so opens now wait during the delete and get a
fresh db). Deviations recorded in the plan's Build notes. **Gate 2 live probe:** both functions
401 without a login; a throwaway auth user created by SQL (confirmed email, bcrypt password,
`birthdate` metadata for the 18+ trigger) signed in with the password grant; seeded a workout
with one entry and two sets, a PR, a custom exercise, a workout post and one object in each
bucket; `export-data` → 200 with counts matching SQL exactly (1 / 1 / 2 / 1 / 1 / 1, maps
present, kg); `delete-account` with `{}` and `{confirm:"delete"}` → 400; with `DELETE` → 200
`filesRemoved: 2`; afterwards the token → 401 and `count(*)` is 0 in auth.users, identities,
profiles, user_settings, user_body_data, workouts, workout_exercises, sets, custom exercises,
personal_records, posts and storage.objects, with the other profile and the 151 library rows
intact. Gate 2 reran in order: regenerate typed routes → `tsc` clean → lint clean → Jest 128
suites / 1344 tests on a cold cache at default workers (the builder's load-induced timeouts did
not recur); `mmdc` rendered `app-flow.md` (OK); ERD untouched. Statuses: B32 Built; NFR-6
Built. Device-only: Export opens the share sheet and the JSON opens elsewhere; both flows show
the "needs a connection" line in airplane mode; deleting a throwaway account lands on sign-in,
the email no longer signs in, a reopened app has an empty device database. Readings for
Tristen: export excludes votes, comments, follows, blocks, mutes, reports and photo binaries;
includes email, profile, settings and body data.

**Earlier:** B31 custom-exercises (LIB-5), B30 library-card-history (LIB-4), B29
library-filters-and-detail (LIB-1, LIB-3), B28 share-cards (LOG-8, SOC-6), B27
moderation-and-safety (SOC-8, NFR-7), B26 post-privacy (YOU-5), B25 profile (YOU-1, YOU-2,
YOU-3, SOC-7), B24 feed-sort-and-filter (SOC-11, SOC-9), B23 votes-and-comments (SOC-4, SOC-5),
B22 image-posts (SOC-2, NFR-4 part), B21 finish-to-post (LOG-7), B20 posts-and-feed (SOC-1,
SOC-3; LOG-13), B19 muscle-map (ANA-3), B18 analysis-engine (ANA-1, ANA-2, ANA-4, ANA-11; NFR-9
part), B17 tool-kit-timer (TK-5), B16 tool-kit-calculators (TK-1..4), B15 settings-and-units
(LOG-6), B14 edit-delete-workouts (LOG-9), B13 exercise-history-and-prs (LOG-4, LOG-5), B12
workout-notes (LOG-3), B11 supersets-dropsets-timed (LOG-11, LOG-12), B10 set-types (LOG-14,
LOG-15), B09 logger-screen (LOG-2, NFR-2), B08 active-workout-store (NFR-3), B07
local-store-and-sync (FND-3), B06 training-math, B05 auth-and-signup. Details in each plan file.

**B34 program-builder** (planning now; branch name from the Build order is `program-builder`):
`programs`, `program_weeks`, `program_workouts`, `program_exercises` tables with author-only RLS;
builder UI enforcing week → workout → exercise with sets, reps and target load from library or
custom exercises. Step DoD: a complete program authors and reopens intact. Covers PRG-1, PRG-2
(both P1). Depends on B29. Standing inputs for its planner: **nothing program-shaped exists** —
no tables, no device schema, no screens; this is the first Phase 2 step and the first new
synced entity family since B07, so the planner must settle: (a) the server schema (four tables,
author `user_id`, `visibility` left for B39 — ship private-only now with a column that B39
widens, or add the column later; the planner records which), ordering columns (`position`), the
target-load unit (kg, like `sets.weight_kg`, display through `useDisplayUnit`), optional
targets (reps / load / RPE nullable), CHECK limits mirrored once in `@training-math`
`limits.ts` (the B08/B12/B31 discipline); (b) whether programs are `SyncedTable`s through the
outbox (offline-first says authoring must work with no signal, so yes — the pattern is B08's
active-workout store plus B31's `writeLocal` upserts; device schema V12; `TABLE_COLUMNS` and
`SYNC_ORDER` additions; deletes need the outbox delete op and probably a `sync_tombstones`
channel widening if a program can be deleted — or soft delete, the B31 precedent, which the
planner should weigh explicitly); (c) exercise references by device id (library uuidv5 or
custom uuid — the B31 `ExercisePicker` already returns `{ deviceId, name }`), with the custom's
soft-delete and the server `on delete` behaviour for `program_exercises.exercise_id` decided;
(d) the builder UI's home — a Programs entry (Workout tab tile or You tab) → program list →
program editor (weeks → workouts → exercises, reorder / remove, the B09 logger's
`ExercisePicker`), kept to authoring and reopening (running a program is B35, visibility is
B39, Marketplace is B40); (e) the Gate 2 probe: two simulated users in a rolled-back
transaction — the other user reads / updates / deletes 0 rows (the B31 precedent). No new
dependency expected; the ERD gains four tables; the flowchart gains the Programs branch and its
outbox data path. Phase 2 features are P1: the pipeline continues in table order regardless.

**Dev server for Tristen's phone:** worktree `C:\Users\trist\Astra\Astra-main` on a detached HEAD
(never `main` — see `docs/PIPELINE.md`), Expo dev server detached on port 8081 (`--lan`,
started Nov 15 by the session; log at `automation/state/expo-dev-8081.log`), QR at
`C:\Users\trist\Astra\Astra\automation\state\astra-expo-go-qr.png` (`exp://192.168.0.11:8081`).
Currently serving `582e3ee` (through B29; B30–B32 not yet on it — B31 adds device schema V11,
migrated on open). To update: stop the server (`netstat -ano | findstr :8081` → `taskkill
/PID <pid> /F`), `git -C C:\Users\trist\Astra\Astra-main checkout --detach main`, `npm ci` in
`Astra-main\frontend` if `package-lock.json` changed (it did not in B30–B32), then `npx expo
start --lan --port 8081`.

**Pipeline operations** (all in `docs/PIPELINE.md`): n8n detached with `NODES_EXCLUDE=[]`; board
`gvu4dg0NPtND4tGG` Active with a POST webhook trigger; `claude` CLI 2.1.325; headless allowlist
includes `mcp__supabase`; n8n-mcp SSRF fix committed (effective next Claude Code start); the
"Pick next item" script skips Blocked steps. Check order: `expo start --offline` ~150 s → `tsc`
→ lint → Jest; Gate 2 frees ports 8097 / 8099 and renders the diagrams with `mmdc` when the
builder could not. Headless builders cannot make outbound HTTP (`curl` declined), so function
HTTP probes are Gate 2's; the session's Bash sandbox also returns `000` for outbound `curl.exe`
— use the PowerShell tool (`Invoke-WebRequest`) for live HTTP probes. Throwaway-user recipe for
probes that need a real JWT (email confirmation is ON): SQL insert into `auth.users` with
`email_confirmed_at = now()`, `encrypted_password = extensions.crypt(pw, extensions.gen_salt
('bf'))`, empty-string token columns, `raw_user_meta_data` carrying `birthdate`, plus an
`auth.identities` row; then the password grant on `/auth/v1/token`. Session helper:
`automation/state/pipe.mjs` (gitignored; `latest`, `approve <id>`, `retry <id>`, `trigger`).
Executions 4/5 (B05) through 32 (B32); B34 is next. Reported costs: B05 ≈ $12.1, B06 ≈ $8.7,
B07 ≈ $14.2, B08 ≈ $10.5, B09 ≈ $14.0, B10 ≈ $9.7, B11 ≈ $14.9, B12 ≈ $13.2, B13 ≈ $17.5,
B14 ≈ $21.1, B15 ≈ $13.0, B16 ≈ $12.5, B17 ≈ $12.0, B18 ≈ $22.4, B19 ≈ $8.5, B20 ≈ $14.3,
B21 ≈ $13.4, B22 ≈ $17.0, B23 ≈ $12.6, B24 ≈ $12.4, B25 ≈ $20.5, B26 ≈ $19.1, B27 ≈ $16.4,
B28 ≈ $17.1, B29 ≈ $8.5, B30 ≈ $7.6, B31 ≈ $19.6, B32 ≈ $15.3 (≈ $398 for twenty-eight steps).

**Tristen's hands-on list:** (1) **device run** via the QR (update the worktree to B32 first):
sign up under 18 → refused; sign up 18+; kill and reopen still signed in; You → Edit profile;
log a multi-exercise workout, one-tap Repeat, force-kill and Resume; finish in airplane mode →
analysis with muscle map → Share → share sheet → post the PNG to another app and judge it →
Next → Post / Skip; View workout → PR badges; History; Edit and Delete; Settings → kg toggle,
Privacy, **Export your data** (share sheet → open the JSON elsewhere) ; Tool Kit calculators
and timer; Home → Latest / Hot and a flair chip → Share a photo → vote / comment → make a post
private → ⋯ Report → an author's profile → Follow, Re-share their post (a follower of yours
sees it), Mute, Block → unblock; Find lifters; Library → a muscle chip and an equipment chip
(header room at phone width?) → tap a card → detail legibility → PRs and sessions under the
Tips, Show older sessions → New exercise in airplane mode → it appears in Library and picker →
log a set → its card → edit → delete → history keeps the name → reconnect → rows (incl. the
`deleted_at` custom) and objects in Supabase; sign out; **with a throwaway account:** Settings →
Delete account → type DELETE → lands on sign-in, the email no longer signs in, a reopened app
has an empty device database. Flips B05–B32 and their features to Done as each holds. (2)
**Moderation:** pick an appeal email for `docs/CONTENT_POLICY.md`; call `moderate` once with
your signed-in token on a throwaway post (probe list in DEFERRED). (3) Supabase Dashboard →
Authentication → Providers → Email → turn "Confirm email" off (plan of record; the session's
toggle was declined by the permission layer). (4) The six external blockers — B33 video
provider is now the step the pipeline skipped. (5) Whether to grant `mmdc` (and Deno) to
headless runs. (6) Product readings to confirm or overrule: no bodyweight rep-record PR book
(B10/B13); the bare "e1RM" label (B13); muscle shading by max (B19); one post per workout and
own posts on Home (B20); post visibility inherits the workout's, no caption (B21); 10 MiB
images, PR post = photo + New PR flair (B22); votes and comments online-only, 500-char comments
(B23); feed preference per phone, sticky flair filter (B24); public-read avatars, username
editable (B25); post / workout visibility lockstep, three options, body-data control deferred
(B26); whole-person mute, viewer-relative tallies, reports outlive content (B27); export own
content only, no photo-post export, no re-share chains, re-shares hidden from their own owner
once the original is hidden (B28); muscle filter matches any involvement ordered hardest-first,
region ∧ muscle may be empty on purpose, no detail link from the logger's picker (B29); PRs
below the coaching content on the card, history screen kept as the logger's deep link,
grow-the-limit show-more (B30); soft delete for customs (row kept, hidden from Library and
picker, history and PRs keep the name, a deleted custom's PRs still show in the profile PR list,
no undelete), customs never match a region chip, no create-from-picker, no muscle-map shading
for customs (B31); **export contents** (own rows only; profile, settings, body data, email and
authored post rows in; votes, comments, follows, blocks, mutes, reports and photo binaries out;
kg as stored), sweep-before-delete, moderator accounts refuse self-delete, no grace period,
other devices of a deleted account keep their local copy (B32).

Next pipeline step after B34 merges: **B35 run-a-program** (check the Build order table for the
exact branch name).
