import {
  ddlToSchema, mongoToSchema, parseMongoExport, parseCsv, rowsToSchema, isSpecRows, specToSchema, serialize, emptySchema, tablesToMongo,
  parseMongoose, validatorToSchema, collectionNameFromFile, codeToView, toMongooseView, mergeViews, looksLikeDsl, looksLikeFullMongoose, convertDocument,
} from '@er/schema'
import { readXlsx } from './xlsx.js'

export const PROJECT_FORMAT = 'er-designer'

/**
 * Text that goes into the shared editor must use \n only. The editor (CodeMirror) turns \r\n into \n, so a \r\n in the
 * shared Y.Text makes the two disagree about positions and later edits / replacements corrupt the document.
 */
export const normalizeEol = (text) => String(text).replace(/\r\n?/g, '\n')

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

export function makeProjectFile({ mode, code, extras = null, positions }) {
  return JSON.stringify({ format: PROJECT_FORMAT, version: 1, mode, code, ...(extras ? { extras } : {}), positions }, null, 2)
}

/** Returns { mode, code, extras, positions } or throws a readable Error. */
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
  const mode = data.mode === 'mongodb' ? 'mongodb' : 'sql'
  let code = data.code
  let extras = mode === 'mongodb' && data.extras && typeof data.extras === 'object' ? data.extras : null
  if (mode === 'mongodb' && looksLikeDsl(code)) {
    // saved by an early version: the DSL becomes Mongoose models
    ;({ code, extras } = convertDocument({ code }, 'sql', 'mongodb'))
  } else if (mode === 'mongodb' && looksLikeFullMongoose(code)) {
    // saved by a version that showed the whole Mongoose file: show the short form, keep hooks / options as extras
    try {
      const view = codeToView(code)
      if (view.text) ({ text: code, extras } = view)
    } catch {}
  }
  return {
    mode,
    code: normalizeEol(code),
    extras,
    positions: data.positions && typeof data.positions === 'object' ? data.positions : {},
  }
}

const extOf = (name) => (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()

/**
 * Turn dropped/selected files into editor text: DSL for SQL, the short Mongoose form (`Model X { ... }`) for MongoDB.
 * Supported: .csv/.tsv (one table each), .xlsx (one table per sheet), .sql (DDL dump), .sqlite/.db/.sqlite3 (SQLite file),
 * .js/.mjs/.cjs (Mongoose model files: fields are shown, hooks / methods / options are kept for export), .json with a $jsonSchema validator, .json/.jsonl/.ndjson (mongoexport data).
 * A CSV/sheet headed `Field, Type` is read as a schema description (one collection/table),
 * anything else as table data.
 * `options.target` ('sql' | 'mongodb'): the kind of database the result is meant for. CSV / Excel data tables get that kind's
 * type names and the returned `mode` is the target; without it `mode` is only a guess from the content (or null).
 * @returns {Promise<{ code: string, extras: object|null, notes: string[], mode: 'sql'|'mongodb'|null }>}
 */
export async function importFiles(files, options = {}) {
  const notes = []
  const schema = emptySchema()
  const dataTables = emptySchema() // plain data sheets go last, after the schema descriptions
  const specs = []
  const mongooseViews = [] // Mongoose model files: field lists in the short form, hooks / methods / options in the extras
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
      } else if (['js', 'mjs', 'cjs'].includes(ext)) {
        const text = await readText(file)
        const parsed = parseMongoose(text)
        if (parsed.errors.length) throw new Error(`line ${parsed.errors[0].line}: ${parsed.errors[0].message}`)
        mongooseViews.push(codeToView(text))
        const roots = parsed.tables.filter((t) => !t.embedded).length
        notes.push(`${file.name}: Mongoose model file, ${roots} collection(s), ${parsed.tables.length - roots} embedded document type(s)`)
        mode = 'mongodb'
      } else if (['json', 'jsonl', 'ndjson', 'bson'].includes(ext)) {
        if (ext === 'bson') throw new Error('Binary .bson is not supported - export with mongoexport (JSON) instead.')
        const text = await readText(file)
        let validator = null
        if (ext === 'json') {
          try {
            validator = validatorToSchema(JSON.parse(text), collectionNameFromFile(file.name))
          } catch {}
        }
        if (validator) {
          schema.tables.push(...validator.tables)
          schema.refs.push(...validator.refs)
          notes.push(`${file.name}: read as a $jsonSchema validator (${validator.tables.filter((t) => !t.embedded).length} collection(s))`)
        } else {
          const base = file.name.replace(/\.[^.]+$/, '')
          const s = mongoToSchema(parseMongoExport(text, base))
          schema.tables.push(...s.tables)
          schema.refs.push(...s.refs)
          notes.push(`${file.name}: ${s.tables.length} collection(s)/sub-document type(s) inferred from the documents`)
        }
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
  if (mode === 'mongodb') {
    const parts = [...mongooseViews]
    if (schema.tables.length) parts.push(toMongooseView(schema))
    const merged = parts.reduce((all, part) => mergeViews(all, part), { text: '', extras: null })
    return { code: normalizeEol(merged.text), extras: merged.extras, notes, mode }
  }
  return { code: normalizeEol(serialize(schema)), extras: null, notes, mode }
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
