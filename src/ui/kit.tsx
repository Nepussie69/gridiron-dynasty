import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '../lib/cn'
import { gradeColor, inkOn, tint } from '../lib/format'
import type { Team } from '../game/types'

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
          onClick={() => setPref(id)}
          className={cn(
            'motion flex items-center justify-center gap-1 rounded-md px-1 py-1 font-cond text-[10px] font-700 uppercase tracking-wide',
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

// ── Layout primitives ────────────────────────────────────────────────────────
export function Card({
  className,
  children,
  pad = true,
}: {
  className?: string
  children: ReactNode
  pad?: boolean
}) {
  return (
    <div
      className={cn(
        'motion card-shadow rounded-2xl border border-line bg-surface',
        pad && 'p-4',
        className,
      )}
    >
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
      <h3 className="font-display text-lg font-700 uppercase tracking-wide text-ink">{children}</h3>
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
      <div>
        {eyebrow && <div className="label mb-1">{eyebrow}</div>}
        <h1 className="font-display text-4xl font-700 uppercase leading-none tracking-tight text-ink">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p>}
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
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-cond text-[11px] font-700 uppercase tracking-wide',
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
        'inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-500 text-ink-2',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function DevBadge({ dev }: { dev: string }) {
  const map: Record<string, string> = {
    'X-Factor': 'bg-[#101820] text-white',
    Superstar: 'bg-[#e31837] text-white',
    Star: 'bg-[#0b62ff] text-white',
    Starter: 'bg-win-soft text-win',
    Depth: 'bg-surface-3 text-muted',
    Backup: 'bg-surface-3 text-faint',
  }
  return (
    <span className={cn('rounded px-1.5 py-0.5 font-cond text-[10px] font-700 uppercase tracking-wide', map[dev] ?? map.Depth)}>
      {dev}
    </span>
  )
}

// ── Ratings ──────────────────────────────────────────────────────────────────
// L11.5 Q13 / L12.8: `pot` shows the ceiling as a smaller bubble beside the OVR badge, coloured by its grade.
export function OvrBadge({ value, pot, size = 34 }: { value: number; pot?: number; size?: number }) {
  const c = gradeColor(value)
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <span
        className="grid shrink-0 place-items-center rounded-md font-display font-700 tnum"
        style={{ width: size, height: size, background: c, color: inkOn(c), fontSize: size * 0.46 }}
      >
        {value}
      </span>
      {pot != null && (() => {
        // The ceiling gets its own smaller bubble, coloured by how good it is.
        const pc = gradeColor(pot)
        const ps = Math.max(16, Math.round(size * 0.62))
        return (
          <span
            title={`Potential (ceiling) ${pot}`}
            className="grid shrink-0 place-items-center rounded-[5px] font-display font-700 tnum"
            style={{ width: ps, height: ps, background: pc, color: inkOn(pc), fontSize: Math.max(9, Math.round(ps * 0.5)), opacity: 0.9 }}
          >
            {pot}
          </span>
        )
      })()}
    </span>
  )
}

// L12.7 D5: a prospect's read on the NFL rookie scale — "NOW 64–69" and
// "CEIL 80–88" side by side, each coloured by its midpoint like `OvrBadge`.
// `compact` shrinks the bubbles (not the labels) for tight rows.
export function RookieRangeBadges({
  now,
  ceiling,
  compact = false,
  className,
}: {
  now: [number, number]
  ceiling: [number, number]
  compact?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      <RangeBubble kind="NOW" lo={now[0]} hi={now[1]} compact={compact} />
      <RangeBubble kind="CEIL" lo={ceiling[0]} hi={ceiling[1]} compact={compact} />
    </span>
  )
}

function RangeBubble({ kind, lo, hi, compact }: { kind: 'NOW' | 'CEIL'; lo: number; hi: number; compact: boolean }) {
  const mid = Math.round((lo + hi) / 2)
  const c = gradeColor(mid)
  const range = lo === hi ? `${lo}` : `${lo}–${hi}`
  return (
    <span
      title={`${kind === 'NOW' ? 'Rookie rating range' : 'Ceiling range'} ${range} — tighter as you scout him`}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-[5px] font-display font-700 tnum leading-none',
        compact ? 'px-1 py-0.5 text-[9px]' : 'px-1.5 py-1 text-[11px]',
      )}
      style={{ background: c, color: inkOn(c), opacity: kind === 'CEIL' ? 0.9 : 1 }}
    >
      <span className={cn('font-cond font-700 uppercase tracking-wide opacity-80', compact ? 'text-[7px]' : 'text-[8px]')}>{kind}</span>
      {range}
    </span>
  )
}

export function RatingBar({
  value,
  max = 100,
  color,
  height = 6,
}: {
  value: number
  max?: number
  color?: string
  height?: number
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface-3" style={{ height }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: color ?? 'var(--team)' }}
      />
    </div>
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
}: {
  items: { label: string; value: number; color?: string; title?: string; sim?: boolean }[]
  max?: number
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
            <RatingBar value={it.value} max={max} color={it.color} height={8} />
          </div>
          <div className="w-8 shrink-0 text-right font-cond text-xs font-700 tnum text-ink-2">{Math.round(it.value)}</div>
        </div>
      ))}
    </div>
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

// ── Buttons ──────────────────────────────────────────────────────────────────
export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  className,
  disabled,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost' | 'team' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  disabled?: boolean
  title?: string
}) {
  const variants: Record<string, string> = {
    default: 'bg-surface border border-line hover:bg-surface-2 text-ink',
    primary: 'bg-ink text-canvas hover:opacity-90 border border-transparent',
    ghost: 'bg-transparent hover:bg-surface-2 text-ink-2 border border-transparent',
    danger: 'bg-loss-soft text-loss border border-loss/30 hover:bg-loss/15',
    team: 'text-[var(--team-ink)] border border-transparent hover:opacity-90',
  }
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3.5 py-1.5 text-sm',
    lg: 'px-5 py-2.5 text-sm',
  }
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'motion inline-flex items-center justify-center gap-1.5 rounded-lg font-cond font-700 uppercase tracking-wide active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      style={variant === 'team' ? { background: 'var(--team)', color: 'var(--team-ink)' } : undefined}
    >
      {children}
    </button>
  )
}

/** Soft team-tinted panel background. */
export function teamPanelStyle(team: Team) {
  return { background: tint(team.primary, 0.93) }
}
