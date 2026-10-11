# Claude handover — Gridiron Dynasty (2026-10-11 17:05 AEDT)

Read AGENTS.md first. Backlog rows 225–243 in `PLAYTEST_BACKLOG.md` are the previous chat's requests and results. Only ONE orchestrator chat at a time.

## Goal
Orchestrate the Gridiron Dynasty FUTURES queue and fix the user's playtest complaints, mainly making the Broadcast 2.5D play animation look like the design mockup `~/gridiron-work/logs/anim-b-broadcast25d-mockup.html`. DeepSeek implements; Claude plans, verifies and merges.

## Current state (main 003a327, ~60 commits ahead of origin, NOT pushed)
- **Merged this session:** Primetime P4, NFL-style schedule S1, Broadcast B8, FA frenzy FA1–FA3 (feature complete), Challenges C2, kickoff touchback fix, animflow round 1, Future prospects FP1.
- **Stable 4173:** rebuilt at 003a327 (`index-BNvtKTT5.js`) from `~/gridiron-work/rv-stable`.
- **Running at handover:**
  1. **animflow round 2 (Claude sub-agent of the old chat)** in `~/gridiron-work/wt/animflow`: pass timing (QB drops, time to throw ~1.0 s → 2.3–3.0 s) plus mockup side-by-sides. It writes a "Round 2" section in `~/gridiron-work/logs/animflow-report.out`. If that never appears and the worktree goes idle (mtime of `src/components/playAnim.ts`), relaunch a Claude sub-agent with `~/gridiron-work/prompts/animflow-round2.txt`.
  2. **Weather W2 (DeepSeek, continuation)** in `wt/weatherw2`; writes `logs/weather-w2-verify.out`. It's the only sim-editing job.
  3. **FP2 (DeepSeek, continuation)** in `wt/futureprospects2`. It fixes the FP1 horizon off-by-one in `futureClasses.ts` (futureClass(world,1) returned the CURRENT class; it must use seed and label season+n+1) and rewrites the FP1/FP2 probes over a real rollover. Writes `logs/fp2-verify.out`.

## Decisions and why
- **C2:** per-seed calibration swings of ±0.4 points are sample noise. A pooled reviews OFF/ON drift over 6 fresh seeds × 500 (`~/gridiron-work/c2-drift.mjs`) gave −0.03 points. Use that method whenever a single seed misses a band by ≤0.2.
- **FP2:** personnel smoke `finalLevel` 5→4 is accepted, because declares change who gets drafted. SIM, eq and balance stay identical.
- **FA3:** the March card lives in `Career.tsx`; `CareerHub.tsx` is the pre-career start screen.
- **Animation:** the problem was the generated motion data in `playAnim.ts`, not the 2.5D renderer; the figures already port the mockup's pose system. Judge by motion metrics (`logs/animflow-metrics.mjs`) and mid-play frames, never hero stills.

## Next steps
1. Check the three running jobs (`pgrep -fl ds-push-`, `opencode-cli api GET /api/session/active`, the verify/report files). For each: run the gates yourself, read the diff, merge, update the spec progress row and the backlog.
2. **W2:** weather OFF must be byte-identical to `logs/weather-w2-calib-before.out`, and weather ON must pass all bands. Then browser-check that nothing in the UI broke (W3 is the weather UI).
3. **animflow round 2:** review the mockup-vs frames and time-to-throw metrics, merge, then offer the user a 4173 rebuild.
4. **Queue (one `playsim.ts` job at a time):** Clutch P2 → Primetime P5 (clutch UI) → Challenges C3 UI (+C4) → Halftime H1 → FP3 UI (after FP2) → Weather W3 UI → Injury decisions / Playcalling / Draft philosophy / Choose coaches / Trick plays. Specs are in `NEXT_PHASE_FUT_*.md`; write prompts from each spec's phase row.
5. **Polish lists for the user:**
   - B8 replay polish in `NEXT_PHASE_ANIM_BROADCAST.md`.
   - FA3 wording: "0/7 days", "0 suitors" while leading, "behind on every factor" with no rivals.
   - P4: "Profile 2.5 of 4" shows a fraction.

## Gotchas
- **User rules:**
  - No `git push` or Pages until the user says, then push all commits in one go.
  - Rebuild 4173 only when asked.
  - Every user request gets a backlog row.
  - Keep load under 4, at most 2 DeepSeek jobs, one calibration at a time.
- **Calibration wait loop for prompts:** `while pgrep -f '/Users/aaron/.local/node/bin/nod[e] --import' >/dev/null; do sleep 60; done`. The `[e]` stops the pattern matching agents' own command lines; `pgrep -f calib.mjs` matches prompt text forever.
- **DeepSeek failure modes:**
  - It often hits its step limit or a network outage (ENOTFOUND opencode.ai) before writing the verify file. Send a continuation in the same worktree (`ds-wt <same name> <cont prompt>`).
  - ds-push RETRIES a job that has already finished after a late transport error. Kill the `ds-push-<name>` pid, then the `opencode-cli run` client, then interrupt the session.
- **DeepSeek cleanup:** jobs have edited out-of-scope markdown (C2 rewrote HANDOFF.md, since reverted) and left vite/Chrome running (check ports and kill them). `kill` works.
- **Browser pane:** too narrow to judge animation at 1440. Use the agents' full-res screenshots or zoom.
- **Driving the app from the console:** dev server plus `window.__game` / `window.__world()` (see `/private/var/folders/.../opencode/fa3-drive.mjs` pattern), e.g. advanceWeek loops to reach March.
- **Keep this chat lean:** read only the parts of big logs you need (sed/grep), and send broad reviews to sub-agents.

## Key files
- `PLAYTEST_BACKLOG.md` — every request and result (rows ≤243).
- `NEXT_PHASE_FUT_*.md`, `NEXT_PHASE_SCHEDULE.md`, `NEXT_PHASE_ANIM_BROADCAST.md` — specs with progress tables.
- `src/components/playAnim.ts`, `src/components/playLive.ts` — animation data (shared by top-down and 2.5D).
- `~/gridiron-work/prompts/` — all job prompts, including `*-cont.txt` continuations.
- `~/gridiron-work/logs/` — verify files, probes, calibration outputs, `animflow-shots/`.
