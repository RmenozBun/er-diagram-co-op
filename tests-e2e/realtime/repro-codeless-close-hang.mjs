const url = 'ws://localhost:8787/parties/document/qa-dbg3-' + Date.now()
for (const code of [undefined, 1000]) {
  const ws = new WebSocket(url + (code ?? 'n')); ws.binaryType = 'arraybuffer'
  await new Promise((r) => ws.addEventListener('open', r))
  const t0 = Date.now()
  let closed = null; ws.addEventListener('close', (e) => (closed = [e.code, Date.now() - t0]))
  code ? ws.close(code) : ws.close()
  await new Promise((r) => setTimeout(r, 5000))
  console.log('close arg', code, 'readyState', ws.readyState, 'closeEvent', closed)
}
process.exit(0)
