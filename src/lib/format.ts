export function money(n: number, opts: { sign?: boolean } = {}) {
  const sign = opts.sign && n > 0 ? '+' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${n < 0 ? '-' : ''}$${Math.round(abs / 1_000)}K`
  return `${sign}${n < 0 ? '-' : ''}$${abs}`
}

export function num(n: number) {
  return n.toLocaleString('en-US')
}

/** Contrast-aware text color for a given hex background. */
export function inkOn(hex: string) {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#0a1626' : '#ffffff'
}

/** Light tint of a hex color, for soft team backgrounds. */
export function tint(hex: string, amount = 0.88) {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  const mix = (v: number) => Math.round(v + (255 - v) * amount)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

export function gradeColor(v: number) {
  if (v >= 90) return '#05914f'
  if (v >= 82) return '#3aa35a'
  if (v >= 74) return '#0b62ff'
  if (v >= 66) return '#d98207'
  return '#dc2937'
}
