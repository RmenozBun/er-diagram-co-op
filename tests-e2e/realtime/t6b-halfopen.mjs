// Half-open connection (laptop lid closed / wifi dropped without FIN): a TCP proxy silently stops forwarding but keeps sockets open.
// Measures how long other users keep seeing the "ghost" in awareness. Runs up to 150 s.
import net from 'node:net'
import { createBot, waitSynced, sleep, rid, writeJson, destroyAll } from './lib.mjs'
let paused = false
const proxy = net.createServer((c) => {
  const s = net.connect(8787, '127.0.0.1')
  const pipe = (a, b) => a.on('data', (d) => { if (!paused) b.write(d) })
  pipe(c, s); pipe(s, c); c.on('error', () => {}); s.on('error', () => {}); c.on('close', () => s.destroy()); s.on('close', () => c.destroy())
}).listen(8791)
const room = rid('halfopen')
const obs = createBot(room, 0), ghost = createBot(room, 1, { host: 'localhost:8791' })
await waitSynced([obs, ghost])
await sleep(500)
const gid = ghost.doc.clientID
console.log('observer sees ghost before:', obs.provider.awareness.getStates().has(gid))
paused = true; const t0 = Date.now()
let gone = -1
while (Date.now() - t0 < 150000) { if (!obs.provider.awareness.getStates().has(gid)) { gone = Date.now() - t0; break } await sleep(500) }
// also: do edits written by the ghost-less observer still flow? (server sends to dead socket; check observer unaffected)
obs.ytext.insert(0, 'still-works'); 
const res = { ghostRemovedAfterMs: gone, stillVisibleAfter150s: gone < 0 }
console.log(JSON.stringify(res)); writeJson('t6b.json', res); process.exit(0)
