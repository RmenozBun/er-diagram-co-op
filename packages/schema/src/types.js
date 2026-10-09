/**
 * Canonical type names for imported SQL types (keeps the diagram readable and the
 * regenerated DDL valid in every dialect).
 * @returns {{ type: string, note: string|null }}
 */
export function normalizeImportedType(raw) {
  let t = String(raw).trim().replace(/\s+/g, ' ').toLowerCase()
  let note = null
  t = t.replace(/\b(unsigned|signed|zerofill)\b/g, '').replace(/\s+/g, ' ').trim()
  t = t
    .replace(/^character varying/, 'varchar')
    .replace(/^character\b/, 'char')
    .replace(/^bpchar\b/, 'char')
    .replace(/^double precision$/, 'double')
    .replace(/^timestamp(\(\d+\))? without time zone$/, 'timestamp')
    .replace(/^timestamp(\(\d+\))? with time zone$/, 'timestamptz')
    .replace(/^time(\(\d+\))? without time zone$/, 'time')
    .replace(/^time(\(\d+\))? with time zone$/, 'timetz')
    .replace(/^int4$/, 'int')
    .replace(/^int8$/, 'bigint')
    .replace(/^int2$/, 'smallint')
    .replace(/^float8$/, 'double')
    .replace(/^float4$/, 'float')
    .replace(/^bool$/, 'boolean')
    .replace(/^tinyint\(1\)$/, 'boolean')
    .replace(/^tinyint\b(\(\d+\))?$/, 'smallint')
    .replace(/^mediumint\b(\(\d+\))?$/, 'int')
    .replace(/^(int|integer|bigint|smallint)\(\d+\)$/, '$1')
    .replace(/^(tinytext|mediumtext|longtext)$/, 'text')
    .replace(/^(tinyblob|mediumblob|longblob)$/, 'blob')
  const en = t.match(/^(enum|set)\s*\((.*)\)$/)
  if (en) {
    note = `${en[1]}: ${en[2].replace(/'/g, '').replace(/\s*,\s*/g, ', ')}`
    t = 'varchar(255)'
  }
  return { type: t, note }
}

import { embeddedTarget, rootTables } from './relations.js'
import { defaultKind } from './model.js'

const MONGO_OF = {
  int: 'int', integer: 'int', smallint: 'int', bigint: 'long', double: 'double', float: 'double', real: 'double',
  decimal: 'decimal', numeric: 'decimal', boolean: 'bool', bool: 'bool', date: 'date', timestamp: 'date', timestamptz: 'date',
  datetime: 'date', time: 'string', text: 'string', varchar: 'string', char: 'string', uuid: 'string', json: 'json', jsonb: 'json',
  blob: 'buffer', bytea: 'buffer',
}

/** "varchar(255)" -> "string", "int[]" -> "int[]", unknown names are kept. */
export function sqlTypeToMongo(type) {
  const isArray = /\[\]$/.test(String(type))
  const base = String(type).replace(/\[\]$/, '').replace(/\(.*\)$/, '').trim().toLowerCase()
  const mapped = MONGO_OF[base]
  return mapped ? mapped + (isArray ? '[]' : '') : String(type)
}

/** Returns copies of the tables with MongoDB type names; a primary key called "id" becomes "_id". */
export function tablesToMongo(tables) {
  return tables.map((t) => ({
    ...t,
    fields: t.fields.map((f) => ({
      ...f,
      type: sqlTypeToMongo(f.type),
      name: f.pk && f.name === 'id' && !t.fields.some((x) => x.name === '_id') ? '_id' : f.name,
    })),
  }))
}

const SQL_OF = {
  string: 'varchar(255)', number: 'double', int: 'int', long: 'bigint', double: 'double', decimal: 'decimal(18,4)', bool: 'boolean',
  date: 'timestamp', objectid: 'varchar(24)', buffer: 'blob', json: 'jsonb', object: 'jsonb', mixed: 'jsonb',
}

/** "string" -> "varchar(255)", "number[]" -> "double[]"; names of embedded tables and unknown types are kept. */
export function mongoTypeToSql(type) {
  const isArray = /\[\]$/.test(String(type))
  const base = String(type).replace(/\[\]$/, '').trim()
  const mapped = SQL_OF[base.toLowerCase()]
  return mapped ? mapped + (isArray ? '[]' : '') : String(type)
}

/** Returns copies of the tables with SQL type names (the `_id` primary key keeps its name). */
export function tablesToSql(tables) {
  const embedded = new Set(tables.map((t) => t.name.toLowerCase()))
  return tables.map((t) => ({
    ...t,
    note: t.note && /^Mongoose model /.test(t.note) ? null : t.note,
    fields: t.fields.map((f) => {
      const base = String(f.type).replace(/\[\]$/, '').toLowerCase()
      return embedded.has(base) ? f : { ...f, type: mongoTypeToSql(f.type) }
    }),
  }))
}

// default expressions that mean the same thing in SQL; anything else written as an expression is JavaScript (`nowLocal`, `uuid()` ...)
const SQL_DEFAULT_OK = /^(now\(\)|current_timestamp(\(\))?|current_date|current_time|gen_random_uuid\(\)|uuid_generate_v4\(\))$/i

/**
 * A whole MongoDB schema -> a schema that is valid SQL: embedded documents (sub-document types) are not tables, a field that holds one
 * (or an array of them) becomes a json column, ObjectId / string / number ... get SQL type names, and relations to dropped tables go away.
 * @param {import('./model.js').Schema} schema
 */
export function mongoSchemaToSql(schema) {
  const keep = rootTables(schema)
  const keepNames = new Set(keep.map((t) => t.name))
  const tables = keep.map((t) => ({
    ...t,
    embedded: false,
    note: t.note && /^Mongoose model /.test(t.note) ? null : t.note,
    fields: t.fields.map((f) => {
      // a JavaScript default (a function or variable) is not a SQL default: keep it as a note instead of writing invalid SQL
      const js = f.default != null && defaultKind(f) === 'expr' && !SQL_DEFAULT_OK.test(f.default)
      const base = js ? { ...f, default: null, defaultKind: null, note: [f.note, `JS default: ${f.default}`].filter(Boolean).join('; ') } : f
      const emb = embeddedTarget(schema, base)
      if (emb && !keepNames.has(emb.name)) return { ...base, type: 'jsonb', enum: null }
      return emb ? base : { ...base, type: mongoTypeToSql(base.type) }
    }),
  }))
  const refs = schema.refs.filter((r) => keepNames.has(r.from.table) && keepNames.has(r.to.table))
  return { ...schema, tables, refs }
}
