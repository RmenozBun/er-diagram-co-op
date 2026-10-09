import { JSDOM } from 'jsdom'
globalThis.DOMParser = new JSDOM().window.DOMParser
export * from '../../packages/schema/src/index.js'
import * as S from '../../packages/schema/src/index.js'
import { readXlsx } from '../../apps/web/src/lib/xlsx.js'
export { readXlsx }
export const results = []
export function check(area, name, ok, note = '') { results.push({ area, name, ok: !!ok, note }); if (!ok) console.log('FAIL', area, name, note) }
export function summary() { const by = {}; for (const r of results) { by[r.area] ??= [0, 0]; by[r.area][1]++; if (r.ok) by[r.area][0]++ } console.log(by) }
// full pipeline replicating importFiles spec branch
export function importRows(sheets) {
  const schema = S.emptySchema(); const specs = []
  const data = S.emptySchema()
  for (const sh of sheets) { if (S.isSpecRows(sh.rows)) specs.push(sh); else S.rowsToSchema(sh.name, sh.rows, data) }
  if (specs.length) S.specToSchema(specs, schema)
  schema.tables.push(...data.tables)
  return { schema, code: S.serialize(schema) }
}
