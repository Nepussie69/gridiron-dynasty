// ─────────────────────────────────────────────────────────────────────────────
// animflow r6b (ratings audit item 1): the animation reads the SAME effective
// ratings the sim resolved. `playsim.ts` reads every rating through
// `mkAttrs` = `playerAttrs(p)` (generated attributes for the position, then the
// real ratings the player carries, then L15 development-plan gains), so the
// animation, the jersey cast and the broadcast read them here through the same
// function instead of the raw `p.attrs`. Cached per player object (the merge
// allocates; the builders read a rating many times per play). Read-only.
// ─────────────────────────────────────────────────────────────────────────────

import { playerAttrs } from '../game/data/ratings'
import type { Player } from '../game/types'

interface Entry { ovr: number; attrs: unknown; dev: unknown; out: Record<string, number> }
const CACHE = new WeakMap<object, Entry>()

/** The sim's effective ratings for a player (generated + real + dev-plan gains). */
export function effAttrs(p: Player): Record<string, number> {
  const dev = (p as { devRatings?: Record<string, number> }).devRatings
  const hit = CACHE.get(p)
  if (hit && hit.ovr === p.ovr && hit.attrs === p.attrs && hit.dev === dev) return hit.out
  const out = playerAttrs(p)
  CACHE.set(p, { ovr: p.ovr, attrs: p.attrs, dev, out })
  return out
}

/** One effective rating, or `fallback` when the player is missing or the key is not in his schema. */
export function effRating(p: Player | undefined, key: string, fallback = 70): number {
  if (!p) return fallback
  const v = effAttrs(p)[key]
  return typeof v === 'number' ? v : fallback
}

// ── animflow r6b (item 4): fatigue from the sim's snap accounting ────────────
// `Play.fatOn` records each on-field man's in-game fatigue at the snap (x100),
// aligned to onFieldOff then onFieldDef. The animation reads it here.

/** Fatigue (0 fresh … ~1.2 spent) per player id on this snap; empty for old saves. */
export function fatigueMap(play: { onFieldOff?: string[]; onFieldDef?: string[]; fatOn?: number[] }): Map<string, number> {
  const out = new Map<string, number>()
  const ids = [...(play.onFieldOff ?? []), ...(play.onFieldDef ?? [])]
  const f = play.fatOn
  if (!f || f.length !== ids.length) return out
  ids.forEach((id, i) => out.set(id, (f[i] ?? 0) / 100))
  return out
}

/**
 * Fatigue at which a man starts to show it (top-speed / burst loss, hands on
 * hips). Tuned on the sim's real at-snap distribution (r6b audit, 66 games:
 * p50 0.07, p90 0.13, p99 0.22): from the upper quartile up, full at p99.
 */
export const TIRED_AT = 0.08
export const SPENT_AT = 0.22
/** How tired he looks, 0 (fresh, below TIRED_AT) … 1 (spent, SPENT_AT+). */
export function tiredness(fat: number | undefined): number {
  if (!fat || fat <= TIRED_AT) return 0
  return Math.min(1, (fat - TIRED_AT) / (SPENT_AT - TIRED_AT))
}
/** Top speed / acceleration multipliers for a tired man (at most −5% / −10%). */
export function fatiguePace(fat: number | undefined): { top: number; acc: number } {
  const u = tiredness(fat)
  return { top: 1 - 0.05 * u, acc: 1 - 0.1 * u }
}

// ── animflow r6b (item 5): skill moves and tackle styles ─────────────────────
// The sim records WHO missed the tackle (missedTackleIds) and who forced it,
// not how; the broadcast draws the move matching the carrier's best skill
// relative to the league (effective-rating medians of NFL backs, seed 33333:
// JKM 82, SPM 76, SFA 76, TRK 79), and the tackle by the tackler's TAK / HPW.
// Hurdles are not recorded by the sim, so none is drawn.

export type CarrierMove = 'juke' | 'spin' | 'stiffArm' | 'truck'
export type TackleStyle = 'wrap' | 'hit' | 'arm' | 'dive'

/** League medians the moves are read against (backs; receivers / QBs use proxies). */
export const MOVE_REF = { JKM: 82, SPM: 76, SFA: 76, TRK: 79, AGI: 86, STR: 66, BTK: 74 }

const h01 = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x) }

/**
 * The carrier's move on a broken tackle: the skill he is best at against the
 * league median (a back's JKM / SPM / SFA / TRK; a receiver or QB without those
 * jukes on AGI, trucks on STR, stiff-arms on BTK). Within 3 points of the best
 * the play hash picks between them, so a balanced back mixes his moves.
 */
export function carrierMove(p: Player | undefined, seed: number): CarrierMove {
  if (!p) return 'juke'
  const a = effAttrs(p)
  const has = typeof a.JKM === 'number'
  const sc: [CarrierMove, number][] = has
    ? [['juke', a.JKM - MOVE_REF.JKM], ['spin', (a.SPM ?? 70) - MOVE_REF.SPM], ['stiffArm', (a.SFA ?? 70) - MOVE_REF.SFA], ['truck', (a.TRK ?? 70) - MOVE_REF.TRK]]
    : [['juke', (a.AGI ?? 80) - MOVE_REF.AGI], ['spin', -6], ['stiffArm', (a.BTK ?? 70) - MOVE_REF.BTK], ['truck', (a.STR ?? 60) - MOVE_REF.STR - 4]]
  const best = Math.max(...sc.map((s) => s[1]))
  const near = sc.filter((s) => s[1] >= best - 3)
  return near[Math.floor(h01(seed) * near.length) % near.length][0]
}

/**
 * How the recorded tackler brings the carrier down. A chase from behind on a
 * man still running is a dive at the legs (round 6a). Otherwise: a poor
 * tackler (TAK under 64: most corners, median 59) often only gets an arm on
 * him; a big hitter (HPW 84+) arriving at speed head-on / on an angle lays a
 * hit; everyone else wraps up and drives.
 */
export function tackleStyle(p: Player | undefined, o: { fromBehind: boolean; carrierSpeed: number; tacklerSpeed: number; seed: number }): TackleStyle {
  if (o.fromBehind && o.carrierSpeed > 4.5) return 'dive'
  if (!p) return 'wrap'
  const tak = effRating(p, 'TAK', 70)
  const hpw = effRating(p, 'HPW', 70)
  const u = h01(o.seed)
  if (tak < 64 && u < 0.3 + (64 - tak) * 0.04) return 'arm'
  if (hpw >= 84 && o.tacklerSpeed >= 3.5 && !o.fromBehind && h01(o.seed + 7.7) < 0.35 + (hpw - 84) * 0.05) return 'hit'
  return 'wrap'
}
