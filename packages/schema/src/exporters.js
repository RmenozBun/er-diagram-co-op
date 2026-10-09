import { toCsv } from './importers/csv.js'
import { baseType, endpointFields } from './model.js'

// spreadsheets treat cells starting with = + - @ as formulas: neutralise them
const safe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v)

/** One row per field: handy for documentation / spreadsheets. */
export function schemaToCsv(schema) {
  const rows = [['table', 'field', 'type', 'primary_key', 'unique', 'not_null', 'default', 'references', 'note']]
  for (const t of schema.tables) {
    for (const f of t.fields) {
      const ref = schema.refs.find((r) => r.from.table === t.name && endpointFields(r.from).includes(f.name))
      const target = schema.tables.find((x) => x.name.toLowerCase() === baseType(f.type))
      rows.push(
        [
          t.name,
          f.name,
          f.type,
          f.pk ? 'yes' : '',
          f.unique ? 'yes' : '',
          f.notNull ? 'yes' : '',
          f.default ?? '',
          ref ? `${ref.to.table}.${endpointFields(ref.to).join('+')}` : target ? target.name : '',
          f.note ?? '',
        ].map(safe),
      )
    }
  }
  return toCsv(rows)
}

// characters that are illegal in file names on Windows/macOS/Linux, plus control characters
const BAD_FILE_CHARS = new RegExp('[\\\\/:*?"<>|\\u0000-\\u001f]+', 'g')

/** One CSV (header row only) per table - an empty "data template" for each table. */
export function tablesToCsvFiles(schema) {
  const used = new Set()
  return schema.tables.map((t) => {
    const base = String(t.name).replace(BAD_FILE_CHARS, '_').replace(/^\.+/, '_') || 'table'
    let name = base
    let n = 2
    while (used.has(name.toLowerCase())) name = `${base}_${n++}`
    used.add(name.toLowerCase())
    return { name: `${name}.csv`, content: toCsv([t.fields.map((f) => f.name)]) }
  })
}
