// ─────────────────────────────────────────────────────────────────────────────
// Club markets (FUTURES #50 Market & fans).
//
// The 32 NFL clubs carry a market: the size of the city/metro they draw from,
// the seats their stadium can sell, and how deep and rabid the following is.
// Revenue follows from those three plus the season the club just played.
//
// This file is pure data — nothing here draws an rng or touches the sim.
//
// SOURCES
//   • `metro`  — US Census Bureau 2023 metropolitan statistical area population
//     estimates (NY-NJ-PA 19.50M, LA-Long Beach 12.80M, Chicago 9.28M,
//     Dallas-Fort Worth 8.10M, Houston 7.51M, Atlanta 6.31M, Washington 6.30M,
//     Miami 6.30M, Philadelphia 6.25M, Phoenix 5.07M, Boston 4.92M,
//     San Francisco Bay 4.60M, Detroit 4.34M, Seattle 4.03M, Minneapolis 3.69M,
//     Tampa 3.24M, Denver 2.99M, Baltimore 2.83M, Charlotte 2.79M, Pittsburgh
//     2.42M, Las Vegas 2.32M, Cincinnati 2.27M, Kansas City 2.21M, Cleveland
//     2.16M, Indianapolis 2.14M, Nashville 2.10M, Jacksonville 1.71M, New
//     Orleans 1.26M, Buffalo 1.16M, Green Bay 0.33M). Clubs that share a metro
//     (NYG/NYJ, LA/LAC) share the population.
//   • `capacity` — listed stadium seating capacities for the 2024 season
//     (MetLife 82,500 the largest; Green Bay 81,441; Soldier Field 61,500).
//   • `intensity` — a considered 0–100 read of fan-base depth per club, from
//     sellout history (Green Bay has sold out since 1960), national following
//     (Dallas, Pittsburgh, Kansas City, Philadelphia), and the club's own long
//     run of local support. Judgement, not a single published table.
//
// The derived market index (market.ts) blends metro reach with intensity; the
// data here is the raw truth so the model can be re-tuned without touching it.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClubMarket {
  abbr: string
  /** Metropolitan statistical area population, in millions (US Census 2023). */
  metro: number
  /** Listed stadium seating capacity (2024). */
  capacity: number
  /** Fan-base depth 0–100: how large and rabid the following runs. */
  intensity: number
}

// [abbr, metro (M), capacity (seats), intensity (0–100)]
type Raw = [abbr: string, metro: number, capacity: number, intensity: number]

const RAW: Raw[] = [
  // AFC East
  ['BUF', 1.16, 71608, 88],
  ['MIA', 6.3, 65326, 72],
  ['NE', 4.92, 65878, 86],
  ['NYJ', 19.5, 82500, 70],
  // AFC North
  ['BAL', 2.83, 70745, 74],
  ['CIN', 2.27, 65515, 74],
  ['CLE', 2.16, 67431, 80],
  ['PIT', 2.42, 68400, 90],
  // AFC South
  ['HOU', 7.51, 72220, 76],
  ['IND', 2.14, 67000, 70],
  ['JAX', 1.71, 67814, 66],
  ['TEN', 2.1, 69143, 68],
  // AFC West
  ['DEN', 2.99, 76125, 82],
  ['KC', 2.21, 76416, 90],
  ['LV', 2.32, 65000, 72],
  ['LAC', 12.8, 70240, 62],
  // NFC East
  ['DAL', 8.1, 80000, 92],
  ['NYG', 19.5, 82500, 78],
  ['PHI', 6.25, 69796, 89],
  ['WAS', 6.3, 67617, 72],
  // NFC North
  ['CHI', 9.28, 61500, 82],
  ['DET', 4.34, 65000, 76],
  ['GB', 0.33, 81441, 96],
  ['MIN', 3.69, 66655, 78],
  // NFC South
  ['ATL', 6.31, 71000, 68],
  ['CAR', 2.79, 74867, 66],
  ['NO', 1.26, 73208, 86],
  ['TB', 3.24, 65890, 70],
  // NFC West
  ['ARI', 5.07, 63400, 66],
  ['LA', 12.8, 70240, 70],
  ['SF', 4.6, 68500, 84],
  ['SEA', 4.03, 68740, 85],
]

export const NFL_MARKETS: Record<string, ClubMarket> = Object.fromEntries(
  RAW.map(([abbr, metro, capacity, intensity]) => [abbr, { abbr, metro, capacity, intensity }]),
)

/** The league's flat shared national media money per club per season (all clubs equal). */
export const NATIONAL_MEDIA = 250_000_000
