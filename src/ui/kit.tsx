import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '../lib/cn'
import { inkOn } from '../lib/format'
import type { Team } from '../game/types'
import { RatingBar } from './RatingTile'
import { SegmentedControl } from './Controls'

// UI redesign F2: the kit is split across src/ui/*.tsx and re-exported here so
// every `from '../ui/kit'` import keeps working. New primitives live in:
//   RatingTile.tsx  RatingTile, TierPips, TierLegend, OvrBadge, PotBubble,
//                   RangeBubble, RookieRangeBadges, RatingBar, DevBadge, TierNumber
//   Kpi.tsx         KpiStrip, KpiTile, VerdictChip, DivergingMeter, TierScale,
//                   BudgetMeter, Delta, Effect, Money, SchemeChip
//   Controls.tsx    Button, IconButton, Tabs, SegmentedControl, FilterChip,
//                   OptionGroup, OptionCard
//   Overlay.tsx     Dialog, Sheet, ConfirmSheet, OverflowMenu, Inspector, WithInspector
//   Access.tsx      GatedAction, AccessBanner
//   People.tsx      Avatar, VacantSeat
//   ScoreBlock.tsx  ScoreBlock, Scoreline
//   hooks.ts        useMediaQuery, usePhone, useResolvedTheme, useModal,
//                   useAccessLevel, gateMenuItem

// ── Theme preference (U3) ────────────────────────────────────────────────────
type ThemePref = 'system' | 'light' | 'dark'

function getStoredTheme(): ThemePref {
  try {
    const v = localStorage.getItem('gd.theme')
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

function applyTheme(pref: ThemePref) {
  try {
    localStorage.setItem('gd.theme', pref)
  } catch {
    /* ignore */
  }
  const el = document.documentElement
  if (pref === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', pref)
}

/** System / Light / Dark switch, shown in the sidebar footer. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [pref, setPref] = useState<ThemePref>(getStoredTheme)
  useEffect(() => {
    applyTheme(pref)
  }, [pref])
  const options: { id: ThemePref; label: string; Icon: typeof Sun }[] = [
    { id: 'system', label: 'System theme', Icon: Monitor },
    { id: 'light', label: 'Light theme', Icon: Sun },
    { id: 'dark', label: 'Dark theme', Icon: Moon },
  ]
  if (compact) {
    const idx = options.findIndex((o) => o.id === pref)
    const cur = options[idx]
    return (
      <button
        type="button"
        title={`Theme: ${cur.label} (click to change)`}
        aria-label={`Theme: ${cur.label} (click to change)`}
        onClick={() => setPref(options[(idx + 1) % options.length].id)}
        className="motion grid h-8 w-full place-items-center rounded-md border border-line bg-surface text-muted hover:text-ink"
      >
        <cur.Icon size={15} />
      </button>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface p-0.5">
      {options.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={pref === id}
          onClick={() => setPref(id)}
          className={cn(
            'motion flex items-center justify-center gap-1 rounded-md px-1 py-1 font-cond text-label font-700 uppercase tracking-wide',
            pref === id ? 'bg-surface-2 text-ink shadow-sm' : 'text-muted hover:text-ink-2',
          )}
        >
          <Icon size={12} /> {id}
        </button>
      ))}
    </div>
  )
}

// ── Number tween (U3) ────────────────────────────────────────────────────────
/** Eases a changing number over ~420ms. Skipped under prefers-reduced-motion. */
function useCountUp(value: number, duration = 420): number {
  const [shown, setShown] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || from === value) {
      fromRef.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(from + (value - from) * eased)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])
  return shown
}

/** A numeric value that tweens between updates. */
export function TweenNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const shown = useCountUp(value)
  return <>{format ? format(shown) : Math.round(shown)}</>
}

// ── Table density (U3b) ──────────────────────────────────────────────────────
export type Density = 'comfortable' | 'compact'
const DENSITY_KEY = 'gd.density'

function readDensity(): Density {
  try {
    const v = localStorage.getItem(DENSITY_KEY)
    if (v === 'compact' || v === 'comfortable') return v
  } catch {
    /* ignore */
  }
  return 'comfortable'
}

let densityValue: Density = readDensity()
const densityListeners = new Set<() => void>()
function emitDensity() {
  for (const l of densityListeners) l()
}
function subscribeDensity(cb: () => void) {
  densityListeners.add(cb)
  return () => {
    densityListeners.delete(cb)
  }
}
function setDensity(next: Density) {
  densityValue = next
  try {
    localStorage.setItem(DENSITY_KEY, next)
  } catch {
    /* ignore */
  }
  emitDensity()
}

/**
 * U3b: one shared row-density setting for every table, persisted in
 * localStorage (`gd.density`). Returns the current mode plus the class tokens
 * each table applies to its rows, headers and font size.
 */
export function useDensity() {
  const density = useSyncExternalStore(
    subscribeDensity,
    () => densityValue,
    () => 'comfortable' as Density,
  )
  const compact = density === 'compact'
  return {
    density,
    set: setDensity,
    /** Vertical padding for body rows. */
    rowPad: compact ? 'py-0.5' : 'py-1.5',
    /** Vertical padding for header rows. */
    headPad: compact ? 'py-1' : 'py-2',
    /** Base font size for the table. */
    fontSize: compact ? 'text-[12px]' : 'text-sm',
  }
}

/** Comfortable / Compact segmented control, rendered by each of the tables. */
export function DensityToggle({ className }: { className?: string }) {
  const { density, set } = useDensity()
  return (
    <SegmentedControl
      label="Row density"
      size="sm"
      value={density}
      onChange={set}
      className={className}
      options={[
        { id: 'comfortable', label: 'Comfortable' },
        { id: 'compact', label: 'Compact' },
      ]}
    />
  )
}

// ── Layout primitives ────────────────────────────────────────────────────────
/**
 * Card tiers (spec §7): base (surface, line, shadow-1, lg radius); feature (a
 * team slab block down the left edge); call (needs-a-call: a 2px warn left
 * edge plus an optional chip).
 */
export function Card({
  className,
  children,
  pad = true,
  tier = 'base',
  callLabel,
}: {
  className?: string
  children: ReactNode
  pad?: boolean
  tier?: 'base' | 'feature' | 'call'
  /** Chip text for tier="call" ("Needs a call"). */
  callLabel?: ReactNode
}) {
  return (
    <div
      className={cn(
        'motion relative rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-1)]',
        tier === 'feature' && 'overflow-hidden pl-[18px]',
        tier === 'call' && 'shadow-[inset_2px_0_0_var(--color-warn),var(--shadow-1)]',
        pad && 'p-4',
        pad && tier === 'feature' && 'pl-[34px]',
        className,
      )}
    >
      {tier === 'feature' && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[18px] bg-[var(--team-fill)] shadow-[inset_-4px_0_0_var(--team-fill-2),var(--team-slab-ring)]"
        />
      )}
      {tier === 'call' && callLabel && (
        <span className="mb-2 flex h-[22px] w-fit items-center rounded-[var(--r-xs)] bg-warn-soft px-2 font-cond text-label font-700 uppercase tracking-[0.07em] text-warn">
          {callLabel}
        </span>
      )}
      {children}
    </div>
  )
}

export function SectionTitle({
  children,
  right,
  className,
}: {
  children: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h3 className="flex items-center gap-2.5 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
        <span aria-hidden className="h-[18px] w-[5px] shrink-0 bg-[var(--team-accent)] [transform:skewX(var(--skew))]" />
        {children}
      </h3>
      {right}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 flex items-center gap-2 font-cond text-label font-600 uppercase tracking-[0.12em] text-[var(--team-accent-text)]">
            <span aria-hidden className="h-[3px] w-[18px] bg-[var(--team-accent)] [transform:skewX(var(--skew))]" />
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[28px] font-800 italic uppercase leading-none tracking-[0.005em] text-ink sm:text-hero">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-body text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

// ── Team crest ───────────────────────────────────────────────────────────────
export function TeamCrest({ team, size = 40 }: { team: Team; size?: number }) {
  const bg = team.primary
  return (
    <div
      className="grid shrink-0 place-items-center rounded-lg font-display font-700 uppercase leading-none"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, ${team.primary}, ${team.secondary})`,
        color: inkOn(bg),
        fontSize: size * 0.4,
        boxShadow: `inset 0 0 0 2px rgba(255,255,255,0.25)`,
      }}
      title={team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
    >
      {(team.abbr || team.name).slice(0, 3)}
    </div>
  )
}

// ── Badges & chips ───────────────────────────────────────────────────────────
type Tone = 'neutral' | 'team' | 'win' | 'loss' | 'warn' | 'gold' | 'info'
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2 border-line',
  team: 'text-[var(--team-ink)] border-transparent',
  win: 'bg-win-soft text-win border-win/30',
  loss: 'bg-loss-soft text-loss border-loss/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  gold: 'bg-gold-soft text-gold-ink border-gold/30',
  info: 'bg-brand-soft text-brand border-brand/30',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--r-xs)] border px-1.5 py-0.5 font-cond text-label font-700 uppercase tracking-[0.05em]',
        TONES[tone],
        className,
      )}
      style={tone === 'team' ? { background: 'var(--team)', color: 'var(--team-ink)' } : undefined}
    >
      {children}
    </span>
  )
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border border-line bg-surface-2 px-2 py-0.5 text-label font-500 text-ink-2',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'win' | 'loss' | 'warn'
}) {
  const color = tone === 'win' ? 'text-win' : tone === 'loss' ? 'text-loss' : tone === 'warn' ? 'text-warn' : 'text-ink'
  return (
    <div>
      <div className="label mb-0.5">{label}</div>
      <div className={cn('font-display text-2xl font-700 tnum leading-none', color)}>
        {typeof value === 'number' ? <TweenNumber value={value} /> : value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

// ── Charts ───────────────────────────────────────────────────────────────────
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = 'var(--team)',
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (!data.length) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const step = width / Math.max(1, data.length - 1)
  const pts = data.map((d, i) => [i * step, height - ((d - min) / span) * (height - 4) - 2])
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${path} L${width},${height} L0,${height} Z`
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={area} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

export function Donut({
  value,
  size = 64,
  stroke = 8,
  color,
  label,
}: {
  value: number
  size?: number
  stroke?: number
  color?: string
  label?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color ?? 'var(--team)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-lg font-700 tnum leading-none">{label ?? Math.round(value)}</div>
      </div>
    </div>
  )
}

/** Horizontal comparison bars used on the depth-chart / scheme-fit widgets. */
export function MiniBars({
  items,
  max = 100,
  segments = 0,
}: {
  items: { label: string; value: number; color?: string; title?: string; sim?: boolean }[]
  max?: number
  segments?: number
}) {
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3" title={it.title}>
          <div className="flex w-12 shrink-0 items-center gap-1">
            <span className="font-cond text-xs font-700 uppercase text-muted">{it.label}</span>
            {it.sim && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                title="Used by the game sim"
              />
            )}
          </div>
          <div className="flex-1">
            <RatingBar value={it.value} max={max} color={it.color} height={8} segments={segments} />
          </div>
          <div className="w-8 shrink-0 text-right font-cond text-xs font-700 tnum text-ink-2">{Math.round(it.value)}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * U3b: a theme-aware radar chart (SVG only). `items` are the axes, each a
 * 0–`max` value. Grid, labels and data all read the design tokens so both
 * palettes stay legible.
 */
export function RadarChart({
  items,
  size = 200,
  max = 100,
  color = 'var(--team)',
  className,
}: {
  items: { label: string; value: number }[]
  size?: number
  max?: number
  color?: string
  className?: string
}) {
  if (items.length < 3) return null
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 30
  const n = items.length
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const at = (i: number, v: number) => {
    const rr = (Math.max(0, Math.min(max, v)) / max) * r
    return [cx + Math.cos(angle(i)) * rr, cy + Math.sin(angle(i)) * rr] as const
  }
  const poly = (pts: readonly (readonly [number, number])[]) =>
    pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const rings = [0.25, 0.5, 0.75, 1]
  const dataPts = items.map((it, i) => at(i, it.value))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      {rings.map((f) => (
        <polygon
          key={f}
          points={poly(items.map((_, i) => at(i, f * max)))}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={1}
          opacity={0.9}
        />
      ))}
      {items.map((_, i) => {
        const [x, y] = at(i, max)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-line)" strokeWidth={1} />
      })}
      <polygon points={poly(dataPts)} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {dataPts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={2.4} fill={color} />
      ))}
      {items.map((it, i) => {
        const [lx, ly] = at(i, max + 16)
        const anchor = Math.abs(lx - cx) < 6 ? 'middle' : lx > cx ? 'start' : 'end'
        return (
          <text
            key={it.label}
            x={lx}
            y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={10}
            className="font-cond tnum"
            fill="var(--color-muted)"
            style={{ fontWeight: 700, textTransform: 'uppercase' }}
          >
            {it.label} {Math.round(it.value)}
          </text>
        )
      })}
    </svg>
  )
}

export function TeamTag({ team, size = 22 }: { team: Team; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="grid place-items-center rounded font-display font-700 uppercase"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(150deg, ${team.primary}, ${team.secondary})`,
          color: inkOn(team.primary),
          fontSize: size * 0.42,
        }}
      >
        {(team.abbr || team.name).slice(0, 3)}
      </span>
      <span className="text-sm font-600 text-ink">{team.tier === 'NFL' ? team.name : team.name}</span>
    </span>
  )
}

// ── Re-exports (F2 split files) ──────────────────────────────────────────────
export {
  RatingTile,
  TierPips,
  TierLegend,
  OvrBadge,
  PotBubble,
  RangeBubble,
  RookieRangeBadges,
  RatingBar,
  DevBadge,
  TierNumber,
} from './RatingTile'
export type { RatingTileSize } from './RatingTile'
export {
  KpiStrip,
  KpiTile,
  VerdictChip,
  DivergingMeter,
  TierScale,
  BudgetMeter,
  Delta,
  Effect,
  Money,
  SchemeChip,
} from './Kpi'
export type { EffectKind, SchemeState } from './Kpi'
export {
  Button,
  IconButton,
  Tabs,
  SegmentedControl,
  FilterChip,
  OptionGroup,
  OptionCard,
} from './Controls'
export type { ButtonVariant, TabItem, SegmentOption } from './Controls'
export { Dialog, Sheet, ConfirmSheet, OverflowMenu, Inspector, WithInspector } from './Overlay'
export type { Consequence, MenuItem } from './Overlay'
export { GatedAction, AccessBanner } from './Access'
export { Avatar, VacantSeat } from './People'
export { ScoreBlock, Scoreline } from './ScoreBlock'
export type { ScoreTeam } from './ScoreBlock'
