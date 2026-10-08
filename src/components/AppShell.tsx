import { useMemo, type ComponentType, type ReactNode } from 'react'
import {
  Activity,
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  DollarSign,
  Globe,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Repeat,
  Search,
  Shield,
  Trophy,
  UserCog,
  UserRound,
  Users,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { inkOn, money, tint } from '../lib/format'
import { SCREENS, useGame, useWorld, userCtx, type ScreenId } from '../store/gameStore'
import { tierFor } from '../game/engine/career'
import { stageOf } from '../game/engine/draft'
import { accessFor } from '../game/engine/access'
import { AccessBadge } from './AccessBadge'
import type { AccessArea } from '../game/engine/access'
import { capSpace, recordOf, recordStr, rosterOf, scheduleFor, teamAvgOvr } from '../game/selectors'
import { Badge, Button, TeamCrest } from '../ui/kit'

type IconType = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>

const ICONS: Record<ScreenId, IconType> = {
  career: UserRound,
  dashboard: LayoutDashboard,
  ledger: BookOpen,
  roster: Users,
  depth: ListOrdered,
  gameplan: ClipboardList,
  schedule: CalendarDays,
  standings: Trophy,
  stats: BarChart3,
  awards: Award,
  scouting: Search,
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

  return (
    <aside className="flex w-[218px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-white">
          <Shield size={18} strokeWidth={2.4} />
        </div>
        <div className="leading-tight">
          <div className="font-display text-base font-700 uppercase tracking-wide">Gridiron</div>
          <div className="font-display text-base font-700 uppercase tracking-wide text-[var(--team)] leading-none">
            Dynasty
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((g) => {
          const items = visible.filter((s) => s.group === g)
          if (!items.length) return null
          return (
            <div key={g} className="mb-4">
              <div className="label px-3 pb-1.5">{g}</div>
              <div className="space-y-0.5">
                {items.map((s) => {
                  const Icon = ICONS[s.id]
                  const active = screen === s.id
                  return (
                    <button
                      key={s.id}
                      onClick={() => setScreen(s.id)}
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-500 transition',
                        active ? 'text-[var(--team-ink)]' : 'text-ink-2 hover:bg-surface-2',
                      )}
                      style={active ? { background: 'var(--team)', color: 'var(--team-ink)' } : undefined}
                    >
                      <Icon size={17} strokeWidth={2.1} className={active ? '' : 'text-muted group-hover:text-ink-2'} />
                      <span className="flex-1 font-cond font-600 uppercase tracking-wide text-[13px]">
                        {s.label}
                      </span>
                      {s.id === 'inbox' && unread > 0 && (
                        <span
                          className={cn(
                            'grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-700',
                            active ? 'bg-black/25 text-white' : 'bg-[var(--team)] text-[var(--team-ink)]',
                          )}
                        >
                          {unread}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="border-t border-line p-3">
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
            className="mt-2 w-full rounded-md border border-line bg-surface px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-muted transition hover:text-loss"
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
              className="rounded-md border border-line bg-surface px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-muted transition hover:text-ink-2"
            >
              Export Save
            </button>
            <label className="cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-center font-cond text-[10px] font-700 uppercase tracking-wide text-muted transition hover:text-ink-2">
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

  return (
    <header
      className="relative flex h-[68px] shrink-0 items-center gap-4 border-b border-line px-4"
      style={{ background: `linear-gradient(100deg, ${team.primary} 0%, ${team.secondary} 78%)` }}
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
        <ScorePill label="Record" value={recordStr(rec)} />
        <ScorePill label="Team OVR" value={String(Math.round(avg))} />
        {team.tier === 'NFL' && (
          <ScorePill label="Cap Space" value={money(space)} tone={space < 5 ? 'loss' : space > 25 ? 'win' : undefined} />
        )}
        {accessArea && <AccessBadge area={accessArea} />}
      </div>

      <div className="flex-1" />

      {stage ? (
        <div className="hidden items-center gap-3 rounded-lg border border-white/25 bg-black/20 px-3 py-1.5 text-white md:flex">
          <div className="text-right leading-tight">
            <div className="label !text-white/60">Offseason</div>
            <div className="font-display text-base font-700 uppercase">{STAGE_LABEL[stage]}</div>
          </div>
          <CalendarDays size={18} className="text-white/80" />
        </div>
      ) : (
        opp && (
          <button
            onClick={() => setScreen('schedule')}
            className="hidden items-center gap-3 rounded-lg border border-white/25 bg-black/20 px-3 py-1.5 text-white transition hover:bg-black/30 md:flex"
          >
            <div className="text-right leading-tight">
              <div className="label !text-white/60">Week {next!.week} · {next!.home ? 'vs' : '@'}</div>
              <div className="font-display text-base font-700 uppercase">{opp.name}</div>
            </div>
            <TeamCrest team={opp} size={30} />
          </button>
        )
      )}

      {career && (
        <div className="hidden text-right leading-tight xl:block">
          <div className="label !text-white/60">Job Security</div>
          <div className="font-display text-lg font-700 tnum text-white">{career.jobSecurity}%</div>
        </div>
      )}

      <button
        onClick={() => setLeaguePbp(!leaguePbp)}
        title="Simulate every league game play-by-play (slower, more authentic stats)"
        className={cn(
          'hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 font-cond text-[11px] font-700 uppercase tracking-wide transition md:flex',
          leaguePbp
            ? 'border-transparent bg-[#8ef0b5] text-ink'
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
          Coach the game
        </Button>
      )}

      <Button
        variant="primary"
        className="!bg-white !text-ink hover:!bg-white/90"
        onClick={() => (stage ? advanceStage() : void advanceWeek())}
      >
        {stage
          ? STAGE_ADVANCE[stage]
          : league.week >= 18
            ? 'Finish Season ▸'
            : 'Advance Week ▸'}
      </Button>
    </header>
  )
}

function ScorePill({ label, value, tone }: { label: string; value: ReactNode; tone?: 'win' | 'loss' }) {
  return (
    <div className="rounded-lg border border-white/20 bg-black/15 px-3 py-1 leading-tight">
      <div className="label !text-white/60">{label}</div>
      <div className={cn('font-display text-base font-700 tnum', tone === 'win' ? 'text-[#8ef0b5]' : tone === 'loss' ? 'text-[#ffb3ba]' : 'text-white')}>
        {value}
      </div>
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
    '--team-soft': tint(team.primary, 0.92),
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
          <div className="rounded-full bg-ink px-5 py-2.5 text-sm font-600 text-white shadow-xl">{toast}</div>
        </div>
      )}
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
