import { parse } from './parser.js'
import { serialize } from './serializer.js'
import { parseMongoose } from './importers/mongoose.js'
import { hasViewBlocks, looksLikeFullMongoose, parseView, toMongooseView } from './mongoView.js'
import { tablesToMongo, mongoSchemaToSql } from './types.js'

/**
 * The text in the editor is DSL in SQL mode and the short Mongoose form (`Model User { ... }`, see mongoView.js) in MongoDB mode;
 * `extras` is what the short form leaves out (options, hooks, methods). A whole Mongoose module saved by an older version is still read.
 * `parseSource` turns any of them into the common Schema used by the diagram and the generators.
 */
export function parseSource(text, mode, extras = null) {
  if (mode !== 'mongodb') return parse(text)
  return looksLikeFullMongoose(text) && !hasViewBlocks(text) ? parseMongoose(text) : parseView(text, extras)
}

/**
 * SQL tables -> MongoDB collections: SQL type names become Mongo ones, a single primary key called `id` / `_id` becomes an
 * ObjectId `_id`, and `varchar(24)` / `char(24)` columns (what an ObjectId turns into when a Mongo diagram is converted to SQL) go back to ObjectId.
 */
function sqlToMongoTables(tables) {
  return tablesToMongo(tables).map((t, i) => {
    const pks = t.fields.filter((f) => f.pk)
    return {
      ...t,
      fields: t.fields.map((f, j) => {
        const original = tables[i].fields[j]
        if (/^(varchar|char)\(24\)(\[\])?$/i.test(original.type)) return { ...f, type: f.type.endsWith('[]') ? 'objectid[]' : 'objectid' }
        if (f.pk && f.name === '_id' && pks.length === 1) return { ...f, type: 'objectid', increment: false }
        return f
      }),
    }
  })
}

/**
 * Rewrites the editor text from one mode's language to the other's (lossy: hooks, methods and comments are not carried over).
 * Returns { code, extras }: `extras` only exists for MongoDB (what the short form cannot show, e.g. composite indexes).
 */
export function convertDocument({ code, extras = null }, from, to) {
  if (from === to) return { code, extras }
  const schema = parseSource(code, from, extras)
  if (to === 'mongodb') {
    const view = toMongooseView({ ...schema, tables: sqlToMongoTables(schema.tables) })
    return { code: view.text, extras: view.extras }
  }
  return { code: serialize(mongoSchemaToSql(schema)), extras: null }
}

/** Same as `convertDocument` for callers that only need the text. */
export function convertSource(text, from, to, extras = null) {
  return convertDocument({ code: text, extras }, from, to).code
}
