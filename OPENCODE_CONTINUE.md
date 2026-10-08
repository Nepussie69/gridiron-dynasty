# Handoff — start here (any orchestrator: Claude, GPT/Codex, OpenCode)

_Updated 2026-10-08 ~19:05 AEDT (4173 preview rebuilt at `aac267f`: everything through the calendar + rookies merges) by Claude Opus 5.5, minutes before a usage limit. Live state below; re-check processes and git before acting. Background/workflow: `ORCHESTRATION_HANDOVER.md`._

## How we work now (user's standing instructions, 2026-10-08)
- **"Keep going through all the pushes"** and **"get DeepSeek doing updates in the background so we can move fast"**: run several DeepSeek Flash pushes **in parallel, each in its own git worktree**, then verify and merge each into `main`.
- **"Keep adding my updates into the table for DeepSeek to build on"**: every user request goes into `PLAYTEST_BACKLOG.md` (one row each) → a spec task (`NEXT_PHASE_L12_x.md`) → a push. Update the row's status when merged.
- After each merge: give the user a **status table**. The user is playtesting on http://127.0.0.1:4173 (preview rebuilt at `aac267f` on 2026-10-08 19:05 — rebuild it when a batch is merged, see below) and sends screenshots with requests.
- Commit trailer: name your model (Claude: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never commit `NEXT_PHASE.md`, `.claude/`, `CLAUDE_RESUME.md`. Keep this repo separate from the CRM repo.

## Parallel push tooling
- `/private/tmp/ds-wt <name> <prompt-file>` — creates worktree `…/scratchpad/wt-<name>` on new branch `wt-<name>` off `main` HEAD (symlinks node_modules), copies `~/.claude/bin/ds-push` with `REPO` pointed at it, and launches it with nohup. Log: `/private/tmp/gridiron-<name>.log` (`[push] … finished|GAVE UP` at the end, then Flash's report). Event stream: `$TMPDIR/ds-push/<name>.tryN.jsonl`.
  Scratchpad = `/private/tmp/claude-501/-Users-aaron-Documents-deepseek-harness-untitled-folder/94a3f1af-f186-4767-8ce0-d8d014f62978/scratchpad`.
- **Merge a finished push:** read the report (`sed -n '/final report/,$p' /private/tmp/gridiron-<name>.log`), then in the worktree: `npm run build`, `npm run lint` (exactly **4 warnings**), review `git diff`; `git add -A src && git commit` there (trailer); then in main: `git merge --no-edit <branch>`; rebuild + lint + equivalence in main; update the spec progress table + verification log + `PLAYTEST_BACKLOG.md`; commit.
- **Offline verification with the real Madden data** (jiti does NOT load it):
  `~/.local/node/bin/node --import /private/tmp/gridiron-loader.mjs /private/tmp/gridiron-calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4` (≈6 s/seed; prints SIM per seed, EQUIVALENCE, SMOKE);
  `/private/tmp/gridiron-shape.mjs <seed> <games>` prints statShape rows. Both import from the MAIN repo path (copy and change `repo` for a worktree).
- Calibration anchors (pre-P4, 500 games): 33333 24.1/68.2%/65.2 plays/1.45 sacks/0.92 INT/4.89 ypc · 2222 24.7/67.9/65.7/1.50/1.00/4.82 · 5150 24.9/68.4/66.4/1.25/0.89/4.82. Bands ±0.4 pts, ±0.7 comp, ±1 play, ±0.15 sacks, ±0.12 INT, ±0.15 ypc.

## Running at handoff (check `pgrep -fl ds-push`)
| Name / branch | Worktree | Spec / task | Prompt | Notes |
|---|---|---|---|---|
| `p5` / `wt-p5` | scratchpad/wt-p5 | NEXT_PHASE_L12.md P5 (E2 defense/K/general ratings, E3 recalibrate, `__ratingSpread`) | /private/tmp/gridiron-l12p5.txt | Sim change: verify all 3 seeds in bands, statShape all ✅, equivalence 20/20, spread table. Appends L12 section to HANDOFF.md |
| `l12_5` / `l12_5-trade` | scratchpad/trade-wt | NEXT_PHASE_L12_5.md T1–T5 trade desk | /private/tmp/gridiron-l12_5.txt | Launched by `/private/tmp/ds-push-wt`. Slow start |
| `reads` / `wt-reads` | scratchpad/wt-reads | NEXT_PHASE_L12_7.md D5 (Now/Ceiling ranges on scouting reads) | /private/tmp/gridiron-l12_7p2.txt | Display only |
| `routes` / `wt-routes` | scratchpad/wt-routes | Backlog #25: real route trees per concept + smooth motion in `playAnim.ts` | /private/tmp/gridiron-routes.txt | Visual only; check in the browser |
Expected merge conflicts: `src/store/gameStore.ts` (calendar, hours, maybe trade) and `src/screens/Draft.tsx` (calendar banner vs reads badges) — resolve by keeping both sides.

## Queue (after the running pushes)
1. **L12.8** team pages / top players / Scout a club (`NEXT_PHASE_L12_8.md`) — **after L12.5 merges** (reuses its HoverCard/PlayerHoverCard).
2. **L12.9 P2 K1** cohesion → penalties/fumbles in the sim — **after P5 merges**.
3. Sim record fix: extra points are pushed with `startYard: 2` in `playsim.ts` (~line 1635); should be 85 (the animation already compensates via `snapYard` in `playAnim.ts`). After P5.
4. Update the frozen 4173 preview: `git -C …/7e69e49a-fbb2-4ed9-bfd2-53e0300ae15d/scratchpad/snap checkout --detach main && (cd that dir && npm run build)` — the vite preview on 4173 serves its `dist`; tell the user to reload. (The snap worktree belongs to an older session's scratchpad; if it's gone, create a new worktree and restart `vite preview --port 4173` from the user's terminal.)
5. After L12: write `NEXT_PHASE_L13.md` per `ROADMAP_L13_L15.md`; the user was shown 20 gameplay ideas (challenges, weather, halftime speech, primetime stakes, holdouts/tags, bye week, cap planner, analytics, press conferences, coaching tree, owner personalities, Hall of Fame + the roadmap ones) and has not picked yet.
- **Blocked on the user:** L12.9 K2 culture contract discount (contract pricing); team passing yards ~265 vs NFL ~220 (retune needs OK).

## Done today (main)
L12 P2 `e1497f3` · game-day: jersey numbers, Space/Play, extra-point spot `10c7eb8`, live box `c34772a`, play log `ae568dd`, call every play `86b1c28` · L12 P4 `f129307` · potential bubble `3fc162e` · "Success Rate" `c3e3d00` · Stats Hub `1726392` · rookies D1–D4 `2097501` · calendar C1–C3 `983b153` (merged `7265ebb`).
Lint baseline **4 warnings**. Guardrails as in `NEXT_PHASE_L12.md` DO NOT + no rng draws added/removed, optional save fields, canonical player objects, no new deps.
