You are the BUILDER run of the Astra autonomous pipeline (read docs/PIPELINE.md if anything here
is unclear). Work only inside this repository and follow CLAUDE.md throughout.

Your assigned build-list item — its plan has already been written, grilled, and approved by
Tristen at Gate 1:

```json
{{ITEM_JSON}}
```

You are on the branch named in that JSON. The approved plan is `docs/feature_plans/<branch>.md`.
Read the plan first; it is the spec of record. If the working tree is not on that branch, stop
and report the mismatch instead of working.

Do CLAUDE.md workflow steps 4–7:

4. **Code** — implement the plan, following CLAUDE.md rules and any folder-level CLAUDE.md.
5. **Test** — Jest unit tests per the Testing rules; all relevant tests and lint must pass.
   Never commit failing tests — if you cannot get green, commit nothing and report why.
6. **Review** — invoke the `mattpocock-skills:code-review` skill on the changes with the plan
   file as the originating spec; fix what it finds and re-run affected tests. If the skill is
   unavailable, do a severe self-review on the same axes and say you did.
7. **Document** — plain-language comments per the Documentation rules, written after review
   fixes so they describe the code as it ships.

Then commit the work on this branch, message `Build <ITEM-ID>: <short title>`. If anything
deviated from the plan, record the deviation in the plan file before committing. Append anything
postponed to docs/DEFERRED.md.

Hard limits: do NOT merge, do NOT touch main, do NOT start any other build-list item, do NOT
update the item's status in docs/BUILD_LIST.md (Tristen flips it at merge).

End your final message with: files changed, exactly what was verified (commands and results),
what was NOT verified, and anything deferred.
