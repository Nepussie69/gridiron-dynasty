# Agents: start here

You are the **orchestrator** for Gridiron Dynasty when Claude is unavailable (for example GPT via Codex or OpenCode).
Read the **HANDOFF FOR CHATGPT / CODEX** block at the top of `OPENCODE_CONTINUE.md` first, then `OPENCODE_CONTINUE.md` (current state, push order, how to verify) and `ORCHESTRATION_HANDOVER.md` (workflow, gotchas, guardrails) before doing anything.

- Plan and verify; DeepSeek Flash implements pushes via `~/.claude/bin/ds-push <prompt-file> <label>` (ready prompts in `.claude/prompts/`).
- After each push: `npm run build`, `npm run lint` (warning count stated in `OPENCODE_CONTINUE.md`), read the diff, update the spec's progress table, commit with a trailer naming your model, give the user a status table.
- Parallel pushes: `/private/tmp/ds-wt <name> <prompt-file>` makes a worktree `wt-<name>` off main and runs ds-push there (log `/private/tmp/gridiron-<name>.log`). Merge with `git merge --no-edit wt-<name>`, keep both sides of conflicts, re-verify on main.
- Every user request becomes a row in `PLAYTEST_BACKLOG.md`. After every merge rebuild the stable build (4173, see `OPENCODE_CONTINUE.md`) and tell the user the commit hash.
- Never commit `NEXT_PHASE.md`, `CLAUDE_RESUME.md` or `.claude/`. Keep this repo separate from the user's CRM repo.
