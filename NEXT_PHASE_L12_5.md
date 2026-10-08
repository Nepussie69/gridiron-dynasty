# NEXT PHASE — L12.5 "Trade desk" (user playtest requests, 2026-10-08)

_Planned by Claude Opus 5.5 from the user's screenshots of the Trade Center. Implemented by DeepSeek Flash 4.1 in one push (T1–T5). Lint baseline: exactly 4 warnings._

## Progress
| Task | What | Push | Status |
|---|---|---|---|
| T1 | Hover a Find-deals offer to see the whole deal, itemized, without leaving the screen | P1 | not started |
| T2 | Hover a player to see his ratings without clicking | P1 | not started |
| T3 | Find deals for **their** players: packages from your roster/picks the other club accepts | P1 | not started |
| T4 | Find by position: "I want a WR" → best gettable players at that position with the cheapest package for each | P1 | not started |
| T5 | Trade block tab: players AI clubs are shopping (with a reason), plus your own block | P1 | not started |

User's words: "an easy way to highlight over the deal to see the full deal without changing screen"; "a highlight over players to see their rating without clicking on them";
"include what players you would like to trade for in position, also have find a deal for opposing players on the trade block and have a trade block tab in the trade screen".

## Files
`src/screens/Trades.tsx` (today: one screen, `AssetColumn` for each side, a Find-deals card fed by `findDeals` in `src/game/engine/trade.ts`).
New: `src/components/HoverCard.tsx`, `src/components/PlayerHoverCard.tsx`, `src/game/engine/tradeBlock.ts`. Search functions go in `trade.ts` next to `findDeals`.

## T1 — Deal hover card
- `HoverCard` (new, reusable): wraps a trigger; on mouse enter (180 ms delay) or keyboard focus shows a panel; hides on leave/blur/Escape. The panel is `position: fixed`, placed from the trigger's
  `getBoundingClientRect()` (below, or above if no room; clamped inside the viewport), so it is never clipped by a scrolling column (`AssetColumn` has `overflow-y-auto`). Rendered with `createPortal` to `document.body`.
  Touch: a tap on the trigger's small "ⓘ" opens it; tapping outside closes it. Uses theme tokens (`bg-surface`, `border-line`, `text-ink`, `shadow`), max width 360 px.
- Each offer card in the Find-deals list gets a HoverCard showing **both sides itemized**: "You give" / "You get"; per player: name, pos, OVR/POT, age, cap hit and years left, trade value; per pick: season, round,
  via-club, value. Footer: totals of value both ways and **this season's net cap change** for your club (cap hits in minus out). The one-line summary stays as is.

## T2 — Player hover card
- `PlayerHoverCard({ player })`: name, pos, age, OVR/POT, cap hit + years left, injury if any, scheme fit for **the viewer's club** (`fitLabel` with your OC/DC scheme, as Roster does), then the position
  group's composites (`COMPOSITES` from `ratingInfo.ts`) and the group's rating columns (`RATING_COLUMNS`), values from `playerAttrs(p)`, tinted like the Ratings tab (≥90/≥80/≥70/<70); missing keys omitted.
- Used on: player names in both `AssetColumn`s, every player inside the T1 deal card, T4 results and T5 rows. Hover only; clicking a row keeps today's behaviour (add/remove from the trade).

## T3 — Find deals for their players
- `findPackagesFor(world, userTeamId, playerId): DealOffer[]` in `trade.ts`. The target belongs to club X. Build candidate packages **from the user's assets** (players + tradeable picks), each checked with
  the existing `evaluateTrade(world, X, userTeamId, give, [target])` — keep only `accepted`:
  1. picks only: add the user's picks from cheapest upward until accepted (max 4 assets);
  2. one player: the user's single player whose value is closest above what's needed (try ascending value);
  3. player + pick: the best player below the needed value plus the cheapest pick(s) that close the gap;
  4. players only, greedy ascending value (max 3).
  Never offer a user's last body at a position (same rule as `findDeals`). Deduplicate, sort by **least total value given** first, return up to 5. Deterministic, no rng.
- UI: the partner column's player rows get the magnifier "Find deals" button too (beside the shadow star). The deals card then reads "Packages for James Cook III" and Load deal fills both sides as today.

## T4 — Find by position
- `findTargetsAtPosition(world, userTeamId, pos, opts: { minOvr?: number; maxAge?: number }): { player; teamId; offer: DealOffer }[]`: every other club's players at `pos` passing the filters, top 12 by OVR,
  each with its cheapest `findPackagesFor` package; drop players with no acceptable package; return up to 8, by OVR desc.
- UI: a "Find by position" tab (see T5 tabs): position chips (QB RB WR TE OT OG C DE DT LB CB S K P), "Min OVR" (60–95, default 75) and "Max age" (any / 26 / 29 / 32) selects, a results list: hover card,
  club crest, OVR/POT, age, cap hit, package summary (with T1 hover) and **Load deal** (switches to the Build tab with the deal loaded). Compute on button press ("Search"), not on every keystroke.

## T5 — Trade block tab
- Trade screen tabs: **Build a trade** (today's screen, default) | **Trade block** | **Find by position**. Keep the selected tab in component state.
- `tradeBlock(world): { playerId; teamId; reason: string }[]` (new `tradeBlock.ts`), deterministic for the current week (no rng; if you need variety use `hash32(teamId + week)`), AI clubs only. A player is on
  his club's block when one applies (first match gives the reason):
  - **Surplus** — "Surplus at CB": he's below the club's starters + 1 at his position on the depth chart and OVR ≥ 70;
  - **Rebuilding** — "Rebuilding — veteran": club win% < .400 after week 4 (or bottom-8 by team strength in the preseason), age ≥ 29, OVR ≥ 75;
  - **Expiring** — "Expiring deal": 1 contract year left, club not in a playoff spot, OVR ≥ 72;
  - **Misfit** — "Scheme misfit": `fitLabel` with his own club's scheme is 'Poor' and OVR ≥ 72.
  At most 3 per club (highest OVR first). Purely informational: **`evaluateTrade` is unchanged**; being on the block does not make a player cheaper.
- Tab content: a filterable list (position chips, min OVR, sort by OVR / trade value / age): hover card, club, reason badge, OVR/POT, age, cap hit, value, **Find deals** (T3, shown in place) and the shadow star when `canShadow`.
- **Your block**: on the Build tab, a small "On the block" toggle per player in your column; saved as optional `career.tradeBlock?: string[]` (max 5, drop ids no longer on your roster; reset nothing at season rollover).
  The Trade block tab starts with a "Your block" section listing those players with their top 3 `findDeals` offers each (computed when the tab opens) and Load deal.

## DO NOT
- Do not change `evaluateTrade`, `assetValue`, `playerTradeValue`, `pickTradeValue`, `findDeals`' behaviour, contract pricing, gates, objectives, capabilities, or any sim file (`playsim.ts`, `sim.ts`, `statAlloc.ts`).
- No `rng()` anywhere. No new dependencies. Canonical player objects (never copy). The only new save field is the optional `career.tradeBlock`.
- Do not edit `ORCHESTRATION_HANDOVER.md`, `OPENCODE_CONTINUE.md`, any `NEXT_PHASE*.md`, `ROADMAP_*.md`, `IDEAS_*.md`, `HANDOFF.md`. No git commands. No temp files in the repo.

**Acceptance:** build + lint exactly 4 warnings; hover cards open/close without layout shift and aren't clipped in the scrolling columns; `findPackagesFor` returns only deals `evaluateTrade` accepts
(self-check in your report with one example); Trade block shows 20–70 players league-wide with reasons; Find by position WR, min 75 returns results with Load deal working.

## Verification log
