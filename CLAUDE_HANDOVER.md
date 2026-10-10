# Claude handover — Gridiron Dynasty

Prepared 2026-10-10 19:20 AEDT, refreshed 19:25, by Claude Opus 5.5 for a fresh chat. Supersedes the 04:39 Codex handover. Read AGENTS.md first, then this file. `PLAYTEST_BACKLOG.md` rows 136–155 are this session's requests.

## First 5 minutes in the new chat

1. `pgrep -fl "gridiron-work/ds-push-"` — at 19:25 three runners were alive: realism (pid 13517, realism15fix7), kickoffs (6638, kickoffs-fix1 try 3), animcontact (17248, animcontact3). Tail `~/gridiron-work/logs/{realism,kickoffs,animcontact}.log` and read the worker report at the end of the newest `logs/events/<name>.tryN.jsonl`.
2. Re-arm a watcher per live runner (`while kill -0 <pid>; do sleep 30; done`) and keep `caffeinate -i -w <pid>` on each.
3. Do the returners browser check and merge (only gate left), then review stcalls `fd10d23`.
4. For each runner that has exited: snapshot source-only, run the independent gates in a review worktree, follow the table below.

## Ground rules (unchanged, user-confirmed)

- Orchestrator plans + verifies; DeepSeek implements. Never merge unverified work.
- **Stable 4173 HELD** at `4377982` — do not rebuild until the user says so (they were offered a rebuild from main at 19:05 and have not answered).
- **No `git push` / Pages without explicit user ok for that push.** The 04:50 push authorization was used (`ef1c974` on origin). Main is now ahead of origin with docs + three UI merges.
- Never commit `NEXT_PHASE.md`, `CLAUDE_RESUME.md`, `.claude/`. Leave `ORCHESTRATION_COORDINATION.md` alone. Commit trailer names your model.
- Every user request → a PLAYTEST_BACKLOG row. Give a status table after merges.
- Max 4 parallel DeepSeek jobs (more → transport failures).

## Infrastructure — everything lives in `~/gridiron-work/` (NOT /private/tmp)

A Mac reboot at ~18:35 wiped /private/tmp (old harness, logs, worktrees). The old fix5/kickoff jobs had actually died at 05:04 when the Mac slept. Their edits were recovered from OpenCode's DB (`~/.local/share/opencode/opencode.db`, table `session_message`; replay script `~/gridiron-work/replay.py`) — remember this trick if it happens again.

| Path | What |
|---|---|
| `loader.mjs` | TS loader for node (rewritten; validated: main seed 2222 ×500 = 21.9 = recorded baseline) |
| `calib.mjs` | `REPO=<tree> node --import ~/gridiron-work/loader.mjs ~/gridiron-work/calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4` |
| `anim.mjs` | `REPO=<tree> … anim.mjs 33333 1` → ANIM line, endSpot match/total |
| `passid.mjs` | team pass-share spread per seed (identity check for realism) |
| `gpprobe.mjs` | GP vs team games by position after 13 weeks |
| `ds-wt <name> <prompt> [base]` | worktree `wt/<name>` (reuses branch `wt-<name>` if it exists, else new off base/main), launches ds-push detached; log `logs/<name>.log`, events `logs/events/<name>.tryN.jsonl` |
| `queue-launch.sh <name> <prompt> [base]` | waits for <4 running DeepSeek jobs, launches, holds `caffeinate`, prints exit |
| `prompts/` | every prompt sent this session |
| `logs/` | worker verify outputs (`*-verify.out`) and my review logs (`rv-*`) |
| `rv`, `rv-base`, `rv-ret`, `rv-stable` | detached review worktrees (fc60c43 / 1cbd4dd / 9df22cb / 4377982) — reuse or `git worktree remove` |
| `rec/` | recovery worktrees — can be removed |

Node: `~/.local/node/bin`. Use `node --import ~/gridiron-work/loader.mjs` (plain node can't load the TS). Keep the Mac awake for long jobs: `nohup caffeinate -i -w <runner-pid> &`.

Browser checks: add a config to `.claude/launch.json` pointing vite at the worktree on an **isolated port** (4429–4431 used) and use a throwaway test career; never touch the user's real 4173/5173/Pages origins. Note `git -C "$MAIN" worktree add <relative path>` lands inside the repo — always pass absolute `$HOME/gridiron-work/...` paths.

## Main

`d4cc425` (local, not pushed). Merged this session (all verified: build, lint 4, browser):
- `59452b7` Contract Ledger OVR + POT sortable columns (#146)
- `0b1bb9a` Draft prospect board position filter (#148)
- FUTURES #26–#29 added (playcalling, draft philosophy, coordinator/position-coach hiring, future prospects tab); FUTURES 1a2 Stars corrected to merged.
- Main 3×500 points 22.5/21.9/22.3 with 5–7 band misses per seed (pre-existing; realism fixes them).

## Jobs and branches — status at handover

| Branch / job | State | Next action |
|---|---|---|
| **wt-realism** `fc60c43` (realism15fix6b) | Independently PASSES every gate: 31/31 bands all seeds (pts 22.7/22.3/22.8), eq 20/20, smokes 0/0, anim 111/111; MT sack-as-tackle accounting accepted. **User chose B: hold** because OFF_PASS_RATE was compressed 75% → team pass-share SD 0.026–0.029 (was 0.05; NFL ≈0.035–0.045). | **realism15fix7 RUNNING** (runner pid 13517, prompt `prompts/realism15fix7.txt`): restore SD 0.035–0.045 on all seeds keeping 31/31. On exit: snapshot, run calib + `passid.mjs` + anim independently. Pass → integrate with latest main in a spare worktree, re-verify, merge. |
| **wt-kickoffs** `4e67ab3` (#126) | Design accepted (real kickoffs after made FG, halftime, OT). Bug: missed-FG spot `s.yard + 8` (wrong direction, defense loses 15 yds). | **kickoffs-fix1 RUNNING** (runner pid 6638, now on try 3 — watchdog restarts; check log). On exit: verify spot = max(20, 107 − LOS), full gates. Base is main (no R15–R18) → must be integrated onto the accepted realism engine before merge; `restartAfterFieldGoal`/`stepClock`/`stepHalftime` touch playsim.ts. |
| **wt-returners** `9df22cb` (#124) | Code review OK (store validates own-club WR/RB/CB healthy; eligibility matches `candidatePool`; RET = round(returnScore)). Independent: build, lint 4, 3×500 **byte-identical to main**, eq 20/20, smokes 0/0, anim 103/103. Worker probes 42/42. | **Only the browser check remains**: Depth Chart → Special Teams KR/PR cards + Player Profile Return ability, desktop + 375px, light/dark, test career (isolated port; `wt-ui` config in launch.json already points at `wt/returners`, port 4431 — that origin has a test career from the draft check; needs a level with depth-chart control, e.g. "Advanced: choose a starting level" → GM). Then merge to main. |
| **wt-stcalls** `fd10d23` (FUTURES #4, spec `NEXT_PHASE_ST_CALLS.md`) | Finished, **unreviewed**. Based on realism `1cbd4dd` (R17 onside/fake code). Worker reports defaults identical to baseline 22.2/21.9/22.3, eq 20/20. 6 files +471/−27 incl. new `specialCalls.ts`, playsim hooks, GamePlanScreen, types/generate (save fields). | Review diff + probes (`logs/stcalls-*`), independent gates vs 1cbd4dd baseline, browser check (game plan Special Teams section + kickoff moment). Must be rebased/integrated onto the accepted realism snapshot before merge. |
| **wt-animcontact** `f17c723` + animcontact3 | **RUNNING** (runner pid 17248, prompt `prompts/animcontact3.txt`): #150 carriers never freeze (old code `hold()`s the receiver at the spot when the tackler is far, ~line 1236–1252), every stop is visible contact within pace; #151 DB coverage man trail/hip-pocket + zone landmarks, every route covered, safeties move, separation at catch by result. | On exit: review, anim/probe/calib-identical gates, then **launch `prompts/animcontact4.txt` on the same branch** (#152 double-team rushers, #153 route running SRR/MRR/DRR vs MCV separation). Still held overall until integrated with the accepted engine; browser-check live MatchView plays. Preserve main's MatchView jersey-number context when merging this older fork. |
| **wt-saveslots** `9c5adce` | All functional + real-IDB gates passed earlier; product picker UI checked this session (create/rename/switch/reload/delete-active, desktop+375, light/dark) and a 375px overflow fixed. Nits: rename field doesn't preselect; sidebar shows "Slot N · Slot N" when unnamed. | Held for integration with the accepted engine (main.tsx save-probe wrappers conflict with realism hook imports — keep both). |
| wt-ledgerovr, wt-draftpos | Merged. | Can delete branches/worktrees. |

Background watchers from this chat will not carry over — in the new chat, re-check with `pgrep -fl "gridiron-work/ds-push-"` and the `logs/*.log` tails.

## Findings to remember

- **GP (#149):** stable 4377982 double-counts RB GP (rush + receiving lines; Cook 24 GP in 12 games). Fixed on main. Main gives OL/K/P 0 GP (counts games with a stat); realism branch fixes OL via participation; **K/P still 0 everywhere → follow-up job after realism merges.**
- In-game app shell at 375px: the sidebar takes most of the screen (pre-existing; worth a backlog item if the user plays on phone).
- DeepSeek probes sometimes validate the code against itself (kickoff miss spot) — always check against the rule independently.

## Queue after the above (one sim-touching job per area; UI jobs can run in parallel)

1. K/P GP follow-up (after realism merge).
2. FUTURES: #5 challenges, #6 weather, #7 halftime speech, #8 primetime/rivalry, #11 FA frenzy, #15 injury decisions, #24 trick plays, #2 UI Broadcast 2.0, #26 coach playcalling, #27 draft philosophy, #28 choose coordinators/position coaches, #29 future prospects tab, **#30 animation realism (`NEXT_PHASE_ANIM_REALISM.md`: phases 1–8, explained → guided physics → calibrated physics; absorbs animcontact3/4)**. #20 dropped by user.
3. Offer the user a stable 4173 rebuild once realism + kickoffs + returners are merged (GP fix, ledger, filter all already on main).
