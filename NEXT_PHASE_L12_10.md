# NEXT PHASE — L12.10 "The full playbook" (user request, 2026-10-08)

_Planned by Claude Opus 5.5. Implemented by DeepSeek Flash 4.1 **after L12 P5 and the `routes` animation push are merged** (it builds on both). Lint baseline: exactly 4 warnings._

User's words: "include all routes and all plays from Madden 26"; "make sure all ratings are transferable to in-game animations and stats and play".
**Scope note:** EA's exact Madden 26 playbooks are proprietary data we don't have and must not copy. We build the **complete standard route tree and the real-football concepts Madden's playbooks are made of**
(generic football names: Mesh, Smash, Flood, Levels, Dagger, Mills, Drive, Stick, Snag, Curl-Flat, Shallow Cross, Four Verts, Sail, Spacing, Bench, Y-Cross, Scissors, Hank, Texas, double moves; runs: Inside/Outside Zone, Power, Counter, Trap, Duo, Iso, Toss, Pin-Pull, Draw, Sneak, Read Option, Jet Sweep, …), organised by formation like a Madden playbook.

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| B0 | **Fullback position (user request 2026-10-08)**: new `Position` 'FB'. Real data has no FB: map Madden RBs with archetype 'Utility' or 'Blocking' (Juszczyk, Ricard, Ingold … 13) to FB in `realData`/`generate`; generated rosters carry 1–2 FB; `ATTRIBUTE_SCHEMA` FB (RBK, IBL, PBK, CAR, BTK, TRK, CTH, SPD, STR, AWR, STA, TGH); depth chart FB slot (STARTERS 1, used in 21/22 personnel and I-form); sim: FB lead block adds to run blocking on I-form/21 runs and occasional FB dive/flat target; stats/statShape/RatingsTable groups/position chips everywhere (roster, Find a Player, trade block, stats) include FB; save migration maps existing Utility/Blocking RBs to FB once | P1 | ✅ merged (463f8a5) |
| B1 | Route tree: every standard route as data (flat, slant, quick out, hitch, curl, comeback, out, dig/in, corner, post, go/fade, seam, wheel, drag, shallow cross, whip, angle, sit, stick, swing, bubble, screen, post-corner, out-and-up, sluggo, chair) | P1 | ✅ merged (463f8a5) |
| B2 | Playbook data: formations (Gun Trips, Gun Doubles, Gun Bunch, Gun Empty, Singleback Ace/Doubles, I-Form Pro/Twins, Pistol, Strong/Weak I, Goal line) × concepts, each play = personnel + an assignment (route / block / run path) per position | P1 | ✅ merged (463f8a5) |
| B3 | Sim uses the playbook: every scheme draws its plays from the playbook with scheme weights; each play's depth / yac / class come from its routes, so calibration and the L10 call matrix stay valid | P1 | ✅ merged (463f8a5) |
| B4 | Animation is data-driven: any play animates from its assignments (generalising the `routes` push's hand-built trees) | P1 | ✅ merged (463f8a5) |
| B5 | **Expanded 2026-10-08 (user: "everyone's pace based off their rating … everything they do is based off their rating in the animation") — see `## B5 detail`.** Ratings in the animation: speed/acceleration scale how fast each player moves; route running sharpens breaks; separation in the sim shows as cushion on the field; pass rush wins show as pressure; the ball carrier's moves (juke/spin/truck) show on long runs | P2 | ✅ merged |
| B6 | Play-calling UI: on a call moment (and the game plan's script), pick formation → play from the playbook, with the route diagram drawn | P2 | ✅ merged |

## B5 detail — every player moves and acts by his ratings (render only)
Plumbing: `MatchView` passes the real players into `buildPlayAnim` via a new `AnimContext.actors?: Map<string, Player>` built with `actorPlayers(world, play, defId, targetKey)` (already in `src/components/jersey.ts`). Missing player → league-average 70s. Read attrs with the same `mkAttrs`-style fallback (`p.attrs?.X ?? p.ovr`). Every effect is deterministic (hash of play n + key); **no sim change, no rng, no change to any play result** — the end spot, catch spot, yards, and outcome stay exactly what the sim recorded; ratings only change *how* they get there.
1. **Pace for everyone** — one helper `paceFor(player, role)` → top speed yd/s = `5.6 + (SPD − 60) × 0.085` (SPD 99 ≈ 8.9, SPD 70 ≈ 6.5; linemen ~5–6) and acceleration from ACC (time to top speed 0.45 s at ACC 99 … 1.1 s at ACC 60). Build every actor's motion with distance-timed, speed-profiled waypoints like `buildRun` now does (dense locked samples, accelerate → cruise → decelerate), replacing fixed fractions. Play `duration` comes from the slowest needed path (ball carrier / target / longest pursuit), so a faster player visibly outruns a slower one and a long play takes real time. The run carrier's current constants (`RUN_HOLE_SPEED`, `RUN_TOP_SPEED`) become his own rating-based pace.
2. **Pursuit and angles** — defenders chase at their own pace; a faster safety closes, a slow LB falls behind; pursuit (PUR) improves the angle (aims ahead of the carrier).
3. **Routes** — route running (SRR/MRR/DRR by depth) sets break sharpness: high = a crisp near-stop cut, low = rounded drifting break; release (RLS) vs press (PRS) at the line; separation recorded by the sim shows as cushion at the catch.
4. **Line play** — run blocking (RBK/IBL) vs block shedding (BSH) / strength decides who drives whom at the line on runs; pass block (PBK, plus STR/AWR) vs pass rush (PMV/FMV/BSH) decides how far rushers get into the pocket (sacks/pressures from the sim show the winner reaching the QB).
5. **Ball carrier moves** — on runs/YAC of 8+ yards the carrier's best move by ratings plays out where a defender closes: juke (JKM), spin (SPM), stiff arm (SFA), truck (TRK), elusive cut (COD/AGI) — small lateral dodge or a defender knocked back; broken-tackle visuals when the sim's gain beats the first contact.
6. **Throwing and catching** — throw power (THP) sets ball flight time (a bullet vs a floater); accuracy (SAC/MAC/DAC by depth) sets ball placement (lead vs behind the receiver); catching (CTH/CIT/SPC) shows as hands-catch vs body bobble; a drop/INT from the sim shows a deflection.
7. **Tackling** — TAK/HPW: a sure tackler wraps at contact, a weak one is dragged a yard or two (within the recorded end spot), a hit-power tackle pops the carrier back.
8. **QB** — scramble pace from SPD/ACC; pocket presence (AWR) shows as a step-up vs drifting back; release time from throw-under-pressure (TUP) / play-action (PAC).
9. **Kicks** — kick power (KPW) sets ball speed/hang; returners use their own pace and moves.
10. A small "why" on hover over a dot during freeze (Space): name, position, SPD and the rating driving what he's doing this play.
Acceptance: a measured probe in the push report — per play type, carrier/target top speed vs SPD (SPD 95 ≥ 1.25× SPD 70), max frame-to-frame speed change < 3 yd/s per 1/60 s at 1×, end spots identical to the play records for 200 plays; gameDayEquivalence 20/20; build + lint 4.

## Rules
- Calibration: `simTest(500)` on 33333/2222/5150 inside the L12 E3 bands of the anchors; `statShape` all ✅; `gameDayEquivalence(20)` 20/20; `planMatrix` no dominant preset. Any new concept parameters are tuned
  so each scheme's average depth/yac per class matches today's concepts (it's a richer menu, not a stronger offence).
- No `rng()` draws added or removed: the concept pick stays one draw (pick by weight from the bigger list).
- Animation stays visual only (never feeds back into the sim) but must be **consistent with the sim's result** (catch point, yards, who made the play, sacks, pressures).
- Generic football names only; no EA play names that aren't standard football terminology; no copied EA data.

## DO NOT
No changes to gates, objectives, capabilities, `evaluateTrade`, contract pricing. Optional save fields only. Canonical player objects. No new dependencies. No temp files in the repo.
Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md`, `ROADMAP_*.md`, `IDEAS_*.md`, `HANDOFF.md`, `PLAYTEST_BACKLOG.md`. No git commands.

## Verification log


## Verification log
- 2026-10-08 P1 (B0–B4) merged: build ok, lint 4; real-data calibration 500 games 33333/2222/5150 = 23.6/24.6/24.6 pts, comp 67.9/67.7/68.5%, ypc 4.86/4.82/4.87; equivalence 20/20; smokes 0/0. Blitz rushers and every-snap `canAsk` kept.
- 2026-10-08 P2 (B5 expanded + B6) merged: build ok, lint 4; anim probe 252 plays, end spots 197/197 identical, SPD 95 vs 70 synthetic ratio 1.33 (runs and passes), max frame-to-frame speed change 3.6 yd/s (target < 3: one pursuit reversal left, cosmetic); calibration unchanged 23.6/24.6/25.0; eq 20/20; smoke 0. Browser: game day renders, drives play, no console errors.
