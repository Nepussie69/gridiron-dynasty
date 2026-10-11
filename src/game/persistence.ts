// IndexedDB persistence with multiple career save slots.
//
// The world is large (thousands of players), so localStorage would overflow —
// IndexedDB handles multi-MB saves comfortably. Every career lives in its own
// slot; each slot keeps a rolling backup and a tiny metadata record so the
// save picker can render without reading the multi-MB payloads.
//
// Hardening rules:
//   · Writes resolve on transaction COMMIT, never on request success.
//   · Primary rotation and the metadata write happen in ONE transaction, so a
//     crash can never leave a slot's primary and backup out of step.
//   · All mutations are serialised through an in-process queue; every save
//     captures its target slot (and a per-slot epoch) up front so a late or
//     queued write can never land in a slot the user has since switched away
//     from — and a delete can never be undone by a queued write.
//   · Loading never throws and never trusts the payload shape; callers
//     validate and fall back to that slot's own backup.
//   · Legacy single-save data (`career` + `career_backup`) migrates once into
//     the first free slot, idempotently, without overwriting anything.

export const SAVE_SCHEMA_VERSION = 2

/** How many career slots the picker offers. */
export const SLOT_COUNT = 5
/** The slot numbers, in display order. */
export const SLOT_IDS: number[] = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1)

const DEFAULT_DB_NAME = 'gridiron-dynasty'
const STORE = 'save'

// Legacy single-career keys (pre-slots).
const LEGACY_KEY = 'career'
const LEGACY_BACKUP_KEY = 'career_backup'

// Slot keys.
const ACTIVE_KEY = 'active_slot'
const MIGRATION_KEY = 'migration_v1_done'
// A scratch key used by the dev round-trip probes so they never touch a real
// user slot (or the legacy migration source).
const PROBE_KEY = '__probe__'

const slotKey = (n: number) => `slot:${n}`
const slotBackupKey = (n: number) => `slot:${n}:backup`
const slotMetaKey = (n: number) => `slot:${n}:meta`

export type PersistenceErrorCode =
  | 'unavailable'
  | 'quota'
  | 'transaction'
  | 'validation'
  | 'notfound'
  | 'occupied'
  | 'migrated'
  | 'unknown'

/** A failure the UI can explain honestly instead of pretending a save worked. */
export class PersistenceError extends Error {
  code: PersistenceErrorCode
  constructor(code: PersistenceErrorCode, message: string) {
    super(message)
    this.name = 'PersistenceError'
    this.code = code
  }
}

export interface SaveEnvelope<T = unknown> {
  schemaVersion: number
  savedAt: number
  data: T
  /** Optional human label; travels with an export so a career keeps its name. */
  label?: string
}

/** The small per-slot record the picker reads. Never holds the world payload. */
export interface SlotMeta {
  schema: 1
  label: string
  managerName: string
  roleTitle: string
  teamName: string
  season: number
  week: number
  tier: string
  savedAt: number
  /** Set when this slot was last loaded from its backup after a bad primary. */
  recoveredAt?: number
}

/** One row of the save picker. */
export interface SlotView {
  slot: number
  occupied: boolean
  meta: SlotMeta | null
}

export interface SlotSummaryPatch {
  managerName?: string
  roleTitle?: string
  teamName?: string
  season?: number
  week?: number
  tier?: string
}

export interface SaveSlotOptions {
  /** Set/replace the slot label. Omit to keep an existing label untouched. */
  label?: string
  /** Refresh the small metadata record (never touches the label). */
  summary?: SlotSummaryPatch
  /** Make this the active slot in the shared pointer. */
  setActive?: boolean
  /**
   * Only write if the slot is empty (primary, backup and metadata all absent),
   * checked INSIDE the write transaction. Rejects with code `occupied`
   * otherwise. This is the authoritative protection for "start a new career" —
   * even two tabs racing cannot both claim the same slot.
   */
  createOnly?: boolean
  /**
   * Overwrite the primary WITHOUT rotating the old primary into the backup.
   * Used for the first save after a slot was recovered from its backup, so a
   * damaged primary is never rotated onto the healthy backup.
   */
  noRotate?: boolean
}

export interface UnwrappedSave<T = unknown> {
  data: T
  savedAt: number
  schemaVersion: number
  label?: string
}

// ── database plumbing ────────────────────────────────────────────────────────

let dbName = DEFAULT_DB_NAME

/**
 * Point persistence at a different IndexedDB name. Used by isolated tests so
 * they never read or write a real player's save database. Production callers
 * never invoke this.
 */
export function configurePersistence(opts: { dbName?: string }): void {
  if (opts.dbName) {
    if (opts.dbName !== dbName) dbCache.delete(dbName)
    dbName = opts.dbName
  }
}

function idbFactory(): IDBFactory {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (!factory) throw new PersistenceError('unavailable', 'Saves are unavailable in this browser.')
  return factory
}

/**
 * Whether durable storage exists in this environment. Node-side dev probes and
 * calibration runs have no IndexedDB; callers use this to skip persistence
 * entirely rather than treating "no storage" as a failed save.
 */
export function persistenceAvailable(): boolean {
  return !!(globalThis as { indexedDB?: IDBFactory }).indexedDB
}

function mapError(e: unknown): PersistenceError {
  if (e instanceof PersistenceError) return e
  const name = (e as { name?: string } | null)?.name ?? ''
  if (name === 'QuotaExceededError') {
    return new PersistenceError('quota', 'Not enough browser storage to save. Free some space and try again.')
  }
  if (name === 'VersionError' || name === 'InvalidStateError') {
    return new PersistenceError('unavailable', 'The save database is unavailable right now. Try again.')
  }
  return new PersistenceError('transaction', 'The save could not be written. Your previous save is untouched.')
}

const dbCache = new Map<string, Promise<IDBDatabase>>()

function openDb(name = dbName): Promise<IDBDatabase> {
  const cached = dbCache.get(name)
  if (cached) return cached
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = idbFactory().open(name, 1)
    } catch (e) {
      reject(mapError(e))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => {
      const db = req.result
      // A newer tab upgrading the schema must not be blocked by this one.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(mapError(req.error))
    req.onblocked = () =>
      reject(new PersistenceError('unavailable', 'Another tab has the save database open. Close it and try again.'))
  })
  dbCache.set(name, promise)
  promise.catch(() => dbCache.delete(name))
  return promise
}

/** Run a read across several keys; resolves once the transaction commits. */
function txReadAll(keys: string[]): Promise<Map<string, unknown>> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(STORE, 'readonly')
        } catch (e) {
          reject(mapError(e))
          return
        }
        const out = new Map<string, unknown>()
        tx.oncomplete = () => resolve(out)
        tx.onerror = () => reject(mapError(tx.error))
        tx.onabort = () => reject(mapError(tx.error))
        const store = tx.objectStore(STORE)
        for (const key of keys) {
          const req = store.get(key)
          req.onsuccess = () => {
            if (req.result !== undefined) out.set(key, req.result)
          }
        }
      })
      .catch(reject)
  })
}

/** Controls a write from inside a (possibly async) request handler. */
interface WriteControl {
  /** Abort the transaction and reject with `e` (mapped through `mapError`). */
  fail: (e: unknown) => void
}

/**
 * Run a write task. `task` issues its requests synchronously and may chain
 * further requests from an `onsuccess` handler (still inside the transaction).
 * Resolves only on COMMIT; rejects on error/abort. A guard inside a request
 * handler can call `ctl.fail(e)` to abort the whole transaction — used by the
 * `createOnly` claim, whose occupancy check must be atomic.
 */
function runWrite(task: (store: IDBObjectStore, ctl: WriteControl) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(STORE, 'readwrite')
        } catch (e) {
          reject(mapError(e))
          return
        }
        let settled = false
        const ctl: WriteControl = {
          fail: (e: unknown) => {
            if (settled) return
            settled = true
            try {
              tx.abort()
            } catch {
              /* transaction already gone */
            }
            reject(mapError(e))
          },
        }
        tx.oncomplete = () => {
          if (settled) return
          settled = true
          resolve()
        }
        tx.onerror = () => ctl.fail(tx.error)
        tx.onabort = () => ctl.fail(tx.error ?? new PersistenceError('transaction', 'The save could not be written.'))
        try {
          task(tx.objectStore(STORE), ctl)
        } catch (e) {
          ctl.fail(e)
        }
      })
      .catch(reject)
  })
}

// ── serialisation queue + per-slot epochs ────────────────────────────────────

let queue: Promise<unknown> = Promise.resolve()

/** Chain a mutation so writes never interleave (and thus never cross-write). */
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const next = queue.then(op, op)
  queue = next.catch(() => undefined)
  return next
}

/** Awaited before switching careers so an in-flight autosave has committed. */
export function flushPersistence(): Promise<void> {
  return queue.then(
    () => undefined,
    () => undefined,
  )
}

const slotEpoch = new Map<number, number>()

function bumpEpoch(slot: number): void {
  slotEpoch.set(slot, (slotEpoch.get(slot) ?? 0) + 1)
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function isValidSlot(slot: unknown): slot is number {
  return typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT
}

function assertSlot(slot: number): void {
  if (!isValidSlot(slot)) throw new PersistenceError('validation', `Slot ${String(slot)} is not a valid save slot.`)
}

/** Unwrap a stored/exported payload; supports the pre-envelope legacy shape. */
function unwrapEnvelope<T>(envelope: unknown): UnwrappedSave<T> | null {
  if (!envelope || typeof envelope !== 'object') return null
  const e = envelope as SaveEnvelope<T> & { data?: unknown }
  if (!('data' in e)) {
    // Legacy save written before versioning: the payload was the data itself.
    return { data: envelope as T, savedAt: 0, schemaVersion: 0 }
  }
  return {
    data: e.data as T,
    savedAt: typeof e.savedAt === 'number' ? e.savedAt : 0,
    schemaVersion: typeof e.schemaVersion === 'number' ? e.schemaVersion : 0,
    ...(typeof e.label === 'string' && e.label ? { label: e.label } : {}),
  }
}

function normalizeMeta(raw: unknown, fallbackLabel: string): SlotMeta {
  const o = raw && typeof raw === 'object' ? (raw as Partial<SlotMeta>) : {}
  return {
    schema: 1,
    label: typeof o.label === 'string' && o.label.trim() ? o.label : fallbackLabel,
    managerName: typeof o.managerName === 'string' ? o.managerName : '',
    roleTitle: typeof o.roleTitle === 'string' ? o.roleTitle : '',
    teamName: typeof o.teamName === 'string' ? o.teamName : '',
    season: typeof o.season === 'number' ? o.season : 0,
    week: typeof o.week === 'number' ? o.week : 0,
    tier: typeof o.tier === 'string' ? o.tier : '',
    savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
    ...(typeof o.recoveredAt === 'number' ? { recoveredAt: o.recoveredAt } : {}),
  }
}

/** A label the user can read and edit; blank/whitespace falls back. */
export function cleanLabel(label: string, fallback: string): string {
  const trimmed = (label ?? '').replace(/\s+/g, ' ').trim()
  return (trimmed || fallback).slice(0, 28)
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Every slot row (occupied flag + small metadata) in one readonly read. */
export async function readSlots(): Promise<SlotView[]> {
  const keys: string[] = []
  for (const n of SLOT_IDS) keys.push(slotKey(n), slotBackupKey(n), slotMetaKey(n))
  const values = await txReadAll(keys)
  return SLOT_IDS.map((slot) => {
    const raw = values.get(slotMetaKey(slot))
    // A slot counts as occupied if ANY payload survives — a primary, a backup,
    // or even just its metadata — so a damaged/backup-only slot is never
    // presented as empty and can never be silently overwritten.
    const occupied = values.has(slotKey(slot)) || values.has(slotBackupKey(slot)) || raw !== undefined
    return {
      slot,
      occupied,
      meta: raw === undefined ? null : normalizeMeta(raw, `Slot ${slot}`),
    }
  })
}

export async function readSlotMeta(slot: number): Promise<SlotMeta | null> {
  assertSlot(slot)
  const values = await txReadAll([slotMetaKey(slot)])
  const raw = values.get(slotMetaKey(slot))
  return raw === undefined ? null : normalizeMeta(raw, `Slot ${slot}`)
}

export async function getActiveSlot(): Promise<number | null> {
  const values = await txReadAll([ACTIVE_KEY])
  const raw = values.get(ACTIVE_KEY)
  return isValidSlot(raw) ? raw : null
}

export type SlotPayloadState = 'ok' | 'missing' | 'corrupt' | 'future'

export interface SlotLoad<T> {
  payload: T | null
  savedAt: number
  schemaVersion: number
  label?: string
  usedBackup: boolean
  primaryState: SlotPayloadState
  backupState: SlotPayloadState
}

function stateOf(unwrapped: UnwrappedSave | null, present: boolean, valid: boolean): SlotPayloadState {
  if (!present) return 'missing'
  if (!unwrapped) return 'corrupt'
  if (unwrapped.schemaVersion > SAVE_SCHEMA_VERSION) return 'future'
  return valid ? 'ok' : 'corrupt'
}

/**
 * Load a slot, validating both the primary and its backup through the caller's
 * validator before trusting either. Never clears anything — a corrupt slot is
 * reported, not wiped.
 */
export async function loadSlot<T>(
  slot: number,
  validate: (data: T) => boolean,
): Promise<SlotLoad<T>> {
  assertSlot(slot)
  const values = await txReadAll([slotKey(slot), slotBackupKey(slot)])
  const rawPrimary = values.get(slotKey(slot))
  const rawBackup = values.get(slotBackupKey(slot))
  const primary = rawPrimary === undefined ? null : unwrapEnvelope<T>(rawPrimary)
  const backup = rawBackup === undefined ? null : unwrapEnvelope<T>(rawBackup)
  const primaryState = stateOf(primary, rawPrimary !== undefined, !!primary && validate(primary.data))
  const backupState = stateOf(backup, rawBackup !== undefined, !!backup && validate(backup.data))
  if (primaryState === 'ok' && primary) {
    return {
      payload: primary.data,
      savedAt: primary.savedAt,
      schemaVersion: primary.schemaVersion,
      ...(primary.label ? { label: primary.label } : {}),
      usedBackup: false,
      primaryState,
      backupState,
    }
  }
  if (backupState === 'ok' && backup) {
    return {
      payload: backup.data,
      savedAt: backup.savedAt,
      schemaVersion: backup.schemaVersion,
      ...(backup.label ? { label: backup.label } : {}),
      usedBackup: true,
      primaryState,
      backupState,
    }
  }
  return { payload: null, savedAt: 0, schemaVersion: 0, usedBackup: false, primaryState, backupState }
}

// ── writes ───────────────────────────────────────────────────────────────────

/**
 * Save `data` to `slot`. The prior primary rotates into the slot's backup and
 * the metadata refreshes, all in one committed transaction. Captures the slot
 * epoch so a queued write to a deleted slot is dropped rather than resurrecting
 * it.
 */
export async function saveSlot<T>(slot: number, data: T, opts: SaveSlotOptions = {}): Promise<void> {
  assertSlot(slot)
  const savedAt = Date.now()
  const label = opts.label === undefined ? undefined : cleanLabel(opts.label, `Slot ${slot}`)
  const envelope: SaveEnvelope<T> = { schemaVersion: SAVE_SCHEMA_VERSION, savedAt, data }
  if (label !== undefined) envelope.label = label
  const captured = slotEpoch.get(slot) ?? 0
  const patch = opts.summary ?? {}
  return enqueue(async () => {
    if ((slotEpoch.get(slot) ?? 0) !== captured) return // slot deleted while queued
    await runWrite((store, ctl) => {
      const pk = slotKey(slot)
      const bk = slotBackupKey(slot)
      const mk = slotMetaKey(slot)
      const applyMeta = (rawMeta: unknown, existingPrimary: unknown) => {
        const meta = normalizeMeta(rawMeta, `Slot ${slot}`)
        if (label !== undefined) meta.label = label
        if (patch.managerName !== undefined) meta.managerName = patch.managerName
        if (patch.roleTitle !== undefined) meta.roleTitle = patch.roleTitle
        if (patch.teamName !== undefined) meta.teamName = patch.teamName
        if (patch.season !== undefined) meta.season = patch.season
        if (patch.week !== undefined) meta.week = patch.week
        if (patch.tier !== undefined) meta.tier = patch.tier
        meta.savedAt = savedAt
        delete meta.recoveredAt // a fresh, healthy save clears the recovery flag
        store.put(meta, mk)
        // createOnly backfills a healthy rolling backup with the first payload.
        if (existingPrimary !== undefined && !opts.noRotate) store.put(existingPrimary, bk)
        else if (existingPrimary === undefined) store.put(envelope, bk)
        store.put(envelope, pk)
        if (opts.setActive) store.put(slot, ACTIVE_KEY)
      }
      const getPrimary = store.get(pk)
      getPrimary.onsuccess = () => {
        const existingPrimary = getPrimary.result
        if (opts.createOnly && existingPrimary !== undefined) {
          ctl.fail(new PersistenceError('occupied', `Slot ${slot} already holds a career.`))
          return
        }
        if (opts.createOnly) {
          // Reserve atomically: primary, backup AND metadata must all be empty.
          const getBackup = store.get(bk)
          getBackup.onsuccess = () => {
            if (getBackup.result !== undefined) {
              ctl.fail(new PersistenceError('occupied', `Slot ${slot} already holds a career.`))
              return
            }
            const getMeta = store.get(mk)
            getMeta.onsuccess = () => {
              if (getMeta.result !== undefined) {
                ctl.fail(new PersistenceError('occupied', `Slot ${slot} already holds a career.`))
                return
              }
              applyMeta(undefined, undefined)
            }
          }
          return
        }
        const getMeta = store.get(mk)
        getMeta.onsuccess = () => applyMeta(getMeta.result, existingPrimary)
      }
    })
  })
}

/** Rename a slot's label without touching its payload. */
export async function renameSlot(slot: number, label: string): Promise<SlotMeta> {
  assertSlot(slot)
  const clean = cleanLabel(label, `Slot ${slot}`)
  return enqueue(async () => {
    const values = await txReadAll([slotMetaKey(slot)])
    const raw = values.get(slotMetaKey(slot))
    if (raw === undefined) throw new PersistenceError('notfound', 'That save slot is empty.')
    const meta = normalizeMeta(raw, `Slot ${slot}`)
    meta.label = clean
    await runWrite((store) => {
      store.put(meta, slotMetaKey(slot))
    })
    return meta
  })
}

/** Flag a slot as recovered so the picker can show its recovery status. */
export async function markSlotRecovered(slot: number): Promise<void> {
  assertSlot(slot)
  return enqueue(async () => {
    await runWrite((store) => {
      const getMeta = store.get(slotMetaKey(slot))
      getMeta.onsuccess = () => {
        if (getMeta.result === undefined) return
        const meta = normalizeMeta(getMeta.result, `Slot ${slot}`)
        meta.recoveredAt = Date.now()
        store.put(meta, slotMetaKey(slot))
      }
    })
  })
}

/**
 * Delete exactly one slot (primary + backup + metadata). Bumps the slot epoch
 * first, so any queued save for it is dropped and cannot resurrect it.
 */
export async function deleteSlot(slot: number): Promise<void> {
  assertSlot(slot)
  bumpEpoch(slot)
  return enqueue(async () => {
    await runWrite((store) => {
      const getActive = store.get(ACTIVE_KEY)
      getActive.onsuccess = () => {
        store.delete(slotKey(slot))
        store.delete(slotBackupKey(slot))
        store.delete(slotMetaKey(slot))
        if (getActive.result === slot) store.delete(ACTIVE_KEY)
      }
    })
  })
}

/** Move the shared active-slot pointer (null clears it). */
export async function setActiveSlot(slot: number | null): Promise<void> {
  if (slot !== null) assertSlot(slot)
  return enqueue(async () => {
    await runWrite((store) => {
      if (slot === null) store.delete(ACTIVE_KEY)
      else store.put(slot, ACTIVE_KEY)
    })
  })
}

// ── export / import ──────────────────────────────────────────────────────────

/** Serialise one slot to the JSON an export downloads. */
export async function exportSlot(slot: number): Promise<string | null> {
  assertSlot(slot)
  const values = await txReadAll([slotKey(slot), slotMetaKey(slot)])
  const stored = values.get(slotKey(slot))
  if (stored === undefined) return null
  const rawMeta = values.get(slotMetaKey(slot))
  const label = rawMeta === undefined ? undefined : normalizeMeta(rawMeta, `Slot ${slot}`).label
  const base: Record<string, unknown> =
    stored && typeof stored === 'object' && 'data' in (stored as object)
      ? { ...(stored as Record<string, unknown>) }
      : { schemaVersion: SAVE_SCHEMA_VERSION, savedAt: 0, data: stored }
  if (label) base.label = label
  return JSON.stringify(base)
}

export interface ParsedImport {
  data: unknown
  schemaVersion: number
  savedAt: number
  label?: string
}

/** Parse + structurally validate an imported file. Never writes. Throws. */
export function parseImport(json: string): ParsedImport {
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    throw new PersistenceError('validation', 'That file is not a valid save.')
  }
  const unwrapped = unwrapEnvelope(obj)
  if (!unwrapped) throw new PersistenceError('validation', 'That file is not a valid save.')
  if (unwrapped.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new PersistenceError(
      'validation',
      `That save was made by a newer version of the game (format ${unwrapped.schemaVersion}). Update the game to load it.`,
    )
  }
  return {
    data: unwrapped.data,
    schemaVersion: unwrapped.schemaVersion,
    savedAt: unwrapped.savedAt,
    ...(unwrapped.label ? { label: unwrapped.label } : {}),
  }
}

// ── legacy migration ─────────────────────────────────────────────────────────

export interface LegacyMigrationResult {
  ran: boolean
  migrated: boolean
  slot: number | null
  error: string | null
  /** True when legacy data exists but is in a format this build must not touch. */
  unsupported?: boolean
}

/** Durable record of a completed migration (target slot + whether source is preserved). */
interface MigrationMarker {
  v: 1
  done: true
  target: number
  preserveSource: boolean
}

function readMarker(raw: unknown): MigrationMarker | null {
  if (raw === true) return { v: 1, done: true, target: 0, preserveSource: false }
  if (raw && typeof raw === 'object' && (raw as MigrationMarker).done === true) {
    const m = raw as MigrationMarker
    return {
      v: 1,
      done: true,
      target: typeof m.target === 'number' ? m.target : 0,
      preserveSource: m.preserveSource === true,
    }
  }
  return null
}

/** True when a stored/legacy envelope was written by a NEWER game schema. */
function isFuture(u: UnwrappedSave | null): boolean {
  return !!u && u.schemaVersion > SAVE_SCHEMA_VERSION
}

export interface MigrateLegacyOptions<T = unknown> {
  /** Structural validation; only validated payloads are copied into a slot. */
  validate?: (data: T) => boolean
}

/**
 * Move a pre-slots career (`career` + `career_backup`) into the first free
 * slot, exactly once, without ever destroying data it cannot safely migrate.
 *
 *  · The chosen slot's occupancy check and the copy (primary + backup +
 *    metadata + the completion marker) happen in ONE committed transaction, so
 *    a crash can neither duplicate the career nor half-claim a slot. Two tabs
 *    racing for the same free slot are serialised by IndexedDB and the loser
 *    retries the next free slot.
 *  · The legacy source keys are only removed after that transaction commits,
 *    and only when every present source envelope was actually migrated. A
 *    corrupt primary or a backup-only source is preserved in place.
 *  · A legacy envelope from a NEWER schema is never re-enveloped as this
 *    build's format: migration is refused, nothing is written or deleted, and
 *    the caller is told the data is unsupported.
 */
export async function migrateLegacy<T>(
  summarize: (data: unknown, savedAt: number, label: string) => SlotMeta,
  options: MigrateLegacyOptions<T> = {},
): Promise<LegacyMigrationResult> {
  const readKeys = [MIGRATION_KEY, LEGACY_KEY, LEGACY_BACKUP_KEY]
  for (const n of SLOT_IDS) readKeys.push(slotKey(n), slotBackupKey(n), slotMetaKey(n))
  const values = await txReadAll(readKeys)
  const marker = readMarker(values.get(MIGRATION_KEY))
  const legacyPrimary = values.get(LEGACY_KEY)
  const legacyBackup = values.get(LEGACY_BACKUP_KEY)

  if (marker) {
    // A crash between the copy commit and clearing the source: finish the job,
    // but never delete a preserved/source we deliberately kept or a future one.
    if (legacyPrimary !== undefined || legacyBackup !== undefined) {
      const primary = legacyPrimary === undefined ? null : unwrapEnvelope<T>(legacyPrimary)
      const backup = legacyBackup === undefined ? null : unwrapEnvelope<T>(legacyBackup)
      if (!marker.preserveSource && !isFuture(primary) && !isFuture(backup)) {
        await runWrite((store) => {
          store.delete(LEGACY_KEY)
          store.delete(LEGACY_BACKUP_KEY)
        })
      }
    }
    return { ran: false, migrated: false, slot: marker.target || null, error: null }
  }

  const primary = legacyPrimary === undefined ? null : unwrapEnvelope<T>(legacyPrimary)
  const backup = legacyBackup === undefined ? null : unwrapEnvelope<T>(legacyBackup)

  if (!primary && !backup) {
    await writeMarker(0, false)
    return { ran: true, migrated: false, slot: null, error: null }
  }

  // Never relabel or accept a newer-format envelope: leave both in place.
  if (isFuture(primary) || isFuture(backup)) {
    return {
      ran: true,
      migrated: false,
      slot: null,
      error: 'Your existing save was made by a newer version of the game. It was left untouched — update the game to load it.',
      unsupported: true,
    }
  }

  const valid = options.validate ?? (() => true)
  const primaryUsable = !!primary && valid(primary.data as T)
  const backupUsable = !!backup && valid(backup.data as T)
  // Anything present that we cannot migrate (corrupt/invalid) must be preserved.
  const preserveSource = (!!primary && !primaryUsable) || (!!backup && !backupUsable)

  if (!primaryUsable && !backupUsable) {
    // Nothing usable: keep the source exactly as it is and stop retrying.
    await writeMarker(0, true)
    return {
      ran: true,
      migrated: false,
      slot: null,
      error: 'Your existing save could not be read, so it was left in place. Delete a save slot and reload to try again.',
    }
  }

  const primaryTarget = primaryUsable ? primary! : backup!
  const backupTarget = backupUsable ? backup! : null
  const source = primaryTarget
  const savedAt = source.savedAt || backupTarget?.savedAt || Date.now()
  const label = cleanLabel(source.label ?? '', `Slot ${SLOT_IDS[0]}`)
  const meta = summarize(primaryTarget.data, savedAt, label)
  meta.label = label

  const candidates = SLOT_IDS.filter((n) => !values.has(slotKey(n)) && !values.has(slotBackupKey(n)) && !values.has(slotMetaKey(n)))
  if (!candidates.length) {
    return {
      ran: true,
      migrated: false,
      slot: null,
      error: 'Every save slot is full, so your existing career could not be moved. Delete a slot and reload to finish the upgrade.',
    }
  }

  for (const candidate of candidates) {
    try {
      await claimMigratedSlot(candidate, primaryTarget, backupTarget, meta, preserveSource)
      if (!preserveSource) {
        await runWrite((store) => {
          store.delete(LEGACY_KEY)
          store.delete(LEGACY_BACKUP_KEY)
        })
      }
      return {
        ran: true,
        migrated: true,
        slot: candidate,
        error: preserveSource
          ? `Part of your existing save was unreadable and was left in place; the readable data was moved to slot ${candidate}.`
          : null,
      }
    } catch (e) {
      // Another tab claimed this slot first — try the next free one.
      if (e instanceof PersistenceError && e.code === 'occupied') continue
      // Another tab completed the whole migration while we were choosing.
      if (e instanceof PersistenceError && e.code === 'migrated') {
        return { ran: false, migrated: false, slot: readMarker((await txReadAll([MIGRATION_KEY])).get(MIGRATION_KEY))?.target || null, error: null }
      }
      throw e
    }
  }
  return {
    ran: true,
    migrated: false,
    slot: null,
    error: 'Every save slot is full, so your existing career could not be moved. Delete a slot and reload to finish the upgrade.',
  }
}

/** Persist the completion marker on its own (used when there is nothing to copy). */
async function writeMarker(target: number, preserveSource: boolean): Promise<void> {
  const marker: MigrationMarker = { v: 1, done: true, target, preserveSource }
  return enqueue(async () => {
    await runWrite((store) => {
      store.put(marker, MIGRATION_KEY)
    })
  })
}

/**
 * Atomically claim `slot` for migrated data: verify it is empty, then write the
 * primary payload, the backup payload (if any), the metadata and the completion
 * marker in one transaction. Rejects with code `occupied` if another tab won.
 */
async function claimMigratedSlot(
  slot: number,
  primary: UnwrappedSave,
  backup: UnwrappedSave | null,
  meta: SlotMeta,
  preserveSource: boolean,
): Promise<void> {
  const primaryEnvelope: SaveEnvelope = { schemaVersion: SAVE_SCHEMA_VERSION, savedAt: primary.savedAt, data: primary.data, ...(primary.label ? { label: primary.label } : {}) }
  const backupEnvelope: SaveEnvelope = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: (backup ?? primary).savedAt,
    data: (backup ?? primary).data,
    ...((backup ?? primary).label ? { label: (backup ?? primary).label! } : {}),
  }
  const marker: MigrationMarker = { v: 1, done: true, target: slot, preserveSource }
  return enqueue(async () => {
    await runWrite((store, ctl) => {
      const pk = slotKey(slot)
      const bk = slotBackupKey(slot)
      const mk = slotMetaKey(slot)
      const getPrimary = store.get(pk)
      getPrimary.onsuccess = () => {
        if (getPrimary.result !== undefined) {
          ctl.fail(new PersistenceError('occupied', `Slot ${slot} already holds a career.`))
          return
        }
        const getBackup = store.get(bk)
        getBackup.onsuccess = () => {
          if (getBackup.result !== undefined) {
            ctl.fail(new PersistenceError('occupied', `Slot ${slot} already holds a career.`))
            return
          }
          const getMeta = store.get(mk)
          getMeta.onsuccess = () => {
            if (getMeta.result !== undefined) {
              ctl.fail(new PersistenceError('occupied', `Slot ${slot} already holds a career.`))
              return
            }
            // Cross-tab guard: if another tab completed the migration first, stop.
            const getMarker = store.get(MIGRATION_KEY)
            getMarker.onsuccess = () => {
              if (getMarker.result !== undefined) {
                ctl.fail(new PersistenceError('migrated', 'The legacy save was already migrated by another tab.'))
                return
              }
              store.put(primaryEnvelope, pk)
              store.put(backupEnvelope, bk)
              store.put(meta, mk)
              store.put(marker, MIGRATION_KEY)
            }
          }
        }
      }
    })
  })
}

// ── dev round-trip probe shims (isolated scratch key) ────────────────────────

/**
 * The dev round-trip probes used to write the live save key. They now write a
 * scratch key so running a probe can never overwrite a real career slot (or be
 * mistaken for legacy data to migrate).
 */
export async function saveGame(data: unknown): Promise<void> {
  const envelope: SaveEnvelope = { schemaVersion: SAVE_SCHEMA_VERSION, savedAt: Date.now(), data }
  try {
    await enqueue(async () => {
      await runWrite((store) => {
        store.put(envelope, PROBE_KEY)
      })
    })
  } catch {
    // Best-effort, exactly like the pre-slots probe helper.
  }
}

export async function loadGame<T>(): Promise<{ data: T; savedAt: number; schemaVersion: number } | null> {
  try {
    const values = await txReadAll([PROBE_KEY])
    const raw = values.get(PROBE_KEY)
    const unwrapped = raw === undefined ? null : unwrapEnvelope<T>(raw)
    if (!unwrapped) return null
    return { data: unwrapped.data, savedAt: unwrapped.savedAt, schemaVersion: unwrapped.schemaVersion }
  } catch {
    return null
  }
}

export async function loadBackup<T>(): Promise<{ data: T; savedAt: number; schemaVersion: number } | null> {
  try {
    const values = await txReadAll([PROBE_KEY + ':backup'])
    const raw = values.get(PROBE_KEY + ':backup')
    const unwrapped = raw === undefined ? null : unwrapEnvelope<T>(raw)
    if (!unwrapped) return null
    return { data: unwrapped.data, savedAt: unwrapped.savedAt, schemaVersion: unwrapped.schemaVersion }
  } catch {
    return null
  }
}

/** Compatibility shim: clear only the probe scratch key, never a real slot. */
export async function clearSave(): Promise<void> {
  try {
    await enqueue(async () => {
      await runWrite((store) => {
        store.delete(PROBE_KEY)
        store.delete(PROBE_KEY + ':backup')
      })
    })
  } catch {
    /* nothing to clear */
  }
}

/** Compatibility export of the probe scratch save. */
export async function exportSave(): Promise<string | null> {
  try {
    const values = await txReadAll([PROBE_KEY])
    const raw = values.get(PROBE_KEY)
    return raw === undefined ? null : JSON.stringify(raw)
  } catch {
    return null
  }
}

/** Compatibility import into the probe scratch key. */
export async function importSave<T>(json: string): Promise<T | null> {
  try {
    const parsed = parseImport(json)
    await saveGame(parsed.data)
    return parsed.data as T
  } catch {
    return null
  }
}
