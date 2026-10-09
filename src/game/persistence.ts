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

/**
 * Run a write task. `task` issues its requests synchronously and may chain
 * further requests from an `onsuccess` handler (still inside the transaction).
 * Resolves only on COMMIT; rejects on error/abort.
 */
function runWrite(task: (store: IDBObjectStore) => void): Promise<void> {
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
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(mapError(tx.error))
        tx.onabort = () => reject(mapError(tx.error))
        try {
          task(tx.objectStore(STORE))
        } catch (e) {
          try {
            tx.abort()
          } catch {
            /* transaction already gone */
          }
          reject(mapError(e))
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
  for (const n of SLOT_IDS) keys.push(slotKey(n), slotMetaKey(n))
  const values = await txReadAll(keys)
  return SLOT_IDS.map((slot) => {
    const raw = values.get(slotMetaKey(slot))
    return {
      slot,
      occupied: values.has(slotKey(slot)),
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
    await runWrite((store) => {
      const pk = slotKey(slot)
      const bk = slotBackupKey(slot)
      const mk = slotMetaKey(slot)
      const getPrimary = store.get(pk)
      getPrimary.onsuccess = () => {
        if (getPrimary.result !== undefined) store.put(getPrimary.result, bk)
        store.put(envelope, pk)
        const getMeta = store.get(mk)
        getMeta.onsuccess = () => {
          const meta = normalizeMeta(getMeta.result, `Slot ${slot}`)
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
          if (opts.setActive) store.put(slot, ACTIVE_KEY)
        }
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
}

/**
 * Move a pre-slots career (`career` + `career_backup`) into the first free
 * slot, exactly once. The primary AND backup are copied before the migration
 * flag is set; the legacy keys are only cleared after both copies commit. If
 * there is no free slot nothing is written and nothing is cleared, so the user
 * can free a slot and retry. Already-migrated data is never re-imported, so a
 * deleted migrated career cannot resurrect on reload.
 */
export async function migrateLegacy<T>(
  summarize: (data: unknown, savedAt: number, label: string) => SlotMeta,
): Promise<LegacyMigrationResult> {
  const slotKeys = SLOT_IDS.map((n) => slotKey(n))
  const values = await txReadAll([MIGRATION_KEY, LEGACY_KEY, LEGACY_BACKUP_KEY, ...slotKeys])
  const done = values.get(MIGRATION_KEY) === true
  const legacyPrimary = values.get(LEGACY_KEY)
  const legacyBackup = values.get(LEGACY_BACKUP_KEY)

  if (done) {
    // A crash between setting the flag and clearing the source: finish the job.
    if (legacyPrimary !== undefined || legacyBackup !== undefined) {
      await runWrite((store) => {
        store.delete(LEGACY_KEY)
        store.delete(LEGACY_BACKUP_KEY)
      })
    }
    return { ran: false, migrated: false, slot: null, error: null }
  }

  const primary = legacyPrimary === undefined ? null : unwrapEnvelope<T>(legacyPrimary)
  const backup = legacyBackup === undefined ? null : unwrapEnvelope<T>(legacyBackup)

  if (!primary && !backup) {
    await runWrite((store) => {
      store.put(true, MIGRATION_KEY)
    })
    return { ran: true, migrated: false, slot: null, error: null }
  }

  const free = SLOT_IDS.find((n) => !values.has(slotKey(n)))
  if (free === undefined) {
    return {
      ran: true,
      migrated: false,
      slot: null,
      error: 'Every save slot is full, so your existing career could not be moved. Delete a slot and reload to finish the upgrade.',
    }
  }

  const primaryData = primary?.data ?? backup?.data
  const source = primary ?? backup
  const savedAt = source?.savedAt ?? Date.now()
  const label = cleanLabel(source?.label ?? '', `Slot ${free}`)
  const meta = summarize(primaryData, savedAt, label)
  meta.label = label

  // Copy primary + backup first (each write commits), then mark done, then clear.
  await saveSlotPayload(free, 'primary', primaryData, savedAt)
  if (backup) await saveSlotPayload(free, 'backup', backup.data, backup.savedAt)
  await runWrite((store) => {
    store.put(meta, slotMetaKey(free))
    store.put(true, MIGRATION_KEY)
  })
  await runWrite((store) => {
    store.delete(LEGACY_KEY)
    store.delete(LEGACY_BACKUP_KEY)
  })
  return { ran: true, migrated: true, slot: free, error: null }
}

/** Low-level slot payload write used by the migration copy (no rotation). */
async function saveSlotPayload<T>(slot: number, target: 'primary' | 'backup', data: T, savedAt: number): Promise<void> {
  const envelope: SaveEnvelope<T> = { schemaVersion: SAVE_SCHEMA_VERSION, savedAt, data }
  return enqueue(async () => {
    await runWrite((store) => {
      store.put(envelope, target === 'primary' ? slotKey(slot) : slotBackupKey(slot))
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
