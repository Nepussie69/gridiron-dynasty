# Handoff — start here in a new chat (Claude, GPT/Codex or OpenCode)

_Written 2026-10-08 ~20:30 AEDT by Claude Opus 5.5 for a fresh chat. Re-check processes and git before acting. Longer background: `ORCHESTRATION_HANDOVER.md`. Every user request: `PLAYTEST_BACKLOG.md` (55 rows). Long-term build order: `FUTURES.md`._

## Your role and the user's standing instructions
- You are the **orchestrator**: spec → send to DeepSeek Flash → verify → merge → rebuild the stable build → tell the user. Small UI fixes you do yourself.
- "Keep going through all the pushes." "Get DeepSeek doing updates in the background so we can move fast" → run **several pushes in parallel, one git worktree each**.
- "Keep adding my updates into the table" → every request becomes a row in `PLAYTEST_BACKLOG.md`, then a spec task; mark ✅ when merged.
- "Make sure everything done is published to the stable build" / "let me know when you update the stable build" → after **every** merge rebuild 4173 and say so with the commit hash.
- Status tables after each merge. The user playtests on **http://127.0.0.1:4173** and sends screenshots; their requests jump the `FUTURES.md` queue.
- Commit trailer: your model (Claude: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never commit `NEXT_PHASE.md`, `.claude/`, `CLAUDE_RESUME.md`. Keep this repo separate from the user's CRM repo.
- At 95% plan usage: stop and update this file (memory rule).

## Repo state
- `main` HEAD: see `git log` (last code merge: culture `b8d5051`); stable build **4173 serves `304f68e`** (same code as main — later commits are docs/specs only). Lint baseline **exactly 4 warnings**. Dev server 5173 (user's terminal, HMR).
- Stable build worktree: `/private/tmp/claude-501/-Users-aaron-Documents-deepseek-harness-untitled-folder/7e69e49a-fbb2-4ed9-bfd2-53e0300ae15d/scratchpad/snap`, served by `vite preview --port 4173` from the user's terminal. Rebuild:
  `SNAP=<that path>; git -C $SNAP checkout -q --detach main && (cd $SNAP && PATH="$HOME/.local/node/bin:$PATH" npx vite build --outDir $SNAP/dist)` — then tell the user to reload. If that worktree is gone, make a new one and ask the user to restart `vite preview --outDir <wt>/dist --port 4173 --strictPort`.

## Tools
- **Parallel push:** `/private/tmp/ds-wt <name> <prompt-file>` → new worktree `…/94a3f1af-f186-4767-8ce0-d8d014f62978/scratchpad/wt-<name>` on branch `wt-<name>` off `main`, node_modules symlinked, runs a copy of `~/.claude/bin/ds-push` (DeepSeek Flash 4.1 via OpenCode; watchdog + 3 retries) under nohup. Log `/private/tmp/gridiron-<name>.log` (ends `[push] … finished` / `GAVE UP`, then Flash's report). If `/private/tmp` was cleaned: recreate it (git worktree add + `ln -s` node_modules + copy of ds-push with `REPO=` pointed at the worktree).
- **Merge a push:** read the report; in the worktree `npm run build`, `npm run lint` (4), review `git diff`; `git add -A src && git commit` (trailer); in main `git merge --no-edit wt-<name>`; resolve conflicts keeping both sides (usual spots: `gameStore.ts` ScreenId/imports, `main.tsx` probe imports, `App.tsx`/`AppShell.tsx`, shared table props); rebuild + lint + offline checks in main; update the spec progress/verification log + backlog; commit; rebuild 4173; tell the user.
- **Offline verification with the real Madden data** (jiti does NOT load it): `~/.local/node/bin/node --import /private/tmp/gridiron-loader.mjs /private/tmp/gridiron-calib.mjs 33333,2222,5150 500 --eq --smoke=coach:4,personnel:4` (~6 s/seed). `/private/tmp/gridiron-shape.mjs <seed> <games>` prints statShape rows. Both import the MAIN repo; copy and change `repo` for a worktree. Browser: built-in browser pane at 5173; dev globals `__game`, `__world()`, `__simTest`, `__statShape`, `__careerSmoke`, `__gameDayEquivalence`, `__ratingSpread`, `__rookieProbe`, `__faFlowProbe`, `__skillProbe`.
- Current calibration (500 games, 33333 / 2222 / 5150): 23.7 pts/68.2%/65.0 plays/1.39 sacks/0.91 INT/4.84 ypc · 24.5/67.6/65.3/1.49/0.94/4.80 · 24.6/68.5/66.2/1.38/0.86/4.80 (passing ~262–269 yds). Equivalence 20/20; smokes 0/0.

## Running at handoff (check `pgrep -fl ds-push`)
| Name / branch | Spec | Prompt | Notes |
|---|---|---|---|
| `playbook` / `wt-playbook` | `NEXT_PHASE_L12_10.md` P1 B0–B4: fullback, route tree, formations × concepts playbook, sim draws from it, data-driven animation | /private/tmp/gridiron-playbook.txt | Big; calibration must hold. Since it branched I added `blitzRush` + `play.blitz` (playAnim/playsim) and the every-snap cap lift (playsim `canAsk`) — keep both on merge |
| `mastery` / `wt-mastery` | `NEXT_PHASE_L12_13.md` M1–M4: realistic starting mastery, learning from snaps + production, relative effects for every unit | /private/tmp/gridiron-mastery.txt | playsim.ts + playbook.ts |
| `contracts` / `wt-contracts` | `NEXT_PHASE_L12_14.md` C1–C5: **fixed 2025 cap $279.2M every season** (user: "keep it at 2025"), market sanity, dead-money fix, "Ask the GM to extend", how-it-works panel | /private/tmp/gridiron-contracts.txt | Pricing approved; culture's discount already in negotiation.ts |
If a push ran out of steps, finish leftovers yourself or send a continuation prompt listing exactly what's done/left.

## Queue — next, in order (user requests first)
1. `NEXT_PHASE_L12_14.md` **C6 GM requests desk** (HC asks the GM to extend, restructure for a push, get a trade/FA target, release) — after `contracts` merges.
2. `NEXT_PHASE_L12_15.md` **Stars are rare** (82 at 90+ today → ~25–32; monotonic OVR remap, attrs unchanged, OVR-keyed systems re-mapped, save migration) — after `contracts`.
3. `NEXT_PHASE_REALISM.md` **NFL 2015–2024 retune (approved) + R5 missed tackles** (explicit tackle attempts, MT/FMT stats, rating realism probes) — after `playbook` + `mastery` merge.
4. `NEXT_PHASE_L12_10.md` **P2**: B5 ratings in the animation, B6 pick formation → play on calls.
5. `NEXT_PHASE_UI.md` **UI Broadcast 2.0** (TV field first, then scorebug, dark mode, ⌘K, screen passes).
6. `FUTURES.md` rows 3 → 25 one by one.
- Small known items: extra points recorded at `startYard: 2` in playsim (should be 85; animation compensates via `snapYard`); one cosmetic speed spike in the routes animation (cb0, Quick Slant); planMatrix(800) result may be in `/private/tmp/e3-plan800.log`; balance cap use reads ~0.70–0.74 (contracts push re-checks).
- Nothing is blocked on the user.

## Done on 2026-10-08 (all on `main` and the stable build)
L12 P2 practice/keys · P4 + P5 every rating counts (`E1_W` 1.1, `E2_W` 1.0) + `__ratingSpread` + glossary · game day: jersey numbers, Space freezes mid-play, Play after a moment, extra-point spot, live box score, past-only play log, call every play (switch rebuilds to the play on screen; every-snap modes ask every snap), blitz rushers · real route trees + smooth motion · Stats Hub · Find a Player · History · Playoff picture (NFL seeding) · team pages + Scout a club · trade desk (hover cards, find deals for their players, by position, trade block with rare stars, column filters) · rookies on the NFL scale + old-save rescale · scouting Now/Ceiling ranges · calendar (FA March, draft April) · weekly hours removed · coach Ledger + "Success Rate" · AI QB rushing · skill points · Staff & Hiring redesign · Unit Grades by position · potential bubble · player hover cards · culture (cohesion → penalties/fumbles; winning-culture discount).
The user's rating-impact table (47/48 ratings used; RTE unused) can be regenerated from `RATING_INFO` in `src/game/data/ratingInfo.ts`.
