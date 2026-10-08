// ─────────────────────────────────────────────────────────────────────────────
// The standard route tree, as data (L12.10 B1).
//
// Every route a receiver can run, in the offence frame: the offence's own goal
// line is at x = 10 and it attacks toward x = 110; y runs 0..53.3 across the
// field. `depth` is the route's characteristic air depth (used to pick which
// route the target should run on a throw). `wps` builds the waypoints up to time
// T: `inw` is +1 toward the middle of the field, `out` the opposite, and `side`
// is a seeded lateral direction for flats / crossers.
//
// The animation reads this table directly, so adding a route here is all it
// takes to make it available (L12.10 B4). The names are plain football
// terminology; no proprietary play names.
// ─────────────────────────────────────────────────────────────────────────────

export interface WP {
  t: number
  x: number
  y: number
  easeIn?: boolean
  easeOut?: boolean
  lock?: boolean
}

export interface RouteDef {
  depth: number
  wps: (y: number, L: number, T: number, inw: number, out: number, side: number) => WP[]
}

/** Move one route waypoint over time. */
const wp = (t: number, x: number, y: number): WP => ({ t, x, y })

export const ROUTES: Record<string, RouteDef> = {
  // ── short / quick game ──────────────────────────────────────────────────────
  flat: { depth: 1, wps: (y, L, T, _inw, _out, side) => [wp(0.14, L - 5, y), wp(0.3, L - 1, y + side * 4), wp(T, L + 2, y + side * 7)] },
  quickOut: { depth: 4, wps: (y, L, T, _inw, out) => [wp(0.16, L + 3, y), wp(T, L + 4.5, y + out * 4)] },
  out: { depth: 6, wps: (y, L, T, _inw, out) => [wp(0.14, L + 3, y), wp(0.36, L + 8, y), wp(T, L + 8, y + out * 7)] },
  slant: { depth: 5, wps: (y, L, T, inw) => [wp(0.12, L + 1.5, y), wp(T, L + 5, y + inw * 4.5)] },
  quickSlant: { depth: 5, wps: (y, L, T, inw) => [wp(0.12, L + 1.5, y), wp(T, L + 5, y + inw * 4.5)] },
  stick: { depth: 5, wps: (y, L, T, inw) => [wp(0.14, L + 5, y), wp(T, L + 5.5, y + inw * 1.5)] },
  sit: { depth: 4, wps: (y, L, T, inw) => [wp(0.14, L + 4, y), wp(T, L + 4.5, y + inw * 1.5)] },
  check: { depth: 3, wps: (y, L, T, inw) => [wp(0.14, L - 5, y), wp(0.32, L - 2, y), wp(T, L + 3, y + inw * 2)] },
  bubble: { depth: 2, wps: (y, L, T, _inw, out) => [wp(0.11, L + 0.5, y), wp(0.26, L + 0.4, y + out * 3.5), wp(T, L + 2.5, y + out * 5)] },
  screen: { depth: 1, wps: (y, L, T, _inw, _out, side) => [wp(0.12, L + 0.5, y), wp(0.3, L - 1, y + side * 1.5), wp(T, L - 2, y + side * 5)] },
  swing: { depth: 1, wps: (y, L, T, _inw, _out, side) => [wp(0.12, L - 7, y), wp(0.3, L - 6, y + side * 6), wp(T, L - 3, y + side * 8)] },
  angle: { depth: 3, wps: (y, L, T, inw) => [wp(0.12, L - 5, y), wp(0.3, L - 3, y + inw * 2), wp(T, L + 4, y + inw * 5)] },
  whip: { depth: 5, wps: (y, L, T, inw) => [wp(0.13, L + 1.5, y + inw * 1), wp(0.32, L + 4, y + inw * 3), wp(T, L + 3.5, y - inw * 4)] },
  // ── intermediate ────────────────────────────────────────────────────────────
  hitch: { depth: 5, wps: (y, L, T, inw) => [wp(0.14, L + 2, y), wp(0.34, L + 6, y), wp(T, L + 5.5, y + inw * 1.5)] },
  curl: { depth: 12, wps: (y, L, T, inw) => [wp(0.14, L + 3, y), wp(0.4, L + 12, y), wp(T, L + 11, y + inw * 1.5)] },
  dig: { depth: 12, wps: (y, L, T, inw) => [wp(0.14, L + 3, y), wp(0.38, L + 12, y), wp(T, L + 15, y + inw * 9)] },
  in: { depth: 12, wps: (y, L, T, inw) => [wp(0.14, L + 3, y), wp(0.38, L + 12, y), wp(T, L + 15, y + inw * 9)] },
  glance: { depth: 8, wps: (y, L, T, inw) => [wp(0.13, L + 2, y), wp(0.34, L + 5, y), wp(T, L + 9, y + inw * 4)] },
  cross: { depth: 14, wps: (y, L, T, inw) => [wp(0.14, L + 2, y), wp(0.34, L + 9, y), wp(T, L + 15, y - inw * 17)] },
  shallow: { depth: 6, wps: (y, L, T, _inw, _out, side) => [wp(0.13, L + 1, y), wp(0.34, L + 4, y), wp(T, L + 6, y + side * 12)] },
  drag: { depth: 6, wps: (y, L, T, _inw, _out, side) => [wp(0.14, L + 1, y), wp(0.34, L + 4, y), wp(T, L + 6, y + side * 12)] },
  meshIn: { depth: 5, wps: (y, L, T, inw) => [wp(0.13, L + 2, y), wp(T, L + 5, y - inw * 9)] },
  comeback: { depth: 13, wps: (y, L, T, inw) => [wp(0.14, L + 3, y), wp(0.42, L + 14, y), wp(T, L + 11, y + inw * 2)] },
  // ── deep ────────────────────────────────────────────────────────────────────
  corner: { depth: 18, wps: (y, L, T, _inw, out) => [wp(0.14, L + 3, y), wp(0.4, L + 12, y), wp(T, L + 24, y + out * 9)] },
  post: { depth: 25, wps: (y, L, T, inw) => [wp(0.14, L + 3, y), wp(0.4, L + 14, y), wp(T, L + 30, y + inw * 9)] },
  seam: { depth: 22, wps: (y, L, T, inw) => [wp(0.14, L + 4, y), wp(0.42, L + 16, y + inw * 1.5), wp(T, L + 25, y + inw * 2.5)] },
  over: { depth: 28, wps: (y, L, T, inw) => [wp(0.14, L + 3, y), wp(0.42, L + 17, y), wp(T, L + 31, y + inw * 10)] },
  go: { depth: 30, wps: (y, L, T, _inw, out) => [wp(0.14, L + 4, y), wp(0.42, L + 18, y + out * 1.5), wp(T, L + 34, y + out * 3)] },
  fade: { depth: 30, wps: (y, L, T, _inw, out) => [wp(0.14, L + 4, y + out * 1.5), wp(0.42, L + 17, y + out * 4), wp(T, L + 32, y + out * 5)] },
  wheel: { depth: 22, wps: (y, L, T, _inw, _out, side) => [wp(0.12, L - 6, y), wp(0.32, L + 1, y + side * 6), wp(T, L + 16, y + side * 9)] },
  chair: { depth: 26, wps: (y, L, T, inw) => [wp(0.14, L + 3, y), wp(0.38, L + 13, y + inw * 4), wp(T, L + 30, y - inw * 18)] },
  postCorner: { depth: 22, wps: (y, L, T, inw, out) => [wp(0.14, L + 3, y), wp(0.38, L + 13, y + inw * 6), wp(T, L + 26, y + out * 6)] },
  outUp: { depth: 20, wps: (y, L, T, _inw, out) => [wp(0.14, L + 3, y), wp(0.32, L + 8, y), wp(0.42, L + 9, y + out * 6), wp(T, L + 24, y + out * 2)] },
  sluggo: { depth: 28, wps: (y, L, T, inw, out) => [wp(0.12, L + 1.5, y), wp(0.3, L + 5, y + inw * 5), wp(0.45, L + 9, y + inw * 7), wp(T, L + 30, y + out * 3)] },
  // ── backfield / blocking ────────────────────────────────────────────────────
  stalk: { depth: 0, wps: (y, L, T, _inw, out) => [wp(0.16, L + 2, y), wp(T, L + 6, y + out * 0.5)] },
  runFake: { depth: 0, wps: (y, L, T, _inw, _out, side) => [wp(0.14, L - 4, y + side * 3), wp(0.3, L + 0.5, y + side * 5), wp(T, L + 0.5, y + side * 5)] },
  block: { depth: 0, wps: (y, L, T, inw) => [wp(0.14, L - 4, y), wp(T, L - 0.5, y + inw * 2)] },
  passBlock: { depth: 0, wps: (y, L, T, inw) => [wp(0.14, L - 3, y), wp(T, L - 1.5, y + inw * 1)] },
}

/** Canonical alias → route key, so authored concepts can use plain names. */
export const ROUTE_ALIAS: Record<string, string> = {
  'Quick Slant': 'slant',
  Slant: 'slant',
  'Quick Out': 'quickOut',
  Out: 'out',
  Flat: 'flat',
  Hitch: 'hitch',
  Curl: 'curl',
  Comeback: 'comeback',
  Dig: 'dig',
  In: 'in',
  Corner: 'corner',
  Post: 'post',
  Go: 'go',
  Fade: 'fade',
  Seam: 'seam',
  Wheel: 'wheel',
  Drag: 'drag',
  'Shallow Cross': 'shallow',
  Whip: 'whip',
  Angle: 'angle',
  Sit: 'sit',
  Stick: 'stick',
  Swing: 'swing',
  Bubble: 'bubble',
  Screen: 'screen',
  'Post-Corner': 'postCorner',
  'Out and Up': 'outUp',
  Sluggo: 'sluggo',
  Chair: 'chair',
}

/** Resolve a route name (alias or key) to a key in ROUTES. */
export function routeKey(name: string): string {
  if (ROUTES[name]) return name
  return ROUTE_ALIAS[name] ?? 'check'
}
