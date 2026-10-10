// ─────────────────────────────────────────────────────────────────────────────
// Special-teams calls (FUTURES #4).
//
// The user's kickoff call (deep / squib / onside / surprise onside), the kick and
// return strategies on the game-plan sheet, and the per-club special-teams
// tendency memory opponents scout. Everything here is pure arithmetic: callers in
// playsim.ts still own every hash draw, so adding this layer introduces NO rng
// draw and leaves the default (non-user) sim byte-identical to the base snapshot.
//
// Defaults are all identity: every modifier is 0 at `default`, so a club that
// never touches its sheet plays exactly the pre-feature sim.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp } from './rng'

export type KickoffCall = 'deep' | 'squib' | 'onside' | 'surprise'
export type ReturnStrategy = 'safe' | 'default' | 'aggressive'
/** Kickoff strategy: a normal deep kick, or a directional/pooch kick. */
export type KickStrategy = 'default' | 'directional'
/** Punt strategy: a normal punt, or a directional punt. */
export type PuntStrategy = 'default' | 'directional'

export interface SpecialTeamsPlan {
  kickoff: KickStrategy
  punt: PuntStrategy
  /** Kickoff-return strategy. */
  kr: ReturnStrategy
  /** Punt-return strategy. */
  pr: ReturnStrategy
}

export const DEFAULT_ST: SpecialTeamsPlan = { kickoff: 'default', punt: 'default', kr: 'default', pr: 'default' }

export function normalizeSpecial(plan: SpecialTeamsPlan | undefined): SpecialTeamsPlan {
  if (!plan) return DEFAULT_ST
  return {
    kickoff: plan.kickoff === 'directional' ? 'directional' : 'default',
    punt: plan.punt === 'directional' ? 'directional' : 'default',
    kr: plan.kr === 'safe' || plan.kr === 'aggressive' ? plan.kr : 'default',
    pr: plan.pr === 'safe' || plan.pr === 'aggressive' ? plan.pr : 'default',
  }
}

// ── Tendency memory ───────────────────────────────────────────────────────────
// Per club, per season: how many special-teams surprises (fakes, onsides and
// surprise onsides) a club has shown. Opponents who have seen them are "alert".
// An optional world field, so an old save without it is valid.

export interface STTeamRecord {
  fake: number
  onside: number
  surprise: number
}
export interface STMemory {
  season: number
  teams: Record<string, STTeamRecord>
}

export function emptySTRecord(): STTeamRecord {
  return { fake: 0, onside: 0, surprise: 0 }
}

/** 0 (unknown) … 1 (fully scouted): how alert an opponent is to a club's tricks. */
export function alertness(rec: STTeamRecord | undefined): number {
  if (!rec) return 0
  return clamp((rec.fake ?? 0) * 0.34 + (rec.onside ?? 0) * 0.5 + (rec.surprise ?? 0) * 0.6, 0, 1)
}

export function isAlert(rec: STTeamRecord | undefined): boolean {
  return alertness(rec) >= 0.34
}

/** One-line scouting read of a club's special-teams tendencies, or '' when clean. */
export function stRecordText(rec: STTeamRecord | undefined): string {
  if (!rec) return ''
  const parts: string[] = []
  if (rec.fake > 0) parts.push(`${rec.fake} fake${rec.fake > 1 ? 's' : ''}`)
  if (rec.onside > 0) parts.push(`${rec.onside} onside${rec.onside > 1 ? 's' : ''}`)
  if (rec.surprise > 0) parts.push(`${rec.surprise} surprise onside${rec.surprise > 1 ? 's' : ''}`)
  if (!parts.length) return ''
  return `${parts.join(' · ')} this season${isAlert(rec) ? ' — alert' : ''}`
}

// ── Return / kick strategy effects ───────────────────────────────────────────
// Every value is identity at the default strategies.

export interface KickReturnMods {
  /** Added to the touchback probability. */
  tb: number
  /** Added to the return-yardage base. */
  base: number
  /** Multiplies the return-yardage spread. */
  spread: number
  /** Multiplies the kickoff-return fumble chance. */
  fumble: number
}

export function kickReturnMods(kr: ReturnStrategy, kick: KickStrategy): KickReturnMods {
  let tb = 0
  let base = 0
  let spread = 1
  let fumble = 1
  if (kr === 'safe') { tb += 0.18; base -= 2; spread *= 0.8; fumble *= 0.6 }
  else if (kr === 'aggressive') { tb -= 0.15; base += 3.5; spread *= 1.3; fumble *= 1.9 }
  if (kick === 'directional') { tb -= 0.16; base -= 2.5; spread *= 0.8 }
  return { tb, base, spread, fumble }
}

export interface PuntMods {
  /** Shift of the fair-catch share (mass taken from / given to the return share). */
  fcDelta: number
  /** Added to the return-yardage base. */
  base: number
  /** Multiplies the return-yardage spread. */
  spread: number
  /** Multiplies the muff/fumble share. */
  fumble: number
  /** Added to the gross punt (negative = a shorter, directional punt). */
  gross: number
}

export function puntMods(pr: ReturnStrategy, kick: PuntStrategy): PuntMods {
  let fcDelta = 0
  let base = 0
  let spread = 1
  let fumble = 1
  let gross = 0
  if (pr === 'safe') { fcDelta += 0.12; base -= 1.5; spread *= 0.8; fumble *= 0.6 }
  else if (pr === 'aggressive') { fcDelta -= 0.08; base += 3; spread *= 1.3; fumble *= 1.9 }
  if (kick === 'directional') { fcDelta += 0.16; gross -= 6 }
  return { fcDelta: clamp(fcDelta, -0.15, 0.3), base, spread, fumble, gross }
}

// ── The user's kickoff call ───────────────────────────────────────────────────

/**
 * Onside recovery chance for the kicking club (NFL ≈ 10–20%). The kicker's
 * accuracy/power and the kicking club's coverage nudge it inside the band.
 */
export function onsideChance(kpw: number, kac: number, cov: number): number {
  return clamp(0.13 + (kac - 78) * 0.0008 + (kpw - 78) * 0.0006 + (cov - 72) * 0.0009, 0.1, 0.15)
}

/**
 * Surprise-onside recovery chance (~45–55% when the opponent is not expecting
 * it). A scouted club — `alert` near 1 — has the band cut, bounded.
 */
export function surpriseChance(kpw: number, kac: number, cov: number, alert = 0): number {
  const base = clamp(0.5 + (kac - 78) * 0.0015 + (kpw - 78) * 0.001 + (cov - 72) * 0.0012, 0.42, 0.56)
  return clamp(base * (1 - 0.45 * alert), 0.2, 0.56)
}

/**
 * The opponent's scouting read may cut a surprise attempt's success, and their
 * own memory of a club's tricks makes them slower to bite on a plain fake too.
 * Returns the negative offensive edge to apply on an alert fake snap (0 when calm).
 */
export function alertFakeEdge(alert: number): number {
  return -2 * clamp(alert, 0, 1)
}
