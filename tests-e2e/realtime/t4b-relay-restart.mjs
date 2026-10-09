import { exec } from 'node:child_process'
import { promisify } from 'node:util'
const execP = promisify(exec)
import { Y, createBot, waitSynced, waitConverged, sleep, rid, writeJson, destroyAll, tableDsl, snapshot } from './lib.mjs'
const room = rid('restart')
const bots = Array.from({ length: 5 }, (_, i) => createBot(room, i))
await waitSynced(bots)
// App-like seeding by bot 0 (meta.seeded + initial text + positions)
bots[0].doc.transact(() => { bots[0].ymeta.set('seeded', true); bots[0].ymeta.set('mode', 'sql'); bots[0].ytext.insert(0, Array.from({ length: 20 }, (_, i) => tableDsl(`base_${i}`)).join('')); for (let i = 0; i < 20; i++) bots[0].ypos.set(`base_${i}`, { x: i, y: i }) })
await waitConverged(bots, 5000)
const markers = []; let alive = true
const addEdit = (b, s) => { const m = `@@r${b.idx}_${s}@@`; b.ytext.insert(b.ytext.length, `-- ${m}\n`); markers.push(m); b.ypos.set(`p_${b.idx}_${s}`, { x: s, y: b.idx }) }
const loops = bots.map(async (b) => { let s = 0; while (alive) { addEdit(b, ++s); await sleep(150) } })
await sleep(3000)
const baseLenBefore = bots[0].ytext.length
const serverStatusBefore = bots.map((b) => b.provider.wsconnected)
const tKill = Date.now()
const out = (await execP('powershell -NoProfile -ExecutionPolicy Bypass -File ' + new URL('./restart-relay.ps1', import.meta.url).pathname.replace(/^\//, ''), { timeout: 300000 })).stdout.trim()
const relayUpAt = Date.now()
console.log(out, '(restart script took', relayUpAt - tKill, 'ms)')
// time until every bot is connected AND synced again
const tReady = []
for (const b of bots) {
  const t0 = Date.now()
  while (!(b.provider.wsconnected && b.provider.synced) && Date.now() - t0 < 120000) await sleep(50)
  tReady.push(Date.now() - relayUpAt)
}
console.log('bots ready after relay up (ms):', tReady)
await sleep(3000); alive = false; await Promise.all(loops)
const conv = await waitConverged(bots, 30000)
const text = bots[0].ytext.toString()
const missing = markers.filter((m) => !text.includes(m))
const dupMarkers = markers.filter((m) => text.split(m).length - 1 !== 1)
const baseDup = []; for (let i = 0; i < 20; i++) { const c = text.split(`Table base_${i} {`).length - 1; if (c !== 1) baseDup.push([i, c]) }
const ver = createBot(room, 99); await ver.synced; await sleep(500)
const vs = snapshot(ver), bs = snapshot(bots[0])
const res = {
  restartScriptMs: relayUpAt - tKill, recoveryFromKillMs: bots.map((b) => { const c = b.statuses.filter((s) => s[1] === 'connected'); return c[c.length - 1][0] - tKill }), disconnectDetectedAfterKillMs: bots.map((b) => (b.statuses.find((s) => s[1] === 'disconnected')?.[0] ?? 0) - tKill), botsReadyAfterRelayUpMs: tReady, converged: conv >= 0,
  markersWritten: markers.length, missing: missing.length, duplicatedMarkers: dupMarkers.length, baseTablesDuplicated: baseDup, totalChars: text.length,
  expectedSeedTableCount: 20, actualBaseTables: (text.match(/Table base_\d+ \{/g) || []).length,
  freshJoinerMatchesBots: vs.text === bs.text && vs.pos === bs.pos, positionsCount: bots[0].ypos.size, metaSeeded: bots[0].ymeta.get('seeded'),
  statusHistory: bots.map((b) => b.statuses.map((s) => s[1]).join('>')), errors: bots.flatMap((b) => b.errors).slice(0, 5),
}
console.log(JSON.stringify(res, null, 1)); writeJson('t4b.json', res); destroyAll([...bots, ver]); process.exit(0)
