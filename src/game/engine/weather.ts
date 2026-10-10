// ─────────────────────────────────────────────────────────────────────────────
// Weather & stadiums (FUTURES #6), job W1: the data + model.
//
// Weather is a PURE FUNCTION, never saved state. `gameWeather` hashes
// `${season}:${week}:${gameId}` (the same string-hash trick the rest of the
// engine uses) and combines it with the home venue's roof and climate, so the
// same inputs always produce the same conditions: old saves stay valid, and the
// coached and fast paths see identical weather.
//
// No rng() draw is added or removed here, and nothing in the sim imports this
// module yet (W2 wires it). `setWeather(false)` makes `wxEffects` exactly
// neutral, so a pre-feature calibration stays byte-identical.
//
// WIND SIGN NOTE for W2 (do not fix here): `R17.windPerMph` documents positive
// wind as "into the kicker's face", but `playsim.ts` ADDS `wind * windPerMph`
// to the FG/PAT make chance and `wind * 0.3` to punt gross — so a headwind
// currently helps the kick. `wxEffects` returns the corrected view: `headwind`
// is positive into the face, `kickMakeAdd` is already negative for a headwind,
// and `puntAdd` already shortens into the wind. W2 must flip the two `playsim`
// hook signs.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp, hash32 } from './rng'
import { analyticsRating } from './analytics'
import { stadiumFor, type Climate, type Roof, type Stadium } from '../data/stadiums'
import type { World } from './generate'

// ── Tunables ─────────────────────────────────────────────────────────────────
// One constants object, the same pattern as R17. `WX_CENTER` (below) is the
// expectation of the raw effects over a full NFL season's weather mix, so the
// league mean does not move when weather is on.
export const WX = {
  // Roof. Domes are always closed. A retractable roof closes when it is cold,
  // hot, wet or windy (or occasionally for noise: `retractClosePolicy`).
  retractOpenF: 62,
  retractHeatF: 86,
  retractCloseWindMph: 14,
  retractClosePolicy: 0.12,
  domeTempF: 72,
  closedLoudAdd: 0.1,

  // Temperature: `mean + amp * seasonal(doy) + bell * tempJitterF`.
  tempJitterF: 14,

  // Wind (open-air only).
  windBaseMph: 2.5,
  windWindyMph: 9,
  windWinterMph: 2,
  windJitterMph: 10,
  windCapMph: 32,

  // Precipitation.
  snowMaxF: 34,
  winterPrecipBump: 0.06,
  warmStormBump: 0.02,

  // Kicking. `kickHeadPerMph` mirrors R17.windPerMph (the fixed-sign version).
  kickHeadPerMph: 0.006,
  kickAccPerMph: 0.0015,
  kickRangePerMph: 0.3,
  coldKickYds: 2,
  puntPerMph: 0.3,
  kickoffPerMph: 0.5,

  // Deep balls (depth >= 15): only the total wind matters, not its direction.
  deepWindStart: 10,
  deepWindSpan: 12,
  deepCatchRel: 0.12,
  deepIntRel: 0.1,

  // Rain / snow ball security and footing.
  fumbleWet: 0.25,
  dropWet: 0.12,
  muffWet: 0.12,
  footingCut: 0.04,

  // Cold (< 32 F) raises drop/fumble chance up to +8%.
  coldBallF: 32,
  coldBallRel: 0.08,

  // Crowd noise: the away offense's false-start weight, on top of the existing
  // 1.25 road mix. Kept as a fraction of that mix (`0.25 * loud`).
  crowd: 0.25,

  // Forecast. The actual value lands inside the (rounded) range ~80% of the
  // time, so the error is drawn at `half / forecastHitRate` (the divisor also
  // absorbs the half-degree of rounding slack); an analytics department shrinks
  // both the error and the range together.
  forecastTempHalf: 5,
  forecastWindHalf: 4,
  forecastHitRate: 0.72,
  forecastNarrow: 0.6,
} as const

/**
 * Precomputed by `weatherProbe` (W2 re-tunes): the mean of each RAW effect over
 * a full season's weather mix. `wxEffects` divides multiplicative effects by
 * their center and subtracts additive offsets, so domes run slightly above
 * baseline, bad weather below, and the league mean stays put.
 */
export const WX_CENTER: Record<string, number> = {
  kickMakeAdd: -0.008,
  kickRangeYds: -0.048,
  puntAdd: 0,
  kickoffAdd: 0,
  deepCatchMult: 0.99,
  deepIntMult: 1.008,
  fumbleMult: 1.022,
  dropMult: 1.011,
  muffMult: 1.011,
  runVarianceMult: 0.997,
  pressureMult: 0.997,
  falseStartMult: 1,
  loud: 0.666,
}

// ── Types ────────────────────────────────────────────────────────────────────
export type Precip = 'none' | 'rain' | 'snow'

export interface GameWeather {
  roof: Roof
  closed: boolean
  /** Field temperature, F. Neutral (dome temperature) when the roof is closed. */
  tempF: number
  /** Total wind speed, mph. Zero when the roof is closed. */
  windMph: number
  /** Signed along-field component, mph (|windAlong| <= windMph). */
  windAlong: number
  precip: Precip
  /** 0–1 precipitation strength (0 when none). */
  intensity: number
  /** Effective crowd loudness, 0–1 (closed roofs add `closedLoudAdd`). */
  loud: number
  /** Feet above sea level, when the venue is high enough for it to matter. */
  altitude: number
}

/** The minimal game shape `gameWeather` needs (a schedule `Game` fits). */
export interface WeatherGame {
  id: string
  week: number
  homeId: string
  postseason?: boolean
}

/** Bounded multipliers / offsets for W2 to apply on the existing draws. */
export interface WxEffects {
  /** Signed along-field wind for this offense, mph. Positive = into the face. */
  headwind: number
  /** FG/PAT make-probability change (headwind + accuracy). Already sign-fixed. */
  kickMakeAdd: number
  /** Effective FG range change, yards (+ = longer) for decisions / AI. */
  kickRangeYds: number
  /** Punt gross change, yards (+ = longer). */
  puntAdd: number
  /** Kickoff depth change, yards (+ = deeper, more touchbacks). */
  kickoffAdd: number
  /** Deep-ball (depth >= 15) catch multiplier. */
  deepCatchMult: number
  /** Deep-ball interception multiplier. */
  deepIntMult: number
  /** Fumble multiplier on runs, receptions and returns. */
  fumbleMult: number
  /** Drop-chance multiplier. */
  dropMult: number
  /** Muff-chance multiplier. */
  muffMult: number
  /** Footing: run-gain variance multiplier. */
  runVarianceMult: number
  /** Footing: pass-rush pressure multiplier. */
  pressureMult: number
  /** Pre-snap false-start weight multiplier for this offense (1 = neutral). */
  falseStartMult: number
}

export interface WeatherForecast {
  roof: Roof
  closed: boolean
  tempF: { lo: number; hi: number }
  windMph: { lo: number; hi: number }
  /** Chance of precipitation, 0–1. */
  precipChance: number
  /** Expected precipitation type. */
  precip: Precip
  loud: number
  /** True when an analytics department narrowed the range. */
  narrow: boolean
}

// ── Weather on / off ─────────────────────────────────────────────────────────
let WEATHER_ON = true

/** Like `setStamina`: off makes every effect exactly neutral. */
export function setWeather(on: boolean) {
  WEATHER_ON = on
}

export function getWeather(): boolean {
  return WEATHER_ON
}

// ── Hashing / calendar ───────────────────────────────────────────────────────
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}

/** A bell-ish draw in [-0.5, 0.5] (mean of three uniforms minus the midpoint). */
function bell(key: string): number {
  return (h01(`${key}:b1`) + h01(`${key}:b2`) + h01(`${key}:b3`)) / 3 - 0.5
}

const CUM_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** NFL week -> approximate day of year (week 1 ~ early September). */
function doyForWeek(week: number): number {
  return 250 + (Math.max(1, week) - 1) * 7
}

/** Day of year (wrapping past 365) -> calendar month, 1–12. */
function monthForDoy(doy: number): number {
  const d = (((doy - 1) % 365) + 365) % 365 + 1
  let acc = 0
  for (let m = 0; m < 12; m++) {
    acc += CUM_DAYS[m]
    if (d <= acc) return m + 1
  }
  return 12
}

function monthForWeek(week: number): number {
  return monthForDoy(doyForWeek(week))
}

/** Seasonal temperature fraction, -1 (mid-Jan) … +1 (mid-Jul). */
function seasonalFrac(doy: number): number {
  return -Math.cos(((doy - 15) / 365) * Math.PI * 2)
}

const CLIMATE_TEMP: Record<Climate, { mean: number; amp: number }> = {
  cold: { mean: 49, amp: 25 },
  temperate: { mean: 60, amp: 17 },
  warm: { mean: 75, amp: 11 },
  desert: { mean: 71, amp: 19 },
}

const CLIMATE_PRECIP: Record<Climate, number> = { cold: 0.15, temperate: 0.16, warm: 0.12, desert: 0.05 }

/** Base probability of any precipitation for a venue in a month. */
function precipProb(st: Stadium, month: number): number {
  let p = CLIMATE_PRECIP[st.climate]
  if (month <= 1 || month >= 11) p += WX.winterPrecipBump
  if (st.climate === 'warm' && (month === 9 || month === 10)) p += WX.warmStormBump
  return clamp(p, 0.02, 0.6)
}

const FALLBACK_STADIUM: Stadium = {
  abbr: '',
  name: '',
  roof: 'open',
  surface: 'grass',
  climate: 'temperate',
  lat: 38,
  windy: 0.35,
  loud: 0.5,
}

// ── The pure model ───────────────────────────────────────────────────────────
/**
 * Deterministic weather for a game. `season` defaults to the world's current
 * season (schedule rows carry no season of their own; past games in the current
 * season are exactly reproduced by the same inputs).
 */
export function gameWeather(world: World, game: WeatherGame, season: number = world.season): GameWeather {
  const home = world.byId[game.homeId]
  const st = home ? stadiumFor(home) : FALLBACK_STADIUM
  const key = `${season}:${game.week}:${game.id}`
  const doy = doyForWeek(game.week)
  const month = monthForDoy(doy)

  // Outdoor conditions first: they decide whether a retractable roof closes.
  const { mean, amp } = CLIMATE_TEMP[st.climate]
  const outdoorTemp = mean + amp * seasonalFrac(doy) + bell(`${key}:temp`) * 2 * WX.tempJitterF

  const winter = month <= 1 || month >= 12 ? 1 : 0
  const outdoorWind = clamp(
    WX.windBaseMph + st.windy * WX.windWindyMph + winter * WX.windWinterMph + bell(`${key}:wind`) * 2 * WX.windJitterMph,
    0,
    WX.windCapMph,
  )

  const pRain = precipProb(st, month)
  const wet = h01(`${key}:precip`) < pRain
  const coldEnough = outdoorTemp <= WX.snowMaxF && (st.climate === 'cold' || st.windy >= 0.55)
  const precip: Precip = !wet ? 'none' : coldEnough ? 'snow' : 'rain'

  const closed =
    st.roof === 'dome' ||
    (st.roof === 'retractable' &&
      (outdoorTemp < WX.retractOpenF ||
        outdoorTemp > WX.retractHeatF ||
        precip !== 'none' ||
        outdoorWind >= WX.retractCloseWindMph ||
        h01(`${key}:roof`) < WX.retractClosePolicy))

  const dir = h01(`${key}:wdir`) * 2 - 1
  const align = 0.45 + 0.55 * h01(`${key}:walign`)

  const tempF = closed ? WX.domeTempF : Math.round(outdoorTemp)
  const windMph = closed ? 0 : Math.round(outdoorWind)
  const windAlong = closed ? 0 : Math.round(outdoorWind * align * dir * 10) / 10
  const intensity = closed || precip === 'none' ? 0 : Math.round((0.3 + 0.7 * h01(`${key}:aint`)) * 100) / 100

  return {
    roof: st.roof,
    closed,
    tempF,
    windMph,
    windAlong,
    precip: closed ? 'none' : precip,
    intensity,
    loud: clamp(st.loud + (closed ? WX.closedLoudAdd : 0), 0, 1),
    altitude: st.altitude ?? 0,
  }
}

// ── Forecast ─────────────────────────────────────────────────────────────────
function forecastFromGame(world: World, game: WeatherGame, narrow: boolean, season: number = world.season): WeatherForecast {
  const w = gameWeather(world, game, season)
  const home = world.byId[game.homeId]
  const st = home ? stadiumFor(home) : FALLBACK_STADIUM
  const key = `${season}:${game.week}:${game.id}`
  const scale = narrow ? WX.forecastNarrow : 1
  const halfTemp = WX.forecastTempHalf * scale
  const halfWind = WX.forecastWindHalf * scale
  // The error is scaled so the actual value lands inside the range ~80% of the
  // time (`forecastHitRate`); an analytics club just shrinks both together.
  const errTemp = (h01(`${key}:fct`) * 2 - 1) * (halfTemp / WX.forecastHitRate)
  const errWind = (h01(`${key}:fcw`) * 2 - 1) * (halfWind / WX.forecastHitRate)
  const tempCenter = w.tempF + errTemp
  const windCenter = w.windMph + errWind

  let chance = clamp(precipProb(st, monthForWeek(game.week)) + (h01(`${key}:fcp`) - 0.5) * 0.24, 0.02, 0.95)
  if (w.closed) chance = 0
  const precip: Precip = chance < 0.25 ? 'none' : tempCenter <= WX.snowMaxF ? 'snow' : 'rain'

  return {
    roof: w.roof,
    closed: w.closed,
    tempF: { lo: Math.round(tempCenter - halfTemp), hi: Math.round(tempCenter + halfTemp) },
    windMph: { lo: Math.max(0, Math.round(windCenter - halfWind)), hi: Math.max(0, Math.round(windCenter + halfWind)) },
    precipChance: Math.round(chance * 100) / 100,
    precip,
    loud: w.loud,
    narrow,
  }
}

/**
 * The pre-game forecast for a club's game in a week. Returns null when the club
 * has no game that week (a bye). A club with an analytics department (FUTURES
 * #19) gets the narrower range.
 */
export function forecastFor(world: World, teamId: string, week: number): WeatherForecast | null {
  const game = world.schedule.find((g) => g.week === week && (g.homeId === teamId || g.awayId === teamId))
  if (!game) return null
  const narrow = analyticsRating(world, teamId) > 0
  return forecastFromGame(world, game, narrow)
}

// ── Effects ──────────────────────────────────────────────────────────────────
const NEUTRAL_EFFECTS: WxEffects = {
  headwind: 0,
  kickMakeAdd: 0,
  kickRangeYds: 0,
  puntAdd: 0,
  kickoffAdd: 0,
  deepCatchMult: 1,
  deepIntMult: 1,
  fumbleMult: 1,
  dropMult: 1,
  muffMult: 1,
  runVarianceMult: 1,
  pressureMult: 1,
  falseStartMult: 1,
}

/** Uncentered effects (the probe averages these to build `WX_CENTER`). */
function wxRaw(w: GameWeather, offIsHome: boolean, qtr: number): WxEffects {
  // The offense switches ends each quarter; home and away are opposite. A
  // positive `headwind` is into this offense's face.
  const phase = (offIsHome ? 1 : -1) * (qtr % 2 === 0 ? -1 : 1)
  const headwind = w.windAlong * phase
  const absWind = w.windMph
  const wet = w.precip === 'none' ? 0 : w.intensity
  const cold = clamp((WX.coldBallF - w.tempF) / WX.coldBallF, 0, 1)
  const windyDeep = clamp((absWind - WX.deepWindStart) / WX.deepWindSpan, 0, 1)

  const coldBall = WX.coldBallRel * cold
  return {
    headwind,
    kickMakeAdd: -headwind * WX.kickHeadPerMph - absWind * WX.kickAccPerMph,
    kickRangeYds: -headwind * WX.kickRangePerMph - WX.coldKickYds * cold,
    puntAdd: -headwind * WX.puntPerMph,
    kickoffAdd: -headwind * WX.kickoffPerMph,
    deepCatchMult: 1 - WX.deepCatchRel * windyDeep,
    deepIntMult: 1 + WX.deepIntRel * windyDeep,
    fumbleMult: 1 + WX.fumbleWet * wet + coldBall,
    dropMult: 1 + WX.dropWet * wet + coldBall,
    muffMult: 1 + WX.muffWet * wet + coldBall,
    runVarianceMult: 1 - WX.footingCut * wet,
    pressureMult: 1 - WX.footingCut * wet,
    falseStartMult: offIsHome ? 1 - WX.crowd * WX_CENTER.loud : 1 + WX.crowd * w.loud,
  }
}

function wxCenter(r: WxEffects): WxEffects {
  return {
    headwind: r.headwind,
    kickMakeAdd: r.kickMakeAdd - WX_CENTER.kickMakeAdd,
    kickRangeYds: r.kickRangeYds - WX_CENTER.kickRangeYds,
    puntAdd: r.puntAdd - WX_CENTER.puntAdd,
    kickoffAdd: r.kickoffAdd - WX_CENTER.kickoffAdd,
    deepCatchMult: r.deepCatchMult / WX_CENTER.deepCatchMult,
    deepIntMult: r.deepIntMult / WX_CENTER.deepIntMult,
    fumbleMult: r.fumbleMult / WX_CENTER.fumbleMult,
    dropMult: r.dropMult / WX_CENTER.dropMult,
    muffMult: r.muffMult / WX_CENTER.muffMult,
    runVarianceMult: r.runVarianceMult / WX_CENTER.runVarianceMult,
    pressureMult: r.pressureMult / WX_CENTER.pressureMult,
    falseStartMult: r.falseStartMult / WX_CENTER.falseStartMult,
  }
}

/**
 * Bounded, centered weather effects for one offense. `offIsHome` picks the wind
 * phase and the crowd side (default holds the home offense); `qtr` flips which
 * way the wind blows (1-based, default 1). Returns exact neutrals when
 * `setWeather(false)`.
 */
export function wxEffects(w: GameWeather, offIsHome = true, qtr = 1): WxEffects {
  if (!WEATHER_ON) return NEUTRAL_EFFECTS
  return wxCenter(wxRaw(w, offIsHome, qtr))
}

// ── Probe ────────────────────────────────────────────────────────────────────
export interface WeatherProbeOptions {
  seasons?: number
  weeks?: number
}

interface Agg {
  games: number
  closed: number
  temp: number
  wind: number
  precip: number
  snow: number
}

const newAgg = (): Agg => ({ games: 0, closed: 0, temp: 0, wind: 0, precip: 0, snow: 0 })

function addAgg(a: Agg, w: GameWeather) {
  a.games++
  if (w.closed) a.closed++
  a.temp += w.tempF
  a.wind += w.windMph
  if (w.precip !== 'none') a.precip++
  if (w.precip === 'snow') a.snow++
}

const r1 = (x: number) => Math.round(x * 10) / 10
const r3 = (x: number) => Math.round(x * 1000) / 1000

function finish(a: Agg) {
  const n = a.games || 1
  return {
    games: a.games,
    closedShare: r3(a.closed / n),
    tempF: r1(a.temp / n),
    windMph: r1(a.wind / n),
    precipShare: r3(a.precip / n),
    snowShare: r3(a.snow / n),
  }
}

const EFFECT_KEYS: (keyof WxEffects)[] = [
  'headwind',
  'kickMakeAdd',
  'kickRangeYds',
  'puntAdd',
  'kickoffAdd',
  'deepCatchMult',
  'deepIntMult',
  'fumbleMult',
  'dropMult',
  'muffMult',
  'runVarianceMult',
  'pressureMult',
  'falseStartMult',
]

/**
 * Dev-only probe: reports the weather distribution over `seasons` × every NFL
 * club as home across a schedule, the wxEffects ranges, determinism, the
 * forecast hit rate, and the `WX_CENTER` values to hard-code. Pure — it only
 * reads the world.
 */
export function weatherProbe(world: World, opts: WeatherProbeOptions = {}) {
  const seasons = opts.seasons ?? 3
  const weeks = opts.weeks ?? 18
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const firstSeason = world.season

  const overall = newAgg()
  const roofCount: Record<Roof, number> = { open: 0, dome: 0, retractable: 0 }
  const precipCount: Record<Precip, number> = { none: 0, rain: 0, snow: 0 }
  const byClimate = new Map<Climate, Agg>()
  const byMonth = new Map<number, Agg>()
  const byVenue = new Map<string, Agg>()
  const venueDecTemp = new Map<string, { sum: number; n: number }>()
  let openGames = 0
  let openWind15 = 0

  const effMin = new Map<string, number>()
  const effMax = new Map<string, number>()
  const effSum = new Map<string, number>()
  const rawSum = new Map<string, number>()
  const rawCount = new Map<string, number>()
  let loudSum = 0

  let fcHit = 0
  let fcN = 0
  const detMismatch: string[] = []
  const samples: GameWeather[] = []

  for (let s = 0; s < seasons; s++) {
    const season = firstSeason + s
    for (const g of world.schedule) {
      if (g.tier !== 'NFL' || g.week > weeks) continue
      const team = world.byId[g.homeId]
      if (!team) continue
      const game: WeatherGame = { id: g.id, week: g.week, homeId: g.homeId, postseason: g.postseason }
      const w = gameWeather(world, game, season)
      if (samples.length < 96) samples.push(w)

      addAgg(overall, w)
      loudSum += w.loud
      roofCount[w.roof]++
      precipCount[w.precip]++
      const st = stadiumFor(team)
      const clim = byClimate.get(st.climate) ?? byClimate.set(st.climate, newAgg()).get(st.climate)!
      addAgg(clim, w)
      const month = monthForWeek(g.week)
      const mo = byMonth.get(month) ?? byMonth.set(month, newAgg()).get(month)!
      addAgg(mo, w)
      const ven = byVenue.get(team.id) ?? byVenue.set(team.id, newAgg()).get(team.id)!
      addAgg(ven, w)
      if (month === 12) {
        const d = venueDecTemp.get(team.id) ?? venueDecTemp.set(team.id, { sum: 0, n: 0 }).get(team.id)!
        d.sum += w.tempF
        d.n++
      }
      if (!w.closed) {
        openGames++
        if (w.windMph >= 15) openWind15++
      }

      for (const [offIsHome, qtr] of [
        [true, 1],
        [false, 1],
        [true, 2],
        [false, 2],
      ] as [boolean, number][]) {
        const raw = wxRaw(w, offIsHome, qtr)
        const eff = wxCenter(raw)
        for (const k of EFFECT_KEYS) {
          const v = eff[k]
          effMin.set(k, Math.min(effMin.get(k) ?? Infinity, v))
          effMax.set(k, Math.max(effMax.get(k) ?? -Infinity, v))
          effSum.set(k, (effSum.get(k) ?? 0) + v)
          // Center = the mean of the RAW value; the surface effects are the
          // centered values actually returned to W2.
          rawSum.set(k, (rawSum.get(k) ?? 0) + raw[k])
          rawCount.set(k, (rawCount.get(k) ?? 0) + 1)
        }
      }

      // Forecast (no analytics) hit rate, and the determinism spot-check.
      const fc = forecastFromGame(world, game, false, season)
      const hit =
        fc.tempF.lo <= w.tempF && w.tempF <= fc.tempF.hi && fc.windMph.lo <= w.windMph && w.windMph <= fc.windMph.hi
      if (hit) fcHit++
      fcN++
      if (samples.length <= 64) {
        const again = gameWeather(world, game, season)
        if (JSON.stringify(again) !== JSON.stringify(w)) detMismatch.push(`${season}:${g.week}:${g.homeId}`)
      }
    }
  }

  const effects: Record<string, { min: number; max: number; mean: number }> = {}
  const centers: Record<string, number> = {}
  for (const k of EFFECT_KEYS) {
    const n = rawCount.get(k) || 1
    const mean = (rawSum.get(k) ?? 0) / n
    effects[k] = { min: r3(effMin.get(k) ?? 0), max: r3(effMax.get(k) ?? 0), mean: r3((effSum.get(k) ?? 0) / n) }
    // What `WX_CENTER` should be: the mean of the RAW value (the surface
    // effect should then average ~1, or ~0 for the additive offsets).
    centers[k] = r3(mean)
  }
  centers.loud = r3(loudSum / (overall.games || 1))

  // Neutrality: with weather off, every effect is exactly neutral.
  setWeather(false)
  const probeWeather = gameWeather(world, { id: `p${firstSeason}_1_${nfl[0]?.id ?? 'BUF'}`, week: 1, homeId: nfl[0]?.id ?? 'BUF' })
  const neutral = wxEffects(probeWeather, false, 2)
  const neutralOk =
    neutral.headwind === 0 &&
    neutral.kickMakeAdd === 0 &&
    neutral.puntAdd === 0 &&
    neutral.fumbleMult === 1 &&
    neutral.dropMult === 1 &&
    neutral.deepCatchMult === 1 &&
    neutral.falseStartMult === 1
  setWeather(true)

  const gb = byVenue.get('GB')
  const mia = byVenue.get('MIA')

  return {
    seasons,
    weeks,
    games: overall.games,
    roofShare: { open: r3(roofCount.open / overall.games), dome: r3(roofCount.dome / overall.games), retractable: r3(roofCount.retractable / overall.games) },
    closedShare: r3(overall.closed / overall.games),
    precipShare: { none: r3(precipCount.none / overall.games), rain: r3(precipCount.rain / overall.games), snow: r3(precipCount.snow / overall.games) },
    openWind15Share: r3(openWind15 / (openGames || 1)),
    byMonth: Object.fromEntries([...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([m, a]) => [m, finish(a)])),
    byClimate: Object.fromEntries([...byClimate.entries()].map(([c, a]) => [c, finish(a)])),
    byVenue: Object.fromEntries(
      [...byVenue.entries()].map(([id, a]) => [
        id,
        { ...finish(a), decTempF: r1((venueDecTemp.get(id)?.sum ?? 0) / (venueDecTemp.get(id)?.n || 1)) },
      ]),
    ),
    gbDecTempF: gb ? r1((venueDecTemp.get('GB')?.sum ?? 0) / (venueDecTemp.get('GB')?.n || 1)) : null,
    miaDecTempF: mia ? r1((venueDecTemp.get('MIA')?.sum ?? 0) / (venueDecTemp.get('MIA')?.n || 1)) : null,
    effects,
    centers,
    forecastHitRate: r3(fcHit / (fcN || 1)),
    determinism: { checked: Math.min(samples.length, 64), mismatches: detMismatch },
    neutralOk,
  }
}
