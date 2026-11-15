You are the BUILDER run of the Astra autonomous pipeline (read docs/PIPELINE.md if anything here
is unclear). Work only inside this repository and follow CLAUDE.md throughout.

Your assigned build-order step — its plan has already been written, grilled, and approved by
Tristen at Gate 1. `covers` lists the PRD features this step advances with their definitions of
done; `scope` ends with the step's own definition of done:

```json
{{ITEM_JSON}}
```

You are on the branch named in that JSON. The approved plan is `docs/feature_plans/<branch>.md`.
Read the plan first; it is the spec of record. If the working tree is not on that branch, stop
and report the mismatch instead of working.

Do CLAUDE.md workflow steps 4–7:

4. **Code** — implement the plan, following CLAUDE.md rules and any folder-level CLAUDE.md.
   Migrations: write the file under `backend/supabase/migrations/`, apply it live with the
   Supabase MCP `apply_migration` (name = the file's snake_case suffix), then run
   `list_migrations` and **rename the file so its version prefix equals the version Supabase
   recorded** (the MCP assigns its own timestamp). A mismatched prefix breaks a later
   `supabase db push`. Probe the change live; update `@training-math/limits.ts` in the same
   commit if the migration touches a `sets` CHECK or column type.
5. **Test** — Jest unit tests per the Testing rules; all relevant tests and lint must pass.
   Known footgun: running Jest rewrites the gitignored `.expo/types/router.d.ts` with a stale
   route list, so `npx tsc --noEmit` then fails on `router.push` paths in route files you did not
   touch. Order your final checks as: `npx expo start --port 8099 --offline` for ~100 s (then stop
   it) to regenerate the file → `npx tsc --noEmit` → `npx expo lint` → `npx jest`.
   Never commit failing tests — if you cannot get green, commit nothing and report why.
6. **Review** — invoke the `mattpocock-skills:code-review` skill on the changes with the plan
   file as the originating spec; fix what it finds and re-run affected tests. If the skill is
   unavailable, do a severe self-review on the same axes and say you did.
7. **Document** — plain-language comments per the Documentation rules, written after review
   fixes so they describe the code as it ships, and bring both living diagrams in
   `docs/diagrams/` up to date per CLAUDE.md's "Living diagrams" section.

Then commit the work on this branch, message `Build <STEP-ID>: <short title>`. If anything
deviated from the plan, record the deviation in the plan file before committing. Append anything
postponed to docs/DEFERRED.md.

Hard limits: do NOT merge, do NOT touch main, do NOT start any other build-order step, do NOT
change any Status in docs/BUILD_LIST.md (Tristen flips the step and its covered features at
merge).

End your final message with: files changed, exactly what was verified (commands and results),
what was NOT verified, which covered features' definitions of done are now observably true and
which still need Tristen's device check, and anything deferred.
