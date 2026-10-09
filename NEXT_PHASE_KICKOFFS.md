# Post-score kickoffs — backlog 126

User: after a team scores there is no kick return in gameplay; fix it.

## Scope

Audit the current integrated realism chain first; preserve R17 kicking/onside/fakes and R18 coaching tendencies. Main currently emits kickoff after TD/PAT via stepTry, but both successful FG paths bypass resolveKickoff and directly reset field position. Opening/halftime kickoffs also bypass it. MatchView advances every play without an obvious kickoff filter. Do not assume every kickoff must be returned: keep genuine touchbacks and real return rates.

DeepSeek owns this fix in an isolated worktree after realism repair acceptance, before returner selectors and FUTURES. Other workers own other changes; never revert them or touch their worktrees.

## Requirements

- Every score that requires a restart gets an actual kickoff event, including made FG from both normal fourth-down and two-minute FG branches, TD followed by PAT/2-point attempt, defensive/return TD, and safety free kick. Include opening and second-half kickoff where supported. Preserve regulation-end/OT termination rules and avoid duplicate kicks.
- Failed FGs get correct possession at the miss spot, never a kickoff. PAT outcome must not skip restart. Chains of rare return TDs must resolve correctly.
- Realistic touchback/return decision with correct receiving player, yards, field position, possession, score and stats. Reuse resolveKickoff, clubReturners and existing return simulation. Keep RNG stream rules (no new/removed rng draws); deterministic hash only. Optional save fields only.
- Gameplay must show kick flight, returner catching/running with coverage, and the touchback when applicable; playlog/replay/fast-forward/manual stepping/call-every-play must include the event without jumping straight to scrimmage. Preserve Pause/Space, timeline and score synchronization. Check user's reported TD flow even if offline TD/PAT currently emits kickoff.
- Build pass, lint exactly4, real-data calib33333/2222/5150 ×500 --eq --smoke=coach:4,personnel:4, eq20/20, zero smoke errors/violations, all applicable NFL bands (points22–23.2), animation end spots100%. Do not force returns or weaken bands to hide a defect.
- Focused probes validate all scoring branches, missed FG, clock-end/OT, rare return scores, selected/automatic returners, actual kickoff frequency and return yards. Browser verify score → try → kickoff → next scrimmage in gameplay with visible real return (use deterministic seed giving a return) and touchback. Save measured evidence.

## Progress

| Item | Status |
|---|---|
| Post-score kickoff/return gameplay | Spec ready; queued after realism repair, ahead of returner selectors |
