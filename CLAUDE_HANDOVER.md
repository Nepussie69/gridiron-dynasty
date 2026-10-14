# Claude handover — Gridiron Dynasty (2026-10-14 ~21:15 AEDT, chat 9)

Read AGENTS.md first. One orchestrator chat at a time. Status = ranked table with expected times (✅ 🔄 ⏳ ⏸️); "table green tick" = full table incl. ETAs. Log every user request/landing in PLAYTEST_BACKLOG.md (last row 402). User: "keep pushing" = keep going down the list.

## Goal
NFL-realistic play where every effect comes from the individual players on the play (no averages, big elite-vs-poor spread), a realistic 2.5D broadcast, and the user's playtest fixes.

## Current state
- GitHub main + Pages = **6cd5ff9** (live). Local main **ad9fea3** is 13 commits ahead: jind merged (a2f5b24, byte-identical results) + backlog rows. Push only on the user's explicit ok.
- **Rule since today: all new jobs on DeepSeek** (memory subagent-model-split); ask before any Claude sub-agent. Exception: the user put Round 8 on Sonnet.
- Running DeepSeek (≤5): realismj37 (J37 re-centring, cont7), realismpunts (punts 4.5 → ≤4.4), fut15b (#15 B wiring), fut28c2 (#28 C2 store), tradevalue (row 399, positional trade values from nflverse data, launched 21:10).
- **staffmoney (row 398) FINISHED**: review ~/gridiron-work/logs/staffmoney-verify.out → commit in wt/staffmoney → merge.
- Queued chain (background `launch-after.sh`): boxdef (row 400, defensive box score) → scoutquick (row 401, scouting quick buttons) → realismiq (row 402, veteran playbook learning). Each waits for the previous one to launch, then for a free slot (<5 jobs, load <8).
- **Sonnet Round 8 agent (wt/animflow, latest c4e4947) dies on clear** → relaunch from ~/gridiron-work/prompts/r8-sonnet-relaunch.txt if logs/animflow-r8-verify.out has no Sonnet FINAL. User priority: players running out of bounds unforced.

## Decisions and why
- Merge one job at a time: commit WIP in the worktree, `git merge --no-edit main` there, then merge to main. Keep both sides of conflicts; outcome spreads keep every `...xFields` (now `...j13Fields, ...iuPassFields`).
- Accept: OFF byte-identical, eq 20/20, no band worse than main by >0.2, lint exactly 4. Never shrink an individual effect to hit a band.
- Before a push: build, lint 4, `calib.mjs 33333 20 --eq` 20/20, secret scan, then `git push origin main` + `zsh scripts/publish-pages.sh main`, then confirm the live index-*.js changed.
- QB cone is on by default in 2.5D (user). HC trade control keeps the draft pause on the HC's slot (needed for draft-day trades).

## Next steps
1. Review + merge staffmoney. Check the Sonnet Round 8 agent (relaunch if dead). Re-arm checks on the 5 DeepSeek jobs (`tail ~/gridiron-work/logs/<name>.log`, `<name>-verify.out` FINAL).
2. As jobs land: verify → merge → backlog row → status table → ask to push.
3. After J37 merges: #52 WR reads (prompts/realism-j52.txt). Then #15 C UI, #28 C3 UI, #27 DF2/DF3, J11, #7/#24/#26, #39–51; an animation round for J13 audibles (hook exists in qbReads.ts); punter directional punting by his own ratings (offered, row 376); J10b throwaway rate 2.8% vs NFL 9.1%.

## Gotchas
- Fixed today: an endless play-call moment (J38 featured play not among options) hung EVERY gameDayEquivalence run → any pre-119cf89 tree hangs at eq game 19.
- calib-slot.sh counts only running sims; `.governor-dead` keeps paused sims of dead jobs out of slots (fut15, fut28, fut28-base, realismj13, realismj3c, realismj10a, fut27 are listed — their old hung sims stay paused). Run any new sims for those names from another dir (a re-used worktree named fut15/fut28/realismj13 gets paused).
- Interrupting one OpenCode session can kill all live DeepSeek clients — kill the ds-push-<name> wrapper + client first, interrupt after, then check the others.
- opencode.ai DNS outages kill jobs (ENOTFOUND) → relaunch with ds-wt (same worktree continues).
- Claude may not kill DeepSeek's node sims (classifier) → .governor-dead or give the user a `kill` line.
- Keep this chat lean: grep verify files, don't read big logs; chat 9 hit 340k.

## Key files
PLAYTEST_BACKLOG.md rows 369–402 · ~/gridiron-work/prompts/ (staffmoney, tradevalue, boxdef, scoutquick, realism-iq, realism-punts, fut15-b, fut28-c2, cont7-realismj37, animflow-r8, r8-sonnet-relaunch) · ~/gridiron-work/logs/*-verify.out · ~/gridiron-work/{ds-wt, launch-when-cool.sh, launch-when-slot.sh, launch-after.sh, calib-slot.sh, sim-governor.sh (MAXRUN=7)}
