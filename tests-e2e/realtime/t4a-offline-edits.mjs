import { dropConnection, Y, createBot, waitSynced, waitConverged, diverged, sleep, rid, rnd, writeJson, destroyAll, tableDsl, randomEdit } from './lib.mjs'
const room = rid('offline')
const bots = Array.from({ length: 4 }, (_, i) => createBot(room, i))
await waitSynced(bots)
bots[0].ytext.insert(0, Array.from({ length: 10 }, (_, i) => tableDsl(`base_${i}`)).join(''))
await waitConverged(bots, 5000)
const off = bots[3]
await dropConnection(off)
const markers = []
const stop = Date.now() + 8000
const run = async (b, tag) => { let s = 0; while (Date.now() < stop) { s++; const m = `@@${tag}${b.idx}_${s}@@`; b.ytext.insert(b.ytext.length, `-- ${m}\n`); markers.push([b.idx, m]); b.ypos.set(`k_${b.idx}_${s}`, { x: s, y: b.idx }); await sleep(120) } }
await Promise.all([run(bots[0], 'on'), run(bots[1], 'on'), run(bots[2], 'on'), run(off, 'off')])
const lenOnlineView = bots[0].ytext.length
const offSeesOnline = bots[3].ytext.toString().includes('@@on0_1@@')
const t = Date.now(); off.provider.connect()
const conv = await waitConverged(bots, 20000)
const text = bots[0].ytext.toString()
const missing = markers.filter(([, m]) => !text.includes(m))
const dups = markers.filter(([, m]) => text.split(m).length - 1 !== 1)
const res = { offlineClientSawOnlineEditsWhileOffline: offSeesOnline, converged: conv >= 0, convergenceMsAfterReconnect: conv, markers: markers.length, offlineMarkers: markers.filter(([i]) => i === 3).length, missing: missing.length, duplicated: dups.length, positions: bots[0].ypos.size, expectedPositions: markers.length }
console.log(JSON.stringify(res)); writeJson('t4a.json', res); destroyAll(bots); process.exit(0)
