# Claude handover — Gridiron Dynasty (2026-10-17 ~19:40 AEDT, end of chat 13)

Read AGENTS.md first. One orchestrator chat at a time. Status = ranked table with ETAs (✅ 🔄 ⏳ ⏸️), "table green tick" = that table. Log every user request/landing in PLAYTEST_BACKLOG.md (last row **508**). "push" = ok for that one push. Normal push: `git push origin main` + `zsh scripts/publish-pages.sh $(git rev-parse HEAD)` (keeps /beta/). Beta refresh = build main HEAD + `git -C ~/gridiron-work/wt/emerjoint diff HEAD -- src scripts` applied (3-way) + E1C.on=true (src/components/animField.ts ~80) into `beta/`, build main into the root FIRST then beta into OUT/beta (no `rm -rf $VAR`), force-push gh-pages (see row 506). Verify both index bundles vs origin/gh-pages.

## Goal
NFL-realistic play decided by the individual players on the field (emergent plays, FUTURES #54) + FUTURES list + playtest fixes. User plays the BETA now.

## State
- **Live = 54e2cf4** (root) and **beta** = 54e2cf4 + emerjoint tuning with every emergent layer ON (row 506). Main == live (+ backlog commits).
- **Emergent on main (all OFF by default):** E1a emergent.ts, E1b emergentYac.ts, E1c animField.ts (E1C.on), E2 emergentRoute.ts, E3 emergentRush.ts, targets, aircoh; speedgap stays OFF (double counts).
- **Running DeepSeek** (each has its own `autocont.sh` daemon; `logs/autocont.log` shows FINAL / relaunch / gave up / DEEPSEEK-DOWN):
  - **emerjoint** — joint calibration (prompts/emerjoint.txt). Last seen: points OK, too run-heavy (rush att ~29, pass att ~32.4). When FINAL: gate on 3-seed band table + eq 20/20 + check-broadcast + scripts/e1-check-broadcast-on.ts; set E1C.on=true; merge commit message MUST start `emerjoint:` (queue-r2 waits for it); re-run elite-vs-poor + Hill speed probe.
  - **e1goal** (row 507) — carriers stopped short of the goal / hook-back near the pylon; logic only in emergent.ts/emergentYac.ts/animField.ts.
  - **statcredit** (row 508) — beta box score: 32 pressures for one DT, 18 tackles; credit rules, outcome-neutral.
  - (e1goal and statcredit touch emergent files that emerjoint tunes: merge emerjoint first or resolve as UNION — keep emerjoint's knob values.)
- **Queue** `~/gridiron-work/logs/queue-r2.sh` (running): NEXT_PHASE_REALISM2.md sim jobs (r2penalties, r2fumbles, r2aicalls, r2returns, r2rotation, r2placement, r2presnap, r2kickers, r2injury, r2clock) start after a main commit starting `emerjoint:`, max 2 at a time. r2aging + r2personality already merged.
- **Merged today (all live):** futp3a/futp3b playcalling, callcats, animshed, fastars, draftreal, qbrun, livetele3, blitzrush, futt2 tricks UI, futh3 halftime UI, e1cseam, futgmstyle, futmarket, futcombine, r2personality, r2aging.
- **Infra:** Claude Opus fallback approved when DEEPSEEK-DOWN (brief prompts/emerjoint-claude.txt; cap 5h window ~70%; check get_usage). caffeinate started ~14:40 for 12 h + keep-awake.sh. Old chat's cron was cancelled at handover — the new chat should re-create a :13/:43 check (see this file's merge rule) and a Monitor on autocont.log.
- **Open / parked:** XP% 88.6 under joint (check); broadcast-ON "lb0 no shed move recorded"; receiver rotation is r2rotation; browser check of new cards (PlayCallingCard, TrickPlaysCard, speech card, Business card, Combine view); livetele2 parked; second-computer setup waits on user (Mac same network? GitHub or File Sharing?).

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
