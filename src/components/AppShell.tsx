// ─────────────────────────────────────────────────────────────────────────────
// App shell (UI redesign F3, spec §8 "Shell").
//   Desktop ≥768: a 64px top bar on surface with a 3px team rule —
//     brand block (team fill + skewed fill-2 stripe) | Record | Next game |
//     KPIs (Job vs the owner's firing line, Cap in dollars, Team OVR tier) |
//     search + ONE split slab CTA whose caret holds "Sim week instead" and
//     the sim mode. Sidebar 232px (rail 68px at 768-1023px, or collapsed).
//     Below 1280px the KPIs move to the ticker row under the bar.
//   Phone <768: a 56px score strip (team slab, next game, two-segment CTA so
//     Advance is always one tap away), a KPI ticker, bottom group tabs that
//     open group sheets; h-dvh with safe-area insets and 16px gutters.
// Team tokens are written on <html> so portals / modals / MatchView inherit.
// ─────────────────────────────────────────────────────────────────────────────
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Globe,
  Rows3,
  Search,
  Settings,
  SkipForward,
  Upload,
  Users,
  Whistle,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { rootTeamVars, TEAM_VAR_NAMES } from '../lib/teamColor'
import { useGame, useWorld, type ScreenId } from '../store/gameStore'
import { tierFor } from '../game/engine/career'
import { capSpace, recordOf, recordStr, rosterOf, scheduleFor, teamAvgOvr } from '../game/selectors'
import type { Team } from '../game/types'
import { CommandPalette } from './CommandPalette'
import {
  Avatar,
  Badge,
  Button,
  ConfirmSheet,
  DensityToggle,
  IconButton,
  RatingTile,
  SegmentedControl,
  Sheet,
  TeamCrest,
  ThemeToggle,
  TweenNumber,
  VerdictChip,
} from '../ui/kit'
import { useResolvedTheme } from '../ui/hooks'
import {
  ADVANCE_KEYS,
  advanceLabel,
  canCoach as canCoachNow,
  capMeterPct,
  capVerdict,
  downloadSave,
  getSidebarCollapsed,
  jobVerdict,
  NAV_GROUPS,
  navGroupOf,
  openCommandPalette,
  openSettings,
  ovrVerdict,
  PALETTE_KEYS,
  SCREEN_ICONS,
  screensInGroup,
  setSidebarCollapsed,
  STAGE_CALENDAR,
  stageOf,
  subscribeSidebar,
  TONE_COLOR,
  TONE_TEXT,
  visibleScreens,
  type NavGroup,
  type Verdict,
} from '../ui/nav'

const GROUP_ICONS: Record<NavGroup, LucideIcon> = {
  Career: Briefcase,
  Team: Users,
  Personnel: Rows3,
  Club: Whistle,
  League: Globe,
}

const UNSKEW = '[transform:skewX(calc(var(--skew)*-1))]'
const SLAB_DIVIDER = 'border-l border-[color-mix(in_srgb,var(--color-on-slab)_30%,transparent)]'

// ── Shared shell state ───────────────────────────────────────────────────────

function useShellModel() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)
  const gameDay = useGame((s) => s.gameDay)
  const team = league.byId[activeTeamId]
  const rec = recordOf(league, activeTeamId)
  const space = capSpace(league, activeTeamId)
  const avg = Math.round(teamAvgOvr(rosterOf(league, activeTeamId)))
  const next = useMemo(() => {
    if (!career || team.tier !== 'NFL') return null
    const { out } = scheduleFor(league, activeTeamId)
    return out.find((g) => g.week >= career.week) ?? out[out.length - 1] ?? null
  }, [league, activeTeamId, career, team.tier])
  const stage = stageOf(league)
  const opp = next && !stage ? league.byId[next.opponentId] : null
  return {
    league,
    career,
    team,
    rec,
    space,
    showCap: team.tier === 'NFL',
    avg,
    next,
    opp,
    stage,
    coach: canCoachNow(league, career, !!gameDay),
    week: Math.min(league.week, 18),
    job: career ? jobVerdict(career) : null,
    cap: capVerdict(space),
    advance: advanceLabel(league),
  }
}
type ShellModel = ReturnType<typeof useShellModel>

/** "5–2" / "5–2–1" with en dashes. */
function recordText(r: Parameters<typeof recordStr>[0]) {
  return recordStr(r).replace(/-/g, '–')
}

function useSimActions() {
  const advanceWeek = useGame((s) => s.advanceWeek)
  const advanceStage = useGame((s) => s.advanceStage)
  const startGameDay = useGame((s) => s.startGameDay)
  const stage = stageOf(useWorld())
  const advance = useCallback(() => (stage ? advanceStage() : void advanceWeek()), [stage, advanceStage, advanceWeek])
  return { advance, coach: startGameDay }
}

// ── Desktop top bar ──────────────────────────────────────────────────────────

function BrandBlock({ team }: { team: Team }) {
  return (
    <div className="relative flex shrink-0 lg:min-w-[232px]">
      <div
        className="relative flex flex-1 items-center gap-2.5 overflow-hidden pl-4 pr-10 lg:pl-[18px]"
        style={{ background: 'var(--team-fill)', color: 'var(--team-on)', boxShadow: 'var(--team-slab-ring)' }}
      >
        <TeamCrest team={team} size={38} />
        <div className="relative z-[1] leading-none">
          <div className="whitespace-nowrap font-display text-[21px] font-800 uppercase italic leading-none tracking-[0.01em]">
            {team.name}
          </div>
          <div className="mt-1 whitespace-nowrap font-cond text-label font-600 uppercase tracking-[0.07em] opacity-[0.82]">
            {team.tier === 'NFL' ? `${team.conference} ${team.division}` : team.conference}
          </div>
        </div>
        <span
          aria-hidden
          className="absolute -right-[22px] bottom-0 top-0 w-11 [transform:skewX(var(--skew))]"
          style={{ background: 'var(--team-fill-2)' }}
        />
      </div>
      {/* 3px team rule under the bar: fill, then a 16px fill-2 step */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-4 left-0 top-full z-[1] h-[3px]"
        style={{ background: 'linear-gradient(90deg, var(--team-fill) calc(100% - 16px), var(--team-fill-2) 0)' }}
      />
    </div>
  )
}

function Meter({ pct, color, tick, label }: { pct: number; color: string; tick?: number; label: string }) {
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative block h-1 w-[84px] rounded-[2px] bg-surface-3"
    >
      <i className="absolute inset-y-0 left-0 rounded-[2px]" style={{ width: `${Math.max(3, pct)}%`, background: color }} />
      {tick != null && (
        <b aria-hidden className="absolute -top-[3px] h-2.5 w-0.5 bg-ink-2" style={{ left: `calc(${tick}% - 1px)` }} />
      )}
    </span>
  )
}

function BarKpi({
  label,
  value,
  verdict,
  meter,
  onClick,
  title,
}: {
  label: string
  value: ReactNode
  verdict: ReactNode
  meter: ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="motion flex shrink-0 flex-col gap-1 rounded-[var(--r-sm)] px-1 py-0.5 text-left hover:bg-surface-2"
    >
      <span className="label whitespace-nowrap">{label}</span>
      <span className="flex h-6 items-center gap-1.5 whitespace-nowrap">
        <span className="font-display text-[22px] font-700 italic leading-none text-ink tnum">{value}</span>
        {verdict}
      </span>
      {meter}
    </button>
  )
}

function KpiZone({ m }: { m: ShellModel }) {
  const setScreen = useGame((s) => s.setScreen)
  const ovr = ovrVerdict(m.avg)
  return (
    <div className="hidden min-w-0 flex-1 items-center justify-end gap-3 px-3 xl:flex 2xl:gap-[22px] 2xl:px-4">
      {m.career && m.job && (
        <BarKpi
          label="Job security"
          title={`Job security ${m.career.jobSecurity}% · this owner makes a change at ${m.job.line}%`}
          onClick={() => setScreen('career')}
          value={
            <>
              <TweenNumber value={m.career.jobSecurity} />%
            </>
          }
          verdict={<VerdictChip tone={m.job.tone}>{m.job.label}</VerdictChip>}
          meter={
            <Meter
              pct={m.career.jobSecurity}
              color={TONE_COLOR[m.job.tone]}
              tick={m.job.line}
              label={`Job security ${m.career.jobSecurity}%, firing line ${m.job.line}%`}
            />
          }
        />
      )}
      {m.showCap && (
        <BarKpi
          label="Cap space"
          title={`Cap space ${money(m.space)} · under $5M is tight`}
          onClick={() => setScreen('cap')}
          value={<TweenNumber value={m.space} format={(n) => money(n)} />}
          verdict={<VerdictChip tone={m.cap.tone}>{m.cap.label}</VerdictChip>}
          meter={<Meter pct={capMeterPct(m.space)} color={TONE_COLOR[m.cap.tone]} label="Cap space, full bar at $30M" />}
        />
      )}
      <BarKpi
        label="Team OVR"
        title={`Team OVR ${m.avg} (top 22 players) · ${ovr.label}`}
        onClick={() => setScreen('roster')}
        value={<RatingTile value={m.avg} size={24} label="Team OVR" />}
        verdict={
          <span className="whitespace-nowrap font-cond text-label font-700 uppercase tracking-[0.05em] text-ink-2">{ovr.label}</span>
        }
        meter={<Meter pct={m.avg} color={ovr.color} label={`Team OVR ${m.avg}`} />}
      />
    </div>
  )
}

/** The split slab CTA: main action | caret menu (Sim week instead, sim mode). */
function SplitCta({ m }: { m: ShellModel }) {
  const { advance, coach } = useSimActions()
  const leaguePbp = useGame((s) => s.leaguePbp)
  const setLeaguePbp = useGame((s) => s.setLeaguePbp)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) caretRef.current?.focus()
  }
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      els[(i + 1) % els.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      els[(i - 1 + els.length) % els.length]?.focus()
    }
  }

  const item =
    'motion flex w-full items-start gap-2.5 rounded-[var(--r-md)] px-2.5 py-[9px] text-left text-body text-ink outline-none hover:bg-surface-3 focus-visible:bg-surface-3 pointer-coarse:min-h-11'

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <div className="flex h-[42px] items-stretch overflow-hidden rounded-[3px] bg-slab text-on-slab shadow-[0_6px_18px_-8px_rgba(0,0,0,0.6)] [transform:skewX(var(--skew))]">
        <button
          type="button"
          onClick={() => (m.coach ? coach() : advance())}
          title={m.coach ? "Coach this week's game moment by moment" : `${m.advance} (${ADVANCE_KEYS})`}
          className="motion flex items-center whitespace-nowrap pl-5 pr-4 font-display text-[17px] font-800 uppercase italic tracking-[0.02em] hover:opacity-90"
        >
          <span className={cn('flex items-center gap-2', UNSKEW)}>
            {m.coach ? 'Coach the game' : m.advance}
            <ChevronRight size={16} strokeWidth={2.6} aria-hidden />
            {!m.coach && (
              <kbd className="hidden rounded-[3px] border border-current px-1 py-0.5 font-cond text-micro font-600 not-italic opacity-60 min-[1600px]:inline">
                {ADVANCE_KEYS}
              </kbd>
            )}
          </span>
        </button>
        <button
          ref={caretRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More week actions: sim week, sim mode"
          title="More week actions"
          onClick={() => setOpen((o) => !o)}
          className={cn('motion grid w-[38px] place-items-center hover:opacity-80', SLAB_DIVIDER)}
        >
          <ChevronDown size={16} className={UNSKEW} aria-hidden />
        </button>
      </div>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Week actions"
          onKeyDown={onMenuKey}
          className="kit-wipe absolute right-0 top-[calc(100%+8px)] z-[60] w-[272px] rounded-[var(--r-lg)] border border-line-strong bg-surface-2 p-1.5 text-ink shadow-[var(--shadow-2)]"
        >
          {m.coach ? (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                close(false)
                advance()
              }}
            >
              <SkipForward size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0">
                <span className="block font-500">Sim week instead</span>
                <span className="mt-0.5 block text-label text-muted">Your game is simulated with the league · {ADVANCE_KEYS}</span>
              </span>
            </button>
          ) : (
            <div className="px-2.5 py-2 text-label text-muted">
              {ADVANCE_KEYS} · {m.advance.toLowerCase()} from any screen
            </div>
          )}
          <hr className="mx-1.5 my-1 border-0 border-t border-line" />
          <div className="label px-2.5 pb-1 pt-1.5">Sim mode</div>
          {(
            [
              { on: false, title: 'Fast', sub: 'League games as box scores (quicker weeks)' },
              { on: true, title: 'Authentic', sub: 'Every league game play-by-play: slower, more authentic stats' },
            ] as const
          ).map((o) => (
            <button
              key={o.title}
              type="button"
              role="menuitemradio"
              aria-checked={leaguePbp === o.on}
              className={item}
              onClick={() => {
                setLeaguePbp(o.on)
                close()
              }}
            >
              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center text-ink">
                {leaguePbp === o.on && <Check size={15} strokeWidth={2.6} aria-hidden />}
              </span>
              <span className="min-w-0">
                <span className="block font-500">Sim mode: {o.title}</span>
                <span className="mt-0.5 block text-label text-muted">{o.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TopBar() {
  const m = useShellModel()
  const setScreen = useGame((s) => s.setScreen)
  const { team, rec, stage, opp, next } = m

  return (
    <header className="relative z-30 hidden h-16 shrink-0 items-stretch border-b border-line bg-surface md:flex">
      <BrandBlock team={team} />

      <div className="flex shrink-0 items-center border-r border-line pl-6 pr-4 lg:pl-9">
        <button
          type="button"
          onClick={() => setScreen('standings')}
          title="Record · open the standings"
          className="motion flex flex-col gap-1 rounded-[var(--r-sm)] px-1 py-1 text-left hover:bg-surface-2"
        >
          <span className="label leading-none">Record</span>
          <span className="whitespace-nowrap font-display text-[26px] font-800 italic leading-none text-ink tnum">
            {recordText(rec)}
          </span>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-r border-line px-4">
        <div className="flex flex-col gap-[5px]">
          <span className="label whitespace-nowrap leading-none">{stage ? 'Offseason' : 'Next game'}</span>
          <span className="whitespace-nowrap font-display text-[18px] font-700 uppercase italic leading-none text-ink tnum">
            {stage ? (
              STAGE_CALENDAR[stage]
            ) : (
              <>
                Week {m.week} <em className="font-600 text-muted">of 18</em>
              </>
            )}
          </span>
          {!stage && (
            <span className="hidden h-1 w-24 overflow-hidden rounded-[2px] bg-surface-3 lg:block">
              <i className="block h-full bg-[var(--team-accent)]" style={{ width: `${(m.week / 18) * 100}%` }} />
            </span>
          )}
        </div>
        {opp && next && (
          <button
            type="button"
            onClick={() => setScreen('gameplan')}
            title={`Week ${next.week} ${next.home ? 'vs' : '@'} ${opp.city} ${opp.name} · open the game plan`}
            className="motion flex items-center gap-2 whitespace-nowrap rounded-[var(--r-md)] px-1.5 py-1 hover:bg-surface-2"
          >
            <small className="font-cond text-small font-600 text-muted">{next.home ? 'vs' : '@'}</small>
            <TeamCrest team={opp} size={26} />
            <span className="hidden font-display text-[20px] font-800 uppercase italic leading-none text-ink lg:inline">
              {opp.name}
            </span>
          </button>
        )}
      </div>

      <KpiZone m={m} />
      <div className="flex-1 xl:hidden" />

      <div className="flex shrink-0 items-center gap-2.5 pl-2 pr-4">
        <IconButton label={`Search screens, players, clubs and actions (${PALETTE_KEYS})`} onClick={openCommandPalette}>
          <Search size={18} />
        </IconButton>
        <SplitCta m={m} />
      </div>
    </header>
  )
}

// ── KPI ticker (phone + 768-1279px) ──────────────────────────────────────────

function TickerItem({
  label,
  children,
  onClick,
  pressed,
  title,
}: {
  label: string
  children: ReactNode
  onClick: () => void
  pressed?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      title={title}
      className="motion flex shrink-0 items-center gap-1.5 whitespace-nowrap border-r border-line px-3 font-cond text-label font-600 uppercase tracking-[0.06em] text-muted hover:bg-surface-3"
    >
      {label}
      <b className="font-display text-[17px] font-700 italic normal-case tracking-normal text-ink tnum">{children}</b>
    </button>
  )
}

function VerdictWord({ v }: { v: Verdict }) {
  return <span className={cn('font-cond text-label font-700 uppercase tracking-[0.06em]', TONE_TEXT[v.tone])}>{v.label}</span>
}

function KpiTicker({ m }: { m: ShellModel }) {
  const setScreen = useGame((s) => s.setScreen)
  const leaguePbp = useGame((s) => s.leaguePbp)
  const setLeaguePbp = useGame((s) => s.setLeaguePbp)
  return (
    <div
      role="region"
      aria-label="Club status"
      className="flex h-11 shrink-0 overflow-x-auto overscroll-x-contain border-b border-line bg-surface-2 [scrollbar-width:none] xl:hidden"
    >
      <TickerItem label="Rec" onClick={() => setScreen('standings')} title="Record · standings">
        {recordText(m.rec)}
      </TickerItem>
      {m.career && m.job && (
        <TickerItem label="Job" onClick={() => setScreen('career')} title={`Job security · firing line ${m.job.line}%`}>
          {m.career.jobSecurity}% <VerdictWord v={m.job} />
        </TickerItem>
      )}
      {m.showCap && (
        <TickerItem label="Cap" onClick={() => setScreen('cap')} title="Cap space">
          {money(m.space)} <VerdictWord v={m.cap} />
        </TickerItem>
      )}
      <TickerItem label="OVR" onClick={() => setScreen('roster')} title={`Team OVR · ${ovrVerdict(m.avg).label}`}>
        {m.avg}
      </TickerItem>
      <TickerItem label={m.stage ? 'Off' : 'Wk'} onClick={() => setScreen('schedule')} title="Schedule">
        {m.stage ? STAGE_CALENDAR[m.stage] : `${m.week}/18`}
      </TickerItem>
      {m.opp && m.next && (
        <TickerItem label="Next" onClick={() => setScreen('gameplan')} title="Game plan">
          {m.next.home ? 'vs' : '@'} {m.opp.abbr || m.opp.name}
        </TickerItem>
      )}
      <TickerItem
        label="Sim"
        pressed={leaguePbp}
        onClick={() => setLeaguePbp(!leaguePbp)}
        title={leaguePbp ? 'Sim mode: Authentic (tap for Fast)' : 'Sim mode: Fast (tap for Authentic)'}
      >
        {leaguePbp ? 'Authentic' : 'Fast'}
      </TickerItem>
    </div>
  )
}

// ── Phone score strip ────────────────────────────────────────────────────────

function PhoneStrip({ m }: { m: ShellModel }) {
  const setScreen = useGame((s) => s.setScreen)
  const { advance, coach } = useSimActions()
  const seg = 'motion flex h-11 items-center px-3 font-display text-[15px] font-800 uppercase italic leading-none hover:opacity-90'
  const shortAdvance = m.stage ? m.advance : m.advance === 'Advance week' ? 'Advance' : 'Finish'
  return (
    <div className="relative z-30 flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface pr-3 md:hidden">
      <button
        type="button"
        onClick={() => setScreen('standings')}
        aria-label={`${m.team.name} record ${recordText(m.rec)}, open the standings`}
        className="flex shrink-0 items-center gap-2 self-stretch pl-3 pr-6 [clip-path:polygon(0_0,100%_0,calc(100%-12px)_100%,0_100%)]"
        style={{
          background: 'var(--team-fill)',
          color: 'var(--team-on)',
          boxShadow: 'inset -14px 0 0 -6px var(--team-fill-2), var(--team-slab-ring)',
        }}
      >
        <TeamCrest team={m.team} size={30} />
        <b className="whitespace-nowrap font-display text-[18px] font-800 italic leading-none tnum">{recordText(m.rec)}</b>
      </button>
      <button
        type="button"
        onClick={() => setScreen(m.stage ? 'schedule' : 'gameplan')}
        className="min-w-0 text-left leading-[1.05]"
      >
        <span className="block whitespace-nowrap font-cond text-label font-600 uppercase tracking-[0.06em] text-muted tnum">
          {m.stage ? 'Offseason' : `Wk ${m.week} / 18`}
        </span>
        <b className="block truncate font-display text-[16px] font-800 uppercase italic text-ink">
          {m.stage
            ? STAGE_CALENDAR[m.stage].split(' · ')[1]
            : m.opp && m.next
              ? `${m.next.home ? 'vs' : '@'} ${m.opp.abbr || m.opp.name}`
              : 'Schedule'}
        </b>
      </button>
      <div className="ml-auto flex shrink-0 items-stretch overflow-hidden rounded-[3px] bg-slab text-on-slab [transform:skewX(var(--skew))]">
        {m.coach ? (
          <>
            <button type="button" onClick={() => coach()} className={seg} title="Coach this week's game">
              <span className={cn('flex items-center gap-1', UNSKEW)}>
                Coach <ChevronRight size={14} strokeWidth={2.6} aria-hidden />
              </span>
            </button>
            <button
              type="button"
              onClick={() => advance()}
              aria-label="Sim week instead"
              title="Sim week instead"
              className={cn(seg, SLAB_DIVIDER, 'px-2.5')}
            >
              <span className={cn('flex items-center gap-1', UNSKEW)}>
                <SkipForward size={14} aria-hidden /> Sim
              </span>
            </button>
          </>
        ) : (
          <button type="button" onClick={() => advance()} className={seg} title={m.advance}>
            <span className={cn('flex items-center gap-1 whitespace-nowrap', UNSKEW)}>
              {shortAdvance}
              <ChevronRight size={14} strokeWidth={2.6} aria-hidden />
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

// ── Navigation ───────────────────────────────────────────────────────────────

function useUnread() {
  const readNews = useGame((s) => s.readNews)
  const news = useWorld().news
  return news.filter((n) => !readNews[n.id]).length
}

export function Sidebar() {
  const screen = useGame((s) => s.screen)
  const setScreen = useGame((s) => s.setScreen)
  const career = useGame((s) => s.career)
  const league = useWorld()
  const unread = useUnread()
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarCollapsed, () => false)
  const visible = visibleScreens(career)
  const navRef = useRef<HTMLElement | null>(null)
  const stage = stageOf(league)

  // Keep the active item in view (long nav on short windows).
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[data-nav-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [screen])

  // Labels show at ≥1024px unless collapsed; 768-1023px is always the rail.
  const lbl = collapsed ? 'hidden' : 'hidden lg:inline'
  const full = collapsed ? 'hidden' : 'hidden lg:block'
  const railOnly = collapsed ? 'block' : 'block lg:hidden'
  const inbox = visible.find((s) => s.id === 'inbox')

  const item = (id: ScreenId, label: string) => {
    const Icon = SCREEN_ICONS[id]
    const active = screen === id
    return (
      <button
        key={id}
        type="button"
        data-nav-id={id}
        data-nav-active={active}
        aria-current={active ? 'page' : undefined}
        onClick={() => setScreen(id)}
        title={label}
        className={cn(
          'motion relative flex h-9 w-full items-center gap-2.5 rounded-[var(--r-md)] px-2.5 text-left font-cond text-[15px] font-600 leading-none tracking-[0.02em]',
          collapsed ? 'justify-center' : 'justify-center lg:justify-start',
          active ? 'bg-[var(--team-tint)] text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        )}
      >
        {active && <span aria-hidden className="absolute -left-2.5 bottom-1.5 top-1.5 w-1 rounded-r-[3px] bg-[var(--team-accent)]" />}
        <Icon size={18} strokeWidth={2} className={cn('shrink-0', active ? 'text-[var(--team-accent-text)]' : 'text-muted')} />
        <span className={cn('flex-1 whitespace-nowrap', lbl)}>{label}</span>
        {id === 'inbox' && unread > 0 && (
          <>
            <span
              className={cn(
                'ml-auto h-5 min-w-5 rounded-[10px] bg-brand px-1.5 text-center font-cond text-label font-700 leading-5 text-on-accent tnum',
                lbl,
              )}
              aria-label={`${unread} unread`}
            >
              {unread}
            </span>
            <span
              aria-hidden
              className={cn('absolute right-2 top-1.5 h-2 w-2 rounded-full bg-brand shadow-[0_0_0_2px_var(--color-surface)]', railOnly)}
            />
          </>
        )}
      </button>
    )
  }

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        'relative z-20 hidden shrink-0 flex-col border-r border-line bg-surface md:flex md:w-[68px]',
        collapsed ? 'lg:w-[68px]' : 'lg:w-[232px]',
      )}
    >
      <div className={cn('px-[18px] pb-3.5 pt-[18px]', full)}>
        <div className="whitespace-nowrap font-display text-[20px] font-800 uppercase italic leading-none tracking-[0.03em] text-ink">
          Gridiron <span className="text-[var(--team-accent-text)]">Dynasty</span>
        </div>
        <div className="mt-1.5 whitespace-nowrap font-cond text-label font-600 uppercase tracking-[0.07em] text-muted">
          Season {league.season} · {stage ? STAGE_CALENDAR[stage] : `Week ${Math.min(league.week, 18)}`}
        </div>
      </div>
      <div aria-hidden className={cn('pb-2 pt-4 text-center font-display text-[18px] font-800 uppercase italic leading-none text-ink', railOnly)}>
        G<span className="text-[var(--team-accent-text)]">D</span>
      </div>

      <nav ref={navRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {inbox && item('inbox', inbox.label)}
        {NAV_GROUPS.map((g) => {
          const items = screensInGroup(visible, g).filter((s) => s.id !== 'inbox')
          if (!items.length) return null
          return (
            <div key={g} className="mt-3.5" role="group" aria-label={g}>
              <span className={cn('px-2.5 pb-1.5 font-cond text-label font-600 uppercase tracking-[0.07em] text-faint', full)}>{g}</span>
              <span aria-hidden className={cn('mx-2 mb-2 h-px bg-line', railOnly)} />
              <div className="space-y-0.5">{items.map((s) => item(s.id, s.label))}</div>
            </div>
          )
        })}
      </nav>

      <div
        className={cn(
          'flex h-[58px] shrink-0 items-center gap-2.5 border-t border-line px-3.5',
          collapsed ? 'justify-center' : 'justify-center lg:justify-start',
        )}
      >
        <span className={full}>
          <Avatar name={career?.gmName ?? 'You'} size={34} />
        </span>
        <div className={cn('min-w-0 flex-1 leading-tight', full)}>
          <b className="block truncate font-cond text-[14px] font-700 text-ink">{career ? tierFor(career.path, career.level).title : '—'}</b>
          <span className="block truncate text-label text-muted">
            {career?.path === 'coach' ? 'Coaching' : 'Personnel'} · {career?.season ?? league.season}
          </span>
        </div>
        <IconButton label="Settings: theme, density, sim mode, save, new career" size="sm" onClick={openSettings}>
          <Settings size={17} />
        </IconButton>
      </div>
    </aside>
  )
}

/** Remember the last screen opened in each group (phone tab → that screen). */
const LAST_KEY = 'gd.navLast'
function readLast(): Partial<Record<NavGroup, ScreenId>> {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function PhoneTabBar() {
  const screen = useGame((s) => s.screen)
  const setScreen = useGame((s) => s.setScreen)
  const career = useGame((s) => s.career)
  const unread = useUnread()
  const visible = visibleScreens(career)
  const [sheet, setSheet] = useState<NavGroup | null>(null)
  const lastRef = useRef<Partial<Record<NavGroup, ScreenId>>>(readLast())
  const current = navGroupOf(screen)

  useEffect(() => {
    const g = navGroupOf(screen)
    if (!g || screen === 'team') return
    lastRef.current = { ...lastRef.current, [g]: screen }
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(lastRef.current))
    } catch {
      /* ignore */
    }
  }, [screen])

  const groups = NAV_GROUPS.filter((g) => screensInGroup(visible, g).length > 0)
  const onTab = (g: NavGroup) => {
    const items = screensInGroup(visible, g)
    const last = lastRef.current[g]
    // Tap → that group's last screen; tap again (or the first time) → the group sheet.
    if (current !== g && last && items.some((s) => s.id === last)) setScreen(last)
    else setSheet(g)
  }

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="relative z-40 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}>
          {groups.map((g) => {
            const Icon = GROUP_ICONS[g]
            const active = current === g
            return (
              <button
                key={g}
                type="button"
                onClick={() => onTab(g)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'motion relative flex flex-col items-center justify-center gap-1 font-cond text-label font-700 uppercase tracking-[0.05em]',
                  active ? 'text-ink' : 'text-muted',
                )}
              >
                {active && <span aria-hidden className="absolute inset-x-3 top-0 h-[3px] rounded-b-[2px] bg-[var(--team-accent)]" />}
                <span className="relative">
                  <Icon size={22} strokeWidth={2} className={active ? 'text-[var(--team-accent-text)]' : undefined} />
                  {g === 'Career' && unread > 0 && (
                    <span
                      role="img"
                      aria-label={`${unread} unread in the inbox`}
                      className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-brand shadow-[0_0_0_2px_var(--color-surface)]"
                    />
                  )}
                </span>
                {g}
              </button>
            )
          })}
        </div>
      </nav>
      <Sheet open={sheet !== null} onClose={() => setSheet(null)} eyebrow="Go to" title={sheet ?? ''}>
        <div className="grid gap-1">
          {sheet &&
            screensInGroup(visible, sheet).map((s) => {
              const Icon = SCREEN_ICONS[s.id]
              const active = screen === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setSheet(null)
                    setScreen(s.id)
                  }}
                  className={cn(
                    'motion relative flex min-h-12 items-center gap-3 rounded-[var(--r-md)] px-3 text-left font-cond text-[16px] font-600 tracking-[0.02em]',
                    active ? 'bg-[var(--team-tint)] text-ink' : 'text-ink-2 hover:bg-surface-2',
                  )}
                >
                  {active && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-1 rounded-r-[3px] bg-[var(--team-accent)]" />}
                  <Icon size={20} className={active ? 'text-[var(--team-accent-text)]' : 'text-muted'} />
                  <span className="flex-1">{s.label}</span>
                  {s.id === 'inbox' && unread > 0 && (
                    <span className="h-5 min-w-5 rounded-[10px] bg-brand px-1.5 text-center font-cond text-label font-700 leading-5 text-on-accent tnum">
                      {unread}
                    </span>
                  )}
                  <ChevronRight size={16} className="text-faint" aria-hidden />
                </button>
              )
            })}
        </div>
      </Sheet>
    </>
  )
}

// ── Settings sheet (gear, palette) + New career confirm ───────────────────────

function SettingsHost() {
  const career = useGame((s) => s.career)
  const resetCareer = useGame((s) => s.resetCareer)
  const exportSaveText = useGame((s) => s.exportSaveText)
  const importSaveText = useGame((s) => s.importSaveText)
  const leaguePbp = useGame((s) => s.leaguePbp)
  const setLeaguePbp = useGame((s) => s.setLeaguePbp)
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarCollapsed, () => false)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const doExport = useCallback(async () => {
    const text = await exportSaveText()
    if (text) downloadSave(text, career?.season)
  }, [exportSaveText, career?.season])

  useEffect(() => {
    const onSettings = () => setOpen(true)
    const onNew = () => setConfirm(true)
    // Synchronous inside the palette's click/Enter, so the file picker may open.
    const onImport = () => fileRef.current?.click()
    const onExport = () => void doExport()
    window.addEventListener('gd:settings', onSettings)
    window.addEventListener('gd:new-career', onNew)
    window.addEventListener('gd:import-save', onImport)
    window.addEventListener('gd:export-save', onExport)
    return () => {
      window.removeEventListener('gd:settings', onSettings)
      window.removeEventListener('gd:new-career', onNew)
      window.removeEventListener('gd:import-save', onImport)
      window.removeEventListener('gd:export-save', onExport)
    }
  }, [doExport])

  const row = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3 first:border-t-0'
  const title = career ? tierFor(career.path, career.level).title : 'Career'

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          const text = await f.text()
          await importSaveText(text)
          e.target.value = ''
          setOpen(false)
        }}
      />
      <Sheet open={open} onClose={() => setOpen(false)} eyebrow="Gridiron Dynasty" title="Settings">
        <div className={row}>
          <span className="label">Theme</span>
          <div className="w-[260px] max-w-full">
            <ThemeToggle />
          </div>
        </div>
        <div className={row}>
          <span className="label">Table density</span>
          <DensityToggle />
        </div>
        <div className={row}>
          <div>
            <span className="label block">Sim mode</span>
            <span className="text-small text-muted">Authentic sims every league game play-by-play</span>
          </div>
          <SegmentedControl
            label="Sim mode"
            size="sm"
            value={leaguePbp ? 'auth' : 'fast'}
            onChange={(v) => setLeaguePbp(v === 'auth')}
            options={[
              { id: 'fast', label: 'Fast' },
              { id: 'auth', label: 'Authentic' },
            ]}
          />
        </div>
        <div className={cn(row, 'hidden lg:flex')}>
          <span className="label">Sidebar</span>
          <SegmentedControl
            label="Sidebar"
            size="sm"
            value={collapsed ? 'rail' : 'full'}
            onChange={(v) => setSidebarCollapsed(v === 'rail')}
            options={[
              { id: 'full', label: 'Expanded' },
              { id: 'rail', label: 'Collapsed' },
            ]}
          />
        </div>
        <div className={row}>
          <div>
            <span className="label block">Save file</span>
            <span className="text-small text-muted">Season {career?.season ?? '—'} · stored in this browser</span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={() => void doExport()}>
              Export
            </Button>
            <Button variant="secondary" size="sm" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
              Import
            </Button>
          </div>
        </div>
        <div className={row}>
          <div>
            <span className="label block">New career</span>
            <span className="text-small text-muted">Erases this save, after a review step</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setConfirm(true)
            }}
            className="motion inline-flex min-h-8 items-center rounded-[var(--r-md)] border border-line-strong bg-surface px-2.5 font-cond text-small font-700 uppercase tracking-[0.06em] text-loss hover:bg-loss-soft pointer-coarse:min-h-11"
          >
            New career…
          </button>
        </div>
        <p className="pt-2 text-label text-muted">
          {PALETTE_KEYS} search and actions · {ADVANCE_KEYS} advance
        </p>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          resetCareer()
        }}
        eyebrow="New career"
        title="Erase this career?"
        subtitle="Starting over replaces your current save. There is no undo."
        consequences={[
          { label: 'Current career', value: `${title} · Season ${career?.season ?? '—'}` },
          { label: 'Save file', value: 'Erased', tone: 'loss' },
        ]}
        saferAlternative={{ label: 'Export the save first', onClick: () => void doExport() }}
        confirmLabel="Erase and start over"
        ledgerNote={null}
      />
    </>
  )
}

// ── Keyboard: ⌘↵ / Ctrl↵ advances ────────────────────────────────────────────

function useAdvanceShortcut() {
  const career = useGame((s) => s.career)
  const modal = useGame((s) => s.modal)
  const gameDay = useGame((s) => s.gameDay)
  const match = useGame((s) => s.match)
  const selectedPlayerId = useGame((s) => s.selectedPlayerId)
  const { advance } = useSimActions()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      // Ignored while a modal / game day / replay / profile / kit overlay is open.
      if (modal !== 'none' || gameDay || match || selectedPlayerId || !career) return
      if (document.querySelector('[data-kit-modal]')) return
      e.preventDefault()
      advance()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, gameDay, match, selectedPlayerId, career, advance])
}

// ── Shell ────────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  const m = useShellModel()
  const toast = useGame((s) => s.toast)
  useAdvanceShortcut()

  // Contrast-checked team tokens live on <html> so portals, modals and
  // MatchView inherit them (--team / --team-soft alias --team-accent / --team-tint).
  const theme = useResolvedTheme()
  const { primary, secondary } = m.team
  useLayoutEffect(() => {
    const el = document.documentElement
    const vars = rootTeamVars(primary, secondary, theme)
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
    return () => {
      for (const k of TEAM_VAR_NAMES) el.style.removeProperty(k)
    }
  }, [primary, secondary, theme])

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-canvas pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
      <TopBar />
      <PhoneStrip m={m} />
      <KpiTicker m={m} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main id="main" className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-[1500px] p-4 md:p-6 xl:p-8">{children}</div>
        </main>
      </div>
      <PhoneTabBar />
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[80] flex justify-center md:bottom-6"
        >
          <div className="max-w-[560px] rounded-[var(--r-lg)] bg-ink px-5 py-2.5 text-body font-600 text-canvas shadow-[var(--shadow-2)]">
            {toast}
          </div>
        </div>
      )}
      <CommandPalette />
      <SettingsHost />
    </div>
  )
}

/** @deprecated kept for old imports; prefer ScoreBlock / RatingTile. */
export function RecordBadge({ wins, losses }: { wins: number; losses: number }) {
  const win = wins >= losses
  return (
    <Badge tone={win ? 'win' : 'loss'}>
      {wins}-{losses}
    </Badge>
  )
}
