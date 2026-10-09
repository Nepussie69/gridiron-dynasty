# NEXT PHASE — L12.15 "Stars are rare" (user request, 2026-10-08)

_Planned by Claude Opus 5.5. Implement with DeepSeek Flash **after the `contracts` push merges** (both key off OVR). Lint baseline 4._
User: "lower some players' ratings, only keep a few above 90 and more in the 80s, make it rarer to show who the standout or franchise players are — there are too many franchise players." Screenshot: Allen, Lamar, Chase, Garrett, Lane Johnson, Barkley, Jefferson all 99.

## Today (real Madden 26 data, 1,833 players)
99: 7 · 95–98: 24 · 90–94: 51 (→ **82 at 90+**, ~2.5 per club) · 85–89: 102 · 80–84: 184 · 75–79: 361 · 70–74: 488 · 60–69: 594 · <60: 22.

## Target distribution (whole league, OVR)
| Band | Target count | Meaning |
|---|---|---|
| 97–99 | 2–4 | the league's faces |
| 93–96 | 8–12 | franchise players |
| 90–92 | 12–18 | (so **~25–32 at 90+**, about one per club) |
| 85–89 | 70–90 | Pro Bowl level |
| 80–84 | 160–200 | quality starters |
| 70–79 | 650–750 | starters / key rotation |
| 60–69 | 650–750 | depth |
| < 60 | the rest | |

## Tasks
| Task | What | Status |
|---|---|---|
| S1 | `rescaleOvr(ovr)`: a monotonic piecewise-linear map from the real-data OVR quantiles to the target bands (order kept: Allen stays above Burrow), applied to **real-data players' `ovr` and `pot`** at data load (`realData`/`generate`), and to generated players and draft classes via the same curve so everyone shares one scale (rookie curve from L12.7 re-checked: no rookie > 76; R1 median ~70). `attrs` (the individual ratings the sim reads) are **unchanged**. | Implemented in wt-stars; pending acceptance |
| S2 | Everything that reads absolute OVR moves with it: contract market tiers (L12.14 values must keep the same $ for the same *rank*: map thresholds through `rescaleOvr`), trade values (`playerTradeValue`), star thresholds (trade block 88+, dev traits, X-Factor/Superstar bands, awards), AI depth/FA decisions, rookie rescale, team strength (`teamStrength` for fast sim / playoffs / AI) — recalibrate so league results hold (`simTest` 3 seeds in bands; fast-sim score spread unchanged). | Implemented in wt-stars; pending acceptance |
| S3 | Migration: one-time for existing saves (flag `world.ovrScaleV2`): apply `rescaleOvr` to every player's `ovr`/`pot` (and lastGrowth numbers), keep rank order. | Implemented in wt-stars; pending acceptance |
| S4 | Probe `__ovrDistribution()` prints the league bands vs targets per season over 6 seasons (development/aging/rookies must keep the shape: 90+ stays ~25–35). Tune growth caps if it drifts. | In progress; six-season flags/long-horizon scarcity failed stars4; stars5 tuning |

## Acceptance
build + lint 4; distribution inside the target bands at season 1 and after 6 seasons (3 seeds); `simTest(500)` in bands on 3 seeds; equivalence 20/20; smokes 0/0; cap use in band; contracts for the top-5 at each position unchanged in $ (same rank → same money).

## DO NOT
No sim formula changes beyond re-keying OVR thresholds; no rng; optional save fields only; canonical player objects; no new deps; no temp files in the repo; no `*.md` edits; no git commands.

## Verification log
- Codex review of stars4: build/lint4, equivalence20/20 and four-season smokes both paths0/0; simulation within0.4points of branch baseline, cap/market/dead-money and rookie probes pass. Six-season whole/active distribution flags fail on all3seeds, with early90+ trough and later overproduction; not accepted or merged. wt-stars safely integrated onto main eb720d6, retaining recovery stash; buildpasses. stars5 addresses growth/ceiling scarcity, migrated HOF peakOVR, new GM desk thresholds and remaining fallback consistency. Whole-pool versus active-roster population clarification remains pending; no bands relaxed or unsigned retirement added.

- Handover2026-10-09: stars5 selected/applied candidateL before overnight timeout; all retries exhausted, no final acceptance. stars6(`/private/tmp/gridiron-stars6.txt`) runs remaining S2/S3 audits and fresh verification; Claude receives ownership via CLAUDE_HANDOVER.md.
