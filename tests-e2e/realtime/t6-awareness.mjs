import { spawn } from 'node:child_process'
import { createBot, waitSynced, sleep, rid, writeJson, destroyAll, dropConnection } from './lib.mjs'
const room = rid('aware')
const bots = Array.from({ length: 6 }, (_, i) => createBot(room, i))
await waitSynced(bots)
const t0 = Date.now()
const seesAll = async () => { while (!bots.every((b) => b.provider.awareness.getStates().size === 6)) { if (Date.now() - t0 > 10000) return false; await sleep(20) } return true }
const ok = await seesAll(); const fullViewMs = Date.now() - t0
const names = bots.map((b) => [...b.provider.awareness.getStates().values()].map((s) => s.user?.name).sort().join(','))
console.log('everyone sees 6 (incl self):', ok, fullViewMs, 'ms; distinct views:', new Set(names).size)
async function goneAfter(victimId, observer, timeout = 90000) {
  const t = Date.now()
  while (observer.provider.awareness.getStates().has(victimId)) { if (Date.now() - t > timeout) return -1; await sleep(50) }
  return Date.now() - t
}
const res = { everyoneSeesAll6: ok, fullViewMs, distinctViews: new Set(names).size }
// (a) clean close 1000
let v = bots[5]; let id = v.doc.clientID; await dropConnection(v)
res.cleanClose1000_goneMs = await goneAfter(id, bots[0])
// (b) provider.destroy() / disconnect() (code-less close, what the web app does on leaving a room)
v = bots[4]; id = v.doc.clientID; const tb = Date.now(); v.provider.destroy()
res.providerDestroy_goneMs = await goneAfter(id, bots[0])
// (c) abrupt kill of a separate process (tab crash / network loss)
const child = spawn(process.execPath, ['--no-warnings', '-e', `
import('${new URL('./lib.mjs', import.meta.url).href}').then(async (L)=>{const b=L.createBot('${room}',77); await b.synced; console.log('ID '+b.doc.clientID); setInterval(()=>{},1000)})`], { stdio: ['ignore', 'pipe', 'inherit'] })
const cid = await new Promise((r) => child.stdout.on('data', (d) => { const m = /ID (\d+)/.exec(d.toString()); if (m) r(+m[1]) }))
await sleep(500); res.killedProcessVisible = bots[0].provider.awareness.getStates().has(cid)
const tk = Date.now(); child.kill('SIGKILL') // on Windows = TerminateProcess; TCP is reset by the OS
res.abruptKill_goneMs = await goneAfter(cid, bots[0])
// (d) silent network loss: freeze a client (never closes, stops sending) -> only awareness timeout (30s) can remove it
// emulate by pausing the process: use a child that we SIGSTOP is not available on Windows -> skipped, documented.
res.finalAwarenessSizeBot0 = bots[0].provider.awareness.getStates().size
console.log(JSON.stringify(res)); writeJson('t6.json', res); destroyAll(bots); process.exit(0)
