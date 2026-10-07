# Continue without Claude — start here (any model: GPT or DeepSeek)

_Rewritten 2026-10-07 ~22:05 AEDT by Claude Opus 5.5. Full background: `ORCHESTRATION_HANDOVER.md`. Spec in progress: `NEXT_PHASE_L12.md`. Status board: top of `ROADMAP_L13_L15.md`._

## You are the orchestrator now
You plan, verify and commit; DeepSeek Flash implements. Delegate a push with `~/.claude/bin/ds-push <prompt-file> <label>` (bash timeout 45+ min; it already redirects stdin from `/dev/null`),
or implement a small push yourself. Commit after every verified push and give the user a status table.
Commit trailer: name the model you are, e.g. `Co-Authored-By: GPT (OpenCode) <noreply@opencode.ai>` or `Co-Authored-By: DeepSeek Flash 4.1 (OpenCode) <noreply@opencode.ai>`.
Never commit `NEXT_PHASE.md` or `.claude/`. Keep the game repo (`Nepussie69/gridiron-dynasty`) separate from the user's CRM repo: never push one to the other.

## State (check `git log --oneline -8` and `git status` first)
| Item | Status |
|---|---|
| L5–L11.5 | ✅ all committed |
| L12 P1 + R4 (ratings tab, glossary, composites, inline ratings, Stats tab, coverage grade) | ✅ committed |
| UI: game-day one-page redesign, club colors, each club on its own end, OT/OG/C/DE/DT chips | ✅ committed |
| **L12 P3 realistic stat lines (S1–S4)** | sent to Flash ~21:55 AEDT. If `pgrep -fl "opencode-cli run"` shows nothing and `src/` has changes, it finished: verify + commit. |
| Play animation (runs, routes, catch + YAC, scrambles, sacks, fumbles, INT/punt returns, kicks) | engine written: `src/components/playAnim.ts` (uncommitted). Wire-in patch: `python3 .claude/prompts/animpatch.py` (run AFTER P3 is committed; it edits `MatchView.tsx`). Then build, lint, browser check, commit. |
| L12 P2 (practice week, keys to the game) | prompt ready: `.claude/prompts/l12p2.txt` |
| L12 P4, P5 (every rating counts, recalibrate) | prompts ready: `.claude/prompts/l12p4.txt`, `l12p5.txt` |
| L13–L15 | outlined in `ROADMAP_L13_L15.md`; spec each when it's next |

Order: P3 → animation patch → P2 → P4 → P5. The user said "keep going through all the pushes".

## Verifying (no browser pane outside Claude)
- `npm run build` must pass; `npm run lint` must show exactly 5 warnings (**4 after the animation patch**: it removes one `set-state-in-effect`; update the prompts' "exactly 5" to the new count).
- In-game checks: give the user console snippets to paste at http://127.0.0.1:5173 after a career is loaded and real ratings are in (`__world().roster.BAL[0].name` is a real name):
  `__simTest(200,'NFL')` (seed 33333 ≈ 23.8 pts / 66.8% / 64.5 plays / 1.75 sacks), `await __gameDayEquivalence(20)` (must be 20/20), `__statShape(200)` (after P3), `await __careerSmoke(4,'personnel')` (0/0).
- The user plays on a frozen build at http://127.0.0.1:4173 (served from a terminal tab with `vite preview`). After each commit you can rebuild it: build the commit into the folder that server uses, or tell the user it's on 5173 only.

## Guardrails (unchanged)
No changes to reputation gates, objectives, capabilities, `evaluateTrade` or contract pricing without the user's OK. Sim changes only where a spec says they're approved (L12 P3–P5), and team calibration must come back
inside the spec's bands. No `rng()` draws added or removed. Every new save field optional. No new dependencies.
