# Handoff — start here in a new chat (Claude, GPT/Codex or OpenCode)

_Updated 2026-10-08 ~22:05 AEDT by Claude Opus 5.5 (stopped at 5-hour usage ~93%; resets ~00:10 AEDT) for ChatGPT/Codex or a fresh Claude chat. Re-check processes and git before acting. Longer background: `ORCHESTRATION_HANDOVER.md`. Every user request: `PLAYTEST_BACKLOG.md` (55 rows). Long-term build order: `FUTURES.md`._

## Your role and the user's standing instructions
- You are the **orchestrator**: spec → send to DeepSeek Flash → verify → merge → rebuild the stable build → tell the user. Small UI fixes you do yourself.
- "Keep going through all the pushes." "Get DeepSeek doing updates in the background so we can move fast" → run **several pushes in parallel, one git worktree each**.
- "Keep adding my updates into the table" → every request becomes a row in `PLAYTEST_BACKLOG.md`, then a spec task; mark ✅ when merged.
- "Make sure everything done is published to the stable build" / "let me know when you update the stable build" → after **every** merge rebuild 4173 and say so with the commit hash.
- Status tables after each merge. The user playtests on **http://127.0.0.1:4173** and sends screenshots; their requests jump the `FUTURES.md` queue.
- Commit trailer: your model (Claude: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never commit `NEXT_PHASE.md`, `.claude/`, `CLAUDE_RESUME.md`. Keep this repo separate from the user's CRM repo.
- At 95% plan usage: stop and update this file (memory rule).

## Repo state
- `main` HEAD = `c2f6929`-or-later (see `git log`). **Stable build 4173 serves `8a8b6cd`** (= all merged code). Lint baseline **exactly 4 warnings**. Dev server 5173 runs in the user's terminal (HMR).
- Stable build worktree: `/private/tmp/claude-501/-Users-aaron-Documents-deepseek-harness-untitled-folder/7e69e49a-fbb2-4ed9-bfd2-53e0300ae15d/scratchpad/snap`, served by `vite preview --port 4173` from the user's terminal. Rebuild after every merge:
  `SNAP=<that path>; git -C $SNAP checkout -q --detach main && (cd $SNAP && PATH="$HOME/.local/node/bin:$PATH" npx vite build --outDir $SNAP/dist)` — then tell the user "stable build updated: 4173 serves <hash>" and what's new.

## Merged this session (2026-10-08 evening) — all on stable `c2f6929`
- L12.10 P1 fullback + route tree + formations×concepts playbook (`src/game/data/playbookData.ts`, `routes.ts`); P2 every player's pace/actions in the animation come from ratings (`playAnim.ts` movers, `animProbe.ts`) + formation→play picker with route diagrams (`RouteDiagram.tsx`, MomentCard `CallPicker`, GamePlan script).
- L12.13 mastery M1–M4 (realistic start, learns from snaps/production, relative effects).
- L12.14 contracts C1–C5 (fixed 2025 cap $279.2M, market, dead money ≤ remaining value, ask the GM to extend, explainer).
- Claude fixes: run animation distance-timed/smooth; **trade values rewritten** in `src/game/engine/trade.ts` (position values QB ×2.2 … K/P ×0.3, steep OVR curve, expected rating for young players, smooth position-specific age decline, starting-QB premium 85+ ×1.7 / 78+ ×1.4, deal finder fills gaps with right-sized picks, never offers a same-position player unless < 60% of the target's value). Starting QBs now cost ~2.5–4 firsts; Mahomes unavailable.

## Tools
- **Parallel push:** `/private/tmp/ds-wt <name> <prompt-file>` → new worktree `…/94a3f1af-f186-4767-8ce0-d8d014f62978/scratchpad/wt-<name>` on branch `wt-<name>` off `main`, node_modules symlinked, runs a copy of `~/.claude/bin/ds-push` (DeepSeek Flash 4.1 via OpenCode; watchdog + 3 retries) under nohup. Log `/private/tmp/gridiron-<name>.log` (ends `[push] … finished` / `GAVE UP`, then Flash's report). If `/private/tmp` was cleaned: recreate it (git worktree add + `ln -s` node_modules + copy of ds-push with `REPO=` pointed at the worktree).
- **Merge a push:** read the report; in the worktree `npm run build`, `npm run lint` (4), review `git diff`; `git add -A src && git commit` (trailer); in main `git merge --no-edit wt-<name>`; resolve conflicts keeping both sides (usual spots: `gameStore.ts` ScreenId/imports, `main.tsx` probe imports, `App.tsx`/`AppShell.tsx`, shared table props); rebuild + lint + offline checks in main; update the spec progress/verification log + backlog; commit; rebuild 4173; tell the user.
- **Offline verification with the real Madden data** (jiti does NOT load it): `~/.local/node/bin/node --import /private/tmp/gridiron-loader.mjs /private/tmp/gridiron-calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4` (~6 s/seed). `/private/tmp/gridiron-shape.mjs <seed> <games>` prints statShape rows. Both import the MAIN repo; copy and change `repo` for a worktree. Browser: built-in browser pane at 5173; dev globals `__game`, `__world()`, `__simTest`, `__statShape`, `__careerSmoke`, `__gameDayEquivalence`, `__ratingSpread`, `__rookieProbe`, `__faFlowProbe`, `__skillProbe`.
- Current calibration (500 games, 33333 / 2222 / 5150, after playbook+mastery+anim): 23.6 pts/68.1%/65.1 plays/1.47 sacks/0.96 INT/4.90 ypc · 24.6/67.4/65.6/1.63/0.97/4.81 · 25.0/68.4/66.1/1.35/0.85/4.88 (passing ~264–276 yds). The `realism` push retunes these to NFL 2015–2024.
- Animation probe: `/private/tmp/anim-main.mjs` (= gridiron-calib + `ANIM` line from `src/game/engine/animProbe.ts`): end spots must match 100%, SPD ratio ≥1.25, max frame Δ ~3.6 now.
- Usage: check with the app's usage tool; at 95% plan usage stop and update this file. Equivalence 20/20; smokes 0/0.

## Running at handoff (check `pgrep -fl ds-push`; logs `/private/tmp/gridiron-<name>.log`)
| Name / branch | Spec | Prompt | Notes |
|---|---|---|---|
| `gmdesk2` (in `wt-gmdesk`, uncommitted) | `NEXT_PHASE_L12_14.md` C6 GM requests desk — mostly done; continuation finishes Cap.tsx GmCapRowActions/GmRestructureCard + verify | /private/tmp/gridiron-gmdesk2.txt (log gridiron-gmdesk2.log) | Cap.tsx will conflict with the sortable ledger on main: keep both |
| `stars2` (in `wt-stars`, uncommitted) | `NEXT_PHASE_L12_15.md` S1–S4 implemented + verified (calib in band, 20/20, 0/0, season-1 bands exact). Continuation fixes drift: 90+ falls 28 → 11–15 by season 6 | /private/tmp/gridiron-stars2.txt (log gridiron-stars2.log) | re-run `/private/tmp/stars-verify.mjs` (prints DIST) before merging |
| `realism` / `wt-realism` | `NEXT_PHASE_REALISM.md` R1–R3 + R5 NFL 2015–2024 retune + missed tackles | /private/tmp/gridiron-realism.txt | sim constants; calibration bands change — re-baseline after merge |

**When each finishes** (`[push] <name> … finished` in its log, then Flash's report): if the report says it ran out of steps or left items, send a continuation prompt in the SAME worktree with `nohup /private/tmp/ds-push-<name> <new-prompt> <name>N > /private/tmp/gridiron-<name>N.log 2>&1 &` listing exactly what's done/left (see /private/tmp/gridiron-stars2.txt for the pattern). Otherwise: build + lint 4 in the worktree, `git add -A src && git commit` there, `git merge --no-edit wt-<name>` in main, resolve conflicts keeping both sides (import-list conflicts: `python3 /private/tmp/merge-imports.py wt-<name> <files>` unions the names), then on main: build, lint 4, `~/.local/node/bin/node --import /private/tmp/gridiron-loader.mjs /private/tmp/gridiron-calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4` (takes ~10 min — run it in the background), update the spec progress table + verification log + `PLAYTEST_BACKLOG.md` + `FUTURES.md`, commit, rebuild 4173, tell the user the hash.
**Suggested merge order:** gmdesk2 → stars2 → realism (qbpay merged) (realism retunes the sim; re-baseline the calibration numbers in this file after it merges). `stars` and `realism` both affect results: after merging one, merge main into the other's worktree and re-run its checks before merging it.

DeepSeek connections drop (ECONNRESET) with 5+ pushes at once; ds-push retries 3× automatically.

## Queue — next, in order
1. ✅ DONE (merged 8a8b6cd: top-5 QB signed AAV $43.2M → $58.2M, cap use 0.80–0.83, dead money no longer double counts) — **QB pay to real 2025 money** (user said yes, 2026-10-08): top-5 signed QB AAV is $43.6M because `fitToCap` (cap.ts / generate) compresses every contract toward 0.79–0.86 cap use; the market curve is $62M. Make QB (and the other premium positions) keep their market share when fitting (e.g. fit by scaling non-QB / mid-tier deals first, or exempt the top-12 QBs), so signed top-5 QB AAV ≈ $55–60M while league cap use stays 0.76–0.90 and nobody is over the cap. Check with `__marketProbe` + `__balanceProbe(6,'personnel')`. Backlog row 67.
2. ~~Cap ledger sortable~~ ✅ done (Claude).
3. **Possible dead-money double count** to check: Garrett shows cap hit $47.7M, 2 yrs, guaranteed $52.8M, dead $97.8M (= the whole remaining contract). `deadMoney = min(proration×years + guaranteed, remaining)` — if `guaranteed` already includes bonus, it double counts. Verify against the NFL rule (dead = remaining proration + remaining *guaranteed base*), fix in `cap.ts`.
4. `NEXT_PHASE_UI.md` UI Broadcast 2.0 (U1 TV field … U4), one push per section, after `anim` (merged) — U1 touches playAnim/MatchView.
5. `FUTURES.md` rows 3 → 25 one by one (row 20 press conferences was **dropped by the user** — skip; row 23 = hof running).
- Small known items: extra points recorded at `startYard: 2` in playsim (animation compensates via `snapYard`); one pursuit reversal frame spike (3.6 yd/s) in the animation; mastery at world creation caps 6–7-yr vets at ~45–72% (cohesion cap).
- Nothing is blocked on the user.

## Done on 2026-10-08 (all on `main` and the stable build)
L12 P2 practice/keys · P4 + P5 every rating counts (`E1_W` 1.1, `E2_W` 1.0) + `__ratingSpread` + glossary · game day: jersey numbers, Space freezes mid-play, Play after a moment, extra-point spot, live box score, past-only play log, call every play (switch rebuilds to the play on screen; every-snap modes ask every snap), blitz rushers · real route trees + smooth motion · Stats Hub · Find a Player · History · Playoff picture (NFL seeding) · team pages + Scout a club · trade desk (hover cards, find deals for their players, by position, trade block with rare stars, column filters) · rookies on the NFL scale + old-save rescale · scouting Now/Ceiling ranges · calendar (FA March, draft April) · weekly hours removed · coach Ledger + "Success Rate" · AI QB rushing · skill points · Staff & Hiring redesign · Unit Grades by position · potential bubble · player hover cards · culture (cohesion → penalties/fumbles; winning-culture discount).
The user's rating-impact table (47/48 ratings used; RTE unused) can be regenerated from `RATING_INFO` in `src/game/data/ratingInfo.ts`.
