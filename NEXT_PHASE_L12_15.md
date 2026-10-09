# NEXT PHASE — L12.15 "Stars are rare" (user request, 2026-10-08)

_Planned by Claude Opus 5.5. Implement with DeepSeek Flash **after the `contracts` push merges** (both key off OVR). Lint baseline 4._
User: "lower some players' ratings, only keep a few above 90 and more in the 80s, make it rarer to show who the standout or franchise players are — there are too many franchise players." Screenshot: Allen, Lamar, Chase, Garrett, Lane Johnson, Barkley, Jefferson all 99.

## Today (real Madden 26 data, 1,833 players)
99: 7 · 95–98: 24 · 90–94: 51 (→ **82 at 90+**, ~2.5 per club) · 85–89: 102 · 80–84: 184 · 75–79: 361 · 70–74: 488 · 60–69: 594 · <60: 22.

## Target distribution (whole league, OVR)

> **User decision 2026-10-09:** long-term (S4, seasons 2+) targets apply to **players on active NFL rosters only**. Unsigned free agents are excluded from the acceptance bands; whole-pool counts stay as a diagnostic, not a pass/fail. No unsigned-player retirement rule.
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
| S1 | `rescaleOvr(ovr)`: a monotonic piecewise-linear map from the real-data OVR quantiles to the target bands (order kept: Allen stays above Burrow), applied to **real-data players' `ovr` and `pot`** at data load (`realData`/`generate`), and to generated players and draft classes via the same curve so everyone shares one scale (rookie curve from L12.7 re-checked: no rookie > 76; R1 median ~70). `attrs` (the individual ratings the sim reads) are **unchanged**. | ✅ merged 2262df2 |
| S2 | Everything that reads absolute OVR moves with it: contract market tiers (L12.14 values must keep the same $ for the same *rank*: map thresholds through `rescaleOvr`), trade values (`playerTradeValue`), star thresholds (trade block 88+, dev traits, X-Factor/Superstar bands, awards), AI depth/FA decisions, rookie rescale, team strength (`teamStrength` for fast sim / playoffs / AI) — recalibrate so league results hold (`simTest` 3 seeds in bands; fast-sim score spread unchanged). | ✅ merged 2262df2 |
| S3 | Migration: one-time for existing saves (flag `world.ovrScaleV2`): apply `rescaleOvr` to every player's `ovr`/`pot` (and lastGrowth numbers), keep rank order. | ✅ merged 2262df2 |
| S4 | Probe `__ovrDistribution()` prints the league bands vs targets per season over 6 seasons (development/aging/rookies must keep the shape: 90+ stays ~25–35). Tune growth caps if it drifts. | 🔨 Season 1 exact (4/12/18); long-horizon active-roster drift (85-89 bulge, thin 60s, 97+ 0-1) → stars7 |

## Acceptance
build + lint 4; distribution inside the target bands at season 1 and after 6 seasons (3 seeds); `simTest(500)` in bands on 3 seeds; equivalence 20/20; smokes 0/0; cap use in band; contracts for the top-5 at each position unchanged in $ (same rank → same money).

## DO NOT
No sim formula changes beyond re-keying OVR thresholds; no rng; optional save fields only; canonical player objects; no new deps; no temp files in the repo; no `*.md` edits; no git commands.

## Verification log
- Codex review of stars4: build/lint4, equivalence20/20 and four-season smokes both paths0/0; simulation within0.4points of branch baseline, cap/market/dead-money and rookie probes pass. Six-season whole/active distribution flags fail on all3seeds, with early90+ trough and later overproduction; not accepted or merged. wt-stars safely integrated onto main eb720d6, retaining recovery stash; buildpasses. stars5 addresses growth/ceiling scarcity, migrated HOF peakOVR, new GM desk thresholds and remaining fallback consistency. Population clarified by the user 2026-10-09: accept on active rosters only; whole pool is diagnostic. No bands relaxed or unsigned retirement added.

- Handover2026-10-09: stars5 selected/applied candidateL before overnight timeout; all retries exhausted, no final acceptance. stars6(`/private/tmp/gridiron-stars6.txt`) runs remaining S2/S3 audits and fresh verification; Claude receives ownership via CLAUDE_HANDOVER.md.
- Claude 2026-10-09: stars6 reviewed and independently verified (build, lint 4, eq 20/20, smokes 0/0, SIM 23.9/24.5/24.6 vs 23.6/24.6/25.0; worker: GM desk 36/36, top-5 QB $58.1M, cap .76-.90 no over-cap, dead money OK, rookie max 76 / R1 median 72). Merged 2262df2 with S4 partial. Active rosters 2027-37: 90+ 26-37 (one 44), but 85-89 133-168, 80-84 225-258, 60-69 337-560, <60 150-230, 97-99 often 0-1. Follow-up stars7 (/private/tmp/gridiron-stars7.txt).
