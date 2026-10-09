import * as Y from '../../node_modules/yjs/dist/yjs.mjs'
import YProvider from '../../apps/web/node_modules/y-partyserver/dist/provider/index.js'
import fs from 'node:fs'

export { Y }
export const HOST = 'localhost:8787'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const rid = (name) => `qa-${name}-${Date.now().toString(36)}`
export const rnd = (n) => Math.floor(Math.random() * n)

export function pct(arr, p) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}
export function stats(arr) {
  if (!arr.length) return { n: 0 }
  const r = (x) => Math.round(x * 10) / 10
  return { n: arr.length, p50: r(pct(arr, 50)), p95: r(pct(arr, 95)), p99: r(pct(arr, 99)), max: r(arr.reduce((a, b) => (b > a ? b : a), -Infinity)), mean: r(arr.reduce((a, b) => a + b, 0) / arr.length) }
}

export function createBot(room, idx, opts = {}) {
  const doc = new Y.Doc()
  const provider = new YProvider(opts.host ?? HOST, room, doc, { party: 'document', protocol: 'ws', ...(opts.provider ?? {}) })
  provider.awareness.setLocalStateField('user', { name: `Bot${idx}`, color: '#e53935', colorLight: '#e5393533' })
  const bot = { idx, doc, provider, ytext: doc.getText('code'), ypos: doc.getMap('positions'), ymeta: doc.getMap('meta'), updates: 0, updBytes: 0, errors: [], statuses: [] }
  doc.on('update', (u, origin) => { if (origin !== null && origin !== undefined || true) { bot.updates++; bot.updBytes += u.length } })
  provider.on('connection-error', (e) => bot.errors.push('conn-error ' + (e?.message ?? '')))
  provider.on('status', ({ status }) => bot.statuses.push([Date.now(), status]))
  bot.synced = new Promise((res) => provider.on('sync', (s) => s && res(Date.now())))
  return bot
}

export function waitSynced(bots, timeout = 30000) {
  return Promise.race([Promise.all(bots.map((b) => b.synced)), sleep(timeout).then(() => { throw new Error('sync timeout') })])
}

// State hash that ignores latency marker comments? No: full state compared.
export function snapshot(bot) {
  const pos = {}
  for (const [k, v] of [...bot.ypos.entries()].sort()) pos[k] = JSON.stringify(v)
  return { text: bot.ytext.toString(), pos: JSON.stringify(pos), meta: JSON.stringify([...bot.ymeta.entries()].sort()) }
}
export function diverged(bots) {
  const s = bots.map(snapshot)
  const bad = []
  for (let i = 1; i < s.length; i++) if (s[i].text !== s[0].text || s[i].pos !== s[0].pos || s[i].meta !== s[0].meta) bad.push(i)
  return bad
}
export async function waitConverged(bots, timeout = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (diverged(bots).length === 0) return Date.now() - t0
    await sleep(200)
  }
  return -1
}

export function eventLoopLag() {
  const lags = []
  let last = performance.now()
  const t = setInterval(() => { const n = performance.now(); lags.push(n - last - 50); last = n }, 50)
  return { stop() { clearInterval(t); return stats(lags.map((x) => Math.max(0, x))) } }
}

const NAMES = ['users', 'orders', 'items', 'invoices', 'payments', 'carts', 'products', 'tags', 'logs', 'roles']
export function tableDsl(name) {
  return `Table ${name} {\n  id int [pk, increment]\n  name varchar(100) [not null]\n  created_at timestamp\n  ref_id int [ref: > ${NAMES[rnd(NAMES.length)]}.id]\n}\n\n`
}
// random DSL edit on a bot's text; returns description
export function randomEdit(bot, seq, marker) {
  const t = bot.ytext
  const len = t.length
  const r = Math.random()
  const lineStart = () => { // snap to a line boundary
    const s = t.toString(); let p = rnd(len + 1); const nl = s.indexOf('\n', p); return nl < 0 ? len : nl + 1
  }
  if (len > 200 && r < 0.2) { const p = rnd(len - 30); t.delete(p, 1 + rnd(30)); return 'del' }
  const m = marker ? `-- ${marker}\n` : ''
  if (r < 0.5) { t.insert(len ? lineStart() : 0, m + tableDsl(`t_${bot.idx}_${seq}`)); return 'table' }
  if (r < 0.85) { t.insert(len ? lineStart() : 0, m + `  col_${bot.idx}_${seq} int\n`); return 'col' }
  const p = len ? rnd(len + 1) : 0
  t.insert(p, m + 'x'); return 'char'
}

export function writeJson(file, obj) { fs.writeFileSync(new URL('./out/' + file, import.meta.url), JSON.stringify(obj, null, 2)) }
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true })

export function destroyAll(bots) { for (const b of bots) { try { b.provider.destroy(); b.doc.destroy() } catch {} } }

// Clean "offline" simulation: provider.disconnect() closes WITHOUT a status code, which this relay never acknowledges
// (see report, finding "code-less close hangs"), so we close with 1000 instead. Resolves when status=disconnected.
export async function dropConnection(bot) {
  const p = bot.provider
  p.shouldConnect = false
  const done = new Promise((res) => { const f = ({ status }) => { if (status === 'disconnected') { p.off('status', f); res() } }; p.on('status', f) })
  p.ws.close(1000)
  await done
}
