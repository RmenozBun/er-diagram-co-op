import { emptySchema, newField } from '../model.js'

/**
 * MongoDB `$jsonSchema` validators -> Schema. Accepted shapes:
 *   { "$jsonSchema": { ... } }                       one collection (name taken from the file name)
 *   { "users": { "$jsonSchema": ... }, "orders": ... }
 *   [ { name, options: { validator: { $jsonSchema } } } ]   (db.getCollectionInfos())
 */

const words = (n) => String(n).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)
const pascal = (n) => words(n).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
const singular = (n) => (/ies$/i.test(n) ? n.replace(/ies$/i, 'y') : /(ss|us)$/i.test(n) ? n : n.replace(/s$/i, ''))
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Collection name from a file name such as "users_collection_validator.json". */
export function collectionNameFromFile(fileName) {
  const base = String(fileName).replace(/\.[^.]+$/, '')
  const cleaned = base.replace(/[_\- .]*(collection)?[_\- .]*(validator|validation|schema|jsonschema)s?$/i, '').replace(/[^\p{L}\p{M}\p{N}_$]+/gu, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'collection'
}

/** @returns {{ name: string, node: object }[]} empty when the JSON is not a validator */
export function findValidators(json, hintName = 'collection') {
  if (isObj(json) && isObj(json.$jsonSchema)) return [{ name: hintName, node: json.$jsonSchema }]
  if (isObj(json) && isObj(json.validator?.$jsonSchema)) return [{ name: hintName, node: json.validator.$jsonSchema }]
  if (isObj(json) && isObj(json.options?.validator?.$jsonSchema)) return [{ name: json.name ?? hintName, node: json.options.validator.$jsonSchema }]
  if (Array.isArray(json)) {
    const out = []
    for (const item of json) {
      const node = item?.options?.validator?.$jsonSchema ?? item?.validator?.$jsonSchema ?? item?.$jsonSchema
      if (isObj(node) && item.name) out.push({ name: item.name, node })
    }
    return out
  }
  if (isObj(json)) {
    const out = []
    for (const [name, v] of Object.entries(json)) {
      const node = v?.$jsonSchema ?? v?.validator?.$jsonSchema ?? v?.options?.validator?.$jsonSchema
      if (isObj(node)) out.push({ name, node })
    }
    return out
  }
  return []
}

const SIMPLE = { string: 'string', int: 'int', long: 'long', double: 'double', decimal: 'decimal', number: 'number', bool: 'bool', boolean: 'bool', date: 'date', timestamp: 'date', objectId: 'objectid', binData: 'buffer', null: null }
const kindsOf = (node) => [].concat(node.bsonType ?? node.type ?? []).filter((k) => k !== 'null')

// Descriptions written for people often hold the details the validator cannot express: pick up the obvious ones.
function fromDescription(field, description) {
  if (!description) return
  if (field.type === 'objectid') {
    const m = description.match(/\b([A-Z]\w*Model)\b/)
    if (m) field.refModel = m[1]
  }
  if (/\bunique\b|ห้ามซ้ำ/i.test(description) && !field.pk) field.unique = true
  const d = description.match(/(?:ค่าเริ่มต้น(?:คือ)?|default(?:s to| is|:)?)\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)|(null)|(true|false)|(string ว่าง|empty string))/i)
  if (d) {
    if (d[1] !== undefined || d[2] !== undefined) {
      field.default = d[1] ?? d[2]
      field.defaultKind = 'string'
    } else if (d[3] !== undefined || d[4] !== undefined || d[5] !== undefined) {
      field.default = d[3] ?? d[4] ?? d[5]
      field.defaultKind = 'literal'
    } else {
      field.default = ''
      field.defaultKind = 'string'
    }
  }
}

/**
 * @param {unknown} json parsed JSON
 * @param {string} [hintName] collection name for a single `$jsonSchema` document
 * @returns {import('../model.js').Schema | null} null when `json` does not contain a validator
 */
export function validatorToSchema(json, hintName = 'collection') {
  const found = findValidators(json, hintName)
  if (!found.length) return null
  const schema = emptySchema()
  const used = new Set(found.map((f) => f.name.toLowerCase()))
  const uniqueName = (base, prefix) => {
    let name = base || 'Embedded'
    if (used.has(name.toLowerCase()) && prefix) name = prefix + base
    const root = name
    let i = 2
    while (used.has(name.toLowerCase())) name = `${root}${i++}`
    used.add(name.toLowerCase())
    return name
  }

  const typeOf = (prop, fieldName, tableName) => {
    const kinds = kindsOf(prop)
    const kind = kinds[0]
    if (kind === 'object' || (!kind && isObj(prop.properties))) return { type: build(uniqueName(pascal(fieldName), pascal(singular(tableName))), prop, true) }
    if (kind === 'array') {
      const items = prop.items
      if (!isObj(items)) return { type: 'json[]' }
      const inner = typeOf(items, singular(fieldName), tableName)
      return { type: `${inner.type}[]` }
    }
    if (kind in SIMPLE && SIMPLE[kind]) return { type: SIMPLE[kind] }
    return { type: 'json' }
  }

  function build(name, node, embedded) {
    const table = { name, note: null, embedded, fields: [], indexes: [] }
    schema.tables.push(table)
    const required = new Set(Array.isArray(node.required) ? node.required : [])
    const props = isObj(node.properties) ? node.properties : {}
    for (const [fname, prop] of Object.entries(props)) {
      if (fname === '_id' && embedded) continue // sub-documents get an _id from Mongoose by default
      const field = newField(fname, 'json')
      field.type = typeOf(isObj(prop) ? prop : {}, fname, name).type
      if (required.has(fname)) field.notNull = true
      if (Array.isArray(prop?.enum)) {
        const values = prop.enum.filter((v) => typeof v === 'string' || typeof v === 'number')
        if (values.length) field.enum = values
      }
      if (typeof prop?.description === 'string') {
        field.note = prop.description
        fromDescription(field, prop.description)
      }
      if (fname === '_id') {
        field.pk = true
        field.notNull = true
        field.note = null
      }
      table.fields.push(field)
    }
    if (embedded && node.additionalProperties === false && !('_id' in props)) table.noId = true
    if (!embedded && !table.fields.some((f) => f.name === '_id')) {
      const id = newField('_id', 'objectid')
      id.pk = true
      id.notNull = true
      table.fields.unshift(id)
    }
    return name
  }

  for (const { name, node } of found) build(name, node, false)
  return schema
}
