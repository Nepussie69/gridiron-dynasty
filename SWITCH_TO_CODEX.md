# Switching to ChatGPT (Codex desktop app) when Claude runs out

GPT (in Codex) becomes the orchestrator; DeepSeek Flash keeps doing the coding through `ds-push` (your OpenCode Go plan).

## Once (about 2 minutes)
1. Open the **Codex desktop app**, signed in with your ChatGPT account.
2. **Add project / Open folder** and choose `Documents › deepseek-harness › untitled folder`.
3. Run it **locally** (on this Mac, not cloud) and allow it to **run terminal commands** (full access, or approve when asked).

## When Claude's usage runs out
4. New chat in that project, paste:
   > Read AGENTS.md, then follow OPENCODE_CONTINUE.md from the State table. You're the orchestrator: send each push to DeepSeek with `~/.claude/bin/ds-push <prompt-file> <label>` (ready prompts are in `.claude/prompts/`), wait for it to finish (10–25 min), then verify (npm run build, npm run lint, read the diff), commit, and give me a status table after each push.
5. Codex plans and checks; every `ds-push` sends the coding to DeepSeek Flash. Nothing else to set up.
6. For in-game checks, paste the snippet Codex gives you into the browser console at http://127.0.0.1:5173 (View → Developer → JavaScript Console) and paste the result back.

## Notes
- Keep the dev server terminal (port 5173) running; keep the stable build (4173) running if you're playing on it.
- If a command is blocked, approve it or widen the project's permissions.
- When Claude is back, it resumes from these files plus `git log`.
