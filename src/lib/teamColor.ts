// ─────────────────────────────────────────────────────────────────────────────
// Team colour tokens (UI redesign F1, "Sunday Broadcast").
//
// A club's raw brand colours are identity, not meaning, and many of them fail
// as foreground on our surfaces (CLE #311D00 is 1.08:1 on the dark surface).
// teamTokens() turns primary/secondary into contrast-checked tokens using WCAG
// relative luminance:
//   --team-fill / --team-fill-2  raw primary / secondary (large slabs, stripes)
//   --team-on                    #FFFFFF or #0B1220, whichever reads on the fill
//   --team-accent                ≥3:1 on surface (marks, bars, underlines)
//   --team-accent-text           ≥4.5:1 on surface (text)
//   --team-accent-on             ink for text sitting on an accent fill
//   --team-slab-ring / --team-lift-stripe   dark-slab lift when the fill
//                                vanishes against the canvas (<1.5:1)
// --team-tint is derived in index.css from --team-accent and the surface.
//
// This file has NO imports so scripts/check-contrast.ts can load it directly
// with `node --experimental-strip-types`.
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeName = 'light' | 'dark'

/** Surface / canvas per theme. Must match src/index.css (check-contrast asserts it). */
export const THEME_BASE: Record<ThemeName, { surface: string; canvas: string }> = {
  dark: { surface: '#111723', canvas: '#090D14' },
  light: { surface: '#FFFFFF', canvas: '#ECEFF4' },
}

export const INK_DARK = '#0B1220'
export const INK_LIGHT = '#FFFFFF'

/** WCAG targets. */
export const ACCENT_MIN = 3
export const ACCENT_TEXT_MIN = 4.5
/** A fill under this contrast against the canvas gets the dark-slab lift. */
export const SLAB_LIFT_BELOW = 1.5

type RGB = [number, number, number]

/** Parse #RGB / #RRGGBB (case-insensitive). Returns null for anything else. */
export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function toHex([r, g, b]: RGB): string {
  const p = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase()
}

/** WCAG 2.x relative luminance of an sRGB hex colour. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** sRGB mix like CSS color-mix(in srgb, a (1-t), b t). */
export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a) ?? [0, 0, 0]
  const y = parseHex(b) ?? [0, 0, 0]
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

/** `fg` at `alpha` composited over an opaque `bg` (what a color-mix(…, transparent) wash renders as). */
export function over(fg: string, alpha: number, bg: string): string {
  return mixHex(bg, fg, alpha)
}

/** #FFFFFF or #0B1220, whichever contrasts more with `bg`. */
export function bestInk(bg: string): string {
  return contrast(bg, INK_LIGHT) >= contrast(bg, INK_DARK) ? INK_LIGHT : INK_DARK
}

/**
 * Hero slab: a gradient that stays readable end to end. The far stop is the
 * primary shaded AWAY from its ink (lighter under dark ink, darker under light
 * ink), so contrast only improves across the slab; the secondary colour is kept
 * as an edge stripe instead of a gradient stop (PIT gold to black hid dark ink).
 */
export function heroSlab(primary: string, secondary: string): { background: string; ink: string; edge: string } {
  const ink = bestInk(primary)
  const far = mixHex(primary, ink === INK_DARK ? '#FFFFFF' : '#000000', 0.22) // check-hex-allow: shade target
  return { background: `linear-gradient(120deg, ${primary}, ${far})`, ink, edge: secondary }
}

/** Colourfulness (chroma, 0..1). Used to pick which brand colour to mix when neither passes. */
function chroma(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  return (Math.max(...rgb) - Math.min(...rgb)) / 255
}

export interface AccentPick {
  color: string
  /** 'primary' | 'secondary' used as-is, or 'mixed' when lightened/darkened to pass. */
  source: 'primary' | 'secondary' | 'mixed'
}

/** Highest contrast either ink (#FFFFFF / #0B1220) reaches on `bg`. */
function inkContrast(bg: string): number {
  return Math.max(contrast(bg, INK_LIGHT), contrast(bg, INK_DARK))
}

/**
 * The first of primary / secondary that reaches `target` on `surface`. If
 * neither does, mix the more colourful one toward white (dark theme) or black
 * (light theme) in 2% steps until it does.
 *
 * With `inkMin`, the pick must also carry #FFFFFF or #0B1220 text at that
 * ratio (the accent is used as a fill under --team-ink, e.g. the active nav
 * pill). A mid-luminance colour that passes on the surface but not under ink
 * (LAC #0080C6 tops out at 4.37:1) is nudged the same way in 1% steps.
 */
export function pickAccent(
  primary: string,
  secondary: string,
  surface: string,
  target: number,
  theme: ThemeName,
  inkMin = 0,
): AccentPick {
  const toward = theme === 'dark' ? '#FFFFFF' : '#000000'
  const ok = (c: string) => contrast(c, surface) >= target && inkContrast(c) >= inkMin
  const candidates: [string, 'primary' | 'secondary'][] = [
    [primary, 'primary'],
    [secondary, 'secondary'],
  ]
  for (const [c, source] of candidates) {
    if (contrast(c, surface) < target) continue
    if (ok(c)) return { color: toHex(parseHex(c)!), source }
    for (let i = 1; i <= 20; i++) {
      const m = mixHex(c, toward, i * 0.01)
      if (ok(m)) return { color: m, source: 'mixed' }
    }
  }
  const base = chroma(primary) >= chroma(secondary) ? primary : secondary
  for (let i = 1; i <= 50; i++) {
    const m = mixHex(base, toward, i * 0.02)
    if (ok(m)) return { color: m, source: 'mixed' }
  }
  return { color: theme === 'dark' ? '#FFFFFF' : '#000000', source: 'mixed' }
}

export interface TeamTokens {
  fill: string
  fill2: string
  on: string
  accent: AccentPick
  accentText: AccentPick
  accentOn: string
  /** True when the fill is under 1.5:1 against the canvas (slab needs ring + stripe). */
  lift: boolean
  /** CSS custom properties to write on document.documentElement. */
  vars: Record<string, string>
}

const FALLBACK_PRIMARY = '#1F62D6'
const FALLBACK_SECONDARY = '#0B1220'

export function teamTokens(primary: string, secondary: string, theme: ThemeName): TeamTokens {
  const p = parseHex(primary) ? toHex(parseHex(primary)!) : FALLBACK_PRIMARY
  const s = parseHex(secondary) ? toHex(parseHex(secondary)!) : FALLBACK_SECONDARY
  const { surface, canvas } = THEME_BASE[theme]
  const accent = pickAccent(p, s, surface, ACCENT_MIN, theme, ACCENT_TEXT_MIN)
  const accentText = pickAccent(p, s, surface, ACCENT_TEXT_MIN, theme)
  const on = bestInk(p)
  const accentOn = bestInk(accent.color)
  const lift = contrast(p, canvas) < SLAB_LIFT_BELOW
  return {
    fill: p,
    fill2: s,
    on,
    accent,
    accentText,
    accentOn,
    lift,
    vars: {
      '--team-fill': p,
      '--team-fill-2': s,
      '--team-on': on,
      '--team-accent': accent.color,
      '--team-accent-text': accentText.color,
      '--team-accent-on': accentOn,
      '--team-slab-ring': lift ? 'inset 0 0 0 1px var(--color-line-strong)' : 'none',
      '--team-lift-stripe': lift ? '6px' : '0px',
    },
  }
}

/**
 * Everything AppShell writes on document.documentElement: the tokens for the
 * app's current theme, plus dark-theme accent copies that the always-dark
 * `.broadcast` scope (Game Day) swaps in.
 */
export function rootTeamVars(primary: string, secondary: string, theme: ThemeName): Record<string, string> {
  const dark = theme === 'dark' ? teamTokens(primary, secondary, 'dark') : null
  const cur = dark ?? teamTokens(primary, secondary, theme)
  const d = dark ?? teamTokens(primary, secondary, 'dark')
  return {
    ...cur.vars,
    '--team-dark-accent': d.accent.color,
    '--team-dark-accent-text': d.accentText.color,
    '--team-dark-accent-on': d.accentOn,
  }
}

/** Names of every property rootTeamVars() writes (for cleanup). */
export const TEAM_VAR_NAMES = Object.keys(rootTeamVars(FALLBACK_PRIMARY, FALLBACK_SECONDARY, 'light'))
