# Claude handover — Gridiron Dynasty

Prepared 2026-10-10 23:35 AEDT by Claude Opus 5.5 for a new chat. Read AGENTS.md first, then this file. `PLAYTEST_BACKLOG.md` rows 162–193 are tonight's requests and results. Only ONE orchestrator chat at a time — the old chat stops once the new one takes over.

## First 5 minutes in the new chat

1. **Jobs:** `pgrep -fl "gridiron-work/ds-push-"` should show nothing (all DeepSeek jobs finished at 23:30). Also run `/Applications/OpenCode.app/Contents/Resources/opencode-cli api GET /api/session/active` — expect `{"data":{}}`. If any session is listed that you did not launch, stop it with `opencode-cli api POST /api/session/<id>/interrupt` (see "OpenCode orphan sessions" below). No Claude sub-agents are running.
2. **State:** main `d424431` is 8 commits ahead of origin (`a473a26`) — docs/backlog plus the realism retune merge `2be4abe` (engine). **Push needs the user's ok.** Stable 4173 is still HELD (offer the rebuild; tonight's merges are a good point — see Queue).
3. **animcontact4 is UNFINISHED** in `~/gridiron-work/wt/animc4` (branch `wt-animc4`, uncommitted `playAnim.ts`). Core work done (double teams: overlaps 0, double-team rate 0.92, 7/9 sacks by the doubled rusher; route-running separation corr 0.38 with monotonic buckets 1.52→3.19 yd) but it still has debug (`globalThis.__AC4PLAN` PW block in passProtect, `__AC4MAN` at the end of manTrail, OVL debug in `~/gridiron-work/logs/animcontact4-probe.mjs`), an experimental `runTimed(def, shape, fromSec, toSec, false, false, 4.0)` in manTrail, and NO final verification. Launch a short continuation (prompt: strip debug, settle the manTrail runTimed config and re-measure catch separation, then build, lint exactly 4, `anim.mjs 33333 2` end 100%, full probe, calibration IDENTICAL; write `~/gridiron-work/logs/animcontact4-verify.out`) with `IDLE=1800 ~/gridiron-work/ds-wt animc4 <ABSOLUTE prompt path>` (reuses the worktree). Then review, merge.
4. **UI redesign D1–D7 are ready to launch** (prompts `~/gridiron-work/prompts/ui-d1.txt` … `ui-d7.txt`). They must branch off `ui-redesign`, NOT main: `IDLE=1800 ~/gridiron-work/ds-wt uid1 $HOME/gridiron-work/prompts/ui-d1.txt ui-redesign` (third arg = base). Max 4 DeepSeek jobs at once (`queue-launch.sh <name> <prompt> [base]` waits for a free slot). **D5 (game day: MatchView/playAnim/fieldPos) must wait until animcontact4 is merged** — same file.
5. Decisions waiting on the user (ask early): (a) engine fix for backlog 193 (vacant coordinator counts as league average → firing a floor coordinator improves the edge −4.5 → 0; exploit) together with backlog 185 (scheme-tenure bug); (b) Cleveland light-mode accent is brown #311D00 by the colour rule — mockup used orange; one-line per-club override if wanted; (c) stable 4173 rebuild; (d) push main.

## Ground rules (unchanged, user-confirmed)

- Orchestrator plans + verifies; DeepSeek implements screen/engine jobs. Claude sub-agents built the redesign foundation (F0–F4) — keep the taste-heavy/foundation work on Claude, mechanical rollout on DeepSeek. Never merge unverified work.
- **Stable 4173 HELD** — do not rebuild until the user says so. **No `git push` / Pages without explicit user ok for that push.**
- Never commit `NEXT_PHASE.md`, `CLAUDE_RESUME.md`, `.claude/`. Leave `ORCHESTRATION_COORDINATION.md` alone. Commit trailer names your model.
- Every user request → a PLAYTEST_BACKLOG row. Status table after merges. Never touch the user's real 4173/5173/Pages origins; browser checks use isolated ports (4429–4438 used tonight) via `.claude/launch.json` and throwaway careers.

## What landed on main tonight (all verified)

- **Realism engine complete (FUTURES 1b):** fc60c43 integrated with main's L13 user personnel packages (integ-realism: realism decides the eleven, user packages shape it), then **retune2** (`2be4abe`, 5 R2 constants: missYardsRange 4→3, missPassBump 0.16→0.20, talentTilt 0.02→0.03, yacCal 1.03, pace 0.838) → **93/93 bands** on 33333/2222/5150 ×500, eq 20/20, smokes 0/0. Margins are thin (+0.03). Team pass-identity spread is ~0.026–0.031 (NFL 0.035–0.045) — follow-up job queued. Penalty mix T5 was tried and REJECTED (overshoots points on current main).
- **Real kickoffs** (34d4394) + **special-teams calls FUTURES #4** (stcalls + fix1 + fix2); made FGs kick off through the kickoff phase so a late FG asks the user's kickoff call (probe `logs/fgko-probe.mjs`: 319/319).
- **animcontact3c** animation: no frozen carriers, tackles connect, uncovered receivers 1699→~40, idle coverage defenders 0.
- **Cap Freed column** (Contract Ledger), **NFL set pieces** (trade deadline / bye-week self-scout / install / deadline cap room), **college leftovers removed** (Career ladder = NFL rungs; firing news), **cap-colour bug fixed** (capSpaceTone in capMemo.ts: <0 red, <$5M amber, >$25M green).

## UI redesign "Sunday Broadcast" (branch `ui-redesign`, worktree `~/gridiron-work/wt/ui-redesign`, NOT merged)

Spec `NEXT_PHASE_UI_REDESIGN.md` (progress table up to date), mockups `docs/redesign/`. Chosen by the user from 3 directions after a 12-agent audit/design/judge workflow.
- F0+F1 `f25f84f` tokens, team-colour contrast (`src/lib/teamColor.ts`, `scripts/check-contrast.ts` 342/342 PASS), rating tiers, `scripts/check-hex.sh`.
- F2 `d629294` kit (`src/ui/*`: RatingTile, KPI strip/meters, Effect/Money, SchemeChip, controls, OverflowMenu, Dialog/Sheet/ConfirmSheet, Inspector, GatedAction/AccessBanner, Avatar/VacantSeat, ScoreBlock; shared DataTable with phone card rows; hidden showcase at `#/kit`).
- F3 `851bc3d` top bar / sidebar / phone shell (`src/ui/nav.ts`).
- F4 `1e69dc4` Staff & Hiring pilot + **`src/screens/README-pattern.md`** (the pattern D1–D7 copy).
- Next: D1–D7 (DeepSeek, parallel worktrees off `ui-redesign`, non-overlapping files) → V1 integration (Claude) → merge `ui-redesign` into main → offer 4173 rebuild. Review each D job: build, lint 4, contrast PASS, check-hex clean, browser check 375 + 1440, light + dark, CLE/PIT/KC; features kept.

## Gameplay graphics — user chose B "Broadcast 2.5D" (FUTURES #31)

Spec `NEXT_PHASE_ANIM_BROADCAST.md` (phases B1–B8, ~12–16 jobs). Mockups `docs/anim-mockups/` (A All-22, **B chosen**, C Hybrid). Starts after D5 + animcontact4. Phone defaults to top-down live + 2.5D replays; desktop/tablet 2.5D live; Auto/Full/Lite quality. Measured on this M5: mockup B steady 60 fps at 375 px; draw cost ~6–7 ms/frame. The user confirmed all realism/animation work carries into B (B projects the same `playAnim` paths).

## Infrastructure — everything in `~/gridiron-work/` (NOT /private/tmp)

Same as before (`loader.mjs`, `calib.mjs`, `anim.mjs`, `passid.mjs`, `ds-wt`, `queue-launch.sh`, `prompts/`, `logs/`, `rec/` backups). New tonight:
- **OpenCode orphan sessions (important):** killing an `opencode-cli run` client does NOT stop its server-side session, and OpenCode 2.0.26+ auto-resumes interrupted sessions after a service restart. At 21:15 an OpenCode auto-update resumed 9 old sessions that edited the same worktrees at once. `~/.claude/bin/ds-push` now calls `stop_session` (interrupts the try's session via `opencode-cli api POST /api/session/<id>/interrupt`) after any killed/failed try — it worked on animc4's retry. Check `/api/session/active` before relaunching anything. Memory note: `opencode-orphan-sessions`.
- Lost worktree state can be recovered from OpenCode step snapshots (`"snapshot":"<tree>"` in the events file; `git --git-dir=~/.local/share/opencode/snapshot/<project>/<repo> show "<tree>:path"`).
- `ds-wt <name> <ABSOLUTE prompt> [base]`; env `IDLE` (default 600; use 1800 for long verification) and `HARD` (default 2700).
- Probes: `logs/stcalls-probe.mjs`, `logs/fgko-probe.mjs`, `logs/animcontact3-probe.mjs`, `logs/animcontact4-probe.mjs` (has debug to remove).
- Old worktrees that can be removed once merged work is confirmed: integ, integ-anim, integ-st, pen-t5, retune1, retune2, rt2v, rv-ko, kickoffs, stcalls, capfreed, collegeleft, nflsetpieces, animcontact, realism, returners, ledgerovr, draftpos (branches too). Keep `ui-redesign` and `animc4`.

## Queue (after the above)

1. animcontact4 continuation → merge.
2. D1–D7 (D5 after animcontact4) → V1 → merge redesign → offer 4173 rebuild.
3. Engine fixes 185 + 193 (with user ok), team pass-identity restore, K/P games-played fix.
4. B · Broadcast 2.5D (B1–B8).
5. FUTURES: #30 animation realism, #5 challenges, #6 weather, #7 halftime speech, #8 primetime, #11 FA frenzy, #15 injury decisions, #24 trick plays, #26 coach playcalling, #27 draft philosophy, #28 choose coordinators, #29 future prospects tab.

Usage at 23:30: 5-hour window ~31% (resets 00:40), weekly ~5%.
