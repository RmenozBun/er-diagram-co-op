import { createBot, waitSynced, waitConverged, sleep, rid, writeJson, destroyAll } from './lib.mjs'
const rA = rid('isoA'), rB = rid('isoB')
const A = Array.from({ length: 3 }, (_, i) => createBot(rA, i)), B = Array.from({ length: 3 }, (_, i) => createBot(rB, 10 + i))
await waitSynced([...A, ...B])
const stop = Date.now() + 10000
await Promise.all([...A.map(async (b) => { let s = 0; while (Date.now() < stop) { b.ytext.insert(b.ytext.length, `A-SECRET-${b.idx}-${++s}\n`); b.ypos.set('A_' + b.idx, { x: s, y: 0 }); b.ymeta.set('mode', 'sql'); b.provider.awareness.setLocalStateField('cursor', { room: 'A' }); await sleep(50) } }),
  ...B.map(async (b) => { let s = 0; while (Date.now() < stop) { b.ytext.insert(b.ytext.length, `B-SECRET-${b.idx}-${++s}\n`); b.ypos.set('B_' + b.idx, { x: s, y: 0 }); b.ymeta.set('mode', 'mongodb'); b.provider.awareness.setLocalStateField('cursor', { room: 'B' }); await sleep(50) } })])
const cA = await waitConverged(A, 10000), cB = await waitConverged(B, 10000)
const leakAtoB = B.some((b) => b.ytext.toString().includes('A-SECRET') || [...b.ypos.keys()].some((k) => k.startsWith('A_')) || [...b.provider.awareness.getStates().values()].some((s) => s.cursor?.room === 'A'))
const leakBtoA = A.some((b) => b.ytext.toString().includes('B-SECRET') || [...b.ypos.keys()].some((k) => k.startsWith('B_')) || [...b.provider.awareness.getStates().values()].some((s) => s.cursor?.room === 'B'))
const res = { convergedA: cA >= 0, convergedB: cB >= 0, leakAtoB, leakBtoA, modeA: A[0].ymeta.get('mode'), modeB: B[0].ymeta.get('mode'), awarenessSizeA: A[0].provider.awareness.getStates().size, awarenessSizeB: B[0].provider.awareness.getStates().size, charsA: A[0].ytext.length, charsB: B[0].ytext.length }
console.log(JSON.stringify(res)); writeJson('t5.json', res); destroyAll([...A, ...B]); process.exit(0)
