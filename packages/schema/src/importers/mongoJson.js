import { emptySchema, newField } from '../model.js'

const MAX_DEPTH = 8
const cleanName = (n, fallback) => String(n).replace(/[^\p{L}\p{M}\p{N}_$]+/gu, '_').replace(/^_+|_+$/g, '') || fallback
const pascal = (n) => n.replace(/(^|[^\p{L}\p{M}\p{N}]+)([\p{L}\p{M}\p{N}])/gu, (_, __, c) => c.toUpperCase())
const singular = (n) => n.replace(/ies$/i, 'y').replace(/s$/i, '')
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Split text holding several concatenated JSON documents (mongoexport --pretty) into documents. */
function splitConcatenated(text) {
  const docs = []
  let depth = 0
  let start = -1
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') {
      if (depth++ === 0) start = i
    } else if (ch === '}' && --depth === 0 && start !== -1) {
      docs.push(JSON.parse(text.slice(start, i + 1)))
      start = -1
    }
  }
  if (depth !== 0 || !docs.length) throw new Error('not valid JSON')
  return docs
}

/**
 * Parse mongoexport output: a JSON array, JSON Lines (or pretty-printed documents one after another),
 * or { collection: [docs] }. Returns an object { collectionName: docs[] }.
 */
export function parseMongoExport(text, fallbackName = 'collection') {
  const t = String(text).trim().replace(/^﻿/, '')
  const name = cleanName(fallbackName, 'collection')
  if (!t) return {}
  let parsed
  try {
    parsed = JSON.parse(t)
  } catch (whole) {
    const lines = t.split(/\r?\n/).filter((l) => l.trim())
    try {
      return { [name]: lines.map((l, i) => {
        try {
          return JSON.parse(l)
        } catch {
          throw Object.assign(new Error(`Line ${i + 1}: invalid JSON`), { line: i + 1 })
        }
      }) }
    } catch (lineError) {
      try {
        return { [name]: splitConcatenated(t) }
      } catch {
        throw new Error(lineError.line ? lineError.message : `Invalid JSON: ${whole.message}`)
      }
    }
  }
  if (Array.isArray(parsed)) return { [name]: parsed }
  if (isPlainObject(parsed)) {
    const keys = Object.keys(parsed)
    // { users: [...], orders: [...] } - every value is a list of documents (not a document that merely has array fields)
    const isCollections =
      keys.length > 0 &&
      keys.every((k) => Array.isArray(parsed[k]) && parsed[k].every(isPlainObject)) &&
      keys.some((k) => parsed[k].length > 0)
    return isCollections ? parsed : { [name]: [parsed] }
  }
  return {}
}

/** Type of one JSON / Extended JSON value. null => ignore (null), undefined => nested structure. */
function scalarType(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number') return Number.isInteger(v) ? (Math.abs(v) > 2147483647 ? 'long' : 'int') : 'double'
  if (typeof v === 'string') return 'string'
  if (typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v)
    if (keys.length === 1 || (keys.length === 2 && '$binary' in v)) {
      if ('$oid' in v) return /^[0-9a-f]{24}$/i.test(String(v.$oid)) ? 'objectid' : 'string'
      if ('$date' in v || '$timestamp' in v) return 'date'
      if ('$numberInt' in v) return 'int'
      if ('$numberLong' in v) return 'long'
      if ('$numberDouble' in v) return 'double'
      if ('$numberDecimal' in v) return 'decimal'
      if ('$binary' in v) return 'buffer'
      if ('$uuid' in v || '$regularExpression' in v || '$symbol' in v) return 'string'
    }
  }
  return undefined
}

function mergeTypes(types) {
  const list = [...types]
  if (list.length === 1) return list[0]
  if (list.every((t) => ['int', 'long', 'double', 'decimal'].includes(t))) {
    if (list.includes('decimal')) return 'decimal'
    if (list.includes('double')) return 'double'
    return 'long'
  }
  return 'json'
}

/**
 * Infer tables from sample documents. Nested objects / arrays of objects become
 * embedded tables referenced by field type (e.g. `address Address`, `items Order_Item[]`).
 * @param {Record<string, any[]>} collections
 */
export function mongoToSchema(collections) {
  const schema = emptySchema()

  function uniqueName(n) {
    let out = n
    let i = 2
    while (schema.tables.some((t) => t.name.toLowerCase() === out.toLowerCase())) out = `${n}${i++}`
    return out
  }

  function build(name, docs, embedded, depth) {
    const fields = new Map() // key -> { types:Set, objs:[], array:boolean }
    for (const doc of docs) {
      if (!isPlainObject(doc)) continue
      for (const [k, v] of Object.entries(doc)) {
        if (k === '') continue
        const e = fields.get(k) ?? { types: new Set(), objs: [], arrays: 0, scalars: 0 }
        const items = Array.isArray(v) ? (e.arrays++, v) : (e.scalars++, [v])
        for (const item of items) {
          const st = scalarType(item)
          if (st === null) continue
          if (st === undefined) {
            if (Array.isArray(item)) e.types.add('json')
            else e.objs.push(item)
          } else e.types.add(st)
        }
        fields.set(k, e)
      }
    }

    const table = { name, note: null, embedded, fields: [], indexes: [] }
    schema.tables.push(table)
    for (const [k, e] of fields) {
      const array = e.arrays > 0 && e.scalars === 0 // mixed scalar / array usage is just "any value"
      let type
      if (e.arrays > 0 && e.scalars > 0) type = 'json'
      else if (e.objs.length && depth < MAX_DEPTH) {
        const sub = uniqueName(pascal(`${name}_${array ? singular(k) : k}`))
        build(sub, e.objs, true, depth + 1)
        type = e.types.size ? 'json' : sub
      } else if (e.objs.length) type = 'object'
      else if (e.types.size === 0) type = 'string'
      else type = mergeTypes(e.types)
      if (array) type += '[]'
      const f = newField(k, type)
      if (k === '_id') {
        f.pk = true
        f.notNull = true
      }
      table.fields.push(f)
    }
    if (!embedded && !table.fields.some((f) => f.name === '_id')) {
      const id = newField('_id', 'objectid')
      id.pk = true
      id.notNull = true
      table.fields.unshift(id)
    }
    return table
  }

  for (const [name, docs] of Object.entries(collections)) {
    build(uniqueName(cleanName(name, 'collection')), docs, false, 0)
  }
  return schema
}
