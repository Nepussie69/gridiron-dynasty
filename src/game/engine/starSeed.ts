import type { Position } from '../types'
import { rated } from '../data/ratings'

// Curated standout players, sourced from Madden NFL 26 / College Football 26 overalls
// via ratings.ts. `rated()` overrides the fallback with the real value when known.
// Phase "real data" work replaces this with a full roster pipeline.

type StarTuple = [name: string, pos: Position, fallback: number]

const SEED: Record<string, StarTuple[]> = {
  KC: [['Patrick Mahomes', 'QB', 99], ['Travis Kelce', 'TE', 92], ['Chris Jones', 'DT', 96], ['Creed Humphrey', 'C', 91]],
  BUF: [['Josh Allen', 'QB', 98], ['James Cook', 'RB', 88], ['Von Miller', 'DE', 80]],
  CIN: [['Joe Burrow', 'QB', 96], ["Ja'Marr Chase", 'WR', 97], ['Trey Hendrickson', 'DE', 90]],
  BAL: [['Lamar Jackson', 'QB', 97], ['Roquan Smith', 'LB', 90], ['Zay Flowers', 'WR', 85]],
  PHI: [['Jalen Hurts', 'QB', 92], ['A.J. Brown', 'WR', 93], ['Saquon Barkley', 'RB', 95], ['Landon Dickerson', 'OG', 88]],
  DAL: [['Dak Prescott', 'QB', 89], ['CeeDee Lamb', 'WR', 94], ['Micah Parsons', 'LB', 95]],
  SF: [['Christian McCaffrey', 'RB', 94], ['Nick Bosa', 'DE', 95], ['Fred Warner', 'LB', 95], ['George Kittle', 'TE', 92]],
  DET: [['Jared Goff', 'QB', 88], ['Amon-Ra St. Brown', 'WR', 93], ['Aidan Hutchinson', 'DE', 91]],
  GB: [['Jordan Love', 'QB', 86], ['Josh Jacobs', 'RB', 87]],
  MIN: [['Justin Jefferson', 'WR', 96]],
  LA: [['Matthew Stafford', 'QB', 87], ['Puka Nacua', 'WR', 89]],
  LAC: [['Justin Herbert', 'QB', 91], ['Derwin James', 'S', 90]],
  HOU: [['C.J. Stroud', 'QB', 88], ['Will Anderson Jr.', 'DE', 89]],
  JAX: [['Trevor Lawrence', 'QB', 84], ['Josh Hines-Allen', 'DE', 87]],
  IND: [['Jonathan Taylor', 'RB', 91], ['Quenton Nelson', 'OG', 91]],
  NYJ: [['Sauce Gardner', 'CB', 91], ['Quinnen Williams', 'DT', 90]],
  MIA: [['Tyreek Hill', 'WR', 94]],
  NE: [['Drake Maye', 'QB', 82]],
  PIT: [['T.J. Watt', 'LB', 94], ['Minkah Fitzpatrick', 'S', 89]],
  CLE: [['Myles Garrett', 'DE', 97]],
  DEN: [['Bo Nix', 'QB', 82], ['Pat Surtain II', 'CB', 94]],
  LV: [['Maxx Crosby', 'DE', 92]],
  TEN: [['Jeffery Simmons', 'DT', 89]],
  WAS: [['Jayden Daniels', 'QB', 89], ['Terry McLaurin', 'WR', 89]],
  NYG: [['Malik Nabers', 'WR', 87], ['Dexter Lawrence', 'DT', 91]],
  CHI: [['Caleb Williams', 'QB', 84], ['D.J. Moore', 'WR', 87], ['Montez Sweat', 'DE', 84]],
  ATL: [['Bijan Robinson', 'RB', 92], ['Drake London', 'WR', 87]],
  CAR: [['Bryce Young', 'QB', 78]],
  NO: [['Alvin Kamara', 'RB', 84]],
  TB: [['Baker Mayfield', 'QB', 86], ['Mike Evans', 'WR', 87]],
  ARI: [['Kyler Murray', 'QB', 84], ['Marvin Harrison Jr.', 'WR', 84]],
  SEA: [['Kenneth Walker III', 'RB', 86]],
  // College standouts (CFB 26)
  'Ohio State': [['Jeremiah Smith', 'WR', 98], ['Caleb Downs', 'S', 96]],
  'Notre Dame': [['Jeremiyah Love', 'RB', 95], ['Leonard Moore', 'CB', 97]],
  Texas: [['Anthony Hill Jr.', 'LB', 95]],
  'Penn State': [['Nicholas Singleton', 'RB', 93]],
  Oregon: [['Makhi Hughes', 'RB', 92]],
  Louisville: [['Isaac Brown', 'RB', 93]],
  LSU: [['Garrett Nussmeier', 'QB', 90]],
  'South Carolina': [['Lanorris Sellers', 'QB', 90]],
  'Texas A&M': [['Dylan Stewart', 'DE', 91]],
}

export const STARS: Record<string, StarTuple[]> = Object.fromEntries(
  Object.entries(SEED).map(([teamId, list]) => [
    teamId,
    list.map(([name, pos, fallback]) => [name, pos, rated(name, fallback)] as StarTuple),
  ]),
)
