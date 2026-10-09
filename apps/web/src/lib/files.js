import { ddlToSchema, mongoToSchema, parseMongoExport, parseCsv, rowsToSchema, isSpecRows, specToSchema, serialize, emptySchema, tablesToMongo } from '@er/schema'
import { readXlsx } from './xlsx.js'

export const PROJECT_FORMAT = 'er-designer'

export function download(content, filename, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function readText(file) {
  return file.text()
}

export function makeProjectFile({ mode, code, positions }) {
  return JSON.stringify({ format: PROJECT_FORMAT, version: 1, mode, code, positions }, null, 2)
}

/** Returns { mode, code, positions } or throws a readable Error. */
export function readProjectFile(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Not a valid project file (invalid JSON).')
  }
  if (data?.format !== PROJECT_FORMAT || typeof data.code !== 'string') {
    throw new Error('Not an ER Designer project file.')
  }
  return {
    mode: data.mode === 'mongodb' ? 'mongodb' : 'sql',
    code: data.code,
    positions: data.positions && typeof data.positions === 'object' ? data.positions : {},
  }
}

const extOf = (name) => (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()

/**
 * Turn dropped/selected files into DSL text.
 * Supported: .csv/.tsv (one table each), .xlsx (one table per sheet), .sql (DDL dump),
 * .sqlite/.db/.sqlite3 (SQLite file), .json/.jsonl/.ndjson (mongoexport output).
 * A CSV/sheet headed `Field, Type` is read as a schema description (one collection/table),
 * anything else as table data.
 * `options.target` ('sql' | 'mongodb'): the kind of database the result is meant for. CSV / Excel data tables get that kind's
 * type names and the returned `mode` is the target; without it `mode` is only a guess from the content (or null).
 * @returns {Promise<{ code: string, notes: string[], mode: 'sql'|'mongodb'|null }>}
 */
export async function importFiles(files, options = {}) {
  const notes = []
  const schema = emptySchema()
  const dataTables = emptySchema() // plain data sheets go last, after the schema descriptions
  const specs = []
  let mode = null
  const addSheet = (label, name, rows) => {
    if (isSpecRows(rows)) {
      specs.push({ name, rows })
      notes.push(`${label}: read as schema description (${rows.length - 1} field rows)`)
    } else {
      rowsToSchema(name, rows, dataTables)
      notes.push(`${label}: table created from data (${Math.max(rows.length - 1, 0)} rows)`)
    }
  }
  for (const file of files) {
    const ext = extOf(file.name)
    try {
      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        addSheet(file.name, file.name.replace(/\.[^.]+$/, ''), parseCsv(await readText(file)))
      } else if (ext === 'xlsx') {
        const sheets = await readXlsx(await file.arrayBuffer())
        if (!sheets.length) throw new Error('no sheets found')
        for (const sh of sheets) addSheet(`${file.name} / ${sh.name}`, sh.name, sh.rows)
      } else if (ext === 'sql') {
        const s = ddlToSchema(await readText(file))
        schema.tables.push(...s.tables)
        schema.refs.push(...s.refs)
        notes.push(`${file.name}: ${s.tables.length} table(s), ${s.refs.length} relation(s)`)
        mode ??= 'sql'
      } else if (['sqlite', 'sqlite3', 'db', 'db3'].includes(ext)) {
        const s = await sqliteToSchema(await file.arrayBuffer())
        schema.tables.push(...s.tables)
        schema.refs.push(...s.refs)
        notes.push(`${file.name}: ${s.tables.length} table(s), ${s.refs.length} relation(s)`)
        mode ??= 'sql'
      } else if (['json', 'jsonl', 'ndjson', 'bson'].includes(ext)) {
        if (ext === 'bson') throw new Error('Binary .bson is not supported - export with mongoexport (JSON) instead.')
        const base = file.name.replace(/\.[^.]+$/, '')
        const s = mongoToSchema(parseMongoExport(await readText(file), base))
        schema.tables.push(...s.tables)
        schema.refs.push(...s.refs)
        notes.push(`${file.name}: ${s.tables.length} collection(s)/sub-document type(s) inferred`)
        mode = 'mongodb'
      } else {
        notes.push(`${file.name}: unsupported file type, skipped`)
      }
    } catch (e) {
      notes.push(`${file.name}: ${e.message}`)
    }
  }
  if (specs.length) {
    const before = schema.tables.length
    specToSchema(specs, schema)
    notes.push(...(schema.specNotes ?? []))
    const added = schema.tables.slice(before)
    if (added.some((t) => t.fields.some((f) => /^(object|objectid)(\[\])?$/.test(f.type) || f.type.endsWith('[]')))) mode = 'mongodb'
  }
  schema.tables.push(...(options.target === 'mongodb' ? tablesToMongo(dataTables.tables) : dataTables.tables))
  if (options.target) mode = options.target
  return { code: serialize(schema), notes, mode }
}

async function sqliteToSchema(buffer) {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
  ])
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const db = new SQL.Database(new Uint8Array(buffer))
  try {
    const res = db.exec("select sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by case type when 'table' then 0 else 1 end")
    const ddl = (res[0]?.values ?? []).map((r) => r[0]).join(';\n')
    return ddlToSchema(ddl)
  } finally {
    db.close()
  }
}
