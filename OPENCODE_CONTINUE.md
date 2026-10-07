# Handoff to ChatGPT (Codex) or any backup orchestrator — start here

_Written 2026-10-07 ~22:45 AEDT by Claude Opus 5.5. Background and workflow: `ORCHESTRATION_HANDOVER.md`. Setup steps for the user: `SWITCH_TO_CODEX.md`._

## Your role
You are the **orchestrator**: plan, send pushes to DeepSeek Flash, verify, commit, report. Flash writes most of the code:
`~/.claude/bin/ds-push <prompt-file> <label>` (runs `opencode-cli run` with DeepSeek Flash 4.1 on the user's OpenCode Go plan; watchdog + auto-retry; prints Flash's final report; takes 10–25 min, so use a long timeout or run it in the background and wait).
Prompts are ready in `.claude/prompts/`. Small fixes you can make yourself.
- After each push: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint` (warning count below), read `git diff`, fix small issues, update the spec's progress table + verification log, commit, then give the user a status table.
- Commit trailer: `Co-Authored-By: GPT (Codex) <noreply@openai.com>` (name the model you are). Never commit `NEXT_PHASE.md` or `.claude/`. Never push this repo to the user's CRM repo (separate projects).
- If Flash runs out of steps (its report says "maximum number of steps"), send a **continuation** prompt: same template, list exactly what's done (from its report + `git diff`) and what's left; tell it not to redo work.

## State (verify with `git log --oneline -8` and `git status`)
| Item | Status |
|---|---|
| L5 → L11.5 | ✅ committed |
| L12 P1 + R4: roster Ratings / Stats tabs, glossary, composites, coverage grade | ✅ committed |
| UI by Claude: game-day one-page layout, club colors + each club on its own end, My Career tabs, OT/OG/C/DE/DT chips | ✅ committed |
| **L12 P3 realistic stat lines** | ✅ `7f2871b` — `__statShape(150)` all 16 NFL bands pass; calibration 23.7 pts |
| **Play animation** (runs with handoffs and cuts, routes + throw + catch + run after catch, scrambles, sacks, fumbles, INT/punt returns, kicks through the posts) | ⏳ **next**: engine written, untracked: `src/components/playAnim.ts` (backup `.claude/prompts/playAnim.ts.bak`). Apply the MatchView wiring with `python3 .claude/prompts/animpatch.py`, then build/lint/check and commit both files. |
| L12 P2: practice week + keys to the game | ⏳ then: `.claude/prompts/l12p2.txt` |
| L12 P4: every rating counts, offense (E0, E1) | ⏳ then: `.claude/prompts/l12p4.txt` |
| L12 P5: defense/general ratings + recalibrate (E2, E3) | ⏳ then: `.claude/prompts/l12p5.txt` |
| L13–L15 | outlined in `ROADMAP_L13_L15.md`; write a full `NEXT_PHASE_L13.md` spec (same format as L12) when L12 is done |

The user's standing instruction: **"keep going through all the pushes"**. Keep the status board at the top of `ROADMAP_L13_L15.md` current.

## Play-animation step (do this first)
1. `python3 .claude/prompts/animpatch.py` (prints `ok`). It imports `./playAnim` into `src/components/MatchView.tsx`, replaces the two-keyframe dots with a requestAnimationFrame clock, and draws the ball (with lift on throws/kicks), the carrier highlight, goalposts and penalty flags.
2. `npx tsc --noEmit -p tsconfig.app.json` → if it reports unused names (e.g. `useMemo`/`CENTER_Y`), remove them. `npm run build`; `npm run lint` should drop to **4** warnings (the patch removes one `set-state-in-effect`). From then on prompts' "exactly 5" means 4 — the prompt files already say so.
3. Ask the user to open a coached game (Play next game → coach it) and check: runs show a handoff and a cut; passes show routes, the throw arcing, the catch and a run after it; an away-team drive runs right-to-left; punts show a return; a field goal flies through posts.
4. Commit `src/components/playAnim.ts` + `MatchView.tsx`.

## Verifying in the game (you can't see the browser)
Ask the user to paste into the console at http://127.0.0.1:5173 (View → Developer → JavaScript Console), **after** loading a career and waiting ~5 s for real ratings (`__world().roster.BAL[0].name` shows a real name):
- `__simTest(200,'NFL')` → seed 33333 ≈ 23.7 pts / 67.5% comp / 65 plays / 1.55 sacks / 0.97 INT / 4.9 ypc
- `await __gameDayEquivalence(20)` → must be 20/20
- `__statShape(150)` → all ✅ (after any sim change)
- `await __careerSmoke(4,'personnel')` → 0 errors / 0 violations
- `__planMatrix(70)` may time out; it's only needed after plan/sim balance changes.

## Guardrails
No changes to reputation gates, objectives, capabilities, `evaluateTrade` or contract pricing without the user's OK. Sim changes only where a spec says they're approved (L12 P4–P5), and calibration must come back inside the spec's
bands. No `rng()` draws added or removed. Every new save field optional. No new dependencies. Open decision for the user: team passing yards are ~265/game vs ~220 NFL (needs their OK to retune).
The user plays on a frozen build at http://127.0.0.1:4173 (a terminal tab running `vite preview` on a separate worktree); tell them which commit is on it, or that new work is on 5173 only.
