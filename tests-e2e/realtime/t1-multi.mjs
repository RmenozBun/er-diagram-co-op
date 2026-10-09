// Multi-process variant (client load spread over K node processes so the test client is not the bottleneck).
// Usage: node t1-multi.mjs <N> <procs> <durSec> <textRate/bot> <posRate/dragger> <draggers|all> [tag]
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { Y, createBot, waitSynced, sleep, rid, rnd, stats, randomEdit, writeJson, destroyAll, tableDsl, snapshot } from './lib.mjs'

const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)

if (process.argv[2] === 'worker') {
  const [, , , room, startIdx, count, durSec, TR, PR, draggers, startAt, outFile] = process.argv
  const bots = Array.from({ length: +count }, (_, i) => createBot(room, +startIdx + i))
  await waitSynced(bots)
  const textLat = [], posLat = [], sent = { text: 0, pos: 0 }, recv = { text: 0, pos: 0 }
  const MRK = /@@(\d+)_(\d+)_(\d+)@@/g
  for (const b of bots) {
    b.ytext.observe((ev, tr) => { if (tr.local) return; const now = Date.now(); for (const d of ev.delta) if (typeof d.insert === 'string') for (const m of d.insert.matchAll(MRK)) { textLat.push(now - +m[3]); recv.text++ } })
    b.ypos.observe((ev, tr) => { if (tr.local) return; const now = Date.now(); for (const k of ev.keysChanged) { const v = b.ypos.get(k); if (v && v.ts && v.w !== b.idx) { posLat.push(now - v.ts); recv.pos++ } } })
  }
  while (Date.now() < +startAt) await sleep(20)
  const stop = Date.now() + +durSec * 1000
  await Promise.all(bots.flatMap((b) => {
    let seq = 0, pseq = 0
    const loops = [
      (async () => { while (Date.now() < stop) { seq++; const k = randomEdit(b, seq, `@@${b.idx}_${seq}_${Date.now()}@@`); if (k !== 'del') sent.text++; await sleep(1000 / +TR * (0.5 + Math.random())) } })(),
      process.env.NOAWARE ? Promise.resolve() : (async () => { while (Date.now() < stop) { b.provider.awareness.setLocalStateField('cursor', { anchor: rnd(1000), head: rnd(1000) }); await sleep(500) } })(),
    ]
    if (draggers === 'all' || b.idx < +draggers) loops.push((async () => { while (Date.now() < stop) { b.ypos.set(`seed_${rnd(30)}`, { x: rnd(2000), y: rnd(2000), ts: Date.now(), w: b.idx, s: ++pseq }); sent.pos++; await sleep(1000 / +PR) } })())
    return loops
  }))
  // wait for quiescence: poll until all local bots have same hash twice 2s apart, up to 60s
  const hashes = () => bots.map((b) => { const s = snapshot(b); return h(s.text) + h(s.pos) })
  let last = '', stable = 0; const t0 = Date.now()
  while (Date.now() - t0 < 90000 && stable < 5) { const cur = hashes().join(); stable = cur === last && new Set(hashes()).size === 1 ? stable + 1 : 0; last = cur; await sleep(500) }
  const s0 = snapshot(bots[0])
  fs.writeFileSync(outFile, JSON.stringify({ sent, recv, textLat, posLat, hashes: hashes(), len: s0.text.length, settleMs: Date.now() - t0 - 2500, updates: bots.reduce((a, b) => a + b.updates, 0), errors: bots.flatMap((b) => b.errors), reconnected: bots.filter((b) => b.statuses.filter((s) => s[1] === 'connected').length > 1).length }))
  destroyAll(bots); process.exit(0)
}

const N = +process.argv[2], K = +process.argv[3], DUR = +process.argv[4], TR = +process.argv[5], PR = +process.argv[6], DRAG = process.argv[7] ?? 'all', tag = process.argv[8] ?? ''
const room = rid(`multi${N}`)
const seeder = createBot(room, 900)
await seeder.synced
seeder.doc.transact(() => { seeder.ytext.insert(0, Array.from({ length: 30 }, (_, i) => tableDsl(`seed_${i}`)).join('')); for (let i = 0; i < 30; i++) seeder.ypos.set(`seed_${i}`, { x: i * 10, y: i * 5 }) })
const startAt = Date.now() + 6000 + N * 40
const per = Math.ceil(N / K)
const outs = []
const procs = []
for (let k = 0; k < K; k++) {
  const start = k * per, cnt = Math.min(per, N - start); if (cnt <= 0) break
  const out = new URL(`./out/w-${process.pid}-${k}.json`, import.meta.url).pathname.replace(/^\//, '')
  outs.push(out)
  procs.push(new Promise((res) => { const p = spawn(process.execPath, ['--no-warnings', new URL(import.meta.url).pathname.replace(/^\//, ''), 'worker', room, start, cnt, DUR, TR, PR, DRAG, startAt, out], { stdio: 'inherit' }); p.on('exit', res) }))
}
await Promise.all(procs)
const R = outs.map((o) => JSON.parse(fs.readFileSync(o))); outs.forEach((o) => fs.unlinkSync(o))
const sn = snapshot(seeder); const seederHash = h(sn.text) + h(sn.pos)
const all = R.flatMap((r) => r.hashes)
const uniq = new Set([...all, seederHash])
const sum = (f) => R.reduce((a, r) => a + f(r), 0)
const textLat = R.flatMap((r) => r.textLat), posLat = R.flatMap((r) => r.posLat)
const sent = { text: sum((r) => r.sent.text), pos: sum((r) => r.sent.pos) }
const res = {
  N, procs: K, durationSec: DUR, textRatePerBot: TR, posRatePerDragger: PR, draggers: DRAG,
  converged: uniq.size === 1, distinctStates: uniq.size, finalChars: sn.text.length, settleMsMax: Math.max(...R.map((r) => r.settleMs)),
  sent, deliveredText: sum((r) => r.recv.text), deliveredPos: sum((r) => r.recv.pos),
  textDeliveryRatio: +(sum((r) => r.recv.text) / (sent.text * (N - 1))).toFixed(4),
  posDeliveryRatio: sent.pos ? +(sum((r) => r.recv.pos) / (sent.pos * (N - 1))).toFixed(4) : null,
  textLatencyMs: stats(textLat), posLatencyMs: stats(posLat),
  clientUpdatesPerSec: Math.round(sum((r) => r.updates) / DUR),
  errors: R.flatMap((r) => r.errors), botsThatReconnected: sum((r) => r.reconnected),
}
console.log(JSON.stringify(res))
writeJson(`t1multi-N${N}${tag}.json`, res)
destroyAll([seeder]); process.exit(0)
