import fs from 'node:fs'
export const S = await import('../../packages/schema/src/index.js')
const results = []
let area = ''
export const setArea = (a) => { area = a }
export function check(name, cond, note = '') {
  results.push({ area, name, pass: !!cond, note: cond ? '' : String(note).slice(0, 400) })
  if (!cond) console.log('FAIL', area, '|', name, '|', String(note).slice(0, 400))
}
export function done(file) {
  fs.writeFileSync(file, JSON.stringify(results, null, 1))
  const p = results.filter((r) => r.pass).length
  console.log(`${file}: ${p}/${results.length} passed`)
}
