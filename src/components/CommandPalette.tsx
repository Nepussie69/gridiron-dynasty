import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { ArrowRight, CornerDownLeft, Search, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { useGame, useWorld, type ScreenId } from '../store/gameStore'
import { stageOf } from '../game/engine/draft'
import type { World } from '../game/engine/generate'
import type { CareerState, Player } from '../game/types'
import { IconButton, useDensity } from '../ui/kit'
import {
  ADVANCE_KEYS,
  advanceLabel,
  canCoach as canCoachNow,
  getSidebarCollapsed,
  navGroupOf,
  openSettings,
  PALETTE_KEYS,
  readThemePref,
  setSidebarCollapsed,
  setThemePref,
  STAGE_NAME,
  subscribeSidebar,
  visibleScreens,
  type ThemePref,
} from '../ui/nav'

// ─────────────────────────────────────────────────────────────────────────────
// U3b: the ⌘K command palette. One fuzzy search over screens (every sidebar
// item), the league's players, its clubs and the global actions (advance,
// coach, sim mode, theme, density, sidebar, export / import, settings, new
// career). The index is built once each time the palette opens, so typing
// stays cheap. F3: nav model shared with the shell via src/ui/nav.ts.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RESULTS = 50

const GROUP_LABEL: Record<Item['kind'], string> = {
  screen: 'Go to',
  player: 'Players',
  club: 'Clubs',
  action: 'Actions',
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
  const leaguePbp = useGame((s) => s.leaguePbp)
  const setLeaguePbp = useGame((s) => s.setLeaguePbp)
  const density = useDensity()
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarCollapsed, () => false)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
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

  // Pull focus into the dialog synchronously when it opens, and give it back
  // to whatever had it when it closes.
  const returnFocus = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => {
      const el = returnFocus.current
      if (el && document.contains(el)) el.focus({ preventScroll: true })
    }
  }, [open])

  const stage = stageOf(world)
  const canCoach = canCoachNow(world, career, !!gameDay)

  // Index once per open (refreshes if the world mutates while open).
  const base = useMemo(() => {
    void tick
    return open ? buildIndex(world, career) : []
  }, [open, world, career, tick])
  const index = useMemo(() => {
    const act = (key: string, label: string, sub: string, run: () => void): Item => ({
      kind: 'action',
      key: `action:${key}`,
      label,
      sub,
      sort: label,
      run,
    })
    const advance = () => (stage ? advanceStage() : void advanceWeek())
    const actions: Item[] = []
    if (canCoach) actions.push(act('coach', 'Coach the game', "Coach this week's game moment by moment", () => startGameDay()))
    actions.push(
      act(
        'advance',
        canCoach ? 'Sim week instead' : stage ? `Advance: ${advanceLabel(world).toLowerCase()}` : advanceLabel(world),
        canCoach
          ? `Your game is simulated with the league · ${ADVANCE_KEYS}`
          : stage
            ? `Leave ${STAGE_NAME[stage]} · ${ADVANCE_KEYS}`
            : `Same action as the top-bar button · ${ADVANCE_KEYS}`,
        advance,
      ),
    )
    actions.push(
      act(
        'sim-mode',
        `Sim mode: switch to ${leaguePbp ? 'Fast' : 'Authentic'}`,
        leaguePbp
          ? 'Now Authentic. Fast sims league games as box scores (quicker weeks)'
          : 'Now Fast. Authentic sims every league game play-by-play',
        () => setLeaguePbp(!leaguePbp),
      ),
    )
    const theme = readThemePref()
    for (const t of ['system', 'light', 'dark'] as ThemePref[]) {
      if (t === theme) continue
      actions.push(act(`theme-${t}`, `Theme: ${t[0].toUpperCase()}${t.slice(1)}`, `Now ${theme}`, () => setThemePref(t)))
    }
    const nextDensity = density.density === 'compact' ? 'comfortable' : 'compact'
    actions.push(
      act('density', `Table density: ${nextDensity}`, `Now ${density.density}`, () => density.set(nextDensity)),
    )
    actions.push(
      act(
        'sidebar',
        collapsed ? 'Expand the sidebar' : 'Collapse the sidebar',
        'Desktop at 1024px and wider (768-1023px always shows the rail)',
        () => setSidebarCollapsed(!collapsed),
      ),
    )
    actions.push(act('export', 'Export save', 'Download this career as a .json file', () => window.dispatchEvent(new Event('gd:export-save'))))
    actions.push(act('import', 'Import save…', 'Load a career from a .json file', () => window.dispatchEvent(new Event('gd:import-save'))))
    actions.push(act('settings', 'Settings', 'Theme, density, sim mode, save file, new career', () => openSettings()))
    actions.push(act('new-career', 'New career…', 'Erase this save, after a review step', () => window.dispatchEvent(new Event('gd:new-career'))))
    return base.concat(actions.map((a) => ({ item: a, hay: `${a.label} ${a.sub} action` })))
  }, [base, stage, canCoach, advanceWeek, advanceStage, startGameDay, world, leaguePbp, setLeaguePbp, density, collapsed])

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
      // Focus trap: the search input and the close button are the tab stops.
      e.preventDefault()
      if (document.activeElement === inputRef.current) closeRef.current?.focus()
      else inputRef.current?.focus()
    }
  }

  let lastKind: Item['kind'] | null = null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-[rgb(3_6_12/0.62)] px-3 pb-3 pt-[max(12px,env(safe-area-inset-top),10dvh)] backdrop-blur-[2px] sm:px-4"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onDialogKey}
        className="motion flex max-h-[min(80dvh,640px)] w-full max-w-xl flex-col overflow-hidden rounded-[var(--r-lg)] border border-line-strong bg-surface text-ink shadow-[var(--shadow-2)]"
      >
        <div className="flex items-center gap-2 border-b border-line py-1.5 pl-4 pr-1.5">
          <Search size={16} className="shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            placeholder="Search screens, players, clubs and actions…"
            aria-label="Search screens, players, clubs and actions"
            className="h-10 w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-faint sm:text-body"
          />
          <kbd className="hidden shrink-0 rounded-[var(--r-xs)] border border-line bg-surface-2 px-1.5 py-0.5 font-cond text-label font-700 uppercase text-muted sm:inline">
            Esc
          </kbd>
          <IconButton ref={closeRef} label="Close the command palette" variant="ghost" onClick={() => setOpen(false)}>
            <X size={18} />
          </IconButton>
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
                  {header && <div className="label px-3 pb-1 pt-2.5">{header}</div>}
                  <button
                    type="button"
                    data-index={i}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                    className={cn(
                      'motion flex min-h-11 w-full items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-left',
                      on ? 'bg-[var(--team-tint)]' : 'hover:bg-surface-2',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-600 text-ink">{item.label}</div>
                      <div className="truncate text-label text-muted">{item.sub}</div>
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

        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-label text-muted sm:flex">
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft size={12} aria-hidden /> open
          </span>
          <span>↑↓ move</span>
          <span>Esc close</span>
          <span className="ml-auto">
            {PALETTE_KEYS} palette · {ADVANCE_KEYS} advance
          </span>
        </div>
      </div>
    </div>
  )
}
