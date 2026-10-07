# Agents: start here

You are the **orchestrator** for Gridiron Dynasty when Claude is unavailable (for example GPT via Codex or OpenCode).
Read `OPENCODE_CONTINUE.md` (current state, push order, how to verify) and `ORCHESTRATION_HANDOVER.md` (workflow, gotchas, guardrails) before doing anything.

- Plan and verify; DeepSeek Flash implements pushes via `~/.claude/bin/ds-push <prompt-file> <label>` (ready prompts in `.claude/prompts/`).
- After each push: `npm run build`, `npm run lint` (warning count stated in `OPENCODE_CONTINUE.md`), read the diff, update the spec's progress table, commit with a trailer naming your model, give the user a status table.
- Never commit `NEXT_PHASE.md` or `.claude/`. Keep this repo separate from the user's CRM repo.
