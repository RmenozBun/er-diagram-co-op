// Soak: 6 bots, continuous light activity. Usage: node t7-soak.mjs [seconds=180]
import { execSync } from 'node:child_process'
import { createBot, waitSynced, waitConverged, sleep, rid, rnd, writeJson, destroyAll, randomEdit, stats } from './lib.mjs'
const DUR = (+process.argv[2] || 180) * 1000
const room = rid('soak')
const bots = Array.from({ length: 6 }, (_, i) => createBot(room, i))
await waitSynced(bots)
const wk = () => { try { return JSON.parse(execSync(`powershell -NoProfile -Command "Get-Process workerd | Select Id,WS,PrivateMemorySize64,CPU | ConvertTo-Json -Compress"`, { encoding: 'utf8' })) } catch { return [] } }
const mb = (x) => Math.round(x / 1048576 * 10) / 10
const samples = []
const sample = () => { const m = process.memoryUsage(); const w = [].concat(wk()); samples.push({ t: Math.round((Date.now() - t0) / 1000), nodeRssMB: mb(m.rss), nodeHeapMB: mb(m.heapUsed), workerd: w.map((p) => ({ id: p.Id, wsMB: mb(p.WS), privMB: mb(p.PrivateMemorySize64), cpuS: Math.round(p.CPU) })) }); console.log(JSON.stringify(samples.at(-1))) }
const lat = []
const MRK = /@@(\d+)_(\d+)_(\d+)@@/g
for (const b of bots) b.ytext.observe((ev, tr) => { if (tr.local) return; const now = Date.now(); for (const d of ev.delta) if (typeof d.insert === 'string') for (const m of d.insert.matchAll(MRK)) lat.push(now - +m[3]) })
const t0 = Date.now(), stop = t0 + DUR
let edits = 0
const loops = bots.map(async (b) => { let s = 0
  await Promise.all([
    (async () => { while (Date.now() < stop) { randomEdit(b, ++s, `@@${b.idx}_${s}_${Date.now()}@@`); edits++; await sleep(600 + rnd(800)) } })(),
    (async () => { while (Date.now() < stop) { b.ypos.set(`soak_${rnd(40)}`, { x: rnd(2000), y: rnd(2000) }); await sleep(500) } })(),
    (async () => { while (Date.now() < stop) { b.provider.awareness.setLocalStateField('cursor', { a: rnd(1000) }); await sleep(1000) } })(),
  ]) })
sample()
const timer = setInterval(sample, 15000)
await Promise.all(loops); clearInterval(timer); sample()
const conv = await waitConverged(bots, 30000)
const reconnects = bots.map((b) => b.statuses.filter((s) => s[1] === 'connected').length - 1)
const res = { durationSec: DUR / 1000, edits, converged: conv >= 0, finalChars: bots[0].ytext.length, reconnectsPerBot: reconnects, errors: bots.flatMap((b) => b.errors), latencyMs: stats(lat), samples }
console.log(JSON.stringify({ ...res, samples: undefined })); writeJson('t7.json', res); destroyAll(bots); process.exit(0)
