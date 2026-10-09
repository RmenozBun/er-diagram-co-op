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
const words = (n) => String(n).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)
const pascal = (n) => words(n).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
const camel = (n) => {
  const p = pascal(n)
  return p ? p[0].toLowerCase() + p.slice(1) : p
}
const singular = (n) => (/ies$/i.test(n) ? n.replace(/ies$/i, 'y') : /(ss|us|is)$/i.test(n) ? n : n.replace(/s$/i, ''))
const indent = (s, n) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n')

// names that would shadow globals / Mongoose imports used by the generated file
const RESERVED_NAMES = new Set([
  'Schema', 'mongoose', 'Number', 'String', 'Boolean', 'Date', 'Buffer', 'Object', 'Array', 'Map', 'Set', 'Symbol', 'JSON', 'Math',
  'Error', 'Promise', 'Function', 'BigInt', 'module', 'exports', 'require', 'undefined', 'NaN', 'Infinity', 'default', 'import', 'export',
])
// property names Mongoose itself uses on documents
const RESERVED_FIELDS = new Set(['schema', 'errors', 'collection', 'save', 'isNew', 'get', 'set', 'init', 'validate', 'remove', 'db', 'model', 'modelName', 'populated', 'toObject', 'toJSON', 'delete', 'update', 'increment'])
// SQL functions are not JavaScript: never copied into Mongoose code
const SQL_FUNCS = new Set(['now', 'current_timestamp', 'current_date', 'current_time', 'localtimestamp', 'gen_random_uuid', 'uuid_generate_v4', 'uuid', 'nextval', 'getdate', 'sysdate', 'curdate', 'curtime', 'newid', 'random'])

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

/** Identifiers for every collection: schema variable, model constant and model name ("users" -> usersSchema, User, "UserModel"). */
function modelNames(roots) {
  const used = new Set(RESERVED_NAMES)
  const free = (base) => {
    let name = base
    let i = 2
    while (used.has(name)) name = `${base}${i++}`
    used.add(name)
    return name
  }
  const valid = (s, fallback) => (/^[\p{L}_$][\p{L}\p{M}\p{N}_$]*$/u.test(s) ? s : `_${s || fallback}`.replace(/[^\p{L}\p{M}\p{N}_$]/gu, ''))
  const map = new Map()
  for (const t of roots) {
    const constName = free(valid(pascal(singular(t.name)), 'Model'))
    const schemaVar = free(valid(`${camel(t.name) || 'collection'}Schema`, 'schema'))
    map.set(t.name, { constName, schemaVar, modelName: `${constName}Model` })
  }
  return map
}

function defaultLiteral(f) {
  const kind = defaultKind(f)
  const d = String(f.default)
  if (kind === 'literal') return d
  if (kind === 'expr') {
    if (/^(now\(\)|current_timestamp(\(\))?|date\.now(\(\))?)$/i.test(d)) return 'Date.now'
    const head = d.match(/^[\w$.]+/)?.[0]
    if (head && /^[\w$.]+(\([^()]*\))?$/.test(d) && !SQL_FUNCS.has(head.toLowerCase())) return d
    return null
  }
  return JSON.stringify(d)
}

const pad = (level) => '  '.repeat(level)

/** `{ a, b }` when short, otherwise one entry per line (entries may already be multi-line). */
function optionsObject(entries, level) {
  const single = `{ ${entries.join(', ')} }`
  if (!entries.some((e) => e.includes('\n')) && single.length <= 88) return single
  return `{\n${entries.map((e) => `${pad(level + 1)}${e},`).join('\n')}\n${pad(level)}}`
}

function typeName(f) {
  const b = baseType(f.type)
  if (b === 'decimal') return 'mongoose.Schema.Types.Decimal128'
  if (b === 'objectid') return 'mongoose.Schema.Types.ObjectId'
  if (NUM.has(b)) return 'Number'
  if (STR.has(b)) return 'String'
  if (BOOL.has(b)) return 'Boolean'
  if (DATE.has(b)) return 'Date'
  if (BIN.has(b)) return 'Buffer'
  if (MIXED.has(b)) return 'mongoose.Schema.Types.Mixed'
  return 'String'
}

const enumLiteral = (list) => `[${list.map((v) => (typeof v === 'number' ? v : JSON.stringify(v))).join(', ')}]`

/** Right-hand side of `fieldName: ...` for a property whose line starts at indentation `level`. */
function fieldValue(ctx, f, refInfo, seen, level, table) {
  const array = isArrayType(f.type)
  const emb = embeddedTarget(ctx.schema, f)
  const opts = []
  if (emb) {
    const inner = seen.has(emb.name) ? 'mongoose.Schema.Types.Mixed' : embeddedObject(ctx, emb, new Set([...seen, emb.name]), array ? level + 1 : level)
    if (!array && !f.notNull && !f.default) return inner
    opts.push(array ? `type: [${inner}]` : `type: ${inner}`)
    if (array) opts.push('default: []')
  } else if (refInfo || f.refModel) {
    opts.push(`type: ${array ? '[' : ''}mongoose.Schema.Types.ObjectId${array ? ']' : ''}`)
    opts.push(`ref: ${JSON.stringify(f.refModel ?? ctx.names.get(refInfo.ref)?.modelName ?? refInfo.ref)}`)
  } else {
    opts.push(`type: ${array ? '[' : ''}${typeName(f)}${array ? ']' : ''}`)
  }
  if (f.notNull && !f.pk) opts.push('required: true')
  if (f.unique && !f.pk) opts.push(f.notNull ? 'unique: true' : 'unique: true, sparse: true')
  if (f.enum?.length) opts.push(`enum: ${enumLiteral(f.enum)}`)
  if (f.default !== null && f.default !== undefined) {
    const d = defaultLiteral(f)
    if (d !== null) opts.push(`default: ${d}`)
  }
  // a plain single-field index becomes `index: true` on the field (like hand-written models)
  if (table && table.indexes.some((ix) => ix.fields.length === 1 && ix.fields[0] === f.name && !ix.unique && !ix.name)) opts.push('index: true')
  for (const k of ['trim', 'lowercase', 'uppercase', 'min', 'max', 'minlength', 'maxlength', 'immutable', 'select']) {
    if (f.opts && k in f.opts) opts.push(`${k}: ${JSON.stringify(f.opts[k])}`)
  }
  return optionsObject(opts, level)
}

function embeddedObject(ctx, table, seen, level) {
  const refFields = ctx.refs.map.get(table.name) ?? new Map()
  const lines = []
  if (table.noId) lines.push(`${pad(level + 1)}_id: false,`)
  for (const f of table.fields) {
    if (f.pk && f.name === '_id') continue
    lines.push(`${pad(level + 1)}${key(f.name)}: ${fieldValue(ctx, f, refFields.get(f.name), seen, level + 1, table)},`)
  }
  return `{\n${lines.join('\n')}\n${pad(level)}}`
}

/**
 * Mongoose models for every root table (embedded tables become sub-documents), written the way models are written by hand:
 *
 *   const usersSchema = new mongoose.Schema({ ... }, { timestamps: false, versionKey: false });
 *   const User = mongoose.model("UserModel", usersSchema, "users");
 *
 * @param {import('../model.js').Schema} input
 * @param {{ style?: 'esm' | 'cjs' }} [options]
 */
export function toMongoose(input, options = {}) {
  const style = options.style === 'cjs' ? 'cjs' : 'esm'
  const schema = useMongoIds(input)
  const roots = rootTables(schema)
  const ctx = { schema, names: modelNames(roots), refs: collectRefFields(schema) }
  const warnings = []
  const blocks = []
  const exportsList = []
  for (const t of roots) {
    const n = ctx.names.get(t.name)
    const refFields = ctx.refs.map.get(t.name) ?? new Map()
    const reserved = t.fields.filter((f) => RESERVED_FIELDS.has(f.name)).map((f) => f.name)
    for (const r of reserved) warnings.push(`// WARNING: "${t.name}.${r}" is a reserved Mongoose property name - rename the field`)
    if (/\$/.test(t.name) || /^system\./.test(t.name)) warnings.push(`// WARNING: collection name "${t.name}" is not allowed by MongoDB`)
    const lines = []
    for (const f of t.fields) {
      if (f.pk && f.name === '_id' && baseType(f.type) === 'objectid') continue
      lines.push(`${pad(2)}${key(f.name)}: ${fieldValue(ctx, f, refFields.get(f.name), new Set([t.name]), 2, t)},`)
    }
    for (const e of ctx.refs.extra.get(t.name) ?? []) {
      lines.push(`${pad(2)}${key(e.name)}: [{ type: mongoose.Schema.Types.ObjectId, ref: ${JSON.stringify(ctx.names.get(e.ref)?.modelName ?? e.ref)} }],`)
    }
    const schemaOptions = `{ timestamps: false, versionKey: false${reserved.length ? ', suppressReservedKeysWarning: true' : ''} }`
    const block = [`const ${n.schemaVar} = new mongoose.Schema(\n  {\n${lines.join('\n')}\n  },\n  ${schemaOptions},\n);`]
    for (const ix of indexList(t)) {
      const spec = `{ ${ix.fields.map((f) => `${key(f)}: 1`).join(', ')} }`
      const single = ix.fields.length === 1 && !ix.unique && !ix.name
      if (single) continue // already written as `index: true`
      const opts = []
      if (ix.unique) opts.push('unique: true')
      if (ix.sparse) opts.push('sparse: true')
      if (ix.name) opts.push(`name: ${JSON.stringify(ix.name)}`)
      block.push(`${n.schemaVar}.index(${spec}${opts.length ? `, { ${opts.join(', ')} }` : ''});`)
    }
    block.push('', `const ${n.constName} = mongoose.model(${JSON.stringify(n.modelName)}, ${n.schemaVar}, ${JSON.stringify(t.name)});`)
    blocks.push(block.join('\n'))
    exportsList.push(n.constName)
  }
  const header = style === 'esm' ? 'import mongoose from "mongoose";' : 'const mongoose = require("mongoose");'
  const footer =
    style === 'esm'
      ? exportsList.length === 1 ? `export default ${exportsList[0]};` : `export { ${exportsList.join(', ')} };`
      : exportsList.length === 1 ? `module.exports = ${exportsList[0]};` : `module.exports = { ${exportsList.join(', ')} };`
  return [...(warnings.length ? [...warnings, ''] : []), header, '', blocks.join('\n\n'), '', footer].join('\n') + '\n'
}

/** Switch generated / hand-written Mongoose source between ES modules and CommonJS (simple, common patterns only). */
export function convertMongooseModuleStyle(code, style) {
  const from = '(["\'][^"\']+["\'])'
  let out = String(code)
  if (style === 'cjs') {
    out = out
      .replace(new RegExp('^import\\s+(\\w+)\\s+from\\s+' + from + ';?[ \\t]*$', 'gm'), 'const $1 = require($2);')
      .replace(new RegExp('^import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+' + from + ';?[ \\t]*$', 'gm'), 'const $1 = require($2);')
      .replace(new RegExp('^import\\s+\\{([^}]*)\\}\\s+from\\s+' + from + ';?[ \\t]*$', 'gm'), 'const {$1} = require($2);')
      .replace(/^export\s+default\s+(\w+);?[ \t]*$/m, 'module.exports = $1;')
      .replace(/^export\s+\{([^}]*)\};?[ \t]*$/m, 'module.exports = {$1};')
  } else {
    out = out
      .replace(new RegExp('^const\\s+(\\w+)\\s*=\\s*require\\(' + from + '\\);?[ \\t]*$', 'gm'), 'import $1 from $2;')
      .replace(new RegExp('^const\\s+\\{([^}]*)\\}\\s*=\\s*require\\(' + from + '\\);?[ \\t]*$', 'gm'), 'import {$1} from $2;')
      .replace(/^module\.exports\s*=\s*\{([^}]*)\};?[ \t]*$/m, 'export {$1};')
      .replace(/^module\.exports\s*=\s*(\w+);?[ \t]*$/m, 'export default $1;')
  }
  return out
}

/**
 * Appends the models of `added` to `existing` (both Mongoose source): the duplicate `import mongoose` line is dropped and
 * `export default X` becomes a named export, so the result stays one valid module.
 */
export function mergeMongooseSources(existing, added) {
  const base = String(existing).trimEnd()
  if (!base) return String(added)
  let extra = String(added)
    .replace(/^\s*import\s+mongoose\s+from\s+["']mongoose["'];?\s*$/m, '')
    .replace(/^\s*const\s+mongoose\s*=\s*require\(["']mongoose["']\);?\s*$/m, '')
    .replace(/^export\s+default\s+(\w+);?\s*$/m, 'export { $1 };')
    .replace(/^module\.exports\s*=\s*(\w+);?\s*$/m, 'export { $1 };')
  extra = extra.trim()
  return `${base}\n\n${extra}\n`
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

function propSchema(schema, f, refInfo, seen, strict) {
  const array = isArrayType(f.type)
  const emb = embeddedTarget(schema, f)
  // strict (hand-written style): a field that always gets a default value, and arrays (Mongoose starts them as []), are never null
  const alwaysSet = strict && ((f.default != null && !(f.defaultKind === 'literal' && f.default === 'null')) || array)
  const optional = !(f.notNull || f.pk) && !alwaysSet
  let node
  if (emb) node = seen.has(emb.name) ? { bsonType: 'object' } : objectSchema(schema, emb, new Set([...seen, emb.name]), strict, true)
  else if (refInfo || f.refModel) node = { bsonType: 'objectId' }
  else {
    const bson = bsonOf(baseType(f.type))
    node = bson ? { bsonType: bson } : {}
  }
  if (f.enum?.length && !emb) node.enum = optional ? [...f.enum, null] : [...f.enum]
  if (f.note) node.description = f.note
  return withNull(array ? { bsonType: 'array', items: withNull(node, true), ...(f.note ? { description: f.note } : {}) } : node, optional)
}

function objectSchema(schema, table, seen, strict = false, embedded = false) {
  const { map, extra } = collectRefFields(schema)
  const refFields = map.get(table.name) ?? new Map()
  const properties = {}
  const required = []
  // strict (hand-written style): Mongoose gives every document, and every sub-document unless `_id: false`, an ObjectId _id
  if (strict && !table.fields.some((f) => f.name === '_id') && !(embedded && table.noId)) properties._id = { bsonType: 'objectId' }
  for (const f of table.fields) {
    properties[f.name] = propSchema(schema, f, refFields.get(f.name), seen, strict)
    if ((f.notNull || f.pk) && f.name !== '_id') required.push(f.name)
  }
  for (const e of extra.get(table.name) ?? []) properties[e.name] = { bsonType: ['array', 'null'], items: { bsonType: 'objectId' } }
  const node = { bsonType: 'object' }
  if (strict && !embedded) node.title = `${table.name} validation`
  if (required.length) node.required = required
  if (strict) node.additionalProperties = false
  node.properties = properties
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

/**
 * `{ "$jsonSchema": { ... } }` documents (the format used by `validator` in createCollection / collMod).
 * One collection -> the document itself; several -> an object keyed by collection name.
 * @param {import('../model.js').Schema} input
 * @param {{ strict?: boolean }} [options]  strict (default): additionalProperties false, titles and _id properties like Mongoose enforces
 */
export function toValidatorJson(input, options = {}) {
  const strict = options.strict !== false
  const schema = useMongoIds(input)
  const roots = rootTables(schema)
  const docs = roots.map((t) => [t.name, { $jsonSchema: objectSchema(schema, t, new Set([t.name]), strict) }])
  if (docs.length === 1) return JSON.stringify(docs[0][1], null, 2) + '\n'
  return JSON.stringify(Object.fromEntries(docs), null, 2) + '\n'
}

const collRef = (n) => (/^[A-Za-z_$][\w$]*$/.test(n) ? `db.${n}` : `db.getCollection(${JSON.stringify(n)})`)
