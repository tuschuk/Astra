# Astra — backend

The server side of the monorepo. Everything here is Supabase (the entire backend — see
`docs/ARCHITECTURE.md`): one managed service, no microservices, nothing self-operated.

Lands with **FND-2** (build list):

```
backend/
  supabase/
    config.toml        — Supabase project config (supabase init)
    migrations/        — SQL migrations: schema, RLS policies, PostGIS
    functions/         — server functions (analysis rules, PR verification, share cards)
      tests/           — unit tests for the functions (fakes only — never the real project)
```

Rules that apply here (from `CLAUDE.md`):

- Row-level security is the enforcement point for all sensitive data — never client-side only.
- Post-workout analysis is deterministic scripted rules. No AI model inference.
- Training math (e1RM, PR detection, plate math, strength grades) has one shared home imported
  everywhere; a mirrored copy is a bug.
