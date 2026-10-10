// ─────────────────────────────────────────────────────────────────────────────
// Rating tiles (UI redesign F2, spec §4). One tier scale for players, staff,
// prospects and college grades: Elite / Pro Bowl / Starter / Rotation are solid
// fills with dark ink; Depth / Weak / Liability are OUTLINE tiers (Depth 2px
// grey outline + ink-2 number; Weak amber outline + amber number on a wash;
// Liability red outline + red number on a wash). Pips repeat the tier so it is
// never shown by colour alone.
// ─────────────────────────────────────────────────────────────────────────────
import type { CSSProperties, ReactNode } from 'react'
import { Star } from 'lucide-react'
import { cn } from '../lib/cn'
import { ratingTier, signed, STAFF_BASELINE, tierStroke, type RatingTier } from '../lib/format'

export type RatingTileSize = 'xs' | 'sm' | 'md' | 'lg'
const TILE_PX: Record<RatingTileSize, number> = { xs: 24, sm: 32, md: 40, lg: 56 }

/** Inline style for a tile / bubble painted in a tier (fill + ink + outline). */
function tierStyle(t: RatingTier, px: number): CSSProperties {
  const ring = px < 26 ? 1.5 : 2
  return {
    background: t.fill,
    color: t.ink,
    boxShadow: t.outline ? `inset 0 0 0 ${ring}px ${t.outline}` : undefined,
  }
}

/** Five pips; filled count = tier pips (Elite 5 … Depth/Weak 1, Liability 0). */
export function TierPips({ value, className }: { value: number; className?: string }) {
  const t = ratingTier(value)
  return (
    <span
      className={cn('inline-flex items-center gap-[2px]', className)}
      role="img"
      aria-label={`${t.label} tier, ${t.pips} of 5`}
      title={`${t.label} · ${t.pips}/5`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn('h-[6px] w-[4px] rounded-[1px]', i < t.pips ? 'bg-ink-2' : 'bg-surface-3')}
        />
      ))}
    </span>
  )
}

/**
 * The rating tile. `size` is a preset (xs 24, sm 32 table, md 40 row, lg 56
 * card) or a pixel number (legacy OvrBadge sizes). `tierWord` shows WEAK /
 * LIAB. (inside the tile at lg, beside it otherwise). `delta` adds
 * "−17 vs avg" against STAFF_BASELINE (true) or a given baseline. `pips` adds
 * the 5-pip tier strip for table and dense modes.
 */
export function RatingTile({
  value,
  size = 'md',
  tierWord = false,
  delta,
  deltaLabel = 'vs avg',
  pips = false,
  label,
  college = false,
  className,
}: {
  value: number
  size?: RatingTileSize | number
  tierWord?: boolean
  /** true → vs STAFF_BASELINE (74); a number → vs that baseline. */
  delta?: boolean | number
  deltaLabel?: string
  pips?: boolean
  /** What the number is ("Overall", "Staff rating") for the accessible name. */
  label?: string
  /** College grade on the NFL scale: adds a "college" tag. */
  college?: boolean
  className?: string
}) {
  const t = ratingTier(value)
  const px = typeof size === 'number' ? size : TILE_PX[size]
  const v = Math.round(value)
  const inTileWord = tierWord && px >= 48
  const baseline = delta === true ? STAFF_BASELINE : typeof delta === 'number' ? delta : null
  const diff = baseline != null ? v - baseline : null
  const name = `${label ? `${label} ` : ''}${v}, ${t.label} tier${college ? ' (college grade)' : ''}${
    diff != null ? `, ${signed(diff)} ${deltaLabel}` : ''
  }`

  const tile = (
    <span
      role="img"
      aria-label={name}
      title={name}
      className="inline-flex shrink-0 flex-col items-center justify-center rounded-[var(--r-sm)] font-display font-800 italic leading-none tnum"
      style={{ width: px, height: px, fontSize: Math.max(12, Math.round(px * (inTileWord ? 0.44 : 0.5))), ...tierStyle(t, px) }}
    >
      <span className="pr-[0.06em]">{v}</span>
      {inTileWord && (
        <span className="mt-0.5 font-cond text-label font-700 not-italic uppercase leading-none tracking-[0.06em] opacity-90">
          {t.short}
        </span>
      )}
    </span>
  )

  const side = (tierWord && !inTileWord) || pips || diff != null || college
  if (!side) return <span className={cn('inline-flex shrink-0', className)}>{tile}</span>

  const stacked = px >= 48
  return (
    <span
      className={cn(
        'inline-flex shrink-0',
        stacked ? 'flex-col items-center gap-1' : 'items-center gap-1.5',
        className,
      )}
    >
      {tile}
      <span className={cn('flex', stacked ? 'flex-col items-center gap-1' : 'flex-col items-start gap-0.5')}>
        {tierWord && !inTileWord && (
          <span
            className="font-cond text-label font-700 uppercase leading-none tracking-[0.07em]"
            style={{ color: t.outline && t.key !== 'depth' ? t.ink : 'var(--color-muted)' }}
          >
            {t.short}
          </span>
        )}
        {pips && <TierPips value={v} />}
        {diff != null && (
          <span className="whitespace-nowrap font-cond text-label font-600 leading-none tracking-[0.04em] text-muted tnum">
            <b className="font-700 text-ink-2">{signed(diff)}</b> {deltaLabel}
          </span>
        )}
        {college && <span className="label leading-none">college</span>}
      </span>
    </span>
  )
}

/** The seven tiers as a legend row (rating-heavy screens and /kit). */
export function TierLegend({ className }: { className?: string }) {
  const samples = [92, 85, 77, 69, 61, 54, 45]
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)} aria-label="Rating tiers">
      {samples.map((s) => {
        const t = ratingTier(s)
        return (
          <span key={t.key} className="inline-flex items-center gap-1.5 whitespace-nowrap font-cond text-label font-600 uppercase tracking-[0.06em] text-muted">
            <span className="inline-block h-[16px] w-[20px] rounded-[2px]" style={tierStyle(t, 20)} aria-hidden />
            {t.label} <span className="text-faint tnum">{t.min === -Infinity ? '<50' : t.key === 'elite' ? '90+' : `${t.min}+`}</span>
          </span>
        )
      })}
    </div>
  )
}

// ── Legacy exports rebuilt on the tiers ───────────────────────────────────────

/** The POT (ceiling) bubble: a smaller tile in the same tiers. */
export function PotBubble({ value, size = 21, className }: { value: number; size?: number; className?: string }) {
  const t = ratingTier(value)
  const name = `Potential (ceiling) ${value}, ${t.label} tier`
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn('grid shrink-0 place-items-center rounded-[var(--r-xs)] font-display font-800 italic leading-none tnum', className)}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.52)), ...tierStyle(t, size) }}
    >
      {value}
    </span>
  )
}

/**
 * OVR tile with an optional POT bubble (L11.5 Q13 / L12.8). Same props as
 * before; now drawn by RatingTile so low tiers are outlines, not red walls.
 */
export function OvrBadge({ value, pot, size = 34 }: { value: number; pot?: number; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <RatingTile value={value} size={size} label="Overall" />
      {pot != null && <PotBubble value={pot} size={Math.max(18, Math.round(size * 0.62))} />}
    </span>
  )
}

/** "NOW 64–69" / "CEIL 80–88": a prospect range, tiered by its midpoint. */
export function RangeBubble({
  kind,
  lo,
  hi,
  compact = false,
}: {
  kind: 'NOW' | 'CEIL'
  lo: number
  hi: number
  compact?: boolean
}) {
  const t = ratingTier(Math.round((lo + hi) / 2))
  const range = lo === hi ? `${lo}` : `${lo}–${hi}`
  const name = `${kind === 'NOW' ? 'Rookie rating range' : 'Ceiling range'} ${range} (${t.label} tier), tighter as you scout him`
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[var(--r-xs)] font-display font-800 italic leading-none tnum',
        compact ? 'px-1 py-[3px] text-[12px]' : 'px-1.5 py-1 text-[13px]',
      )}
      style={tierStyle(t, compact ? 20 : 26)}
    >
      <span className="font-cond text-label font-700 not-italic uppercase leading-none tracking-[0.03em] opacity-85">{kind}</span>
      {range}
    </span>
  )
}

/** A prospect's NOW and CEIL ranges side by side (L12.7 D5). */
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

/**
 * A rating meter. Segmented: segments fill up to the value, ALL in the tier
 * colour of the value itself (spec §4). Continuous: `tone="tier"` paints the
 * value's tier; otherwise the legacy team accent (or an explicit `color`).
 */
export function RatingBar({
  value,
  max = 100,
  color,
  height = 6,
  segments = 0,
  tone,
  label,
}: {
  value: number
  max?: number
  color?: string
  height?: number
  segments?: number
  tone?: 'tier' | 'team'
  /** Accessible name; defaults to "value of max". */
  label?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const tierColor = tierStroke((value / max) * 100)
  const aria = {
    role: 'meter' as const,
    'aria-valuenow': Math.round(value),
    'aria-valuemin': 0,
    'aria-valuemax': max,
    'aria-label': label ?? `${Math.round(value)} of ${max}`,
  }
  if (segments > 0) {
    const filled = Math.round((pct / 100) * segments)
    const fill = color ?? tierColor
    return (
      <div className="flex w-full items-stretch gap-[2px]" style={{ height }} {...aria}>
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className="min-w-0 flex-1 rounded-[2px]"
            style={{ background: i < filled ? fill : 'var(--color-surface-3)' }}
          />
        ))}
      </div>
    )
  }
  const fill = color ?? (tone === 'tier' ? tierColor : 'var(--team-accent)')
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface-3" style={{ height }} {...aria}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: fill }} />
    </div>
  )
}

/** Development trait: neutral chips; a gold star only for X-Factor and Superstar. */
export function DevBadge({ dev, className }: { dev: string; className?: string }) {
  const star = dev === 'X-Factor' || dev === 'Superstar'
  const strong = star || dev === 'Star'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--r-xs)] border px-1.5 py-0.5 font-cond text-label font-700 uppercase leading-none tracking-[0.06em]',
        strong ? 'border-line-strong bg-surface-3 text-ink' : 'border-line bg-surface-2 text-muted',
        className,
      )}
    >
      {star && <Star size={11} className="fill-current text-gold" aria-hidden />}
      {dev}
    </span>
  )
}

/** A tier-coloured number (no tile), for dense text such as "57 Weak". */
export function TierNumber({ value, children }: { value: number; children?: ReactNode }) {
  const t = ratingTier(value)
  const color = t.key === 'weak' || t.key === 'liability' ? t.ink : 'var(--color-ink)'
  return (
    <span className="font-600 tnum" style={{ color }}>
      {children ?? Math.round(value)}
    </span>
  )
}
