// Checks which Origins a deployed relay accepts for WebSocket connections.
// Usage: node scripts/origin-check.mjs <relay-host> <allowed-origin>
const [host, allowed] = process.argv.slice(2)
if (!host || !allowed) throw new Error('usage: node scripts/origin-check.mjs <relay-host> <allowed-origin>')

const open = (origin) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`wss://${host}/parties/document/qa-origin-check`, origin ? { headers: { Origin: origin } } : undefined)
    const t = setTimeout(() => { resolve('timeout'); try { ws.close() } catch {} }, 10000)
    ws.onopen = () => { clearTimeout(t); resolve('accepted'); ws.close(1000) }
    ws.onerror = () => { clearTimeout(t); resolve('refused') }
  })

const cases = [
  [allowed, 'accepted'],
  ['https://evil.example', 'refused'],
  ['http://localhost:5173', 'accepted'],
  [null, 'refused'],
]
let bad = 0
for (const [origin, expected] of cases) {
  const got = await open(origin)
  if (got !== expected) bad++
  console.log(`${got === expected ? 'PASS' : 'FAIL'}  Origin ${origin ?? '(none)'} -> ${got} (expected ${expected})`)
}
console.log(bad ? `${bad} check(s) failed` : 'all checks passed')
process.exit(bad ? 1 : 0)
