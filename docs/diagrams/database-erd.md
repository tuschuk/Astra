# Astra database — entity relationship diagram

The living picture of the Supabase (Postgres) schema. Every commit that adds or changes a
migration updates this file in the same commit, so it always matches `backend/supabase/migrations/`.
Read it top to bottom: the diagram shows the tables and how they connect; the notes below it cover
the rules a diagram cannot draw (who can see what, what happens automatically, what cascades).

Source migrations: `20261114100000_identity.sql`, `20261114100100_training.sql`,
`20261114110000_fix_exercise_delete.sql`, `20261114120000_exercises_slug.sql`,
`20261114120100_library_seed.sql` (generated — see below), `20261115024010_sets_score.sql`,
`20261115031049_sets_notes.sql`, `20261115035806_personal_records.sql`,
`20261115045638_sync_tombstones.sql` (B14, applied live), `20261115080420_workout_analyses.sql`
(B18, applied live), `20261115093217_posts_flairs.sql` (B20, applied live),
`20261115105852_post_images.sql` (B22, applied live — posts kinds, the `post-images` bucket and
its storage policies), `20261115114409_votes_comments.sql` and
`20261115115739_comments_body_not_blank.sql` (B23, both applied live — votes, comments, the
`post_scores` view, the upvote-only triggers), `20261115122437_post_hot_scores.sql` (B24, applied
live — the `post_hot_scores` ranking view), `20261115130809_profile_reads_and_avatars.sql` (B25,
applied live — `follow_counts`, the widened `personal_records` read rule, the public `avatars`
bucket, the own-folder `avatar_url` CHECK), `20261115141242_post_privacy.sql` (B26, applied live —
`user_settings.progress_pic_visibility`, the progress-pic-private CHECK dropped, the post→workout
visibility lockstep trigger), `20261115150035_moderation.sql` and
`20261115151850_reports_not_self.sql` (B27, both applied live — `mutes`, `moderators`, `reports`
and its stamping trigger, mute added to `private.workout_visible`, author-level filtering of
votes and comments), `20261115154653_reshares.sql` and `20261115160346_reshare_trigger_columns.sql`
(B28, both applied live — `posts.shared_post_id`, the `reshare` kind, the re-share shape and
flair-stamp trigger, the both-posts read rule, `post_hot_scores` recreated with the new column),
`20261115173827_exercises_soft_delete.sql` (B31, applied live — `exercises.deleted_at` and the
customs-only CHECK; see "Custom exercises"), `20261115193156_programs.sql` (B34, applied live —
`programs`, `program_weeks`, `program_workouts`, `program_exercises`, author-only RLS through
`private.owns_program`; see "Programs"), `20261115203159_program_runs.sql` (B35, applied live —
`program_runs` with owner-only RLS and `workouts.program_workout_id`; see "Program runs"),
`20261115212541_teams.sql` (B36, applied live — `teams`, `team_members`, `team_invites`, the
`team_join_mode` / `team_role` enums, the owner-row and invite-consume triggers; see "Teams"),
`20261115222643_team_coaching.sql` (B37, applied live — role update policy, `team_posts`,
`team_assignments`, the `team_post_kind` enum, coach log access on workouts / entries / sets, and
the two payload functions; see "Team coaching"),
`20261115232206_team_moderation.sql` (B38, applied live — owner removal of members, the
`on_team_member_removed` cleanup trigger, `team_feed_hides`, owner deletion of pushes and of the
team; see "Team moderation"),
`20261115235525_program_visibility.sql` (B39, applied live — `programs.visibility`, the
`program_visibility` enum, `program_team_shares`, `private.program_visible`, the widened `programs`
read policy, `private.program_tree_json` and the `program_payload` function; see "Program
visibility"),
`20261116004257_marketplace_search.sql` (B40, applied live — the generated `programs.search`
tsvector, its GIN index and the published-browse partial index; see "Marketplace search"),
`20261116012712_program_votes_comments.sql` and `20261116015334_program_social_reads.sql` (B41,
both applied live — `program_votes`, `program_comments`, `private.can_view_program`,
`private.program_published`, the `program_scores` view, and the read policies matched to post
votes; see "Program votes, comments and Featured"),
`20261116023347_analysis_trend.sql` (B42, applied live — the six nullable trend columns on
`workout_analyses` and their CHECKs; see "Workout analyses"),
`20261114224613_signup_birthdate_gate.sql`
(**in the repo but not yet applied to the live project** as of the B05 build. The build session
could not reach the Supabase MCP. Until it is applied, live signup does not enforce 18+ and does
not stamp the birthdate).

```mermaid
erDiagram
  auth_users ||--|| profiles : "signup trigger creates"
  profiles ||--|| user_settings : "has (created at signup)"
  profiles ||--|| user_body_data : "has (created at signup)"
  profiles ||--o{ follows : "follower_id"
  profiles ||--o{ follows : "followee_id"
  profiles ||--o{ blocks : "blocker_id"
  profiles ||--o{ blocks : "blocked_id"
  profiles |o--o{ exercises : "owner_id (null = launch library)"
  profiles ||--o{ workouts : "user_id logs"
  workouts ||--o{ workout_exercises : "contains, in position order"
  exercises |o--o{ workout_exercises : "exercise_id (null only if the row is hard-deleted)"
  workout_exercises ||--o{ sets : "contains, in position order"
  profiles ||--o{ personal_records : "user_id holds"
  exercises ||--o{ personal_records : "exercise_id (cascade)"
  sets ||--o{ personal_records : "source_set_id proves (cascade)"
  profiles ||--o{ sync_tombstones : "user_id (cascade)"
  workouts ||..o{ sync_tombstones : "row_id, written by trigger on delete (no FK)"
  personal_records ||..o{ sync_tombstones : "row_id, written by trigger on delete (no FK)"
  workouts ||--o| workout_analyses : "id = workout id (cascade); one per workout"
  profiles ||--o{ workout_analyses : "user_id owns (cascade)"
  profiles ||--o{ posts : "user_id shares (cascade)"
  workouts |o--o| posts : "workout_id shared (cascade); workout posts only; one post per workout"
  flairs ||--o{ posts : "flair_id: exactly one per post"
  posts |o..o| storage_objects : "image_path = object name (photo posts; no FK)"
  posts |o--o{ posts : "shared_post_id: a re-share points at its original (cascade, B28)"
  profiles |o..o| storage_objects : "avatar_url = object name in avatars (no FK; own folder by CHECK, B25)"
  posts ||--o{ votes : "post_id (cascade)"
  profiles ||--o{ votes : "user_id casts; one per post (cascade)"
  posts ||--o{ comments : "post_id (cascade)"
  profiles ||--o{ comments : "user_id writes (cascade)"
  posts ||..|| post_scores : "view: one row per post (security_invoker)"
  posts ||..|| post_hot_scores : "view: one row per post + hot_score (security_invoker, B24)"
  profiles ||--o{ mutes : "muter_id (cascade, B27)"
  profiles ||--o{ mutes : "muted_id (cascade, B27)"
  profiles ||--o| moderators : "user_id (cascade, B27)"
  profiles ||--o{ reports : "reporter_id files (cascade, B27)"
  profiles ||--o{ reports : "reported_user_id, trigger-stamped (cascade, B27)"
  posts ||..o{ reports : "target_id when target_kind = post (no FK: reports outlive content)"
  comments ||..o{ reports : "target_id when target_kind = comment (no FK)"
  profiles ||--o{ programs : "user_id authors (cascade, B34)"
  programs ||--o{ program_weeks : "contains, in position order (cascade)"
  program_weeks ||--o{ program_workouts : "contains, in position order (cascade)"
  program_workouts ||--o{ program_exercises : "contains, in position order (cascade)"
  exercises |o--o{ program_exercises : "exercise_id (set null if the exercise is hard-deleted)"
  profiles ||--o{ program_runs : "user_id runs (cascade, B35)"
  programs ||--o{ program_runs : "program_id being run (cascade; existence-only)"
  program_workouts |o--o{ workouts : "program_workout_id: session started from (set null, B35)"
  profiles ||--o{ teams : "created_by creates (cascade, B36)"
  teams ||--|{ team_members : "has; owner row made by trigger (cascade)"
  profiles ||--o{ team_members : "user_id belongs (cascade)"
  teams ||--o{ team_invites : "invites (cascade)"
  profiles ||--o{ team_invites : "user_id invited (cascade)"
  team_members ||..o{ posts : "Team feed: posts where user_id in the roster (no FK; posts RLS decides)"
  teams ||--o{ team_posts : "pushes (cascade, B37)"
  profiles ||--o{ team_posts : "author_id pushes (cascade)"
  programs |o--o{ team_posts : "program_id: a pushed program (cascade)"
  program_workouts |o--o{ team_posts : "program_workout_id: a pushed workout (cascade)"
  teams ||--o{ team_assignments : "assigns (cascade, B37)"
  profiles ||--o{ team_assignments : "user_id assignee / assigned_by coach (both cascade)"
  programs ||--o{ team_assignments : "program_id: the coach's program (cascade)"
  team_members ||..o{ workouts : "coach log access: a coach reads members' workouts (no FK; RLS arm)"
  teams ||--o{ team_feed_hides : "owner's hidden posts (cascade, B38)"
  posts ||--o{ team_feed_hides : "post_id hidden from that team's feed (cascade)"
  profiles ||--o{ team_feed_hides : "hidden_by the owner (cascade)"
  programs ||--o{ program_team_shares : "shared with these Teams when visibility = team (cascade, B39)"
  teams ||--o{ program_team_shares : "team_id the program is shared with (cascade)"
  programs ||--o{ program_votes : "program_id voted on (cascade, B41)"
  profiles ||--o{ program_votes : "user_id casts; one per program (cascade)"
  programs ||--o{ program_comments : "program_id commented on (cascade, B41)"
  profiles ||--o{ program_comments : "user_id writes (cascade)"
  programs ||..|| program_scores : "view: one row per program + window scores (security_invoker, B41)"
  program_votes {
    uuid program_id PK, FK "the program voted on (published when cast)"
    uuid user_id PK, FK "the voter; PK (program_id, user_id) = one vote per lifter per program"
    smallint value "+1 or -1 only (no upvote-only rule on programs)"
    timestamptz created_at "when CAST; kept on a change of mind — the Featured windows count this"
    timestamptz updated_at
  }
  program_comments {
    uuid id PK "server-generated (gen_random_uuid)"
    uuid program_id FK "the program commented on (published when written)"
    uuid user_id FK "the commenter"
    text body "1-500 chars, at least one non-whitespace character (same CHECK as comments)"
    timestamptz created_at "conversation order, oldest first"
    timestamptz updated_at
  }
  program_scores {
    uuid id "= programs.id (VIEW, not a table)"
    uuid user_id "= programs.user_id (FK kept: embeds author)"
    text name "= programs.name"
    program_visibility visibility "= programs.visibility (the shelf filter)"
    timestamptz created_at "= programs.created_at (tie-break: newest first)"
    timestamptz deleted_at "= programs.deleted_at (the shelf filter)"
    int score "net votes, all time; 0 when none"
    int score_week "net votes cast in the last 7 days"
    int score_month "net votes cast in the last 30 days"
    int score_year "net votes cast in the last 365 days"
    int comment_count "count of program_comments"
  }
  program_team_shares {
    uuid program_id PK, FK "the author's program"
    uuid team_id PK, FK "a team the author was in when sharing"
    timestamptz created_at
  }

  auth_users {
    uuid id PK "managed by Supabase Auth"
    text email
  }

  profiles {
    uuid id PK, FK "same id as auth.users"
    citext username UK "3-30 chars, letters digits underscore; null until onboarding"
    text display_name "max 50; seeded from the email's local part"
    text bio "max 300"
    text avatar_url "path in the avatars bucket, <id>/<uuid>.<ext>; CHECK: own folder (B25)"
    timestamptz created_at
    timestamptz updated_at "trigger-maintained"
  }

  user_settings {
    uuid user_id PK, FK
    text unit "kg or lb; default lb"
    workout_visibility default_workout_visibility "default public; no reader yet"
    workout_visibility progress_pic_visibility "who sees NEW progress pics; default private (B26)"
    timestamptz updated_at
  }

  user_body_data {
    uuid user_id PK, FK
    text sex "male or female"
    date birthdate "set at signup; must be 18+ (null only on pre-gate rows)"
    numeric bodyweight_kg "positive"
    timestamptz updated_at
  }

  follows {
    uuid follower_id PK, FK
    uuid followee_id PK, FK "cannot equal follower_id"
    timestamptz created_at
  }

  blocks {
    uuid blocker_id PK, FK
    uuid blocked_id PK, FK "cannot equal blocker_id"
    timestamptz created_at
  }

  exercises {
    uuid id PK "library: uuidv5(namespace, slug); customs: client-generated"
    uuid owner_id FK "null means shared launch-library exercise"
    text slug UK "library rows only (unique among them); null on customs"
    text name "1-80 chars"
    text primary_muscle "library: display text; customs: a muscle key (chest, quads...) or null"
    text equipment "free text; customs use the six library kinds (Barbell...) or null"
    timestamptz deleted_at "customs only (CHECK); set = soft-deleted by its owner (B31)"
    timestamptz created_at
    timestamptz updated_at
  }

  workouts {
    uuid id PK "client-generated (offline-first)"
    uuid user_id FK
    text title "max 100"
    text notes "max 2000"
    timestamptz started_at
    timestamptz ended_at "null while in progress; never before started_at"
    workout_visibility visibility "public, followers or private; follows its post's on change (B26)"
    uuid program_workout_id FK "program session it was started from; null = ordinary workout (B35)"
    timestamptz created_at
    timestamptz updated_at
  }

  workout_exercises {
    uuid id PK "client-generated"
    uuid workout_id FK
    uuid exercise_id FK "set null when the exercise is deleted"
    smallint position "0-based display order; not unique so offline reorders sync row by row"
    text notes "max 1000"
    smallint superset_group "null = alone; neighbours sharing a number = one superset"
    timestamptz created_at
    timestamptz updated_at
  }

  sets {
    uuid id PK "client-generated"
    uuid workout_exercise_id FK
    smallint position "0-based order within the exercise"
    integer reps "0 or more"
    numeric weight_kg "0 or more; stored in kg, displayed per user unit"
    numeric rpe "1 to 10"
    boolean is_warmup "default false"
    smallint drop_set_position "null on plain and top sets; drops are 1, 2, ..."
    integer duration_seconds "for timed work, at least 0"
    text score "WOD result, max 100 chars; display only"
    text notes "remark on this one set, max 500 chars; display only"
    timestamptz created_at
    timestamptz updated_at
  }

  personal_records {
    uuid id PK "deterministic: uuidv5(PR namespace, user:exercise:kind:reps)"
    uuid user_id FK
    uuid exercise_id FK
    pr_kind kind "true1rm, repMax or e1rm"
    smallint reps "rep-max books only, 2 or more; null otherwise"
    numeric value_kg "current best, more than 0, 3 decimals"
    uuid source_set_id FK "the set holding the record"
    timestamptz created_at
    timestamptz updated_at
  }

  sync_tombstones {
    bigint id PK "identity; strictly increasing download bookmark"
    uuid user_id FK "whose row was deleted"
    text tbl "workouts or personal_records"
    uuid row_id "id of the deleted row"
    timestamptz deleted_at "server clock"
  }

  workout_analyses {
    uuid id PK "FK to workouts.id: the analysed workout"
    uuid user_id FK "copied from the workout row"
    integer engine_version "rules version (ANALYSIS_ENGINE_VERSION)"
    numeric total_volume_kg "work-set reps x weight, 3 decimals, 0 or more"
    integer total_sets "every set, 0 or more"
    integer working_sets "non-warm-up sets, at most total_sets"
    integer duration_seconds "ended_at minus started_at, 0 or more"
    jsonb new_prs "array of {exercise_id, exercise_name, kind, reps, value_kg}"
    text headline "encouraging copy, picked by rule"
    text message "encouraging copy, picked by rule"
    timestamptz workout_updated_at "workout's updated_at it was computed from"
    timestamptz created_at
    timestamptz updated_at
    integer trend_sessions "B42: earlier sessions averaged, 5 to 10; null below threshold"
    numeric trend_volume_avg_kg "B42: their mean volume, 0 or more; null below threshold"
    numeric trend_rpe_avg "B42: mean of their average RPEs, 1 to 10; null if under 3 have RPE"
    numeric trend_load_per_rep_avg_kg "B42: mean load per rep, 0 or more; null if under 3 have load"
    numeric session_rpe_avg "B42: this session's average RPE, 1 to 10, or null"
    numeric session_load_per_rep_kg "B42: this session's volume per loaded rep, or null"
  }

  flairs {
    text id PK "stable slug: wod, physique-check, new-pr, form-check"
    text name "what the chip shows, 1-40 chars"
    smallint position UK "display order"
    boolean upvotes_only "true for Physique Check; the votes trigger refuses downvotes (B23)"
  }

  posts {
    uuid id PK "client-generated: made on the phone (Post step or Share a photo), even offline"
    uuid user_id FK "the author"
    text flair_id FK "required: exactly one flair"
    text kind "workout (default), progress-pic or pr (B22), or reshare (B28)"
    uuid workout_id FK, UK "workout posts only (null for photo posts and re-shares); one post per workout"
    text image_path "photo posts only: <user_id>/<post_id>.<ext> in post-images (B22)"
    uuid shared_post_id FK "re-shares only (B28): the original post; never itself a re-share; unique per (user_id, shared_post_id)"
    workout_visibility visibility "public, followers or private; default public; owner may change it (B26)"
    timestamptz created_at "feed order, newest first"
    timestamptz updated_at
  }

  storage_objects {
    text bucket_id "post-images (private; 10 MiB) or avatars (public read; 5 MiB, B25); jpeg, png, webp"
    text name "object path; first folder = owner's user id"
    uuid owner "uploader (Supabase-managed)"
  }

  votes {
    uuid post_id PK, FK "the post voted on"
    uuid user_id PK, FK "the voter; PK (post_id, user_id) = one vote per user per post"
    smallint value "+1 or -1 only; -1 refused on upvotes_only flairs (trigger)"
    timestamptz created_at
    timestamptz updated_at
  }

  comments {
    uuid id PK "server-generated (gen_random_uuid)"
    uuid post_id FK "the post commented on"
    uuid user_id FK "the commenter"
    text body "1-500 chars, at least one non-whitespace character"
    timestamptz created_at "conversation order, oldest first"
    timestamptz updated_at
  }

  post_scores {
    uuid post_id "= posts.id (VIEW, not a table)"
    int score "sum of votes.value, 0 when none"
    int comment_count "count of comments, 0 when none"
  }

  post_hot_scores {
    uuid id "= posts.id (VIEW, not a table)"
    uuid user_id "= posts.user_id (FK kept: embeds author)"
    text flair_id "= posts.flair_id (FK kept: embeds flair; filter)"
    uuid workout_id "= posts.workout_id (FK kept: embeds workout)"
    uuid shared_post_id "= posts.shared_post_id (B28; the app reads originals in a second request)"
    text kind "= posts.kind"
    text image_path "= posts.image_path"
    workout_visibility visibility "= posts.visibility"
    timestamptz created_at "= posts.created_at"
    float8 hot_score "Reddit hot: sign(net)*log10(max(abs(net),1)) + (epoch-1134028003)/45000"
  }

  mutes {
    uuid muter_id PK, FK "who muted"
    uuid muted_id PK, FK "who is hidden from them; cannot equal muter_id"
    timestamptz created_at
  }

  moderators {
    uuid user_id PK, FK "a moderator (the founder); written only by service role / migration"
    timestamptz created_at
  }

  reports {
    uuid id PK "server-generated"
    uuid reporter_id FK "who reported"
    text target_kind "post or comment"
    uuid target_id "the post / comment id (no FK)"
    uuid reported_user_id FK "content's author, stamped by trigger; CHECK not the reporter"
    text reason "spam, harassment, nudity, not-training, impersonation, other"
    text details "optional, max 500"
    text status "open (default), resolved, dismissed"
    timestamptz created_at
  }

  programs {
    uuid id PK "client-generated (authored offline, B34)"
    uuid user_id FK "the author; the only person who can change it"
    text name "1-100 chars"
    program_visibility visibility "private (default), followers, team, published (B39)"
    tsvector search "GENERATED from name, 'simple' config (B40); server-only, never synced"
    timestamptz deleted_at "soft delete; null while live"
    timestamptz created_at
    timestamptz updated_at
  }

  program_weeks {
    uuid id PK "client-generated"
    uuid program_id FK
    smallint position "0 or more; Week N by order; not unique (offline edits)"
    timestamptz deleted_at "soft delete"
    timestamptz created_at
    timestamptz updated_at
  }

  program_workouts {
    uuid id PK "client-generated"
    uuid program_week_id FK
    text name "max 100; null shows as Workout N"
    smallint position "0 or more; not unique"
    timestamptz deleted_at "soft delete"
    timestamptz created_at
    timestamptz updated_at
  }

  program_exercises {
    uuid id PK "client-generated"
    uuid program_workout_id FK
    uuid exercise_id FK "library or custom; set null on hard delete"
    smallint position "0 or more; not unique"
    smallint target_sets "required, at least 1"
    integer target_reps "optional, 0 or more"
    numeric target_weight_kg "optional, 0 or more, kg like sets.weight_kg"
    numeric target_rpe "optional, 1 to 10"
    timestamptz deleted_at "soft delete"
    timestamptz created_at
    timestamptz updated_at
  }

  program_runs {
    uuid id PK "client-generated"
    uuid user_id FK "the lifter running it"
    uuid program_id FK "existence-only; grants no read of the program"
    smallint next_week_position "stored position (not Week N) of the next session's week, 0 or more"
    smallint next_workout_position "stored position of that workout in its week, 0 or more"
    timestamptz started_at
    timestamptz ended_at "null = active; CHECK never before started_at"
    timestamptz created_at
    timestamptz updated_at "trigger-maintained"
  }

  teams {
    uuid id PK "server default gen_random_uuid (online-only)"
    uuid created_by FK "the creator = the owner; not updatable"
    text name "1 to 80 characters (CHECK)"
    team_join_mode join_mode "open (default) or invite"
    timestamptz created_at
    timestamptz updated_at "trigger-maintained"
  }

  team_members {
    uuid team_id PK,FK "PK (team_id, user_id): one row per lifter per team"
    uuid user_id PK,FK
    team_role role "owner (trigger only), coach (set by the owner, B37), member"
    timestamptz joined_at
  }

  team_invites {
    uuid team_id PK,FK "PK (team_id, user_id)"
    uuid user_id PK,FK "the invitee; row deleted when they join"
    timestamptz created_at
  }

  team_posts {
    uuid id PK "server default gen_random_uuid (online-only)"
    uuid team_id FK
    uuid author_id FK "the coach who pushed it"
    team_post_kind kind "announcement, program or workout"
    text body "announcement only; 1 to 2000 characters (CHECK)"
    uuid program_id FK "program pushes only (CHECK)"
    uuid program_workout_id FK "workout pushes only (CHECK)"
    timestamptz created_at "immutable: no update policy"
  }

  team_assignments {
    uuid team_id PK,FK "PK (team_id, user_id, program_id)"
    uuid user_id PK,FK "the assignee"
    uuid program_id PK,FK "the coach's program"
    uuid assigned_by FK "the coach"
    timestamptz created_at "row deleted when the member starts or dismisses it, or leaves / is removed (B38)"
  }

  team_feed_hides {
    uuid team_id PK,FK "PK (team_id, post_id): a repeat hide is 23505"
    uuid post_id PK,FK "the hidden post (stays visible everywhere else)"
    uuid hidden_by FK "who hid it (the owner)"
    timestamptz created_at
  }
```

## Team moderation (B38)

Migration `20261115232206_team_moderation.sql`. Every right here is the **owner's**, through the
existing `private.is_team_owner`; nothing widens what anyone can read.

- **Removing members.** Policy `owners remove members` on `team_members` (delete): the owner, never
  on the owner row (`role <> 'owner'`). It ORs with B36's `members leave teams`, so the owner row
  can be deleted by nobody (only cascades). Coaches are removable. Removal is not a ban: on an
  `open` team the removed lifter may join again; on `invite` they need a new invite.
- **Cleanup trigger.** `on_team_member_removed` (after delete on `team_members`,
  `private.handle_team_member_removed`, security definer): on **every** membership delete it
  deletes that member's `team_assignments` in the team; when the deleter is **someone else**
  (`auth.uid() is distinct from old.user_id` — a null caller, e.g. a server cascade, counts) it also
  deletes their `team_invites` row, so a removed member of an invite-only team can't rejoin with a
  stale invite. A voluntary leave keeps the invite (B36 G12). The first trigger here to read
  `auth.uid()`.
- **`team_feed_hides`** — the owner's curation of the Team feed. Insert: the owner, with
  `hidden_by` = themselves. Read: whoever can read the roster (`is_team_member` or the team is
  `open`) — the Team feed's readers need the list to apply it. Delete (unhide): the owner. No
  update. **A hide is not privacy**: it changes no post's visibility; the app leaves hidden posts out
  of the team page only (the owner still sees them as markers to unhide). Home, profiles and the API
  return the post exactly as posts RLS says.
- **`team_posts` delete** gains `owners remove pushes`: the owner may delete any push (author OR
  owner). Read is unchanged.
- **Team deletion.** `owners delete their teams` on `teams` (delete, owner only). `team_members`,
  `team_invites`, `team_posts`, `team_assignments` and `team_feed_hides` all cascade; members'
  posts, workouts and programs are untouched.
- Live-probed at B38 (one rolled-back DO block; owner, coach, two members, outsider): owner removes
  a member → 1 row, their assignment and stale invite gone; a member leaving → assignment gone,
  invite kept; coach / member / outsider removals and anyone deleting the owner row → 0 rows; a
  removed member rejoins an open team, but 42501 once it is invite-only; owner hide lands, coach /
  member hides (and a coach forging `hidden_by`) 42501; the hidden post still reads on Home, the
  roster-minus-hides read leaves it out; an outsider reads the open team's hides (1) and 0 once
  invite-only; coach unhide 0, owner 1; coach deleting the owner's push 0, owner deleting the
  coach's 1; member and coach team deletes 0, owner 1 → every team-scoped row gone, posts,
  workouts and the program kept.

## Program visibility (B39)

Migration `20261115235525_program_visibility.sql`. Who besides its author may see a program.

- **`programs.visibility`** (enum `program_visibility`: `private` default, `followers`, `team`,
  `published`). Every pre-B39 program is private. Only the author can change it (the B34 update
  policy is untouched). Synced to the phone like any program column.
- **The rule lives once:** `private.program_visible(pid, owner, vis, deleted)` (definer). The author
  always (soft-deleted rows included, so a delete still syncs to their other phones); nobody else
  ever sees a deleted program; `published` → any signed-in user; `followers` → a follower of the
  author with no block either way; `team` → a member of any team in `program_team_shares` for that
  program. Blocks do **not** cut `team` (team content addresses the team, the `team_posts`
  precedent) or `published` (a public shelf). Mutes play no part. `private` has no arm.
- **`programs` select policy** is now `visible programs are readable` =
  `program_visible(id, user_id, visibility, deleted_at)`. **The three child tables' policies stay
  author-only** — the phone pulls them unfiltered, so widening them would fill readers' mirrors
  with other authors' rows. The parent is safe to widen because the phone filters its programs
  download to the signed-in lifter.
- **`program_team_shares`** (program, team). Insert: the author (`owns_program`) and only a team
  they are a member of. Read: the author, or members of that team. Delete: the author. No update.
  Online-only (not mirrored). Shares stand when the author later leaves the team, and stay (inert)
  when visibility moves off `team`.
- **`public.program_payload(p_program)`** (definer, `stable`, EXECUTE revoked from public/anon,
  granted to authenticated): the program's live tree as JSON — the same shape as
  `team_program_payload` — when `program_visible` admits the caller, else null. This is how a
  non-author reads a shared program's content (online; the Marketplace program page calls it, B40).
- **`private.program_tree_json(pid)`** — the one tree builder (gate-free, `private` only). Both
  `program_payload` and `team_program_payload` build through it; `team_program_payload`'s gate is
  unchanged (a pushed or assigned program stays team-readable whatever its visibility).
- Live-probed at B39 (one rolled-back DO block; author A, B, C, team T with A and B, team T2 with
  C): private → B row 0 / payload null; followers → follower B 1 / tree, non-follower C 0 / null,
  blocked B 0 / null; team → share by A to T lands, A sharing to T2 (not a member) and C sharing A's
  program both 42501, member B 1 / tree and sees the share row, B's unshare deletes 0, non-member C
  0 / null, B after leaving T 0 / null; published → B and C 1 / tree, B's update of A's visibility
  0 rows; published + soft-deleted → C 0 / null while A still reads the row; B's bare reads of the
  three child tables 0 rows at every level; a private program pushed to T still returns its tree
  through `team_program_payload` (B37 unregressed).

## Marketplace search (B40)

- **`programs.search`** — `tsvector GENERATED ALWAYS AS (to_tsvector('simple', name)) STORED`.
  Nobody writes it; it follows `name`. `'simple'` (no stemming, no stop words): names are proper
  nouns and jargon. Whole-word matching only — "starting" finds "Starting Strength", "start" does
  not. **It must stay out of the device's `TABLE_COLUMNS.programs`**: sync selects and uploads
  named columns, and an upload naming a generated column is refused by Postgres. The phone's
  mirror has no such column (no device schema change).
- **`programs_search_idx`** — GIN on `search`. The Marketplace's search is PostgREST
  `search=wfts(simple).<typed text>` (`websearch_to_tsquery`, safe for raw input).
- **`programs_published_idx`** — `(created_at desc, id desc) WHERE visibility = 'published' AND
  deleted_at IS NULL`: the browse list's exact shape.
- **No policy change.** The browse read is B39's `visible programs are readable`; the app also
  filters `visibility = published` and `deleted_at is null` itself, because the author arm would
  otherwise return the reader's own private and deleted programs. Another lifter's non-published
  rows never return either way.
- Live-probed at B40 (rolled back): a published row and a private row of A both matched the word;
  B, as `authenticated`, read 1 row by search with and without the visibility filter (the
  published one), `program_payload` non-null for the published and null for the private; the
  column is `attgenerated = 's'` and non-null on every existing row.

## Program votes, comments and Featured (B41)

Migrations `20261116012712_program_votes_comments.sql` and its fix
`20261116015334_program_social_reads.sql`. Online-only, like post votes and comments: no device
mirror, no sync change, nothing in `TABLE_COLUMNS`.

- **Same shapes as the post tables**, keyed by `program_id`: `program_votes` (PK `(program_id,
  user_id)` = one vote per lifter, a changed mind is an upsert that rewrites the row) and
  `program_comments` (the same body CHECK as `comments`, mirrored by `commentLimits.ts` — two
  CHECKs and one module change together). Both have the `moddatetime` trigger. Both arrows: no
  upvote-only trigger (programs have no flair).
- **`private.can_view_program(pid)`** (definer, stable) — "may the caller see this program?",
  answered by `program_visible` through the program row (mirrors `can_view_post`).
  **`private.program_published(pid)`** (definer, stable) — published and not deleted: the write gate.
- **Reads** (both tables): your own rows always, or rows on a program you may see whose author you
  may see (`private.author_visible`, the B27 rule — a blocked-either-way or muted lifter's votes
  and comments drop out). The own-rows arm exists so a DELETE of your own row always finds it
  (Postgres gates a DELETE's scan with the select policy).
  **Writes:** insert (and, votes only, update) only as yourself on a published live program;
  delete only your own, on any program. No update policy on comments (no editing).
- **`program_scores`** (view, `security_invoker`) — every program the viewer may read, carrying
  the programs columns the Marketplace read uses (so the Featured read embeds the author with
  `profiles!programs_user_id_fkey` and applies the shelf filters on the view), plus `score` (all
  time), `score_week` / `score_month` / `score_year` (`sum(value) filter (where created_at >=
  now() - 7 / 30 / 365 days)`) and `comment_count`. Windows are **rolling** and count when a vote
  was **cast**: flipping a vote rewrites it in place, so it moves (by 2 for up→down) every window
  it already sat in, never "this week". Like `post_scores`, the sums are the votes *you* may read.
- **Live-probed at B41 (rolled back):** a vote on a private program, a vote as someone else and a
  comment on a private program → 42501; 501 chars and whitespace-only → 23514; a non-author sees 0
  votes / comments / score rows on a private program; an upsert by the same voter keeps 1 row;
  another user's update of a comment → 0 rows. Planted votes 8 and 400 days back: week 2 vs 1
  ranked A above B, all time 3 vs 2 ranked B above A; flipping the 400-day vote moved only `score`
  by 2, flipping a fresh vote flipped the week ranking. After the fix: a blocker sees the blocked
  lifter's comment and vote drop out (author still sees both); after an unpublish the voter's
  unvote and comment delete → 1 row each, a flip → 42501.

## Team coaching (B37)

Migration `20261115222643_team_coaching.sql`. Online-only like the rest of Teams.

- **Coaches.** The owner always counts as a coach (`private.is_team_coach(tid)` = caller's role is
  `owner` or `coach` — the one home of the rule). Policy `owners change member roles` on
  `team_members` (update): only the owner, never on the owner row (`using role <> 'owner'`), and
  the new role must be `coach` or `member` (`with check`). UPDATE is revoked at table level and
  granted back on `(role)` only, so `user_id` / `team_id` can't be rewritten (42501, probed).
- **`team_posts`** (pushes). Insert: as yourself, a coach of the team, and a `program_id` /
  `program_workout_id` you own (`owns_program`, walking `workout_week` → `week_program` for a
  workout). Read: any member of the team (`is_team_member`). Delete: the author (and, from B38,
  the owner). No update. Three
  CHECKs make the payload match the kind exactly.
- **`team_assignments`.** Insert: `assigned_by` = you, a coach of the team, your own program, an
  assignee who is on the team (`private.user_in_team(tid, uid)`), no block either way. Read and
  delete: the assignee or any coach of the team. The member's phone copies the program and starts
  its run, then deletes the row (no status column, no trigger).
- **Payload functions** (`public`, security definer, `stable`, EXECUTE revoked from public/anon,
  granted to authenticated): `team_program_payload(p_team, p_program)` returns the live program
  tree as JSON (`{name, weeks:[{position, workouts:[{name, position, exercises:[{exercise_id,
  exercise_name, position, target_*}]}]}]}`, ordered (position, id) at every level) — or **null**
  unless the caller is a member of the team AND the program was pushed to it (a `program` post) or
  assigned to the caller there, AND the program is not soft-deleted.
  `team_workout_payload(p_team, p_program_workout)` returns one live program workout plus
  `program_name`, same gate with a `workout` post. Both share `private.program_workout_json(pwid)`
  (definer, no gate of its own — `private` is not exposed). The program tables' own RLS is
  untouched (still author-only), so nothing of the coach's program reaches a member's sync mirror.
- **Coach log access (TEAM-5).** `private.coach_reads_logs(owner)`: the caller is owner/coach of a
  team that `owner` is a member of, and no block either way. It is OR'd into the **workouts**
  select policy and into `private.can_read_workout_log(wid)`, which the **workout_exercises** and
  **sets** select policies now use. It ignores visibility — a coach sees `private` workouts — and
  mutes. Deliberately NOT widened: `private.workout_visible` (posts use it), `private.can_view_workout`
  (personal records read through it via `can_view_set`), analyses, body data, storage. Access ends
  the moment the membership or role row changes.
- Live-probed at B37 (one rolled-back DO block; owner, coach, two members, outsider): member
  self-promote 0 rows; owner promotes 1; promote-to-owner, `user_id` rewrite, pushing someone else's
  program or workout, a malformed post, assigning an outsider and a member's push all refused; the
  coach reads the member's private workout, its entry and its set but 0 PRs and 0 posts; the other
  member and the outsider read 0; members read 3 pushes, the outsider 0; the member's payloads
  return the tree, a never-pushed / someone else's / soft-deleted program and the outsider's calls
  return null; anon has no EXECUTE; after a block the coach reads 0.

## Teams (B36)

Migration `20261115212541_teams.sql`. A **team** is a named group of lifters with a shared feed.
Teams are **server-only**: nothing about them is mirrored on the phone, ids default on the server,
and every create / join / switch / invite is a direct API call (the votes precedent).

- **Join modes.** `join_mode` is `open` by default — any signed-in lifter may add themselves. In
  `invite` mode only a lifter holding a `team_invites` row may join. Inviting works in both modes.
- **Owner = creator.** Inserting a `teams` row fires `on_team_created` (`private.handle_new_team`,
  security definer), which writes the creator's `owner` membership row in the same transaction. No
  client can write an owner or coach row (the join policy allows `role = 'member'` only), and the
  B37 role policy never touches the owner row, so the owner is always the creator. `coach` is set
  by the owner from B37 (see "Team coaching").
- **Joining uses the invite up.** Inserting a `team_members` row fires `on_team_member_created`
  (`private.handle_new_team_member`, security definer), which deletes that lifter's invite to that
  team. So an invite row always means "may join and hasn't yet".
- **`created_by` can't be rewritten.** UPDATE on `teams` is revoked from `authenticated` and `anon`
  at table level and granted back to `authenticated` only on `(name, join_mode)` — so even the owner
  can only rename the team or switch its mode (`created_by` update → 42501, probed).
- **No team deletion** in B36 (no delete policy); account deletion cascades a creator's teams, their
  memberships and invites. B38 adds the owner's delete policy (see "Team moderation").
- **The Team feed is not a table.** It is the ordinary posts read (`loadFeedPage`) with the roster's
  user ids as the authors. Posts RLS is untouched, so a member's followers-only post shows in the
  Team feed only to members who follow them.
- **Helpers** (all `private`, security definer, `stable`): `is_team_member(tid)`,
  `is_team_owner(tid)`, `team_mode(tid)`, `has_team_invite(tid)` — the team rules' one home.
- Live-probed at B36 (two rolled-back DO blocks, synthetic users): owner row by trigger; default
  open; forged owner join, forged creator, non-owner invite, uninvited invite-only join, invite
  across a block and `created_by` rewrite all 42501; a non-owner's mode switch updates 0 rows; an
  outsider reads the team row but 0 roster rows of an invite-only team; invitee joins and the
  invite is gone; the owner can't leave or be removed; the feed query widened nothing.

## Program runs (B35)

Migration `20261115203159_program_runs.sql`. One `program_runs` row per time a lifter starts
running one of their programs, holding **where they are**: the stored `position` of the next
session's week and of that workout within the week. Positions, not a `program_workout_id`,
because programs are edited while they run — weeks and workouts are never renumbered, so a
stored position keeps meaning the same session, and when that session is deleted the app slides
to whatever now stands there (`resolveNextSession` in `programs/programRuns.ts`).

- **Owner-only RLS, all four verbs** (`user_id = auth.uid()`). Live-probed at B35 (rolled back): a
  second user reads, updates and deletes 0 rows; a run forged under another user's id is refused
  (42501); a negative position and `ended_at < started_at` are refused by CHECKs (23514).
  `program_id` is existence-only (the `exercise_id` precedent): it proves the program exists and
  grants no read of it.
- **"At most one active run per lifter" is NOT in the schema.** There is deliberately no unique
  index on `(user_id) where ended_at is null` — two phones starting runs offline would both upload
  an active row and the second would be refused, blocking that phone's upload queue forever. The
  rule lives in the app: starting a run ends every active run the phone sees in the same save,
  and every read takes the **newest** active run (`started_at desc, id desc`). A hand-written
  query must do the same and must not assume at most one active row.
- **Never deleted; runs end.** Stopping, finishing the last session, and starting another program
  all stamp `ended_at` (an update — no tombstones). The app clamps every end time to be no earlier
  than `started_at`, so the CHECK is unreachable by honest phones. Ended rows are run history
  (nothing reads them yet). Account deletion cascades through `user_id`; a hard-deleted program
  cascades its runs.
- **`workouts.program_workout_id`** (nullable, `on delete set null`, indexed): the program workout
  a logged session was started from — set once at start on the phone. Finishing such a workout
  moves the run on, on the phone, in the same transaction as the finish. Existence-only too; the
  workouts policies govern the row. A random uuid is refused by the FK (23503, probed).

## Programs (B34)

Migration `20261115193156_programs.sql`. A lifter's own training program, authored as **weeks →
workouts → exercise slots**: `programs` (named, owned by `user_id`) → `program_weeks` (no name,
shown as "Week N" by `position`) → `program_workouts` (optional name, else "Workout N") →
`program_exercises` (one library or custom exercise with a required `target_sets` and optional
`target_reps`, `target_weight_kg` — always kg — and `target_rpe`). Every id is made on the phone;
the phone authors offline and uploads through the outbox like any training row.

- **Author-only, all four verbs, all four tables.** The rule lives once in
  `private.owns_program(pid)` (definer: `programs.user_id = auth.uid()`); children reach their
  program through `private.week_program(week_id)` and `private.workout_week(pwid)`, so e.g.
  `program_exercises` is guarded by `owns_program(week_program(workout_week(program_workout_id)))`.
  Live-probed at B34 (rolled back): a second user reads 0 rows by id and unfiltered, updates and
  deletes 0 rows, and inserting a week or slot into the first user's program — or a program under
  the first user's id — is refused (42501); RPE 11, 0 sets and an empty name are refused by CHECKs.
- **Visibility arrived in B39** (see "Program visibility"): the `programs` read rule widened; the
  children's did not. **Standing warning:** the phone downloads the three child tables unfiltered
  and relies on their select rules returning only the caller's own rows; letting others read
  children directly would pull other authors' rows into the device mirror. Others read content
  through `program_payload` instead.
- **Deletes are soft.** The app never sends a `DELETE` for a program row: removing a program, week,
  workout or slot stamps that one row's `deleted_at` and upserts it (children are left alone). A row
  is live when its own stamp and every ancestor's are null, which is how the app reads the tree. No
  tombstones (an update syncs like any edit). Account deletion still removes everything:
  `programs.user_id` cascades from `profiles`, and the chain cascades down.
- `position` columns order siblings and are not unique (offline edits sync row by row); the app
  orders by `(position, id)`. `exercise_id` is `on delete set null` (the `workout_exercises`
  precedent) — a hard-deleted exercise leaves a "Deleted exercise" slot.

## Moderation and safety (B27)

Migrations `20261115150035_moderation.sql` and `20261115151850_reports_not_self.sql`.

- **Mute** (`mutes`, one row per muter→muted): one-way and silent. Spelled once in
  `private.muted_by_viewer(author)` (definer), which `private.workout_visible` now consults beside
  the blocks clause — so a lifter you muted has their workouts, posts, PR history and photos
  hidden from *you* on every surface (feed, profile tabs, storage reads). Their view of you does not
  change. Mute does **not** touch follows (no trigger). Deleting the row restores everything.
- **Author-level filtering** (`private.author_visible(author)`: your own, or no block either way and
  not muted by you) joins the `votes` and `comments` read rules, so a blocked/muted lifter's
  comment or vote on a *third* person's post disappears for you too. Consequence: `post_scores` and
  `post_hot_scores` (both `security_invoker`) sum the votes *you* may see, so two viewers can see
  slightly different tallies where blocks/mutes exist.
- **Who the founder is** is a `moderators` row (seeded live per project, never in a migration),
  read by `private.is_moderator()`. You may read only your own row; no app write policy exists.
- **Reports** are an audit queue: `target_id` has no FK, so a report survives its content being
  deleted (by the author or by the founder). `reports_stamp_reported_user` (before insert,
  definer function `private.stamp_reported_user`) overwrites `reported_user_id` with the true
  author read from `posts` / `comments`, and raises `That content is gone` if the row doesn't
  exist. `reports_not_self` refuses reporting your own content. `unique (reporter_id,
  target_kind, target_id)` makes a second report of the same thing a 23505. `reports_open_idx
  (status, created_at)` serves the founder's "open, oldest first" query.
- **Removal** is the `moderate` server function (service role, below the RLS): remove-post deletes
  the post (votes/comments cascade, its workout stays) and its `post-images` object, then marks
  its open reports `resolved`; remove-comment deletes the comment and resolves its reports;
  remove-account deletes the auth user (cascading everything) and sweeps the `post-images/<id>/`
  and `avatars/<id>/` folders. A moderator's own account can't be removed this way.
- **Live-probed at build time** (synthetic users, rolled back / deleted): reports stamped the true
  author even when a different id was sent; re-reports 23505; a deleted target refused; a
  non-moderator read 0 reports, the moderator read all; a self-report refused. A mutes B → B's
  posts, workouts, hot rows, comment and vote on C's post all vanished for A; A still followed B;
  B still saw A; C still saw everything; unmute restored. A blocks B → hidden both ways, follows
  gone both ways, C unaffected; unblock restored the comment.

## Post privacy (B26)

Migration `20261115141242_post_privacy.sql` gives lifters the visibility *choice*; enforcement is
unchanged (the posts read rule and the `post-images` read rule both go through
`private.workout_visible`, on every request).

- **Any post's visibility can be changed by its author** — an ordinary update through the
  existing owner update policy (`update posts set visibility = … where id = … and user_id = me`,
  online from the post's card). Nobody else's update matches a row.
- **`posts_progress_pic_private` is dropped.** A progress pic is born with
  `user_settings.progress_pic_visibility` (default `private`; set in Settings → Privacy, mirrored
  on the phone because posting works offline) and can be changed later like any post. Its photo
  follows the post row's visibility through the bucket's read rule.
- **Lockstep trigger** `sync_workout_visibility` — `AFTER UPDATE OF visibility ON posts FOR EACH
  ROW WHEN (new.workout_id is not null and new.visibility is distinct from old.visibility)`,
  function `private.sync_workout_visibility_with_post()` (**invoker rights**, `search_path = ''`):
  sets the post's workout to the same visibility in the same transaction, so a post made private
  can't leave its session readable on the owner's profile History. It needs no extra power: the
  updater wrote the post, and the post's policies already require they own the workout. The
  workout's `updated_at` moves, so the owner's other devices download the change. The reverse
  direction (workout → post) has no trigger, because nothing changes a workout's visibility but
  this trigger. A retried upload of an unchanged post re-sends the same visibility, so it never
  fires.
- **Live-probed at build time** (three synthetic users, then deleted): when B made its public
  workout post private, its workout went private too, and follower A and stranger C then read
  neither the post nor the workout. When B set a progress pic to `followers`, A read the row and
  the storage object and C read neither. Switched back, the pic was dark for both and the workout
  was readable by both. A's update of B's post changed 0 rows. B could set its own
  `progress_pic_visibility`; A's update of B's settings row had no effect.

## Votes, comments and the net score (B23)

Migration `20261115114409_votes_comments.sql` (and its fix `20261115115739_comments_body_not_blank.sql`).

- **One vote per user per post** is the primary key `(post_id, user_id)` on `votes`. Changing your
  mind rewrites the row (the app upserts on that key), unvoting deletes it. `value` is `+1` or `-1`
  (CHECK). No device mirror: votes are read and written online only.
- **The net score** is the view `post_scores` — for every post, `score = sum(votes.value)` and
  `comment_count = count(comments)`, both 0 when there are none. It is `security_invoker`, so it can
  only add up rows the *viewer* may read: it gives no new reading power. The feed reads it in a
  second request by post id (`post_id=in.(…)`) — PostgREST will not embed a view over `posts`
  inside a `posts` request (PGRST200, probed live).
- **The hot ranking (B24, SOC-11)** is the view `post_hot_scores` (migration
  `20261115122437_post_hot_scores.sql`): every post's own feed columns plus `hot_score`, Reddit's
  published "hot" formula over the net vote sum (votes only — no comment weight). Each 12.5 hours
  of age (45000 s) weighs as much as a 10× vote lead; a post with net 0 or ±1 ranks by age alone,
  so zero-vote posts come newest first. `security_invoker`, so it ranks only what the viewer may
  see; since B27 a viewer reads only the votes of voters they may see (blocks/mutes), so the score
  can differ slightly between viewers (see Moderation and safety). The
  feed's "Hot" order reads it *directly* (`from('post_hot_scores')`, ordered `hot_score desc, id
  desc`, keyset on `(hot_score, id)`) and embeds author / flair / workout / votes through the
  preserved FK columns — unlike `post_scores`, the embed goes view → table, which PostgREST
  allows. One catch, probed live: through the view `profiles` is reachable two ways (the author
  FK, and many-to-many via `votes`), so the author embed must name `profiles!posts_user_id_fkey`
  or the server answers PGRST201. No index serves `hot_score` (computed); the vote sum aggregates
  before the author filter — measure with `explain analyze` once there is real data.
- **Upvote-only flairs (Physique Check).** Trigger `votes_upvote_only` (before insert or update on
  `votes`, function `private.vote_allowed`) raises `This post takes upvotes only` (SQLSTATE
  `P0001`) for any `value = -1` on a post whose flair has `upvotes_only = true` — read through
  posts → flairs, never a flair name. It holds on both arms of the app's upsert. Its companion,
  `posts_flair_guard` (before update of `flair_id` on `posts`, `private.flair_change_allowed`),
  refuses re-flairing a post that has downvotes *to* an upvote-only flair. Not guarded: flipping
  `flairs.upvotes_only` itself to true (flairs change only by migration).
- **Comments** are flat (no threads), oldest first, `comments_post_created_idx (post_id,
  created_at, id)` matching the screen's order; `comments_user_idx (user_id)` covers the
  commenter foreign key. The body CHECK is `char_length between 1 and 500 and body ~ '\S'`
  (mirrored by `COMMENT_MAX_CHARS` / `commentBodyError` in `frontend/src/social/commentLimits.ts`
  — change together). No editing: there is no update policy, so RLS refuses updates.
- **Live-probed at build time** (rolled back): up + up + down reads 1; down → up moves it by 2;
  unvote restores; a second insert is `23505`; a Physique Check downvote refused on insert, both
  upsert arms and update; 501 characters, spaces-only and newlines-only bodies refused; a stranger
  can neither see nor comment on a followers-only post's comments, a follower can; a comment or
  vote on the post of someone you blocked is refused; nobody can update a comment; an author
  cannot delete other people's comments on their post.

## Photo posts and the `post-images` bucket (B22)

Migration `20261115105852_post_images.sql` adds two more kinds of post — **progress-pic** and
**pr** — that carry one photo instead of a workout. `posts.kind` (default `'workout'`, so every
older row and an older app's upload stay workout posts) says which. Four CHECKs keep the shapes
honest:

- `posts_kind_shape` — a `workout` post has a `workout_id` and no `image_path`; a photo post has an
  `image_path` and no `workout_id`. (`unique (workout_id)` is untouched: nulls never collide.)
- `posts_image_in_own_folder` — `image_path` must start with the author's own `user_id/`. Without
  it a lifter could cite someone else's private photo in their own public post and the bucket's
  read rule would open it.
- ~~`posts_progress_pic_private`~~ — a progress pic was always `private` until B26, which dropped
  this CHECK when lifters got the choice (see Post privacy).
- `posts_image_path_idx` (partial, `image_path is not null`) serves the bucket's read rule.

The insert/update policies now read `workout_id is null or private.owns_workout(workout_id)`.

**The bucket** `post-images` is a row in `storage.buckets`: `public = false`, `file_size_limit =
10485760` (10 MiB — mirrored by `MAX_POST_IMAGE_BYTES` in `frontend/src/social/mediaLimits.ts`;
change both together), `allowed_mime_types = jpeg, png, webp` (no HEIC). Storage refuses an
over-limit or wrong-format upload itself, whatever the phone does. Its policies on
`storage.objects`, all scoped to `bucket_id = 'post-images'`:

| Action | Who |
| --- | --- |
| insert | only into your own folder (`(storage.foldername(name))[1] = auth.uid()`) |
| update | only your own folder (a retried upload with `x-upsert` replaces the same object) |
| select | your own folder, **or** any object a post you may see cites (`exists posts where image_path = name and private.workout_visible(user_id, visibility)`) |
| delete | only your own folder (nothing deletes photos yet) |

So a photo is readable by exactly whoever may see its post — since B26 that is the owner's
choice for progress pics too (private by default); and a photo whose post hasn't landed yet by
its owner only. The app
reads photos through `/storage/v1/object/authenticated/post-images/<path>` with the viewer's token
— there are no public URLs. Live-probed as two users at build time: B's progress pic and its object
invisible to A, B's PR photo and object visible to A, A refused uploading into B's folder, citing
B's object, a public progress pic, an imageless photo post and a workoutless workout post.

## Profiles: counts, PRs and avatars (B25)

Migration `20261115130809_profile_reads_and_avatars.sql` gives a profile what it couldn't read
before:

- **Follower / following counts** — `public.follow_counts(profile_id uuid) returns table
  (followers bigint, following bigint)`, `security definer`, `search_path = ''`, called as
  `rpc('follow_counts', { profile_id })`. It counts **every** `follows` row for that id in each
  direction (the `follows` read rule only shows a viewer the rows they are part of, so the app
  could never count someone else's) and returns only those two numbers — never a row, so nobody
  learns who follows whom. Execute is revoked from `public`/`anon` and granted to `authenticated`.
  It does not look at blocks: anyone signed in can read anyone's two counts, as anyone signed in
  can read any `profiles` row. Both directions are indexed (the `follows` primary key and
  `follows_followee_idx`).
- **Another lifter's PRs** — the `personal_records` read policy is now `"records readable with
  their source workout"`: `user_id = auth.uid() or private.can_view_set(source_set_id)`. The new
  helper `private.can_view_set(sid)` (security definer) asks `private.can_view_workout` about the
  workout holding the set, so a record is visible exactly when the workout that proves it is:
  public → any signed-in user, followers → followers, private → owner only, a block in either
  direction → hidden. The owner clause comes first, so the sync download (always filtered to the
  signed-in user) never runs the helper and never receives anyone else's rows. Write policies are
  unchanged.
- **The `avatars` bucket** — a `storage.buckets` row with `public = true`, `file_size_limit =
  5242880` (5 MiB — mirrored by `MAX_AVATAR_BYTES` in `frontend/src/social/mediaLimits.ts`; change
  both together), `allowed_mime_types = jpeg, png, webp`. Public means anyone can fetch an avatar
  from `/storage/v1/object/public/avatars/<path>` with no token: an avatar is the account's public
  face and not one of the sensitive classes (progress pics stay in the private `post-images`).
  Policies on `storage.objects`, scoped to `bucket_id = 'avatars'`: **select** (through the
  authenticated API — the Storage API needs it to delete), **insert**, **update** and **delete**,
  each only in your own folder (`(storage.foldername(name))[1] = auth.uid()`). Every upload uses a
  new `<user_id>/<uuid>.<ext>` name, so a changed photo has a new address.
- **`profiles_avatar_in_own_folder`** — CHECK `avatar_url is null or avatar_url like id || '/%'`:
  `avatar_url` holds a bucket path in the owner's own folder, never someone else's upload or an
  arbitrary URL.
- **Live-probed at build time** (synthetic users, rolled back): of three PRs from a public, a
  followers-only and a private workout, the owner read all three, a follower the first two, a
  stranger only the public one, a blocked lifter none; `follow_counts` equalled `count(*)` per
  direction for all four viewers; `anon` has no execute right; an `avatar_url` in another's folder
  was refused by the CHECK, one in the owner's folder accepted; an object insert into another's
  avatars folder was refused (42501), into one's own allowed.

## Posts and the feed (B20)

`posts` and `flairs` (migration `20261115093217_posts_flairs.sql`) are what the Home feed is made
of. A workout post shares one finished workout (B22 added photo posts, above, whose
`workout_id` is null). `unique (workout_id)` makes sharing the same session twice impossible,
which is what makes finish-to-post (B21) safe to retry.

**How a post is made (B21).** Only by the phone's Post step after Finish → analysis. The phone
writes the post into its own `posts` table with a fresh uuid, `visibility` copied from the
workout, and an outbox line, then uploads it as `INSERT … ON CONFLICT (id) DO UPDATE` (no
`updated_at`) in the last phase of a sync — after the workout itself, which `owns_workout` and the
foreign key need first. A retry lands on the same row. A `23505` on `posts_workout_unique` (a
*different* post for this workout, from another device) is treated as settled: the phone deletes
its copy. The post links its workout through `workout_id`, and the workout's analysis through the
same id (`workout_analyses.id` = the workout id) — there is deliberately no separate analysis
foreign key, since an offline finish's analysis may reach the server after the post.

- **Flairs are data.** The launch four (WOD, Physique Check, New PR, Form Check) are seeded rows;
  any signed-in user may read them and nobody may write them through the API, so a new flair is a
  migration, not an app release. The app always shows `flairs.name` from the row. `upvotes_only`
  marks Physique Check; since B23 the votes trigger enforces it and the card hides the downvote.
- **Feed order** is `created_at desc, id desc`, matched by `posts_user_created_idx (user_id,
  created_at desc, id desc)`. The phone pages by bookmark — "older than (created_at, id)" — never
  by offset. `posts_flair_idx (flair_id)` indexes the flair foreign key, and since B24 serves the
  feed's flair filter (`flair_id=eq.…`, SOC-9). The "Hot" order reads `post_hot_scores` instead
  (votes section).
- **Mostly not mirrored.** Other people's posts are never on the phone: the feed is read from the
  server each time (and embeds the workout, its entries, sets and exercise names in one request).
  Since B21 the phone keeps only its *own* posts (upload-only, never downloaded) and a copy of
  `flairs` (download-only, replaced whole each sync) — see the device mirror section.
- **The visibility enum is shared.** `posts.visibility` reuses `workout_visibility` (same three
  values, same meaning) so `private.workout_visible` serves both. The post and its workout each
  have their own visibility; the feed shows a workout post only when **both** are visible to the
  viewer. Since B22 the feed embeds the workout as a plain (left) join — `!inner` would drop every
  photo post — so the workout's own RLS returns a hidden workout as null and the app
  (`toFeedPost`) drops that empty workout card. RLS is still what withholds the content.

## The launch library inside `exercises`

The 151 shared launch exercises are rows with `owner_id` null, seeded by the generated migration
`20261114120100_library_seed.sql` — written by `automation/scripts/generate-library-seed.ts` from
`frontend/src/library/catalog.ts`, the library's one home; never edited by hand. Identity contract:
each library row's `id` is `uuidv5(LIBRARY_EXERCISE_NAMESPACE, slug)` (namespace constant exported
by `catalog.ts`), so the phone derives the same id offline without a sync round-trip. A check
constraint makes `slug` mandatory on library rows and forbidden on customs, and a partial unique
index (`slug` where `owner_id is null`) makes re-seeding idempotent. Seeds only upsert: a slug
leaving the catalog never deletes or re-identifies a row (renames are a deliberate content
migration, because workout history references these ids).

## Custom exercises (B31)

A lifter's own exercise is an `exercises` row with `owner_id` = them and `slug` null (the slug
CHECK forbids one). It gets a client-generated v4 id, is created and edited on the phone and
uploaded through the outbox like any training row, and is logged, gets PRs and history exactly
like a library row — everything downstream keys on the id. RLS keeps it private: only its owner
can read, insert, update or delete it (live-probed at B31 with two simulated users: the other
user reads 0 rows by id or unfiltered, and their update and delete affect 0 rows).

**Delete is a soft delete.** The app never sends a `DELETE` for an exercise: it stamps
`deleted_at` and upserts the row, so the delete syncs like an edit and reaches the owner's other
phones through the normal download (exercises have no tombstones). The row stays, so
`workout_exercises.exercise_id` and `personal_records.exercise_id` keep pointing at a live row —
past sessions and PRs keep the name, and nothing on a phone can dangle. The app hides stamped rows
from the Library and the logger's picker only; history and PR reads don't filter them.
CHECK `exercises_deleted_customs_only`: `deleted_at is null or owner_id is not null` — the shared
library can never be stamped. No policy changed: the owner's update policy already allows the
stamp, and the select policy already hides every custom (deleted or not) from everyone else.

## Supersets, drop sets and timed / WOD work (B11)

- **Superset** (`workout_exercises.superset_group`): exercises of one workout that sit next to
  each other (by `position`) and share a number are one superset; null means the exercise stands
  alone. The number has no meaning beyond "same group" and no CHECK on the server (the app keeps it
  1…32767). The app only writes it through two operations (link with the exercise above / unlink),
  which first rewrite the numbers to match what is shown, so a group never has one member.
  Reordering does not rewrite groups; a member moved away from its neighbours just shows alone.
- **Drop set** (`sets.drop_set_position`): saved as separate `sets` rows. The top set is null, each
  drop after it is 1, 2, … (CHECK ≥ 1). Displays group a set with the one before it when its drop
  number is higher than that set's (null counts as 0), so a drop set reads as one set.
- **Timed or scored work**: `sets.duration_seconds` (CHECK ≥ 0) holds a time; `sets.score` (added
  by `20261115024010_sets_score.sql`; CHECK
  `char_length(score) <= 100`) holds free text such as "7 rounds + 12 reps". Either can sit
  alongside reps and weight, or stand alone. Nothing parses `score`; timed or scored sets without
  reps and weight add no volume and set no PRs.

## Notes at three levels (B12)

Free text written by the lifter, for people to read; nothing parses it and analysis ignores it.
Each level has its own column and cap (all `char_length` CHECKs, so an emoji counts once):
`workouts.notes` ≤ 2000 and `workouts.title` ≤ 100 (both since the training migration),
`workout_exercises.notes` ≤ 1000 (same), and `sets.notes` ≤ 500 (added by
`20261115031049_sets_notes.sql`). The phone checks the same caps before saving (`@training-math`
`limits.ts`). Notes need no RLS of their own: they are columns on rows the policies below already
cover, so a note is visible to exactly whoever may see its workout.

## Personal records (B13)

`personal_records` (migration `20261115035806_personal_records.sql`) holds **one row per record
book**: user × exercise × kind, plus the rep count for rep maxes. It stores the current best and the
set that proves it. It is not a log of every PR ever hit. The three kinds:

- `true1rm`: the heaviest single.
- `repMax`: the heaviest weight for exactly `reps` reps, one book per rep count.
- `e1rm`: the best Epley estimate from any set.

Volume is never a record. A CHECK ties `reps` to `repMax` (set exactly when the kind is
`repMax`), and a unique index on (user, exercise, kind, `coalesce(reps, 0)`) allows only one row
per book.

- **The phone writes it.** At finish the app folds the full local history of each exercise in the
  workout through `@training-math` (`recordBooks`) and writes only books that **improved**, in the
  same transaction as the workout. The row ids are deterministic per book, so two devices that
  improve the same book offline upsert one row (the last write wins) instead of colliding.
- **Keep-best trigger** (`keep_best_record` → `private.keep_best_personal_record`, runs before
  `set_updated_at`): if an update would **lower** `value_kg`, it keeps the stored value,
  `source_set_id`, `kind`, `reps` and `exercise_id`, and lets the update succeed. It never raises.
  The row still gets a fresh `updated_at`, so the next download repairs the device. This covers a
  fresh device that finishes a lighter set before its first pull. A tie is not "lower", so it
  replaces the source set (the value stays the same; settled in B14 as last-write-wins).
- **Legitimate lowering (B14) goes around the trigger, not through it.** When an edit or delete
  of a past workout lowers a book, the phone uploads it as **delete, then insert** of the same
  row id. The trigger is `BEFORE UPDATE` only, so it never sees that; a plain lowered update
  (a stale device) is still kept at the best. Raises stay plain updates, so keep-best still
  arbitrates them against another device's higher record. The trigger itself is unchanged.
- **Cascades**: deleting the source set, or the exercise, deletes the record row.

## Tombstones (B14)

`sync_tombstones` (migration `20261115045638_sync_tombstones.sql`) is the list of rows that
stopped existing, so a user's other devices can delete their copies (a download cannot see an
absent row). One line per deleted **workout** or **personal record**, written by the
`record_tombstone` trigger — `AFTER DELETE … FOR EACH ROW` on both tables, so rows removed by a
cascade (a deleted workout's records, via its sets) are recorded too. Deleted entries and sets get
no tombstone: their workout is re-stamped, and other devices re-download the whole workout and
drop what is missing. Devices read "tombstones after id N" by the `bigint` identity. The trigger
(`private.record_tombstone`, `security definer`) skips users whose profile is already gone, so
deleting an account is not blocked by the `user_id` foreign key. Retention is unbounded for now.

## Workout analyses (B18)

`workout_analyses` (migration `20261115080420_workout_analyses.sql`) holds **exactly one
post-workout analysis per finished workout**: its primary key *is* the workout's id, so retries,
crashes or two devices can never make a second one. It is written **only** by the
`analyze-workout` server function (`backend/supabase/functions/analyze-workout/`), using the
service role, as an upsert on `id` — so a re-analysis after an edit replaces the row (keeping
`created_at`; `moddatetime` moves `updated_at`). The numbers and copy come from the shared,
deterministic rules in `functions/_shared/analysis/` (no AI model): volume via `@training-math`'s
`sessionVolumeKg`, `new_prs` = the `personal_records` rows citing the workout's sets at the time
it was computed (exercise names snapshotted). `workout_updated_at` is the staleness test: when it
is older than the workout's `updated_at`, the phone asks for the analysis again. A CHECK keeps
`new_prs` a JSON array. The function reads as the caller and refuses (404) any workout the caller
does not own, so another user's public workout can never be analysed over its owner's row.

**The trend (B42, migration `20261116023347_analysis_trend.sql`, engine version 2).** Six
nullable numbers compare the session with the lifter's own recent history, computed by
`functions/_shared/analysis/trend.ts` on both the server and the phone. *History* = the owner's
finished workouts that started strictly before this one (same instant → lower id first), the 40
newest considered, empty finishes (no sets) dropped, then the 10 newest kept. With **fewer than 5**
such sessions, `trend_sessions`, `trend_volume_avg_kg`, `trend_rpe_avg` and
`trend_load_per_rep_avg_kg` are all **null** — the analysis screen shows no trend section. Above
it: `trend_sessions` (5–10) is how many were averaged; `trend_volume_avg_kg` is their mean volume;
`trend_rpe_avg` is the mean of their per-session average RPE (non-warm-up sets with an RPE of
1–10) and is null unless at least 3 of them have one; `trend_load_per_rep_avg_kg` is the mean of
their volume ÷ loaded reps, null unless at least 3 have load. `session_rpe_avg` and
`session_load_per_rep_kg` are this session's own two measures, stored whenever computable,
threshold or not. RPE values keep 2 decimals and kg values 3, so stored and recomputed numbers
match. CHECKs: `trend_sessions` 5–10, both RPE columns 1–10, the kg columns ≥ 0. No policy change
(owner select only; only the function writes). Rows made by engine version 1 have all six null;
the phone treats an older `engine_version` like a stale row and asks the function again (10 per
sync, newest first). History edits do not re-stamp later workouts' trend (it is recomputed only
when that workout's own analysis is).

## Enums

- `workout_visibility`: `public` (any signed-in user), `followers` (people who follow the owner),
  `private` (owner only). Used by `workouts.visibility`, `posts.visibility` (B20) and as the
  per-user defaults in `user_settings` (`default_workout_visibility`; `progress_pic_visibility`,
  B26).
- `pr_kind`: `true1rm`, `repMax`, `e1rm`. These are exactly the app's `PrKind` names in
  `@training-math`. Used by `personal_records.kind`.
- `team_join_mode` (B36): `open`, `invite`. Used by `teams.join_mode`.
- `team_role` (B36): `owner`, `coach`, `member`. Used by `team_members.role`; `coach` is granted
  by the owner (B37).
- `team_post_kind` (B37): `announcement`, `program`, `workout`. Used by `team_posts.kind`.

## What happens automatically (triggers)

- **Signup creates the identity rows — and enforces 18+.** Inserting into `auth.users` fires
  `handle_new_user` (migration `20261114224613_signup_birthdate_gate.sql`). It first reads
  `birthdate` (`YYYY-MM-DD`) from the signup's user metadata (`raw_user_meta_data`) and **refuses
  the signup** (raises, rolling the whole account creation back) if it is missing, not a real date,
  or later than `current_date - 18 years`. Otherwise it inserts a `profiles` row (display name taken
  from the email, before the `@`), a default `user_settings` row and a `user_body_data` row with
  `birthdate` stamped, all in the same transaction. An account can never exist without its profile
  or without an 18+ birthdate on record. Every creation path, admin/dashboard and probe scripts
  included, must send `birthdate` in user metadata. That metadata copy is transport only. Age is
  always read from `user_body_data.birthdate`.
- **Birthdates stay 18+ after signup.** The check constraint `user_body_data_birthdate_18_plus`
  (`birthdate is null or birthdate <= current_date - 18 years`) stops a later edit from setting an
  under-18 or future date.
- **Blocking severs follows.** Inserting a `blocks` row fires `handle_new_block`, which deletes any
  `follows` row between the two people in either direction.
- **`updated_at` is maintained** by a trigger on every table that has the column.
- **Deletes leave tombstones.** Deleting a `workouts` or `personal_records` row (directly or by
  cascade) inserts a `sync_tombstones` line (see Tombstones above).
- **Downvotes on upvote-only posts are refused** (B23): `votes_upvote_only` on `votes` and
  `posts_flair_guard` on `posts` — see the votes section.
- **A workout follows its post's visibility** (B26): `sync_workout_visibility` on `posts` — see
  Post privacy.
- **A report's reported account is stamped from the content** (B27): `reports_stamp_reported_user`
  on `reports` — see Moderation and safety. Muting has no trigger (follows stay).
- **A re-share is checked and wears its original's flair** (B28): `posts_reshare_shape` on `posts`
  — see Re-shares.
- **A new team gets its owner row** (B36): `on_team_created` on `teams`; **joining a team deletes
  your invite to it**: `on_team_member_created` on `team_members` — see Teams. **Leaving or being
  removed clears your assignments** (and, when removed, your invite): `on_team_member_removed` on
  `team_members` (B38) — see Team moderation.

## Re-shares (B28)

Migrations `20261115154653_reshares.sql` and `20261115160346_reshare_trigger_columns.sql` add a
fourth post kind, **reshare**: a lifter passing someone else's post on to their own followers.

- **Shape.** `posts.shared_post_id` (FK → `posts.id`, `on delete cascade`, indexed) points at the
  original. `posts_kind_check` now allows `reshare`; `posts_kind_shape` gains the arm `reshare` →
  `shared_post_id` set, no `workout_id`, no `image_path`, and the other three arms require
  `shared_post_id is null`. `posts_reshare_unique` (partial unique index on `(user_id,
  shared_post_id) where shared_post_id is not null`) makes a double tap a `23505`.
- **Trigger `posts_reshare_shape`** (`private.reshare_shape()`, security definer) — before insert,
  or an update naming `shared_post_id`, `flair_id` or `kind`, when `new.kind = 'reshare'`: the
  original must exist and be visible to the resharer (`That post is gone`), must not itself be a
  re-share (`Re-share the original post instead` — no chains), must not be the resharer's own
  (`You can't re-share your own post`); then it **sets `flair_id` to the original's**, whatever the
  client sent. So a Physique Check re-share takes upvotes only through the existing vote trigger.
  A visibility-only update (the B26 chip) passes through untouched.
- **Read rule.** `posts readable per their visibility` is `workout_visible(user_id, visibility) and
  (shared_post_id is null or private.can_view_post(shared_post_id))`. Blocks, mutes, followers-only
  and private on the original all hide the re-share too — from everyone, its owner included (the
  owner's update then simply matches no row). Ordinary posts short-circuit on the null column.
- **Cascade.** Deleting the original (by its author, or `moderate`'s remove-post) deletes its
  re-shares.
- **Votes, comments, reports** on a re-share are on the re-share row; `post_scores` and
  `post_hot_scores` count it like any post. `post_hot_scores` was dropped and recreated to carry
  `shared_post_id` (grant and comment restored). Through the view the self-reference is ambiguous
  to PostgREST (PGRST201) and on `posts` the FK-name hint is refused (PGRST200), so the app reads
  originals in a second request, `posts?id=in.(…)` (probed live, B28).
- Live-probed with three synthetic users (rolled back): stamped flair, double → 23505, self and
  chain refused, downvote on a Physique Check re-share refused, original made private → hidden
  from a follower of the resharer and from the resharer, mute hides / unmute restores, delete
  cascades.

## Who can see and change what (row-level security)

All tables have RLS on. "You" means the signed-in user (`auth.uid()`).

| Table | Read | Write |
| --- | --- | --- |
| `profiles` | any signed-in user | only your own row (update) |
| `user_settings`, `user_body_data` | only your own row | only your own row |
| `follows` | rows you are part of | follow as yourself; remove follows you are part of |
| `blocks` | only rows where you are the blocker | manage your own block list |
| `exercises` | launch library (`owner_id` null) plus your own | create, update, delete only your own |
| `workouts` | per the visibility rule below, **or** (B37) you coach a team its owner is on and no block either way (`private.coach_reads_logs`) — private workouts included | insert, update, delete only your own |
| `workout_exercises`, `sets` | visible when their workout is, or by the same coach arm (`private.can_read_workout_log`, B37) | only the workout's owner |
| `personal_records` | your own, plus any record whose source set's workout you may see (`private.can_view_set`, B25) | only your own, and `source_set_id` must be a set in one of your workouts (`private.owns_set`) |
| `sync_tombstones` | only your own | nobody — only the `record_tombstone` trigger inserts |
| `workout_analyses` | only your own | nobody — no write policies; only the `analyze-workout` function (service role) upserts |
| `flairs` | any signed-in user | nobody — new flairs arrive by migration |
| `posts` | per the visibility rule below (same helper as workouts); **a re-share (B28) also needs its original to pass `private.can_view_post`** — visible only to people who may see both, its owner included | insert and update only as yourself **and**, for a workout post, only for a workout you own (`private.owns_workout`; photo posts have no workout); a re-share only of a post you can see (`can_view_post`); delete only your own |
| `storage.objects` in `post-images` (B22) | your own folder, or cited by a post you may see | insert, update, delete only in your own folder — see the photo posts section |
| `storage.objects` in `avatars` (B25) | anyone through the bucket's public URL; through the API, your own folder | insert, update, delete only in your own folder — see the profiles section |
| `follow_counts(profile_id)` (function, B25) | any signed-in user, for any profile: two counts, no rows | — |
| `votes` (B23, B27) | votes on a post you may see (`private.can_view_post`) **whose voter** you may see (`private.author_visible`: yours, or no block either way and not muted by you) | insert and update only as yourself, on a post you may see; delete only your own |
| `comments` (B23, B27) | comments on a post you may see whose author you may see (same two helpers) | insert only as yourself, on a post you may see; no updates; delete only your own |
| `post_scores` (view, B23) | `security_invoker`: whatever the posts / votes / comments rules above let you read — so since B27 the tally is the votes *you* may see | — |
| `post_hot_scores` (view, B24) | `security_invoker`: the posts you may read, each ranked by the votes you may read on it | — |
| `mutes` (B27) | only rows where you are the muter | manage your own mute list |
| `moderators` (B27) | only your own row | nobody — service role / migration only |
| `programs` (B34, B39) | per `private.program_visible`: the author always; others when live and `published`, or `followers` and they follow the author (no block), or `team` and they're in a team it's shared with | only the program's author: insert, update (including `visibility`), delete — the app soft-deletes |
| `program_weeks`, `program_workouts`, `program_exercises` (B34) | only the program's author (`private.owns_program`) — deliberately NOT widened by B39 | only the program's author: insert, update, delete — the app soft-deletes |
| `program_team_shares` (B39) | the program's author, and members of the shared team | insert only the author, only to a team they're in; delete only the author; no updates |
| `program_payload` (function, B39) | signed-in users `program_visible` admits; null otherwise | — |
| `program_votes` (B41) | your own; otherwise votes on a program you may see (`private.can_view_program`) whose voter you may see (`private.author_visible`) | insert and update only as yourself, on a published live program (`private.program_published`); delete only your own |
| `program_comments` (B41) | your own; otherwise comments on a program you may see whose author you may see (same two helpers) | insert only as yourself, on a published live program; no updates; delete only your own |
| `program_scores` (view, B41) | `security_invoker`: the programs you may read, each with the votes / comments you may read on it | — |
| `program_runs` (B35) | only your own (`user_id = auth.uid()`) | insert, update, delete only your own — the app never deletes, it stamps `ended_at` |
| `teams` (B36) | any signed-in user (discoverable) | insert only as yourself (`created_by`); update only the owner (`private.is_team_owner`), and only `name` / `join_mode` (column grant); delete only the owner (B38; everything team-scoped cascades) |
| `team_members` (B36) | your own rows; the whole roster if you are a member; any open team's roster | insert only yourself, only as `member`, only when the team is open or you hold an invite; update (B37) only the owner, only `role`, never the owner row, only to `coach` / `member`; delete your own row (leave) or, as the owner, anyone's (B38 removal) — never the owner's row |
| `team_feed_hides` (B38) | members of the team; anyone when the team is open | insert only the owner, as `hidden_by` themselves; delete only the owner; no updates |
| `team_posts` (B37) | members of the team | insert only as yourself, as a coach of the team, pushing only your own program / program workout; no updates; delete your own, or any as the owner (B38) |
| `team_assignments` (B37) | the assignee, and the team's coaches | insert only as `assigned_by` yourself, a coach, your own program, to a team member, never across a block; delete by the assignee or a coach |
| `team_program_payload`, `team_workout_payload` (functions, B37) | signed-in members of the team, for content pushed to it (or a program assigned to you there) and still live; null otherwise | — |
| `team_invites` (B36) | invites to you, and the owner sees their team's | insert only the owner, never across a block (`private.blocked_either`); delete by the invitee (decline) or the owner (cancel) |
| `reports` (B27) | moderators only (`private.is_moderator()`) | insert only as yourself, about a post or comment you can currently see (each table's own read rule decides), never your own; no updates or deletes — the founder works the queue via service role |

**Workout visibility rule** (`private.workout_visible`): you always see your own; a block in either
direction hides everything; a lifter you muted is hidden from you (B27, one way); otherwise `public` is open to any signed-in user, `followers` requires
that you follow the owner, `private` is owner-only. (B37: for `workouts`, `workout_exercises` and
`sets` only, a team coach's arm is OR'd beside this rule — see "Team coaching".) Child tables ask
the same question through the workout they belong to; `posts` asks it directly with the post's own author and visibility;
`votes` and `comments` ask it through their post (`private.can_view_post(post_id)`, B23).
Another user's **custom exercise** stays hidden (exercises RLS), so in someone else's shared
workout its name embeds as null and the feed card says "Custom exercise". These checks run as `security definer` helpers in the `private` schema so
they can see rows the caller's own RLS would hide.

## Deletion behaviour

- Deleting an auth user cascades through `profiles` to settings, body data, follows, blocks, mutes,
  a moderator row, reports filed by them and reports about them (B27), owned exercises, workouts,
  their entries and sets, posts, votes, comments, and the user's tombstones (live-probed at B27),
  and (B34) their programs with every week, workout and slot under them, and (B35) their program
  runs, and (B36) their team memberships and invites, and every team they created (with all of
  that team's memberships and invites — members silently lose the team; no ownership transfer). A hard-deleted program workout sets `workouts.program_workout_id` to null (the session stays).
  Storage objects are not rows of this graph — the `moderate` function sweeps them.
  Deleting a post cascades to its votes and comments (B23); reports about it stay (no FK, B27).
- Deleting a workout cascades to its `workout_exercises` and their `sets` (and the records citing
  them), to its `workout_analyses` row and to its post (B20), and leaves tombstones for the workout and each record
  (an analysis gets none: other devices drop it with the workout's tombstone). The app deletes a finished
  workout (B14) by sending only the workout's delete; these cascades do the rest.
- The app never hard-deletes an exercise (B31: deleting a custom stamps `deleted_at`). If a row
  is ever hard-deleted (account deletion, a direct API call), history is still kept:
  `workout_exercises.exercise_id` becomes null rather than deleting the logged work. Its
  `personal_records` rows are deleted.
- Deleting a set (or the workout holding it) deletes any `personal_records` row that cites it.

## Why client-generated primary keys

`workouts`, `workout_exercises` and `sets` get their UUIDs on the device, so a workout logged with
no signal is complete and internally linked before it ever reaches the server. Sync then inserts
the rows as they are, with no id remapping.

## The device mirror (not part of this database)

This diagram draws the server. The phone keeps its own SQLite copy (`frontend/src/db/schema.ts`)
of `exercises`, `workouts`, `workout_exercises`, `sets`, `personal_records` and — since B15 —
`user_settings` (schema version 6: version 2 (B11) added `sets.score`, version 3 added
`sets.notes`, version 4 added `personal_records`, version 5 added `outbox.op` (`upsert` or
`delete`), version 6 added `user_settings (user_id, unit, updated_at)` — only the columns the
phone syncs; `default_workout_visibility` is not mirrored yet; version 7 (B18) added
`workout_analyses`, download-only, with `new_prs` as JSON text; version 8 (B21) added `flairs (id,
name, position, upvotes_only)`, download-only, and `posts (id, user_id, flair_id, workout_id
unique, visibility, created_at, updated_at)`, the lifter's own posts, upload-only; version 9 (B22)
rebuilt `posts` with `kind`, a nullable `workout_id` (still unique) and `image_path` — the photo
waiting to upload is a file in the app's documents folder, `post-images/<post_id>.<ext>`, not a
column; version 10 (B26) added `user_settings.progress_pic_visibility` (default `private`);
version 11 (B31) added `exercises.deleted_at` (text, null while live); version 12 (B34) added the
four program tables with the same columns (no local foreign keys — parent links and
`exercise_id` are bare columns, so a child that downloads before its parent just waits unseen),
synced both ways, downloaded table by table on their own bookmarks
(`pull_cursor:programs`, `…:program_weeks`, `…:program_workouts`, `…:program_exercises`), after
the analyses and before tombstones; version 13 (B35) added `program_runs` (same columns, no local
foreign keys, downloaded on `pull_cursor:program_runs` after the four program tables) and the bare
column `workouts.program_workout_id`; version 14 (B39) added `programs.visibility` (text, default
`private`; `program_team_shares` is not mirrored); version 15 (B42) added the six trend columns to
`workout_analyses` (integer / real, null on existing rows). **Upload order since B35** (`SYNC_ORDER`): `exercises`,
`programs`, `program_weeks`, `program_workouts`, `workouts`, `workout_exercises`, `sets`,
`personal_records`, `program_exercises`, `program_runs` (then `workouts` once more) — programs go
before workouts so a session started from a program never reaches the server ahead of the
program workout its FK names; versions are append-only,
upgraded on launch). There is no device copy of `sync_tombstones` — tombstones are applied as
they download, and `sync_state` keeps the last applied id (`pull_cursor:tombstones`). It has the same column names, but
uses text for uuids and timestamps and 0/1 for booleans, and it does not repeat the server's
CHECK rules as SQL (instead the app checks every set against them before saving, through the
shared `@training-math` `limits.ts`). It also has two tables of its own: `outbox`, the local changes waiting to upload
(its `tbl` can also be `user_settings`, whose line's `row_id` is the user id, or `posts`, B21),
and `sync_state`, the download bookmarks. What this means for the server:

- **Uploads are upserts on `id`** (`INSERT … ON CONFLICT (id) DO UPDATE` through PostgREST), run
  as the signed-in user, so the RLS rules above decide what is accepted. A retried upload updates
  the same row and never duplicates it.
- **Uploads never send `updated_at`.** The column default stamps it on insert and the
  `moddatetime` trigger stamps it on update, so it is always server time. That lets devices
  download "changed since my bookmark" by `(updated_at, id)` without trusting phone clocks.
- **A workout's `updated_at` moves whenever anything inside it changes.** The app re-sends the
  parent workout after its entries or sets land (touch-the-root), so other devices find changed
  entries and sets by watching `workouts` alone.
- Library rows (`owner_id` null) only ever flow server → device; the device seeds its own copy
  with the same uuidv5 ids at first launch. Custom exercises (B31) flow both ways: upserted first
  in every upload (parents before children), downloaded on `pull_cursor:exercises` with the
  library; a soft delete travels as an ordinary upsert carrying `deleted_at`.
- **The server only ever receives finished workouts.** A workout in progress (`ended_at` null)
  lives only in the device mirror and is never queued; finishing it stamps `ended_at` and queues
  the workout with all its entries and sets in one transaction (B08 active-workout store). So
  every workout the app uploads has an `ended_at`, though the column stays nullable.
- **Weights and RPE arrive already rounded** to their column's decimals (`weight_kg` 2, `rpe` 1,
  `personal_records.value_kg` 3), so the server's numeric rounding changes nothing and a download
  matches the device exactly.
- **Personal records upload after sets** (they cite them) and download on their own bookmark
  (`pull_cursor:personal_records`), after the workout trees. A record row has no parent workout, so
  it does not touch the root.
- **Deletes (B14) are `DELETE … WHERE id IN (…)`** as the signed-in user, sent before any upload
  in each sync, children's tables first. Deleting an id the server no longer has is a no-op, so
  retries are safe.
- **`user_settings` (B15) syncs outside the id-keyed machinery.** The phone's kg/lb toggle and
  (B26) its progress-pic privacy choice send `UPDATE user_settings SET unit = …,
  progress_pic_visibility = … WHERE user_id = …` (both fields from the phone's whole row; a change
  to one is merged into the stored row first, so it never undoes the other) — never an insert or upsert, since RLS
  grants the owner select and update only and the signup trigger already made the row; no
  `updated_at` (the `moddatetime` trigger stamps it). An update that matches no row (a previous
  account's leftover outbox line, hidden by RLS) changes nothing and counts as sent. Every pull
  re-reads the one row (no bookmark) and saves it unless the phone has an unsent toggle. Weights
  are never touched: `sets.weight_kg` and `personal_records.value_kg` stay kg whatever the unit.
- **`workout_analyses` (B18) is never uploaded.** After each successful download the phone
  calls `POST /functions/v1/analyze-workout {workoutId}` (its login token attached) for up to 10
  finished workouts with no analysis, a stale one, or (B42) one made by an older
  `engine_version`, and no unsent changes, and saves each reply.
  Other devices get the rows on their own bookmark (`pull_cursor:workout_analyses`), after
  personal records.
- **`posts` (B21) are upload-only, one request each, after every other upload phase.** Upsert on
  `id`; a `23505` (another device posted this workout) drops the phone's copy and its lines; any
  other refusal keeps the line for the next sync. Deleting a workout on the phone — or applying
  its tombstone from another device — also deletes the phone's post of it and that post's unsent
  lines (the device has no cascade), so a post of a gone workout can never jam the queue.
  Changing a post's visibility (B26) is not an upload: it is an online update from the card, after
  which the phone rewrites its own post and workout copies (no outbox lines) so a later whole-row
  upload of that workout carries the new value.
- **Photo posts (B22) upload their photo first.** In the posts phase the phone sends
  `POST /storage/v1/object/post-images/<image_path>` (streamed from the waiting file, `x-upsert:
  true`, the user's token) and only then upserts the post row, so the object exists — owner-only
  readable — before the post that reveals it. A retry re-uploads to the same path; an over-limit
  upload is refused by the bucket (4xx) and retried like any failure. If the waiting file is gone,
  the post is dropped on the phone (it can never upload). After the row lands the file is deleted.
- **`flairs` (B21) are read whole, last in every download** (`select … order by position`, no
  bookmark: the table has no `updated_at`), and replace the device copy in one transaction. A
  failed read is logged and the old copy kept; an empty answer is ignored.
