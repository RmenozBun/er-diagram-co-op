import { parse } from './parser.js'
import { serialize } from './serializer.js'
import { parseMongoose } from './importers/mongoose.js'
import { toMongoose } from './generators/mongo.js'
import { tablesToMongo, tablesToSql } from './types.js'

/**
 * The text in the editor is DSL in SQL mode and real Mongoose code in MongoDB mode.
 * `parseSource` turns either into the common Schema used by the diagram and the generators.
 */
export function parseSource(text, mode) {
  return mode === 'mongodb' ? parseMongoose(text) : parse(text)
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

/** Rewrites the editor text from one mode's language to the other's (lossy: hooks, methods and comments are not carried over). */
export function convertSource(text, from, to) {
  if (from === to) return text
  const schema = parseSource(text, from)
  if (to === 'mongodb') return toMongoose({ ...schema, tables: sqlToMongoTables(schema.tables) })
  return serialize({ ...schema, tables: tablesToSql(schema.tables) })
}
