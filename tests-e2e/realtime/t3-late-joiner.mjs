import * as Yjs from './lib.mjs'
const { Y, createBot, waitSynced, sleep, rid, stats, writeJson, destroyAll, snapshot } = Yjs
const room = rid('late')
const builder = createBot(room, 0); await builder.synced
// build 200 tables ~ 5000 lines, 200 positions, in chunks of 20 tables (like pasted/imported edits)
let lines = 0
for (let c = 0; c < 10; c++) {
  builder.doc.transact(() => {
    for (let i = 0; i < 20; i++) {
      const n = c * 20 + i
      let s = `Table big_table_${n} {\n`
      for (let f = 0; f < 22; f++) s += `  column_${f} varchar(255) [not null, note: 'description of column ${f} in table ${n}']\n`
      s += '}\n'
      builder.ytext.insert(builder.ytext.length, s); lines += 24
      builder.ypos.set(`big_table_${n}`, { x: (n % 20) * 300, y: Math.floor(n / 20) * 400 })
    }
  })
  await sleep(50)
}
await sleep(1500)
const total = builder.ytext.length
const stateBytes = Y.encodeStateAsUpdate(builder.doc).length
console.log('built lines', lines, 'chars', total, 'positions', builder.ypos.size, 'stateBytes', stateBytes)
async function joinOne(i) {
  const t = Date.now(); const b = createBot(room, 100 + i)
  await b.synced; const syncMs = Date.now() - t
  const ok = b.ytext.toString() === builder.ytext.toString() && b.ypos.size === builder.ypos.size
  return { b, syncMs, ok }
}
const single = []
for (let i = 0; i < 5; i++) { const r = await joinOne(i); single.push(r.syncMs); if (!r.ok) console.log('MISMATCH single'); destroyAll([r.b]) }
const parallel = []; const bots = []
for (let rep = 0; rep < 3; rep++) {
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => joinOne(10 + i)))
  rs.forEach((r) => { parallel.push(r.syncMs); if (!r.ok) console.log('MISMATCH parallel') ; destroyAll([r.b]) })
}
const res = { lines, chars: total, positions: builder.ypos.size, stateBytes, singleJoinMs: single, singleStats: stats(single), parallel6Stats: stats(parallel), parallel6Raw: parallel, allMatched: true }
console.log(JSON.stringify(res)); writeJson('t3.json', res); destroyAll([builder]); process.exit(0)
