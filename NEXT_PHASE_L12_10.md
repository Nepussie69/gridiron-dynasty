# NEXT PHASE — L12.10 "The full playbook" (user request, 2026-10-08)

_Planned by Claude Opus 5.5. Implemented by DeepSeek Flash 4.1 **after L12 P5 and the `routes` animation push are merged** (it builds on both). Lint baseline: exactly 4 warnings._

User's words: "include all routes and all plays from Madden 26"; "make sure all ratings are transferable to in-game animations and stats and play".
**Scope note:** EA's exact Madden 26 playbooks are proprietary data we don't have and must not copy. We build the **complete standard route tree and the real-football concepts Madden's playbooks are made of**
(generic football names: Mesh, Smash, Flood, Levels, Dagger, Mills, Drive, Stick, Snag, Curl-Flat, Shallow Cross, Four Verts, Sail, Spacing, Bench, Y-Cross, Scissors, Hank, Texas, double moves; runs: Inside/Outside Zone, Power, Counter, Trap, Duo, Iso, Toss, Pin-Pull, Draw, Sneak, Read Option, Jet Sweep, …), organised by formation like a Madden playbook.

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| B0 | **Fullback position (user request 2026-10-08)**: new `Position` 'FB'. Real data has no FB: map Madden RBs with archetype 'Utility' or 'Blocking' (Juszczyk, Ricard, Ingold … 13) to FB in `realData`/`generate`; generated rosters carry 1–2 FB; `ATTRIBUTE_SCHEMA` FB (RBK, IBL, PBK, CAR, BTK, TRK, CTH, SPD, STR, AWR, STA, TGH); depth chart FB slot (STARTERS 1, used in 21/22 personnel and I-form); sim: FB lead block adds to run blocking on I-form/21 runs and occasional FB dive/flat target; stats/statShape/RatingsTable groups/position chips everywhere (roster, Find a Player, trade block, stats) include FB; save migration maps existing Utility/Blocking RBs to FB once | P1 | not started |
| B1 | Route tree: every standard route as data (flat, slant, quick out, hitch, curl, comeback, out, dig/in, corner, post, go/fade, seam, wheel, drag, shallow cross, whip, angle, sit, stick, swing, bubble, screen, post-corner, out-and-up, sluggo, chair) | P1 | not started |
| B2 | Playbook data: formations (Gun Trips, Gun Doubles, Gun Bunch, Gun Empty, Singleback Ace/Doubles, I-Form Pro/Twins, Pistol, Strong/Weak I, Goal line) × concepts, each play = personnel + an assignment (route / block / run path) per position | P1 | not started |
| B3 | Sim uses the playbook: every scheme draws its plays from the playbook with scheme weights; each play's depth / yac / class come from its routes, so calibration and the L10 call matrix stay valid | P1 | not started |
| B4 | Animation is data-driven: any play animates from its assignments (generalising the `routes` push's hand-built trees) | P1 | not started |
| B5 | Ratings in the animation: speed/acceleration scale how fast each player moves; route running sharpens breaks; separation in the sim shows as cushion on the field; pass rush wins show as pressure; the ball carrier's moves (juke/spin/truck) show on long runs | P2 | not started |
| B6 | Play-calling UI: on a call moment (and the game plan's script), pick formation → play from the playbook, with the route diagram drawn | P2 | not started |

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
