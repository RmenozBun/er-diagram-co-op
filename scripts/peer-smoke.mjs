// Smoke test for the relay: joins a room as a second "user", prints the shared code, appends a table.
// Usage: node scripts/peer-smoke.mjs <roomId> [host]
import * as Y from 'yjs'
import YProvider from '../apps/web/node_modules/y-partyserver/dist/provider/index.js'

const [room, host = 'localhost:8787'] = process.argv.slice(2)
if (!room) throw new Error('room id required')
const doc = new Y.Doc()
const provider = new YProvider(host, room, doc, { party: 'document', protocol: host.startsWith('localhost') ? 'ws' : 'wss' })
provider.awareness.setLocalStateField('user', { name: 'Bot', color: '#e53935', colorLight: '#e5393533' })
await new Promise((res) => provider.on('sync', (s) => s && res()))
const ytext = doc.getText('code')
console.log('synced, chars:', ytext.length, '\nfirst line:', ytext.toString().split('\n')[0])
ytext.insert(ytext.length, '\nTable from_bot {\n  id int [pk]\n}\n')
await new Promise((r) => setTimeout(r, 6000))
provider.destroy()
process.exit(0)
