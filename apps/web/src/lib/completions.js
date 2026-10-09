import { snippetCompletion } from '@codemirror/autocomplete'

export const SQL_TYPES = [
  ['int', 'integer'],
  ['bigint', '64-bit integer'],
  ['smallint', '16-bit integer'],
  ['decimal(10,2)', 'exact number'],
  ['numeric(10,2)', 'exact number'],
  ['float', 'floating point'],
  ['double', 'double precision'],
  ['varchar(255)', 'text, max length'],
  ['char(10)', 'fixed-length text'],
  ['text', 'long text'],
  ['boolean', 'true / false'],
  ['date', 'date only'],
  ['time', 'time only'],
  ['timestamp', 'date + time'],
  ['datetime', 'date + time (MySQL)'],
  ['uuid', 'UUID'],
  ['json', 'JSON document'],
  ['jsonb', 'JSON (PostgreSQL)'],
  ['blob', 'binary data'],
  ['bytea', 'binary (PostgreSQL)'],
  ['int[]', 'array (PostgreSQL)'],
  ['varchar(255)[]', 'array (PostgreSQL)'],
]

export const MONGO_TYPES = [
  ['string', 'text'],
  ['int', '32-bit integer'],
  ['long', '64-bit integer'],
  ['double', 'floating point'],
  ['decimal', 'Decimal128'],
  ['bool', 'true / false'],
  ['date', 'date + time'],
  ['objectid', 'ObjectId (_id or a reference)'],
  ['object', 'free-form sub-document (Mixed)'],
  ['json', 'any JSON value (Mixed)'],
  ['buffer', 'binary data'],
  ['string[]', 'array of strings'],
  ['int[]', 'array of integers'],
  ['double[]', 'array of numbers'],
  ['objectid[]', 'array of ObjectIds'],
  ['object[]', 'array of sub-documents (Mixed)'],
]

const SETTINGS = [
  ['pk', 'primary key'],
  ['primary key', 'same as pk'],
  ['unique', 'unique value'],
  ['not null', 'required'],
  ['null', 'optional'],
  ['increment', 'auto increment'],
  ['default: ', 'default value, e.g. default: 0'],
  ['note: ', "description, e.g. note: 'text'"],
  ['ref: > ', 'relation, e.g. ref: > users.id'],
]

const OPERATORS = [
  ['>', 'many-to-one (left is many)'],
  ['<', 'one-to-many (left is one)'],
  ['-', 'one-to-one'],
  ['<>', 'many-to-many'],
]

/** Which block is the cursor in? 'table' | 'indexes' | null (top level) */
function blockAt(state, lineNumber) {
  let depth = 0
  for (let n = lineNumber - 1; n >= 1; n--) {
    const t = state.doc.line(n).text.replace(/\/\/.*$/, '').trim()
    if (t === '}') depth++
    else if (t.endsWith('{')) {
      if (depth > 0) depth--
      else return /^Table\b/i.test(t) ? 'table' : /^indexes\b/i.test(t) ? 'indexes' : null
    }
  }
  return null
}

const opt = (label, detail, type = 'keyword', boost = 0) => ({ label, detail, type, boost })

const quoteIdent = (n) => (/^[\p{L}_][\p{L}\p{M}\p{N}_$]*$/u.test(n) ? n : `"${n.replace(/"/g, "'")}"`)

/** true when `//` appears outside a quoted string */
function hasComment(text) {
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '/' && text[i + 1] === '/') return true
  }
  return false
}

/** Text of the unclosed `[ ... ]` settings block at the end of `before` (null when not inside one). */
function openSettings(before) {
  let quote = null
  let open = -1
  for (let i = 0; i < before.length; i++) {
    const ch = before[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '[' && i > 0 && /\s/.test(before[i - 1])) open = i
    else if (ch === ']') open = -1
  }
  // inside a quoted string within the block: no suggestions
  return open === -1 || quote ? null : before.slice(open + 1)
}

/**
 * CodeMirror completion source for the DSL.
 * @param {() => 'sql'|'mongodb'} getMode
 * @param {() => import('@er/schema').Schema} getSchema
 */
export function dslCompletions(getMode, getSchema) {
  return (context) => {
    const { state, pos } = context
    const line = state.doc.lineAt(pos)
    const before = line.text.slice(0, pos - line.from)
    if (hasComment(before)) return null
    const schema = getSchema()
    const mongo = getMode() === 'mongodb'

    // Ref: a.b > c.d  - operators and table.field targets
    if (/^\s*Ref\b/i.test(before)) {
      if (/^\s*Ref\s*\w*:\s*\S+\s+$/i.test(before)) {
        return { from: pos, options: OPERATORS.map(([l, d]) => opt(l, d, 'keyword')), validFor: /^[<>-]*$/ }
      }
      const m = before.match(/[^\s]*$/)
      const from = pos - m[0].length
      return { from, options: fieldTargets(schema), validFor: /^[^\s]*$/ }
    }

    const block = blockAt(state, line.number)
    if (block === 'indexes') return null

    // inside [ ... ] settings
    const inside = block === 'table' ? openSettings(before) : null
    if (inside !== null) {
      const refm = inside.match(/ref\s*:\s*(?:<>|[<>-])?\s*([^\s,\]]*)$/i)
      if (refm) {
        return { from: pos - refm[1].length, options: fieldTargets(schema), validFor: /^[^\s,\]]*$/ }
      }
      const seg = inside.match(/(?:^|,)\s*([\w ]*)$/)
      if (seg) {
        return {
          from: pos - seg[1].length,
          options: SETTINGS.map(([l, d]) => opt(l, d, 'property')),
          validFor: /^[\w ]*$/,
        }
      }
      return null
    }

    // field type
    const tm = before.match(/^\s*(?:"[^"]+"|`[^`]+`|[\p{L}\p{M}\p{N}_$]+)\s+([^\s"'`]*)$/u)
    if (block === 'table' && tm) {
      const typed = tm[1]
      const base = mongo ? MONGO_TYPES : SQL_TYPES
      const options = base.map(([l, d], i) => opt(l, d, 'type', 50 - i))
      if (mongo) {
        for (const t of schema.tables) {
          options.push(opt(t.name, 'embedded document', 'class', 60))
          options.push(opt(`${t.name}[]`, 'array of embedded documents', 'class', 55))
        }
      }
      return { from: pos - typed.length, options, validFor: /^[^\s"'`]*$/ }
    }

    // start of a line
    const word = context.matchBefore(/[\p{L}\p{M}\p{N}_$]*/u)
    if (!word || (word.from === word.to && !context.explicit)) return null
    if (/\S/.test(before.slice(0, word.from - line.from))) return null
    if (block === null) {
      return {
        from: word.from,
        options: [
          snippetCompletion('Table ${name} {\n\t${id} ' + (mongo ? 'objectid' : 'int') + ' [pk]\n}', { label: 'Table', detail: 'new table', type: 'keyword', boost: 10 }),
          snippetCompletion('Ref: ${table}.${field} > ${other}.${field}', { label: 'Ref', detail: 'new relation', type: 'keyword', boost: 5 }),
        ],
        validFor: /^[\p{L}\p{M}\p{N}_$]*$/u,
      }
    }
    if (block === 'table') {
      return {
        from: word.from,
        options: [snippetCompletion('indexes {\n\t(${a}, ${b}) [unique]\n}', { label: 'indexes', detail: 'index block', type: 'keyword' })],
        validFor: /^[\p{L}\p{M}\p{N}_$]*$/u,
      }
    }
    return null
  }
}

function fieldTargets(schema) {
  const out = []
  for (const t of schema.tables) {
    for (const f of t.fields) {
      out.push({ ...opt(`${t.name}.${f.name}`, f.type, 'variable', f.pk ? 10 : 0), apply: `${quoteIdent(t.name)}.${quoteIdent(f.name)}` })
    }
  }
  return out
}
