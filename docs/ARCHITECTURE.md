# Astra — Architecture

Source of truth: the Technology section of `Astra-PRD.pdf` (founder-confirmed Nov 14, 2026). Astra borrows Strava's product ideas but not its stack: one codebase per layer, managed services in place of anything that has to be operated, and nothing added until a measured problem calls for it.

## Guiding principles

1. **One founder, two platforms** — a single React Native codebase ships iOS and Android with identical features (NFR-11).
2. **Offline-first** — logging and the Tool Kit must work with no signal and sync when the connection returns (NFR-1). The phone is the primary store during a workout; the server is the system of record afterward.
3. **One service to run** — Supabase is the entire backend. No microservices, no Kubernetes, no self-operated infrastructure.
4. **Rule-based analysis** — the post-workout analysis is scripted rules in server functions. No machine-learning model anywhere at launch (ANA-11).
5. **Add infrastructure only on evidence** — e.g. Redis only when leaderboard queries measurably slow down.

## The stack

| Layer | Choice | Why |
|---|---|---|
| Mobile apps | React Native with Expo, TypeScript (Flutter is the fallback) | One codebase ships both platforms; two native apps double the work |
| On-device data | SQLite on the phone, synced to the server | Logging must work offline (NFR-1) and survive the app dying mid-workout (NFR-3) |
| Backend | Supabase: managed Postgres with auth, file storage, realtime and server functions | Sign-in, storage and messaging come built in; one service to run |
| API | Supabase's generated API and client library | Nothing to hand-build for standard reads and writes |
| Database | PostgreSQL only | One database covers accounts, workouts, feed and leaderboards at launch scale |
| Geospatial | PostGIS in the same database | Answers "gyms within 50 miles of downtown Denver"; gyms render as a distance-sorted list, no maps |
| Search | Postgres full-text search | Library and Marketplace are small at launch |
| Messaging / realtime | Supabase Realtime | Carries direct messages and live feed updates |
| Video | A managed video service such as Mux (not yet chosen) | PR videos, form checks and tutorials need upload, encoding and streaming |
| Push notifications | Apple and Google push services through Expo | Platform defaults |
| Hosting | Managed hosting only | Nothing to operate |
| Analysis engine | Scripted rules in Supabase server functions | Matches the rule-based decision |
| Data processing | None — query Postgres directly | No data volume to justify more yet |
| Payments, health sync, watch apps, maps | Out of scope at launch | Business model deferred; sleep is logged by hand; no routes to draw |

## How the pieces fit

```
┌─────────────────────────────────────┐
│  Expo / React Native app (TS)       │
│  ┌───────────────────────────────┐  │
│  │ SQLite — active workout,      │  │   offline log → sync on reconnect
│  │ queued posts, cached library  │──┼──────────────┐
│  └───────────────────────────────┘  │              ▼
└─────────────────────────────────────┘   ┌──────────────────────────┐
         │ Supabase client library        │  Supabase                │
         ▼                                │  Postgres (+ PostGIS,    │
   auth · reads/writes · realtime ◄──────►│  full-text search)       │
   subscriptions (DMs, feeds)             │  Auth · Storage ·        │
                                          │  Realtime · Functions    │
┌─────────────────────────────────────┐   │  (analysis rules, PR     │
│  Managed video service (e.g. Mux)   │◄──│   verification, share    │
│  upload · encode · stream           │   │   cards)                 │
└─────────────────────────────────────┘   └──────────────────────────┘
                                                      │
                                          Expo push (APNs / FCM)
```

## Repository layout (monorepo)

```
frontend/   — the Expo / React Native app (src/app routes, src/components, src/theme, tests)
backend/    — everything Supabase: config, SQL migrations, server functions + their tests
docs/       — specs, plans, styling guide, build list (this file)
automation/ — n8n build-pipeline tooling (local dev only; exempt from app-stack rules)
```

One repo, two deployables: the app ships from `frontend/`, the Supabase project deploys from
`backend/`. Shared docs and process live at the root. Training math stays one module imported by
both sides (a mirrored copy is a bug — CLAUDE.md); where that shared module physically lives is
decided when FND-2 lands and the first server function needs it.

## Data model sketch (launch scale, one Postgres database)

- **Identity:** users (sex, bodyweight, age — needed for strength grades), follows (one-way), blocks/mutes, settings (units kg/lb, privacy, notifications).
- **Training:** exercises (shared library + private custom), workouts, exercise entries, sets (reps, weight, optional RPE, warm-up flag, drop-set segments, superset grouping, timed/WOD score), programs → weeks → workouts, program runs.
- **Derived:** PRs per user per exercise (true 1RM, rep maxes, estimated 1RM via Epley), trends, strength-level grades. Recalculated when a past workout is edited or deleted (LOG-9).
- **Social:** posts (one flair each), votes (no downvotes stored for Physique Check), comments, reports, DMs.
- **Groups:** Teams (membership, roles, coach assignments), Gyms (PostGIS location, membership with one active Gym per user), leaderboard submissions (video ref, thumbs-up approvals, verified state, one-week expiry).
- **Recovery (opt-in, each separately):** nutrition logs, hydration logs, sleep logs — deletable on request (REC-4).

## Cross-cutting requirements the architecture must carry

- **Sensitive data:** progress pics, body data and recovery data get user-set visibility; enforce with Postgres row-level security (NFR-5, YOU-5).
- **Data rights:** export of training data and full account/content deletion (NFR-6).
- **Media limits:** photo/video size and length caps, background upload (NFR-4).
- **Timer fidelity:** the rest timer/stopwatch keeps running while the app is backgrounded (TK-5).
- **Health wording:** analysis and nutrition surfaces carry a not-medical-advice statement (NFR-9).
- **Accessibility:** screen readers, dynamic text size, sufficient contrast (NFR-10).

## Known unknowns

Video provider (Mux is the working assumption), food/nutrition database, Denver gym list data source, Strength Level data licence. Each is tracked in `docs/BUILD_LIST.md` against the feature it blocks.
