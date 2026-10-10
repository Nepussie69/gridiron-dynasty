// ─────────────────────────────────────────────────────────────────────────────
// Stadium data (FUTURES #6 Weather & stadiums, job W1).
//
// The home venue decides three things for the weather model: whether the roof
// is open (dome / retractable / open-air), the climate and latitude that drive
// temperature / wind / precipitation, and how loud the crowd is when the roof
// is closed. `altitude` is carried only where it matters (Denver, and a handful
// of high-mountain college programs) — the engine reads it for kicking.
//
// This file is pure data: nothing here draws an rng or touches the sim. The
// roof rules and the college region mapping are approximations; they live in
// data (`ROOF_RULES`, conference sets) rather than in `weather.ts` branches.
// ─────────────────────────────────────────────────────────────────────────────

import type { Team } from '../types'

export type Roof = 'open' | 'dome' | 'retractable'
export type Surface = 'grass' | 'turf' | 'hybrid'
export type Climate = 'cold' | 'temperate' | 'warm' | 'desert'

export interface Stadium {
  abbr: string
  name: string
  roof: Roof
  surface: Surface
  climate: Climate
  /** Degrees north; drives the seasonal temperature curve. */
  lat: number
  /** Feet above sea level, when it changes the ball flight. */
  altitude?: number
  /** 0–1 exposure to the wind (Great Lakes / Northeast / open plains). */
  windy: number
  /** 0–1 crowd loudness (Seattle/KC/New Orleans at the top). */
  loud: number
}

type Raw = [
  abbr: string,
  name: string,
  roof: Roof,
  surface: Surface,
  climate: Climate,
  lat: number,
  altitude: number,
  windy: number,
  loud: number,
]

// All 32 NFL venues. Values are real-world approximations: SoFi is the model's
// fixed-roof exception (open sides, treated as a dome so the ball is protected),
// the retractable clubs (ATL/ARI/DAL/HOU/IND) follow `ROOF_RULES`, and the
// climate buckets are rough latitude/coastline reads, not meteorology.
const RAW: Raw[] = [
  // AFC East
  ['BUF', 'Highmark Stadium', 'open', 'turf', 'cold', 42.77, 0, 0.9, 0.85],
  ['MIA', 'Hard Rock Stadium', 'open', 'grass', 'warm', 25.96, 0, 0.25, 0.55],
  ['NE', 'Gillette Stadium', 'open', 'turf', 'cold', 42.09, 0, 0.75, 0.6],
  ['NYJ', 'MetLife Stadium', 'open', 'turf', 'cold', 40.81, 0, 0.65, 0.5],
  // AFC North
  ['BAL', 'M&T Bank Stadium', 'open', 'grass', 'temperate', 39.28, 0, 0.4, 0.65],
  ['CIN', 'Paycor Stadium', 'open', 'turf', 'temperate', 39.1, 0, 0.35, 0.5],
  ['CLE', 'Huntington Bank Field', 'open', 'grass', 'cold', 41.5, 0, 0.8, 0.55],
  ['PIT', 'Acrisure Stadium', 'open', 'hybrid', 'cold', 40.44, 0, 0.5, 0.75],
  // AFC South
  ['HOU', 'NRG Stadium', 'retractable', 'turf', 'warm', 29.68, 0, 0.3, 0.6],
  ['IND', 'Lucas Oil Stadium', 'retractable', 'turf', 'cold', 39.76, 0, 0.35, 0.6],
  ['JAX', 'EverBank Stadium', 'open', 'grass', 'warm', 30.32, 0, 0.3, 0.4],
  ['TEN', 'Nissan Stadium', 'open', 'grass', 'temperate', 36.17, 0, 0.35, 0.5],
  // AFC West
  ['DEN', 'Empower Field', 'open', 'hybrid', 'cold', 39.74, 5280, 0.5, 0.65],
  ['KC', 'Arrowhead Stadium', 'open', 'hybrid', 'cold', 39.05, 0, 0.5, 1.0],
  ['LV', 'Allegiant Stadium', 'dome', 'turf', 'desert', 36.09, 0, 0.2, 0.6],
  ['LAC', 'SoFi Stadium', 'dome', 'turf', 'warm', 33.95, 0, 0.2, 0.5],
  // NFC East
  ['DAL', 'AT&T Stadium', 'retractable', 'turf', 'temperate', 32.75, 0, 0.3, 0.75],
  ['NYG', 'MetLife Stadium', 'open', 'turf', 'cold', 40.81, 0, 0.65, 0.5],
  ['PHI', 'Lincoln Financial Field', 'open', 'hybrid', 'cold', 39.9, 0, 0.5, 0.85],
  ['WAS', 'Northwest Stadium', 'open', 'grass', 'temperate', 38.91, 0, 0.4, 0.5],
  // NFC North
  ['CHI', 'Soldier Field', 'open', 'grass', 'cold', 41.86, 0, 0.85, 0.6],
  ['DET', 'Ford Field', 'dome', 'turf', 'cold', 42.33, 0, 0.3, 0.7],
  ['GB', 'Lambeau Field', 'open', 'hybrid', 'cold', 44.5, 0, 0.7, 0.75],
  ['MIN', 'U.S. Bank Stadium', 'dome', 'turf', 'cold', 44.97, 0, 0.25, 0.9],
  // NFC South
  ['ATL', 'Mercedes-Benz Stadium', 'retractable', 'turf', 'warm', 33.76, 0, 0.25, 0.6],
  ['CAR', 'Bank of America Stadium', 'open', 'grass', 'temperate', 35.23, 0, 0.35, 0.5],
  ['NO', 'Caesars Superdome', 'dome', 'turf', 'warm', 29.95, 0, 0.25, 0.95],
  ['TB', 'Raymond James Stadium', 'open', 'grass', 'warm', 27.98, 0, 0.35, 0.5],
  // NFC West
  ['ARI', 'State Farm Stadium', 'retractable', 'grass', 'desert', 33.53, 0, 0.3, 0.55],
  ['LA', 'SoFi Stadium', 'dome', 'turf', 'warm', 33.95, 0, 0.2, 0.5],
  ['SF', "Levi's Stadium", 'open', 'hybrid', 'temperate', 37.4, 0, 0.45, 0.55],
  ['SEA', 'Lumen Field', 'open', 'turf', 'temperate', 47.6, 0, 0.4, 1.0],
]

export const STADIUMS: Record<string, Stadium> = Object.fromEntries(
  RAW.map(([abbr, name, roof, surface, climate, lat, altitude, windy, loud]) => [
    abbr,
    { abbr, name, roof, surface, climate, lat, altitude: altitude > 0 ? altitude : undefined, windy, loud },
  ]),
)

// ── College defaults ─────────────────────────────────────────────────────────
// College clubs have no venue table in this build, so the region comes from the
// conference and the crowd from prestige. Always open-air (the roof rules only
// apply to the NFL), with the mountain programs carrying altitude.

const COLD_CONFERENCES = new Set(['Big Ten', 'MAC', 'MVFC', 'CAA', 'Patriot', 'Big Sky', 'Ivy', 'Independent'])
const DRY_CONFERENCES = new Set(['Mountain West'])

export function collegeClimate(conference: string): Climate {
  if (COLD_CONFERENCES.has(conference)) return 'cold'
  if (DRY_CONFERENCES.has(conference)) return 'desert'
  return 'warm'
}

const CLIMATE_LAT: Record<Climate, number> = { cold: 43, temperate: 37, warm: 31, desert: 35 }

/** A few high-altitude college programs, in feet (the ball flies there). */
const COLLEGE_ALTITUDE: Record<string, number> = {
  'Air Force': 6620,
  Wyoming: 7220,
  Colorado: 5340,
  BYU: 4550,
  Utah: 4600,
  'New Mexico': 5312,
  'Colorado State': 5003,
  'Utah State': 4765,
  'Boise State': 2739,
}

/** Default venue for a college club (open-air, conference region, prestige noise). */
export function collegeStadium(team: Team): Stadium {
  const climate = collegeClimate(team.conference)
  return {
    abbr: team.abbr,
    name: team.stadium,
    roof: 'open',
    surface: 'grass',
    climate,
    lat: CLIMATE_LAT[climate],
    altitude: COLLEGE_ALTITUDE[team.name],
    windy: climate === 'cold' ? 0.5 : climate === 'desert' ? 0.35 : 0.3,
    loud: Math.max(0, Math.min(1, (team.prestige - 55) / 40)),
  }
}

/** The venue for a club: the NFL table when present, else a college default. */
export function stadiumFor(team: Team): Stadium {
  return STADIUMS[team.abbr] ?? collegeStadium(team)
}
