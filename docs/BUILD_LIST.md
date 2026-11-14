# Astra — Build List

Every buildable feature from `Astra-PRD.pdf` (Draft v1.1), with current status and a definition of done. Update the Status column as work lands; a feature is only **Done** when its definition of done is observably true in the app.

**Statuses:** `Not started` → `In progress` → `Built` (code complete) → `Done` (definition of done verified).
**Phases:** P0 = Phase 1 (log and share), P1 = Phase 2 (programs and groups), P2 = Phase 3 (gyms and recovery). All ship in the first release; the phase sets build order only.

As of Nov 14, 2026 the app foundation exists (`ui-foundation` branch): Expo SDK 58 scaffold, theme
module from `docs/styling_guide.md`, six-tab custom navigation, and designed placeholder screens.
Everything else is `Not started`.

## Foundation (prerequisites, derived from the PRD's Technology section)

These aren't numbered PRD requirements, but nothing below ships without them.

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| FND-1 | Expo/React Native app scaffold (TypeScript) | P0 | Built | One codebase builds and runs on an iOS and an Android device/simulator |
| FND-2 | Supabase project: Postgres schema, auth, storage, RLS baseline | P0 | In progress | A user can create an account, sign in on both platforms, and rows are protected by row-level security |
| FND-3 | On-device SQLite store with server sync | P0 | Not started | A workout logged in airplane mode appears on the server after reconnecting, with no data loss or duplicates |
| FND-4 | Navigation: five-tab bottom bar (Home, Marketplace, Workout center, Communities, Library) + persistent top-right You/profile button (founder revision Nov 14, 2026, from the PRD's six tabs) | P0 | Built | All six destinations are reachable on both platforms without an iOS "More" overflow |

## Workout logging (LOG)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| LOG-1 | Start workout: empty or next session of a saved program | P0 | Not started | The Workout button starts a blank workout, and starts the correct prefilled next session when a program is active |
| LOG-2 | Add exercises from the library, log sets with reps and weight | P0 | Not started | A full multi-exercise session can be logged and saved, and reopens with every set intact |
| LOG-3 | Notes on a set, an exercise or the whole workout | P0 | Not started | Notes at all three levels save with the workout and show when it is reviewed |
| LOG-4 | Full per-exercise history and automatic PR detection (true 1RM, rep max at any rep count, estimated 1RM; volume excluded) | P0 | Not started | Logging a qualifying set flags a PR of the right type automatically; a volume-only improvement never flags one |
| LOG-5 | "Last time" shown per exercise while logging | P0 | Not started | Each exercise in an active workout shows the sets from the previous session of that exercise |
| LOG-6 | kg/lb entry, set per user | P0 | Not started | Switching units converts display everywhere without corrupting stored data |
| LOG-7 | Finish → analysis → offer to post with a flair | P0 | Not started | Completing a workout always opens its analysis, then a post flow with flair selection that can be skipped |
| LOG-8 | External share card (image, Strava-style) | P0 | Not started | A completed workout exports as an image card to the OS share sheet and posts legibly to other apps |
| LOG-9 | Edit or delete past workouts; PRs and trends recalculate | P0 | Not started | Editing or deleting a past workout corrects all affected PRs, history and trends |
| LOG-10 | Optional RPE per set, feeding intensity analysis | P1 | Not started | A set can carry RPE; the intensity analysis uses it when present and still works when absent |
| LOG-11 | Supersets | P0 | Not started | Exercises can be grouped into a superset, logged and displayed as one |
| LOG-12 | Drop sets with each drop's weight and reps | P0 | Not started | A drop set records every drop and shows them as one set in history |
| LOG-13 | Timed / WOD-style work logged with a time or score | P0 | Not started | A WOD entry saves with a time or score instead of sets × reps and shows correctly in history and the feed |
| LOG-14 | Warm-up sets, excluded from PRs and volume | P0 | Not started | A set marked warm-up never counts toward a PR or session volume |
| LOG-15 | Bodyweight exercises | P0 | Not started | Pull-ups and similar movements can be logged without a weight and still track history and PRs |

## Workout Tool Kit (TK)

Opens from the active workout in one tap and closes without losing the user's place.

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| TK-1 | 1RM calculator (Epley: weight × (1 + reps ÷ 30)) | P0 | Not started | Returns the Epley estimate for any weight/reps input, in the user's units |
| TK-2 | RPE calculator (target reps + RPE → working weight) | P0 | Not started | Returns a working weight for any reps/RPE pair |
| TK-3 | Intensity calculator (%1RM → working weight) | P0 | Not started | Returns a working weight for any percentage input |
| TK-4 | Plate loader (plates per side, given bar and available plates) | P0 | Not started | Shows a correct per-side plate breakdown for any target weight, bar weight and plate inventory |
| TK-5 | Rest timer and stopwatch: CrossFit-wall-timer style; count-up, countdown, EMOM, AMRAP, Tabata; runs in background | P0 | Not started | All five modes work and keep accurate time while the app is backgrounded, on both platforms |
| TK-6 | Calculator prefill from current exercise and stored PRs | P1 | Not started | Opening a calculator mid-workout arrives prefilled from the exercise in progress and the user's PRs |

## Post-workout analysis (ANA)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| ANA-1 | Analysis generated on completion, attached to the workout | P0 | Not started | Every completed workout has an analysis that reopens from that workout forever |
| ANA-2 | Session summary: total volume, sets, duration, new PRs | P0 | Not started | The summary's numbers match the logged data exactly, including PRs flagged that session |
| ANA-3 | Muscle map of the session | P0 | Not started | A body diagram highlights the muscle groups actually trained, driven by the exercises logged |
| ANA-4 | Motivational, encouraging tone — including after a poor session | P0 | Not started | Copy review confirms no shaming or negative framing in any analysis state |
| ANA-5 | Volume/intensity compared against the user's own trend | P1 | Not started | The analysis shows this session against the user's rolling history once enough data exists |
| ANA-6 | Deload suggestion from accumulated-fatigue trend (rules TBD) | P1 | Not started | With rules defined and implemented, a fatigue-pattern fixture triggers the suggestion and a normal pattern does not |
| ANA-7 | Next-session intensity recommendation | P1 | Not started | Every analysis with sufficient history includes a concrete intensity recommendation for the next session |
| ANA-8 | "Left on the table" estimate when recovery data exists | P2 | Not started | Shown only when recovery data exists; absent otherwise with no errors |
| ANA-9 | Next-day recommendations when recovery data exists | P2 | Not started | Same gate as ANA-8; recommendations reference the recovery inputs that drove them |
| ANA-10 | Every performance-impact figure cites a published source, worded as an estimate | P2 | Not started | No numeric performance claim appears anywhere without a citation and estimate wording (the "10% hydration" placeholder stays out until sourced) |
| ANA-11 | Analysis is scripted rules — no AI model | P0 | Not started | The analysis pipeline contains no model inference; it is deterministic server-function code |

## Recovery inputs (REC) — all optional; analysis works fully without them

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| REC-1 | Nutrition: calories and macros, MacroFactor-depth; quick entry, full food database, barcode scanning | P2 | Not started | A meal can be logged by quick entry, database search or barcode, and daily totals are correct |
| REC-2 | Hydration against a daily target | P2 | Not started | Fluid intake logs against a user-set target with a visible daily running total |
| REC-3 | Sleep duration, logged by hand (no imports in release one) | P2 | Not started | Sleep can be logged manually; no wearable/health-platform code ships |
| REC-4 | Per-input opt-in, opt-out and data deletion | P2 | Not started | Each input toggles independently, and switching one off can delete its data on request |

## Exercise library (LIB)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| LIB-1 | Library tab: every exercise as a card, with search and muscle/equipment filters | P0 | In progress | Any launch exercise is findable by name, muscle group or equipment in a few taps — cards, name search and body-region chips live (`launch-library-seed`); per-muscle and equipment filters pending |
| LIB-2 | Demo video on every card | P0 | Not started | Every launch exercise card plays its demo video (founder films any still missing) |
| LIB-3 | Muscle groups and coaching cues on the card | P0 | Not started | Every card lists muscles worked and its imported coaching cues |
| LIB-4 | User's PRs and full history on the card | P0 | Not started | A card shows that user's complete logged history and current PRs for the movement |
| LIB-5 | Custom exercises become private cards with the same data | P0 | Not started | A user-created exercise gets a card, collects history/PRs, and is invisible to other users |
| LIB-6 | Strength-level grade against published standards | P1 | Not started | Cards grade the user's 1RM against Strength Level standards using sex, bodyweight and age — blocked on the data licence |
| LIB-7 | Launch library imported from the founder's library (~100 exercises, cues included) | P0 | Built (videos pending) | The founder's library is imported as seed data with videos and cues attached — 151 exercises with cues imported to `frontend/src/library/` (`launch-library-seed`); videos wait on the video-service choice (LIB-2) |

## Social feed (SOC)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| SOC-1 | Home feed of followed accounts, newest first | P0 | Not started | Home shows followed users' posts in reverse-chronological order by default |
| SOC-2 | Post types: completed workout, progress pic, form-check video, PR | P0 | Not started | All four post types can be created, uploaded and rendered in the feed |
| SOC-3 | One flair per post (launch set: WOD, Physique Check, New PR, Form Check; extensible) | P0 | Not started | Every post carries exactly one flair; the flair list is data, not code |
| SOC-4 | Up/down votes with net score; Physique Check is upvote-only | P0 | Not started | Votes tally correctly, and no downvote control exists on Physique Check posts |
| SOC-5 | Comments | P0 | Not started | Users can comment on any visible post and see others' comments |
| SOC-6 | Share posts inside Astra and to other platforms | P0 | Not started | A post can be re-shared in-app and exported to the OS share sheet |
| SOC-7 | One-way follows; profiles show follower/following counts | P0 | Not started | Following is one-directional with no mutual-friend state, and counts are accurate |
| SOC-8 | Report a post/comment; block and mute | P0 | Not started | Reports land in the moderation queue; blocked and muted users' content disappears for the actor (block also cuts DMs) |
| SOC-9 | Filter the feed by flair | P1 | Not started | Selecting a flair shows only matching posts |
| SOC-10 | Team and Gym feeds surfaced on Home | P1 (Teams), P2 (Gyms) | Not started | A member's Team and Gym feeds are reachable from Home alongside the main feed |
| SOC-11 | Ranked sort by votes (Reddit-style), switchable | P0 | Not started | The user can toggle between chronological and ranked order and the choice persists |
| SOC-12 | Direct messages; default anyone-can-message, limitable to mutual follows; blocking blocks DMs | P1 | Not started | DMs deliver in real time, the privacy setting is enforced server-side, and blocked users cannot message |

## Program builder (PRG)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| PRG-1 | Build a custom program from library exercises with sets, reps and target load | P1 | Not started | A complete program can be authored from any library (or custom) exercises |
| PRG-2 | Programs organized as workouts within weeks | P1 | Not started | The builder enforces the week → workout → exercise structure and renders it on the program page |
| PRG-3 | Saved program loads into the logger; Workout button starts the next session prefilled | P1 | Not started | Running a program, each tap of Workout opens the correct next session with targets prefilled, advancing week by week |
| PRG-4 | Program visibility: private, shared with friends or a Team, or published to the Marketplace | P1 | Not started | All three visibility levels are enforced server-side |

## Workout Marketplace (MKT)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| MKT-1 | Browse and search published programs | P1 | Not started | Any published program is findable by search and browse |
| MKT-2 | Featured section: most popular by week, month, year, all time | P1 | Not started | All four windows rank by popularity and update as votes change |
| MKT-3 | Vote and comment on programs | P1 | Not started | Programs take up/down votes and comments exactly as feed posts do |
| MKT-4 | Program page: author, length, days per week, full workout breakdown | P1 | Not started | A program page shows all four facts plus every workout's contents |
| MKT-5 | Save a program and start running it from its page | P1 | Not started | One action from the program page saves it and makes it the active program in the logger |

## Teams (TEAM)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| TEAM-1 | Anyone can create a Team; open-join by default, switchable to invite-only | P1 | Not started | Both join modes work and only the creator can switch them |
| TEAM-2 | Team activity feed, reachable from Home | P1 | Not started | Members' activity appears in the Team feed and the feed is linked from Home |
| TEAM-3 | Coach can push programs, workouts and announcements, and assign a program to a member | P1 | Not started | Pushed content reaches all members; an assigned program becomes that member's active program |
| TEAM-4 | Owners can remove members and moderate the Team feed | P1 | Not started | Removal and feed moderation work and are restricted to owners |
| TEAM-5 | Coach can see Team members' training logs | P1 | Not started | A coach can open any member's log history; non-coaches cannot |

## Gyms (GYM)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| GYM-1 | Gym directory by location — every public gym within 50 miles of downtown Denver at launch | P2 | Not started | The directory lists the Denver-area set sorted by distance from the user (PostGIS query); blocked on a gym data source |
| GYM-2 | Join any Gym, no proof of membership, one active Gym; each Gym has a feed reachable from Home | P2 | Not started | Joining a second Gym switches the active one; the Gym feed works like a Team feed |
| GYM-3 | CrossFit-style leaderboard: top PR per member for squat, bench press and deadlift | P2 | Not started | Each ranked exercise shows one row per member — their best verified PR |
| GYM-4 | PR submission requires video; true 1RM only (no rep max or estimate) | P2 | Not started | A submission without video, or of a non-1RM PR, is impossible through UI and API |
| GYM-5 | Community verification: thumbs-up only, threshold two from other members within one week (number TBD) | P2 | Not started | A submission verifies at the threshold, cannot be approved by its submitter, and has no vote-against |
| GYM-6 | Only the best verified PR per member per exercise appears | P2 | Not started | A newly verified PR replaces that member's previous best on the board |
| GYM-7 | Gym pages are community-run; owners cannot claim or manage them | P2 | Not started | No claim/manage flow exists anywhere |
| GYM-8 | Leaderboards split by sex only (every user picks male or female); absolute ranking, no weight or age classes | P2 | Not started | Each board renders exactly two divisions ranked by absolute weight |
| GYM-9 | Switching Gyms: verified PRs stay on the old board and do not move | P2 | Not started | After a switch, old-board entries persist and the new board starts empty for that member |
| GYM-10 | Pending-submission flow in the Gym feed with one-week expiry (PR verification flow) | P2 | Not started | Pending submissions appear in the feed, expire unverified after seven days, and never reach the board |

## You — profile (YOU)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| YOU-1 | Profile: photo, name, bio, follower and following counts | P0 | Not started | All five render on every profile |
| YOU-2 | User's posts and full workout history on the profile | P0 | Not started | The complete history is browsable from the profile, respecting post privacy |
| YOU-3 | PRs by exercise | P0 | Not started | The profile lists current PRs per exercise, matching LOG-4's records |
| YOU-4 | Settings: units, notifications, account, privacy | P0 | Not started | All four settings areas exist and take effect immediately |
| YOU-5 | Visibility controls: public-by-default account, any single post can be made private | P0 | Not started | A private post is invisible to everyone but its author, enforced server-side |
| YOU-6 | Profile shows the user's Teams and Gym | P1 (Teams), P2 (Gym) | Not started | Memberships render as links to the group pages |
| YOU-7 | Strength-level grades and long-term trends on the profile | P1 | Not started | Grades (once LIB-6 unblocks) and long-term trend charts render from real history |

## Non-functional requirements (NFR)

| ID | Feature | Phase | Status | Definition of done |
|---|---|---|---|---|
| NFR-1 | Offline logging and Tool Kit, syncing on reconnect | P0 | Not started | A complete workout logged in airplane mode syncs intact when back online |
| NFR-2 | Repeat a set in one tap | P0 | Not started | Logging a set identical to the previous one is exactly one tap |
| NFR-3 | In-progress workout survives app close, phone call or dead battery | P0 | Not started | Force-killing the app mid-workout loses nothing on relaunch |
| NFR-4 | Media size/length limits, background upload | P0 | Not started | Over-limit uploads are rejected with a clear message; accepted ones upload while the user keeps using the app |
| NFR-5 | Progress pics, body data and recovery data treated as sensitive | P0 | Not started | User-set visibility on all three, enforced by row-level security |
| NFR-6 | Export training data; delete account and content | P0 | Not started | Export produces the user's complete training data; deletion removes account and content |
| NFR-7 | Moderation: content policy, report queue, removal tools (founder-run at launch) | P0 | Not started | A published policy exists, reports queue for the founder, and content/accounts can be removed |
| NFR-8 | 18+ age gate at signup | P0 | Not started | Signup cannot complete for anyone under 18 |
| NFR-9 | Not-medical-advice statement on analysis and nutrition | P0 | Not started | The statement appears on every analysis and nutrition surface |
| NFR-10 | Accessibility: screen readers, dynamic text, contrast | P1 | Not started | Core flows pass a VoiceOver/TalkBack walkthrough, honor dynamic text sizes, and meet contrast minimums |
| NFR-11 | iOS and Android at launch, feature-identical | P0 | Not started | Every Done feature above is verified on both platforms |

## External blockers

| Blocker | Blocks | Status |
|---|---|---|
| Strength Level data licence | LIB-6, YOU-7 (grades) | Source chosen, licence not obtained |
| Food/nutrition database choice | REC-1 | Not chosen |
| Denver gym list data source | GYM-1 | Not chosen |
| Video service choice (Mux assumed) | SOC-2, GYM-4, LIB-2 at scale | Not chosen |
| Deload/next-session rules | ANA-6, ANA-7 | TBD, to be set later in the build |
| Cited evidence base | ANA-8–10 | Not started |
