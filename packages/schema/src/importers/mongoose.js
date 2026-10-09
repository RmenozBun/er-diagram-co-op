import * as acorn from 'acorn'
import { emptySchema, newField } from '../model.js'

/**
 * Reads Mongoose model files (ESM or CommonJS) into a Schema using a real JavaScript parser:
 *
 *   const usersSchema = new mongoose.Schema({ ... }, { timestamps: false })
 *   const User = mongoose.model("UserModel", usersSchema, "users")
 *
 * Every mongoose.model(...) becomes a collection (named by its 3rd argument, or pluralised model name);
 * sub-schemas and nested objects become embedded documents. Hooks, methods, statics and virtuals are
 * ignored (they are not part of the diagram).
 */

const SCALARS = {
  String: 'string', Number: 'number', Boolean: 'bool', Date: 'date', Buffer: 'buffer', ObjectId: 'objectid', Mixed: 'json',
  Decimal128: 'decimal', Map: 'object', Object: 'json', UUID: 'string', BigInt: 'long', Int32: 'int', Double: 'double', Array: 'json[]',
}
const LITERAL_OPTS = new Set(['trim', 'lowercase', 'uppercase', 'min', 'max', 'minlength', 'maxlength', 'immutable', 'select', 'sparse'])

const pascal = (n) => String(n).replace(/(^|[^\p{L}\p{M}\p{N}]+)([\p{L}\p{M}\p{N}])/gu, (_, __, c) => c.toUpperCase()).replace(/[^\p{L}\p{M}\p{N}_$]/gu, '')
const singular = (n) => (/ies$/i.test(n) ? n.replace(/ies$/i, 'y') : /(ss|us)$/i.test(n) ? n : n.replace(/s$/i, ''))
const pluralize = (n) => {
  const w = n.toLowerCase()
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es'
  return w + 's'
}

function parseJs(source) {
  const base = { ecmaVersion: 'latest', locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }
  try {
    return acorn.parse(source, { ...base, sourceType: 'module' })
  } catch (first) {
    try {
      return acorn.parse(source, { ...base, sourceType: 'script' })
    } catch {
      throw first
    }
  }
}

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parent)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'type') continue
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, visit, node))
    else if (v && typeof v.type === 'string') walk(v, visit, node)
  }
}

const keyName = (p) => (p.computed ? null : p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null)
const propsOf = (obj) => obj.properties.filter((p) => p.type === 'Property')
const propOf = (obj, name) => propsOf(obj).find((p) => keyName(p) === name)
const memberName = (n) => (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' ? n.property.name : null)

/**
 * @param {string} source
 * @returns {import('../model.js').Schema}
 */
export function parseMongoose(source) {
  const schema = emptySchema()
  const text = String(source ?? '')
  if (!text.trim()) return schema

  let ast
  try {
    ast = parseJs(text)
  } catch (e) {
    schema.errors.push({ line: e.loc?.line ?? 1, message: String(e.message).replace(/\s*\(\d+:\d+\)\s*$/, '') })
    return schema
  }
  const src = (n) => text.slice(n.start, n.end)
  const lineOf = (n) => n.loc?.start.line ?? 1

  const isSchemaCtor = (n) =>
    n &&
    (n.type === 'NewExpression' || n.type === 'CallExpression') &&
    ((n.callee.type === 'Identifier' && n.callee.name === 'Schema') || (memberName(n.callee) === 'Schema' && n.callee.object.type !== 'MemberExpression'))
  const schemaParts = (n) => ({ def: n.arguments[0]?.type === 'ObjectExpression' ? n.arguments[0] : null, opts: n.arguments[1]?.type === 'ObjectExpression' ? n.arguments[1] : null, line: lineOf(n) })

  // ---- 1. schema variables and models
  const schemaVars = new Map() // variable name -> { def, opts, line }
  const models = [] // { modelName, schemaVar | inline, collection, line }
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && isSchemaCtor(n.init)) schemaVars.set(n.id.name, schemaParts(n.init))
    if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && isSchemaCtor(n.right)) schemaVars.set(n.left.name, schemaParts(n.right))
    if (n.type === 'CallExpression' && ((n.callee.type === 'Identifier' && n.callee.name === 'model') || memberName(n.callee) === 'model')) {
      const [nameArg, schemaArg, collArg] = n.arguments
      if (nameArg?.type !== 'Literal' || typeof nameArg.value !== 'string' || !schemaArg) return
      const entry = { modelName: nameArg.value, line: lineOf(n), collection: collArg?.type === 'Literal' && typeof collArg.value === 'string' ? collArg.value : pluralize(nameArg.value) }
      if (schemaArg.type === 'Identifier') entry.schemaVar = schemaArg.name
      else if (isSchemaCtor(schemaArg)) entry.inline = schemaParts(schemaArg)
      else return
      models.push(entry)
    }
  })

  if (!schemaVars.size && !models.some((m) => m.inline)) {
    schema.errors.push({ line: 1, message: 'No mongoose.Schema found. Expected something like: const xSchema = new mongoose.Schema({ ... }); mongoose.model("X", xSchema, "xs")' })
    return schema
  }

  // ---- 2. tables
  const usedNames = new Set()
  const uniqueName = (base, fallbackPrefix = '') => {
    let name = base || 'Collection'
    if (usedNames.has(name.toLowerCase()) && fallbackPrefix) name = fallbackPrefix + base
    let i = 2
    const root = name
    while (usedNames.has(name.toLowerCase())) name = `${root}${i++}`
    usedNames.add(name.toLowerCase())
    return name
  }
  const embeddedBySchemaVar = new Map()
  const modelToTable = new Map()
  const pendingRefs = []

  const typeOfNode = (node, ctx) => {
    if (!node) return { type: 'json' }
    switch (node.type) {
      case 'Identifier':
        if (SCALARS[node.name]) return { type: SCALARS[node.name] }
        if (schemaVars.has(node.name)) return { type: embeddedFromSchemaVar(node.name, ctx) }
        return { type: 'json' }
      case 'MemberExpression': {
        const last = memberName(node)
        return { type: (last && SCALARS[last]) || 'json' }
      }
      case 'Literal':
        return { type: (typeof node.value === 'string' && SCALARS[node.value.charAt(0).toUpperCase() + node.value.slice(1)]) || 'json' }
      case 'ArrayExpression': {
        const el = node.elements[0]
        if (!el) return { type: 'json[]', isArray: true }
        const inner = elementType(el, ctx)
        return { type: `${inner.type}[]`, isArray: true, elementOpts: inner.opts }
      }
      case 'ObjectExpression':
        return { type: embeddedFromObject(node, ctx) }
      case 'NewExpression':
      case 'CallExpression':
        if (isSchemaCtor(node)) return { type: embeddedFromInline(schemaParts(node), ctx) }
        return { type: 'json' }
      default:
        return { type: 'json' }
    }
  }

  const isTypeLike = (n) =>
    n.type === 'Identifier' || n.type === 'MemberExpression' || n.type === 'ArrayExpression' || n.type === 'Literal' || isSchemaCtor(n)
  const isOptionsObject = (n) => {
    if (n.type !== 'ObjectExpression') return false
    const t = propOf(n, 'type')
    return Boolean(t && isTypeLike(t.value))
  }

  const elementType = (el, ctx) => {
    if (el.type === 'ObjectExpression' && isOptionsObject(el)) {
      const t = typeOfNode(propOf(el, 'type').value, ctx)
      return { type: t.type, opts: el }
    }
    if (el.type === 'ObjectExpression') return { type: embeddedFromObject(el, ctx, true) }
    return typeOfNode(el, ctx)
  }

  const embeddedFromSchemaVar = (varName, ctx) => {
    if (embeddedBySchemaVar.has(varName)) return embeddedBySchemaVar.get(varName)
    const name = uniqueName(pascal(varName.replace(/Schema$/i, '')) || 'Embedded')
    embeddedBySchemaVar.set(varName, name)
    const parts = schemaVars.get(varName)
    buildTable(name, parts.def, parts.opts, { embedded: true })
    return name
  }
  const embeddedFromInline = (parts, ctx) => {
    const name = uniqueName(pascal(singular(ctx.fieldName)) || 'Embedded', pascal(singular(ctx.tableName)))
    buildTable(name, parts.def, parts.opts, { embedded: true })
    return name
  }
  const embeddedFromObject = (obj, ctx, asArrayItem = false) => {
    const base = pascal(asArrayItem ? singular(ctx.fieldName) : ctx.fieldName) || 'Embedded'
    const name = uniqueName(base, pascal(singular(ctx.tableName)))
    buildTable(name, obj, null, { embedded: true })
    return name
  }

  const literalOf = (n) => {
    if (n.type === 'Literal' && !n.regex) return n.value
    if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return -n.argument.value
    if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked
    return undefined
  }

  const defaultOf = (n) => {
    const lit = literalOf(n)
    if (lit !== undefined) {
      if (lit === null) return { value: 'null', kind: 'literal' }
      return typeof lit === 'string' ? { value: lit, kind: 'string' } : { value: String(lit), kind: 'literal' }
    }
    if (n.type === 'ArrayExpression' || n.type === 'ObjectExpression') return null
    if (memberName(n) === 'now' && n.object.type === 'Identifier' && n.object.name === 'Date') return { value: 'now()', kind: 'expr' }
    if (n.type === 'CallExpression' && n.arguments.length === 0 && memberName(n.callee) === 'now' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'Date') return { value: 'now()', kind: 'expr' }
    if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression') return null
    const raw = src(n)
    return raw.length <= 120 && !raw.includes('\n') ? { value: raw, kind: 'expr' } : null
  }

  const applyOptions = (field, table, optsObj, { arrayItem = false } = {}) => {
    for (const p of propsOf(optsObj)) {
      const k = keyName(p)
      const v = p.value
      if (k === 'type') continue
      if (k === 'required' && !arrayItem) {
        if ((v.type === 'Literal' && v.value === true) || (v.type === 'ArrayExpression' && v.elements[0]?.type === 'Literal' && v.elements[0].value === true)) field.notNull = true
      } else if (k === 'unique' && !arrayItem) {
        if (v.type === 'Literal' && v.value === true) field.unique = true
      } else if (k === 'default' && !arrayItem) {
        const d = defaultOf(v)
        if (d) {
          field.default = d.value
          field.defaultKind = d.kind
        }
      } else if (k === 'enum') {
        const list = v.type === 'ObjectExpression' ? propOf(v, 'values')?.value : v
        if (list?.type === 'ArrayExpression') {
          const values = list.elements.map((e) => (e ? literalOf(e) : undefined))
          if (values.length && values.every((x) => typeof x === 'string' || typeof x === 'number')) field.enum = values
        }
      } else if (k === 'ref' && !arrayItem) {
        if (v.type === 'Literal' && typeof v.value === 'string') field.refModel = v.value
        else if (v.type === 'Identifier') field.refModel = v.name
      } else if (k === 'index' && !arrayItem) {
        if (v.type === 'Literal' && v.value === true) table.indexes.push({ fields: [field.name], unique: false, name: null })
        else if (v.type === 'ObjectExpression' && literalOf(propOf(v, 'unique')?.value ?? { type: 'Literal', value: false }) === true) field.unique = true
      } else if (LITERAL_OPTS.has(k)) {
        const lit = literalOf(v)
        if (lit !== undefined && lit !== null) (field.opts ??= {})[k] = lit
      }
    }
  }

  const buildTable = (name, defObj, optsObj, { embedded, collection = null, modelName = null }) => {
    const table = { name, note: modelName ? `Mongoose model "${modelName}"` : null, embedded, fields: [], indexes: [] }
    schema.tables.push(table)
    let noId = optsObj ? literalOf(propOf(optsObj, '_id')?.value ?? { type: 'Identifier' }) === false : false
    if (noId) table.noId = true
    for (const p of defObj ? propsOf(defObj) : []) {
      const fname = keyName(p)
      if (!fname) continue
      if (fname === '_id' && p.value.type === 'Literal' && p.value.value === false) {
        noId = true
        table.noId = true
        continue
      }
      const field = newField(fname, 'json')
      const v = p.value
      const ctx = { tableName: name, fieldName: fname }
      let optsObject = null
      if (isOptionsObject(v)) {
        const t = typeOfNode(propOf(v, 'type').value, ctx)
        field.type = t.type
        optsObject = v
        if (t.elementOpts) applyOptions(field, table, t.elementOpts, { arrayItem: true })
      } else {
        const t = typeOfNode(v, ctx)
        field.type = t.type
        if (t.elementOpts) applyOptions(field, table, t.elementOpts, { arrayItem: true })
      }
      if (optsObject) applyOptions(field, table, optsObject)
      if (fname === '_id') {
        field.pk = true
        field.notNull = true
      }
      table.fields.push(field)
      if (field.refModel) pendingRefs.push({ table: table.name, field })
    }
    if (!embedded && !table.fields.some((f) => f.name === '_id') && !noId) {
      const id = newField('_id', 'objectid')
      id.pk = true
      id.notNull = true
      table.fields.unshift(id)
    }
    // timestamps option adds createdAt / updatedAt
    const ts = optsObj ? propOf(optsObj, 'timestamps')?.value : null
    if (ts && ((ts.type === 'Literal' && ts.value === true) || ts.type === 'ObjectExpression')) {
      const names = { createdAt: 'createdAt', updatedAt: 'updatedAt' }
      if (ts.type === 'ObjectExpression') {
        for (const k of ['createdAt', 'updatedAt']) {
          const e = propOf(ts, k)?.value
          if (e?.type === 'Literal' && typeof e.value === 'string') names[k] = e.value
          else if (e?.type === 'Literal' && e.value === false) names[k] = null
        }
      }
      for (const n of Object.values(names)) {
        if (n && !table.fields.some((f) => f.name === n)) {
          const f = newField(n, 'date')
          f.note = 'timestamps'
          table.fields.push(f)
        }
      }
    }
    if (collection) table.collection = collection
    return table
  }

  const used = new Set()
  for (const m of models) {
    const parts = m.inline ?? schemaVars.get(m.schemaVar)
    if (!parts) continue
    if (m.schemaVar) used.add(m.schemaVar)
    const tableName = uniqueName(m.collection)
    const table = buildTable(tableName, parts.def, parts.opts, { embedded: false, collection: m.collection, modelName: m.modelName })
    modelToTable.set(m.modelName, table)
  }
  // schemas that no model uses and that nothing embeds are collections of their own
  for (const [varName, parts] of schemaVars) {
    if (used.has(varName) || embeddedBySchemaVar.has(varName)) continue
    if (models.length) continue // with models present a stray schema is a helper: ignore
    buildTable(uniqueName(varName.replace(/Schema$/i, '') || varName), parts.def, parts.opts, { embedded: false })
  }

  // ---- 3. refs to other models of the same file become relations
  for (const { table, field } of pendingRefs) {
    const target = modelToTable.get(field.refModel)
    if (!target) continue
    const pk = target.fields.find((f) => f.pk) ?? target.fields[0]
    if (pk) schema.refs.push({ from: { table, field: field.name }, to: { table: target.name, field: pk.name }, type: '>' })
  }

  // tables created for one-off helpers must not leave `collection` noise in the model
  for (const t of schema.tables) delete t.collection
  return schema
}

/** Quick content sniffing used by the importers / mode conversion. */
export const looksLikeMongoose = (text) => /\bmongoose\b|new\s+(?:mongoose\.)?Schema\s*\(/.test(String(text))
export const looksLikeDsl = (text) => /^\s*(?:Table|Ref)\b[^\n]*[{:]/m.test(String(text)) && !looksLikeMongoose(text)
