// ─────────────────────────────────────────────────────────────────────────────
// UI redesign contrast check (F0/F1).
//
//   node --experimental-strip-types scripts/check-contrast.ts [--baseline] [--verbose]
//
// Asserts, in BOTH themes:
//   • teamTokens() for all 32 NFL clubs: accent ≥3:1 and accent-text ≥4.5:1 on
//     surface; --team-on ≥3:1 on the fill (large slab text); --team-accent-on
//     ≥4.5:1 on the accent.
//   • every rating-tier ink pair (filled tiers, outline tiers on their wash)
//     ≥4.5:1; tier outlines ≥3:1; light Weak #9A5800 included. (The
//     gradeColor() shim and its -on tokens were removed in V1.)
//   • every tone-on-soft pair (brand/win/loss/warn/gold on its -soft wash over
//     surface and surface-2) ≥4.5:1, plus the neutral text tokens.
// Token values are parsed from src/index.css (light = @theme, dark = the
// `@variant theme-dark` block), so the CSS stays the single source of truth.
//
// --baseline also prints the pre-F1 check: the raw primary used as --team
// foreground on the old surfaces (#111A2B dark / #FFFFFF light), ≥3:1.
// Exits 1 when any assertion fails.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NFL_TEAMS } from '../src/game/data/nflTeams.ts'
import {
  ACCENT_MIN,
  ACCENT_TEXT_MIN,
  THEME_BASE,
  contrast,
  over,
  teamTokens,
  type ThemeName,
} from '../src/lib/teamColor.ts'

const args = new Set(process.argv.slice(2))
const verbose = args.has('--verbose')
const cssPath = fileURLToPath(new URL('../src/index.css', import.meta.url))
const css = readFileSync(cssPath, 'utf8')

/** Body of the first `{…}` block that starts at/after `marker`. */
function blockAfter(marker: string): string {
  const at = css.indexOf(marker)
  if (at < 0) throw new Error(`index.css: marker not found: ${marker}`)
  const open = css.indexOf('{', at)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error(`index.css: unbalanced block after ${marker}`)
}

function readVars(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of clean.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim()
  return out
}

const lightTheme = readVars(blockAfter('@theme {'))
const lightRoot = readVars(blockAfter('/* Non-utility tokens'))
const dark = readVars(blockAfter('@variant theme-dark {'))
const tokens: Record<ThemeName, Record<string, string>> = {
  light: { ...lightRoot, ...lightTheme },
  dark: { ...lightRoot, ...lightTheme, ...dark },
}

function hex(theme: ThemeName, name: string): string {
  const v = tokens[theme][`color-${name}`]
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`index.css: --color-${name} (${theme}) is not a 6-digit hex: ${v}`)
  return v
}
function pct(theme: ThemeName, name: string): number {
  const v = tokens[theme][name]
  const m = /^([\d.]+)%$/.exec(v ?? '')
  if (!m) throw new Error(`index.css: --${name} (${theme}) is not a percentage: ${v}`)
  return Number(m[1]) / 100
}

// ── assertion bookkeeping ────────────────────────────────────────────────────
interface Row {
  group: string
  theme: ThemeName
  what: string
  fg: string
  bg: string
  ratio: number
  min: number
}
const rows: Row[] = []
function check(group: string, theme: ThemeName, what: string, fg: string, bg: string, min: number) {
  rows.push({ group, theme, what, fg, bg, ratio: contrast(fg, bg), min })
}
const themes: ThemeName[] = ['dark', 'light']

// ── 0. teamColor.ts agrees with index.css ────────────────────────────────────
const drift: string[] = []
for (const t of themes) {
  if (THEME_BASE[t].surface.toUpperCase() !== hex(t, 'surface').toUpperCase()) drift.push(`${t} surface`)
  if (THEME_BASE[t].canvas.toUpperCase() !== hex(t, 'canvas').toUpperCase()) drift.push(`${t} canvas`)
}

// ── 1. neutrals and tones ────────────────────────────────────────────────────
for (const t of themes) {
  const surface = hex(t, 'surface')
  const surface2 = hex(t, 'surface-2')
  for (const ink of ['ink', 'ink-2', 'muted', 'faint']) {
    check('text', t, `${ink} on surface`, hex(t, ink), surface, 4.5)
    check('text', t, `${ink} on surface-2`, hex(t, ink), surface2, 4.5)
  }
  check('text', t, 'line-strong on surface (control border)', hex(t, 'line-strong'), surface, 3)
  check('text', t, 'on-slab on slab', hex(t, 'on-slab'), hex(t, 'slab'), 4.5)
  check('text', t, 'focus on canvas', hex(t, 'focus'), hex(t, 'canvas'), 3)
  check('text', t, 'on-accent on win', hex(t, 'on-accent'), hex(t, 'win'), 4.5)
  check('text', t, 'on-accent on gold', hex(t, 'on-accent'), hex(t, 'gold'), 4.5)

  const soft = pct(t, 'soft-pct')
  for (const tone of ['brand', 'win', 'loss', 'warn', 'gold']) {
    const c = hex(t, tone)
    check('tone', t, `${tone} on surface`, c, surface, 4.5)
    check('tone', t, `${tone} on ${tone}-soft/surface`, c, over(c, soft, surface), 4.5)
    check('tone', t, `${tone} on ${tone}-soft/surface-2`, c, over(c, soft, surface2), 4.5)
  }

  // ── 2. rating tiers ────────────────────────────────────────────────────────
  const on = hex(t, 'tier-on')
  for (const tier of ['elite', 'pro', 'starter', 'rotation']) check('tier', t, `${tier}: tier-on on fill`, on, hex(t, `tier-${tier}`), 4.5)
  check('tier', t, 'depth: ink-2 number on surface', hex(t, 'ink-2'), surface, 4.5)
  check('tier', t, 'depth: outline on surface', hex(t, 'tier-depth'), surface, 3)
  const weak = hex(t, 'tier-weak')
  const liab = hex(t, 'tier-liab')
  const weakWash = pct(t, 'tier-weak-wash-pct')
  check('tier', t, `weak: number on ${weakWash * 100}% wash/surface`, weak, over(weak, weakWash, surface), 4.5)
  check('tier', t, `weak: number on ${weakWash * 100}% wash/surface-2`, weak, over(weak, weakWash, surface2), 4.5)
  check('tier', t, 'liability: number on 10% wash/surface', liab, over(liab, 0.1, surface), 4.5)
  check('tier', t, 'liability: number on 10% wash/surface-2', liab, over(liab, 0.1, surface2), 4.5)
  check('tier', t, 'weak: outline on surface', weak, surface, 3)
  check('tier', t, 'liability: outline on surface', liab, surface, 3)
}

// ── 3. team tokens, 32 clubs × 2 themes ──────────────────────────────────────
const lifted: Record<ThemeName, string[]> = { dark: [], light: [] }
const mixed: Record<ThemeName, string[]> = { dark: [], light: [] }
const fromSecondary: Record<ThemeName, string[]> = { dark: [], light: [] }
const tintInfo: { theme: ThemeName; abbr: string; ratio: number }[] = []
for (const t of themes) {
  const surface = hex(t, 'surface')
  const tintPct = pct(t, 'team-tint-pct')
  for (const team of NFL_TEAMS) {
    const tok = teamTokens(team.primary, team.secondary, t)
    check('team', t, `${team.abbr} accent ${tok.accent.color} (${tok.accent.source})`, tok.accent.color, surface, ACCENT_MIN)
    check('team', t, `${team.abbr} accent-text ${tok.accentText.color} (${tok.accentText.source})`, tok.accentText.color, surface, ACCENT_TEXT_MIN)
    check('team', t, `${team.abbr} team-on on fill`, tok.on, tok.fill, 3)
    check('team', t, `${team.abbr} accent-on on accent`, tok.accentOn, tok.accent.color, 4.5)
    if (tok.lift) lifted[t].push(team.abbr)
    if (tok.accent.source === 'mixed' || tok.accentText.source === 'mixed') {
      mixed[t].push(`${team.abbr}${tok.accent.source === 'mixed' ? '' : ' (text only)'}`)
    }
    if (tok.accent.source === 'secondary') fromSecondary[t].push(team.abbr)
    // Info only: legacy text-[var(--team)] on bg-[var(--team-soft)].
    tintInfo.push({ theme: t, abbr: team.abbr, ratio: contrast(tok.accent.color, over(tok.accent.color, tintPct, surface)) })
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const fails = rows.filter((r) => r.ratio < r.min)
const fmt = (r: Row) =>
  `${r.ratio < r.min ? 'FAIL' : 'ok  '} ${r.theme.padEnd(5)} ${r.ratio.toFixed(2).padStart(5)}:1 (≥${r.min})  ${r.what}  [${r.fg} on ${r.bg}]`

console.log(`check-contrast: ${rows.length} pairs, ${fails.length} failing\n`)
for (const g of ['text', 'tone', 'tier', 'team']) {
  const gr = rows.filter((r) => r.group === g)
  const gf = gr.filter((r) => r.ratio < r.min)
  const minRow = gr.reduce((a, b) => (b.ratio / b.min < a.ratio / a.min ? b : a))
  console.log(`${g.padEnd(5)} ${String(gr.length).padStart(3)} pairs, ${gf.length} fail; tightest: ${minRow.what} (${minRow.theme}) ${minRow.ratio.toFixed(2)}:1`)
}
for (const t of themes) {
  console.log(`\n[${t}] dark-slab lift (fill <1.5:1 on canvas): ${lifted[t].join(', ') || '—'}`)
  console.log(`[${t}] accent mixed to pass: ${mixed[t].join(', ') || '—'}`)
  console.log(`[${t}] accent from secondary: ${fromSecondary[t].join(', ') || '—'}`)
  const lowTint = tintInfo.filter((x) => x.theme === t && x.ratio < 4.5).map((x) => `${x.abbr} ${x.ratio.toFixed(2)}`)
  console.log(`[${t}] info: legacy var(--team) text on var(--team-soft) below 4.5:1 (≥3 guaranteed by accent): ${lowTint.length}`)
}
if (verbose) {
  console.log('\nAll pairs:')
  for (const r of rows) console.log(fmt(r))
}
if (args.has('--baseline')) {
  const old: Record<ThemeName, string> = { dark: '#111A2B', light: '#FFFFFF' }
  console.log('\nPre-F1 baseline: raw primary as --team foreground on the old surfaces (≥3:1):')
  for (const t of themes) {
    const bad = NFL_TEAMS.map((tm) => ({ abbr: tm.abbr, primary: tm.primary, r: contrast(tm.primary, old[t]) })).filter((x) => x.r < 3)
    console.log(`  ${t} (${old[t]}): ${bad.length}/32 fail — ${bad.map((x) => `${x.abbr} ${x.r.toFixed(2)}`).join(', ')}`)
  }
}
if (drift.length) console.log(`\nFAIL teamColor.ts THEME_BASE drifted from index.css: ${drift.join(', ')}`)
if (fails.length) {
  console.log('\nFailures:')
  for (const r of fails) console.log(fmt(r))
}
if (fails.length || drift.length) process.exitCode = 1
else console.log('\nPASS')
