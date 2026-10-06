// ─────────────────────────────────────────────────────────────────────────────
// League play-by-play worker.
//
// Runs the true play-by-play engine for every league game in a week (not just
// the user's), so stats and storylines across the whole league are authentic.
// The world is serialized in "slim" form (rosters/staff, no top-level players
// array); the worker rebuilds the player list from the rosters.
// ─────────────────────────────────────────────────────────────────────────────

import { loadCalibration } from '../game/data/calibration'
import { simulatePlayByPlay } from '../game/engine/playsim'
import { boxScore, type PlayerBoxScore } from '../game/engine/stats'
import type { World } from '../game/engine/generate'

interface SlimWorld {
  byId: World['byId']
  roster: World['roster']
  staff: World['staff']
  staffTenure: World['staffTenure']
  seed: number
  depth?: World['depth']
}

interface WeekRequest {
  id: number
  type: 'week'
  world: SlimWorld
  games: { id: string; homeId: string; awayId: string; seed: number }[]
}

interface WeekResult {
  id: string
  homeScore: number
  awayScore: number
  box: PlayerBoxScore[]
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as WeekRequest
  if (!msg || msg.type !== 'week') return
  const post = (m: unknown) => (self as unknown as { postMessage: (m: unknown) => void }).postMessage(m)
  try {
    // Calibration is fetched per worker; the embedded fallback covers slow loads.
    await loadCalibration()
    const world = {
      ...msg.world,
      players: Object.values(msg.world.roster).flat(),
    } as unknown as World

    const results: WeekResult[] = []
    for (const g of msg.games) {
      const sim = simulatePlayByPlay(world, g.homeId, g.awayId, g.seed)
      results.push({
        id: g.id,
        homeScore: sim.homeScore,
        awayScore: sim.awayScore,
        box: boxScore(world, sim),
      })
    }
    post({ id: msg.id, results })
  } catch (err) {
    post({ id: msg.id, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
  }
}
