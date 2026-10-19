// ─────────────────────────────────────────────────────────────────────────────
// ⌘K palette index + fuzzy search (UI redesign U3b). Pure, React-free module so
// the component (components/CommandPalette.tsx) and the verification probe
// (logs/fut2-probe.mjs) share ONE definition of "what the palette can reach".
//
//   • buildPaletteIndex(world, career) — every screen visible at this career's
//     tier / access level (the same list as the sidebar and the phone group
//     sheets), every league player (rostered + free agents) and every club.
//   • fuzzyScore(needle, hay) — case-insensitive substring-first match, so a
//     prefix of a label always finds it (the probe asserts exactly that).
// Actions that mutate the store stay in the component.
// ─────────────────────────────────────────────────────────────────────────────
import type { World } from '../game/engine/generate'
import type { CareerState, Player } from '../game/types'
import type { ScreenId } from '../store/gameStore'
import { navGroupOf, visibleScreens } from './nav'

export type PaletteItem =
  | { kind: 'screen'; key: string; label: string; sub: string; sort: string; screen: ScreenId }
  | { kind: 'player'; key: string; label: string; sub: string; sort: string; playerId: string }
  | { kind: 'club'; key: string; label: string; sub: string; sort: string; teamId: string }

export interface IndexedItem {
  item: PaletteItem
  hay: string
}

/** Case-insensitive substring-first fuzzy score (higher is a better match, -1 none). */
export function fuzzyScore(needle: string, hay: string): number {
  if (!needle) return 1
  const h = hay.toLowerCase()
  const n = needle.toLowerCase()
  const idx = h.indexOf(n)
  if (idx >= 0) return 1000 - idx + (idx === 0 ? 250 : 0) - h.length * 0.05
  let hi = 0
  let gaps = 0
  for (let ni = 0; ni < n.length; ni++) {
    const found = h.indexOf(n[ni], hi)
    if (found < 0) return -1
    if (ni > 0) gaps += found - hi
    hi = found + 1
  }
  return 300 - gaps - h.length * 0.05
}

/** Build the searchable index once per open from the live world. */
export function buildPaletteIndex(world: World, career: CareerState | null): IndexedItem[] {
  const out: IndexedItem[] = []

  // Every nav item visible at this career's tier / access level (same list as
  // the sidebar and the phone group sheets).
  for (const s of visibleScreens(career)) {
    const group = navGroupOf(s.id) ?? s.group
    out.push({
      item: { kind: 'screen', key: `screen:${s.id}`, label: s.label, sub: group, sort: s.label, screen: s.id },
      hay: `${s.label} ${group} screen`,
    })
  }

  // League-wide players (rostered + free agents), deduped by id.
  const seen = new Set<string>()
  const addPlayer = (p: Player) => {
    if (seen.has(p.id)) return
    seen.add(p.id)
    const club = p.teamId ? world.byId[p.teamId]?.abbr ?? '' : 'FA'
    out.push({
      item: {
        kind: 'player',
        key: `player:${p.id}`,
        label: p.name,
        sub: `${p.pos} · ${club} · ${p.ovr} OVR`,
        sort: p.name,
        playerId: p.id,
      },
      hay: `${p.name} ${p.pos} ${club}`,
    })
  }
  for (const p of world.players) addPlayer(p)
  for (const p of world.freeAgents) addPlayer(p)

  // Every club whose read-only team page can open.
  for (const t of world.teams) {
    out.push({
      item: {
        kind: 'club',
        key: `club:${t.id}`,
        label: t.tier === 'NFL' ? `${t.city} ${t.name}` : t.name,
        sub: t.tier === 'NFL' ? `${t.conference} ${t.division}` : t.tier,
        sort: `${t.city} ${t.name}`,
        teamId: t.id,
      },
      hay: `${t.city} ${t.name} ${t.abbr ?? ''} club team`,
    })
  }
  return out
}
