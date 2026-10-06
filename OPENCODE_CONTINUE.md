# Continue in OpenCode (DeepSeek Flash 4.1) — start here

_Written 2026-10-06 ~21:55 by Claude Opus 5.5, because Claude's plan usage is nearly used up. Full background: `ORCHESTRATION_HANDOVER.md`._

## You are the orchestrator now
You plan, verify and commit. You can implement small pushes yourself, or delegate a push to a separate Flash run with `~/.claude/bin/ds-push <prompt-file> <label>`
(it needs a long bash timeout of 45+ min; it already redirects stdin from `/dev/null`, which fixed the "startup hang").

## State right now (check with `git log --oneline -5` and `git status`)
| Phase | Status |
|---|---|
| L5–L9 | ✅ all committed |
| L9.5 P1 (R1 game-plan wiring bug, R2 one side per plan) | ✅ `e5dba86` |
| L9.5 P2 (R3 team ratings, R4 box scores) | ✅ `7842153` |
| **L9.5 P3 (R5 staff role tabs, R6 staff budget, R7 sortable roster, R8 Fit fix for defenders)** | **sent to Flash at ~21:52; NOT verified or committed** |

## Step 1: finish L9.5 P3
1. `git status`. If `src/` is clean, P3 never landed: run `~/.claude/bin/ds-push L95_P3_PROMPT.txt l95p3` (or implement R5–R8 yourself from `NEXT_PHASE_L9_5.md`).
2. If `src/` has changes: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint`. The build must pass and lint must show **exactly 5 warnings**.
3. Read the diff against the spec (`NEXT_PHASE_L9_5.md` R5–R8). Check in particular: R6 is **display only**; R7 cycles asc → desc → default; R8 passes the DC scheme and the player's side, so defenders show a real Fit instead of "—".
4. **You have no browser.** Ask the user to check on http://127.0.0.1:5173:
   - Staff screen: the group tabs filter both lists, and the budget is no longer $0;
   - Roster: clicking headers sorts ▲/▼ and back to default;
   - Roster with Fit: defenders show Ideal/Good/Poor.
   For engine checks, give them console snippets to paste, e.g. `await __careerSmoke(6,'coach')` (expect 0 errors and 0 violations).
5. Update the progress table and verification log in `NEXT_PHASE_L9_5.md`, then commit with the trailer
   `Co-Authored-By: DeepSeek Flash 4.1 (OpenCode) <noreply@opencode.ai>`. Never commit `NEXT_PHASE.md`, `.claude/` or `L95_P3_PROMPT.txt`.

## Step 2: what's next (ask the user first)
- **L10 game-day coaching:** 10 ideas are in `IDEAS_GAMEDAY.md`, with a suggested 4-push phasing. Ask which ideas to build, then write `NEXT_PHASE_L10.md` in the same format as earlier specs
  (progress table, exact files/functions, pushes, a DO NOT list, a verification log).
- **Possible bug to look at:** the sim's `TeamGameStats.sacks` was identical for home and away in every test game, while the box score's `defSacks` differ. This may be a miscount in `playsim.ts`.
- **Balance watch:** now that defensive plans work (R1), soft zone beat all-out blitz against one opponent (17.5 vs 24.1 points allowed). Check that no defensive preset is dominant across opponents.

## Guardrails (unchanged)
No changes to reputation gates, objectives, capabilities, sim constants, `evaluateTrade` or contract pricing without the user's OK. Rewards ≤ +3 per dimension per feature per season.
Every new save field is optional. No new dependencies. Commit after every verified push, and give the user a status table at the end of each push.
