# Astra — Project Overview

Source of truth: `Astra-PRD.pdf` (Draft v1.1, Nov 14, 2026). This file is the working summary; when the two disagree, the PRD wins.

## What Astra is

Astra is a social strength-training app: a workout logger whose completed sessions feed a community of lifters, the way Strava does for runs.

**Positioning:** Strava for strength training. Strava owns endurance; Astra aims to own the barbell.

Workout logging is the core feature. Everything else builds on the data it produces:

- **Social feed** — completed workouts, progress pics, form checks and PRs, tagged with Reddit-style flairs, newest first with an optional ranked sort by votes.
- **Post-workout analysis** — volume and intensity trends, deload and next-session recommendations, and a muscle map of each session. Rule-based scripts, no AI model.
- **Exercise library** — every exercise as a card with a demo video, coaching cues, personal history and a strength-level grade.
- **Workout Marketplace** — user-built programs anyone can browse, vote on and run. Sharing only; no payments at launch.
- **Communities** — Teams for accountability and coaching, and Gyms with video-verified PR leaderboards (launch coverage: public gyms within 50 miles of downtown Denver).

## The core loop

Log a workout → get an analysis that says what the session meant → post it to the feed → get a reaction. Logging must be fast enough to use between sets with one hand, and must work fully offline.

## Who it's for

Every level, from someone who has never been in a gym to elite athletes, plus coaches and program creators. Personas: first-timer, newer lifter, dedicated lifter, competitive/elite athlete, coach or trainer, program creator, gym community lead. The range is confirmed; persona details are proposed and still need validation.

## Goals

1. Be the fastest, most complete way to log a strength session.
2. Make every completed workout worth sharing, inside Astra and on other platforms.
3. Turn logged data into guidance a lifter can act on the next day.
4. Give lifters accountability through Teams and local competition through Gyms.
5. Become the default place to find, share and run strength programs.

## Non-goals

- Cardio and GPS activity tracking (Strava covers it).
- Medical, clinical or dietary advice — analysis is guidance, not diagnosis.
- Live coaching or video calls.
- In-app payments and monetization — the business model is deferred until the product proves itself.

## Scope and build order

**Every feature in the PRD ships in the first release** (confirmed by the founder Nov 14, 2026). The build is sequenced in three phases so a working app exists at the end of each. Priorities map to phases: P0 = Phase 1, P1 = Phase 2, P2 = Phase 3 — the labels set build order only, not cut lines.

| Phase | Theme | What gets built |
|---|---|---|
| 1 | Log and share | Workout logging, Workout Tool Kit, exercise library with custom exercises, session summary with muscle map, profile, feed with flairs/votes/comments/follows, external share cards |
| 2 | Programs and groups | Program builder, Workout Marketplace, Teams, trend-based analysis with deload and next-session recommendations, strength-level grades |
| 3 | Gyms and recovery | Gym directory, gym feeds, video-verified PR leaderboards, nutrition/hydration/sleep tracking, recovery-aware analysis, coach tools |

Platforms: iOS and Android at launch, same features on both, built by the founder. Target launch date TBD.

See `docs/BUILD_LIST.md` for every buildable feature with status and definition of done.

## Success metrics (targets not yet set)

North star: **weekly active loggers**. Also tracked: workouts per active user per week, share rate, day-30 retention, analysis open rate, Marketplace program starts per month, verified PRs per active Gym per month. Each needs a number and a date before build starts.

## Key product decisions (founder-confirmed, Nov 14, 2026)

- **PRs:** true 1RM, rep maxes and estimated 1RM (Epley) all count; volume does not. Gym leaderboards accept true 1RM only, backed by video.
- **PR verification:** two thumbs-up from other Gym members within one week, thumbs-up only (final threshold TBD). Verified PRs stay on the old Gym's board when a member switches.
- **Feed:** chronological by default, Reddit-style ranked sort optional. One flair per post (launch set: WOD, Physique Check, New PR, Form Check). Physique Check posts take upvotes only — downvotes are off for that flair.
- **Follows:** one-way, as on Strava/Instagram. No mutual-friend state.
- **Privacy:** accounts public by default; any single post can be made private. Progress pics, body data and recovery data are sensitive, visibility set by the user.
- **Gyms:** anyone can join any Gym, one active Gym at a time, pages are community-run (owners cannot claim them). Leaderboards split by sex only; launch exercises are squat, bench press, deadlift.
- **Custom exercises:** private to their creator; used in aggregate to decide what joins the shared library.
- **Analysis:** scripted rules only, encouraging tone, every performance-impact figure cites a published source and is worded as an estimate.
- **Minimum age:** 18.
- **Launch library:** ~100 exercises imported from the founder's library, cues included; founder films missing videos.

## Biggest risks

1. **Scope breadth** — one founder, two platforms, full feature set in release one. Mitigation: strict phase order; revisit launch scope if the timeline slips.
2. **Social cold start** — mitigated by making logging valuable alone and concentrating Gyms in Denver.
3. **Leaderboard vote manipulation** — two approvals is a low bar; threshold and a challenge mechanism to be revisited.
4. **Video cost** — length caps, compression, retention rules.

## Open questions (from the PRD)

Launch date; metric targets; deload/next-session rules; food database choice; final PR threshold and whether verified PRs can be challenged; Denver gym data source; Strength Level licensing terms; count of missing exercise videos.
