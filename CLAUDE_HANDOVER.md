# Claude handover — Gridiron Dynasty

Prepared 2026-10-11 08:35 AEDT by Claude Opus 5.5 for a new chat (the previous chat's context got large). Read AGENTS.md first, then this file. `PLAYTEST_BACKLOG.md` rows 195–223 are this session's requests and results. Only ONE orchestrator chat at a time — the old chat stops once the new one takes over.

## First 5 minutes in the new chat

1. **Load first** (user rule, memory `keep-machine-responsive`): `uptime` — don't launch anything while the 1-minute load average is ≥ 4. Max 2 DeepSeek jobs at once (3 only when load is low and no calibration runs), one `nice -n 15` calibration at a time, at most one headless browser.
2. **Jobs:** `pgrep -fl "gridiron-work/ds-push-"` and `/Applications/OpenCode.app/Contents/Resources/opencode-cli api GET /api/session/active`. Any session listed whose ds-push is gone is an orphan → `opencode-cli api POST /api/session/<id>/interrupt` (memory `opencode-orphan-sessions`; it happened 3× this session).
3. **Running at handover (08:35):**
   - **B8 Broadcast integration** — a Claude sub-agent of the OLD chat, worktree `~/gridiron-work/wt/b8` (branch `wt-b8` off main `caf8c53`). It wires B6b replays into Game Day (liveView.ts + minimal MatchView hooks), checks the live camera is the B5 director, and runs the full review matrix. It writes `~/gridiron-work/logs/b8-report.out` and screenshots to `~/gridiron-work/logs/b8-shots/` when done. The new chat cannot message it; just wait for the report file (check `ls -la ~/gridiron-work/logs/b8-report.out` and `git -C ~/gridiron-work/wt/b8 status`). If it never appears (old chat closed early), relaunch B8 yourself from that worktree with the same brief (see "B8 brief" below).
   - **Challenges C2** — DeepSeek, worktree `~/gridiron-work/wt/challengesc2`, prompt `~/gridiron-work/prompts/challenges-c2.txt`, log `~/gridiron-work/logs/challengesc2.log`, verify `~/gridiron-work/logs/challenges-c2-verify.out`. Gate: reviews OFF calibration identical to `~/gridiron-work/logs/main-after-c1p1-calib.out`; reviews ON all bands pass with deltas within the spec limits.
   - **Primetime P4 UI** — DeepSeek job FINISHED its work (build, lint 4, check-hex, contrast, browser 1440/375 all green per its log) but exited 130 during teardown, so `~/gridiron-work/logs/primetime-p4-verify.out` may be missing. Worktree `~/gridiron-work/wt/primetimep4` changes `Schedule.tsx`, `Dashboard.tsx`, `GamePlanScreen.tsx`. **Review it yourself** (build, lint 4, check-hex on the 3 files, quick browser check at 1440 + 375, light/dark) and merge.
4. **State:** main `b4deefa` is ~32 commits ahead of origin (pushed at 06:47 with the user's ok). **Push needs the user's ok each time.** Stable 4173 serves `2d6a3fe` (rebuilt 08:0x with the user's ok, Broadcast 2.5D B1–B7) from `~/gridiron-work/rv-stable` via `vite preview --port 4173` in Terminal tab "stable 4173". The user asked to rebuild it again once B8 lands.

## How to finish Broadcast 2.5D (B8)

When `b8-report.out` exists: read it, `cd ~/gridiron-work/wt/b8`, build / lint exactly 4 / `bash scripts/check-hex.sh` / `node --experimental-strip-types scripts/check-contrast.ts` / `nice -n 15 node --experimental-strip-types scripts/check-broadcast.ts` / anim harness. Browser-check a real coached game yourself in the app's browser pane (add a `.claude/launch.json` entry on a free port, e.g. 4408): desktop 2.5D live, a big play → replay with telestration + Skip, a decision card, sim to end (no replays), phone 375 (top-down live, 2.5D replay). Note: when the browser pane is hidden rAF is throttled (fps reads ~1) — judge by per-frame ms. Then commit in the worktree, `git merge --no-edit wt-b8` on main, re-verify, update `NEXT_PHASE_ANIM_BROADCAST.md` progress table + backlog, and **rebuild stable 4173**:
`S=~/gridiron-work/rv-stable; git -C $S checkout -q --detach main && (cd $S && PATH="$HOME/.local/node/bin:$PATH" nice -n 10 npx vite build --outDir $S/dist)` then `curl -s http://localhost:4173/ | grep -o 'index-[^"]*\.js'` to confirm. Then offer the user a polish pass (replay length is a constant in replay.ts; occlusion ratio 0.677 accepted; pocket trapezoid on some sacks).

**B8 brief (if you must relaunch):** wire replays into Game Day via liveView.ts (replayPlan with the B7 Replays setting 'big'|'all'|'off', playback 'fast' when simming → never replays, ReplayPlayer + 'replay' director + attachTelestrator, Skip control + Space/Escape, user Replay button forces, phone replays in 2.5D, never block a decision card); live camera = B5 director + B4 shake; full review across play types × 2 seeds × 1440/375 × light/dark × CLE/PIT/KC; fix in broadcast/ files or minimal MatchView edits. APIs: `~/gridiron-work/logs/b6b-report.out`, `b7-verify.out`, `b4-verify.out`, `b6a-report.out`.

## What landed this session (all verified, on main)

- **UI redesign "Sunday Broadcast" complete:** D1–D7 (orchestrator fixed phone grid overflows and 44px tap targets in most), V1 (Claude: shims removed, 12px floor, kit 44px, BroadcastScope, Staff hiring preview uses `coordinatorEdge()`), heroSlab fix (17 clubs had unreadable slab ink). Merged `9ce3993`.
- **Broadcast 2.5D B1–B7 + B6a/B6b** (spec `NEXT_PHASE_ANIM_BROADCAST.md`): animation data, renderer, figures (60 fps; players 0.5–0.7 ms/frame), ball + effects, camera director (carrier 100% / ball ≥98% all play kinds, 0 jumps), broadcast graphics, telestrator replay, phone/quality/settings and the live 2.5D view in MatchView (phone defaults to top-down live).
- **Animation:** animcontact4 (double teams, route separation) + animfix (sackers on time 100%, credited rusher rushes, no stacked blitzers, screens/run fakes restored).
- **Engine:** vacant OC/DC = −4.5 (193) + tenure resets at the moment of change, AI seats backfilled (185, eng185b); K/P games played (149, kpgp + kpgp2); team pass identity spread 0.041–0.044 (passid2, one dial `PASS_ID_WIDEN 1.9`); Primetime P1 (night slots, stakes, caps); Challenges C1 (booth reviews display-only); Weather W1 (stadium data + weather model, not wired into the sim yet).
- **Specs written:** 11 FUTURES specs `NEXT_PHASE_FUT_*.md` (challenges, weather, halftime, trick plays, primetime, FA frenzy, injury decisions, playcalling, draft philosophy, choose coaches, future prospects).
- Latest main calibration: 93/93 bands, eq 20/20 (`~/gridiron-work/logs/main-after-c1p1-calib.out`).

## Queue after B8 / C2 / P4 (each has a spec; user approved this direction)

Weather W2 (wire weather into playsim — affects calibration; also fixes the wind sign bug noted in the spec), Clutch P2 (playsim), Challenges C3 (UI) + C4, Primetime P5 (clutch UI, after P2), Halftime H1, then FA frenzy FA1, Future prospects FP1, Injury decisions, Playcalling P1, Draft philosophy, Choose coaches, Trick plays. Jobs that edit `playsim.ts` must run one at a time. Prompts: write from the spec's phase row; existing ones are in `~/gridiron-work/prompts/`.

## Ground rules (unchanged, user-confirmed)

- Orchestrator plans + verifies; DeepSeek implements via `IDLE=1800 HARD=5400 ~/gridiron-work/ds-wt <name> <ABSOLUTE prompt> [base]` (or `~/gridiron-work/queue-chain.sh <base> name:prompt ...`); Claude sub-agents do taste-heavy/broadcast rendering work. Never merge unverified work; DeepSeek often stops before verifying (exit 130 or "waiting for calibration") — finish the checks yourself or send a short continuation reusing the worktree.
- Stable 4173 is rebuilt only when the user asks. No `git push` / Pages without the user's explicit ok for that push.
- Never commit `NEXT_PHASE.md`, `CLAUDE_RESUME.md`, `.claude/`. Leave `ORCHESTRATION_COORDINATION.md` alone. Commit trailer names your model.
- Every user request → a PLAYTEST_BACKLOG row. Status table after merges. Browser checks use isolated ports via `.claude/launch.json`, never 4173/5173.
- Claude cannot kill processes (permission classifier blocks it); leftover DeepSeek vite/Chrome processes need the user — give them `pkill` commands. Presentation-only jobs whose new files aren't imported by the sim skip calibration.

## Infrastructure (`~/gridiron-work/`)

`ds-wt`, `queue-chain.sh` (launches when < 4 `opencode-cli run`; honours env IDLE/HARD), `queue-launch.sh`, `keep-awake.sh` (running: caffeinate per ds-push job), `loader.mjs`, `calib.mjs`, `anim.mjs`, `passid.mjs`, `prompts/`, `logs/` (probes: animfix-probe, b1a/b1b/b4/b5a/b5b probes, eng185b-probe, kpgp-probe, primetime-p1-probe, weather-w1-probe; review findings `review-*.findings`), `wt/` (57 worktrees — merged ones can be cleaned up with the user's ok), `rv-stable` (stable 4173 build).
