# team-coaching — B37: coach pushes, program assignment, coach log access

**Branch:** `team-coaching` (from `main`)
**Build step:** B37 — covers **TEAM-3** (coach can push programs, workouts and announcements, and
assign a program to a member; pushed content reaches all members, an assigned program becomes that
member's active program) and **TEAM-5** (coach can see Team members' training logs; non-coaches
cannot).
**Depends on:** B36 (teams, `team_members` with the unused `coach` enum value, `private.is_team_*`
helpers, the team page), B35 (`program_runs`, `startProgramRun` / `readActiveRun`), and through
them B34 (the program tables and `programs.ts`).

## Step definition of done (from the Build order)

Coach pushes programs, workouts and announcements to the Team; assigns a program to a member,
which becomes that member's active run; coaches read members' logs through RLS and members cannot.
**Pushed content reaches members, an assignment sets the active program, and a non-coach's log
read is refused.**

## Scope readings settled up front

- **"Becomes that member's active run" happens when the member starts it — one tap.** The
  handoff weighed a server-side definer write of the member's run against the member accepting an
  assignment, and the accept reading wins on three hard constraints at once: `program_runs`
  insert is self-only (B35), `startProgramRun` deliberately ends the member's current run (a
  coach silently killing a lifter's own active run is hostile), and — decisive — a run row alone
  is useless: `readActiveRun` requires the live program **in the member's device mirror**, and
  the coach's program never syncs to the member's phone (B34's recorded constraint, verified
  below). So: the assignment is a server row the member sees on the team page; **Start** copies
  the program into the member's own programs and starts the run — from that tap, `readActiveRun`
  resolves it on every device the member owns. The DoD is demonstrated as assignment → one tap →
  active run. The handoff's own Gate 2 wording anticipated exactly this ("member accepts /
  receives an assignment and `readActiveRun` would resolve it").
- **Assignment copies the program; it is not live-linked.** The member's copy is theirs: coach
  edits after assignment don't mutate a run in progress (the B35 rule that a started session
  never mutates, extended to the whole assigned program), and the copy rides the existing
  authoring + sync machinery with zero new sync code. Re-assigning after an edit is the coach's
  explicit act. Recorded as a product call.
- **Pushed program/workout content travels as JSON through a definer RPC, never through
  program-table RLS.** B34's migration header is explicit: the phone pulls the three program
  child tables **bare**, relying on author-only select to scope them (`supabaseTransport.ts:121`
  confirms). A "members read pushed programs" arm on those tables would make every member's next
  sync ingest the coach's rows into their device mirror. B39 owns the real visibility story;
  B37 ships two small `security definer` functions that return the pushed tree as JSON to team
  members — an online read, like the feed, that touches no table policy and no pull shape.
- **The coach arm must NOT live inside `private.workout_visible`.** The posts select policy
  calls `workout_visible(user_id, visibility)` directly (B20/B26), so widening that helper would
  show coaches members' private **posts — progress pics included**, which the handoff forbids
  ("body data and progress pics stay out"). The arm is a sibling helper OR'd into the
  **workouts** select policy and into `private.can_view_workout` (which sets and entries read
  through); posts, analyses, PRs, body data and storage policies are untouched.
- **Coaches see members' workouts regardless of visibility — `private` included — blocks still
  hide everything.** The handoff delegates this call and leans on the PRD: coaching implies log
  access; a coach who can't see the lifts isn't coaching. TEAM-5's DoD ("any member's log
  history") doesn't hold if private workouts hide. The member's recourse is real: leave the
  team, or block the coach (the block arm wins). The team page tells members plainly:
  "Coaches of this team can see your training log." **Flagged as this plan's top product call
  for Gate 1** — the fallback (exclude `private`) is a one-line change in the helper.
- **The owner is implicitly a coach.** The owner row's role is `'owner'` and can never change
  (B36), so an owner could not otherwise grant themselves coach rights — and the solo
  owner-coach is the commonest team. One helper (`private.is_team_coach`) treats
  `role in ('owner','coach')` as "coach" everywhere: pushes, assignments, log access.
- **Coach access is relation-based and ends on leave.** Every read re-evaluates the membership
  join; a coach demoted, removed (B38) or departed loses log access on their next query. No
  grant rows to revoke.

## What exists (verified before planning)

- `team_members` has the `coach` enum value, **no update policy**, and no column grant for
  update (B36 left both to B37). `private.is_team_member/is_team_owner/team_mode/
  has_team_invite/blocked_either` exist. The team page roster rows already route to profiles.
- `private.workout_visible(owner, vis)` is the one visibility home (own ∪ not-blocked ∧
  (public ∨ followers-and-following)); `can_view_workout(wid)` wraps it for `workout_exercises`
  and `sets`; the **posts** select policy calls `workout_visible` directly.
- `pullWorkouts` filters `eq('user_id', me)` on the client (`supabaseTransport.ts:114`), so
  widening the workouts select policy cannot pollute a coach's device mirror. `pullProgramRows`
  children are bare (RLS-scoped) — the B34 warning stands.
- `ProfileView` History on someone else's profile already reads the server
  (`loadWorkoutHistory` in `social/profile.ts`) and renders what RLS returns; others' rows are
  not yet tappable (B25 recorded deferral: no screen for someone else's workout).
- `programs.ts` is the authoring home (`createProgram`, `addWeek`, `addProgramWorkout`,
  `addProgramExercise`, `readProgramTree`, `formatProgramTargets`); `programRuns.ts` has
  `startProgramRun` / `readActiveRun`; `canLogExercise` is exported from `activeWorkout.ts`
  (B35) — the one copy of "may this phone log this exercise".
- `social/teams.ts` is the one teams-to-server module; `limits.ts` holds every user-typed cap.
- `ProgramPickerSheet` lists the lifter's own live programs from the device and reports a pick.

## Data model (one migration: roles, `team_posts`, `team_assignments`, coach log access)

### 1. Role changes — owner promotes and demotes coaches

No new table. An update policy plus the B36-style column grant on `team_members`:

```sql
create policy "owners change member roles"
  on public.team_members for update
  to authenticated
  using (private.is_team_owner(team_id) and role <> 'owner')          -- never the owner row
  with check (private.is_team_owner(team_id) and role in ('coach', 'member'));

revoke update on public.team_members from authenticated, anon;
grant update (role) on public.team_members to authenticated;           -- team_id/user_id/joined_at immutable
```

`using` excludes the owner row (no self-demotion, no demoting the owner); `with check` forbids
minting a second owner. The column grant stops an owner rewriting `user_id` to hand a membership
to someone else (the B36 `created_by` lesson).

### 2. Helpers — the coach rule lives once (`private.*`)

All `security definer`, `stable`, `set search_path = ''`:

```sql
-- Does the caller hold a coaching role (owner or coach) in team `tid`?
private.is_team_coach(tid uuid) returns boolean
  -- exists (team_members: team_id = tid, user_id = auth.uid(), role in ('owner','coach'))

-- Is `uid` a member of team `tid`? (two-arg sibling of is_team_member, for assignment checks)
private.user_in_team(tid uuid, uid uuid) returns boolean

-- May the caller read `owner`'s training log? True when they share a team in which the
-- caller holds a coaching role and `owner` is a member — and no block exists either way.
private.coach_reads_logs(owner uuid) returns boolean
  -- exists (team_members c join team_members m using (team_id)
  --         where c.user_id = auth.uid() and c.role in ('owner','coach') and m.user_id = owner)
  -- and not private.blocked_either((select auth.uid()), owner)
```

### 3. Coach log access (TEAM-5) — two policy edits, posts untouched

```sql
-- workouts select policy becomes:
using (private.workout_visible(user_id, visibility) or private.coach_reads_logs(user_id));

-- can_view_workout (create or replace) gains the same arm:
--   where w.id = wid and (private.workout_visible(w.user_id, w.visibility)
--                         or private.coach_reads_logs(w.user_id))
```

The migration drops and recreates the workouts select policy under its existing name and
`create or replace`s the helper. `workout_exercises` and `sets` read through
`can_view_workout`, so the full log follows with no further edits. Deliberately **not** widened: `posts` (progress pics stay private), `workout_
analyses`, `personal_records`, `user_body_data`, storage. A coach sees sessions and sets — not
the member's PR book, analyses, photos or body data. Recorded; a PR arm is one helper call away
if a later step wants it.

### 4. `team_posts` — pushed announcements, programs and workouts

```sql
create type public.team_post_kind as enum ('announcement', 'program', 'workout');

create table public.team_posts (
  id                 uuid primary key default gen_random_uuid(),   -- online-only, server id (teams precedent)
  team_id            uuid not null references public.teams (id) on delete cascade,
  author_id          uuid not null references public.profiles (id) on delete cascade,
  kind               public.team_post_kind not null,
  body               text check (char_length(body) between 1 and 2000),   -- the announcement text
  program_id         uuid references public.programs (id) on delete cascade,
  program_workout_id uuid references public.program_workouts (id) on delete cascade,
  created_at         timestamptz not null default now(),
  -- exactly the one payload its kind names:
  check ((kind = 'announcement') = (body is not null)),
  check ((kind = 'program')      = (program_id is not null)),
  check ((kind = 'workout')      = (program_workout_id is not null))
);
create index team_posts_team_idx on public.team_posts (team_id, created_at desc);
```

Immutable once pushed (no update policy, no `updated_at`); a wrong push is deleted and redone.

```sql
insert: with check (
  author_id = (select auth.uid()) and private.is_team_coach(team_id)
  and (program_id is null or private.owns_program(program_id))
  and (program_workout_id is null
       or private.owns_program(private.week_program(private.workout_week(program_workout_id))))
)
select: using (private.is_team_member(team_id))   -- members only, both join modes; pushes are team-internal
delete: using (author_id = (select auth.uid()))   -- a coach retracts their own; owner moderation is B38
```

The `owns_program` arms are load-bearing: without them a coach could push *someone else's*
program id and the payload RPC (definer) would leak its contents to the team.

### 5. `team_assignments` — "this program, for this member"

```sql
create table public.team_assignments (
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,  -- the assignee
  program_id  uuid not null references public.programs (id) on delete cascade,
  assigned_by uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (team_id, user_id, program_id)
);
create index team_assignments_user_idx on public.team_assignments (user_id);

insert: with check (
  assigned_by = (select auth.uid()) and private.is_team_coach(team_id)
  and private.owns_program(program_id)
  and private.user_in_team(team_id, user_id)
  and not private.blocked_either((select auth.uid()), user_id)      -- the invites precedent
)
select: using (user_id = (select auth.uid()) or private.is_team_coach(team_id))
delete: using (user_id = (select auth.uid()) or private.is_team_coach(team_id))
        -- assignee accepts or dismisses; a coach revokes
```

The invite pattern: a standing row, consumed on accept (the client deletes it after the copy
and run start succeed; a half-finished accept leaves the row standing for a retry). No status
column, no trigger.

### 6. Payload RPCs — how a member reads pushed program content

Two `security definer` functions in **`public`** (callable via PostgREST `rpc/`), `stable`,
`set search_path = ''`, both returning `jsonb` or null:

```sql
-- The full tree of a program pushed to, or assigned within, a team the caller belongs to.
public.team_program_payload(p_team uuid, p_program uuid) returns jsonb
  -- refuses (returns null) unless: private.is_team_member(p_team)
  --   AND (a team_posts row (p_team, kind 'program', program_id = p_program) exists
  --        OR a team_assignments row (p_team, caller, p_program) exists)
  --   AND the program row is live (deleted_at is null)
  -- returns: { name, weeks: [{ position, workouts: [{ name, position,
  --            exercises: [{ exercise_id, exercise_name, position,
  --                          target_sets, target_reps, target_weight_kg, target_rpe }] }] }] }
  -- live rows only, ordered (position, id) at every level — readProgramTree's rule;
  -- exercise_name joined from exercises (a pushed custom's name travels with the push)

-- One workout's slots, for kind 'workout' pushes: same membership gate, keyed by the
-- team_posts row that names the program workout.
public.team_workout_payload(p_team uuid, p_program_workout uuid) returns jsonb
```

Postgres grants EXECUTE on new functions to PUBLIC by default, so the migration locks both
down explicitly: `revoke execute … from public, anon; grant execute … to authenticated`
(the gate's `auth.uid()` checks would refuse anon anyway — the revoke is belt and braces,
and the probe calls each RPC with no token to prove it).

Why RPC and not RLS: the scope-reading above (B34's bare child pulls). Why not an edge
function: no secrets, no HTTP fan-out, pure SQL over four tables — a definer SQL function is
smaller, probeable in a rolled-back transaction, and needs no deploy. These are the repo's
first client-callable definer functions; the gate condition is the entire security surface and
the Gate 2 probe attacks it directly (non-member → null, member of the wrong team → null,
never-pushed program → null, soft-deleted program → null).

### 7. Shared limits

`limits.ts` gains `MAX_TEAM_ANNOUNCEMENT_LENGTH = 2000` (the workout-notes cap; coaches write
paragraphs, not essays) and `assertValidTeamAnnouncement(body)` (trimmed, 1–2000, counted the
server's way), and the hand-mirrored table comment gains the `team_posts.body` line.

## App modules and screens

### `frontend/src/social/teams.ts` (edit) — roster verbs stay in the roster module

- `setMemberRole(client, teamId, userId, role: 'coach' | 'member')` → `TeamResult`. 0 rows
  updated (not owner, or the owner row) maps to the calm refusal message.

### `frontend/src/social/teamCoaching.ts` (+ test, new) — pushes, assignments, payloads

Injected-client pattern, refusals map to calm messages (`TEAM_FAILED` style):

- `loadTeamPosts(client, teamId)` — newest 20 with author names embedded (the roster-embed
  shape). `RawTeamPost` declared at the seam (the `RawFeedPost` discipline).
- `pushAnnouncement(client, me, teamId, body)` — validates via `assertValidTeamAnnouncement`.
- `pushProgram(client, me, teamId, programId)` / `pushWorkout(client, me, teamId,
  programWorkoutId)` / `deleteTeamPost(client, postId)`.
- `assignProgram(client, me, teamId, userId, programId)` /
  `removeAssignment(client, teamId, userId, programId)` (assignee-accept, -dismiss and
  coach-revoke are the same delete) / `myAssignments(client, me, teamId)` /
  `teamAssignments(client, teamId)` (coach's view).
- `fetchProgramPayload(client, teamId, programId)` / `fetchWorkoutPayload(client, teamId,
  programWorkoutId)` — the RPCs, parsed and shape-checked into `TeamProgramPayload` /
  `TeamWorkoutPayload` (never trusted raw).

### `frontend/src/programs/copyProgram.ts` (+ test, new) — the member's copy

`createProgramFromPayload(db, userId, payload) → programId`: fresh client uuids for every row,
written under the member's `user_id` in **one `writeLocal` batch** (parents first — programs,
weeks, workouts, slots), so a kill can't leave half a program; rows then ride the ordinary
outbox push. Slot handling: a slot whose `exercise_id` this member can use (library row or own
custom — `canLogExercise`, the one home) keeps it; any other (the coach's custom this phone
doesn't have) is copied with `exercise_id = null` so the program's shape is intact and the slot
shows the recorded "Deleted exercise" label. The accept UI states the count: "2 exercises
are the coach's own and didn't copy." Imports `dao`, `programs.ts`, `activeWorkout.ts`'s
`canLogExercise`, `ids` — no new write path, no sync change.

Accept flow (team page): `fetchProgramPayload` → `createProgramFromPayload` →
`startProgramRun(db, me, copyId)` → `removeAssignment`. Steps 2–3 are device-local; only the
fetch and the consume need the connection the team page already requires.

### `frontend/src/social/profile.ts` (edit) — one workout, read online

`loadWorkoutDetail(client, workoutId)` — one workout with entries, sets and exercise names
embedded (`workout_exercises(…, sets(…), exercise:exercises(name))`), RLS deciding every row.
Null exercise name renders "Custom exercise" (the B20 feed precedent — exercises RLS still
hides others' customs; the *log* is readable, the catalog row is not).

### Screens

| Piece | What it does |
|---|---|
| `app/team/[id]/index.tsx` (edit) | **Assignment banner** (member with assignments): "Your coach assigned <program>" → View (payload sheet) / Dismiss. **Coach's corner** between roster and feed: pushed posts newest-first — announcement text; program/workout cards → payload sheet. Coaches get **Push to team** (announcement box via a small sheet; Push a program → `ProgramPickerSheet`; Push a workout → picker then a day list from `readProgramTree`). Roster rows: role badges (`roleLabel` exists); owner sees Make coach / Remove coach (`setMemberRole`); coaches see **Assign a program** on member rows → `ProgramPickerSheet`. Members see the one-line notice: "Coaches of this team can see your training log." |
| `components/teams/TeamProgramSheet.tsx` (+ test, new) | Renders a `TeamProgramPayload` or `TeamWorkoutPayload`: weeks → days → slots with targets (`formatProgramTargets`, display unit). Footer by context: assignment → **Start program** (accept flow); program push → **Save to my programs** (copy, no run); workout push → **Start this workout**. A null payload (program since soft-deleted, or access lost) shows "This program is no longer available." |
| `components/programs/ProgramPickerSheet.tsx` (edit) | Gains an `onPick(programId)` mode that replaces its start-a-run behaviour (today it starts the run itself and reports `onStarted`), so coaches reuse the same sheet to pick a program to push or assign. Mechanical prop change; existing Workout-tab use untouched. |
| `workout/startPushedWorkout.ts` (+ test, new) | `startProgramSession`'s small sibling for one pushed workout: `startActiveWorkout` (no `programWorkoutId` — unlinked, advances no run), title from the workout's name, per-slot `addExercise` + `setEntryNotes(formatProgramTargets(...))`, skipping slots `canLogExercise` refuses. Refused while a workout is unfinished — the store's existing rule; the sheet shows the standard resume message. |
| `components/profile/ProfileView.tsx` (edit) | Others' History rows become tappable → `/session/[id]` (own rows keep their device-read screen). |
| `app/session/[id].tsx` (+ test in `__tests__/`, new) | Read-only online view of one visible workout: title, date, duration, entries with sets via `formatSet` / `formatDropSet` / `supersetRuns` / `groupDropSets` (B11's one home). Serves any workout RLS shows — which is what makes TEAM-5's "open a member's log" literally true for a coach, and costs nothing extra for public workouts. Offline → the standard connection message. |

Route tests live in `frontend/src/__tests__/` (expo-router rule). No device schema change, no
`SYNC_ORDER` change, no new dependency, no edge function.

## Files to create or change

| File | Change |
|---|---|
| `backend/supabase/migrations/<version>_team_coaching.sql` | new — role policy + column grant, 3 helpers, `team_posts`, `team_assignments`, workouts/`can_view_workout` coach arm, 2 payload RPCs |
| `backend/supabase/functions/_shared/training-math/limits.ts` (+ test) | edit — announcement cap + assert, mirror-table line |
| `frontend/src/social/teams.ts` (+ test) | edit — `setMemberRole` |
| `frontend/src/social/teamCoaching.ts` (+ test) | new — pushes, assignments, payload fetch/parse |
| `frontend/src/social/profile.ts` (+ test) | edit — `loadWorkoutDetail` |
| `frontend/src/programs/copyProgram.ts` (+ test) | new — payload → member-owned program |
| `frontend/src/workout/startPushedWorkout.ts` (+ test) | new — pushed-workout prefill |
| `frontend/src/components/teams/TeamProgramSheet.tsx` (+ test) | new — payload viewer + context action |
| `frontend/src/components/programs/ProgramPickerSheet.tsx` (+ test) | edit — `onPick` mode for push/assign |
| `frontend/src/app/team/[id]/index.tsx` (+ `__tests__/team.test.tsx`) | edit — coach's corner, banner, role controls, assign, notice |
| `frontend/src/components/profile/ProfileView.tsx` (+ tests) | edit — tappable others' History rows |
| `frontend/src/app/session/[id].tsx` (+ `__tests__/session.test.tsx`) | new — read-only workout view |
| `docs/diagrams/database-erd.md` | edit (Document step) — two tables, enum, helpers, policy arms, RPCs |
| `docs/diagrams/app-flow.md` | edit (Document step) — push, assign-accept, coach log paths |

Builder footguns (the B36 list applies): new routes → `npx expo start --offline` (~150 s)
**before** `tsc` → lint → Jest (`--maxWorkers=50%` on timeout); apply the migration via MCP then
rename the file to the recorded version; fakes only in tests. The fake social client must learn
`rpc(name, args)` and the `team_posts` / `team_assignments` tables.

## How each definition of done becomes observably true

- **"Pushed content reaches members" (TEAM-3 / step DoD):** Gate 2 probe — coach inserts all
  three kinds; a member selects them; an outsider selects 0; a member's payload RPC returns the
  tree; an outsider's, a no-token call's (G13), a never-pushed program's and a soft-deleted
  program's all return null or are refused. Route test — the team page renders an announcement and a
  program card for a member (fake client), and no Push controls for a plain member.
- **"An assignment sets the active program" (TEAM-3 / step DoD):** probe — coach's assignment
  insert passes for a member, is refused for an outsider and across a block; the member sees it,
  another member doesn't. Jest, on real SQLite — assignment payload → `createProgramFromPayload`
  → `startProgramRun` → `readActiveRun` resolves the copy with the right next session; the
  copy's rows are member-owned and queue for push; a coach's-custom slot arrives with null
  `exercise_id`; the Start-flow consumes the assignment (fake client delete recorded).
- **"Coaches read members' logs, members cannot" (TEAM-5 / step DoD):** probe, four users
  (owner, coach, member, outsider), member's workout set `private` — coach reads the workout
  row *and its sets* (through `can_view_workout`); a second member reads 0; the outsider reads
  0; after a block between coach and member, the coach reads 0; the coach reads 0 of the
  member's `posts`, `personal_records` and `workout_analyses` (the not-widened proof). Route
  tests — a member's History rows render for the coach and open `/session/[id]` with sets;
  the role update: owner promotes (1 row), member promotes (0 rows), promote-to-owner refused.
- **Device verification (Built → Done, Tristen):** two accounts — owner makes the other a
  coach (badge flips); coach pushes an announcement + a program; the member (owner) sees both
  on the team page, opens the program, saves it; coach assigns it; member taps Start → Workout
  tab shows the run; coach opens member's profile → History shows a private workout → taps a
  row → full session; member leaves the team → History hides it again.

## Out of scope (and where it lands)

- Owner moderation of `team_posts` and of the Team feed, removing members — **B38** (author
  self-delete only here).
- Program visibility column and the real shared-program read story — **B39** (the RPCs are
  team-scoped stopgaps B39 can subsume or keep).
- Marketplace save-and-start — **B40** (it will reuse `createProgramFromPayload`'s shape).
- Push notifications for pushes/assignments — **B47**. Gym coaching — Gym steps.
- Coach access to PRs, analyses, body data, progress pics, DMs — deliberately excluded here;
  each is a product call with its own step.
- Live-linked assignments (coach edits flowing into a member's run); re-assign covers it.
- Announcement editing; comment threads on pushes; multi-member bulk assignment.
- A "who can see my logs" settings surface — the team-page notice covers legibility; a control
  is on evidence.
- Paging of the coach's corner (`loadTeamPosts` reads the newest 20, like comments' first
  cut) — keyset paging when a team's push volume earns it.

## Risks a reviewer should weigh

1. **Coach log access overrides `private` workout visibility (TEAM-5 arm).** The plan's top
   product call, argued in Scope readings: PRD says coaching implies log access; blocks still
   win; posts/photos/body data/PRs/analyses stay closed; members are told on the team page and
   can leave. The fallback — coaches see public+followers only — is one line in
   `coach_reads_logs` but makes TEAM-5's DoD false for private loggers. Gate 1 should confirm
   the call.
2. **The payload RPCs are the repo's first client-callable `security definer` functions.** The
   membership + pushed/assigned gate is the entire wall between a coach's program and the
   public; a bug leaks program content (never logs). Mitigations: the gate is three `exists`
   checks probed adversarially at Gate 2 (non-member, wrong team, never-pushed, soft-deleted),
   `owns_program` guards at the *insert* policies keep other people's programs out of the
   gate's reach, and the functions are `stable` definer SQL with empty search_path, the
   repo's standard hardening.
3. **The copy path crosses module seams** (`teamCoaching` fetch → `copyProgram` → `programRuns`
   start → `teamCoaching` consume) and only the middle two are atomic. A kill between copy and
   start leaves a saved program and a standing assignment (retry-safe: Start would copy again —
   the accept flow must therefore reuse an existing just-made copy or tolerate a duplicate
   program; settled: tolerate — a duplicate program is visible, deletable and harmless, and
   dedupe machinery isn't worth the state it adds). A failed consume leaves the banner until
   the next successful delete; also harmless. Both recorded.

## Grilling record (settled decisions)

Conducted by the planner session (autonomous pipeline, both sides at full severity). What was
attacked and what changed:

- **G1 — "The RPC payload machinery is B39 territory in disguise; ship assignment-by-reference
  and let B39 do reads."** No: without a read path there is no copy source, and without a copy
  the run can't resolve on the member's device at all (the mirror constraint is physical, not
  stylistic). The alternatives were enumerated: widen program RLS (violates B34's recorded
  warning; pollutes every member's mirror via the bare child pulls), change the pull shape to
  `!inner`-filtered children (touches every sync consumer in a step about coaching), server-side
  copy by edge function (a deploy and an HTTP surface for what three SQL `exists` checks do).
  The JSON RPC is the smallest thing that honors B34 and B39 at once. Kept, with risk 2 honest.
- **G2 — "Why does assignment copy instead of pointing at the coach's program?"** A pointer
  needs the pointed-at tree readable *on the member's device forever* (every `readActiveRun`,
  every prefill) — that's the mirror problem again, permanently, plus coach edits mutating a
  stranger's run mid-flight. The copy is the offline-first answer: after one online tap,
  everything — run, prefill, advance — is device-local and member-owned. Divergence from later
  coach edits is a feature (B35: started sessions never mutate), recorded as a product call.
- **G3 — "Auto-start the assignment on next sync — the DoD says 'becomes', not 'may become'."**
  Rejected as hostile: `startProgramRun` ends the member's current run, so auto-accept lets any
  coach silently kill a lifter's own program mid-run; and an auto-copy writes rows the member
  never asked for. The handoff's Gate 2 wording ("member accepts") already read the DoD this
  way. One tap stands, stated plainly in Scope readings.
- **G4 — "Owner-implicitly-coach hands every open-team owner members' private logs. Too hot?"**
  Weighed hard against a coach-only reading. Excluding the owner breaks the solo owner-coach
  (the commonest team) with no workaround — the owner row's role can never change, so the owner
  could not even promote themselves. The real heat is private-visibility override, which is
  risk 1's Gate 1 flag; the notice line and leave/block are the member's controls. Kept.
- **G5 — "`/session/[id]` is scope creep — B20 and B25 both deferred someone-else's-workout
  screens."** They deferred it for lack of a feature that needed it; TEAM-5 is that feature —
  "open any member's log history" is false if rows don't open, and a sets-less summary list
  isn't a training log a coach can coach from. The screen is one read + existing B11
  formatters, serves every visible workout uniformly, and is this plan's second deliberate
  inclusion (the B36 "leave" precedent: an action the feature is unusable without). Kept.
- **G6 — "Pushed *workout* start (`startPushedWorkout`) could be view-only; cut it?"** Weighed
  for cutting (the step is big). Kept, narrowly: in a workout logger, "push a workout" that
  can't be logged is a text message, and the start path is ~40 lines reusing the store, the
  formatter and `canLogExercise` — no new mechanism. If the builder runs long, this is the
  named first cut (view-only sheet; record in deviations).
- **G7 — "Why do coaches, not just owners, assign and push? TEAM-3 says coach — but you also
  let owners do it."** The helper's whole point: `is_team_coach` = owner ∪ coach, one rule.
  A coach pushing content the owner must moderate post-hoc is B38's explicit scope (TEAM-4).
- **G8 — "`team_posts` CHECK equalities are clever — three biconditionals; will a fourth kind
  break them?"** They are exactly what makes a malformed row unrepresentable today; a new kind
  is a migration that revisits its own CHECKs by necessity. Kept.
- **G9 — "The coach's custom exercises silently degrade in copies — 'Deleted exercise' is a
  lie."** True but bounded: the accept confirmation states the count, the payload carries the
  name for the *sheet* (the member sees what the slot was before saving), and copying another
  lifter's custom exercise rows is its own feature (ownership, dedupe, mutation semantics) that
  no covered DoD asks for. Recorded as a known limitation; coaches should push library-exercise
  programs.
- **G10 — "A member who joins a team mid-run of an assigned program — or accepts twice — ends
  up with duplicate programs."** Settled in risk 3: tolerate duplicates; they are ordinary
  visible programs the member can delete. Dedupe state (copy provenance columns) was weighed
  and rejected as speculative.
- **G11 — "Does the fake client really need `rpc`?"** Yes — `fetchProgramPayload` is on the
  accept path's test spine; the recording fake grows an `rpc(name, args)` surface returning
  queued replies, matching how `from()` is faked today. Noted in footguns so the builder
  doesn't bolt it on per-test.
- **G13 — "The RPCs are callable by anyone PostgREST serves — what stops anon?"** Postgres's
  default EXECUTE-to-PUBLIC grant was the hole; closed in §6 with an explicit revoke + grant
  to `authenticated`, and a no-token RPC call added to the probe.
- **G14 — "Reuse of `ProgramPickerSheet` was asserted, not checked."** Checked: the sheet
  starts the run itself and reports `onStarted` — unusable for push/assign as-is. Settled as
  an `onPick` mode prop (files table updated) rather than a second picker component.
- **G15 — "Coach's corner paging?"** Newest 20, no paging — the comments-screen first cut,
  recorded in Out of scope.
- **G12 — facts re-checked in the repo:** posts select calls `workout_visible` directly
  (`post_privacy.sql` header; `posts_flairs.sql`) — the sibling-helper design is mandatory,
  not stylistic. `pullWorkouts` is user-filtered client-side (`supabaseTransport.ts:114`) —
  no mirror pollution from the workouts arm. `canLogExercise` is exported (B35 review fix).
  `roleLabel` exists in `teams.ts`. Roster rows already `router.push` to profiles. B36's
  column-grant precedent (`revoke update … grant update (…)`) is the working pattern the role
  grant copies. `program_workout_id` pushes: `week_program`/`workout_week` helpers exist for
  the ownership walk.
- **Scope verdict:** right as written, with two deliberate inclusions flagged (the session
  view, G5; pushed-workout start, G6 — the named first cut) and one deliberate narrowing of a
  literal reading (assignment activates on the member's tap, G3, per the handoff's own
  anticipation). Nothing else widened: no notifications, no moderation, no visibility column,
  no Marketplace machinery.

## Build deviations (builder, B37)

Recorded by the builder run; each is deliberate.

- **D1 — the coach arm does NOT go into `private.can_view_workout`.** The plan (§3) said to
  `create or replace` `can_view_workout` with the coach arm. But `personal_records`' select policy
  reads through `private.can_view_set` → `can_view_workout` (`20261115130809_profile_reads_and_avatars.sql`),
  so that edit would have shown coaches members' PRs — which §3 and the probe list explicitly
  forbid. Instead a sibling `private.can_read_workout_log(wid)` (= `workout_visible` ∨
  `coach_reads_logs`) is used by the **workout_exercises** and **sets** select policies (dropped
  and recreated under their names); `can_view_workout` is untouched. Probed live: coach reads the
  private workout, its entry and its set, and 0 PRs, 0 posts.
- **D2 — migration version.** Applied via MCP as `20261115222643_team_coaching` and the file
  carries that prefix. Three extra FK indexes on `team_posts` (author, program, program workout)
  and two on `team_assignments` (program, assigned_by) beyond the plan's one each.
- **D3 — two UI files the files table didn't list:** `components/teams/useTeamCoaching.tsx` (the
  team page's coaching state, actions and modals, so the route stays readable) and
  `components/teams/CoachPushSheet.tsx` (the announcement box and the "pick a day" list for a
  workout push). No tests of their own; they are exercised through `__tests__/team.test.tsx`
  (member view, assignment Start → active run, pushed program Save once, owner Make coach +
  Announce).
- **D4 — card names come from the payloads.** Members can't read the coach's `programs` rows, so
  the team page fetches each referenced program / workout payload once per load (in parallel) to
  name the cards and the assignment banner, and the sheet reuses them.
- **D5 — refusal wording for program pushes and assignments.** A program made moments ago that
  hasn't synced fails `owns_program` (42501) exactly like a foreign one, so program / workout push
  refusals and assignment refusals say "If you just made it, wait for it to sync and try again."
  The error-code helpers (`codeOf`, `RLS_REFUSED`, `UNIQUE_VIOLATION`) are now exported from
  `social/teams.ts` and shared.
- **D6 — review fixes.** The sheet's footer action is spent after a successful copy (a second tap
  would have made a second copy and, for Start, restarted the run); a copy that saved but whose
  run failed to start now says so ("Saved to your programs, but it couldn't be started here");
  the two push senders share one helper; a failed `listPrograms` is logged. `startPushedWorkout`
  returns its skipped count but the team page navigates straight to the logger without showing it
  (recorded in DEFERRED).
