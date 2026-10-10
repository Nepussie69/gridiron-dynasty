// ─────────────────────────────────────────────────────────────────────────────
// KPI lower-third + value primitives (UI redesign F2, spec §7).
//   KpiStrip / KpiTile — label, NEUTRAL value + unit, verdict chip, one-line
//                        "why", and a slot for a scale or meter.
//   DivergingMeter     — SVG, midline + floor/cap marker (−9 | 0 | +9).
//   TierScale          — rating on the tier track with an avg tick.
//   BudgetMeter        — "$20.3M of $35.4M · 57% used".
//   Delta / Effect     — neutral number, coloured ▲▼ glyph, FLOOR/CAP flag.
//   Money              — signed, tnum, right-aligned, freed/cost tone.
//   SchemeChip         — live / match / off / na.
// Status colour lives only in chips, glyphs and meters — never in big numbers.
// ─────────────────────────────────────────────────────────────────────────────
import { useId, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../lib/cn'
import { MINUS, money, mult, ratingTier, signed, STAFF_BASELINE, type Tone } from '../lib/format'

const TONE_CHIP: Record<Tone, string> = {
  win: 'bg-win-soft text-win',
  neutral: 'bg-surface-3 text-ink-2',
  warn: 'bg-warn-soft text-warn',
  loss: 'bg-loss-soft text-loss',
}
const TONE_VAR: Record<Tone, string> = {
  win: 'var(--color-win)',
  neutral: 'var(--color-ink-2)',
  warn: 'var(--color-warn)',
  loss: 'var(--color-loss)',
}

/** A verdict word on a soft tone (HOT SEAT, TIGHT, AT THE FLOOR). Never wraps. */
export function VerdictChip({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--r-xs)] px-2 font-cond text-label font-700 uppercase tracking-[0.07em]',
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * The KPI lower-third bar. Tiles are split by 1px rules; on phone it becomes a
 * 2-column grid of separate tiles. `columns` is a CSS grid template for ≥1024px
 * (default: equal columns).
 */
export function KpiStrip({
  children,
  columns,
  className,
  label,
}: {
  children: ReactNode
  columns?: string
  className?: string
  label?: string
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'grid grid-cols-2 gap-2 sm:gap-0 lg:[grid-template-columns:var(--kpi-cols)]',
        'sm:overflow-hidden sm:rounded-[var(--r-lg)] sm:border sm:border-line sm:bg-surface sm:shadow-[var(--shadow-1)]',
        'sm:[&>*]:rounded-none sm:[&>*]:border-0 sm:[&>*]:border-b sm:[&>*]:border-r sm:[&>*]:border-line sm:[&>*]:shadow-none',
        'lg:[&>*]:border-b-0 lg:[&>*:last-child]:border-r-0',
        className,
      )}
      style={{ ['--kpi-cols' as string]: columns ?? `repeat(${Array.isArray(children) ? children.filter(Boolean).length : 1}, minmax(0, 1fr))` }}
    >
      {children}
    </section>
  )
}

/**
 * One KPI: label, a neutral value with its unit, an optional verdict chip, a
 * single-line explanation and a slot (`children`) for a scale or meter.
 */
export function KpiTile({
  label,
  value,
  unit,
  verdict,
  why,
  children,
  aside,
  className,
}: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  verdict?: { label: ReactNode; tone?: Tone }
  /** One line of plain-words explanation (baseline, reason). */
  why?: ReactNode
  /** Scale / meter slot. */
  children?: ReactNode
  /** Top-right slot (e.g. an info IconButton). */
  aside?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-[var(--r-md)] border border-line bg-surface p-3 sm:px-[18px] sm:py-4',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label truncate">{label}</span>
        {aside}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display text-kpi font-800 italic text-ink tnum">{value}</span>
        {unit && <span className="font-cond text-small font-600 uppercase tracking-[0.04em] text-muted">{unit}</span>}
        {verdict && (
          <VerdictChip tone={verdict.tone} className="self-center">
            {verdict.label}
          </VerdictChip>
        )}
      </div>
      {children}
      {why && <div className="text-small text-ink-2">{why}</div>}
    </div>
  )
}

/**
 * Diverging SVG meter: a midline at `mid`, a bar from mid to the value, and a
 * pinned marker. `floor` / `cap` draw a hatched end-stop; when the value sits
 * on one the marker is flagged. `goodWhen` picks the bar tone.
 */
export function DivergingMeter({
  value,
  min,
  max,
  mid = 0,
  floor,
  cap,
  goodWhen = 'up',
  format = (n: number) => signed(n, 1),
  ticks = true,
  label,
  className,
}: {
  value: number
  min: number
  max: number
  mid?: number
  floor?: number
  cap?: number
  goodWhen?: 'up' | 'down'
  format?: (n: number) => string
  ticks?: boolean
  label: string
  className?: string
}) {
  const W = 240
  const H = 16
  const x = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * W
  const v = Math.max(min, Math.min(max, value))
  const good = goodWhen === 'up' ? v >= mid : v <= mid
  const tone = v === mid ? 'var(--color-ink-2)' : good ? 'var(--color-win)' : 'var(--color-loss)'
  const atFloor = floor != null && v <= floor
  const atCap = cap != null && v >= cap
  const pat = useId().replace(/:/g, '')
  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={`${label}: ${format(value)}${atFloor ? ' (at the floor)' : atCap ? ' (at the cap)' : ''}`}
      className={cn('w-full', className)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="block h-4 w-full overflow-visible">
        <defs>
          <pattern id={`h${pat}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--color-surface-3)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--color-line-strong)" strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect x="0" y="5" width={W} height="6" rx="3" fill="var(--color-surface-3)" />
        {floor != null && floor > min && <rect x="0" y="5" width={x(floor)} height="6" fill={`url(#h${pat})`} />}
        {cap != null && cap < max && <rect x={x(cap)} y="5" width={W - x(cap)} height="6" fill={`url(#h${pat})`} />}
        <rect x={Math.min(x(mid), x(v))} y="5" width={Math.abs(x(v) - x(mid))} height="6" fill={tone} />
        <rect x={x(mid) - 1} y="1" width="2" height="14" fill="var(--color-ink-2)" />
        <rect
          x={Math.min(W - 4, Math.max(0, x(v) - 2))}
          y="0"
          width="4"
          height="16"
          rx="2"
          fill="var(--color-ink)"
          stroke="var(--color-surface)"
          strokeWidth="1.5"
        />
      </svg>
      {ticks && (
        <div aria-hidden className="relative mt-1 h-3 font-cond text-micro font-600 leading-none text-muted tnum">
          <span className="absolute left-0">{floor != null ? `${format(floor)} floor` : format(min)}</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${(x(mid) / W) * 100}%` }}>
            {format(mid)}
          </span>
          <span className="absolute right-0">{cap != null ? `${format(cap)} cap` : format(max)}</span>
        </div>
      )}
    </div>
  )
}

/** A rating on the tier track (Liability → Elite) with an average tick. */
export function TierScale({
  value,
  avg = STAFF_BASELINE,
  min = 40,
  max = 99,
  label = 'Rating',
  className,
}: {
  value: number
  avg?: number
  min?: number
  max?: number
  label?: string
  className?: string
}) {
  const pos = (v: number) => `${((Math.max(min, Math.min(max, v)) - min) / (max - min)) * 100}%`
  const stops: [number, string][] = [
    [50, 'var(--color-tier-liab)'],
    [58, 'var(--color-tier-weak)'],
    [66, 'var(--color-tier-depth)'],
    [74, 'var(--color-tier-rotation)'],
    [82, 'var(--color-tier-starter)'],
    [90, 'var(--color-tier-pro)'],
    [max + 1, 'var(--color-tier-elite)'],
  ]
  let from = min
  const grad = stops
    .map(([to, c]) => {
      const seg = `${c} ${pos(from)} ${pos(Math.min(to, max))}`
      from = to
      return seg
    })
    .join(', ')
  const t = ratingTier(value)
  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={`${label} ${Math.round(value)}, ${t.label} tier; league average ${avg}`}
      className={cn('relative mt-0.5 h-[30px]', className)}
    >
      <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-cond text-micro font-600 leading-none tracking-[0.04em] text-muted" style={{ left: pos(avg) }}>
        avg {avg}
      </span>
      <div className="absolute inset-x-0 top-[19px] h-1 rounded-[2px]" style={{ background: `linear-gradient(90deg, ${grad})` }} />
      <div className="absolute top-[13px] h-4 w-[2px] -translate-x-1/2 bg-ink-2 opacity-60" style={{ left: pos(avg) }} />
      <div
        className="absolute top-[13px] h-4 w-1 -translate-x-1/2 rounded-[2px] bg-ink"
        style={{ left: pos(value), boxShadow: '0 0 0 2px var(--color-surface)' }}
      />
    </div>
  )
}

/** Budget meter: "$20.3M of $35.4M · 57% used". Over budget turns warn. */
export function BudgetMeter({
  used,
  total,
  note,
  className,
}: {
  used: number
  total: number
  note?: ReactNode
  className?: string
}) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0
  const over = used > total
  return (
    <div className={cn('min-w-0', className)}>
      <div
        role="meter"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${money(used)} of ${money(total)}, ${pct}% used`}
        className="h-1.5 w-full overflow-hidden rounded-[3px] bg-surface-3"
      >
        <div className={cn('h-full rounded-[3px]', over ? 'bg-warn' : 'bg-ink-2')} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-small tnum text-muted">
        <span>
          <b className="font-600 text-ink">{money(used)}</b> of {money(total)}
        </span>
        <span className={over ? 'text-warn' : undefined}>{pct}% used</span>
      </div>
      {note && <div className="text-label text-muted">{note}</div>}
    </div>
  )
}

/** "−17 vs avg": a signed difference with an optional suffix, neutral by default. */
export function Delta({
  value,
  digits = 0,
  suffix,
  tone,
  className,
}: {
  value: number
  digits?: number
  suffix?: ReactNode
  /** Colour the number (rare: deltas are usually neutral). */
  tone?: Tone
  className?: string
}) {
  return (
    <span className={cn('whitespace-nowrap tnum', className)}>
      <b className="font-600" style={{ color: tone ? TONE_VAR[tone] : 'var(--color-ink-2)' }}>
        {signed(value, digits)}
      </b>
      {suffix && <span className="text-muted"> {suffix}</span>}
    </span>
  )
}

export type EffectKind = 'edge' | 'mult' | 'money' | 'number'

/**
 * An engine effect: neutral number, a coloured ▲/▼ glyph (win when it helps
 * you, loss when it hurts, per `goodWhen`), and a FLOOR / CAP flag when the
 * value is clamped. `kind`: edge (signed, 1dp), mult (×0.84, vs 1.00), money.
 */
export function Effect({
  value,
  kind = 'edge',
  goodWhen = 'up',
  clamp,
  label,
  unit,
  digits,
  className,
}: {
  value: number
  kind?: EffectKind
  goodWhen?: 'up' | 'down' | 'none'
  clamp?: 'floor' | 'cap' | null
  label?: ReactNode
  unit?: ReactNode
  digits?: number
  className?: string
}) {
  const base = kind === 'mult' ? 1 : 0
  const dir = value > base ? 1 : value < base ? -1 : 0
  const good = goodWhen === 'none' || dir === 0 ? null : (dir > 0) === (goodWhen === 'up')
  const text =
    kind === 'mult'
      ? mult(value, digits ?? 2)
      : kind === 'money'
        ? money(value, { sign: true }).replace('-', MINUS)
        : signed(value, digits ?? (kind === 'edge' ? 1 : 0))
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      {dir !== 0 && (
        <span
          aria-hidden
          className="text-micro"
          style={{ color: good == null ? 'var(--color-muted)' : good ? 'var(--color-win)' : 'var(--color-loss)' }}
        >
          {dir > 0 ? '▲' : '▼'}
        </span>
      )}
      <b className="font-600 text-ink tnum">{text}</b>
      {unit && <span className="text-muted">{unit}</span>}
      {label && <span className="text-ink-2">{label}</span>}
      {clamp && (
        <span className="rounded-[2px] bg-loss-soft px-[5px] py-[3px] font-cond text-micro font-700 uppercase leading-none tracking-[0.07em] text-loss">
          {clamp === 'floor' ? 'Floor' : 'Cap'}
        </span>
      )}
      {good != null && <span className="sr-only">{good ? '(helps)' : '(hurts)'}</span>}
    </span>
  )
}

/**
 * Money: signed, tabular, right-aligned. `tone` "freed" (win) or "cost" (warn)
 * colours the figure; "auto" picks from the sign (positive freed, negative cost).
 */
export function Money({
  value,
  sign = false,
  tone = 'neutral',
  align = 'right',
  className,
}: {
  value: number
  sign?: boolean
  tone?: 'freed' | 'cost' | 'neutral' | 'auto'
  align?: 'right' | 'left'
  className?: string
}) {
  const t = tone === 'auto' ? (value > 0 ? 'freed' : value < 0 ? 'cost' : 'neutral') : tone
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap font-600 tnum',
        align === 'right' && 'text-right',
        t === 'freed' ? 'text-win' : t === 'cost' ? 'text-warn' : 'text-ink',
        className,
      )}
    >
      {money(value, { sign }).replace('-', MINUS)}
    </span>
  )
}

export type SchemeState = 'live' | 'match' | 'off' | 'na'

/**
 * Scheme chip. live: inverse slab with a green dot (drives play-calling);
 * match: ✓ neutral; off: amber outline with "≠ OC/DC"; na: "no effect".
 */
export function SchemeChip({
  scheme,
  state,
  against,
  className,
}: {
  scheme: string
  state: SchemeState
  /** Who it clashes with (off): "OC" / "DC". */
  against?: string
  className?: string
}) {
  const desc =
    state === 'live'
      ? 'drives play-calling'
      : state === 'match'
        ? 'matches the live scheme'
        : state === 'off'
          ? `differs from the ${against ?? 'coordinator'} scheme`
          : 'no effect on the sim'
  return (
    <span
      title={`${scheme}: ${desc}`}
      className={cn(
        'inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--r-xs)] px-[9px] font-cond text-small font-700 uppercase tracking-[0.04em]',
        state === 'live' && 'bg-slab text-on-slab',
        state === 'match' && 'bg-surface-3 text-ink-2',
        state === 'off' && 'text-warn shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-warn)_60%,transparent)]',
        state === 'na' && 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)]',
        className,
      )}
    >
      {state === 'live' && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-win shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-win)_30%,transparent)]"
        />
      )}
      {state === 'match' && <Check size={12} aria-hidden />}
      <span className="truncate">{scheme}</span>
      {state === 'off' && <span className="font-600">≠ {against ?? 'OC/DC'}</span>}
      {state === 'na' && <span className="font-600 normal-case tracking-normal">· no effect</span>}
      <span className="sr-only">({desc})</span>
    </span>
  )
}
