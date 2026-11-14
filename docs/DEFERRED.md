# Deferred

_Things postponed during sessions, so they aren't lost. Remove items when they're done or decided._

- UI foundation leftovers: app icon + splash artwork are still the Expo template placeholders
  (splash/adaptive backgrounds set to `#0d0d0d`); device/simulator verification of FND-1/FND-4
  pending (flips them from Built to Done); re-audit screens with the `ui-ux-pro-max` skill if
  Tristen installs it.
- FND-2 leftovers (branch `supabase-schema`): apply the two migrations to the remote project once
  `SUPABASE_ACCESS_TOKEN` is set (via the Supabase MCP next session, or `npx supabase link` +
  `npx supabase db push` from `backend/`) and probe the RLS policies with two test users;
  frontend auth screens + supabase-js wiring (FND-2 part 2, own branch); storage buckets (land
  with avatar / progress-pic features); exercise library seed data (LIB items); replace the single
  `user_body_data.bodyweight_kg` value with a bodyweight history log when trends/REC items need it.
- Autonomous pipeline v2 features, deliberately left out of v1 (see `docs/PIPELINE.md`): cron /
  unattended triggering, parallel items via git worktrees, external gate notifications
  (Telegram/email), auto-updating build-list status at merge. Earn each with a few clean v1 runs.
- (External blockers from the PRD — Strength Level licence, food database, Denver gym data source,
  video provider, deload rules — are tracked in `docs/BUILD_LIST.md`.)
