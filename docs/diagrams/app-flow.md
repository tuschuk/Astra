# Astra app — how it works

The living picture of the Expo app: every screen, what the user can do on it, and the path data
takes. Every commit that adds or changes a screen, user action, module or data path updates this
file in the same commit. It draws what exists in code today; scaffolding (placeholder screens,
services not yet wired) is marked so nobody mistakes a mock-up for a working feature.

Legend: solid boxes are working features; dashed boxes are placeholder screens whose layout is
final but whose actions do nothing yet; the dotted link is a connection that does not exist yet.

```mermaid
flowchart TD
  classDef scaffold stroke-dasharray: 5 5
  classDef data fill:#eef,stroke:#669

  Launch([App launch]) --> Root["Root layout<br/>loads brand fonts, wraps app in AuthProvider,<br/>holds splash until fonts AND saved session are ready"]
  Root --> Restore{"AuthProvider restore<br/>getSession(): local read of the saved session<br/>(no network; failure = signed out)"}
  Restore -->|session found| Tabs
  Restore -->|no session| SignIn

  subgraph AuthGroup["(auth) group: only reachable while signed out"]
    SignIn["Sign in<br/>email + password; friendly errors;<br/>shows 'check your email' notice if handed one"]
    SignUp["Sign up<br/>email, password, birthdate (MM / DD / YYYY)<br/>states Astra is 18+"]
    Gate{"18+ age gate (auth/age.ts)<br/>invalid or under 18?"}
    SignIn -->|Create an account| SignUp
    SignUp -->|I already have an account| SignIn
    SignUp -->|Create account| Gate
    Gate -->|yes: refuse on screen,<br/>nothing sent| SignUp
  end

  Tabs["Tab layout (only with a session)<br/>five bottom tabs, Workout dead center,<br/>floating top-right profile button"]

  Tabs --> Home["Home (app/(tabs)/index.tsx, B20, SOC-1)<br/>FlatList of PostCards: followed lifters' + my own posts, newest first —<br/>workout posts, and (B22) progress-pic / PR photo posts: the photo is an RN Image of<br/>/storage/v1/object/authenticated/post-images/path with the viewer's Bearer token + apikey<br/>(postImageSource; 'Photo unavailable' panel on error);<br/>my own cards only (B26, YOU-5): a 'who can see this' chip (Only you / Followers / Public) → tap opens an inline<br/>chooser (ChoiceChips + the chosen option's meaning) → optimistic chip, setPostVisibility, revert + message on refusal,<br/>held while in flight; success also rewrites the feed's own list (withPostVisibility); others' cards have no chip;<br/>reloads page 1 on every focus; pull-to-refresh; end of list → next page (20, keyset);<br/>card footer (B23, SOC-4/5): Upvote · net score · Downvote (no Downvote at all when flair.upvotesOnly,<br/>e.g. Physique Check) — tap = optimistic score ± voteDelta, revert + message on refusal;<br/>'n comments' / 'Comment' button;<br/>header 'Share a photo' (B22) + 'Find lifters' buttons;<br/>under 'Your feed' (B24): order chips Latest | Hot (SOC-11) and a scrolling flair row All + one chip per<br/>device flairs row (SOC-9) — shown once the remembered choice AND the flair list are read; first feed read waits for both;<br/>a remembered flair not in the flair list reads as All; tap = save + reload page 1 ('Loading your feed…'<br/>whenever the list on screen was loaded for another order / flair);<br/>empty: filtered to a flair → 'No Form Check posts yet.' + Show all posts;<br/>follow nobody → Find lifters + Log a workout, follow people who haven't posted → Find lifters;<br/>request failed / offline → 'The feed needs a connection' + Retry (nothing queued)"]
  Home <-->|"social/feedPrefs.ts (B24): loadFeedPrefs (cached per user; damaged → Latest + All),<br/>saveFeedPrefs on every chip tap (fire-and-forget)"| FeedPrefsStore[("kv-store key astra.social.feedPrefs.userId<br/>JSON v1: sort latest | hot + flairId (null = All);<br/>this phone only, not synced, one entry per account")]
  Home -->|"readFlairs on focus (B24): flair chips, by position"| LocalDB
  Home -->|"Find lifters: router.push('/find-lifters')"| FindScr["Find lifters (app/find-lifters.tsx, B20, SOC-7 part)<br/>search box (≥ 2 letters, 300 ms after typing stops);<br/>UserCards (Avatar, name, @handle, FollowButton) — never me,<br/>never someone I blocked; no match / no connection messages; Back"]
  Home -->|"Log a workout (empty feed)"| Workout
  FindScr -->|"Back: router.back (Home reloads on focus)"| Home
  Home -->|"Share a photo: router.push('/new-post')"| NewPostScr["Share a photo (app/new-post.tsx, B22: SOC-2, NFR-4, NFR-5)<br/>type chips Progress pic | PR photo; privacy line (B26: progress pic → the Settings choice read on focus,<br/>e.g. 'Your followers can see this post. Choose who sees new progress pics in Settings.'; PR photos public) + the kind's flair name from the device flairs rows;<br/>Choose photo → expo-image-picker library (images, quality 0.9 → iOS HEIC re-encoded to JPEG);<br/>preview; checkPostImage (social/mediaLimits.ts: ≤ 10 MiB, jpeg / png / webp) at pick time —<br/>over limit → 'This photo is 12.4 MB — the limit is 10 MB…', Post disabled;<br/>no flairs synced → Post disabled + a line why; Post · Cancel"]
  NewPostScr -->|"Cancel: router.back"| Home
  NewPostScr -->|Post| ImgPostQ["createImagePost (social/createPost.ts, B22):<br/>re-check limits + kind's flair on the phone (progress-pic → physique-check,<br/>visibility = imagePostVisibility: the phone's user_settings.progress_pic_visibility, default private (B26);<br/>pr → new-pr, public); copy the picked file to<br/>documents/post-images/postId.ext (postImages.ts); then ONE transaction:<br/>posts row (kind, workout_id null, image_path = userId/postId.ext) + outbox line 'posts';<br/>notifyLocalWrite — nothing is uploaded here"]
  ImgPostQ -->|"posts row + outbox line; photo file in documents"| LocalDB
  ImgPostQ -.->|"notifies"| Triggers
  NewPostScr -->|"Post saved: router.replace('/') at once"| Home
  Home -->|"comments button: router.push('/post-comments/[id]')"| CommentsScr["Comments (app/post-comments/[id].tsx, B23, SOC-5)<br/>the post's comments oldest first (letter avatar, name, @handle · date, body);<br/>200 loaded → 'More comments exist than are shown here.';<br/>'Write a comment' box (counter from 450 chars; over 500 → the one refusal line);<br/>Send (off while blank / too long / sending) → appends the server's saved row;<br/>failed send → keeps the text + a line; failed load / offline → 'Comments need a connection' + Retry; Back"]
  CommentsScr -->|"Back: router.back (Home reloads on focus — fresh counts)"| Home
  Home -->|"arrow tap: castVote (upsert on post_id,user_id) / clearVote (delete mine)"| VoteQ
  CommentsScr --> CommentQ
  Home -->|"others' card ⋯ (B27): ReportSheet → reportPost"| ModQ
  CommentsScr -->|"others' comment ⋯ (B27): ReportSheet → reportComment"| ModQ
  ProfileView -->|"others' card ⋯ → reportPost; Mute / Unmute, Block (Alert confirm) / Unblock → re-read header + relation + open tab"| ModQ
  ReportSheet["ReportSheet (components/social, B27, SOC-8): Modal;<br/>six reason chips (REPORT_REASONS = the content policy's six sections) + the chosen one's sentence;<br/>'Details (optional)' (counter from 400, over 500 → line, Send off); Send report (off until a reason; once) ·<br/>Cancel; success → thanks + 'Mute or block them from their profile' + Done; refusal → calm line, try again"]
  Home -.-> ReportSheet
  CommentsScr -.-> ReportSheet
  subgraph SocialMod["Social reads (src/social, B20): online only, client passed in, RLS decides visibility"]
    FeedQ["feed.ts: feedAuthorIds = me + follows.followee_id where follower_id = me;<br/>loadFeedPage(client, me, authors, sort, flairId, after) — B24: Latest → from posts, Hot → from the<br/>post_hot_scores view (same select + hot_score); .select(FEED_SELECT: kind, image_path, visibility,<br/>flair (id, name, upvotes_only — B23), author:profiles!posts_user_id_fkey (hint required through the view, B24),<br/>workout (plain left embed since B22) → entries → exercise name, sets, my_vote:votes(value) — B23)<br/>.in(user_id, authors) .eq(my_vote.user_id, me) [.eq(flair_id, flairId) — B24, SOC-9]<br/>Latest: [.or(beforeCursorFilter)] order created_at desc, id desc;<br/>Hot: [.or(beforeHotCursorFilter: hot_score lt, or eq + id lt)] order hot_score desc, id desc; limit 20;<br/>the bookmark is tagged latest | hot — one from the other order is refused;<br/>then (B23) loadPostScores: post_scores.select(post_id, score, comment_count).in(post_id, page ids);<br/>toFeedPost: photo post → kind + imagePath; workout post → sort entries + sets, weight → number;<br/>+ score, commentCount (0 without a scores row), myVote (+1 / −1 / null);<br/>a workout post whose workout RLS withheld (null) is dropped; appendPage drops repeats;<br/>B28: FEED_SELECT = POST_CONTENT_SELECT + shared_post_id + my_vote; beside the scores, loadOriginals:<br/>posts.select(ORIGINAL_SELECT).in(id, the page's shared_post_ids) (only if the page has re-shares —<br/>the self-embed was refused live, PGRST200 / PGRST201); a reshare row → kind reshare + original<br/>(toFeedOriginal: same body shaping, its own author / flair / date); original missing or a re-share → dropped"]
    ReshareQ["reshare.ts (B28, SOC-6): resharePost(client, me, post) → posts.insert({id: newUuid, user_id me,<br/>kind reshare, shared_post_id, flair_id (server overwrites), visibility public, created_at});<br/>reshareTarget: a re-share card passes on its ORIGINAL (no chains); never throws:<br/>23505 → 'You've already re-shared this post.', anything else → 'didn't go through'; online only, nothing queued"]
    VoteQ["votes.ts (B23): castVote → votes.upsert(onConflict post_id,user_id);<br/>clearVote → delete where post_id + user_id = me; never throw:<br/>P0001 (upvote-only trigger) → 'This post takes upvotes only.', anything else → 'didn't go through';<br/>voteDelta / nextVote: the card's optimistic arithmetic (the tally itself stays on the server)"]
    PrivacyQ["postPrivacy.ts (B26): setPostVisibility(client, db, me, target, next) →<br/>posts.update({visibility}).eq(id).eq(user_id, me).select(id); 0 rows → 'can't be changed right now',<br/>error / offline → 'Couldn't change who can see this post…'; never throws; online only, nothing queued.<br/>On success: astra.db posts row + (workout post) workouts row get the new visibility, no outbox lines,<br/>then notifyLocalWrite; VISIBILITY_WORDS / VISIBILITY_ORDER: the one spelling of the three audiences"]
    CommentQ["comments.ts (B23): loadComments → comments.select(…, author:profiles) eq post_id<br/>order created_at, id asc, limit 200; addComment → commentBodyError first<br/>(commentLimits.ts: 500 chars, not blank — mirrors the CHECK), then insert(…).select().single()"]
    FollowQ["follows.ts: searchLifters (sanitized ilike on username / display_name,<br/>not me, not in my blocks, limit 20, + which I follow);<br/>follow = insert follows row (duplicate = ok; RLS refusal → 'You can't follow this lifter.');<br/>unfollow = delete my row; results carry avatar_url (B25)"]
    ProfileQ["profile.ts (B25): loadProfileRow (profiles row) · loadProfileHeader = row + rpc follow_counts<br/>+ (others) my follows row → viewerFollows; updateProfile → profiles.update eq id = me<br/>(23505 username → 'That username is taken.', 23514 → the box's message, else the calm line);<br/>loadWorkoutHistory → workouts.select(HISTORY_SELECT) eq user_id, ended_at not null,<br/>[.or(beforeStartedFilter)] order started_at, id desc, limit 20;<br/>loadProfilePrs → personal_records.select(…, exercise:exercises(name)) eq user_id → groupPrs;<br/>B37 loadWorkoutDetail → workouts.select(WORKOUT_DETAIL_SELECT: entries, exercise name, sets) eq id<br/>(RLS: visibility, or the coach arm) → entries / sets sorted by position, or null"]
    ModQ["moderation.ts (B27, SOC-8): report(client, me, {kind, id}, reason, details) → reports.insert<br/>(reporter_id, target_kind, target_id, reason, trimmed details or null — never the reported user);<br/>23505 (already reported) = thanks; else 'That report didn't go through…'; reportPost / reportComment wrap it;<br/>muteUser / unmuteUser → insert / delete mutes (muter_id = me); blockUser / unblockUser → blocks;<br/>re-tap 23505 = ok; relationTo → my blocks + mutes rows for one profile → {blocking, muting}"]
  end
  ModQ -->|"insert reports (RLS: as me, content I can see, not my own; trigger stamps the author);<br/>insert / delete mutes, blocks (own rows; block trigger removes follows both ways)"| DB
  ProfileQ -->|"select profiles / follows / workouts / personal_records, rpc follow_counts, update my profile (RLS decides)"| DB
  Home --> FeedQ
  FindScr --> FollowQ
  FeedQ -->|"supabase-js select as the signed-in user"| DB
  VoteQ -->|"upsert / delete votes (RLS + votes_upvote_only trigger)"| DB
  Home -->|"others' card Re-share (B28) → inline confirm 'Re-share now' → one-line result"| ReshareQ
  ProfileView -->|"others' card Re-share (B28)"| ReshareQ
  ReshareQ -->|"insert posts kind reshare (insert RLS: as me, original I can see;<br/>trigger posts_reshare_shape: no self / no chain, flair stamped from the original)"| DB
  Home -->|"own workout card Share (B28): router.push('/share-card/[id]', workout id)"| ShareCardScr
  ProfileView -->|"own workout card Share (B28)"| ShareCardScr
  Home -.->|"re-share card (B28): 'Re-shared from @x' + the original in a bordered panel<br/>(its author tappable → profile, its workout / photo body); footer is the re-share's own"| Home
  Home -->|"own card chip (B26)"| PrivacyQ
  ProfileView -->|"own Posts tab card chip (B26)"| PrivacyQ
  PrivacyQ -->|"update posts.visibility as me (owner update RLS);<br/>trigger sync_workout_visibility moves the workout in the same transaction"| DB
  PrivacyQ -->|"mirror: posts + workouts visibility (no outbox)"| LocalDB
  CommentQ -->|"select / insert comments (RLS: post visible to me)"| DB
  FollowQ -->|"select profiles / blocks / follows; insert / delete follows"| DB
  DispUnit -->|"viewer's unit: PostCard sets via formatSet / formatDropSet"| Home
  Tabs --> Market["Marketplace<br/>programs (MKT-1..5)<br/>today: featured-section skeleton, placeholder cards"]
  Tabs --> Workout["Workout tab (on focus: re-read astra.db + readActiveRun)<br/>no draft, no run: Start empty workout · Start from a program (→ ProgramPickerSheet, B35)<br/>no draft, run active (B35): card 'Running · program name · Next: Week N · workout name',<br/>Start next session (primary) · Start empty workout · Stop program (asks first);<br/>run with no session left: 'This program has no next session.' + Stop<br/>draft on phone (run card hidden): Resume workout / Discard (asks first)<br/>Tool Kit tiles: 1RM / RPE / %1RM / Plates / Timer open the Tool Kit at that tool (B16, B17)<br/>Past workouts: newest 100 finished, date + duration + counts<br/>Your programs (B34, always enabled) → /programs"]
  Workout -->|"Your programs: router.push('/programs')"| ProgramsScr["Programs (app/programs.tsx, B34)<br/>listPrograms on focus: my live programs, newest first,<br/>name + '2 weeks · 6 workouts'; empty state explains a program;<br/>New program → NewProgramForm (Modal; name 1–100 via assertValidProgramName,<br/>Create disabled until valid) → createProgram → router.push program/[id]; Back"]
  ProgramsScr -->|"tap a program: router.push('/program/[id]')"| ProgramScr["Program page = editor (app/program/[id].tsx, B34, PRG-2)<br/>readProgramTree on focus; name box autosaves (renameProgram);<br/>one card per week 'Week N': its workouts ('Day A' / 'Workout N' + 'N exercises'),<br/>Add workout · Remove week (asks first) · per workout Remove (asks first);<br/>Add week; Delete program (asks first) → Back;<br/>unknown / deleted / someone else's id → 'isn't one of yours'"]
  ProgramScr -->|"tap a workout: router.push('/program-workout/[id]')"| ProgWorkoutScr["Program workout editor (app/program-workout/[id].tsx, B34, PRG-1)<br/>readProgramWorkout on focus: 'Program · Week N', name box autosaves (blank = Workout N);<br/>ProgramExerciseCard per slot: name + '3 × 8 @ 135 lb · RPE 8' (useDisplayUnit),<br/>Sets / Reps / weight-in-unit / RPE boxes → Save targets (refusals shown on the card),<br/>Up / Down (renumbers the workout's slots), Remove (asks first);<br/>Add exercise → the logger's ExercisePicker (library + my live customs) → 3 sets to start;<br/>a workout in a removed week / program → not found"]
  ProgWorkoutScr -->|"Add exercise"| Picker
  ProgramsScr --> ProgramsMod
  ProgramScr --> ProgramsMod
  ProgWorkoutScr --> ProgramsMod
  ProgramsMod["programs/programs.ts (B34): the ONE home of program reads + writes<br/>create / rename / delete program; add / remove week; add / rename / remove workout;<br/>add / update / move / remove exercise slot — every write checks the node is mine and live<br/>all the way up (an edit never resurrects a deleted row), validates through @training-math limits,<br/>converts lb → kg (roundWeightKgForStorage); deletes are SOFT (stamp that one row's deleted_at);<br/>readProgramTree / readProgramWorkout / listPrograms walk down from the program filtering<br/>deleted_at at every level, order (position, id), name slots from library + my customs<br/>(unknown → 'Deleted exercise')"]
  ProgramsMod -->|"writeLocal('programs' / 'program_weeks' / 'program_workouts' / 'program_exercises') — saved + queued; works offline"| WriteLocal
  Workout -->|"Start from a program: open sheet"| PickerSheet["ProgramPickerSheet (components/programs, B35, a Modal)<br/>listPrograms on open: name + size; a program with no workouts listed but disabled<br/>('No workouts yet — add some first'); none → Your programs button;<br/>tap → startProgramRun → close, tab re-reads; Cancel"]
  PickerSheet -->|"Your programs (empty state)"| ProgramsScr
  PickerSheet --> RunsMod
  Workout -->|"readActiveRun · Stop program → stopProgramRun"| RunsMod
  RunsMod["programs/programRuns.ts (B35, PRG-3): the ONE home of program_runs<br/>startProgramRun: needs a live program with ≥ 1 live workout; points at its first session;<br/>ends every active run in the SAME save; stopProgramRun ends every active run;<br/>readActiveRun: NEWEST active run (started_at desc, id desc) + its live tree + nextSession<br/>(program gone → null); resolveNextSession / sessionAfter: stored (week position, workout position)<br/>→ first live workout at/after it in that week, else the next week's first; empty weeks skipped;<br/>advanceRunOnFinish: rows for the finish (next session, or ended); nothing for a session<br/>from another program or started before the run; every ended_at clamped ≥ started_at"]
  RunsMod -->|"readProgramTree"| ProgramsMod
  RunsMod -->|"writeLocal('program_runs') — saved + queued; works offline"| WriteLocal
  Workout -->|"Start next session"| StartSess["startProgramSession (workout/startProgramSession.ts, B35)<br/>readActiveRun → startSessionWorkout({ programWorkoutId }) →<br/>setTitle('Program — Week N · Workout', cut to 100 chars) →<br/>per slot in order (skipped if canLogExercise fails): addExercise +<br/>setEntryNotes('Target: 3 × 5 @ 225 lb · RPE 8', lifter's unit);<br/>NO sets created; then router.push('/active-workout')"]
  StartSess --> RunsMod
  StartSess --> StartWO
  StartSess --> MutWO
  StartSess -->|"opens on the prefilled session"| Logger
  Tabs --> Communities["Communities (app/(tabs)/communities.tsx, B36: TEAM-1)<br/>Teams: Invites (Join / Decline) · Your teams (TeamListItem → team page) ·<br/>Create a team · Find teams (searchTeams, debounced; Join on rows I can join now);<br/>offline → TEAMS_OFFLINE + Retry; reloads on focus<br/>Gyms: still a placeholder card (B50)"]
  Communities -->|"Create a team: router.push('/team/new')"| NewTeamScr["New team (app/team/new.tsx, B36)<br/>name 1–80 via assertValidTeamName (says when too long);<br/>Create team → createTeam → router.replace team/[id]; Back"]
  Communities -->|"tap a team: router.push('/team/[id]')"| TeamScr["Team page (app/team/[id]/index.tsx, B36: TEAM-1, TEAM-2)<br/>name + mode; Join team / 'You're invited — Join' / closed line / Leave team (not the owner);<br/>owner only: Who can join chips (Open | Invite only → setJoinMode) + Invite lifters;<br/>Members (tap → profile) and Team feed (PostCards, 20 a page, pull to refresh)<br/>— both only for members or open teams; missing → 'isn't available'; offline → Retry<br/>B37 (TEAM-3, TEAM-5), members only: 'Coaches of this team can see your training log.';<br/>assignment banners (View / Dismiss); Coach's corner = pushes newest 20 (announcement text,<br/>program / workout cards → TeamProgramSheet; author: Remove); coaches (owner ∪ coach):<br/>Announce · Push a program · Push a workout; roster: owner Make coach / Remove coach,<br/>coaches Assign a program + 'Assigned: X' rows with Revoke"]
  TeamScr -->|"on load (after the roster): reload(isMember, isCoach); every action → page re-read"| CoachHook["useTeamCoaching (components/teams, B37)<br/>loadTeamPosts + myAssignments (+ teamAssignments, listPrograms for names if coach);<br/>then each referenced program / workout payload fetched once (names the cards);<br/>hosts ProgramPickerSheet (onPick mode), CoachPushSheet, TeamProgramSheet"]
  CoachHook -->|"Push a program / Push a workout / Assign: ProgramPickerSheet onPick (no run started)"| PickerSheet
  CoachHook --> PushSheet["CoachPushSheet (components/teams, B37, a Modal)<br/>announcement box (≤ 2000) → Push; or the picked program's workouts<br/>(readProgramTree on the coach's phone) → tap one to push; refusal line"]
  PushSheet -->|"readProgramTree(db, me, programId)"| LocalDB
  CoachHook --> TeamSheetC["TeamProgramSheet (components/teams, B37, a Modal)<br/>payload weeks → workouts → slots + targets (display unit); null → 'no longer available';<br/>footer: assignment → Start program · pushed program → Save to my programs ·<br/>pushed workout → Start this workout; button gone once done"]
  TeamSheetC -->|"Start program / Save: createProgramFromPayload (one transaction, member-owned,<br/>coach's customs → no exercise) → [Start] startProgramRun → removeAssignment"| CopyProg["programs/copyProgram.ts (B37)<br/>payload → new program, weeks, workouts, slots (fresh ids, positions 0..n)<br/>via writeLocalRowsTx ×4 → outbox → normal program sync"]
  CopyProg --> LocalDB
  TeamSheetC -->|"Start this workout: startPushedWorkout (title, exercises + target notes,<br/>no program link, skips what canLogExercise refuses) → router.push('/active-workout')"| Logger
  CoachHook --> CoachMod["social/teamCoaching.ts (B37) — online only<br/>loadTeamPosts · pushAnnouncement (assertValidTeamAnnouncement) · pushProgram · pushWorkout ·<br/>deleteTeamPost · assignProgram · removeAssignment · myAssignments · teamAssignments ·<br/>fetchProgramPayload / fetchWorkoutPayload (parsed, never trusted raw); 42501 → calm sentence"]
  CoachHook -->|"Make coach / Remove coach: setMemberRole"| TeamsMod
  CoachMod -->|"team_posts, team_assignments (RLS decides);<br/>rpc team_program_payload / team_workout_payload (null unless pushed/assigned here)"| DB
  ProfileView -->|"others' History row tap (B37): router.push('/session/[id]')"| SessionScr["Someone's workout (app/session/[id].tsx, B37, TEAM-5)<br/>read-only, online: title, details, notes, supersets, every set (formatDropSet), notes;<br/>unreadable custom → 'Custom exercise'; withheld → 'isn't available'; offline → Retry"]
  SessionScr -->|"loadWorkoutDetail(client, id)"| ProfileQ
  NewTeamScr --> TeamScr
  Home -->|"Your teams chip (B36, SOC-10): router.push('/team/[id]');<br/>'N team invites' chip → Communities"| TeamScr
  ProfileView -->|"Teams section row (B36, YOU-6): router.push('/team/[id]')"| TeamScr
  TeamScr -->|"Invite lifters (owner): router.push('/team/[id]/invite')"| InviteScr["Invite lifters (app/team/[id]/invite.tsx, B36)<br/>owner only (else 'Only the team's owner…'); searchLifters (debounced);<br/>per row Invite / Invited (tap cancels) or 'Member'"]
  TeamScr -->|"Team feed: loadFeedPage(client, me, roster ids, 'latest', null, after)"| FeedQ
  TeamScr -->|"card buttons via usePostListActions (same as Home / profile)"| PostActions["usePostListActions (components/social, B36)<br/>vote · report · change own post's audience · re-share ·<br/>Share card · open comments · open profile"]
  Home --> PostActions
  ProfileView --> PostActions
  Communities --> TeamsMod
  NewTeamScr --> TeamsMod
  TeamScr --> TeamsMod
  InviteScr --> TeamsMod
  Home -->|"on focus: loadTeamsOf(me) + myInvites(me)"| TeamsMod
  ProfileView -->|"on focus: loadTeamsOf(profileId)"| TeamsMod
  TeamsMod["social/teams.ts (B36) — online only, never mirrored<br/>createTeam · loadTeamsOf · loadTeam · loadTeamMembers · searchTeams ·<br/>joinTeam · leaveTeam · setJoinMode · myInvites · teamInvitees ·<br/>inviteToTeam · removeInvite; 42501 → calm sentence"] -->|"select / insert / update / delete teams, team_members, team_invites (RLS decides)"| DB
  Tabs --> Library["Library<br/>browse every launch exercise as a card"]
  Tabs -->|profile button| You["You (app/(tabs)/you.tsx, B25: YOU-1/2/3)<br/>ProfileView for me + gear button → Settings"]
  You --> ProfileView
  Home -->|"card author tap (B25): router.push('/profile/[id]')"| ProfileScr["Profile (app/profile/[id].tsx, B25)<br/>ProfileView for the route id (my own id → my own view); Back"]
  FindScr -->|"card tap (B25): router.push('/profile/[id]')"| ProfileScr
  ProfileScr --> ProfileView
  ProfileView["ProfileView (components/profile, B25)<br/>header: Avatar (public avatars URL, else letter) · display name · @username · bio<br/>(own null → 'Add a bio…', other null → 'No bio yet.') · Followers / Following counts ('—' while unknown);<br/>own: Edit profile · other: FollowButton (optimistic; refusal flips back + line) → header re-read so counts match;<br/>header offline → 'Counts and posts need a connection.' + Retry; no profile row → 'This lifter isn't available.';<br/>tabs Posts | History | PRs (ChoiceChips), reloaded on focus, Posts / History page at the list end:<br/>B27, others only: Mute / Unmute and Block / Unblock under Follow (Follow + Mute hidden while blocking);<br/>'You muted this lifter…' / 'You blocked this lifter…' line; refusal → calm line;<br/>Posts = PostCards (vote, comments, others' ⋯ report; own: the B26 visibility chip, success rewrites the tab's list) · History own = WorkoutListItem → workout/[id], other = rows → session/[id] (B37)<br/>· PRs = one card per exercise, formatPrLine in the viewer's unit"]
  ProfileView -->|"own header: saveOwnProfile on load; read first at mount (offline identity)"| OwnProfileStore[("kv-store key astra.social.ownProfile.userId<br/>JSON v1: username, displayName, bio, avatarPath<br/>(no counts); per account, not synced")]
  ProfileView -->|"own History: listPastWorkouts(db, me, 20, before-cursor) · own PRs: allCurrentPrs (workout/prs.ts + prList.groupPrs)"| LocalDB
  ProfileView --> ProfileQ
  ProfileView -->|"Posts: loadFeedPage(client, me, [profileId], 'latest', null, after)"| FeedQ
  ProfileView -->|"Edit profile: router.push('/edit-profile')"| EditProfileScr["Edit profile (app/edit-profile.tsx, B25, YOU-1)<br/>loadProfileRow fills Display name / Username / Bio; Change photo → expo-image-picker<br/>(square crop, quality 0.8) → checkAvatarImage (≤ 5 MiB, jpeg / png / webp; refusal line, Save disabled);<br/>Save: checkProfileText (profileLimits: 50 / 300 / username pattern; a set username can't be cleared)<br/>→ uploadAvatar to avatars/me/uuid.ext (new name each time) → updateProfile(avatar_url = path)<br/>→ deleteAvatar(old) best effort (or the new one if the update failed) → saveOwnProfile → Back;<br/>offline → 'Editing your profile needs a connection.' + Retry; nothing queued"]
  EditProfileScr --> ProfileQ
  EditProfileScr -->|"FileSystem.uploadAsync POST /storage/v1/object/avatars/path (Bearer + apikey);<br/>DELETE same address for the old photo"| DB
  You -->|"gear: router.push('/settings')"| SettingsScr["Settings (app/settings.tsx, B15, YOU-4 part)<br/>Units: kg | lb segmented toggle (radio roles for screen readers)<br/>Privacy (B26): 'Who can see new progress pics' ChoiceChips Only you | Followers | Public<br/>(read from astra.db on focus, disabled until read; failed save → chip back + line);<br/>'existing posts keep their own setting'; Body data: static 'Only you. Body data never leaves your account.' (no control)<br/>Account: signed-in email + Sign out + Export your data (busy label, calm error line) + Delete account (B32)<br/>Back (or /you); no Notifications until B47"]
  SettingsScr -->|"tap kg / lb: unitStore.setUnit"| UnitStore
  SettingsScr -->|"progress-pic chip: setProgressPicVisibility"| PrivacySet["privacySettings.ts (src/settings, B26):<br/>readProgressPicVisibility (no row → private) ·<br/>setProgressPicVisibility (ONE transaction: patchUserSettingsTx — unit kept —<br/>+ outbox line row_id = user id, then notify); no in-memory store"]
  PrivacySet -->|"user_settings row + outbox line"| LocalDB
  PrivacySet -.->|"notifies"| Triggers
  ImgPostQ -->|"reads progress_pic_visibility"| PrivacySet
  subgraph UnitsMod["Units (src/settings, B15)"]
    UnitStore["unitStore.ts: the signed-in lifter's unit in memory (default lb)<br/>hydrate (read astra.db row at sign-in) · setUnit (ONE transaction:<br/>patchUserSettingsTx — only the unit; the privacy choice kept, B26 — + outbox line row_id = user id, then notify) ·<br/>applyPulled (re-read the row; ignored for another user) · reset (sign-out)"]
    DispUnit["displayUnit.ts useDisplayUnit():<br/>useSyncExternalStore over unitStore — every weight screen re-draws on change"]
    UnitStore --> DispUnit
  end
  UnitStore -->|"user_settings row + outbox line"| LocalDB
  UnitStore -.->|"notifies"| Triggers

  Library -->|type a name| Search["Live name search<br/>alias-aware, e.g. Squats finds Back Squat"]
  Library -->|tap a chip| Filter["Filter chips (B29): region row (4) +<br/>muscle row (12) + equipment row (6), each scrolls sideways;<br/>one per row, re-tap clears, rows AND together;<br/>a muscle orders hardest-trained first;<br/>result count + no-results state"]
  Library -->|tap a card| ExDetail["Exercise detail (app/exercise/[id].tsx), read-only (B29, LIB-3)<br/>name, region, equipment, pattern(s);<br/>Muscles worked (ranked); How to do it (5 coaching steps,<br/>**bold** cue spans); Tips; Back<br/>B30 (LIB-4) 'Your history': the shared ExerciseHistorySection<br/>at libraryExerciseId(slug) — my PRs + every logged session;<br/>a failed read shows one line there, catalog content intact"]
  Library -->|"Your exercises section (B31, LIB-5): my live customs from astra.db<br/>(useCustomExercises, re-read on focus), same search + muscle / equipment chips;<br/>a region chip hides them; 'Custom' pill"| CustomList["Your exercises (above the catalog count)<br/>one card per matching custom; hint at zero customs"]
  Library -->|"New exercise"| CustomForm["New / Edit exercise form (components/library/CustomExerciseForm.tsx, a Modal)<br/>Name (1–80, checked by @training-math assertValidExerciseName; Save disabled until valid),<br/>optional equipment chip (6 kinds) + main-muscle chip (12), re-tap clears;<br/>Save = create / update in library/customExercises.ts; Cancel saves nothing"]
  CustomList -->|"tap a custom: /exercise/<uuid>"| CustomCard["Custom exercise card (same route, id not a catalog slug)<br/>getCustomExercise: only MY live customs are found;<br/>name, Custom pill, equipment, muscle; Edit; Delete (asks first);<br/>'Your history' = the same ExerciseHistorySection at its uuid;<br/>no coaching steps or tips (none authored);<br/>someone else's / deleted / unknown id → 'not in the library';<br/>database unreadable → 'couldn't be read from this phone'"]
  CustomCard -->|Edit| CustomForm
  CustomCard -->|"Delete exercise: soft delete, then router.back"| CustomMod
  CustomForm -->|Save| CustomMod["library/customExercises.ts (B31): the one home of custom-exercise reads + writes<br/>create (v4 id, owner_id = me, slug null), update (refused if not mine / deleted),<br/>delete = stamp deleted_at (a SOFT delete: history + PRs keep the name),<br/>listCustomExercises / getCustomExercise hide deleted rows; filterCustomExercises (pure)"]
  CustomMod -->|"writeLocal('exercises') — saved + queued; works offline"| WriteLocal

  subgraph LibData["Exercise library data (frontend/src/library)"]
    Seed[("exercises.ts<br/>founder's library by movement pattern:<br/>22 patterns, equipment, muscle intensities,<br/>5-step coaching cues, name aliases")]
    Catalog[("catalog.ts<br/>one entry per unique exercise (151),<br/>canonical names, searchExercises,<br/>filterExercises, exerciseById, EQUIPMENT_ORDER")]
    Muscles[("muscles.ts<br/>MUSCLE_ORDER, MUSCLE_NAMES, rankMuscles —<br/>the one home of muscle vocabulary")]
    CueFmt[("cueFormat.ts<br/>boldSegments: **bold** markers → spans")]
    Seed --> Catalog
  end
  Catalog --> Library
  Catalog --> Search
  Catalog --> Filter
  Catalog --> ExDetail
  Muscles --> Filter
  Muscles --> ExDetail
  CueFmt --> ExDetail

  subgraph Device["On the device"]
    Store[("expo-sqlite key-value store<br/>the saved Supabase session<br/>(survives killing the app)")]
    LocalDB[("astra.db: on-device SQLite (src/db)<br/>exercises, workouts, workout_exercises, sets,<br/>personal_records, user_settings (B15: user_id, unit; V10, B26: progress_pic_visibility),<br/>workout_analyses (B18, download-only, new_prs as JSON text),<br/>flairs (B21, download-only, replaced whole), posts (B21, my own, upload-only;<br/>B22: kind, nullable workout_id, image_path); V11 (B31): exercises.deleted_at;<br/>V12 (B34): programs → program_weeks → program_workouts → program_exercises (soft-deleted, schema V12)<br/>V13 (B35): program_runs (never deleted, ended_at) + workouts.program_workout_id<br/>+ outbox (unsent changes; op = upsert or delete, B14) + sync_state (bookmarks)<br/>WAL; every write is one transaction")]
    LocalSeed["First-launch seed (library/seedLocal.ts)<br/>insert-if-missing all 151 exercises,<br/>id = uuidv5(namespace, slug); never queued"]
    WriteLocal["writeLocal / writeLocalRowsTx / writeLocalTree (db/dao.ts): the queued write paths<br/>rows + outbox lines + re-stamp & queue parent workout,<br/>all-or-nothing (writeLocalTree: a whole workout in one transaction)<br/>deleteLocalRowsTx (B14): delete rows + 'delete' outbox line + touch the root<br/>(a deleted workout also drops its analysis and, B21, its post + the post's unsent lines)"]
    Drafts["writeDraftRows / deleteDraftRowsTx (db/dao.ts): the in-progress path<br/>saved at once, NEVER queued; refused for a finished workout"]
    LocalSeed --> LocalDB
    WriteLocal --> LocalDB
    Drafts --> LocalDB
  end

  subgraph LoggerUI["Logger screens (signed-in stack, above the tab bar)"]
    Logger["Active workout (app/active-workout.tsx)<br/>EntryCard per exercise: sets, reps + weight in the lifter's kg / lb (useDisplayUnit) + optional RPE,<br/>Warm-up chip (next sets are warm-ups), W toggle per logged set (B10),<br/>Bodyweight exercise: weight box = '+ lb' added load, reps alone logs,<br/>Timed chip (B11): reveals Time (s or m:ss) + Score boxes, closing clears them,<br/>Log set (reps, weight, time or score), Drop = next drop of the latest set (B11),<br/>Repeat last set (ONE tap, NFR-2), remove set (a drop set's top row removes all of it),<br/>link toggle (B11): superset with the card above, 'Superset' badge,<br/>drops shown as ↳ rows under one 'Set n' (sets numbered as the lifter counts),<br/>move up / down, remove exercise,<br/>last-time panel (LOG-5): 'Last time' line (work sets only) + 'PRs: 1RM … · e1RM … · 5RM …'<br/>+ History link (B13; PRs read once on mount, they only change at finish)<br/>one store call per card at a time<br/>notes (B12): header Title + Notes boxes; 'Add note' under each exercise;<br/>note icon on every logged set / drop opens its box (one set box per card);<br/>boxes autosave (useAutosaveText) ~750 ms after typing + on close;<br/>Finish flushes every box first (AutosaveRegistry)<br/>empty slot on open: resume from astra.db or go back"]
    Picker["Add exercise panel (ExercisePicker, a Modal)<br/>alias-aware searchExercises over the catalog, then my live customs<br/>matching the same search ('Custom · Barbell', B31; deleted ones never listed);<br/>reports { deviceId, name }: libraryExerciseId(slug) or the custom's own uuid<br/>→ store.addExercise(deviceId)"]
    EmptyQ{"Finish with zero sets?"}
    Saved["Saved workout (app/workout/[id].tsx); re-read on every focus (B14)<br/>date, duration, every exercise + set in the lifter's unit<br/>superset = ONE card labelled 'Superset' (B11);<br/>drop set = ONE row 'a → b → c'; time and score shown (B11)<br/>title (or date); workout, exercise and set notes as text (B12; drop notes '↳ …')<br/>PR badge under each set that holds a record now: 'PR · 1RM · e1RM' (B13)<br/>Analysis button (B18); Edit button; Delete button (asks first, B14)<br/>(another user's / unfinished id: 'not on this phone')"]
    EditWO_UI["Edit workout (app/edit-workout/[id].tsx, B14, LOG-9)<br/>the logger's surface over a FINISHED workout: Title + Notes boxes,<br/>EntryCard per exercise (log / repeat / remove sets, W, notes, links, move, remove),<br/>Add exercise; each change saved + queued at once, PRs recomputed in the same save<br/>Done = flush note boxes, back; Delete workout (asks first)<br/>(another user's / unfinished id: 'can't be edited on this phone')"]
    Saved -->|"Edit: router.push"| EditWO_UI
    EditWO_UI -->|"Done: router.back"| Saved
    EditWO_UI -->|Add exercise| Picker
    History["Exercise history (app/exercise-history/[exerciseId].tsx), read-only (B13, LOG-4)<br/>keyed by exercise uuid (works for exercises with no Library card);<br/>Back + the shared ExerciseHistorySection with the exercise name as heading (B30)"]
    Logger -->|"History link: router.push"| History
    History -->|Back| Logger
    Logger -->|Add exercise| Picker
    Picker -->|tap an exercise| Logger
    Logger -->|"floating 'Tool Kit' button (always on screen): ONE tap"| ToolKit
    ToolKit -->|"Close / system back: logger still mounted underneath, exactly as left"| Logger
    Logger -->|Finish| EmptyQ
    EmptyQ -->|"yes: 'Nothing logged yet'<br/>Discard workout / Keep lifting"| Logger
    AnalysisScr["Workout analysis (app/analysis/[id].tsx, B18: ANA-1/2/4, NFR-9)<br/>workout title or date; encouraging headline + message (rule-picked, no AI);<br/>Volume (lifter's unit), Sets ('n sets · k warm-up'), Duration (m:ss);<br/>B19 'Muscles trained' card (ANA-3): front + back body figures (MuscleMap),<br/>trained muscles filled red, opacity 0.25 + 0.75 × intensity, the rest plain;<br/>legend 'Chest, Shoulders, Triceps' (most direct first); hidden when nothing maps;<br/>'New PRs': exercise · book · weight; B21 finish mode (post=1, only from Finish): Next;<br/>View workout; B28 Share (→ share card); Back;<br/>not-medical-advice statement in EVERY state (incl. loading / missing);<br/>re-read on every focus; works offline<br/>(another user's / unfinished id: 'not on this phone')"]
    EmptyQ -->|"no: finish, clear slot,<br/>router.replace(analysis, post=1)"| AnalysisScr
    AnalysisScr -->|"View workout: router.push"| Saved
    Saved -->|"Analysis: router.push (no post=1 → no Next)"| AnalysisScr
    PostStep["Post step (app/post-workout/[id].tsx, B21, LOG-7)<br/>workout title or date; 'Share your workout';<br/>flair chips = the device flairs rows by position (never hard-coded, SOC-3),<br/>lowest-position chip picked first, one pick at a time;<br/>Post (disabled while saving) · Skip · Back;<br/>already posted → 'Already posted' + Go to Home;<br/>no flairs synced → Post disabled + a line why, Skip still works<br/>(another user's / unfinished id: 'not on this phone')"]
    AnalysisScr -->|"Next: router.push"| PostStep
    PostStep -->|"Back: router.back"| AnalysisScr
    PostQ["createWorkoutPost (social/createPost.ts, B21): ONE transaction —<br/>check own finished workout, no post yet, flair on the phone;<br/>insert posts row (new uuid, visibility = the workout's) + outbox line 'posts';<br/>then notifyLocalWrite → the engine syncs soon"]
    PostStep -->|Post| PostQ
  end
  PostQ -->|"posts row + outbox line"| LocalDB
  PostQ -.->|"notifies"| Triggers
  PostStep -->|"Post saved: router.replace('/')"| Home
  PostStep -->|"Skip (nothing made): router.replace('/workout')"| Workout
  AnalysisScr -->|"Back with nothing behind: router.replace"| Workout
  AnalysisScr -->|"Share (B28, LOG-8): router.push('/share-card/[id]')"| ShareCardScr["Share card (app/share-card/[id].tsx, B28: LOG-8, SOC-6 export)<br/>preview = ShareCard (components/share): 4:5 portrait, dark maroon gradient, Astra wordmark + date,<br/>title (or date), Volume / Sets ('n sets · k warm-up', setsSummaryLabel) / Duration in the lifter's unit,<br/>'New PRs' up to 3 (sessionPrLine) + '+ n more PRs', or with none up to 3 'Exercise · n sets';<br/>Share → captureRef (react-native-view-shot) of the card ON SCREEN → 1080×1350 PNG tmpfile →<br/>expo-sharing shareAsync (image/png) = the OS share sheet; failure → 'Couldn't make the image. Try again.';<br/>no share sheet (isAvailableAsync false) → Share disabled + a line; Back;<br/>another user's / unfinished id: 'not on this phone', no Share. Fully offline."]
  ShareCardScr -->|"analysisForScreen + readWorkout (names, set counts)"| LocalDB
  DispUnit -->|"unit"| ShareCardScr
  Workout -->|"Start / Resume: store into the session slot<br/>(activeWorkoutSession.ts, keyed by user id)"| Logger
  Workout -->|tap a past workout| Saved
  Workout -->|"tap a Tool Kit tile: initialTool = that tool"| ToolKit

  subgraph ToolKitG["Tool Kit (B16 + B17, TK-1..5): a Modal panel, NOT a route; no network anywhere"]
    ToolKit["ToolKitSheet (components/toolkit): header + Close,<br/>switcher 1RM | RPE | %1RM | Plates | Timer (radio chips);<br/>contents rebuilt on every open (Modal unmounts them)"]
    TimerC["Timer (TimerScreen): mode chips Stopwatch | Countdown | EMOM | AMRAP | Tabata<br/>(locked once started — Reset unlocks); huge m:ss digits + caption / round;<br/>idle: set-up boxes (countdown rest presets 0:30–5:00, min+sec; EMOM every + rounds;<br/>AMRAP cap; Tabata work s / rest s / rounds); Start / Pause / Resume / Reset / Go again;<br/>redraws every 250 ms only while running AND on screen; screen-reader round/phase/end announcements"]
    TimerMath["toolkit/timer.ts: pure clock math — a run is startedAt + pausedAt + pausedTotalMs;<br/>every frame = snapshot(run, Date.now()): elapsed / remaining, EMOM round, Tabata phase;<br/>endsAtMs = the wall-clock zero; readTimerConfig reads the set-up boxes"]
    TimerStoreN["toolkit/timerStore.ts: the ONE timer, module-level (outlives the Modal),<br/>in memory only (not saved; gone if the app is killed);<br/>start / resume → book alert at endsAtMs; pause / reset → cancel; stopwatch never books"]
    TimerAlertsN["toolkit/timerAlerts.ts: the only expo-notifications user, lazy guarded require<br/>(missing/broken module → 'unavailable', never a crash); Android channel 'timer' first;<br/>permission asked on first booking; past moment or superseded request → nothing booked;<br/>one fixed id 'astra-timer-zero' so re-booking replaces and cancel works after relaunch"]
    OSNotif[("Phone's notification scheduler (local, on device):<br/>date trigger fires at zero even with Astra backgrounded or killed;<br/>foreground: banner + sound (library default handler)")]
    ToolKit --> TimerC
    TimerC <-->|"useSyncExternalStore; actions"| TimerStoreN
    TimerC & TimerStoreN --> TimerMath
    TimerStoreN -->|"schedule(at, title, body) / cancel()"| TimerAlertsN
    TimerAlertsN -->|"scheduleNotificationAsync / cancelScheduledNotificationAsync"| OSNotif
    TimerAlertsN -.->|"'unavailable' → alertsOff → 'Notifications are off' line"| TimerStoreN
    OneRmC["1RM: weight (display unit) + reps 1–30 → epleyE1rm;<br/>a single = its own 1RM; table: weightForReps for 2–10 reps;<br/>Epley (1985) citation on the answer"]
    RpeC["RPE: 1RM + rep chips 1–12 + RPE chips 6–10 (½ steps)<br/>→ workingWeightFromRpe; 'Load …' snapped to 2.5 kg / 5 lb<br/>(roundToIncrement) + % of 1RM (percentOfOneRm)"]
    PctC["%1RM: 1RM + percent (0, 150] → workingWeightFromPercent;<br/>out of range refused inline; same 'Load …' line"]
    PlateC["Plate loader: works in the RACK's unit (kg | lb plates toggle);<br/>target + bar → loadBar: per side '2 × 45 lb', loaded total,<br/>exact / 'short by …' / 'bar alone is over';<br/>rack editor: − / + per side (0–20), remove, add any size"]
    TkSession["toolkit/session.ts: last tool + every typed box,<br/>in memory only (gone on app restart), shared by both entry points"]
    TkInputs["toolkit/inputs.ts: read boxes (empty / invalid + why / ok),<br/>lb → kg via lbToKg, loadable snap"]
    ToolKit --> OneRmC
    ToolKit --> RpeC
    ToolKit --> PctC
    ToolKit --> PlateC
    OneRmC & RpeC & PctC & PlateC <-->|"restore on open / write as typed"| TkSession
    OneRmC & RpeC & PctC & PlateC --> TkInputs
  end
  PlateC <-->|"toolkit/plateRack.ts: load (cached; damaged → defaults),<br/>save on every edit (fire-and-forget)"| RackStore[("kv-store key astra.toolkit.plateRack<br/>JSON v1: chosen unit (null = display unit) + one rack per unit;<br/>this phone only, not synced, not per account")]
  DispUnit -->|"unit (weight calculators; plate loader's first rack)"| ToolKit
  Logger -->|"Discard (asks first) / back"| Workout
  Saved -->|"Delete confirmed: router.replace"| Workout
  EditWO_UI -->|"Delete workout confirmed: router.replace"| Workout

  subgraph Reads["History read-model (src/workout/history.ts), read only, every query filtered by user_id"]
    ListQ["listPastWorkouts: finished only, newest first, limit 100, counts"]
    ReadQ["readWorkout: one finished workout, entries joined to exercise names, sets"]
    LastQ["lastSessionSets: newest finished workout with a logged set of<br/>this exercise, never the current draft; + exerciseInfo (name, equipment)"]
    SessQ["exerciseSessions (B13): newest N finished workouts with a logged set<br/>of this exercise (N = 50, grown by 50 per 'Show older sessions'), each with that exercise's sets"]
    PrQ["currentPrs (workout/prs.ts, B13): stored records of one exercise,<br/>ordered 1RM, e1RM, rep maxes by reps"]
  end
  LocalDB --> ListQ --> Workout
  LocalDB --> ReadQ --> Saved
  LocalDB --> LastQ --> Logger
  HistSection["ExerciseHistorySection (components/workout, B30): the ONE reader + renderer<br/>of a lifter's history of one exercise — 'Current PRs' (formatPrLine, or 'No PRs yet');<br/>one card per finished session, newest first: title or date, sets (warm-ups 'W',<br/>drop set on one row); 'Show older sessions' while a full batch came back<br/>(re-reads with limit + 50; old list stays until the longer one lands; a failed<br/>re-read keeps it); loading / 'couldn't be read' / no-sessions states; offline"]
  LocalDB --> SessQ --> HistSection
  LocalDB --> PrQ
  PrQ --> Logger
  PrQ --> Saved
  PrQ --> HistSection
  HistSection -->|"showName (+ exerciseInfo)"| History
  HistSection -->|"Your history"| ExDetail

  subgraph AnaMod["Analysis on the phone (src/analysis/analysis.ts, B18)"]
    ForScreen{"analysisForScreen: unsent lines in the workout tree / its PR rows?<br/>yes → LOCAL (no clock compare);<br/>no → STORED row unless stale (workout_updated_at &lt; workout.updated_at);<br/>no stored row → LOCAL"}
    LocalA["localAnalysis: read workout + slots + sets + PR rows citing them<br/>+ exercise names → buildAnalysis (same rules as the server)"]
    StoredA["storedAnalysis: the mirror row, new_prs JSON parsed"]
    ReqPass["analysisRequestPass: finished workouts with no / stale analysis<br/>and no unsent lines, newest first, max 10 per sync;<br/>requestAnalysis each; save the reply (saveServerAnalysesTx);<br/>a failure is logged, retried next sync"]
    ForScreen --> LocalA
    ForScreen --> StoredA
    MuscleRead["sessionMuscleLoads (src/analysis/muscles.ts, B19):<br/>distinct exercises.slug of the user's workout's slots with ≥ 1 set<br/>(warm-ups count; custom / unknown slug → nothing) → catalog muscles<br/>→ combineMuscleLoads; read in the SAME keyed load as analysisForScreen"]
  end
  LocalDB --> ForScreen --> AnalysisScr
  LocalDB --> MuscleRead -->|"muscle map"| AnalysisScr
  Catalog -->|"muscle intensities by slug"| MuscleRead
  DispUnit -->|"unit"| AnalysisScr

  subgraph ActiveWO["Active-workout store (src/workout/activeWorkout.ts)<br/>driven by the logger screens through the session slot + useActiveWorkout hooks"]
    StartWO["startActiveWorkout: blank public workout<br/>(refused while one is in progress);<br/>B35: optional programWorkoutId saved on the row from birth<br/>(refused unless that program workout is on the phone)"]
    ResumeWO["loadActiveWorkout: on launch, rebuild the<br/>signed-in user's unfinished workout from astra.db"]
    MutWO["add / remove / reorder exercise; log / fix / remove set;<br/>repeat last set; updateSets / removeSets (several sets, one transaction, B11);<br/>linkWithPrevious / unlinkFromPrevious (superset_group, B11);<br/>setTitle / setNotes / setEntryNotes / setSetNotes (B12, trimmed, blank = none;<br/>repeat never copies a set note):<br/>check server limits, convert lb→kg,<br/>commit to SQLite, then re-read the snapshot"]
    FinishWO["finish: ended_at = max(now, started_at);<br/>PR detection (workout/prs.ts improvedRecords, B13): per exercise, fold finished<br/>history + today's sets through recordBooks; keep only books that beat the stored row;<br/>B35: if the workout has program_workout_id → advanceRunOnFinish (run → next session, or ended);<br/>queue workout + entries + sets + improved personal_records + program_runs in ONE transaction; store sealed"]
  FinishWO -->|"program session only"| RunsMod
    DiscardWO["discard: delete the draft (cascades), nothing to sync"]
    Policy{{"WritePolicy seam (B14): every operation above saves through a policy<br/>draftPolicy (logger, default) or editPolicy (editWorkout.ts)"}}
    EditPol["editPolicy + openWorkoutForEdit (workout/editWorkout.ts, B14):<br/>same operations on a finished workout; refuses if it vanished;<br/>each operation = ONE transaction: writes via writeLocalRowsTx / deleteLocalRowsTx,<br/>then recomputeRecords for the touched exercises + saveRecomputedRecordsTx<br/>finish refused; discard = deleteWorkout"]
    DelWO["deleteWorkout (B14): ONE transaction: delete the tree + queue ONE workout delete,<br/>recompute its exercises' PRs from the remaining history (next best set takes the book)"]
    Recompute["recomputeRecords (workout/prs.ts, B14): fold ALL finished history;<br/>diff vs stored rows → upserts (new / raised / same value new set),<br/>demotions (queued delete THEN upsert, gets past keep-best), removals (queued delete)"]
    EditPol --> Recompute
    DelWO --> Recompute
  end
  MutWO --> Policy
  Policy -->|draft| Drafts
  Policy -->|edit| EditPol
  EditPol --> WriteLocal
  DelWO --> WriteLocal
  Recompute --> WriteLocal
  EditWO_UI --> MutWO
  EditWO_UI -->|Delete workout| DelWO
  Saved -->|Delete| DelWO
  StartWO --> Drafts
  DiscardWO --> Drafts
  LocalDB --> ResumeWO
  FinishWO --> WriteLocal
  Workout --> StartWO
  Workout --> ResumeWO
  Logger --> MutWO
  Logger --> FinishWO
  Logger --> DiscardWO

  subgraph SyncEng["Sync engine (src/sync), mounted by useSync in the root layout"]
    Triggers{{"Triggers, debounced 750 ms, one run at a time:<br/>start with a session, app back to foreground,<br/>network reconnects, a local write"}}
    PrePass["Tombstones first (B14): apply other devices' deletions<br/>BEFORE uploading, so an unsent edit can't re-create<br/>a workout deleted elsewhere"]
    Push["Push: DELETE phase first (B14): outbox 'delete' lines,<br/>children's tables first, batches of 100 ids;<br/>then outbox → server upserts, parents first (SYNC_ORDER, reordered in B35):<br/>exercises → programs → program_weeks → program_workouts → workouts →<br/>workout_exercises → sets → personal_records → program_exercises → program_runs<br/>(programs before workouts: a program session names its program workout), batches of 500 on id (no updated_at),<br/>then workouts again to re-touch roots;<br/>clear lines up to each row's watermark PER OP; stop on failure;<br/>LAST (B15): settings phase — pending user_settings line → UPDATE unit + (B26) progress_pic_visibility<br/>by user_id (never insert; zero-row update = done);<br/>then (B21) posts phase — each pending posts line → upsert on id (no updated_at),<br/>after its workout landed; 23505 (another device posted it) → drop the local post + lines;<br/>B22 photo post: FIRST stream the waiting file to Storage (uploadPostImage, x-upsert: same path<br/>every retry), THEN upsert the row, ack, delete the waiting file;<br/>waiting file missing → drop the post (can never upload); bucket refusal / no signal → keep line, retry next sync"]
    Pull["Pull: exercises, then own workouts by (updated_at, id)<br/>bookmark minus 5 s; fetch their entries and sets;<br/>reconcile (B14): drop local entries / sets the server's copy lacks<br/>(+ PR rows citing them), unless they have unsent lines;<br/>then own personal_records on their own bookmark (B13);<br/>LAST: tombstones after the stored id (B14): deleted workout → local tree<br/>+ its outbox lines go; deleted PR → goes unless unsent or newer;<br/>then (B15) the user_settings row, no bookmark: saved unless a toggle is unsent<br/>(check + save in one transaction), then onUserSettingsPulled → unitStore.applyPulled;<br/>save page + bookmark in one transaction;<br/>skip rows with unsent local edits;<br/>B18: after personal_records, workout_analyses on pull_cursor:workout_analyses<br/>(saved as they come — never any outbox lines); a workout tombstone also drops its analysis<br/>B34: then programs, program_weeks, program_workouts, program_exercises, each on its own<br/>bookmark (pull_cursor:programs …), parents first, RLS-scoped (author-only; programs also by user_id);<br/>soft deletes arrive as ordinary rows (no tombstones);<br/>B35: then program_runs on pull_cursor:program_runs (own rows, by user_id; ended = an update);<br/>and (B21) its post + the post's unsent lines;<br/>VERY LAST (B21): flairs select-all by position → replace the device copy<br/>(a failure is recorded + logged, not a failed pull; an empty answer is ignored)"]
    Triggers --> PrePass --> Push --> Pull
    Pull -->|"only if the pull succeeded (B18)"| ReqPass
  end
  ReqPass -->|"reply row"| LocalDB
  Catalog --> LocalSeed
  Root -->|"useSync: opens astra.db (seeds) always;<br/>while signed in: unitStore.hydrate, then the engine;<br/>signed out: unitStore.reset"| LocalDB
  Root -->|"hydrate / reset; applyPulled passed to the engine"| UnitStore
  DispUnit -->|"unit"| Logger
  DispUnit -->|"unit"| Saved
  DispUnit -->|"unit"| EditWO_UI
  DispUnit -->|"unit"| History
  Root --> Triggers
  LocalDB -->|outbox rows| Push
  Pull -->|saved rows| LocalDB
  WriteLocal -.->|"notifies"| Triggers

  subgraph Backend["Supabase project (live)"]
    AuthAPI["Supabase Auth<br/>email + password accounts"]
    Trigger{"signup trigger handle_new_user<br/>refuses missing / under-18 birthdate;<br/>creates profile, settings, body data"}
    DB[("Postgres<br/>profiles, settings, body data, follows, blocks,<br/>exercises, workouts, workout_exercises, sets,<br/>personal_records (owner-only RLS; keep-best trigger<br/>never lets an UPDATE lower a record; delete+insert can),<br/>sync_tombstones (B14: written by delete triggers, owner-only read),<br/>workout_analyses (B18: owner read only; NO write policies),<br/>flairs + posts (B20: posts read per workout_visible; write only own post of own workout;<br/>B22: kind / image_path, own-folder CHECK; B26: progress-pic-private CHECK dropped, the author picks;<br/>trigger sync_workout_visibility: a post's visibility change moves its workout, invoker rights;<br/>B27: mutes, moderators, reports (queue, founder reads in the dashboard); workout_visible hides muted lifters;<br/>votes / comments also filtered by their author (block either way / muted);<br/>B34: programs → program_weeks → program_workouts → program_exercises, author-only RLS (owns_program), soft deletes;<br/>B35: program_runs (owner-only RLS, no one-active constraint) + workouts.program_workout_id)<br/>see database-erd.md")]
    Bucket[("Storage bucket post-images (B22, private)<br/>10 MiB cap, jpeg / png / webp only;<br/>write only in your own userId/ folder;<br/>read own folder, or any object a visible post cites (workout_visible)")]
    AnalyzeFn["Edge function analyze-workout (B18, deployed, verify_jwt on)<br/>POST {workoutId} with the user's token → getUser;<br/>reads AS THE CALLER (RLS); 404 unless the caller OWNS the workout;<br/>422 if unfinished; buildAnalysis (no model); upsert by id<br/>with the SERVICE ROLE (one statement); returns the stored row"]
    AuthAPI --> Trigger --> DB
    AnalyzeFn -->|"select as caller; upsert workout_analyses as service role"| DB
    ModerateFn["Edge function moderate (B27, NFR-7, deployed v2, verify_jwt on)<br/>POST {action: remove-post | remove-comment | remove-account, targetId}<br/>with the founder's token → getUser; 403 unless in moderators (read as service role);<br/>remove-post: delete post (votes/comments cascade) → delete its post-images object → resolve open reports;<br/>remove-comment: delete → resolve; remove-account: 409 for a moderator, else auth.admin.deleteUser<br/>(cascade) → sweep post-images/id/ + avatars/id/. No app screen calls it — the founder, by hand"]
    ModerateFn -->|"service role: moderators check, deletes, reports status"| DB
    ModerateFn -->|"service role: remove objects"| Bucket
    ExportFn["Edge function export-data (B32, NFR-6, deployed v1, verify_jwt on)<br/>POST (no body) with the user's token → getUser; NO service role —<br/>every read AS THE CALLER (RLS) and filtered to the caller's own rows<br/>(profile, settings, body data, customs incl. deleted, workouts → entries → sets,<br/>personal_records, workout_analyses, own posts); 500-row pages, 100-id chunks;<br/>200 one JSON document {format astra-export v1, units kg, …, exerciseNames, flairs}"]
    ExportFn -->|"select as caller"| DB
    DeleteFn["Edge function delete-account (B32, NFR-6, deployed v2, verify_jwt on)<br/>POST {confirm: 'DELETE'} (else 400) with the user's token → getUser — the only<br/>account it can delete is the caller's; 409 if in moderators;<br/>1 sweep the caller's folder in post-images + avatars, 2 auth.admin.deleteUser<br/>(cascades every row); files first so any failure leaves the login and a retry works"]
    DeleteFn -->|"service role: moderators check, auth.admin.deleteUser → cascade"| DB
    DeleteFn -->|"service role: list + remove own folder"| Bucket
  end
  ReqPass -->|"supabase.functions.invoke('analyze-workout')"| AnalyzeFn

  Gate -->|no: signUp with birthdate in metadata| AuthAPI
  SignIn -->|signInWithPassword| AuthAPI
  AuthAPI -->|session| Store
  Store --> Restore
  AuthAPI -->|"auth change event<br/>(signed in / out / refreshed)"| Guard{{"Route guard (Stack.Protected)<br/>session? tabs : sign in"}}
  Guard --> Tabs
  Guard --> SignIn
  SettingsScr -->|"Sign out (local scope:<br/>clears this device first, works offline)"| Store
  SettingsScr -->|"Export your data (B32): exportMyData"| ExportFlow["account/exportData.ts (B32, NFR-6)<br/>canShare? → functions.invoke('export-data') (fetch error → 'needs a connection')<br/>→ write cacheDirectory/astra-export-yyyy-mm-dd.json → Sharing.shareAsync (application/json)<br/>→ delete the cache copy (always, in finally)"]
  ExportFlow -->|"supabase.functions.invoke('export-data')"| ExportFn
  SettingsScr -->|"Delete account: router.push('/delete-account')"| DeleteScr["Delete account (app/delete-account.tsx, B32, NFR-6)<br/>shows the signed-in email + what goes; 'Export your data first' → back;<br/>Delete my account locked until DELETE is typed;<br/>failure / offline → calm line, nothing wiped"]
  DeleteScr -->|"requestAccountDeletion: functions.invoke('delete-account', {confirm: 'DELETE'})"| DeleteFn
  DeleteScr -->|"only after the server's 'deleted': wipeDeviceData"| Wipe["db/wipeDevice.ts (B32): best-effort, in order —<br/>1 signOut (local) → guard → sign in;<br/>2 deleteAppDatabase: close astra.db, delete the file<br/>(opens asked for meanwhile wait, then get a fresh empty db);<br/>3 kv-store clear (plate rack, feed prefs, own-profile cache);<br/>4 delete documents/post-images/ (waiting photos)<br/>refused sign-out → 'Close Astra and open it again'"]
  Wipe --> Store
  Wipe -->|"close + delete file"| LocalDB

  Push -->|"supabase-js delete by id, then upsert, as the signed-in user (RLS);<br/>user_settings: update by user_id"| DB
  Push -->|"B22: FileSystem.uploadAsync POST /storage/v1/object/post-images/path<br/>(Bearer token, apikey, x-upsert: true), before the post row"| Bucket
  Bucket -->|"authenticated GET as the viewer (RLS per photo)"| Home
  DB -->|"supabase-js select (RLS-scoped), incl. sync_tombstones"| Pull
  DB -->|"sync_tombstones after id"| PrePass
  PrePass -->|"deletes local rows + their lines"| LocalDB
  Library -.->|"not wired yet: the catalog cards still come from the bundle, not astra.db<br/>(only 'Your exercises' reads astra.db, B31)"| LocalDB
  CustomMod -->|"select … where owner_id = me and deleted_at is null"| LocalDB
  CustomMod -->|"my live customs (useCustomExercises, on focus)"| Picker

  subgraph Shared["Shared training math (backend/supabase/functions/_shared/training-math)<br/>import name in the app: @training-math"]
    MathMod["Pure functions, no I/O, all weights in kg:<br/>Epley e1RM, RPE chart, %1RM, plate loader,<br/>kg/lb conversion + display rounding, PR classification<br/>+ recordBooks fold (which set holds each book), beatsRecord, compareRecordBooks (B13),<br/>session volume (volume.ts: warm-ups and weightless sets add 0),<br/>server limits on a set + storage rounding (limits.ts)<br/>called by the active-workout store, the logger's<br/>display (displayWeight), the Tool Kit (B16) and the analysis rules (B18)"]
    AnaRules["Analysis rules (_shared/analysis, B18), import name @analysis:<br/>buildSummary (sessionVolumeKg, set counts, duration, PRs citing the sets),<br/>pickCopy (4 states: pr / weighted / unloaded / empty), NOT_MEDICAL_ADVICE,<br/>buildAnalysis + ANALYSIS_ENGINE_VERSION = 1; pure, deterministic;<br/>B19 combineMuscleLoads: per-muscle MAX across a session's exercises (phone only so far)"]
    MathMod --> AnaRules
  end
  AnaRules -->|"buildAnalysis (Deno, relative import)"| AnalyzeFn
  AnaRules -->|"buildAnalysis (offline view)"| LocalA
  AnaRules -->|"NOT_MEDICAL_ADVICE"| AnalysisScr
  AnaRules -->|"combineMuscleLoads"| MuscleRead
  MathMod -->|"lbToKg, assertValidSetFields (incl. score + set-note length),<br/>assertValidSupersetGroup, title / workout-note / entry-note caps (B12),<br/>round weight / RPE for storage"| MutWO
  MathMod -->|"displayWeight (format.ts) in the unit from useDisplayUnit"| Logger
  MathMod -->|"recordBooks, beatsRecord, roundToIncrement (B13)"| FinishWO
  MathMod -->|"recordBooks, roundToIncrement (B14)"| Recompute
  MathMod -->|"epleyE1rm, weightForReps, workingWeightFromRpe, percentOfOneRm,<br/>workingWeightFromPercent, loadBar, lbToKg / kgToLb, roundToIncrement, displayWeight (B16)"| ToolKit
  MathMod -.->|"not wired yet: session volume display"| Workout

  class Market scaffold
  class Seed,Catalog,DB,Store,LocalDB,RackStore data
```

## What a user can do today

1. **Create an account** with email, password and birthdate. An invalid or under-18 birthdate is
   refused on the spot with "Astra is 18+. You must be 18 or older to create an account." and
   nothing is sent. The database trigger repeats the check for anyone calling the API directly,
   once its migration is applied live (see `database-erd.md`).
2. **Sign in** with email and password. Wrong credentials, a taken email, rate limits and no signal
   each get a plain-language message.
3. **Stay signed in.** Killing and reopening the app restores the saved session from the device
   with no network, straight into the tabs.
4. **Sign out** from Settings (You → gear button). The guard returns the user to sign-in.
5. Move between the five tabs and the You screen. On Library, scroll, search and filter every
   launch exercise from the bundled, read-only catalog — by body region, by one of the twelve
   muscles (hardest-trained first) and by equipment, the rows combining (B29). Tap a card to
   open its detail screen: muscles worked, the five coaching steps and tips, then **Your
   history** (B30): the lifter's current PRs on that movement and every session they logged of
   it, with **Show older sessions** revealing 50 more at a time; Back returns. The catalog is
   bundled and the history comes from the phone's database (the card's slug becomes the
   exercise's database id via `libraryExerciseId`), so it all works offline.
   **Custom exercises (B31, LIB-5).** Above the catalog sits **Your exercises**: the lifter's own
   movements, read from the phone's database and obeying the same search and muscle / equipment
   chips (a region chip hides them — customs have no region). **New exercise** opens a form (name,
   optional equipment and main muscle); Save writes it to the phone at once and queues it, so it
   works in airplane mode and uploads at the next sync. Tapping a custom opens its own card — name,
   "Custom", Edit, Delete and the same Your history section (its sessions and PRs collect exactly
   like a library exercise's). **Delete** asks first, then hides it from the Library and the
   logger's picker on every phone of theirs; it is a soft delete, so past sessions and PRs still
   name it. Customs are private: the server's row-level security shows them to their owner only.
6. **Log a workout (B09), with no signal needed.** On the Workout tab, tap **Start empty
   workout**. The logger opens full-screen: **Add exercise** searches the library; each
   exercise card takes reps and/or weight in pounds (**Log set**), repeats the last set in one
   tap (**Repeat last set**), removes a set, moves the exercise up or down, or removes it, and
   shows "Last time: 3 × 8 @ 185 lb" from the previous finished session of that exercise
   (work sets only). **Set types (B10):** an optional **RPE** box beside reps and weight; a
   **Warm-up** chip that, while pressed, makes each logged set a warm-up; and a **W** beside
   every logged set that flips it between warm-up and work set after the fact. Sets print as
   "W · 8 × 135 lb" or "5 × 225 lb @ RPE 8" on the logger and the saved workout. A bodyweight
   exercise (pull-ups, dips) logs with reps alone ("8 reps"); its weight box reads "+ lb" for
   added load on a weighted set.
   **Supersets, drop sets, timed work (B11):** every card but the first has a **link** toggle
   that supersets it with the card above (linked cards wear a **Superset** badge; tapping it
   again unlinks, splitting the superset there). **Drop** logs what the boxes say as the next
   drop of the latest set; drops show as "↳ 8 × 185 lb" rows under one "Set n", and the saved
   workout prints the whole drop set as one row ("8 × 225 lb → 8 × 185 lb → 10 × 155 lb"). The
   **Timed** chip opens a **Time** box ("90" or "4:32") and a **Score** box ("7 rounds + 12
   reps"); either logs alone or with reps / weight ("100 reps · 7:32"). The saved workout shows
   a superset as one card holding its exercises.
   **Notes (B12):** under "Started …" the logger has a **Workout title** box and a **Notes**
   box; each exercise card has an **Add note** line (tap to write a note on the exercise); every
   logged set and drop has a speech-bubble icon that opens a note box for that one set. Notes
   show as muted lines (tap to edit; clear to remove) and save themselves as they are typed, so a
   killed app keeps them. **Repeat** does not copy a set's note. The saved workout shows the
   title (or the date when there is none), the workout's note, each exercise's note, and each
   set's note under it (a drop's marked "↳").
   **Finish** saves it and opens its post-workout analysis (B18; **View workout** there opens the
   read-only saved workout) (finishing with no sets offers only
   "Discard workout" or "Keep lifting"). **Discard** asks, then deletes the draft. Leaving the
   logger or killing the app loses nothing: the Workout tab then offers **Resume workout** /
   **Discard workout** instead of Start.
7. **See past workouts.** The Workout tab lists the newest 100 finished workouts (date,
   duration, exercise and set counts); tapping one opens it with every set.
8. **PRs and exercise history (B13).** Finishing a workout works out, on the phone and offline,
   which record books it improved: the heaviest single (**1RM**), the heaviest weight for exactly
   N reps (**5RM**, …) and the best estimated 1RM (**e1RM**, Epley). Warm-ups, bodyweight sets
   and extra volume never count. The saved workout then shows **"PR · 5RM"**-style badges under
   each set that holds a record. While logging, each exercise card shows **"PRs: 1RM 225 lb ·
   e1RM 243.1 lb · 5RM 205 lb"** under the "Last time" line, plus a **History** link to that
   exercise's history screen: current PRs, then every finished session of it (newest 50, with
   **Show older sessions** for the rest, B30) with its sets.
9. **Edit or delete a past workout (B14, LOG-9).** The saved workout has **Edit** and
   **Delete**. Edit opens the logger's surface over that workout: add, remove or move
   exercises, log, repeat or remove sets (a mistyped set is removed and logged again), flip
   warm-ups, link supersets, change the title or any note. Every change is saved and queued the
   moment it is made, and the PRs of the exercises it touched are worked out again from the
   remaining history in the same save — a lighter or deleted record passes to the next best set,
   or disappears if nothing else qualifies. **Done** returns to the saved workout, which shows
   the change. **Delete** (on either screen, after "Delete this workout?") removes it from the
   phone now and from the account at the next sync, with the same PR recompute. The lifter's
   other phones drop the deleted workout, removed sets and demoted records at their next sync.
10. **Choose kg or lb (B15, LOG-6).** You → gear button → **Settings**. The **Units** toggle
   (kg | lb, pounds by default) switches every weight on every open screen at once — the logger's
   sets, last-time and PR lines and entry boxes ("Weight in kg"), saved workouts, the edit screen
   and exercise history. Logged weights are never changed: they are stored in kg and only shown
   in the chosen unit, so flipping back and forth shows exactly the same numbers. The choice is
   saved on the phone straight away (works offline, survives a killed app) and reaches the
   account at the next sync; a choice made on another phone arrives at this one's next sync.
   **Account** shows the signed-in email, **Sign out**, and (B32) **Export your data** and
   **Delete account** — see 22.
11. **Use the Tool Kit (B16, TK-1..4), with no signal needed.** In the logger, the red **Tool
   Kit** button floating bottom-right (on screen however far the workout is scrolled) opens the
   calculators in a panel over the workout; **Close** lands back on the logger exactly as it was
   — scroll position, half-typed boxes and all. The Workout tab's **1RM / RPE / %1RM / Plates**
   tiles open the same panel straight at that calculator. **1RM**: weight and reps → the
   estimated 1RM (Epley, source printed with the answer; a single counts as its own 1RM) and the
   estimated weight for 2–10 reps. **RPE**: a 1RM plus tapped reps (1–12) and RPE (6–10 in half
   steps) → the working weight, the nearest loadable weight (2.5 kg / 5 lb) and its % of the 1RM.
   **%1RM**: a 1RM and a percentage (up to 150 %) → the working weight and its loadable
   neighbour. Those three work in the lifter's kg / lb setting. **Plates**: a target and bar
   weight → what to put on each side, the total that loads, and whether it is exact, short (the
   rack can't make it) or under the bar; the rack (kg or lb plates, each unit its own) is edited
   right there and remembered on this phone. Typed numbers are remembered until the app restarts.
12. **Run a timer (B17, TK-5), with no signal needed.** The Tool Kit's **Timer** (also a Workout
   tab tile) is a gym wall clock: pick **Stopwatch** (counts up), **Countdown** (a rest timer —
   one-tap 0:30 … 5:00 presets or minutes + seconds), **EMOM** (an interval, default 1:00, for
   N rounds — the time left in each round with "Round 3 of 10"), **AMRAP** (counts up to a time
   cap, with the time left under it) or **Tabata** (work / rest seconds × rounds, default
   20 / 10 × 8, showing Work or Rest and the round). **Start**, **Pause**, **Resume**, **Reset**;
   a finished timer shows its "time's up" words and **Go again**. The mode chips lock once a
   timer starts. The timer keeps running when the panel is closed, the phone is locked or
   another app is open — the time is right on return because it is worked out from timestamps.
   A finite timer books a local notification for its zero, so the alert arrives with Astra in
   the background (or closed). The first start asks notification permission; if it is refused,
   a line says alerts are off and the timer works the same.
13. **Read the post-workout analysis (B18, ANA-1/2/4/11, NFR-9).** Finishing a workout lands on
   its analysis; any saved workout's **Analysis** button reopens it (workouts finished before
   B18 included). It shows an encouraging headline and message picked by fixed rules (a PR day,
   a solid weighted session, bodyweight / timed / warm-up work, or an empty finish — never
   shaming, no performance claims, no AI), the session's total volume in the lifter's unit, sets
   (with warm-ups counted separately), duration, and the records the session holds
   ("Squat · 5RM · 225 lb"). The not-medical-advice statement is at the bottom of every state.
   With no signal it is computed on the phone with the very rules the server uses; after the
   next sync the server's stored copy (identical unless the data differs) takes over. Editing
   the workout recomputes it.
   Since B19 (ANA-3) it also shows a **Muscles trained** card: front and back body figures with
   every muscle group the session's library exercises worked filled red — strongest for the main
   movers — and a line naming them ("Chest, Shoulders, Triceps" for a bench-only day). Any
   exercise with a logged set counts, warm-ups included; an exercise added but never done, or a
   custom exercise (no library muscle data), adds nothing. The card is left out when nothing maps.
   It is always read from the phone, never stored, so it is offline and follows edits at once.
   Since B21 (LOG-7), when Finish opened it the analysis also has a **Next** button (the saved
   workout's Analysis button opens it without one, so old workouts are never offered again).
   Next opens the **Post step**: the workout's title, a row of flair chips (the flair list the
   phone downloaded, first one picked), **Post** and **Skip**. Post saves a post of that workout
   with the chosen flair and the workout's own visibility — on the phone, queued, so it works
   with no signal — and opens Home; the post goes up on the next connection, after its workout,
   and then appears in the lifter's own feed. Skip makes nothing and goes to the Workout tab.
   Back returns to the analysis. One post per workout: a workout already posted shows "Already
   posted".
14. **Read the Home feed and follow lifters (B20, SOC-1, SOC-3, SOC-7 part) — needs a
   connection.** Home lists workout posts from the people the lifter follows, plus their own,
   newest first, twenty at a time (scrolling to the bottom loads more; pulling down refreshes;
   coming back to Home reloads). Each card shows the author (letter avatar, name, @username),
   "Today" / "Yesterday" / the date, the post's flair chip (its name read from the `flairs`
   row), the workout's title, its "58 min · 3 exercises · 12 sets" line, up to four exercises
   with every set printed exactly as the logger prints it in the *viewer's* kg / lb (supersets
   grouped, drop sets on one row; "+ n more exercises" after four; another lifter's custom
   exercise reads "Custom exercise"), and the workout's notes. Tapping the author opens their
   profile (B25, item 18); the rest of the card isn't tappable yet. The
   **Find lifters** button opens a search by name or username; each result has **Follow** /
   **Following** (one-way, no approval; it flips at once and flips back with "You can't follow
   this lifter." if a block stops it). Posts are made at the Post step after Finish (item 13).
   Offline, Home says the feed needs a connection (with Retry); everything else keeps working.
15. **Share a photo (B22, SOC-2, NFR-4, NFR-5).** Home's **Share a photo** opens a screen with two
   type chips — **Progress pic** (seen by whoever the lifter chose in Settings → Privacy, only
   them by default — B26; Physique Check flair) and **PR photo** (public; New PR flair) — and **Choose photo** (the phone's photo library). A
   photo over 10 MB, or not JPEG / PNG / WebP, is refused the moment it is picked with a sentence
   saying how big it is and what the limit is, and Post stays disabled. **Post** saves the post
   and a copy of the photo on the phone and returns to Home at once; the sync engine uploads the
   photo, then the post, in the background (retrying every sync until both land). Photo posts
   appear on Home as a photo card fetched with the viewer's sign-in, so the server decides who
   sees each one; the lifter's own posts show who can see them (item 19).
16. **Vote and comment (B23, SOC-4, SOC-5) — needs a connection.** Every card's footer has an
   up arrow, the post's net score (ups minus downs, counted on the server) and a down arrow — no
   down arrow at all on an upvote-only post (Physique Check; the flair row says so, and the
   server refuses a downvote anyway). Tapping an arrow votes and the score moves at once; tapping
   the lit arrow again takes the vote back; tapping the other switches. If the server refuses, the
   score and arrow go back and a short line says why. The **Comment** / **n comments** button
   opens the post's comments, oldest first, with a box to add one (up to 500 characters; Send
   stays off while it's blank or too long). Back to Home reloads the counts.
17. **Sort and filter the feed (B24, SOC-11, SOC-9).** Under "Your feed", **Latest | Hot** chooses
   the order: Latest is newest first; Hot is the server's ranking (Reddit's published hot
   formula — votes lift a post, age pulls it down). A row of flair chips — **All** plus one per
   flair on the phone — filters the feed to one flair; an empty filtered feed says "No *Form
   Check* posts yet." with **Show all posts**. Both choices are remembered on this phone for this
   account and come back after the app is closed; a remembered flair that no longer exists reads
   as All.
18. **Profiles (B25, YOU-1, YOU-2, YOU-3, SOC-7).** The **You** tab is the lifter's own profile:
   photo (or letter badge), name, @username, bio, and **Followers / Following** counts (every
   follow, counted on the server), with **Edit profile** and the Settings gear. Tapping a post
   card's author on Home, or a card on Find lifters, opens that lifter's profile with a
   **Follow / Following** button — after a follow the counts update to match. Under the header,
   **Posts** (their posts as feed cards), **History** (every finished workout, newest first,
   paging back to the first; your own open the saved workout) and **PRs** (current records per
   exercise, e.g. "1RM 140 kg · e1RM 151.7 kg · 5RM 130 kg"). Only what the server lets you see
   comes back: someone's private workouts, and the PRs they prove, never show. Your own history
   and PRs come from the phone and work offline, and your own name, bio and photo are remembered
   on the phone; counts and posts need a connection (a dash and a Retry line without one).
   **Edit profile** changes the name, username (3–30 letters, numbers or underscores; once set it
   can be changed, not removed; "That username is taken." if someone has it), bio (300
   characters) and photo (square crop, up to 5 MB, JPEG / PNG / WebP; refused at pick time
   otherwise). Saving needs a connection.
19. **Who can see a post (B26, YOU-5, NFR-5) — needs a connection.** Every one of the lifter's own
   cards (Home and their own Posts tab — workout posts, progress pics and PR photos) carries a
   small chip: **Only you**, **Followers** or **Public**. Tapping it opens the three choices;
   picking one changes it at once and on the server (a workout post's workout changes with it).
   If the server refuses, the chip goes back with a short line. The post stays on the lifter's
   own screens whichever they pick; for everyone else a private post — and its photo — is gone
   through the API, not just hidden. Other people's cards have no chip. **Settings → Privacy**
   chooses who *new* progress pics are shown to (Only you by default; works offline, synced
   like the unit) and states that body data is only ever visible to the lifter.
20. **Report, mute and block (B27, SOC-8, NFR-7) — needs a connection.** Other people's post
   cards (Home, profiles) and comments have a **⋯** button that opens **Report**: pick one of six
   reasons — the same six as `docs/CONTENT_POLICY.md` — add details if wanted, and send. The
   report goes to the founder's queue (read in the Supabase dashboard); the reported lifter isn't
   told. Reporting the same thing twice just says thanks again. Another lifter's profile has
   **Mute** (their posts, workouts, PRs, comments and votes disappear for you everywhere; they
   aren't told; you keep following) and **Block** (asked first: hidden both ways, follows removed
   both ways; no Follow button while blocking). Both undo from the same profile, and the profile
   says when you've muted or blocked someone. The founder removes posts, comments or whole
   accounts by calling the `moderate` server function with their own sign-in — there is no
   in-app founder screen.
21. **Share and re-share (B28, LOG-8, SOC-6).** The analysis screen's **Share**, and **Share** on
   your own workout posts (Home, your profile), open the **share card**: a 4:5 image of the
   workout — title, volume, sets, duration, new PRs (or the exercises done) — in your unit. Its
   **Share** captures exactly that card to a PNG and opens the phone's share sheet (Instagram,
   Messages, Photos…). It works with no signal. Other people's posts (and re-shares of them) have
   **Re-share**: confirm, and a re-share post goes to your followers' feeds (online only). It shows
   "Re-shared from @them" and their post inside a bordered panel; its votes and comments are its
   own. Re-sharing a re-share passes on the original; twice says you already did. If the original
   becomes private to you, is blocked or muted, or is deleted, the re-share disappears with it.
   Photo posts and other people's posts can't be exported as images.
22. **Export your data and delete the account (B32, NFR-6) — needs a connection.** Settings →
   Account → **Export your data** builds one JSON file of everything the lifter owns that has
   synced — profile, settings, body data, custom exercises (deleted ones too), every workout with
   its exercises and sets, every PR, every analysis, their own posts (photo paths, not the
   pictures) — and opens the share sheet to keep it; the phone's cached copy is deleted after.
   **Delete account** opens a screen naming the signed-in email and what goes; typing **DELETE**
   unlocks **Delete my account**. The server deletes the photo and avatar files, then the login,
   which removes every row of the lifter's (and other people's re-shares of their posts, and
   reports about them). Only after that does the phone sign out and wipe its own copy (database,
   saved preferences, waiting photos). Offline or a server error: a calm line, nothing changes.
   A moderator's account can't be deleted here. (Export does not include programs yet — see
   DEFERRED; account deletion does remove them.)
23. **Build a training program (B34, PRG-1, PRG-2), with no signal needed.** The Workout tab's
   **Your programs** opens the lifter's programs. **New program** asks for a name and opens the
   program's page, which is its editor: rename it, **Add week** ("Week 1…N"), **Add workout** inside
   a week (named, or "Workout N"), remove a week or workout (asks first), or **Delete program**.
   Tapping a workout opens its editor: **Add exercise** uses the logger's picker (any library or own
   custom exercise) and starts it at 3 sets; each exercise has Sets / Reps / weight (kg or lb) /
   RPE boxes and **Save targets**, plus move up / down and remove. Everything saves on the phone at
   once, reopens exactly as left, and syncs to the lifter's other phones; nobody else can see it.
24. **Run a program (B35, PRG-3, LOG-1), with no signal needed.** On the Workout tab, **Start from
   a program** lists the lifter's programs (one with no workouts is shown but can't be picked);
   picking one starts running it at its first session. The tab then shows the program and
   "Next: Week 1 · Day A"; **Start next session** opens the logger on that session — titled
   "Strength Block — Week 1 · Day A", every exercise already added in order, each with a note like
   "Target: 3 × 5 @ 225 lb · RPE 8" (the lifter's unit; no sets are pre-logged). **Finish** moves
   the program to the next session, week by week, in the same save as the workout; finishing the
   last session ends it and the tab goes back to the two start buttons. Discarding a session
   moves nothing. **Start empty workout** stays available during a run and moves nothing.
   **Stop program** (asks first) ends the run; starting a program again begins at Week 1. If the
   program is edited mid-run, the tab offers whatever session now stands at the run's place;
   if the rest of it was deleted, it says there is no next session. The run syncs, so another
   phone of the lifter's shows the same next session.
25. **Teams (B36, TEAM-1, TEAM-2, SOC-10 and YOU-6 Teams parts) — needs a connection.**
   Communities → **Create a team** → a name (1–80 characters) → the new team's page; you are its
   **owner** and it starts **open**. Anyone can find it under **Find teams** and tap **Join**. On
   the team page the owner's **Who can join** switch makes it **Invite only**: then only lifters
   the owner invited (**Invite lifters** → search → **Invite**) can join — they see the invite on
   Communities and as an "N team invites" chip on Home, and **Join** (the invite is used up) or
   **Decline**. Only the owner sees the switch and the server refuses anyone else. Members can
   **Leave**; the owner can't. The page lists the members and the **Team feed** — the members'
   posts as the usual cards, showing only what you could see anyway. An invite-only team you
   aren't in shows just its name. Home shows a **Your teams** chip per team (→ its page), and
   every profile has a **Teams** section of the lifter's teams you may see.
26. **Team coaching (B37, TEAM-3, TEAM-5) — needs a connection.** The owner taps **Make coach**
   on a member's row (and **Remove coach** to undo); the owner always counts as a coach. Coaches
   get **Announce**, **Push a program** and **Push a workout** in the team page's **Coach's
   corner**, where every member sees the pushes newest first. Tapping a pushed program opens it
   (weeks, workouts, targets) with **Save to my programs**; a pushed workout offers **Start this
   workout** (the logger opens prefilled, linked to no program). A coach taps **Assign a program**
   on a member's row; the member sees "Your coach assigned …" → **View** → **Start program**: the
   program is copied into their own programs and becomes their active run (Workout tab); or
   **Dismiss**. Members are told "Coaches of this team can see your training log": a coach opening
   a member's profile sees their whole History — private workouts too — and a row opens the full
   session (`/session/[id]`). Not PRs, posts, photos or body data. A block or leaving ends it.
27. Everything else is a placeholder that renders its final layout with inert controls
   (Marketplace, and the Gyms half of Communities).

## Data path today

- **Accounts:** `src/lib/supabase.ts` builds the one supabase-js client from
  `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `frontend/.env` (template:
  `.env.example`). If either is missing it throws a message naming it, and the root
  `ErrorBoundary` hides the splash so that message shows. The session is saved in expo-sqlite's
  key-value store (`expo-sqlite/kv-store`, the app's one storage engine). The access token
  refreshes only while the app is in the foreground (AppState listener).
- `src/auth/AuthProvider.tsx` owns auth state (`restoring` / `signedIn` / `signedOut`) and the
  sign-in, sign-up and sign-out actions. Screens call `useAuth()` and never touch Supabase
  directly. The route guard, not the screens, does all signed-in/out navigation.
- Sign-up sends the checked birthdate as user metadata. The signup trigger stores it in
  `user_body_data` (owner-only under RLS) alongside the new profile and settings rows.
- **Logger screens (B09).** `app/(tabs)/workout.tsx`, `app/active-workout.tsx` and
  `app/workout/[id].tsx` get the database from `db/useAppDatabase.ts` and the signed-in user
  from `useAuth()`. The one live store sits in a module-level session slot
  (`workout/activeWorkoutSession.ts`), keyed by user id so another account's store is never
  handed out; `workout/useActiveWorkout.ts` subscribes screens to the slot and to the store's
  snapshot (`useSyncExternalStore`). The slot is only a cache: the Workout tab calls
  `resumeSessionWorkout` (→ `loadActiveWorkout`) every time it comes into view, and the logger
  does the same if opened with an empty slot. Every write goes through the store; every read is
  `workout/history.ts` (`listPastWorkouts`, `readWorkout`, `lastSessionSets`, `exerciseInfo`),
  each filtered by the signed-in `user_id`. Weights are shown and typed in the unit from
  `settings/displayUnit.ts` (`useDisplayUnit`, wired to the synced setting by B15 — see below);
  text formatting and box parsing are `workout/format.ts`, conversion is
  `@training-math`. The two new routes are declared in the root layout's signed-in guard.
  Toggling a logged set's warm-up flag calls the store's `updateSet` with
  `setInputFromRow(set)` (`workout/activeWorkout.ts`) plus the flipped flag — the one write path
  for a set; `rpe` and `is_warmup` ride the existing `sets` columns through finish and push.
  **B11:** a drop is an ordinary `logSet` with `dropSetPosition` = `nextDropPosition(sets)` (the
  last set's drop number, 0 for a top set, + 1). The W on a drop set and its top row's remove act
  on every segment at once through `updateSets` / `removeSets` (one transaction each). The link
  toggle calls `linkWithPrevious` / `unlinkFromPrevious`, which first rewrite `superset_group`
  to match what the screen shows, then link or split, saving only the changed entries in one
  transaction. Display grouping is pure and shared by the logger and the saved screen
  (`groupDropSets`, `formatDropSet`, `supersetRuns` / `supersetPlacement` in `workout/format.ts`).
  `sets.score` (device schema V2) and the older `superset_group` / `drop_set_position` /
  `duration_seconds` columns ride `TABLE_COLUMNS` through finish, push and pull — no sync changes.
  **B12:** every title / note box uses `workout/useAutosaveText.ts`: it keeps the box's text,
  calls its store setter ~750 ms after typing stops and again when the box closes or the screen
  leaves, and drops a pending save once the workout is no longer active. Each box joins the
  logger's `AutosaveRegistry` (a React context), and Finish awaits `flushAll()` before
  `store.finish()`, so text typed a moment before Finish is in the finished workout. The setters
  (`setTitle`, `setNotes`, `setEntryNotes`, `setSetNotes`) write through the draft path like
  every other store call; `setSetNotes` reads the set inside the store's one-at-a-time queue, so
  a note never undoes a warm-up flip made just before it. `sets.notes` (device schema V3) joined
  `TABLE_COLUMNS`; `workouts.title` / `notes` and `workout_exercises.notes` were already there —
  no sync changes.
  **B13:** `finish` calls `improvedRecords` (`workout/prs.ts`) inside the store's queue. For each
  exercise in the workout, it reads every set of the user's *finished* workouts (so the draft
  being finished and any stray drafts are left out), appends today's sets from the snapshot, and
  folds them through `@training-math` `recordBooks`. It then compares each book, rounded to 3
  decimals, with the stored row using `beatsRecord`, and keeps only improvements. The rows go to
  `writeLocalTree` with the workout tree, in one transaction. Their ids are
  `uuidv5(PR_RECORD_NAMESPACE, "user:exercise:kind:reps")`, the same on every device. The logger
  card, the saved workout and the history screen all read records through `currentPrs`; the
  history screen also uses `exerciseSessions` (`workout/history.ts`). The new route is declared in
  the root layout's signed-in guard and is pushed from the card's History link. (Since B30 the
  history screen is a thin shell over `components/workout/ExerciseHistorySection`, which the
  Library's exercise detail screen draws too — one reader and renderer, so the two never
  disagree.)
  `personal_records` (device schema V4) joined `TABLE_COLUMNS` and `SYNC_ORDER` after `sets`.
  Pull gained a third bookmark (`pull_cursor:personal_records`, via
  `transport.pullPersonalRecords`) that runs after the workout trees.
  **B14:** `createWorkoutStore` takes a `WritePolicy`. The logger uses `draftPolicy` (unchanged
  behaviour); `openWorkoutForEdit` (`workout/editWorkout.ts`) builds the same store over a
  finished workout with `editPolicy`, which writes through `writeLocalRowsTx` /
  `deleteLocalRowsTx` (queued, touch-the-root), notes the exercises each operation touches
  (looked up before a removal), and ends the operation's transaction with `recomputeRecords` +
  `saveRecomputedRecordsTx` (`workout/prs.ts`). A lowered book is queued as a `delete` line then
  an `upsert` line of the same id; a raised or same-value book as a plain upsert; a vanished book
  as a delete. `deleteWorkout` deletes the tree, queues only the workout's delete (the server's
  FKs cascade), and recomputes in the same transaction. The edit screen is not in the session
  slot; `WorkoutDetailsFields` (title + notes boxes) and `confirmDeleteWorkout` are shared
  components. The saved workout re-reads on `useFocusEffect`. Outbox lines carry `op` (device
  schema V5) with per-op watermarks; push runs a delete phase (`transport.deleteRows`) before the
  upserts; pull reconciles each downloaded workout's tree and finally applies `sync_tombstones`
  (`transport.pullTombstones`, bookmark `pull_cursor:tombstones`), and the engine also applies
  tombstones before each push.
  **B15:** the kg/lb setting. Device schema V6 mirrors `user_settings (user_id, unit,
  updated_at)`; its SQL lives in `db/userSettings.ts` (shared by settings and sync, so sync never
  imports `settings/`). `settings/unitStore.ts` holds the unit in memory: `useSync` calls
  `hydrate(db, userId)` before starting the engine (no row → `lb`), `reset()` on sign-out, and
  passes `applyPulled` to the engine as `onUserSettingsPulled`. The Settings toggle calls
  `setUnit`, which writes the row and an outbox line (`tbl = 'user_settings'`, `row_id` = user
  id; the outbox's table type widened to `OutboxTable`) in one transaction, then re-draws every
  `useDisplayUnit` subscriber and wakes the engine. Push ends with a settings phase
  (`transport.pushUserSettings`: an update by `user_id`, never insert); pull ends with a one-row
  pass (`transport.pullUserSettings`), saved unless a toggle is unsent, then handed to the store,
  which re-reads the row. No weight math moved: `displayWeight` / `lbToKg` in `@training-math`
  remain the only conversion. The You tab lost its email line and Sign out (now in Settings) and
  gained the gear button; `settings` is declared in the root layout's signed-in guard.
- **Tool Kit (B16).** `components/toolkit/ToolKitSheet.tsx` is a React Native `Modal`, not a
  route: the logger (or Workout tab) stays mounted underneath, so closing it restores nothing
  because nothing was lost. The Modal unmounts its contents on close, so each calculator starts
  from `toolkit/session.ts` (a module-level, in-memory record of the last tool and every typed
  box, shared by both entry points, gone on app restart) and writes back to it as the lifter
  types. Boxes are read by `toolkit/inputs.ts` (empty / invalid with a message / ok; lb → kg
  with `lbToKg`; working weights snapped to 2.5 kg / 5 lb via `kgToLb` + `roundToIncrement`);
  answers are formatted by `workout/format.ts` `formatWeight` (`displayWeight`). Every number
  comes from `@training-math`; nothing in the Tool Kit imports sync, transport or Supabase. The
  plate loader alone keeps durable state: `toolkit/plateRack.ts` loads and saves
  `{ version: 1, unit, kg, lb }` under the kv-store key `astra.toolkit.plateRack` — device-only,
  not synced, not per account; a damaged unit's rack falls back to its default, a failed save is
  logged and ignored, and an in-memory cache makes reopening instant. Limits there (≤ 20 per
  side, ≤ 12 sizes, plates and bar ≤ 100, target ≤ 2000, in the rack's unit) bound the solver's
  work.
- **Tool Kit timer (B17).** `components/toolkit/TimerScreen.tsx` only draws; the one timer lives
  in `toolkit/timerStore.ts`, a module-level store (read with `useSyncExternalStore`), so it
  keeps running while the Modal is closed. Its state is the per-mode set-up text plus a run of
  three timestamps — `startedAt`, `pausedAt`, `pausedTotalMs` — and `toolkit/timer.ts` derives
  every frame from `Date.now()` (`snapshot`: elapsed or remaining, EMOM round = elapsed ÷
  interval + 1, Tabata work/rest and round). Nothing counts, so a JS runtime frozen in the
  background loses no time; the 250 ms redraw interval runs only while a timer is running and the
  screen is mounted. Start/resume of a finite mode books one local notification at `endsAtMs`
  through `toolkit/timerAlerts.ts` (the only `expo-notifications` import, required lazily and
  guarded; Android channel `timer`; permission asked on first booking; a booking superseded
  while the permission dialog was open, or for a moment already past, books nothing; fixed
  identifier `astra-timer-zero`). Pause and reset cancel it. Nothing cancels at zero: the alert
  firing *is* the at-zero cue, shown in the foreground too by the library's default handler. The
  timer isn't saved anywhere (an app kill loses the run, but the booked alert still fires). It
  makes no network call and isn't synced. Set-up limits: 0–99 min, 0–59 s, above 0:00; rounds
  1–99; Tabata work 1–600 s, rest 0–600 s.
- **On-device store and sync (B07).**
  `src/sync/useSync.ts` runs in the root layout. On launch it opens `astra.db`
  (`src/db/database.ts`: foreign keys on, WAL, migrations by `PRAGMA user_version`). It then seeds
  the 151 library exercises if they are missing, under the same uuidv5 ids as the server
  (`src/library/uuidv5.ts`, the repo's one implementation, which the seed generator imports).
  While someone is signed in, a `SyncEngine` pushes and then pulls on start, on foreground, on
  reconnect (expo-network) and after each local write.
  - **Writes:** every user change goes through the DAO, never raw SQL. Synced changes use
    `writeLocal` (or `writeLocalTree` for a whole workout): it saves the rows, adds outbox lines,
    and re-stamps and queues the parent workout, all in one transaction. The workout still in
    progress uses `writeDraftRows` / `deleteDraftRowsTx` instead: saved immediately, never
    queued, and refused for any finished workout.
  - **Active-workout store (B08; driven by the logger screens since B09):** `src/workout/activeWorkout.ts`.
    `startActiveWorkout` saves a blank public workout (refused while another is unfinished);
    `loadActiveWorkout` rebuilds the signed-in user's unfinished workout from `astra.db` — the
    resume-after-kill path. Each operation (add / remove / reorder exercise, log / fix / remove
    set, repeat last set) first checks the values against the server's set rules
    (`@training-math` `limits.ts`), converts lb to kg rounded to the column's 2 decimals, commits
    one transaction, then re-reads the whole workout from SQLite as its new snapshot — so what the
    app shows is always what the file holds. Operations run one at a time. `finish` stamps
    `ended_at` (never before `started_at`) and queues the workout, entries and sets in one
    transaction, which wakes the sync engine; the store then refuses further changes.
    `discard` deletes the draft, with nothing to un-sync. `subscribe` / `getSnapshot` fit React's
    `useSyncExternalStore`. New row ids are random v4 UUIDs from `expo-crypto` (`src/lib/ids.ts`).
  - **Push:** sends the queued rows' current state as upserts on `id`, parents first, with
    `updated_at` left for the server to stamp. It then re-sends the parent workouts so the server
    stamps them after their contents. Outbox lines are cleared only up to the watermark read
    before sending, so an edit made mid-upload is kept for the next push. A retry can't
    duplicate anything, because the id is the key.
  - **Pull:** fetches the user's own workouts changed after the stored `(updated_at, id)`
    bookmark (rewound 5 s), plus every entry and set inside them. It also fetches exercises,
    scoped by RLS. Each page is saved with its bookmark in one transaction. A row with an unsent
    local edit is never overwritten.
  - **Failures:** they are logged, and whatever didn't upload stays queued. There is no retry
    timer.
- **Post-workout analysis (B18).** The rules live once, in
  `backend/supabase/functions/_shared/analysis/` (`@analysis` in the app — same alias wiring as
  `@training-math`): `buildSummary` (volume via `sessionVolumeKg`, rounded to 3 decimals; total
  and working sets; whole-second duration; the `personal_records` rows citing the workout's sets,
  ordered by set then `compareRecordBooks`, exercise names snapshotted), `pickCopy` (four
  deterministic states; no numbers but a PR count, no units), `NOT_MEDICAL_ADVICE`, and
  `buildAnalysis` (+ `ANALYSIS_ENGINE_VERSION`). The edge function
  `functions/analyze-workout/` is `index.ts` (Deno wiring: caller client from the request's
  token, `auth.getUser`, service-role client for the one upsert) over `handler.ts` (the testable
  logic: 400 bad id, 404 not the caller's own, 422 unfinished, then build + save). On the phone,
  `src/analysis/analysis.ts` reads device SQLite for `localAnalysis`, the mirror row for
  `storedAnalysis`, and picks between them in `analysisForScreen` (pending outbox lines → local;
  else stored unless stale). The engine runs `analysisRequestPass` after every successful pull:
  up to 10 finished workouts with no or a stale analysis and nothing pending, newest first, each
  through `transport.requestAnalysis` (`functions.invoke('analyze-workout')`), the reply saved
  via `saveServerAnalysesTx` (the table is `MirroredTable` but not `SyncedTable`, so nothing can
  queue an upload of it). Pull's fourth bookmark (`pull_cursor:workout_analyses`) follows the
  records; a workout tombstone or a local `deleteLocalRowsTx('workouts')` also drops the
  analysis row. Device schema V7.
- **Muscle map (B19).** The combining rule is `combineMuscleLoads` in
  `_shared/analysis/muscles.ts` (per-muscle maximum, generic string keys, no catalog import).
  `src/analysis/muscles.ts` `sessionMuscleLoads` runs one parameterized query (the user's
  workout ⋈ slots with at least one set ⋈ visible exercises with a slug), looks each slug up in
  the bundled catalog (`ALL_EXERCISES`, id = slug), and combines their `muscles`. The analysis
  screen reads it in the same keyed load as `analysisForScreen`, so the map and the numbers are
  always the same workout's. `components/MuscleMap.tsx` draws two `react-native-svg` figures from
  the shape data in `components/muscleMapPaths.ts` (hand-authored art, replaceable as data).
  Muscle names and order come from `library/muscles.ts` (`MUSCLE_ORDER` the tie-break order,
  `MUSCLE_NAMES` the display names, `rankMuscles` the most-direct-first rule that both the map's
  legend and the Library's exercise detail screen use — moved there in B29). Nothing is stored and
  nothing syncs.
- **Feed and follows (B20).** Other people's data is never stored on the phone, so Home and
  Find lifters read the server directly and keep nothing: no device table, no outbox, no sync
  change. Both screens get the client from `getSupabase()` and the signed-in id from `useAuth()`,
  and pass them to `social/feed.ts` / `social/follows.ts` (client as a parameter, so tests hand
  in `test-utils/fakeSocialClient.ts`, an in-memory fake that actually evaluates `in`, `not`,
  `or()` filter strings, `order` and `limit`). Row-level security decides every visibility
  question: the posts policy calls `private.workout_visible`; since B22 the workout is a plain
  embed (photo posts have none) and `toFeedPost` drops a workout post whose workout RLS withheld.
  Paging is by bookmark
  (`beforeCursorFilter`: older `created_at`, or the same with a smaller `id`), so a post arriving
  mid-scroll never repeats or skips a card; Home's `generation` counter drops answers that land
  after a newer load started, and a ref keeps one next-page request in flight. `PostCard` prints
  through `workout/format.ts` (`formatSet`, `formatDropSet`, `groupDropSets`, `supersetRuns`,
  `workoutDetailsLabel`, new `postDateLabel`) — closing LOG-13's "and the feed" clause.
  `social/names.ts` `personLabels` is the one spelling of a person on a card; Supabase request
  errors throw through the shared `lib/throwIfError.ts` (also used by the sync transport).
  `find-lifters` is declared in the root layout's signed-in guard.
- **Finish to post (B21).** The one place the phone writes social data. Device schema V8 adds
  `flairs` (download-only: `transport.pullFlairs` reads all rows last in `pullChanges`,
  `db/flairs.ts` `replaceFlairsTx` swaps them in one transaction; a failure lands in
  `PullResult.flairsError`, which the engine logs without failing the pull) and `posts` (the
  lifter's own, upload-only). `social/createPost.ts` `createWorkoutPost` writes the row and its
  outbox line in one transaction (`OutboxTable` widened to include `'posts'`), refusing a
  missing / foreign / unfinished workout, a second post, or an unknown flair, then
  `notifyLocalWrite`. `pushPostsPhase` runs after the settings phase: one `transport.pushPost`
  (upsert on id) per pending post, watermark-acknowledged; `PostAlreadyExistsError` (the
  transport's mapping of 23505) deletes the local post via `dao.deletePostsTx`. Deleting a workout
  locally or by tombstone calls `deleteWorkoutPostsTx`. The analysis route reads a `post=1`
  param (set only by `active-workout.tsx`'s finish) to show Next; `post-workout/[id]` is declared
  in the root layout's signed-in guard. Nothing on this path touches the network directly.
- **Photo posts (B22).** Device schema V9 rebuilds `posts` (kind, nullable `workout_id`,
  `image_path`). `social/mediaLimits.ts` is the app's one spelling of the photo limits
  (`MAX_POST_IMAGE_BYTES` = 10 MiB, jpeg / png / webp, `checkPostImage` with the refusal
  sentence; mirrored by hand in the bucket migration). `social/postImages.ts` is the one module
  touching `expo-file-system/legacy`: object path `userId/postId.ext`, the waiting copy in
  `documents/post-images/`, `localPostImageFiles` (exists / remove — `pushOutbox`'s optional third
  argument, faked in tests by `test-utils/fakePostImageFiles.ts`), `uploadFile` (native streamed
  `uploadAsync`, binary body) and `postImageSource` (authenticated URL + headers for `<Image>`).
  `createImagePost` copies then writes row + line in one transaction; `pushPostsPhase` calls
  `transport.uploadPostImage` (the Supabase transport takes the project config from `useSync`,
  reads the session token, sends `x-upsert: true`) before `pushPost`. `FakeServer` grows an
  in-memory bucket (`objects`, `imageUploads`, `requestLog`, `failImageUploads`). `new-post` is
  declared in the root layout's signed-in guard; its picker is `expo-image-picker`.
- **Votes and comments (B23).** Online only, like the feed: no device table, no outbox, no sync
  change. `social/votes.ts` (cast = upsert on `(post_id, user_id)`, clear = delete mine, P0001 →
  the upvote-only refusal; `voteDelta` / `nextVote` for the card's optimistic move),
  `social/comments.ts` (`loadComments`, `addComment`) and `social/commentLimits.ts` (the 500-char
  cap and blank rule — mirrors the `comments.body` CHECK by hand; change together). `loadFeedPage`
  now takes the viewer id: the posts request embeds `my_vote:votes(value)` narrowed by
  `eq('my_vote.user_id', me)`, and a second request reads `post_scores` by the page's post ids
  (PostgREST refused embedding the view, PGRST200). `PostCard`'s footer keeps its score and vote in
  local state, a ref blocks a second tap while one is in flight, and a refused vote steps back by
  the same delta; a fresh feed load resets both to the server's numbers. The fake social client
  grows `votes` / `comments` tables, a computed `post_scores`, the `my_vote` alias filter, `upsert`,
  `.select().single()` after an insert and the upvote-only trigger (P0001). `post-comments/[id]` is
  declared in the root layout's signed-in guard.
- **Feed order and flair filter (B24).** `loadFeedPage(client, me, authors, sort, flairId, after)`:
  Latest reads `posts` exactly as before; Hot reads the `post_hot_scores` view (the hot score's
  one home — the app only echoes it back as the bookmark) with the same `FEED_SELECT` plus
  `hot_score`. The author embed names `profiles!posts_user_id_fkey`, which the view requires
  (PGRST201 otherwise, probed live). A flair adds `eq('flair_id', …)` in either order. Bookmarks
  are tagged `{ sort: 'latest', created_at, id }` / `{ sort: 'hot', hot_score, id }`; a mismatched
  one throws. Home keeps the order and flair each ready list was loaded with, so "load more"
  continues that list, and shows "Loading your feed…" whenever the list on screen doesn't match
  the chips. The choice lives in `social/feedPrefs.ts` (kv-store, per user id, versioned JSON,
  never throws, in-memory cache per user). The fake social client grows a computed
  `post_hot_scores` (same formula, test-only), numeric comparison for number cells, and the
  PGRST201 refusal of an un-hinted `profiles(` embed on the view; feed fixtures carry `flair_id`.
- **Profiles (B25).** Another lifter's profile is read online only, as the viewer (never mirrored):
  `social/profile.ts` — `loadProfileRow`, `loadProfileHeader` (row + `rpc('follow_counts')` +
  my follows row), `loadWorkoutHistory` (keyset on `(started_at, id)` via `beforeStartedFilter`,
  20 a page), `loadProfilePrs`, and `updateProfile` (maps 23505 / 23514 to field messages). The
  own profile reads its History from SQLite (`listPastWorkouts` gained a `before` cursor; the
  Workout tab still lists 100 with none) and its PRs with `allCurrentPrs` — both sides group PRs
  through `workout/prList.ts` (`groupPrs`, record order from `@training-math`). Posts reuse
  `loadFeedPage` with a one-author list. The own identity is warm-cached in the kv-store
  (`social/ownProfileCache.ts`, per user id, no counts). Avatars: `social/avatars.ts` (path
  `<me>/<uuid>.<ext>`, public URL, streamed upload, best-effort DELETE), the cap and check in
  `social/mediaLimits.ts` (`MAX_AVATAR_BYTES`, `checkAvatarImage`), text rules in
  `social/profileLimits.ts` (mirrors the B02 CHECKs). `FEED_SELECT`'s author embed and
  `searchLifters` carry `avatar_url`. `profile/[id]` and `edit-profile` are declared in the root
  layout's signed-in guard. The fake social client grows `workouts` / `personal_records` tables,
  `update` with the profiles unique / CHECK refusals, `not(col, 'is', null)` and
  `rpc('follow_counts')`.
- **Post privacy (B26).** `social/postPrivacy.ts` — `setPostVisibility` (one online update of the
  author's own post, `.select('id')` to learn whether a row changed; never throws), then a local
  mirror of the post and workout rows with no outbox lines, so a later whole-row workout upload
  (B14 edit) carries the new value; the server's `sync_workout_visibility` trigger moves the
  workout itself. `visibilityTargetOf` / `withPostVisibility` let Home and ProfileView rewrite
  their stored lists after success. `VISIBILITY_WORDS` / `VISIBILITY_ORDER` are the one spelling
  of the three audiences (card chip, Settings chips, Share a photo's line). The settings row
  gained `progress_pic_visibility` (device V10): `db/userSettings.ts` adds `parseVisibility`
  (unknown → `private`, fail closed) and `patchUserSettingsTx` (read-merge-write, so the unit
  toggle and the privacy choice never undo each other); `settings/privacySettings.ts` reads and
  saves it (one transaction + outbox line); `transport.pushUserSettings` now carries both fields.
  `createImagePost` reads the choice for progress pics (`imagePostVisibility`), so posting stays
  offline. `ChoiceChips` moved to `components/ui/`. The fake social client answers
  `update(…).select()` with the changed rows; the fake server no longer imitates the dropped CHECK.
- **Export and account deletion (B32).** Two edge functions, both `verify_jwt` on, split into
  `index.ts` wiring and a dependency-injected `handler.ts` (tests: `functions/tests/
  export_data.test.ts`, `delete_account.test.ts`). `export-data` uses only the caller's token:
  `readOne` for the one-row tables and `readPage` (id-ordered `range`) for the rest, with the
  handler doing all paging and id-chunking so its tests prove nothing is cut at the API's
  1000-row cap; every owner read is filtered by the caller's id (RLS alone would let public
  workouts of others through). `delete-account` uses the service role after `getUser`: sweep
  `<uid>/` in `post-images` and `avatars`, then `auth.admin.deleteUser`, whose cascade through
  `profiles` removes every user-owned table (checked live, rolled back). App side:
  `account/functionCalls.ts` (`callFunction`: FunctionsFetchError → offline, FunctionsHttpError →
  status) under `account/exportData.ts` and `account/deleteAccount.ts`; `app/delete-account.tsx`
  is declared in the root layout's signed-in guard; `db/wipeDevice.ts` runs the device wipe.
  `db/database.ts` gained `createDatabaseHolder` (the singleton, now a testable factory) and
  `deleteAppDatabase`; `SqlDriver` gained an optional `closeAsync` that waits its turn in the
  serialising queue. `social/postImages.ts` exports `localPostImagesFolder` for the wipe.
- **Still unwired:** follower / following counts don't open lists; another lifter's workout rows
  on a profile aren't tappable; there is no "remove photo"; the Library's catalog cards come from the bundle, not `astra.db` (only Your exercises reads it, B31); a custom can't be created from inside the logger's picker; customs add nothing to the muscle map; posts can't be
  edited, deleted or re-offered from old workouts (photo posts can't be deleted either, so their
  storage objects are never removed); feed cards don't
  open a detail screen; comments can't be deleted from the app (the RLS allows your own) and
  aren't paged past 200; the muscle map appears only on the analysis screen; Settings has no
  Notifications section (B47); body data has a statement but no visibility control (it has no
  reader yet); there is no per-workout visibility control or default-workout-visibility setting
  (new workouts are born public).

## Shared pieces every screen uses

- `components/Screen.tsx` and `components/AppBackground.tsx` wrap each screen in the common chrome.
- `components/AstraTabBar.tsx` defines the five tabs once (route, label, icon) and renders the bar.
- `components/ProfileButton.tsx` is the floating route to You.
- `components/ui/` holds Button, Card, EmptyState, Text, TextField (labeled input), FormError
  (red alert line) and (moved from the Tool Kit at B26) ChoiceChips (a radio-group chip row, can
  be locked with `disabled` — Tool Kit, Home, profile tabs, Settings, the post visibility
  chooser), all styled from `theme/tokens.ts`.
- `components/share/` (B28) holds ShareCard (the workout image card the share-card screen previews and captures; pure, props in). `social/reshare.ts` (B28) makes re-shares.
- `components/social/` (B20) holds PostCard (one feed post — a workout, or since B22 a photo; since B23 with the vote / comments footer; since B25 a tappable author; since B26 the owner-only visibility chip; since B27 a ⋯ report button on other people's cards; since B28 re-share cards with the original embedded, Re-share on others' cards and Share on own workout cards), ReportSheet (B27: the report panel for a post or comment), UserCard (a person + FollowButton; since B25 tappable to their profile),
  FollowButton (B25: Follow / Following, optimistic with revert, `onSettled` after an accepted
  change), Avatar (B25: the public-bucket photo, else LetterAvatar — the initial badge),
  and `usePostPhotoSource` (B25: the viewer-token photo fetch Home and profiles share).
- `components/profile/ProfileView.tsx` (B25) is the whole profile body, used by the You tab and
  `profile/[id]`; since B36 it shows the lifter's Teams section.
- `components/social/usePostListActions.ts` (B36) is the one wiring of a post card's buttons
  (vote, report, audience chip, re-share, Share card, comments, author) — Home, ProfileView and the
  team page all use it.
- `components/teams/TeamListItem.tsx` (B36) is one team row (name, "Open" / "Invite only", an
  optional role, optional Join / Decline buttons) for Communities and the profile.
- **Teams** (B36): `social/teams.ts` is the one home of team reads and writes — online only, like
  votes; teams are never stored on the phone, so no device table, outbox or sync change. Every
  rule (who may join, switch, invite, leave, see a roster) is the server's RLS; the module maps
  refusals to sentences and retries "am I already a member?" after a refused join (a double tap on
  an invite-only team). The Team feed is `loadFeedPage` with the roster's ids. Since B37 it also
  has `setMemberRole` and `isCoachRole`.
- **Team coaching** (B37): `social/teamCoaching.ts` is the one home of pushes, assignments and the
  two payload functions (online only). `components/teams/useTeamCoaching.tsx` is the team page's
  coaching state and actions; `CoachPushSheet` and `TeamProgramSheet` are its two modals, and it
  reuses `ProgramPickerSheet` in its `onPick` mode. `programs/copyProgram.ts` turns a payload into
  a member-owned program in one transaction (the only new write path is the ordinary
  `writeLocalRowsTx`); `workout/startPushedWorkout.ts` starts one pushed workout in the logger.
  `app/session/[id].tsx` is the read-only, online view of anyone's workout the server lets you see.
- `components/auth/` holds SignInForm, SignUpForm, BirthdateInput and their shared layout styles.
  The route files in `app/(auth)/` only wire them to the router.
- `components/workout/` holds EntryCard (one exercise in the logger), ExercisePicker (the
  Add-exercise modal), WorkoutListItem (a past-workout row), WorkoutDetailsFields (the title +
  notes boxes, shared by the logger and the edit screen), `confirmDiscardWorkout` (the one
  "Discard this workout?" alert) and `confirmDeleteWorkout` (the one "Delete this workout?"
  alert, B14).
- `components/library/` (B31) holds CustomExerciseForm (the New / Edit exercise modal),
  CustomPill (the "Custom" label) and `confirmDeleteCustomExercise` (the "Delete this exercise?"
  alert). `library/customExercises.ts` is the one home of custom-exercise reads and writes (and
  the only place deleted customs are filtered out); `library/useCustomExercises.ts` is the
  focus-refreshed read the Library tab and both logging screens share.
- `components/toolkit/` (B16, B17) holds ToolKitSheet, the four calculators (OneRmCalculator,
  RpeCalculator, IntensityCalculator, PlateLoader), TimerScreen, and their shared pieces:
  ChoiceChips (now in `components/ui/`), NumberField / WeightField (labeled number box + inline error, the
  weight one naming its unit) and ResultCard (the big answer + second line).
- **Training math** (`backend/supabase/functions/_shared/training-math/`, imported in the app as
  `@training-math`) is the only place e1RM, RPE and %1RM working weights, plate breakdowns, kg/lb
  conversion, PR detection and session volume (`volume.ts`, external load only, warm-ups
  excluded; shown on the analysis screen since B18) are computed. It lives beside the server functions so Supabase can
  bundle it; `frontend/metro.config.js`, `tsconfig.json` and `jest.config.js` map the alias.
  Weights go in and come out in kg (the plate loader alone works in the rack's own unit); rounded
  display numbers are never stored. `limits.ts` holds the server's rules on a set and the
  storage rounding that matches the server's column decimals. Its callers today are the
  active-workout store, the logger's display (`displayWeight` via `workout/format.ts`) and the
  Tool Kit calculators (B16); post-workout analysis is still to come.
- Test-only helpers live in `src/test-utils/`: a fake Supabase auth client and fake AppState,
  `renderWithAuth`, a real-SQLite driver over Node's `node:sqlite` (`nodeSqliteDriver.ts`), an
  in-memory fake server for sync (`fakeTransport.ts`: upsert-by-id, server-stamped `updated_at`,
  foreign-key refusals, the PR keep-best rule, cascading deletes that write tombstones (B14),
  an update-only `user_settings` row (B15), offline and lost-reply modes), workout fixtures, the
  fake social client and feed fixtures (B20: `fakeSocialClient.ts`, `feedFixtures.ts`), and the logger kit
  (`loggerTestKit.tsx`: prepared database, test clock, signed-in render). The app never
  imports them.
