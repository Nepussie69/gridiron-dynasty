// ─────────────────────────────────────────────────────────────────────────────
// Personnel packages (L13 · FUTURES row 3).
//
// Football is a game of matchups: the group you send onto the field decides who
// blocks, who covers, and what the defence has to respect. On offence you call
// 11 (3 WR / 1 TE / 1 RB), 12 (2 WR / 2 TE / 1 RB) or 21 (2 WR / 1 TE / 2 RB);
// on defence you answer with Base (3 LB), Nickel (2 LB) or Dime (1 LB).
//
// The user picks their packages in the Game Plan (and can change them mid-game).
// AI clubs keep a scheme-derived default, and the whole system is *opt-in*: with
// no package set the sim behaves exactly as before, so AI-vs-AI calibration and
// `__simTest` are untouched. Only the user's club's on-field groups change, and
// the matchup edge is only computed while the user is in the game.
// ─────────────────────────────────────────────────────────────────────────────

import type { Position } from '../types'
import type { World } from './generate'
import { depthGroup } from './depth'

export type OffPersonnel = '11' | '12' | '21'
export type DefPackage = 'base' | 'nickel' | 'dime'

export interface OffPersonnelDef {
  id: OffPersonnel
  /** Short label for chips, e.g. "11". */
  label: string
  /** Full name, e.g. "11 Personnel". */
  name: string
  blurb: string
  wr: number
  te: number
  rb: number
  fb: boolean
}

export interface DefPackageDef {
  id: DefPackage
  label: string
  name: string
  blurb: string
  dl: number
  lb: number
  cb: number
  s: number
}

export const OFF_PERSONNEL: OffPersonnelDef[] = [
  {
    id: '11', label: '11', name: '11 Personnel',
    blurb: '3 WR · 1 TE · 1 RB — spread the field and attack the slot.',
    wr: 3, te: 1, rb: 1, fb: false,
  },
  {
    id: '12', label: '12', name: '12 Personnel',
    blurb: '2 WR · 2 TE · 1 RB — big bodies, play-action and the edge.',
    wr: 2, te: 2, rb: 1, fb: false,
  },
  {
    id: '21', label: '21', name: '21 Personnel',
    blurb: '2 WR · 1 TE · 2 RB — an extra back, lean on the run.',
    wr: 2, te: 1, rb: 2, fb: false,
  },
]

export const DEF_PACKAGES: DefPackageDef[] = [
  {
    id: 'base', label: 'Base', name: 'Base 4-3',
    blurb: '3 LB · 2 CB — stuffs the run, gives up the slot.',
    dl: 4, lb: 3, cb: 2, s: 2,
  },
  {
    id: 'nickel', label: 'Nickel', name: 'Nickel 4-2-5',
    blurb: '2 LB · 3 CB — the balanced answer to 11.',
    dl: 4, lb: 2, cb: 3, s: 2,
  },
  {
    id: 'dime', label: 'Dime', name: 'Dime 4-1-6',
    blurb: '1 LB · 4 CB — pass defence, soft against the run.',
    dl: 4, lb: 1, cb: 4, s: 2,
  },
]

export function offDef(id: OffPersonnel | undefined): OffPersonnelDef | undefined {
  return OFF_PERSONNEL.find((p) => p.id === id)
}
export function defDef(id: DefPackage | undefined): DefPackageDef | undefined {
  return DEF_PACKAGES.find((p) => p.id === id)
}

/** Keep an unknown/legacy value from reaching the sim. */
export function normalizeOffPersonnel(v: unknown): OffPersonnel | undefined {
  return v === '11' || v === '12' || v === '21' ? v : undefined
}
export function normalizeDefPackage(v: unknown): DefPackage | undefined {
  return v === 'base' || v === 'nickel' || v === 'dime' ? v : undefined
}

/** The offence grouping an AI club leans on from its coordinator's scheme. */
export function aiOffPersonnel(scheme: string | undefined): OffPersonnel {
  switch (scheme) {
    case 'Pro Style':
      return '12'
    case 'RPO Heavy':
      return '21'
    case 'Spread':
    case 'West Coast':
    case 'Air Raid':
    default:
      return '11'
  }
}

/** The defensive package an AI club leans on from its coordinator's scheme. */
export function aiDefPackage(scheme: string | undefined): DefPackage {
  switch (scheme) {
    case '4-2-5 Nickel':
    case 'Blitz Heavy':
    case 'Multiple':
      return 'nickel'
    case '4-3 Base':
    case '3-4 Base':
    default:
      return 'base'
  }
}

// ── The matchup ───────────────────────────────────────────────────────────────
// A light rock-paper-scissors: a heavy offence beats a light box; a spread
// offence beats a base defence; the nickel is the neutral answer. The edges are
// deliberately small so a package is never an automatic win — the roster (who
// actually lines up) does most of the work.
export interface PersonnelEdge {
  /** Added to the run edge (yards) when this offence faces this defence. */
  run: number
  /** Added to receiver separation on a dropback. */
  pass: number
}

const OFF_RUN: Record<OffPersonnel, number> = { '11': -1, '12': 0, '21': 1 }
const OFF_PASS: Record<OffPersonnel, number> = { '11': 1, '12': 0, '21': -1 }
const DEF_RUN: Record<DefPackage, number> = { base: 1, nickel: 0, dime: -1 }
const DEF_PASS: Record<DefPackage, number> = { base: -1, nickel: 0, dime: 1 }

/** Tuning knobs: how much a favourable matchup is worth (kept small). */
export const PERSONNEL_RUN_K = 0.9
export const PERSONNEL_PASS_K = 0.9

export function personnelEdge(off: OffPersonnel, def: DefPackage): PersonnelEdge {
  return {
    run: (OFF_RUN[off] - DEF_RUN[def]) * PERSONNEL_RUN_K,
    pass: (OFF_PASS[off] - DEF_PASS[def]) * PERSONNEL_PASS_K,
  }
}

// ── On-field groups ───────────────────────────────────────────────────────────
/**
 * The receivers who run routes for one personnel grouping. Always returns up to
 * `n` players from a fixed position quota (WR first, then TE, then RB), so the
 * sim draws exactly as many target rolls as it would for the default grouping.
 */
export function offenseReceivers(world: World, teamId: string, p: OffPersonnel, n: number): import('../types').Player[] {
  const def = offDef(p)
  if (!def) return depthGroup(world, teamId, ['WR', 'TE'], n)
  const seen = new Set<string>()
  const out: import('../types').Player[] = []
  const take = (pos: Position, k: number) => {
    for (const pl of depthGroup(world, teamId, [pos], k)) {
      if (out.length >= n) return
      if (seen.has(pl.id)) continue
      seen.add(pl.id)
      out.push(pl)
    }
  }
  take('WR', def.wr)
  take('TE', def.te)
  take('RB', def.rb)
  // Thin rosters: top up with the next best receivers rather than short a body.
  for (const f of depthGroup(world, teamId, ['WR', 'TE', 'RB'], 9)) {
    if (out.length >= n) break
    if (seen.has(f.id)) continue
    seen.add(f.id)
    out.push(f)
  }
  return out.slice(0, n)
}

/** The defensive front/coverage counts for a package (DL is always four). */
export function defenseCounts(p: DefPackage): { dl: number; lb: number; cb: number; s: number } {
  const def = defDef(p)
  return def ? { dl: def.dl, lb: def.lb, cb: def.cb, s: def.s } : { dl: 4, lb: 3, cb: 3, s: 2 }
}

/** The offensive skill-position quota for a package (mirrors `defenseCounts`). */
export function offenseCounts(p: OffPersonnel): { wr: number; te: number; rb: number; fb: boolean } {
  const def = offDef(p)
  return def ? { wr: def.wr, te: def.te, rb: def.rb, fb: def.fb } : { wr: 3, te: 1, rb: 1, fb: false }
}

/** A readable "who's on the field" list for the Game Plan card. */
export function onField(world: World, teamId: string, side: 'off' | 'def', value: OffPersonnel | DefPackage): { pos: string; name: string; ovr: number }[] {
  const rows: { pos: string; name: string; ovr: number }[] = []
  if (side === 'off') {
    const def = offDef(value as OffPersonnel)
    const read = (pos: Position, k: number) => {
      for (const p of depthGroup(world, teamId, [pos], k)) rows.push({ pos: p.pos, name: p.name, ovr: p.ovr })
    }
    if (def) {
      read('WR', def.wr)
      read('TE', def.te)
      read('RB', def.rb)
    }
  } else {
    const counts = defenseCounts(value as DefPackage)
    const read = (pos: Position, k: number) => {
      for (const p of depthGroup(world, teamId, [pos], k)) rows.push({ pos: p.pos, name: p.name, ovr: p.ovr })
    }
    read('DE', 2)
    read('DT', 2)
    read('LB', counts.lb)
    read('CB', counts.cb)
    read('S', counts.s)
  }
  return rows
}
