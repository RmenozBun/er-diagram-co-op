// Usage: node t1-converge-latency.mjs <N> [durationSec=20] [textRate=3] [posRate=10]
import { Y, createBot, waitSynced, waitConverged, diverged, sleep, rid, rnd, stats, randomEdit, eventLoopLag, writeJson, destroyAll, tableDsl } from './lib.mjs'
const N = +process.argv[2] || 2, DUR = +(process.argv[3] || 20) * 1000, TR = +(process.argv[4] || 3), PR = +(process.argv[5] || 10)
const room = rid(`conv${N}`)
const bots = Array.from({ length: N }, (_, i) => createBot(room, i))
const t0c = Date.now()
await waitSynced(bots)
const joinMs = Date.now() - t0c
// seed content
bots[0].doc.transact(() => { bots[0].ytext.insert(0, Array.from({ length: 30 }, (_, i) => tableDsl(`seed_${i}`)).join('')); for (let i = 0; i < 30; i++) bots[0].ypos.set(`seed_${i}`, { x: i * 10, y: i * 5 }) })
await waitConverged(bots, 20000)

const textLat = [], posLat = [], sent = { text: 0, pos: 0 }, recv = { text: 0, pos: 0 }
const MRK = /@@(\d+)_(\d+)_(\d+)@@/g
for (const b of bots) {
  b.ytext.observe((ev, tr) => {
    if (tr.local) return
    const now = Date.now()
    for (const d of ev.delta) if (typeof d.insert === 'string') { for (const m of d.insert.matchAll(MRK)) { textLat.push(now - +m[3]); recv.text++ } }
  })
  b.ypos.observe((ev, tr) => {
    if (tr.local) return
    const now = Date.now()
    for (const k of ev.keysChanged) { const v = b.ypos.get(k); if (v && v.ts && v.w !== b.idx) { posLat.push(now - v.ts); recv.pos++ } }
  })
}
const lag = eventLoopLag()
const stop = Date.now() + DUR
const u0 = bots.reduce((a, b) => a + b.updates, 0)
const loops = bots.map(async (b) => {
  let seq = 0
  const textLoop = (async () => { while (Date.now() < stop) { seq++; const k = randomEdit(b, seq, `@@${b.idx}_${seq}_${Date.now()}@@`); if (k !== 'del') sent.text++; await sleep(1000 / TR * (0.5 + Math.random())) } })()
  let pseq = 0
  const posLoop = (async () => { while (Date.now() < stop) { const k = `seed_${rnd(30)}`; b.ypos.set(k, { x: rnd(2000), y: rnd(2000), ts: Date.now(), w: b.idx, s: ++pseq }); sent.pos++; await sleep(1000 / PR) } })()
  const awLoop = (async () => { while (Date.now() < stop) { b.provider.awareness.setLocalStateField('cursor', { anchor: rnd(1000), head: rnd(1000) }); await sleep(500) } })()
  await Promise.all([textLoop, posLoop, awLoop])
})
await Promise.all(loops)
const activityDone = Date.now()
const convMs = await waitConverged(bots, 60000)
const updTotal = bots.reduce((a, b) => a + b.updates, 0) - u0
const bytes = bots.reduce((a, b) => a + b.updBytes, 0)
// independent verifier: fresh joiner must see same state as bots (server state == client state)
const ver = createBot(room, 999); const vt = Date.now(); await ver.synced; const verifierSyncMs = Date.now() - vt
await sleep(500)
const verOK = diverged([bots[0], ver]).length === 0
const expText = sent.text * (N - 1), expPos = sent.pos * (N - 1)
const res = {
  N, durationSec: DUR / 1000, textRate: TR, posRate: PR, joinAllMs: joinMs,
  converged: convMs >= 0, convergenceMs: convMs, verifierMatchesBots: verOK, verifierSyncMs,
  finalChars: bots[0].ytext.length, finalPositions: bots[0].ypos.size,
  sent, delivered: recv, textDeliveryRatio: +(recv.text / expText).toFixed(4), posDeliveryRatio: +(recv.pos / expPos).toFixed(4),
  textLatencyMs: stats(textLat), posLatencyMs: stats(posLat),
  clientUpdatesPerSec: Math.round(updTotal / (DUR / 1000)), clientKBps: Math.round(bytes / 1024 / (DUR / 1000)),
  eventLoopLagMs: lag.stop(), awarenessSeenByBot0: bots[0].provider.awareness.getStates().size,
  errors: bots.flatMap((b) => b.errors), reconnects: bots.filter((b) => b.statuses.filter((s) => s[1] === 'connected').length > 1).length,
}
console.log(JSON.stringify(res, null, 1))
writeJson(`t1-N${N}.json`, res)
destroyAll([...bots, ver]); process.exit(0)
