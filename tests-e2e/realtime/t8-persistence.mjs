// Integration test of room persistence + expiry against a real local workerd relay (its own port and storage dir).
// Usage: node --no-warnings tests-e2e/realtime/t8-persistence.mjs
import { spawn, execSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as Y from 'yjs'
import YProvider from '../../apps/web/node_modules/y-partyserver/dist/provider/index.js'

const PORT = 8801
const HOST = `localhost:${PORT}`
const RELAY_DIR = resolve('apps/relay')
const store = mkdtempSync(join(tmpdir(), 'er-persist-'))
const logFile = join(store, 'relay.log')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
}

let relay = null
async function startRelay(vars = {}) {
  const args = ['wrangler', 'dev', '--port', String(PORT), '--inspector-port', '9441', '--persist-to', store]
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`)
  const fd = openSync(logFile, 'a')
  relay = spawn('npx', args, { cwd: RELAY_DIR, shell: true, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`)
      if (r.status === 200) return Date.now() - t0
    } catch {}
    await sleep(300)
  }
  throw new Error('relay did not start')
}
function stopRelay() {
  if (!relay) return
  try { execSync(`taskkill /pid ${relay.pid} /T /F`, { stdio: 'ignore' }) } catch {}
  relay = null
}

async function join_(room) {
  const doc = new Y.Doc()
  const provider = new YProvider(HOST, room, doc, { party: 'document', protocol: 'ws' })
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('sync timeout')), 15000)
    provider.on('sync', (s) => { if (s) { clearTimeout(t); res() } })
  })
  return { doc, provider, text: () => doc.getText('code').toString(), close: () => provider.destroy() }
}

const room = (tag) => `qa-persist-${tag}-${Date.now().toString(36)}`
const CODE = 'Table ลูกค้า {\n  รหัส int [pk]\n}\n'

try {
  console.log('starting relay (TTL 15 days)…')
  await startRelay({ ROOM_TTL_DAYS: 15 })

  // 1. content survives a relay restart although nobody was connected
  const r1 = room('restart')
  let a = await join_(r1)
  a.doc.getText('code').insert(0, CODE)
  a.doc.getMap('positions').set('ลูกค้า', { x: 10, y: 20 })
  await sleep(5000) // > 3 s debounce
  a.close()
  await sleep(500)
  stopRelay()
  await startRelay({ ROOM_TTL_DAYS: 15 })
  let b = await join_(r1)
  await sleep(300)
  check('1. saved room is restored after a relay restart with no client holding it', b.text() === CODE, JSON.stringify(b.text().slice(0, 40)))
  check('1b. positions restored too', JSON.stringify(b.doc.getMap('positions').toJSON()) === JSON.stringify({ 'ลูกค้า': { x: 10, y: 20 } }))
  b.close()

  // 2. the last person leaving right after typing still saves (before the debounce)
  const r2 = room('lastleave')
  a = await join_(r2)
  a.doc.getText('code').insert(0, CODE)
  await sleep(300)
  a.close() // leaves within ~0.3 s, well before the 3 s debounce
  await sleep(1500)
  stopRelay()
  await startRelay({ ROOM_TTL_DAYS: 15 })
  b = await join_(r2)
  await sleep(300)
  check('2. edits made just before the last person left are saved', b.text() === CODE, JSON.stringify(b.text().slice(0, 40)))
  b.close()

  // 3. a client that already holds the same content reconnects: no duplication
  const r3 = room('nodup')
  a = await join_(r3)
  a.doc.getText('code').insert(0, CODE)
  await sleep(4500)
  const clientState = Y.encodeStateAsUpdate(a.doc) // like an IndexedDB copy
  a.close()
  stopRelay()
  await startRelay({ ROOM_TTL_DAYS: 15 })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, clientState)
  const provider = new YProvider(HOST, r3, doc, { party: 'document', protocol: 'ws' })
  await new Promise((res) => provider.on('sync', (s) => s && res()))
  await sleep(500)
  check('3. restored server copy + client copy merge without duplicated text', doc.getText('code').toString() === CODE, JSON.stringify(doc.getText('code').toString().slice(0, 60)))
  provider.destroy()

  // 4. an untouched random room is not stored (opening it again after a restart is still empty and cheap)
  const r4 = room('empty')
  a = await join_(r4)
  await sleep(4000)
  a.close()
  await sleep(500)
  stopRelay()
  await startRelay({ ROOM_TTL_DAYS: 15 })
  b = await join_(r4)
  check('4. a room nobody wrote to stays empty', b.text() === '')
  b.close()

  // 5. expiry: tiny TTL (~4 s) and sweep (~3.6 s); a room nobody opens is deleted by the alarm, a room that is used stays
  stopRelay()
  console.log('restarting relay with a 4-second TTL…')
  await startRelay({ ROOM_TTL_DAYS: 0.00005, ROOM_SWEEP_HOURS: 0.001 })
  const r5 = room('expire')
  a = await join_(r5)
  a.doc.getText('code').insert(0, CODE)
  await sleep(4500)
  a.close()
  await sleep(14000) // TTL passed, several alarm sweeps happened
  b = await join_(r5)
  await sleep(300)
  check('5. a room nobody opened for longer than the TTL is deleted', b.text() === '', JSON.stringify(b.text().slice(0, 40)))
  b.close()
} catch (e) {
  check('test run completed without errors', false, e.message)
} finally {
  stopRelay()
  try { console.log(readFileSync(logFile, 'utf8').split(/\r?\n/).filter((l) => /\[er\]|failed to persist|Error/.test(l)).join(String.fromCharCode(10))) } catch {}
  try { rmSync(store, { recursive: true, force: true }) } catch {}
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
