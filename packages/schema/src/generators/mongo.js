import { baseType, defaultKind, isArrayType, refSides } from '../model.js'
import { embeddedTarget, rootTables } from '../relations.js'

const NUM = new Set(['int', 'integer', 'smallint', 'bigint', 'float', 'double', 'decimal', 'number', 'numeric', 'real', 'long'])
const STR = new Set(['string', 'varchar', 'char', 'text', 'uuid', 'email', 'url', 'enum'])
const BOOL = new Set(['bool', 'boolean'])
const DATE = new Set(['date', 'datetime', 'timestamp'])
const BIN = new Set(['buffer', 'binary', 'bytea', 'blob'])
const MIXED = new Set(['json', 'jsonb', 'object', 'mixed', 'any'])

const IDENT = /^[A-Za-z_$][\w$]*$/
const key = (n) => (n === '__proto__' ? '["__proto__"]' : IDENT.test(n) ? n : JSON.stringify(n))
const pascal = (n) => String(n).replace(/(^|[^\p{L}\p{M}\p{N}]+)([\p{L}\p{M}\p{N}])/gu, (_, __, c) => c.toUpperCase())
const indent = (s, n) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n')

// names that would shadow globals / Mongoose imports used by the generated file
const RESERVED_NAMES = new Set([
  'Schema', 'mongoose', 'Number', 'String', 'Boolean', 'Date', 'Buffer', 'Object', 'Array', 'Map', 'Set', 'Symbol', 'JSON', 'Math',
  'Error', 'Promise', 'Function', 'BigInt', 'module', 'exports', 'require', 'undefined', 'NaN', 'Infinity',
])
// property names Mongoose itself uses on documents
const RESERVED_FIELDS = new Set(['schema', 'errors', 'collection', 'save', 'isNew', 'get', 'set', 'init', 'validate', 'remove', 'db', 'model', 'modelName', 'populated', 'toObject', 'toJSON', 'delete', 'update', 'increment'])

/** Unique, valid JavaScript identifiers for every table (used for const names and `ref:` targets). */
function modelNames(schema) {
  const used = new Set()
  const map = new Map()
  for (const t of schema.tables) {
    let base = pascal(t.name).replace(/[^\p{L}\p{M}\p{N}_$]/gu, '')
    if (!base || /^\d/.test(base) || !/^[\p{L}_$][\p{L}\p{M}\p{N}_$]*$/u.test(base)) base = `_${base}`
    if (RESERVED_NAMES.has(base)) base += 'Model'
    let name = base
    let i = 2
    while (used.has(name) || used.has(`${name}Schema`)) name = `${base}${i++}`
    used.add(name)
    used.add(`${name}Schema`)
    map.set(t.name, name)
  }
  return map
}

/**
 * MongoDB's primary key is `_id`: a pk field called `id` of type objectid is emitted as `_id`.
 * Returns a copy of the schema with those fields (and refs pointing at them) renamed.
 */
export function useMongoIds(schema) {
  const renamed = new Set()
  const tables = schema.tables.map((t) => ({
    ...t,
    fields: t.fields.map((f) => {
      if (f.pk && f.name === 'id' && baseType(f.type) === 'objectid' && !t.fields.some((x) => x.name === '_id')) {
        renamed.add(`${t.name}.id`)
        return { ...f, name: '_id' }
      }
      return f
    }),
  }))
  const fix = (side) => {
    const fields = side.fields?.map((n) => (renamed.has(`${side.table}.${n}`) ? '_id' : n))
    const next = fields ? { ...side, fields } : { ...side }
    if (renamed.has(`${side.table}.${side.field}`)) next.field = '_id'
    return next
  }
  const refs = schema.refs.map((r) => ({ ...r, from: fix(r.from), to: fix(r.to) }))
  return { ...schema, tables, refs }
}

/** Where other tables are referenced from (ObjectId "ref" fields) + the id arrays created for N:M relations. */
function collectRefFields(schema) {
  /** @type {Map<string, Map<string,{ref:string}>>} */
  const map = new Map()
  const extra = new Map() // table -> [{name, ref}]
  for (const r of schema.refs) {
    if (r.type === '<>') {
      const list = extra.get(r.from.table) ?? []
      const name = `${r.to.table}_ids`
      const t = schema.tables.find((x) => x.name === r.from.table)
      if (!t?.fields.some((f) => f.name === name) && !list.some((e) => e.name === name)) list.push({ name, ref: r.to.table })
      extra.set(r.from.table, list)
      continue
    }
    const s = refSides(r)
    if (s) {
      if (!map.has(s.child.table)) map.set(s.child.table, new Map())
      map.get(s.child.table).set(s.child.field, { ref: s.parent.table })
    }
  }
  return { map, extra }
}

/** Single-field index entries that duplicate a field-level `unique`, and identical index definitions, are dropped. */
function indexList(t, withFieldLevel = false) {
  const seen = new Map()
  for (const f of t.fields) if (f.unique && !f.pk) seen.set(f.name, { fields: [f.name], unique: true, name: null, sparse: !f.notNull, fromField: true })
  for (const ix of t.indexes) {
    if (!ix.fields.every((f) => t.fields.some((x) => x.name === f))) continue
    const k = ix.fields.join('\u0000')
    const prev = seen.get(k)
    if (prev) {
      if (ix.unique && !prev.unique) prev.unique = true
      if (ix.name && !prev.name) prev.name = ix.name
      continue
    }
    const optional = ix.fields.length === 1 && !t.fields.find((x) => x.name === ix.fields[0])?.notNull
    seen.set(k, { fields: ix.fields, unique: ix.unique, name: ix.name, sparse: ix.unique && optional })
  }
  return [...seen.values()].filter((ix) => withFieldLevel || !ix.fromField)
}

// ---------------------------------------------------------------- Mongoose

function defaultLiteral(f) {
  const kind = defaultKind(f)
  const d = String(f.default)
  if (kind === 'literal') return d
  if (kind === 'expr') return /^(now\(\)|current_timestamp(\(\))?)$/i.test(d) ? 'Date.now' : null
  return JSON.stringify(d)
}

function mongooseType(schema, names, f, refInfo, seen, depth) {
  const array = isArrayType(f.type)
  const emb = embeddedTarget(schema, f)
  let inner
  if (emb) {
    inner = seen.has(emb.name) ? 'Schema.Types.Mixed' : embeddedObject(schema, names, emb, new Set([...seen, emb.name]), depth + 1)
    return array ? `[${inner}]` : inner
  }
  if (!refInfo) {
    const b = baseType(f.type)
    if (b === 'decimal') inner = 'Schema.Types.Decimal128'
    else if (NUM.has(b)) inner = 'Number'
    else if (STR.has(b)) inner = 'String'
    else if (BOOL.has(b)) inner = 'Boolean'
    else if (DATE.has(b)) inner = 'Date'
    else if (BIN.has(b)) inner = 'Buffer'
    else if (b === 'objectid') inner = 'Schema.Types.ObjectId'
    else if (MIXED.has(b)) inner = 'Schema.Types.Mixed'
    else inner = 'String'
  }
  const opts = refInfo ? ['type: Schema.Types.ObjectId', `ref: ${JSON.stringify(names.get(refInfo.ref) ?? refInfo.ref)}`] : [`type: ${inner}`]
  if (f.notNull && !f.pk) opts.push('required: true')
  if (f.unique && !f.pk) opts.push(f.notNull ? 'unique: true' : 'unique: true, sparse: true')
  if (f.default !== null && f.default !== undefined) {
    const d = defaultLiteral(f)
    if (d !== null) opts.push(`default: ${d}`)
  }
  const single = `{ ${opts.join(', ')} }`
  return array ? `[${single}]` : single
}

function embeddedObject(schema, names, table, seen, depth) {
  const refFields = collectRefFields(schema).map.get(table.name) ?? new Map()
  const body = table.fields
    .filter((f) => !(f.pk && f.name === '_id'))
    .map((f) => `${key(f.name)}: ${mongooseType(schema, names, f, refFields.get(f.name), seen, depth)},`)
  return `{\n${indent(body.join('\n'), 2)}\n}`
}

/**
 * Mongoose models for every root table (embedded tables become sub-documents).
 * @param {import('../model.js').Schema} input
 */
export function toMongoose(input) {
  const schema = useMongoIds(input)
  const names = modelNames(schema)
  const { map, extra } = collectRefFields(schema)
  const parts = ["const mongoose = require('mongoose')", 'const { Schema } = mongoose', '']
  const warnings = []
  const exportsList = []
  const blocks = []
  for (const t of rootTables(schema)) {
    const refFields = map.get(t.name) ?? new Map()
    const name = names.get(t.name)
    const reserved = t.fields.filter((f) => RESERVED_FIELDS.has(f.name)).map((f) => f.name)
    for (const r of reserved) warnings.push(`// WARNING: "${t.name}.${r}" is a reserved Mongoose property name - rename the field`)
    if (/\$/.test(t.name) || /^system\./.test(t.name)) warnings.push(`// WARNING: collection name "${t.name}" is not allowed by MongoDB`)
    const lines = t.fields
      .filter((f) => !(f.pk && f.name === '_id' && baseType(f.type) === 'objectid'))
      .map((f) => `${key(f.name)}: ${mongooseType(schema, names, f, refFields.get(f.name), new Set([t.name]), 1)},`)
    for (const e of extra.get(t.name) ?? []) {
      lines.push(`${key(e.name)}: [{ type: Schema.Types.ObjectId, ref: ${JSON.stringify(names.get(e.ref) ?? e.ref)} }],`)
    }
    const options = reserved.length ? '{ timestamps: false, suppressReservedKeysWarning: true }' : '{ timestamps: false }'
    const block = [`const ${name}Schema = new Schema(\n  {\n${indent(lines.join('\n'), 4)}\n  },\n  ${options},\n)`]
    for (const ix of indexList(t)) {
      const spec = `{ ${ix.fields.map((f) => `${key(f)}: 1`).join(', ')} }`
      const opts = []
      if (ix.unique) opts.push('unique: true')
      if (ix.sparse) opts.push('sparse: true')
      if (ix.name) opts.push(`name: ${JSON.stringify(ix.name)}`)
      block.push(`${name}Schema.index(${spec}${opts.length ? `, { ${opts.join(', ')} }` : ''})`)
    }
    block.push(`const ${name} = mongoose.model(${JSON.stringify(name)}, ${name}Schema, ${JSON.stringify(t.name)})`, '')
    blocks.push(block.join('\n'))
    exportsList.push(name)
  }
  return [...(warnings.length ? [...warnings, ''] : []), ...parts, ...blocks, `module.exports = { ${exportsList.join(', ')} }`].join('\n') + '\n'
}

// ------------------------------------------------------------- JSON Schema

/** bsonType(s) accepted for a declared type. Numbers use the `number` alias: drivers pick int32/int64/double on their own. */
function bsonOf(b) {
  if (NUM.has(b)) return 'number'
  if (STR.has(b)) return 'string'
  if (BOOL.has(b)) return 'bool'
  if (DATE.has(b)) return 'date'
  if (BIN.has(b)) return 'binData'
  if (b === 'objectid') return 'objectId'
  if (MIXED.has(b)) return null
  return 'string'
}

const withNull = (node, optional) => {
  if (!optional || !node.bsonType) return node
  return { ...node, bsonType: [].concat(node.bsonType, 'null') }
}

function propSchema(schema, f, refInfo, seen) {
  const array = isArrayType(f.type)
  const emb = embeddedTarget(schema, f)
  const optional = !(f.notNull || f.pk)
  let node
  if (emb) node = seen.has(emb.name) ? { bsonType: 'object' } : objectSchema(schema, emb, new Set([...seen, emb.name]))
  else if (refInfo) node = { bsonType: 'objectId' }
  else {
    const bson = bsonOf(baseType(f.type))
    node = bson ? { bsonType: bson } : {}
  }
  if (f.note) node.description = f.note
  return withNull(array ? { bsonType: 'array', items: withNull(node, true), ...(f.note ? { description: f.note } : {}) } : node, optional)
}

function objectSchema(schema, table, seen) {
  const { map, extra } = collectRefFields(schema)
  const refFields = map.get(table.name) ?? new Map()
  const properties = {}
  const required = []
  for (const f of table.fields) {
    properties[f.name] = propSchema(schema, f, refFields.get(f.name), seen)
    if (f.notNull || f.pk) required.push(f.name)
  }
  for (const e of extra.get(table.name) ?? []) properties[e.name] = { bsonType: ['array', 'null'], items: { bsonType: 'objectId' } }
  const node = { bsonType: 'object', properties }
  if (required.length) node.required = required
  return node
}

/**
 * mongosh script creating collections with $jsonSchema validators + indexes.
 * @param {import('../model.js').Schema} input
 */
export function toMongoShell(input) {
  const schema = useMongoIds(input)
  const out = []
  for (const t of rootTables(schema)) {
    if (/\$/.test(t.name) || /^system\./.test(t.name)) out.push(`// WARNING: collection name "${t.name}" is not allowed by MongoDB`)
    const validator = { $jsonSchema: objectSchema(schema, t, new Set([t.name])) }
    out.push(`db.createCollection(${JSON.stringify(t.name)}, {\n  validator: ${indent(JSON.stringify(validator, null, 2), 2).trimStart()}\n})`)
    for (const ix of indexList(t, true)) {
      const spec = `{ ${ix.fields.map((f) => `${key(f)}: 1`).join(', ')} }`
      const opts = []
      if (ix.unique) opts.push('unique: true')
      if (ix.sparse) opts.push('sparse: true')
      if (ix.name) opts.push(`name: ${JSON.stringify(ix.name)}`)
      out.push(`${collRef(t.name)}.createIndex(${spec}${opts.length ? `, { ${opts.join(', ')} }` : ''})`)
    }
  }
  return out.join('\n\n') + '\n'
}

const collRef = (n) => (/^[A-Za-z_$][\w$]*$/.test(n) ? `db.${n}` : `db.getCollection(${JSON.stringify(n)})`)
