// IndexedDB persistence with schema versioning, a rolling backup slot, and
// defensive loading. The world is large (thousands of players), so localStorage
// would overflow — IndexedDB handles multi-MB saves comfortably.
//
// Hardening rules:
//   · Every write is tagged with a schema version and timestamp.
//   · The previous primary save is rotated into a backup slot on each write, so
//     a corrupted write can be recovered on the next load.
//   · Loading never throws and never trusts the payload shape — the store
//     validates it and falls back to the backup or a clean start.

const DB_NAME = 'gridiron-dynasty'
const STORE = 'save'
const KEY = 'career'
const BACKUP_KEY = 'career_backup'

/** Bump when the save payload shape changes in a non-additive way. */
export const SAVE_SCHEMA_VERSION = 2

export interface SaveEnvelope<T = unknown> {
  schemaVersion: number
  savedAt: number
  data: T
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await openDb()
    const value = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
      tx.oncomplete = () => db.close()
    })
    return value
  } catch {
    return null
  }
}

export async function saveGame(data: unknown): Promise<void> {
  try {
    // Rotate the current primary into the backup before overwriting it.
    const prior = await withStore<SaveEnvelope>('readonly', (s) => s.get(KEY) as IDBRequest<SaveEnvelope>)
    if (prior) await withStore('readwrite', (s) => s.put(prior, BACKUP_KEY) as IDBRequest<unknown>)
    const envelope: SaveEnvelope = { schemaVersion: SAVE_SCHEMA_VERSION, savedAt: Date.now(), data }
    await withStore('readwrite', (s) => s.put(envelope, KEY) as IDBRequest<unknown>)
  } catch {
    // Persistence is best-effort; never block gameplay on it.
  }
}

function unwrap<T>(envelope: SaveEnvelope<T> | null | undefined): { data: T; savedAt: number; schemaVersion: number } | null {
  if (!envelope || typeof envelope !== 'object') return null
  if (!('data' in envelope)) {
    // Legacy save written before versioning: the payload was the data itself.
    return { data: envelope as unknown as T, savedAt: 0, schemaVersion: 0 }
  }
  return { data: envelope.data, savedAt: envelope.savedAt ?? 0, schemaVersion: envelope.schemaVersion ?? 0 }
}

export async function loadGame<T>(): Promise<{ data: T; savedAt: number; schemaVersion: number } | null> {
  const envelope = await withStore<SaveEnvelope<T>>('readonly', (s) => s.get(KEY) as IDBRequest<SaveEnvelope<T>>)
  return unwrap(envelope)
}

export async function loadBackup<T>(): Promise<{ data: T; savedAt: number; schemaVersion: number } | null> {
  const envelope = await withStore<SaveEnvelope<T>>('readonly', (s) => s.get(BACKUP_KEY) as IDBRequest<SaveEnvelope<T>>)
  return unwrap(envelope)
}

export async function clearSave(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY) as IDBRequest<unknown>)
  await withStore('readwrite', (s) => s.delete(BACKUP_KEY) as IDBRequest<unknown>)
}
