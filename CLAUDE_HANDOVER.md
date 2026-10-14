# Claude handover — Gridiron Dynasty (2026-10-15 ~09:20 AEDT, chat 10)

Read AGENTS.md first. One orchestrator chat at a time. Status = ranked table with ETAs (✅ 🔄 ⏳ ⏸️). Log every user request/landing in PLAYTEST_BACKLOG.md (last row **429**). "push to live" = explicit ok for that one push.

## Goal
NFL-realistic play where every effect comes from the individual players on the play (no averages, big elite-vs-poor spread), a realistic 2.5D broadcast, and the user's playtest fixes.

## Current state
- **Live** (GitHub main + Pages) = **d2f94e7** (index-BSa_E1aQ.js). **Local main eb9ec10** is ahead with: realismloss (row 426, runs lose yards again), #15 C injury report UI (427), #28 C3 staff UI (428), Round 8 camera fix (429). All gated (build, lint 4, eq 20/20; check-broadcast 80/80 on the R8+realismloss tree). Push only on the user's ok.
- **Ready to merge, final check pending:**
  1. **ladder** (rows 415/418: only NFL OC / NFL DC → NFL Head Coach, and GM; old saves migrate; careerSmoke start rung moved to coach 6 / personnel 8). wt/ladder committed + main merged (before fut28c3/R8 merges); verify `logs/ladder-verify.out` = PASS (probe 53/0, SIM identical, eq 20/20). Re-run on the merged tree: `cd ~/gridiron-work/wt/ladder && git merge --no-edit main && npm run build && REPO=$PWD nice -n 15 node --import ~/gridiron-work/loader.mjs ~/gridiron-work/logs/ladder-probe.mjs | grep PROBE` → then eq 20 → merge to main.
  2. **realismpunts** (rows 366/394): punts 4.42/4.67/4.50 → 4.10/4.32/4.07 via each HC's own aggression on the 4th-down call (top-10% go 47%, bottom 8%; league go 23.6% vs NFL 20.5%) + kicker range. Verify `logs/punts-verify.out`. wt/realismpunts committed + main merged (incl. realismloss). **Joint 3×500 --eq --smoke** → `~/gridiron-work/logs/punts-loss-joint.out` (eq 20/20 already printed). Compare bands vs `logs/realismloss-calib-after.out` (≈ current main sim). Accept: punts in band, no band worse than main by >0.2 (pooled 6-seed drift for single-seed misses), smokes 0/0 → merge.
- **Running DeepSeek** (relaunched as continuations ~09:15 after the overnight outage): **realismj52** (#52 WR reads, prompts/realism-j52.txt; verify likely logs/j52-verify.out), **fapool** (row 408 free-agent pool, prompts/fapool.txt; logs/fapool-verify.out). Check `grep '^\[push\]' ~/gridiron-work/logs/<name>.log | tail -1`.
- No launch queue left. Round 8 is finished and merged (Sonnet agent done — it dies on clear anyway).

## Decisions and why
- Merge one job at a time: commit in the worktree, `git merge --no-edit main` there, gate, then merge to main. Keep both sides of conflicts (outcome spreads keep every `...xFields`).
- Accept: OFF/sim byte-identical where claimed, eq 20/20, no band worse than main by >0.2, lint exactly 4. Never shrink an individual effect to hit a band.
- Accepted with notes: completion % +0.4 (one seed 0.2 over) from realismloss; draftvalue probe "can't afford #1" on one seed (realistic); covstats max CB TD 10.6/17.
- Push: build, lint 4, `calib.mjs 33333 20 --eq` 20/20, secret scan of `git diff origin/main..main`, `git push origin main`, `zsh scripts/publish-pages.sh main`, confirm the live index-*.js changed (curl the Pages URL).

## Next steps
1. Finish ladder + punts merges (above), backlog rows, status table, ask to push.
2. Merge J52 and fapool as they land (re-run their gates on the merged tree).
3. Browser check pending for #15 C and #28 C3 at 375px + dark (spec asks orchestrator to look).
4. Backlog: #27 DF2/DF3, J11, #7/#24/#26, #39–51; animation round for J13 audibles (hook in qbReads.ts); punter directional punting (row 376); J10b throwaway rate 2.8% vs NFL 9.1%; run ≤0 still 14.7% vs NFL 17.8% and ≥10 yd 9.4% vs 10.6% (realismloss notes).

## Gotchas
- **DeepSeek often ends its turn early** ("Recommended next steps", no verify file) → `~/gridiron-work/cont.sh <name> <ABS original prompt>` relaunches a continuation in the same worktree. `ds-wt` needs an ABSOLUTE prompt path (relative → empty prompt, "You must provide a message").
- Overnight every try hit the 90-min hard timeout when sims were starved (load 25, calib-slot queue backed up). For a 20-game `--eq` run, skipping calib-slot.sh (nice -n 15) is fine; long calibrations still go through it.
- Orphan OpenCode sessions keep editing worktrees: `opencode-cli api GET /api/session/active`; interrupt (`POST /api/session/<id>/interrupt`) ONLY when no DeepSeek client is alive. `.governor-dead` is an exact worktree-name match.
- Job watcher: check only the LAST `[push]` line of a log (older runs' "finished" lines cause false alarms).
- Keep this chat lean: grep verify files, don't cat big logs; chat 10 hit 350k.

## Key files
PLAYTEST_BACKLOG.md rows 403–429 · ~/gridiron-work/prompts/ · ~/gridiron-work/logs/*-verify.out · ~/gridiron-work/{ds-wt, cont.sh, launch-when-slot.sh, launch-after.sh, calib-slot.sh, sim-governor.sh} · NEXT_PHASE_FUT_INJURYDECISIONS.md / NEXT_PHASE_FUT_CHOOSECOACHES.md (both complete) · FUTURES.md
