-- ============================================================================
-- Give launch-library exercises a stable, phone-computable identity
-- ============================================================================
-- What this migration does, in plain language:
--   The shared launch library (exercises with owner_id null) is about to be
--   seeded. The app is offline-first, so the phone must be able to know a
--   library exercise's database id WITHOUT asking the server. The contract:
--   every library exercise has a slug ('bench_press'), and its uuid id is
--   derived deterministically from that slug (UUIDv5 under the fixed namespace
--   in frontend/src/library/catalog.ts). This migration adds the slug column
--   the contract needs; the seed migration that follows fills it.
--
--   The partial unique index is also what makes seeding idempotent: one slug,
--   one library row, no matter how many times a seed runs.
alter table public.exercises
  add column slug text
    check (slug ~ '^[a-z0-9_]{1,80}$');

-- A library row (owner_id null) must have a slug; a user's custom exercise
-- must not — customs are identified by their client-generated uuid alone, and
-- a slug would be a second identity with no consumer.
alter table public.exercises
  add constraint exercises_slug_for_library_only
    check ((owner_id is null) = (slug is not null));

-- One slug = one library exercise. Partial: the constraint only governs the
-- shared library, never user customs (which have slug null).
create unique index exercises_library_slug_idx
  on public.exercises (slug)
  where owner_id is null;
