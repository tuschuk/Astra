# Handoff

_Overwritten at the end of every session with where things stand now. Not a log._

## Where things stand (Nov 14, 2026 — pipeline go-live session)

**The pipeline is live and its first run (B05 auth-and-signup) was started from this session.**
`build-order-for-pipeline` is merged to `main` (merge commit `a3401d5`, pushed), so the picker
now reads the audited build list and the 56-step Build order. The n8n board was brought up to the
repo JSON over n8n's REST API and activated.

**What had to change to make n8n actually run the board (all in this commit):**

- **n8n 2.x disables the Execute Command node by default** (`NODES_EXCLUDE` defaults to
  `executeCommand` + `localFileTrigger`). That is why the board had zero executions before today.
  n8n must be started with `NODES_EXCLUDE=[]`; it is running that way now as a detached hidden
  process (`Start-Process n8n.cmd start`, logs in `automation/state/n8n.log`). After a reboot,
  Tristen restarts it the same way — see `docs/PIPELINE.md`, "The pieces" and "Operator setup".
- **The board gained a Webhook trigger** (`POST http://localhost:5678/webhook/astra-build-pipeline`)
  beside the manual trigger, so a shell or a Claude session can start a run; the manual trigger
  only works from the n8n UI. The board must be Active for the webhook URL to exist (it is).
- **Cold-start quirk:** the JS task runner can miss its 15 s grant-token window and loop on 403
  for a few minutes; Code nodes fail with "Task request timed out" until the log says
  `Registered runner`. Documented under Failure handling in `docs/PIPELINE.md`.
- **n8n MCP server still blocked** (SSRF strict mode). Fix identified: `WEBHOOK_SECURITY_MODE=moderate`
  in `automation/scripts/n8n-mcp.mjs`'s env block. Claude Code's permission classifier declined to
  let this session make that edit (it loosens a security mode), so **Tristen adds that one line**
  and restarts Claude Code. Until then, board changes go through the REST API with the `.env` key —
  the exact calls are in `docs/PIPELINE.md`. Live board id: `gvu4dg0NPtND4tGG`.

**Verified this session:** Execute Command from n8n resolves `claude` (2.1.220) and runs with the
repo as cwd; a throwaway webhook → Execute Command → Code smoke workflow completed end to end
(then deleted); `pipeline.mjs check` 22/22, `lint` clean, `next --dry-run` → B05.

**For Tristen (Gate 1 is waiting on you):**

1. Open http://localhost:5678 → Astra Build Pipeline → Executions. The B05 execution runs the
   planner (Fable) first, then pauses at **Gate 1 — plan approval**. Read
   `docs/feature_plans/auth-and-signup.md` on branch `auth-and-signup`; to approve, open the
   execution's `gate1_resume_url` (shown in the "Check planner result" node output); to reject,
   cancel the execution and delete the branch.
2. After the builder finishes (Summary node), review branch `auth-and-signup`, merge to `main`
   with `--no-ff`, and flip B05 to Built plus FND-2 / NFR-8 Status in `docs/BUILD_LIST.md` (Gate 2).
   Then `curl -X POST http://localhost:5678/webhook/astra-build-pipeline` starts B06.
3. Apply the one-line n8n-mcp fix above so Claude sessions can inspect the board directly.
4. Still outstanding from before: run the app on a device (flips FND-1/FND-4 to Done); decide the
   six external blockers when ready.

**Do not** edit files in this working tree while an execution is running: the planner and builder
run in the same checkout and switch it to the step's branch.

Next pipeline step after B05 merges: **B06 training-math** (`node automation/scripts/pipeline.mjs
next --dry-run` to confirm).
