# ORCHESTRATION HANDOVER — Gridiron Dynasty (start here in a new chat)

> **Continuing in OpenCode?** Read `OPENCODE_CONTINUE.md` first; it has the exact next steps.

_Written 2026-10-06 by Claude Opus 5.5 at the end of a long orchestration session. Read this first, then `HANDOFF.md` (game state) and the open spec files listed below._

## 1. How we work (the user's workflow)
- **Claude (Opus) plans and verifies; DeepSeek Flash 4.1 implements.** The user says "plan the next phase and send it to flash" or "keep going through all the pushes".
- Each phase is a spec file `NEXT_PHASE_<L>.md` at the repo root, with a progress table, exact file/function specs, pushes (groups of tasks), and a DO NOT list.
- **Per push:** send a prompt to Flash → when it finishes, Claude checks `npm run build` + `npm run lint` (must be exactly **5 warnings**), reads the diff,
  **tests in the browser pane**, fixes small issues itself, updates the spec's progress table + verification log, **commits** (with the attribution line below), then sends the next push.
- Commit after every verified push (the user asked for this). Never commit `NEXT_PHASE.md` (an old, unused Flash "Phase 7" draft) or `.claude/` (dev launch config). Leave both untracked.
- When the user is **playing**, hold pushes (Flash edits trigger a dev-server reload). Spec-only `.md` edits are fine.
- The user likes a **status table** at the end of each push and phase.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

### Sending a push to Flash
Use **`~/.claude/bin/ds-push <prompt-file> [label]`** (added 2026-10-06). It runs `opencode-cli run --standalone --auto --format json -m opencode-go/deepseek-v4.1-flash` with watchdogs and auto-retry:
- **startup hang** (no event within 120 s) and **idle hang** (no event and no change under `src/` for 600 s) → kill the process tree and retry, up to 3 tries; a 2700 s hard cap per try;
- a retry prepends a note telling Flash to inspect `git status`/`git diff` first and continue without redoing work;
- status lines start with `[push]` (follow them with a Monitor); the per-try event logs are `$PUSH_LOG_DIR` (default `$TMPDIR/ds-push`)`/<label>.tryN.jsonl`; at the end it prints Flash's final report. Exit 3 = gave up.
- Env overrides: `STARTUP`, `IDLE`, `HARD`, `MAX_TRIES`, `DS_ROUTE` (model).
Run it with Bash `run_in_background: true`.
**Hang root cause (found 2026-10-06):** `opencode run` reads extra prompt text from **stdin** when stdin isn't a TTY. Launched from a background shell, it can inherit a pipe/socket that never closes,
so it blocks forever *before contacting the server* (0% CPU, no log line after "cli starting", no session created). Proven: with a never-closing stdin pipe it hangs every time; with `< /dev/null` it answers in seconds.
**Fix:** both `ds` and `ds-push` now launch with `< /dev/null`. Any other way of calling `opencode run` from a script must do the same. `--standalone` was a red herring (now opt-in via `STANDALONE=1`).
The watchdog stays as a safety net.
The alternative route `opencode/deepseek-v4.1-flash` fails with **"Insufficient account funds"**, so don't use it unless the user tops up.

**Prompt template** (fill the task list):
> You are the IMPLEMENTER for the Gridiron Dynasty repo in the current directory. The active spec is NEXT_PHASE_X.md — read it fully. IGNORE all other NEXT_PHASE*.md files.
> [Earlier tasks are done and committed; do not modify that work.] Implement ONLY tasks …, in order, exactly as specified: … After EACH task run:
> export PATH="$HOME/.local/node/bin:$PATH"; npm run build && npm run lint — build must pass and lint must show exactly 5 warnings. Never run npm run dev or any
> long-running/watch command. Obey the DO NOT list (no git commands, …, do not edit any NEXT_PHASE*.md). Do NOT start <next task> or later. Finish with a short per-task report.

## 2. Verifying in the browser pane
- The dev server runs from the user's terminal at **http://127.0.0.1:5173** (Node at `~/.local/node`). `.claude/launch.json` exists but port 5173 is the user's server, so just `navigate` to it.
- The browser pane has **separate storage** from the user's Chrome, so test careers there never touch the user's saves.
- Dev globals: `__game` (zustand store: `__game.getState().startCareer({name,path,archetype,teamId,seed,startLevel,scenarioId})`, `advanceWeek()` (async), `finishDraft()`, …),
  `__world()`, `__balanceProbe(seasons, path)` (sync; uses `world.seed`), `__simTest(games,'NFL')`, `__careerSmoke(seasons, path, seed)` (async, L9).
- **Gotchas:**
  - `__simTest` with **no career loaded** runs on a placeholder world (~29.6 pts). Always `startCareer` first. Compare calibration **on the same seed** (seed 33333 ≈ 23 pts / 66–67% / ~3.3 sacks). Leagues vary 23–25 pts.
  - To tune constants at runtime, import the module **using the exact URL the app loaded**:
    `performance.getEntriesByType('resource').map(e=>e.name).find(n=>/engine\/career\.ts/.test(n))` (it has a `?t=` suffix). A plain `import('/src/…')` gives a separate copy.
  - Long probe loops can time out the JS tool. Run 2–3 seeds per call.
  - macOS once revoked Documents access for the Claude app mid-session (every file read gave "Operation not permitted"). The fix is System Settings → Privacy & Security → Files and Folders → Claude → Documents, then **quit and reopen** the app.
- Standard seeds for pacing: 20261004, 111, 2222, 33333, 5150, 777.

## 3. Where things stand (commits on `main`)
| Phase | Spec | Status | Last commit |
|---|---|---|---|
| L5 Long-arc stories (trade tree, seeds, scenarios, living objectives) | NEXT_PHASE_L5.md | ✅ | 0d0769e |
| L6 Every rung is a job (scout trust, conviction, Your Room, portfolio interviews, draft fix, gates 5–8) | NEXT_PHASE_L6.md | ✅ | 0a84588 |
| L6.5 Playtest fixes (**crushed-contract bug**, Find deals, depth chart, relink) | NEXT_PHASE_L6_5.md | ✅ | bfaf46e |
| L7 Middle of the building (shadow board, extension talks, cap memo, combine) | NEXT_PHASE_L7.md | ✅ | 307531d |
| L7.5 Economy (AI depth swaps → cap use ~0.8, user owns re-signs, expiring warning, gates 7–8 respread) | NEXT_PHASE_L7_5.md | ✅ | 24de32c |
| L8 Staff room (weekly wrinkle, install plan, starter pitch, red flag) | NEXT_PHASE_L8.md | ✅ | 9f4e40d |
| **L9 The long game** | NEXT_PHASE_L9.md | **✅ all pushes (P3 verified)** | see git log |
| **L9.5 Playtest 2 fixes** | NEXT_PHASE_L9_5.md | ✅ all 3 pushes | see git log |

### Immediate next steps
1. **L9.5 is done.** Nothing is in flight.

2. **L10 candidate — game-day coaching:** the user asked for 10 ideas to give HCs/coordinators more input (play-calling etc.). They're in **`IDEAS_GAMEDAY.md`** with a suggested 4-push phasing.
   Not approved or specced yet: ask the user which ideas to build, then write `NEXT_PHASE_L10.md`.

## 4. Pacing & balance (current, measured on committed code)
- Personnel → GM: seeds 20261004 13 · 2222 8 · 33333 8 · 5150 10 · 777 9 · 111 17 (a weak-roster outlier). Coach → HC ~10–11.
- League cap use ~0.76–0.90 (after L7.5 X1). Sim calibration ~23 pts on seed 33333.
- The probe never uses the L6–L8 rung features, so real careers climb somewhat faster. If personnel feels too fast, raise the **GM profile gate**; leadership was the bottleneck, so leave it alone.
- Guardrails we've held every phase: no changes to gates/objectives/capabilities/sim constants/evaluateTrade/contract pricing unless the user approves; rewards ≤ +3 per dimension per feature per season;
  all user-only sim bonuses are clamped (wrinkle + install ∈ [−0.6, +1.5]); every new save field is optional.

## 5. Known issues / user decisions pending
- Loyal agents with a happy player + high guarantees sign at ~75% of market (judgment call, left as is).
- **Watch** re-simulates games and can differ from the real result (fixed by L9.5 R4).
- Dead money equals nearly the whole contract for fully-guaranteed star deals. That's the normal formula; there's a small drift above total value (possible `fitToCap` rounding). Low priority.
- `runAIResign` still handles re-signing for scout/coach careers (by design).
- Ideas not yet built: Waiver Tuesday, the coordinator's halftime adjustments, the deeper multi-scenario system, #14 self-scouting (deferred: dominant-strategy risk).

## 6. Key files added across these phases
engine: tradeTree, seed, scenarios, objectives, department, conviction, room, portfolio, shadow, negotiation, capMemo, combine, depth, wrinkle, install, pitch, redflag (`src/game/engine/`).
components: RoomCard, InterviewPrep, PortfolioCard, ShadowBoardCard, ExtensionTalks, CombineCard, WrinkleCard, InstallCard. Smoke probe: `careerSmoke` in `src/store/gameStore.ts`.

## 7. Continuing in OpenCode (if Claude usage runs out)
A ready OpenCode chat exists: open the **OpenCode app** → this project → session **"Gridiron Dynasty — Orchestrator (Claude backup)"** (model `opencode-go/deepseek-v4.1-flash`, DeepSeek Flash 4.1).
It has already read this file. Rules for that orchestrator:
- **Same workflow:** spec → push → verify → commit. It can either send pushes to Flash with `~/.claude/bin/ds-push` (needs a bash timeout of 45+ min) or implement a push itself if that's simpler.
- **No browser pane there.** Verification = `npm run build` + `npm run lint` (exactly 5 warnings) + reading the diff; for in-game checks, give the user the exact console snippet
  (e.g. `await __careerSmoke(6,'coach')`) to paste into the browser devtools at http://127.0.0.1:5173 and read back the result.
- Guardrails in §4 still apply. Commit with the trailer `Co-Authored-By: DeepSeek Flash 4.1 (OpenCode) <noreply@opencode.ai>` instead of Claude's.
- When Claude is available again, Claude resumes from this file plus `git log`.
