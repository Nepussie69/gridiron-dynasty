# Claude handover — Gridiron Dynasty (2026-10-17 ~17:15 AEDT, chat 13)

Read AGENTS.md first. One orchestrator chat at a time. Status = ranked table with ETAs (✅ 🔄 ⏳ ⏸️). Log every user request/landing in PLAYTEST_BACKLOG.md (last row **497**). "push" = ok for that one push (`git push origin main` + `zsh scripts/publish-pages.sh $(git rev-parse HEAD)`; publish-pages now KEEPS `/beta/`; verify by comparing `origin/gh-pages:index.html` bundle with the live one). User said (17:05) "keep progressing, when I come back we will commit" → merge locally, do NOT push.

## Goal
NFL-realistic play where every effect comes from the individual players on the play; emergent plays (FUTURES #54) = every contest decided on the live field; the FUTURES list; playtest fixes.

## State
- **Live (root) = af3cfed.** **Beta** = https://nepussie69.github.io/gridiron-dynasty/beta/ = snapshot of wt/emerjoint at ~15:50 with every emergent layer ON + E1C.on (row 493). User plays the beta.
- **Main** is ahead of live: 496 futt2 (trick plays UI), 497 futh3 (halftime UI), backlog rows. All gates green (build, lint 4, check-broadcast 88, sim == dice-base-sim20.out).
- **Emergent on main, all OFF:** E1a emergent.ts (EMERGENT.on), E1b emergentYac.ts, E1c components/animField.ts (E1C.on), E2 emergentRoute.ts, E3 emergentRush.ts, targets (targetDist.ts), aircoh (playsim AIR_COH_ON), speedgap (SPEEDGAP_ON, stays OFF: double counts with E1).
- **Running DeepSeek:**
  - **emerjoint** (prompts/emerjoint.txt): E1d fast-path mirror + joint calibration, defaults flipped ON in its tree. Last sweep: points 22.5 OK but run-heavy (rush att ~29, rush yds 123–130, rush TD ~1.1, pass att 32.4, pass yds ~224, sacks 2.04 on 5150). Broadcast ON fails 1 play "lb0 no shed move recorded"; XP% 88.6 under joint (investigate). **When merging: also set E1C.on = true** (animField.ts line ~80); SIM changes by design → gate on 3-seed band table + eq 20/20 + check-broadcast + scripts/e1-check-broadcast-on.ts; then re-run elite-vs-poor probes (incl. speed/Hill).
  - **e1cseam** (prompts/e1cseam.txt): beta handoff "teleport" — seam between scripted handoff and recorded path; last scan 2 seam frames + 9 plays with a mover over his pace cap (safeties on runs). Animation only.
- **Infra:** `~/gridiron-work/autocont.sh name=prompt …` relaunches a job whose wrapper is gone and verify not `^FINAL` (max 3; restart the daemon to reset counts), waits for opencode.ai, writes `DEEPSEEK-DOWN <job>` on quota/model-unavailable errors → launch ONE Claude Opus Agent with `prompts/emerjoint-claude.txt`-style brief (user approved; cap 5h window ~70%). Monitor `tail -F logs/autocont.log | grep -E "FINAL|gave up|DEEPSEEK-DOWN"`. Session cron 39e4413d at :13/:43 does checks+merges (dies with the session). caffeinate 12 h started ~14:40 + keep-awake.sh.

## Merge rule (after a conflict was committed to main on 10-15)
`set -o pipefail`; commit in wt; `git merge main` in wt; stop if `git diff --name-only --diff-filter=U` or `^<<<<<<<` — resolve as UNION; build; lint 4; gate20 SIM-IDENTICAL (UI/anim/OFF jobs; refresh logs/dice-base-sim20.out when main's sim legitimately changes); check-broadcast PASS; then merge into main. `git reset --hard` is blocked by auto mode → fix forward.

## Next
1. Merge e1cseam, then emerjoint (see above). Refresh the beta / push only with the user's ok.
2. Then: receiver rotation (#3–#5 target shares), re-measure J10b throwaway 2.8% vs 9.1% and run ≤0 under joint, T3 trick animation, T4 AI trick rates, backlog #39–51, P0.1 (animProbe imports components), browser check of PlayCallingCard / TrickPlaysCard / speech card.
3. Parked: sideways (E1c should fix — confirm in beta), livetele2. Second-computer setup waits on user (Mac same network? GitHub or File Sharing?).

## Gotchas
- DeepSeek ends early often; also outages ("ENOTFOUND opencode.ai", "Model unavailable" ~07:44–14:18 on 10-17).
- Prompt TAILs copied from another prompt carry its verify-file name — check `grep -o "logs/[a-z0-9]*-verify"` before launching.
- Monitors expire every 30 min; re-arm. Don't trust "FINAL" without reading the verify (a stale DRAFT stub once matched).
