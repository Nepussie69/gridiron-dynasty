import type { Position } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Exact-ratings datasets, produced by scripts/ingest.py.
//
//   public/data/madden26.json — Madden NFL 26 (launch): every player's overall
//                               plus the full attribute set, team, age, college.
//   public/data/cfb26.json    — EA Sports College Football 26: every FBS roster
//                               with overall, core attributes, class, measurables.
//
// Loaded once at boot (static files, so the JS bundle stays small) and consumed
// by the world generator to build real rosters.
// ─────────────────────────────────────────────────────────────────────────────

export interface RealNflPlayer {
  name: string
  pos: Position
  team: string
  age: number
  college: string
  height: string
  weight: number
  ovr: number
  archetype: string
  attrs: Record<string, number>
}

export interface RealCfbPlayer {
  name: string
  pos: Position
  cls: 'FR' | 'SO' | 'JR' | 'SR'
  ht: number // inches
  wt: number
  ovr: number
  dev: string
  attrs: Record<string, number>
}

export interface RealCfbTeam {
  school: string
  teamId: string
  conference: string
  players: RealCfbPlayer[]
}

export interface RealData {
  nfl: RealNflPlayer[]
  cfb: RealCfbTeam[]
  source: { madden: string; cfb: string }
}

let cache: RealData | null = null

export function getRealData(): RealData | null {
  return cache
}
export function setRealData(data: RealData | null) {
  cache = data
}

export async function loadRealData(): Promise<RealData | null> {
  if (cache) return cache
  try {
    const base = import.meta.env.BASE_URL ?? '/'
    const [nflRes, cfbRes] = await Promise.all([
      fetch(`${base}data/madden26.json`),
      fetch(`${base}data/cfb26.json`),
    ])
    if (!nflRes.ok || !cfbRes.ok) return null
    const nfl = await nflRes.json()
    const cfb = await cfbRes.json()
    cache = {
      nfl: nfl.players as RealNflPlayer[],
      cfb: cfb.teams as RealCfbTeam[],
      source: { madden: nfl.source, cfb: cfb.source },
    }
    return cache
  } catch {
    return null
  }
}
