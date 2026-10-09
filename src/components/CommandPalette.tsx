import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react'
import { cn } from '../lib/cn'
import { SCREENS, useGame, useWorld, userCtx, type ScreenId } from '../store/gameStore'
import { accessFor, type AccessArea } from '../game/engine/access'
import { stageOf, type OffseasonStage } from '../game/engine/draft'
import type { World } from '../game/engine/generate'
import type { CareerState, Player } from '../game/types'

// ─────────────────────────────────────────────────────────────────────────────
// U3b: the ⌘K command palette. One fuzzy search over screens (every sidebar
// item), the league's players, its clubs and a few global actions. The index is
// built once each time the palette opens, so typing stays cheap.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RESULTS = 50

const GROUP_LABEL: Record<Item['kind'], string> = {
  screen: 'Go to',
  player: 'Players',
  club: 'Clubs',
  action: 'Actions',
}

const AREA_BY_SCREEN: Partial<Record<ScreenId, AccessArea>> = {
  scouting: 'scouting',
  draft: 'draft',
  cap: 'cap',
  freeagency: 'freeagency',
  trades: 'trades',
  staff: 'staff',
  gameplan: 'gameplan',
  roster: 'roster',
}

type Item =
  | { kind: 'screen'; key: string; label: string; sub: string; sort: string; screen: ScreenId }
  | { kind: 'player'; key: string; label: string; sub: string; sort: string; playerId: string }
  | { kind: 'club'; key: string; label: string; sub: string; sort: string; teamId: string }
  | { kind: 'action'; key: string; label: string; sub: string; sort: string; run: () => void }

interface Indexed {
  item: Item
  hay: string
}

const STAGE_LABEL: Record<OffseasonStage, string> = {
  resign: 're-sign',
  freeAgency: 'free agency',
  draft: 'draft',
  camp: 'camp',
}

/** Case-insensitive substring-first fuzzy score (higher is a better match). */
function fuzzyScore(needle: string, hay: string): number {
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
function buildIndex(world: World, career: CareerState | null): Indexed[] {
  const out: Indexed[] = []

  // Every sidebar item visible at this career's tier / access level.
  const tier = career?.tier ?? 'NFL'
  for (const s of SCREENS) {
    if (!s.tiers.includes(tier)) continue
    const area = AREA_BY_SCREEN[s.id]
    if (area && career && accessFor(career, area) === 'locked') continue
    out.push({
      item: { kind: 'screen', key: `screen:${s.id}`, label: s.label, sub: s.group, sort: s.label, screen: s.id },
      hay: `${s.label} ${s.group} screen`,
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

export function CommandPalette() {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const gameDay = useGame((s) => s.gameDay)
  const tick = useGame((s) => s.tick)
  const setScreen = useGame((s) => s.setScreen)
  const selectPlayer = useGame((s) => s.selectPlayer)
  const viewTeam = useGame((s) => s.viewTeam)
  const advanceWeek = useGame((s) => s.advanceWeek)
  const advanceStage = useGame((s) => s.advanceStage)
  const startGameDay = useGame((s) => s.startGameDay)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Reset and show. Keeping this out of an effect avoids a setState-in-effect.
  const openPalette = useCallback(() => {
    setQuery('')
    setActive(0)
    setOpen(true)
  }, [])

  // Open from anywhere: ⌘K / Ctrl+K, or the top-bar search button's event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'))) return
      if (gameDay) return
      e.preventDefault()
      if (open) setOpen(false)
      else openPalette()
    }
    const onOpen = () => {
      if (gameDay) return
      openPalette()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('gd:command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('gd:command-palette', onOpen)
    }
  }, [gameDay, open, openPalette])

  // Pull focus into the dialog when it opens (DOM sync only).
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  const stage = stageOf(world)
  const canCoach =
    !!career &&
    !gameDay &&
    world.phase === 'regular' &&
    !!userCtx(career) &&
    world.schedule.some(
      (g) => !g.played && g.week === world.week && (g.homeId === career.teamId || g.awayId === career.teamId),
    )

  // Index once per open (refreshes if the world mutates while open).
  const base = useMemo(() => {
    void tick
    return open ? buildIndex(world, career) : []
  }, [open, world, career, tick])
  const index = useMemo(() => {
    const actions: Item[] = [
      {
        kind: 'action',
        key: 'action:advance',
        label: stage ? `Advance: ${STAGE_LABEL[stage]}` : world.week >= 18 ? 'Finish season' : 'Advance week',
        sub: 'Same action as the top-bar button',
        sort: 'Advance week',
        run: () => (stage ? advanceStage() : void advanceWeek()),
      },
    ]
    if (canCoach) {
      actions.push({
        kind: 'action',
        key: 'action:coach',
        label: 'Coach the game',
        sub: "Coach this week's game moment by moment",
        sort: 'Coach the game',
        run: () => startGameDay(),
      })
    }
    return base.concat(actions.map((a) => ({ item: a, hay: `${a.label} action` })))
  }, [base, stage, canCoach, advanceWeek, advanceStage, startGameDay, world.week])

  const results = useMemo(() => {
    const n = query.trim()
    if (!n) {
      return index.filter((i) => i.item.kind === 'screen' || i.item.kind === 'action').slice(0, MAX_RESULTS)
    }
    return index
      .map((i) => ({ i, s: fuzzyScore(n, i.hay) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i.item.sort.localeCompare(b.i.item.sort))
      .slice(0, MAX_RESULTS)
      .map((x) => x.i)
  }, [index, query])

  // Clamp the highlight as the result set changes; keep it in view.
  const safeActive = results.length ? Math.min(active, results.length - 1) : 0
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${safeActive}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [safeActive, results])

  if (!open) return null

  const choose = (item: Item) => {
    setOpen(false)
    if (item.kind === 'screen') setScreen(item.screen)
    else if (item.kind === 'player') selectPlayer(item.playerId)
    else if (item.kind === 'club') viewTeam(item.teamId)
    else item.run()
  }

  const onDialogKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(Math.min(results.length - 1, safeActive + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(0, safeActive - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[safeActive]
      if (item) choose(item.item)
      return
    }
    if (e.key === 'Tab') {
      // Focus trap: the search input is the only tab stop in the dialog.
      e.preventDefault()
      inputRef.current?.focus()
    }
  }

  let lastKind: Item['kind'] | null = null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/45 p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onDialogKey}
        className="motion flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            placeholder="Search screens, players, clubs and actions…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          />
          <kbd className="hidden shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-cond text-[10px] font-700 uppercase text-muted sm:inline">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted">No matches.</div>
          ) : (
            results.map((r, i) => {
              const item = r.item
              const header = item.kind !== lastKind ? GROUP_LABEL[item.kind] : null
              lastKind = item.kind
              const on = i === safeActive
              return (
                <div key={item.key}>
                  {header && <div className="label px-3 pb-1 pt-2.5 !text-[9px]">{header}</div>}
                  <button
                    type="button"
                    data-index={i}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                    className={cn(
                      'motion flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                      on ? 'bg-[var(--team-soft)]' : 'hover:bg-surface-2',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-600 text-ink">{item.label}</div>
                      <div className="truncate text-[11px] text-muted">{item.sub}</div>
                    </div>
                    {on &&
                      (item.kind === 'action' ? (
                        <CornerDownLeft size={13} className="shrink-0 text-muted" />
                      ) : (
                        <ArrowRight size={13} className="shrink-0 text-muted" />
                      ))}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10px] text-faint">
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft size={11} /> open
          </span>
          <span>↑↓ move</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  )
}
