import { createBot, sleep, rid } from './lib.mjs'
const room = rid('dbg')
const a = createBot(room, 0), b = createBot(room, 1); await Promise.all([a.synced, b.synced])
b.provider.disconnect(); await sleep(300)
console.log('after disc', b.provider.wsconnected, b.provider.shouldConnect, b.provider.synced)
b.ytext.insert(0, 'offline'); a.ytext.insert(0, 'online')
b.provider.connect(); 
for (let i=0;i<6;i++){ await sleep(500); console.log(i, b.provider.wsconnected, b.provider.synced, JSON.stringify(a.ytext.toString()), JSON.stringify(b.ytext.toString()), b.statuses.map(s=>s[1]).join(','), b.errors) }
process.exit(0)
