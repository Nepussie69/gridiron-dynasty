import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  Activity,
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  DollarSign,
  Gauge,
  Globe,
  History as HistoryIcon,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Repeat,
  Search,
  Shield,
  TrendingUp,
  Trophy,
  UserCog,
  UserRound,
  Users,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { inkOn, money } from '../lib/format'
import { SCREENS, useGame, useWorld, userCtx, type ScreenId } from '../store/gameStore'
import { tierFor } from '../game/engine/career'
import { stageOf } from '../game/engine/draft'
import { accessFor } from '../game/engine/access'
import { capSpaceTone } from '../game/engine/capMemo'
import { AccessBadge } from './AccessBadge'
import { CommandPalette } from './CommandPalette'
import type { AccessArea } from '../game/engine/access'
import { capSpace, recordOf, rosterOf, scheduleFor, teamAvgOvr } from '../game/selectors'
import { Badge, Button, TeamCrest, ThemeToggle, TweenNumber } from '../ui/kit'

type IconType = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>

const ICONS: Record<ScreenId, IconType> = {
  career: UserRound,
  history: HistoryIcon,
  dashboard: LayoutDashboard,
  ledger: BookOpen,
  roster: Users,
  depth: ListOrdered,
  development: TrendingUp,
  gameplan: ClipboardList,
  schedule: CalendarDays,
  standings: Trophy,
  stats: BarChart3,
  awards: Award,
  scouting: Search,
  players: Search,
  draft: ClipboardList,
  freeagency: Repeat,
  trades: Activity,
  cap: DollarSign,
  staff: UserCog,
  league: Globe,
  inbox: Inbox,
  team: Users,
}

/** Which access area each screen belongs to (for the top-bar access badge). */
const AREA_BY_SCREEN: Partial<Record<ScreenId, AccessArea>> = {
  scouting: 'scouting',
  draft: 'draft',
  cap: 'cap',
  freeagency: 'freeagency',
  trades: 'trades',
  staff: 'staff',
  gameplan: 'gameplan',
  roster: 'roster',
  depth: 'roster',
  development: 'roster',
}

export function Sidebar() {
  const screen = useGame((s) => s.screen)
  const setScreen = useGame((s) => s.setScreen)
  const career = useGame((s) => s.career)
  const resetCareer = useGame((s) => s.resetCareer)
  const exportSaveText = useGame((s) => s.exportSaveText)
  const importSaveText = useGame((s) => s.importSaveText)
  const readNews = useGame((s) => s.readNews)
  const unread = useWorld().news.filter((n) => !readNews[n.id]).length

  const tier = career?.tier ?? 'NFL'
  const visible = SCREENS.filter((s) => {
    if (!s.tiers.includes(tier)) return false
    // The ladder is the tutorial: hide screens that are locked at this rung.
    const area = AREA_BY_SCREEN[s.id]
    if (area && career && accessFor(career, area) === 'locked') return false
    return true
  })
  const groups = ['Career', 'Team', 'Personnel', 'Club', 'League'] as const

  // Collapse preference persists in localStorage; phones start collapsed.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('gd.sidebar')
      if (v === 'collapsed') return true
      if (v === 'expanded') return false
    } catch {
      /* ignore */
    }
    return typeof window !== 'undefined' && window.innerWidth < 768
  })
  useEffect(() => {
    try {
      localStorage.setItem('gd.sidebar', collapsed ? 'collapsed' : 'expanded')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  // Sliding active-pill indicator, positioned imperatively so it animates.
  const navRef = useRef<HTMLElement | null>(null)
  const pillRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const nav = navRef.current
    const pill = pillRef.current
    if (!nav || !pill) return
    const el = nav.querySelector<HTMLElement>(`[data-nav-id="${screen}"]`)
    if (!el) {
      pill.style.display = 'none'
      return
    }
    const navRect = nav.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    pill.style.display = ''
    pill.style.height = `${elRect.height}px`
    pill.style.transform = `translateY(${elRect.top - navRect.top + nav.scrollTop}px)`
  }, [screen, collapsed, visible.length])

  useEffect(() => {
    const onResize = () => {
      const nav = navRef.current
      const pill = pillRef.current
      if (!nav || !pill) return
      const el = nav.querySelector<HTMLElement>('[data-nav-active="true"]')
      if (!el) return
      const navRect = nav.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      pill.style.height = `${elRect.height}px`
      pill.style.transform = `translateY(${elRect.top - navRect.top + nav.scrollTop}px)`
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <aside
      className={cn(
        'motion relative z-20 flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 ease-out',
        collapsed ? 'w-[68px]' : 'w-[218px]',
      )}
    >
      <div className={cn('flex items-center gap-2.5 border-b border-line py-4', collapsed ? 'justify-center px-2' : 'px-4')}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink text-canvas">
          <Shield size={18} strokeWidth={2.4} />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-display text-base font-700 uppercase tracking-wide">Gridiron</div>
            <div className="font-display text-base font-700 uppercase tracking-wide text-[var(--team)] leading-none">
              Dynasty
            </div>
          </div>
        )}
      </div>

      <nav ref={navRef} className="relative flex-1 overflow-y-auto px-2 py-3">
        <div
          ref={pillRef}
          aria-hidden
          className="pointer-events-none absolute left-2 right-2 top-0 z-0 rounded-lg bg-[var(--team)] transition-transform duration-200 ease-out"
          style={{ display: 'none' }}
        />
        {groups.map((g) => {
          const items = visible.filter((s) => s.group === g)
          if (!items.length) return null
          return (
            <div key={g} className="mb-3">
              {!collapsed && <div className="label px-3 pb-1.5 !text-[9px]">{g}</div>}
              <div className="space-y-0.5">
                {items.map((s) => {
                  const Icon = ICONS[s.id]
                  const active = screen === s.id
                  return (
                    <button
                      key={s.id}
                      data-nav-id={s.id}
                      data-nav-active={active}
                      onClick={() => setScreen(s.id)}
                      title={collapsed ? s.label : undefined}
                      className={cn(
                        'motion group relative z-10 flex w-full items-center gap-2.5 rounded-lg py-2 text-left text-sm font-500',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        active ? 'text-[var(--team-ink)]' : 'text-ink-2 hover:bg-surface-2',
                      )}
                    >
                      <Icon
                        size={17}
                        strokeWidth={2.1}
                        className={cn('shrink-0', active ? '' : 'text-muted group-hover:text-ink-2')}
                      />
                      {!collapsed && (
                        <span className="flex-1 font-cond font-600 uppercase tracking-wide text-[13px]">
                          {s.label}
                        </span>
                      )}
                      {s.id === 'inbox' && unread > 0 && !collapsed && (
                        <span
                          className={cn(
                            'grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-700',
                            active ? 'bg-black/25 text-white' : 'bg-[var(--team)] text-[var(--team-ink)]',
                          )}
                        >
                          {unread}
                        </span>
                      )}
                      {s.id === 'inbox' && unread > 0 && collapsed && (
                        <span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-[var(--color-loss)]" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="border-t border-line p-2.5">
        {collapsed ? (
          <div
            className="grid place-items-center rounded-lg bg-surface-2 py-2 text-muted"
            title={career ? tierFor(career.path, career.level).title : '—'}
          >
            <UserCog size={16} />
          </div>
        ) : (
          <div className="rounded-lg bg-surface-2 p-2.5">
            <div className="label mb-1">Career</div>
            <div className="font-cond text-xs font-600 text-ink-2">
              {career ? tierFor(career.path, career.level).title : '—'}
            </div>
            <div className="mt-0.5 font-cond text-[11px] text-muted">
              {career?.path === 'coach' ? 'Coaching' : 'Personnel'} · Season {career?.season ?? 2026}
            </div>
            <button
              onClick={() => {
                if (confirm('Start a new career? Your current save will be erased.')) resetCareer()
              }}
              className="motion mt-2 w-full rounded-md border border-line bg-surface px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-muted hover:text-loss"
            >
              New Career
            </button>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button
                onClick={async () => {
                  const text = await exportSaveText()
                  if (!text) return
                  const blob = new Blob([text], { type: 'application/json' })
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = `gridiron-save-${career?.season ?? 'career'}.json`
                  a.click()
                  URL.revokeObjectURL(a.href)
                }}
                className="motion rounded-md border border-line bg-surface px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-muted hover:text-ink-2"
              >
                Export Save
              </button>
              <label className="motion cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-center font-cond text-[10px] font-700 uppercase tracking-wide text-muted hover:text-ink-2">
                Import
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const text = await f.text()
                    await importSaveText(text)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>
        )}
        <div className="mt-2">
          <ThemeToggle compact={collapsed} />
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="motion mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-muted hover:text-ink"
        >
          {collapsed ? <ChevronsRight size={13} /> : <><ChevronsLeft size={13} /> Collapse</>}
        </button>
      </div>
    </aside>
  )
}

const STAGE_LABEL: Record<string, string> = {
  resign: 'FEB · RE-SIGN',
  freeAgency: 'MAR · FREE AGENCY',
  draft: 'APR · DRAFT',
  camp: 'AUG · CAMP',
}
const STAGE_ADVANCE: Record<string, string> = {
  resign: 'To free agency ▸',
  freeAgency: 'To the draft ▸',
  draft: 'To camp ▸',
  camp: 'Start season ▸',
}

export function TopBar() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)
  const advanceWeek = useGame((s) => s.advanceWeek)
  const advanceStage = useGame((s) => s.advanceStage)
  const startGameDay = useGame((s) => s.startGameDay)
  const gameDay = useGame((s) => s.gameDay)
  const setScreen = useGame((s) => s.setScreen)
  const screen = useGame((s) => s.screen)
  const leaguePbp = useGame((s) => s.leaguePbp)
  const setLeaguePbp = useGame((s) => s.setLeaguePbp)
  const accessArea = AREA_BY_SCREEN[screen]
  const modal = useGame((s) => s.modal)
  const match = useGame((s) => s.match)
  const selectedPlayerId = useGame((s) => s.selectedPlayerId)
  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent),
    [],
  )

  const team = league.byId[activeTeamId]
  const rec = recordOf(league, activeTeamId)
  const space = capSpace(league, activeTeamId)
  const roster = rosterOf(league, activeTeamId)
  const avg = teamAvgOvr(roster)

  const next = useMemo(() => {
    if (!career || team.tier !== 'NFL') return null
    const { out } = scheduleFor(league, activeTeamId)
    return out.find((g) => g.week >= career.week) ?? out[out.length - 1]
  }, [league, activeTeamId, career, team.tier])

  const opp = next ? league.byId[next.opponentId] : null
  const stage = stageOf(league)
  const canCoach =
    !!career &&
    !gameDay &&
    league.phase === 'regular' &&
    !!userCtx(career) &&
    league.schedule.some(
      (g) => !g.played && g.week === league.week && (g.homeId === career.teamId || g.awayId === career.teamId),
    )

  // ⌘↵ / Ctrl↵ advances the week — the same action as the button. Ignored while
  // typing, or when a modal / game day / replay is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      )
        return
      if (modal !== 'none' || gameDay || match || selectedPlayerId || !career) return
      e.preventDefault()
      if (stage) advanceStage()
      else void advanceWeek()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, gameDay, match, selectedPlayerId, career, stage, advanceStage, advanceWeek])

  const advanceLabel = stage
    ? STAGE_ADVANCE[stage].replace(' ▸', '')
    : league.week >= 18
      ? 'Finish Season'
      : 'Advance Week'

  return (
    <header
      className="relative z-30 flex h-[68px] shrink-0 items-center gap-3 border-b border-line px-4 backdrop-blur-md"
      style={{
        background: `linear-gradient(100deg, color-mix(in srgb, ${team.primary} 92%, transparent) 0%, color-mix(in srgb, ${team.secondary} 92%, transparent) 78%)`,
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <TeamCrest team={team} size={42} />
        <div className="min-w-0 leading-tight">
          <div className="label !text-white/70">{team.tier === 'NFL' ? `${team.conference} ${team.division}` : team.conference}</div>
          <div className="truncate font-display text-xl font-700 uppercase tracking-wide text-white">
            {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
          </div>
        </div>
      </div>

      <div className="ml-2 hidden items-center gap-2 lg:flex">
        <ScorePill icon={Trophy} label="Record" value={<RecordValue wins={rec.wins} losses={rec.losses} />} />
        <ScorePill icon={Gauge} label="Team OVR" value={<TweenNumber value={Math.round(avg)} />} />
        {team.tier === 'NFL' && (
          <ScorePill
            icon={DollarSign}
            label="Cap Space"
            value={<TweenNumber value={space} format={(n) => money(n)} />}
            tone={capSpaceTone(space)}
          />
        )}
        {accessArea && <AccessBadge area={accessArea} />}
      </div>

      <div className="flex-1" />

      {stage ? (
        <WeekPill icon={CalendarDays} label="Offseason" value={STAGE_LABEL[stage]} />
      ) : (
        <WeekPill
          icon={CalendarDays}
          label="Season"
          value={`Week ${Math.min(league.week, 18)} of 18`}
          pct={(Math.min(league.week, 18) / 18) * 100}
        />
      )}

      {opp && (
        <button
          onClick={() => setScreen('schedule')}
          className="motion hidden items-center gap-3 rounded-lg border border-white/25 bg-black/20 px-3 py-1.5 text-white hover:bg-black/30 md:flex"
        >
          <div className="text-right leading-tight">
            <div className="label !text-white/60">Week {next!.week} · {next!.home ? 'vs' : '@'}</div>
            <div className="font-display text-base font-700 uppercase">{opp.name}</div>
          </div>
          <TeamCrest team={opp} size={30} />
        </button>
      )}

      {career && (
        <div className="hidden text-right leading-tight xl:block">
          <div className="label !text-white/60">Job Security</div>
          <div className="font-display text-lg font-700 tnum text-white">{career.jobSecurity}%</div>
        </div>
      )}

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('gd:command-palette'))}
        title={`Search screens, players, clubs and actions (${isMac ? '⌘K' : 'Ctrl+K'})`}
        className="motion grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/25 bg-black/20 text-white/85 hover:bg-black/30 hover:text-white"
      >
        <Search size={15} />
      </button>

      <button
        onClick={() => setLeaguePbp(!leaguePbp)}
        title="Simulate every league game play-by-play (slower, more authentic stats)"
        className={cn(
          'motion hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 font-cond text-[11px] font-700 uppercase tracking-wide md:flex',
          leaguePbp
            ? 'border-transparent bg-[#8ef0b5] text-[#0a1626]'
            : 'border-white/25 bg-black/20 text-white/80 hover:bg-black/30',
        )}
      >
        <Activity size={13} /> {leaguePbp ? 'Authentic Sim' : 'Fast Sim'}
      </button>

      {canCoach && (
        <Button
          variant="primary"
          className="!border !border-white/40 !bg-black/20 !text-white hover:!bg-black/30"
          onClick={startGameDay}
          title="Coach this week's game moment by moment"
        >
          <span className="whitespace-nowrap sm:hidden">Coach</span>
          <span className="hidden whitespace-nowrap sm:inline">Coach the game</span>
        </Button>
      )}

      <Button
        variant="primary"
        className="!bg-white !text-[#0a1626] hover:!bg-white/90"
        onClick={() => (stage ? advanceStage() : void advanceWeek())}
        title={`${advanceLabel} (${isMac ? '⌘↵' : 'Ctrl↵'})`}
      >
        {advanceLabel} ▸
        <kbd className="ml-0.5 hidden rounded border border-black/20 bg-black/5 px-1 font-cond text-[10px] font-700 normal-case tracking-normal md:inline">
          {isMac ? '⌘↵' : 'Ctrl↵'}
        </kbd>
      </Button>
    </header>
  )
}

function RecordValue({ wins, losses }: { wins: number; losses: number }) {
  return (
    <>
      <TweenNumber value={wins} />-<TweenNumber value={losses} />
    </>
  )
}

function ScorePill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon?: IconType
  label: string
  value: ReactNode
  tone?: 'win' | 'loss' | 'warn'
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/20 bg-black/15 px-2.5 py-1 leading-tight">
      {Icon && <Icon size={14} className="text-white/70" />}
      <div>
        <div className="label !text-[9px] !text-white/60">{label}</div>
        <div className={cn('font-display text-base font-700 tnum', tone === 'win' ? 'text-[#8ef0b5]' : tone === 'loss' ? 'text-[#ffb3ba]' : tone === 'warn' ? 'text-[#ffd58a]' : 'text-white')}>
          {value}
        </div>
      </div>
    </div>
  )
}

function WeekPill({
  icon: Icon,
  label,
  value,
  pct,
}: {
  icon?: IconType
  label: string
  value: string
  pct?: number
}) {
  return (
    <div
      className="hidden items-center gap-2 rounded-lg border border-white/20 bg-black/15 px-2.5 py-1 leading-tight sm:flex"
      title={`${label} · ${value}`}
    >
      {Icon && <Icon size={14} className="text-white/70" />}
      <div>
        <div className="label !text-[9px] !text-white/60">{label}</div>
        <div className="font-display text-sm font-700 tnum text-white">{value}</div>
      </div>
      {pct != null && (
        <div className="ml-1 h-1 w-12 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white/80" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const team = league.byId[activeTeamId]
  const toast = useGame((s) => s.toast)

  const themeVars = {
    '--team': team.primary,
    '--team-2': team.secondary,
    '--team-ink': inkOn(team.primary),
  } as React.CSSProperties

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas" style={themeVars}>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1500px] p-5">{children}</div>
        </main>
      </div>
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-full bg-ink px-5 py-2.5 text-sm font-600 text-canvas shadow-xl">{toast}</div>
        </div>
      )}
      <CommandPalette />
    </div>
  )
}

export function RecordBadge({ wins, losses }: { wins: number; losses: number }) {
  const win = wins >= losses
  return (
    <Badge tone={win ? 'win' : 'loss'}>
      {wins}-{losses}
    </Badge>
  )
}
