// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B7): the view settings store.
//
// Four localStorage-only keys (never a save field, never the sim):
//   gd.view.game     'auto' | 'broadcast' | 'topdown'   (default 'auto')
//   gd.view.replays  'big' | 'all' | 'off' | 'custom'   (default 'big')
//   gd.view.quality  'auto' | 'full' | 'lite'           (default 'auto')
//   gd.view.autoQ    JSON of the last Auto measurement
//   gd.view.replayTypes  JSON array of reason ids for 'custom' (default: all)
//
// Every read and write is wrapped in try/catch; a missing OR corrupt value
// falls back to its default and never throws. A tiny external store
// (subscribe / getSnapshot) plus the 'storage' event keeps two tabs agreed, so
// useViewSettings() can ride useSyncExternalStore.
// ─────────────────────────────────────────────────────────────────────────────
import { useSyncExternalStore } from 'react'
import { DEFAULT_REPLAY_TYPES, REPLAY_REASON_IDS, type ReplayReasonId } from './replay'

export type GameView = 'auto' | 'broadcast' | 'topdown'
export type ReplayMode = 'big' | 'all' | 'off' | 'custom'
export type QualitySetting = 'auto' | 'full' | 'lite'
export type QualityLevel = 'full' | 'lite'

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
  quality: QualitySetting
  autoQ: AutoQState | null
}

export const VIEW_KEYS = {
  game: 'gd.view.game',
  replays: 'gd.view.replays',
  replayTypes: 'gd.view.replayTypes',
  quality: 'gd.view.quality',
  autoQ: 'gd.view.autoQ',
} as const

export const DEFAULT_VIEW_SETTINGS: ViewSettings = Object.freeze({
  game: 'auto',
  replays: 'big',
  replayTypes: [...DEFAULT_REPLAY_TYPES],
  quality: 'auto',
  autoQ: null,
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
    quality: pick(readRaw(VIEW_KEYS.quality), ['auto', 'full', 'lite'] as const, 'auto'),
    autoQ: readAutoQ(),
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
