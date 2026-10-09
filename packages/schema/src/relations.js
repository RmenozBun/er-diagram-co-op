import { baseType, isArrayType, refSides } from './model.js'

/** Built-in type names: a table that happens to share one of these names never hijacks fields of that type. */
const PRIMITIVE_TYPES = new Set([
  'string', 'int', 'integer', 'long', 'double', 'decimal', 'numeric', 'float', 'number', 'bool', 'boolean', 'date', 'datetime',
  'timestamp', 'time', 'objectid', 'object', 'json', 'jsonb', 'buffer', 'binary', 'blob', 'text', 'varchar', 'char', 'uuid',
  'bigint', 'smallint', 'real', 'mixed', 'any', 'bytea',
])

/**
 * Everything the diagram needs to draw lines between tables.
 *  - kind "ref":   explicit Ref / inline ref (foreign key / ObjectId reference)
 *  - kind "embed": a field whose type is another table's name (MongoDB sub-document)
 * @param {import('./model.js').Schema} schema
 */
export function deriveRelations(schema) {
  const out = []
  const names = new Set(schema.tables.map((t) => t.name))
  schema.refs.forEach((r, i) => {
    if (!names.has(r.from.table) || !names.has(r.to.table)) return
    out.push({ id: `ref-${i}`, kind: 'ref', type: r.type, from: r.from, to: r.to })
  })
  for (const t of schema.tables) {
    for (const f of t.fields) {
      const real = embeddedTarget(schema, f)
      if (real) {
        out.push({
          id: `embed-${t.name}.${f.name}`,
          kind: 'embed',
          type: isArrayType(f.type) ? '<' : '-',
          from: { table: t.name, field: f.name },
          to: { table: real.name, field: null },
        })
      }
    }
  }
  return out
}

/** Name of the table a field embeds (MongoDB sub-document), or null. */
export function embeddedTarget(schema, field) {
  const target = baseType(field.type)
  if (PRIMITIVE_TYPES.has(target)) return null
  return schema.tables.find((x) => x.name.toLowerCase() === target) ?? null
}

/** Tables that are plain collections/tables (not embedded-only). */
export function rootTables(schema) {
  const embeddedNames = new Set()
  for (const t of schema.tables) {
    for (const f of t.fields) {
      const e = embeddedTarget(schema, f)
      if (e && e.name !== t.name) embeddedNames.add(e.name)
    }
  }
  return schema.tables.filter((t) => !t.embedded && !(embeddedNames.has(t.name) && !t.fields.some((f) => f.pk)))
}

export { refSides }
