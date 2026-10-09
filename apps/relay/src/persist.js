import * as Y from 'yjs'

/**
 * Persistence of one room (a Yjs document) in the Durable Object's own storage.
 *
 * Layout (only these keys are touched):
 *   er:meta   { chunks, bytes, savedAt, lastActive }
 *   er:c:<i>  Uint8Array chunk i of the encoded document state
 *
 * Chunks keep every value far below the storage value-size limit, and `lastActive` drives the
 * "delete rooms nobody used for N days" rule.
 */
const CHUNK_BYTES = 64 * 1024
const MAX_KEYS_PER_CALL = 100 // storage.put / storage.delete accept at most 128 keys at once
export const META_KEY = 'er:meta'
export const chunkKey = (i) => `er:c:${i}`

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

const batches = (entries) => {
  const out = []
  for (let i = 0; i < entries.length; i += MAX_KEYS_PER_CALL) out.push(entries.slice(i, i + MAX_KEYS_PER_CALL))
  return out
}

/** @returns {Promise<{ doc: Y.Doc, meta: object } | null>} null when nothing (or a damaged copy) is stored */
export async function loadDocument(storage) {
  const meta = await storage.get(META_KEY)
  if (!meta || !(meta.chunks > 0)) return null
  const parts = []
  for (let i = 0; i < meta.chunks; i++) {
    const part = await storage.get(chunkKey(i))
    if (!part) return null // incomplete write: better an empty room than a corrupt one
    parts.push(part)
  }
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, concat(parts))
  } catch {
    return null
  }
  return { doc, meta }
}

/** A room nobody has written anything to (e.g. someone just opened a random link). */
export function isEmptyRoom(doc) {
  return doc.getText('code').length === 0 && doc.getMap('positions').size === 0
}

/** Writes the full state of `doc`. Removes chunks left over from a previously larger state. */
export async function saveDocument(storage, doc, now = Date.now()) {
  const update = Y.encodeStateAsUpdate(doc)
  const previous = await storage.get(META_KEY)
  const chunks = Math.max(1, Math.ceil(update.byteLength / CHUNK_BYTES))
  const entries = []
  for (let i = 0; i < chunks; i++) entries.push([chunkKey(i), update.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)])
  // chunks first, meta last: a crash in between leaves the previous (complete) meta pointing at valid-or-missing chunks,
  // and loadDocument() treats a missing chunk as "nothing stored"
  for (const batch of batches(entries)) await storage.put(Object.fromEntries(batch))
  await storage.put(META_KEY, { chunks, bytes: update.byteLength, savedAt: now, lastActive: now })
  if (previous?.chunks > chunks) {
    const stale = []
    for (let i = chunks; i < previous.chunks; i++) stale.push(chunkKey(i))
    for (const batch of batches(stale)) await storage.delete(batch)
  }
  return { chunks, bytes: update.byteLength }
}

/** Marks the room as used now (no-op when nothing is stored yet). */
export async function touch(storage, now = Date.now()) {
  const meta = await storage.get(META_KEY)
  if (meta) await storage.put(META_KEY, { ...meta, lastActive: now })
}

export async function hasStoredRoom(storage) {
  return Boolean(await storage.get(META_KEY))
}

export async function deleteStoredRoom(storage) {
  const meta = await storage.get(META_KEY)
  if (!meta) return false
  const keys = [META_KEY]
  for (let i = 0; i < meta.chunks; i++) keys.push(chunkKey(i))
  for (const batch of batches(keys)) await storage.delete(batch)
  return true
}

/** Deletes the stored room when it has not been used for `ttlMs`. @returns {Promise<boolean>} true when deleted */
export async function expireIfStale(storage, ttlMs, now = Date.now()) {
  const meta = await storage.get(META_KEY)
  if (!meta) return false
  if (now - (meta.lastActive ?? meta.savedAt ?? 0) <= ttlMs) return false
  await deleteStoredRoom(storage)
  return true
}
