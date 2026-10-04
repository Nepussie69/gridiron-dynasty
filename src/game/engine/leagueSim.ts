// ─────────────────────────────────────────────────────────────────────────────
// Client for the league play-by-play worker. Keeps one worker alive, sends a
// slim world snapshot per week, and resolves with per-game scores + box scores.
// Any failure (no Worker, error, timeout) resolves null so the caller can fall
// back to the fast allocator.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import type { PlayerBoxScore } from './stats'

export interface LeagueGameResult {
  id: string
  homeScore: number
  awayScore: number
  box: PlayerBoxScore[]
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (r: LeagueGameResult[] | null) => void>()

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../../workers/leagueSim.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const { id, results } = e.data as { id: number; results: LeagueGameResult[] }
      const cb = pending.get(id)
      if (cb) {
        pending.delete(id)
        cb(results)
      }
    }
    worker.onerror = () => {
      // Fail every in-flight request; the caller falls back to the fast sim.
      for (const [id, cb] of pending) {
        pending.delete(id)
        cb(null)
      }
      worker = null
    }
  } catch {
    worker = null
  }
  return worker
}

/**
 * Simulate a set of games play-by-play in the worker. Resolves null on any
 * failure (caller should fall back to the synchronous allocator path).
 */
export async function simLeagueGames(
  world: World,
  games: { id: string; homeId: string; awayId: string; seed: number }[],
): Promise<LeagueGameResult[] | null> {
  if (!games.length) return []
  const w = ensureWorker()
  if (!w) return null
  const id = ++seq
  return new Promise((resolve) => {
    const done = (r: LeagueGameResult[] | null) => {
      if (!pending.has(id)) return
      pending.delete(id)
      resolve(r)
    }
    pending.set(id, done)
    w.postMessage({
      id,
      type: 'week',
      world: {
        byId: world.byId,
        roster: world.roster,
        staff: world.staff,
        staffTenure: world.staffTenure,
        seed: world.seed,
      },
      games,
    })
    // Hard safety net so a stalled worker never freezes the season.
    setTimeout(() => done(null), 45000)
  })
}

/** Exposed for dev probes / disabling the feature. */
export function terminateLeagueWorker() {
  worker?.terminate()
  worker = null
  for (const [id, cb] of pending) {
    pending.delete(id)
    cb(null)
  }
}
