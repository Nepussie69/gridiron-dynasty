// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B7): the view settings store.
//
// Four localStorage-only keys (never a save field, never the sim):
//   gd.view.game     'auto' | 'broadcast' | 'topdown'   (default 'auto')
//   gd.view.replays  'big' | 'all' | 'off' | 'custom'   (default 'big')
//   gd.view.drawings 'every' | 'replays' | 'off'        (default 'every')
//   gd.view.quality  'auto' | 'full' | 'lite'           (default 'auto')
//   gd.view.autoQ    JSON of the last Auto measurement
//   gd.view.qbCone   'off' | 'on'  (unset: on in both views)
//   gd.view.replayTypes  JSON array of reason ids for 'custom' (default: all)
//   gd.view.cameraAngle  'fixed' | 'dynamic'            (default 'fixed', backlog 357)
//
// Every read and write is wrapped in try/catch; a missing OR corrupt value
// falls back to its default and never throws. A tiny external store
// (subscribe / getSnapshot) plus the 'storage' event keeps two tabs agreed, so
// useViewSettings() can ride useSyncExternalStore.
// ─────────────────────────────────────────────────────────────────────────────
import { useSyncExternalStore } from 'react'
import { DEFAULT_REPLAY_TYPES, REPLAY_REASON_IDS, type DrawingsMode, type ReplayReasonId } from './replay'

export type GameView = 'auto' | 'broadcast' | 'topdown'
export type ReplayMode = 'big' | 'all' | 'off' | 'custom'
export type QualitySetting = 'auto' | 'full' | 'lite'
export type QualityLevel = 'full' | 'lite'
/** Backlog 357: 'fixed' holds one broadcast angle (pan + zoom only); 'dynamic' = the re-angling director. */
export type CameraAngleSetting = 'fixed' | 'dynamic'

/** The last Auto-quality measurement, keyed to the device it was taken on. */
export interface AutoQState {
  result: QualityLevel
  /** p95 draw cost (ms) the decision was made from. */
  p95: number
  /** Counted frames at the decision. */
  frames: number
  /** `${screen.width}x${devicePixelRatio}` of the device measured. */
  key: string
  /** ISO timestamp. */
  at: string
}

export interface ViewSettings {
  game: GameView
  replays: ReplayMode
  /** 'custom' replays: which reasons (gd.view.replayTypes). Default: every reason. */
  replayTypes: ReplayReasonId[]
  /** Telestrations on live plays (gd.view.drawings). Default: every play. */
  drawings: DrawingsMode
  quality: QualitySetting
  autoQ: AutoQState | null
  cameraAngle: CameraAngleSetting
  /** QB vision cone + placement circle: null = the per-view default (off in 2.5D, on top-down). */
  qbCone: 'off' | 'on' | null
}

export const VIEW_KEYS = {
  game: 'gd.view.game',
  replays: 'gd.view.replays',
  replayTypes: 'gd.view.replayTypes',
  drawings: 'gd.view.drawings',
  quality: 'gd.view.quality',
  autoQ: 'gd.view.autoQ',
  cameraAngle: 'gd.view.cameraAngle',
  qbCone: 'gd.view.qbCone',
} as const

export const DEFAULT_VIEW_SETTINGS: ViewSettings = Object.freeze({
  game: 'auto',
  replays: 'big',
  replayTypes: [...DEFAULT_REPLAY_TYPES],
  drawings: 'every',
  quality: 'auto',
  autoQ: null,
  cameraAngle: 'fixed',
  qbCone: null,
})

/** Phone breakpoint for the view: below 768 CSS px the live view defaults top-down. */
export const VIEW_PHONE_MAX = '(max-width: 767.98px)'
export const VIEW_PHONE_PX = 768

export function isPhoneWidth(w: number): boolean {
  return w < VIEW_PHONE_PX
}

/** `screen.width` × DPR, e.g. "390x3". Empty when the environment has neither. */
export function deviceKey(): string {
  try {
    const w = typeof screen !== 'undefined' ? screen.width : typeof window !== 'undefined' ? window.innerWidth : 0
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    return `${w}x${dpr}`
  } catch {
    return ''
  }
}

// ── storage helpers (never throw) ────────────────────────────────────────────

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

function readRaw(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string | null): void {
  try {
    const s = storage()
    if (!s) return
    if (value == null) s.removeItem(key)
    else s.setItem(key, value)
  } catch {
    /* storage unavailable / quota — settings simply do not persist */
  }
}

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v != null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/**
 * The 'custom' replay reason ids (gd.view.replayTypes). A missing, non-array or
 * unknown value falls back to every reason; an explicit empty array is kept
 * (the user unchecked everything → nothing replays).
 */
function readReplayTypes(): ReplayReasonId[] {
  const raw = readRaw(VIEW_KEYS.replayTypes)
  if (!raw) return [...DEFAULT_REPLAY_TYPES]
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return [...DEFAULT_REPLAY_TYPES]
    const known = new Set<string>(REPLAY_REASON_IDS)
    if (!v.every((x) => typeof x === 'string' && known.has(x))) return [...DEFAULT_REPLAY_TYPES]
    const out: ReplayReasonId[] = []
    for (const x of v as ReplayReasonId[]) if (!out.includes(x)) out.push(x)
    return out
  } catch {
    return [...DEFAULT_REPLAY_TYPES]
  }
}

function readAutoQ(): AutoQState | null {
  const raw = readRaw(VIEW_KEYS.autoQ)
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const result = o.result === 'lite' ? 'lite' : o.result === 'full' ? 'full' : null
    if (!result) return null
    return {
      result,
      p95: typeof o.p95 === 'number' && Number.isFinite(o.p95) ? o.p95 : 0,
      frames: typeof o.frames === 'number' && Number.isFinite(o.frames) ? o.frames : 0,
      key: typeof o.key === 'string' ? o.key : '',
      at: typeof o.at === 'string' ? o.at : '',
    }
  } catch {
    return null
  }
}

function readAll(): ViewSettings {
  return {
    game: pick(readRaw(VIEW_KEYS.game), ['auto', 'broadcast', 'topdown'] as const, 'auto'),
    replays: pick(readRaw(VIEW_KEYS.replays), ['big', 'all', 'off', 'custom'] as const, 'big'),
    replayTypes: readReplayTypes(),
    drawings: pick(readRaw(VIEW_KEYS.drawings), ['every', 'replays', 'off'] as const, 'every'),
    quality: pick(readRaw(VIEW_KEYS.quality), ['auto', 'full', 'lite'] as const, 'auto'),
    autoQ: readAutoQ(),
    cameraAngle: pick(readRaw(VIEW_KEYS.cameraAngle), ['fixed', 'dynamic'] as const, 'fixed'),
    qbCone: (() => { const r = readRaw(VIEW_KEYS.qbCone); return r === 'on' || r === 'off' ? r : null })(),
  }
}

// ── external store ───────────────────────────────────────────────────────────

let snapshot: ViewSettings | null = null
const listeners = new Set<() => void>()

export function getViewSettings(): ViewSettings {
  if (!snapshot) snapshot = readAll()
  return snapshot
}

function refresh(): void {
  snapshot = readAll()
  for (const l of listeners) l()
}

export function subscribeViewSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

// Two tabs agree: another tab's write fires 'storage' here.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.startsWith('gd.view.')) refresh()
  })
}

export function setGameView(v: GameView): void {
  writeRaw(VIEW_KEYS.game, v)
  refresh()
}

export function setReplayMode(v: ReplayMode): void {
  writeRaw(VIEW_KEYS.replays, v)
  refresh()
}

/** The Drawings setting: telestrations on every play / replay-only / off. */
export function setDrawings(v: DrawingsMode): void {
  writeRaw(VIEW_KEYS.drawings, v)
  refresh()
}

/** Persist the 'custom' replay reason ids (unknown ids are dropped, order kept). */
export function setReplayTypes(v: readonly ReplayReasonId[]): void {
  const known = new Set<string>(REPLAY_REASON_IDS)
  const out = v.filter((x, i) => known.has(x) && v.indexOf(x) === i)
  writeRaw(VIEW_KEYS.replayTypes, JSON.stringify(out))
  refresh()
}

export function setQualitySetting(v: QualitySetting): void {
  writeRaw(VIEW_KEYS.quality, v)
  refresh()
}

export function setCameraAngle(v: CameraAngleSetting): void {
  writeRaw(VIEW_KEYS.cameraAngle, v)
  refresh()
}

/** Persist the QB-cone toggle (null clears it back to the per-view default). */
export function setQbCone(v: 'off' | 'on' | null): void {
  writeRaw(VIEW_KEYS.qbCone, v)
  refresh()
}

/** The QB cone's per-view default (user 2026-10-12: on in 2.5D too). */
const QB_CONE_DEFAULT: Record<'broadcast' | 'topdown', boolean> = { broadcast: true, topdown: true }

/** Is the QB cone drawn in this view? Default: on in both the 2.5D broadcast and top-down. */
export function qbConeOn(s: Pick<ViewSettings, 'qbCone'>, view: 'broadcast' | 'topdown'): boolean {
  return s.qbCone ? s.qbCone === 'on' : QB_CONE_DEFAULT[view]
}

export function setAutoQState(a: AutoQState | null): void {
  writeRaw(VIEW_KEYS.autoQ, a ? JSON.stringify(a) : null)
  refresh()
}

/** The resolved settings, reactive (useSyncExternalStore). */
export function useViewSettings(): ViewSettings {
  return useSyncExternalStore(subscribeViewSettings, getViewSettings, () => DEFAULT_VIEW_SETTINGS)
}

/**
 * True below 768 CSS px, live: matchMedia fires on resize / rotation, so the
 * answer re-resolves without a reload.
 */
export function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      const mq = window.matchMedia(VIEW_PHONE_MAX)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(VIEW_PHONE_MAX).matches : false),
    () => false,
  )
}

/** Non-hook read for callers outside render (probes / composers). */
export function isPhoneNow(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(VIEW_PHONE_MAX).matches
  } catch {
    return false
  }
}
