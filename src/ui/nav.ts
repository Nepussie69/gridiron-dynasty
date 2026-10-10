// ─────────────────────────────────────────────────────────────────────────────
// Shared navigation model (UI redesign F3). One source for the sidebar, the
// phone tab bar + group sheets, the top bar and the ⌘K palette:
//   • which screens are visible (tier + access ladder),
//   • the nav groups (Inbox pinned first, carried by the Career tab on phone),
//   • a unique icon per screen,
//   • canCoach / stage labels / advance label,
//   • the top-bar verdicts (job security vs the owner's firing line, cap space
//     in dollars, team OVR tier).
// Plain .ts so the .tsx files keep exporting components only.
// ─────────────────────────────────────────────────────────────────────────────
import {
  ArrowLeftRight,
  Award,
  BookOpen,
  Binoculars,
  CalendarDays,
  ChartColumn,
  DollarSign,
  Globe,
  History,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  PenLine,
  Route,
  Rows3,
  Search,
  Shield,
  Table2,
  TrendingUp,
  UserRound,
  Users,
  Whistle,
  type LucideIcon,
} from 'lucide-react'
import { SCREENS, userCtx, type ScreenId, type ScreenMeta } from '../store/gameStore'
import { accessFor, type AccessArea } from '../game/engine/access'
import { stageOf, type OffseasonStage } from '../game/engine/draft'
import { ownerFiringLine } from '../game/engine/owner'
import type { World } from '../game/engine/generate'
import type { CareerState } from '../game/types'
import { capTone, jobTone, ratingTier, type Tone } from '../lib/format'

/** Which access area each screen belongs to (AccessBanner, nav hiding at 'locked'). */
export const AREA_BY_SCREEN: Partial<Record<ScreenId, AccessArea>> = {
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

export const NAV_GROUPS = ['Career', 'Team', 'Personnel', 'Club', 'League'] as const
export type NavGroup = (typeof NAV_GROUPS)[number]

/** A unique icon per screen (spec §8: binoculars Scouting, search Find a Player, play diagram Game Plan …). */
export const SCREEN_ICONS: Record<ScreenId, LucideIcon> = {
  inbox: Inbox,
  career: UserRound,
  dashboard: LayoutDashboard,
  ledger: BookOpen,
  scouting: Binoculars,
  history: History,
  roster: Users,
  depth: ListOrdered,
  development: TrendingUp,
  gameplan: Route,
  schedule: CalendarDays,
  draft: Rows3,
  freeagency: PenLine,
  trades: ArrowLeftRight,
  cap: DollarSign,
  staff: Whistle,
  players: Search,
  standings: Table2,
  stats: ChartColumn,
  awards: Award,
  league: Globe,
  team: Shield,
}

/** Nav group of a screen. Inbox lives with Career in navigation (its badge rides the Career tab). */
export function navGroupOf(id: ScreenId): NavGroup | null {
  if (id === 'inbox') return 'Career'
  if (id === 'team') return 'League'
  return SCREENS.find((s) => s.id === id)?.group ?? null
}

/** Screens shown at this career's tier; the ladder hides screens locked at this rung. */
export function visibleScreens(career: CareerState | null): ScreenMeta[] {
  const tier = career?.tier ?? 'NFL'
  return SCREENS.filter((s) => {
    if (!s.tiers.includes(tier)) return false
    const area = AREA_BY_SCREEN[s.id]
    if (area && career && accessFor(career, area) === 'locked') return false
    return true
  })
}

/** Visible screens of one nav group, in order (Inbox first in Career). */
export function screensInGroup(visible: ScreenMeta[], group: NavGroup): ScreenMeta[] {
  const items = visible.filter((s) => navGroupOf(s.id) === group)
  return items.sort((a, b) => (a.id === 'inbox' ? -1 : b.id === 'inbox' ? 1 : 0))
}

/** Is there a coachable game for the user this week? */
export function canCoach(world: World, career: CareerState | null, gameDayOpen: boolean): boolean {
  return (
    !!career &&
    !gameDayOpen &&
    world.phase === 'regular' &&
    !!userCtx(career) &&
    world.schedule.some(
      (g) => !g.played && g.week === world.week && (g.homeId === career.teamId || g.awayId === career.teamId),
    )
  )
}

/** Calendar label for an offseason stage (top bar). */
export const STAGE_CALENDAR: Record<OffseasonStage, string> = {
  resign: 'Feb · Re-sign',
  freeAgency: 'Mar · Free agency',
  draft: 'Apr · Draft',
  camp: 'Aug · Camp',
}
/** The advance action out of each stage. */
export const STAGE_ADVANCE: Record<OffseasonStage, string> = {
  resign: 'To free agency',
  freeAgency: 'To the draft',
  draft: 'To camp',
  camp: 'Start season',
}
/** Lower-case stage name (palette sub-lines). */
export const STAGE_NAME: Record<OffseasonStage, string> = {
  resign: 're-sign',
  freeAgency: 'free agency',
  draft: 'draft',
  camp: 'camp',
}

export { stageOf }

/** "Advance week" / "Finish season" / the offseason stage step. */
export function advanceLabel(world: World): string {
  const stage = stageOf(world)
  if (stage) return STAGE_ADVANCE[stage]
  return world.week >= 18 ? 'Finish season' : 'Advance week'
}

// ── Verdicts (top bar, phone ticker) ──────────────────────────────────────────

export interface Verdict {
  tone: Tone
  label: string
}

const JOB_WORD: Record<Tone, string> = { win: 'Secure', neutral: 'Stable', warn: 'Hot seat', loss: 'Firing line' }
const CAP_WORD: Record<Tone, string> = { win: 'Flush', neutral: 'Room', warn: 'Tight', loss: 'Over cap' }

/** Job security against this club owner's firing line (FUTURES 22). */
export function jobVerdict(career: CareerState): Verdict & { line: number } {
  const line = ownerFiringLine(career.teamId)
  const tone = jobTone(career.jobSecurity, line)
  return { tone, label: JOB_WORD[tone], line }
}

/** Cap space in DOLLARS: <0 over, <$5M tight, ≤$25M room, else flush. */
export function capVerdict(space: number): Verdict {
  const tone = capTone(space)
  return { tone, label: CAP_WORD[tone] }
}

/** Cap-space meter fill, 0-100 (full at $30M of room). */
export function capMeterPct(space: number): number {
  return Math.max(0, Math.min(100, (space / 30_000_000) * 100))
}

export function ovrVerdict(ovr: number): { label: string; color: string } {
  const t = ratingTier(ovr)
  return { label: `${t.label} tier`, color: t.outline ?? t.fill }
}

/** CSS colour var for a tone (meters, dots). */
export const TONE_COLOR: Record<Tone, string> = {
  win: 'var(--color-win)',
  neutral: 'var(--color-ink-2)',
  warn: 'var(--color-warn)',
  loss: 'var(--color-loss)',
}
export const TONE_TEXT: Record<Tone, string> = {
  win: 'text-win',
  neutral: 'text-ink',
  warn: 'text-warn',
  loss: 'text-loss',
}

// ── Platform + preferences (localStorage only) ───────────────────────────────

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
export const ADVANCE_KEYS = IS_MAC ? '⌘↵' : 'Ctrl↵'
export const PALETTE_KEYS = IS_MAC ? '⌘K' : 'Ctrl+K'

/** Open the ⌘K palette from anywhere. */
export function openCommandPalette() {
  window.dispatchEvent(new Event('gd:command-palette'))
}

export type ThemePref = 'system' | 'light' | 'dark'
export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem('gd.theme')
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}
/** Same storage + attribute as the kit ThemeToggle (index.html applies it before first paint). */
export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem('gd.theme', pref)
  } catch {
    /* ignore */
  }
  const el = document.documentElement
  if (pref === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', pref)
}

/** Sidebar collapse preference (≥1024px only; 768-1023px is always the rail). */
const SIDEBAR_KEY = 'gd.sidebar'
const sidebarListeners = new Set<() => void>()
let sidebarCollapsed = (() => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
})()
export function getSidebarCollapsed() {
  return sidebarCollapsed
}
export function subscribeSidebar(cb: () => void) {
  sidebarListeners.add(cb)
  return () => {
    sidebarListeners.delete(cb)
  }
}
export function setSidebarCollapsed(v: boolean) {
  sidebarCollapsed = v
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? 'collapsed' : 'expanded')
  } catch {
    /* ignore */
  }
  for (const l of sidebarListeners) l()
}

/** Download the save JSON (sidebar settings sheet + palette). */
export function downloadSave(text: string, season: number | undefined) {
  const blob = new Blob([text], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `gridiron-save-${season ?? 'career'}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 0)
}

/** Settings sheet open/close, shared so the palette can open it ("Import save", "New career"). */
export function openSettings() {
  window.dispatchEvent(new Event('gd:settings'))
}
