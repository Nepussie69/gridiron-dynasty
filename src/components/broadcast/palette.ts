// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B2): field and stadium art colours.
//
// The field is broadcast art, not app chrome: it stays grass-and-floodlight in
// both app themes, so its constants are fixed (each line carries a
// check-hex-allow marker). Club colours come from the team's brand hexes and
// are made legible with the contrast helpers in lib/teamColor.ts, so every
// club's end zone and midfield logo read in either theme.
//
// Only imports teamColor.ts (import-free) so node scripts can load it.
// ─────────────────────────────────────────────────────────────────────────────
import { bestInk, contrast, INK_DARK, INK_LIGHT, luminance, mixHex, parseHex, toHex } from '../../lib/teamColor.ts'

/** Fixed field / stadium art. */
export const ART = {
  stripeA: '#3F8A42', // check-hex-allow: turf stripe
  stripeB: '#377C3A', // check-hex-allow: turf stripe
  apron: '#2D6631', // check-hex-allow: turf apron outside the lines
  paint: '#F4F4EE', // check-hex-allow: field paint (lines, numbers)
  paintSoft: 'rgba(244,244,238,.92)', // field paint at the hashes
  pylon: '#FF7A1A', // check-hex-allow: pylon orange
  goalpost: '#FFD21F', // check-hex-allow: goalpost yellow
  wall: '#0B0F16', // check-hex-allow: stadium wall / LED housing
  skyTop: '#04060A', // check-hex-allow: night sky above the bowl
  skyMid: '#0D1522', // check-hex-allow: bowl haze
  skyLow: '#101A14', // check-hex-allow: field glow
  crowdTop: '#06080D', // check-hex-allow: crowd shadow rows
  crowdLow: '#141B28', // check-hex-allow: crowd lit rows
  skin: '#C9A389', // check-hex-allow: crowd faces
  shirtDark: '#0B0B0D', // check-hex-allow: crowd neutral shirt
  shirtGrey: '#5A6070', // check-hex-allow: crowd neutral shirt
  shirtLight: '#D8D8D8', // check-hex-allow: crowd neutral shirt
  los: 'rgba(74,141,255,A)', // line of scrimmage blue (A = alpha)
  fdGlow: 'rgba(255,210,31,A)', // first-down glow
  fdLine: 'rgba(255,214,40,A)', // first-down line
  turfGraphicBg: 'rgba(9,13,20,.78)', // on-field down & distance plate
  turfGraphicBar: '#FFD21F', // check-hex-allow: down & distance accent bar
  black: '#000000', // check-hex-allow: shading mix target
  white: '#FFFFFF', // check-hex-allow: lighting mix target
} as const

/** rgba template with its alpha filled in. */
export function withAlpha(tpl: string, a: number): string {
  return tpl.replace('A', String(Math.max(0, Math.min(1, a)).toFixed(3)))
}

export interface ClubLike {
  id: string
  abbr: string
  city: string
  name: string
  primary: string
  secondary: string
}

export interface ClubArt {
  /** End-zone paint. */
  endZone: string
  /** Wordmark fill and outline on the end zone. */
  wordFill: string
  wordStroke: string
  /** Midfield logo disc, ring and lettering. */
  logoFill: string
  logoRing: string
  logoText: string
  /** LED ribbon gradient (dark → brand → dark) and its text / separator ink. */
  ledDark: string
  ledMid: string
  ledText: string
  ledMark: string
  /** Crowd shirt colours weighted toward the club. */
  crowd: string[]
}

const norm = (hex: string, fallback: string) => {
  const p = parseHex(hex)
  return p ? toHex(p) : fallback
}

/** Large-text minimum the wordmark must reach against its end zone. */
export const WORDMARK_MIN = 3

/** Contrast-checked field art for one club (theme-independent). */
export function clubArt(club: ClubLike): ClubArt {
  const p = norm(club.primary, '#1F62D6') // check-hex-allow: fallback club colour
  const s = norm(club.secondary, INK_DARK)
  // Painted turf reads a touch darker than the brand slab.
  const endZone = mixHex(p, ART.black, 0.1)
  // Wordmark: white if it carries, else the secondary if it's strong, else dark ink.
  let wordFill: string = INK_LIGHT
  if (contrast(INK_LIGHT, endZone) < WORDMARK_MIN) {
    wordFill = contrast(s, endZone) >= 4.5 ? s : bestInk(endZone)
  }
  const opposite = wordFill === INK_LIGHT ? INK_DARK : INK_LIGHT
  // Outline in the secondary when it separates from the fill, else the opposite ink.
  const wordStroke = s !== wordFill && contrast(s, wordFill) >= 2.5 ? s : opposite
  const logoFill = p
  const logoRing = contrast(s, p) >= 2 ? s : bestInk(p)
  const logoText = bestInk(p)
  // LED boards glow: keep very dark clubs visible by lifting them a little.
  const lift = luminance(p) < 0.02 ? 0.18 : 0
  const ledMid = mixHex(p, ART.white, lift)
  const ledDark = mixHex(p, ART.black, 0.78)
  const ledText = contrast(INK_LIGHT, ledMid) >= 3 ? INK_LIGHT : bestInk(ledMid)
  const ledMark = contrast(s, ledMid) >= 2 ? mixHex(s, ART.white, 0.1) : mixHex(ledMid, ART.white, 0.5)
  const crowd = [p, p, p, mixHex(p, ART.black, 0.35), s, s, ART.shirtDark, ART.shirtGrey, ART.shirtLight]
  return { endZone, wordFill, wordStroke, logoFill, logoRing, logoText, ledDark, ledMid, ledText, ledMark, crowd }
}

/** Generic club for unknown ids. */
export const NEUTRAL_CLUB: ClubLike = {
  id: '?',
  abbr: 'GD',
  city: 'Gridiron',
  name: 'Dynasty',
  primary: '#1F62D6', // check-hex-allow: neutral club fallback
  secondary: '#0B1220', // check-hex-allow: neutral club fallback
}
