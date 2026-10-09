import { emptySchema, newField } from '../model.js'

/**
 * "Schema spec" sheets: a CSV/Excel sheet with a `Field, Type` header describing one table/collection
 * (as opposed to a sheet holding the table's data). Optional extra columns: Required, Description, Default.
 */
const HEAD = {
  field: /^(fields?|field ?name|column|columns|name|attribute|property|key|ฟิลด์|ชื่อฟิลด์|คอลัมน์)$/i,
  type: /^(types?|data ?type|ชนิด|ประเภท|ชนิดข้อมูล)$/i,
  required: /^(required|mandatory|not ?null|ต้องระบุ|จำเป็น)$/i,
  description: /^(description|desc|notes?|comments?|remarks?|คำอธิบาย|หมายเหตุ)$/i,
  default: /^(default|default ?value|ค่าเริ่มต้น)$/i,
}
const YES = /^(y|yes|true|1|x|✓|✔|required|ใช่|จำเป็น)$/i

/** Locate the header row (it may sit below a title row or start at column C). */
export function findSpecHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const row = rows[r] ?? []
    for (let c = 0; c < Math.min(row.length - 1, 6); c++) {
      if (HEAD.field.test(String(row[c] ?? '').trim()) && HEAD.type.test(String(row[c + 1] ?? '').trim())) {
        const cols = { field: c, type: c + 1 }
        for (let k = c + 2; k < row.length; k++) {
          const h = String(row[k] ?? '').trim()
          for (const key of ['required', 'description', 'default']) if (HEAD[key].test(h) && cols[key] === undefined) cols[key] = k
        }
        return { row: r, cols }
      }
    }
  }
  return null
}

export const isSpecRows = (rows) => findSpecHeader(rows) !== null

const cleanName = (s) => String(s).trim().replace(/[^\p{L}\p{M}\p{N}_$]+/gu, '_').replace(/^_+|_+$/g, '') || 'table'

const PRIMITIVES = {
  string: 'string', str: 'string', text: 'string', varchar: 'string', char: 'string', uuid: 'string', email: 'string', url: 'string',
  num: 'int', number: 'int', int: 'int', integer: 'int', smallint: 'int', long: 'long', bigint: 'long',
  float: 'double', double: 'double', decimal: 'decimal', numeric: 'decimal', money: 'decimal',
  bool: 'bool', boolean: 'bool',
  date: 'date', datetime: 'date', timestamp: 'date', time: 'date',
  obj: 'object', object: 'object', map: 'object', dict: 'object', hash: 'object', json: 'json', any: 'json', mixed: 'json',
  objectid: 'objectid', oid: 'objectid', binary: 'buffer', buffer: 'buffer', blob: 'buffer',
}

/**
 * "string (ref: SCHOOL)", "array(obj)", "array<string>", "string[]", "num (0,1)", "datetime" ...
 * @returns {{ type: string, note: string|null, ref: string|null, isArray: boolean, base: string }}
 */
export function parseSpecType(text) {
  let t = String(text ?? '').trim()
  let ref = null
  const refM = t.match(/\(\s*ref(?:erences?)?\s*:\s*([^)]+)\)/i)
  if (refM) {
    ref = refM[1].trim()
    t = t.replace(refM[0], ' ').replace(/\s+/g, ' ').trim()
  }
  let isArray = false
  let elem = null
  let hint = null
  let m
  if ((m = t.match(/^(.+?)\s*\[\s*\]\s*(?:\((.*)\))?$/))) {
    isArray = true
    elem = m[1].trim()
    hint = m[2]?.trim() || null
  } else if ((m = t.match(/^(?:array|list)\s*(?:<\s*([^>]+?)\s*>|\[\s*([^\]]+?)\s*\]|of\s+(.+?))\s*(?:\((.*)\))?$/i))) {
    isArray = true
    elem = (m[1] ?? m[2] ?? m[3]).trim()
    hint = m[4]?.trim() || null
  } else if ((m = t.match(/^(array|list)\s*(?:\((.*)\))?$/i))) {
    isArray = true
    elem = m[2]?.trim() || null
  }
  let base = 'array'
  if (!isArray) {
    const hm = t.match(/^([^(]*?)\s*(?:\(([\s\S]*)\))?\s*$/)
    base = (hm?.[1] ?? t).trim().toLowerCase()
    hint = hm?.[2]?.trim() || null
  }

  const word = (w) => PRIMITIVES[String(w).trim().toLowerCase()] ?? null
  let type
  if (isArray) {
    const e = elem ? word(elem) : null
    type = ref ? 'objectid[]' : `${e ?? (elem ? cleanName(elem) : 'json')}[]`
  } else {
    type = word(base) ?? (base ? cleanName(base) : 'string')
  }
  return { type, note: hint, ref, isArray, base }
}

/**
 * @param {{name:string, rows:string[][]}[]} sheets  spec sheets (see isSpecRows)
 * @returns {import('../model.js').Schema}
 */
export function specToSchema(sheets, schema = emptySchema()) {
  const specNotes = []
  const used = new Set(schema.tables.map((t) => t.name.toLowerCase()))
  // sheet name (cleaned, lower-case) -> table, so refs written as the sheet name still resolve after de-duplication
  const alias = new Map(schema.tables.map((t) => [t.name.toLowerCase(), t]))
  const parsed = []

  for (const sheet of sheets) {
    const head = findSpecHeader(sheet.rows)
    if (!head) continue
    const { cols } = head
    const base = cleanName(sheet.name)
    const aliasKey = base.toLowerCase()
    let name = base
    let n = 2
    while (used.has(name.toLowerCase())) name = `${base}_${n++}`
    used.add(name.toLowerCase())
    const table = { name, note: null, embedded: false, fields: [], indexes: [] }
    if (!alias.has(aliasKey)) alias.set(aliasKey, table)

    const dataRows = sheet.rows.slice(head.row + 1)
    const hasUnderscoreId = dataRows.some((r) => String(r?.[cols.field] ?? '').trim() === '_id')
    for (const row of dataRows) {
      const fname = String(row?.[cols.field] ?? '').trim()
      const typeText = String(row?.[cols.type] ?? '').trim()
      if (!fname) continue
      if (/^notes?$/i.test(fname)) {
        table.note = [table.note, typeText].filter(Boolean).join(' ')
        continue
      }
      if (table.fields.some((f) => f.name === fname)) continue // duplicate row: the first one wins
      const f = newField(fname, 'string')
      const pt = parseSpecType(typeText)
      f.type = pt.type
      const isId = /^_?id$/i.test(fname) && (pt.type === 'object' || pt.type === 'objectid')
      if (isId && !(fname === 'id' && hasUnderscoreId)) {
        f.name = '_id' // MongoDB's primary key is always `_id`
        f.type = 'objectid'
        f.pk = true
        f.notNull = true
      }
      const notes = []
      if (pt.note) notes.push(pt.note)
      if (cols.description !== undefined && row[cols.description]) notes.push(String(row[cols.description]).trim())
      if (notes.length) f.note = notes.join(' - ')
      if (cols.required !== undefined && YES.test(String(row[cols.required] ?? '').trim())) f.notNull = true
      if (cols.default !== undefined && String(row[cols.default] ?? '').trim() !== '') {
        const d = String(row[cols.default]).trim()
        f.default = d
        f.defaultKind = /^-?\d+(\.\d+)?$|^(true|false|null)$/i.test(d) ? 'literal' : 'string'
      }
      table.fields.push(f)
      parsed.push({ table, field: f, ref: pt.ref, hint: pt.isArray ? null : pt.note, array: pt.isArray })
    }
    schema.tables.push(table)
  }

  // resolve relations once every table (and primary key) is known
  const pkOf = (t) => t.fields.find((f) => f.pk) ?? t.fields[0]
  const lookup = (s) => alias.get(cleanName(String(s).split('.')[0]).toLowerCase()) ?? null
  const pending = []
  for (const p of parsed) {
    let target = null
    if (p.ref) {
      target = lookup(p.ref)
      if (!target) {
        p.field.note = [p.field.note, `ref: ${p.ref}`].filter(Boolean).join(' - ')
        specNotes.push(`${p.table.name}.${p.field.name}: unknown reference "${p.ref}"`)
      }
    } else if (p.hint && !/[\s,/]/.test(p.hint) && !/^(int|long|double|decimal|date|bool|objectid)$/.test(p.field.type)) {
      target = lookup(p.hint)
    }
    if (!target) continue
    if (p.array) p.field.note = [p.field.note, `ref: ${target.name}`].filter(Boolean).join(' - ')
    else {
      pending.push({ table: p.table.name, field: p.field, target })
      if (p.field.note === p.hint) p.field.note = null
    }
  }
  for (const r of pending) {
    const pk = pkOf(r.target)
    if (!pk) continue
    if (!schema.refs.some((x) => x.from.table === r.table && x.from.field === r.field.name && x.to.table === r.target.name)) {
      schema.refs.push({ from: { table: r.table, field: r.field.name }, to: { table: r.target.name, field: pk.name }, type: '>' })
    }
    // the foreign key has the same type as the key it points to (an ObjectId in MongoDB)
    if (pk.type === 'objectid') r.field.type = 'objectid'
  }
  schema.specNotes = [...(schema.specNotes ?? []), ...specNotes]
  return schema
}
