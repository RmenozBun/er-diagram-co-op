// Run with: node --test apps/relay/test   (no Cloudflare needed: storage is faked with a Map)
import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { chunkKey, deleteStoredRoom, expireIfStale, hasStoredRoom, isEmptyRoom, loadDocument, META_KEY, saveDocument, touch } from '../src/persist.js'

function fakeStorage() {
  const m = new Map()
  const norm = (v) => (v instanceof Uint8Array ? new Uint8Array(v) : structuredClone(v))
  return {
    m,
    puts: 0,
    async get(k) { return m.has(k) ? norm(m.get(k)) : undefined },
    async put(a, b) {
      if (typeof a === 'string') { m.set(a, norm(b)); this.puts++ }
      else { assert.ok(Object.keys(a).length <= 128, 'too many keys in one put'); for (const [k, v] of Object.entries(a)) m.set(k, norm(v)); this.puts++ }
    },
    async delete(k) { const ks = Array.isArray(k) ? k : [k]; assert.ok(ks.length <= 128); ks.forEach((x) => m.delete(x)); return ks.length },
  }
}
const docWith = (code, positions = {}) => {
  const d = new Y.Doc()
  d.getText('code').insert(0, code)
  for (const [k, v] of Object.entries(positions)) d.getMap('positions').set(k, v)
  return d
}

test('round trip of a small room', async () => {
  const s = fakeStorage()
  await saveDocument(s, docWith('Table a {\n  id int\n}\n', { a: { x: 1, y: 2 } }), 1000)
  const { doc, meta } = await loadDocument(s)
  assert.equal(doc.getText('code').toString(), 'Table a {\n  id int\n}\n')
  assert.deepEqual(doc.getMap('positions').toJSON(), { a: { x: 1, y: 2 } })
  assert.equal(meta.chunks, 1)
})

test('large rooms are split into chunks and survive a round trip (including Thai text)', async () => {
  const s = fakeStorage()
  const code = Array.from({ length: 6000 }, (_, i) => `Table ตาราง_${i} {\n  รหัส int [pk]\n}\n`).join('')
  await saveDocument(s, docWith(code))
  const meta = await s.get(META_KEY)
  assert.ok(meta.chunks > 3, `expected several chunks, got ${meta.chunks}`)
  for (let i = 0; i < meta.chunks; i++) assert.ok((await s.get(chunkKey(i))).byteLength <= 64 * 1024)
  assert.equal((await loadDocument(s)).doc.getText('code').toString(), code)
})

test('saving a smaller state removes chunks that are no longer needed', async () => {
  const s = fakeStorage()
  const big = docWith('x'.repeat(300 * 1024))
  await saveDocument(s, big)
  const before = (await s.get(META_KEY)).chunks
  assert.ok(before > 3)
  big.getText('code').delete(0, 300 * 1024)
  await saveDocument(s, big)
  // the Yjs state keeps tombstones, so it may stay a few chunks long, but stale keys beyond `chunks` must be gone
  const after = (await s.get(META_KEY)).chunks
  for (let i = after; i < before; i++) assert.equal(s.m.has(chunkKey(i)), false)
})

test('a missing chunk (interrupted write) is treated as "nothing stored"', async () => {
  const s = fakeStorage()
  await saveDocument(s, docWith('y'.repeat(200 * 1024)))
  s.m.delete(chunkKey(1))
  assert.equal(await loadDocument(s), null)
})

test('empty rooms are recognised', () => {
  assert.equal(isEmptyRoom(new Y.Doc()), true)
  assert.equal(isEmptyRoom(docWith('a')), false)
  assert.equal(isEmptyRoom(docWith('', { t: { x: 0, y: 0 } })), false)
})

test('rooms expire after the TTL of inactivity and "touch" keeps them alive', async () => {
  const DAY = 86400000
  const s = fakeStorage()
  await saveDocument(s, docWith('a'), 0)
  assert.equal(await expireIfStale(s, 15 * DAY, 10 * DAY), false)
  await touch(s, 12 * DAY) // someone opened the room on day 12
  assert.equal(await expireIfStale(s, 15 * DAY, 26 * DAY), false) // 14 days after the last visit
  assert.equal(await hasStoredRoom(s), true)
  assert.equal(await expireIfStale(s, 15 * DAY, 28 * DAY), true) // 16 days after the last visit
  assert.equal(await hasStoredRoom(s), false)
  assert.equal(s.m.size, 0, 'every key of the room is removed')
})

test('touch / expire on a room that was never stored do nothing', async () => {
  const s = fakeStorage()
  await touch(s, 5)
  assert.equal(await expireIfStale(s, 1, 10 ** 12), false)
  assert.equal(await deleteStoredRoom(s), false)
  assert.equal(s.m.size, 0)
})

test('loading the stored state into a client that already has the same edits does not duplicate text', async () => {
  const s = fakeStorage()
  const server = docWith('Table a {\n  id int\n}\n')
  await saveDocument(s, server)
  const client = new Y.Doc()
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server)) // the client's own copy (e.g. IndexedDB)
  const restored = (await loadDocument(s)).doc
  Y.applyUpdate(client, Y.encodeStateAsUpdate(restored))
  Y.applyUpdate(restored, Y.encodeStateAsUpdate(client))
  assert.equal(client.getText('code').toString(), 'Table a {\n  id int\n}\n')
  assert.equal(restored.getText('code').toString(), client.getText('code').toString())
})
