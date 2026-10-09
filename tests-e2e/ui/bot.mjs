// usage: node bot.mjs <room> <seconds> [mode: append|typing|watch] [name]
import * as Y from 'yjs'
import YProvider from '../../apps/web/node_modules/y-partyserver/dist/provider/index.js'
const [room, secs='10', mode='watch', name='Bot'] = process.argv.slice(2)
const doc = new Y.Doc()
const provider = new YProvider('localhost:8787', room, doc, { party: 'document', protocol: 'ws' })
provider.awareness.setLocalStateField('user', { name, color: '#e53935', colorLight: '#e5393533' })
const ytext = doc.getText('code')
await new Promise((res) => provider.on('sync', (s) => s && res()))
console.log('SYNC chars', ytext.length, 'first:', ytext.toString().split('\n')[0])
ytext.observe(() => console.log('TEXT len', ytext.length))
provider.awareness.on('change', () => console.log('AWARE', JSON.stringify([...provider.awareness.getStates().values()].map(s => s.user))))
doc.getMap('positions').observe(() => console.log('POS', JSON.stringify(doc.getMap('positions').toJSON())))
doc.getMap('meta').observe(() => console.log('META', JSON.stringify(doc.getMap('meta').toJSON())))
if (mode === 'append') {
  ytext.insert(ytext.length, '\nTable from_bot {\n  id int [pk]\n}\n')
}
if (mode === 'typing') {
  // append many small edits at the START of doc as comment lines, 20ms apart
  for (let i = 0; i < 100; i++) { ytext.insert(0, `// bot${i}\n`); await new Promise(r => setTimeout(r, 20)) }
}
await new Promise(r => setTimeout(r, Number(secs) * 1000))
console.log('AWARE_FINAL', JSON.stringify([...provider.awareness.getStates().values()].map(s => s.user)))
console.log('FINAL', JSON.stringify(ytext.toString()))
console.log('POSITIONS', JSON.stringify(doc.getMap('positions').toJSON()), 'META', JSON.stringify(doc.getMap('meta').toJSON()))
provider.destroy(); process.exit(0)
