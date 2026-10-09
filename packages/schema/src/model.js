/**
 * @typedef {Object} Field
 * @property {string} name
 * @property {string} type            e.g. "int", "varchar(255)", "objectid", "string[]"
 * @property {boolean} pk
 * @property {boolean} unique
 * @property {boolean} notNull
 * @property {boolean} increment
 * @property {string|null} default
 * @property {'expr'|'string'|'literal'|null} defaultKind  expression (now()), quoted text, or bare literal (5, true)
 * @property {string|null} note
 * @property {Array<string|number>|null} enum  allowed values (MongoDB enum / SQL check constraint)
 * @property {string|null} refModel  MongoDB: name of the referenced Mongoose model when it is not part of this diagram
 * @property {Object|null} opts  MongoDB: extra schema options with literal values (trim, min, maxlength ...)
 *
 * @typedef {Object} Index
 * @property {string[]} fields
 * @property {boolean} unique
 * @property {string|null} name
 *
 * @typedef {Object} Table
 * @property {string} name
 * @property {string|null} note
 * @property {boolean} embedded   MongoDB: sub-document only, not its own collection
 * @property {Field[]} fields
 * @property {Index[]} indexes
 *
 * @typedef {Object} Ref
 * @property {{table:string, field:string, fields?:string[]}} from  the side written first (`fields` = all columns of a composite key, `field` = the first one)
 * @property {{table:string, field:string, fields?:string[]}} to
 * @property {'>'|'<'|'-'|'<>'} type  '>' many-to-one (from is many), '<' one-to-many, '-' one-to-one, '<>' many-to-many
 *
 * @typedef {Object} Schema
 * @property {Table[]} tables
 * @property {Ref[]} refs
 * @property {{line:number, message:string}[]} errors
 */

/** @returns {Schema} */
export function emptySchema() {
  return { tables: [], refs: [], errors: [] }
}

/** @returns {Field} */
export function newField(name, type = 'varchar') {
  return { name, type, pk: false, unique: false, notNull: false, increment: false, default: null, defaultKind: null, note: null, enum: null, refModel: null, opts: null }
}

export function findTable(schema, name) {
  return schema.tables.find((t) => t.name === name)
}

/**
 * Normalise a ref so that `parent` is the "one" side and `child` the "many" side.
 * For one-to-one the `from` side is treated as the child (the one holding the key).
 * Returns null for many-to-many.
 */
export function refSides(ref) {
  switch (ref.type) {
    case '>':
      return { parent: ref.to, child: ref.from, many: true }
    case '<':
      return { parent: ref.from, child: ref.to, many: true }
    case '-':
      return { parent: ref.to, child: ref.from, many: false }
    default:
      return null
  }
}

export function baseType(type) {
  return String(type).replace(/\[\]$/, '').replace(/\(.*\)$/, '').trim().toLowerCase()
}

export function isArrayType(type) {
  return /\[\]$/.test(String(type).trim())
}

/** How a default value is written: expression (now()), string literal, or bare literal (5, true, null). */
export function defaultKind(f) {
  if (f.defaultKind) return f.defaultKind
  if (/^-?\d+(\.\d+)?$|^(true|false|null)$/i.test(f.default)) return 'literal'
  return /\(.*\)$|^current_/i.test(f.default) ? 'expr' : 'string'
}

/** Columns of a relation endpoint: [field] for a normal ref, the full list for a composite (multi-column) key. */
export function endpointFields(ep) {
  return ep.fields?.length ? ep.fields : [ep.field]
}
