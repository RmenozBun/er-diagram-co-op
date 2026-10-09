import { emptySchema, endpointFields, newField } from './model.js'

// Unicode-aware identifiers (Thai, accented letters, ...). Quoted names may contain anything but their quote.
const IDENT = '(?:"[^"]+"|`[^`]+`|[\\p{L}_][\\p{L}\\p{M}\\p{N}_$]*)'
const unq = (s) => s.replace(/^["`]|["`]$/g, '')

const QUOTES = new Set(["'", '"', '`'])

function unescapeStr(s) {
  return s.replace(/\\([\s\S])/g, (_, c) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c))
}

/** Strip surrounding quotes (and unescape \' \\ \n ...). */
function unquoteValue(v) {
  const q = v[0]
  if (v.length >= 2 && QUOTES.has(q) && v[v.length - 1] === q) return unescapeStr(v.slice(1, -1))
  return v
}

/** 'expr' = `backticked`, 'string' = 'quoted' / "quoted", 'literal' = bare number / true / null ... */
function valueKind(v) {
  if (v.startsWith('`')) return 'expr'
  if (v.startsWith("'") || v.startsWith('"')) return 'string'
  return 'literal'
}

/** `table.field` or, for composite keys, `table.(field1, field2)` */
function parseEndpoint(text) {
  const m = text.trim().match(new RegExp(`^(${IDENT})\\.(.+)$`, 'u'))
  if (!m) return null
  const table = unq(m[1])
  const rest = m[2].trim()
  const one = new RegExp(`^${IDENT}$`, 'u')
  if (rest.startsWith('(') && rest.endsWith(')')) {
    const raw = splitTop(rest.slice(1, -1))
    if (!raw.length || !raw.every((c) => one.test(c))) return null
    const fields = raw.map(unq)
    return fields.length > 1 ? { table, field: fields[0], fields } : { table, field: fields[0] }
  }
  return one.test(rest) ? { table, field: unq(rest) } : null
}

/** Split on top-level commas, respecting quotes and backslash escapes. */
function splitTop(text) {
  const out = []
  let cur = ''
  let quote = null
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      cur += ch
      if (ch === '\\' && i + 1 < text.length) cur += text[++i]
      else if (ch === quote) quote = null
    } else if (QUOTES.has(ch)) {
      quote = ch
      cur += ch
    } else if (ch === '[' || ch === '(') {
      depth++
      cur += ch
    } else if ((ch === ']' || ch === ')') && depth > 0) {
      depth--
      cur += ch
    } else if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function findComment(s) {
  let quote = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
    } else if (QUOTES.has(ch)) quote = ch
    else if (ch === '/' && s[i + 1] === '/') return i
  }
  return -1
}

/**
 * Find a trailing `[ ... ]` settings block (a top-level "[" preceded by whitespace and the
 * matching "]" being the last non-space character). `string[]` is therefore not a block.
 */
function splitSettingsBlock(line) {
  let quote = null
  let open = -1
  let depth = 0
  let found = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
    } else if (QUOTES.has(ch)) quote = ch
    else if (ch === '[') {
      if (depth > 0) depth++
      else if (i > 0 && /\s/.test(line[i - 1])) {
        open = i
        depth = 1
      }
    } else if (ch === ']' && depth > 0 && --depth === 0) {
      found = { open, close: i }
      open = -1
    }
  }
  if (found && line.slice(found.close + 1).trim() === '') {
    return { head: line.slice(0, found.open).trim(), inner: line.slice(found.open + 1, found.close) }
  }
  return { head: line.trim(), inner: null }
}

const quoteIdent = (n) => (/^[\p{L}_][\p{L}\p{M}\p{N}_$]*$/u.test(n) ? n : `"${n.replace(/"/g, "'")}"`)

const EP = `${IDENT}\\.(?:${IDENT}|\\(\\s*${IDENT}(?:\\s*,\\s*${IDENT})*\\s*\\))`

function parseRef(body) {
  const m = body.trim().match(new RegExp(`^(${EP})\\s*(<>|>|<|-)\\s*(${EP})$`, 'u'))
  if (!m) return null
  const from = parseEndpoint(m[1])
  const to = parseEndpoint(m[3])
  if (!from || !to) return null
  if (endpointFields(from).length !== endpointFields(to).length) return { mismatch: true }
  return { from, to, type: m[2] }
}

const KEY_SETTINGS = new Set(['default', 'note', 'ref', 'enum'])

/** `['a', 'b', 3]` -> ['a', 'b', 3] (null when it is not a list of strings / numbers) */
function parseEnumList(text) {
  const t = text.trim()
  if (!t.startsWith('[') || !t.endsWith(']')) return null
  const out = []
  for (const raw of splitTop(t.slice(1, -1))) {
    if (QUOTES.has(raw[0])) out.push(unquoteValue(raw))
    else if (/^-?\d+(\.\d+)?$/.test(raw)) out.push(Number(raw))
    else return null
  }
  return out
}

/** Blank out /* ... *\/ comments (keeping newlines so line numbers stay right); quotes and // comments are respected. */
function stripBlockComments(text) {
  if (!text.includes('/*')) return text
  let out = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      out += ch
      if (ch === '\\' && i + 1 < text.length) out += text[++i]
      else if (ch === quote || ch === '\n') quote = null
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') out += text[i++]
      i--
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      out += text.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop - 1
    } else {
      if (QUOTES.has(ch)) quote = ch
      out += ch
    }
  }
  return out
}

/**
 * Parse the DBML-like DSL into a Schema. Never throws: problems are collected in `errors`.
 * `schema.refLines[i]` is the 1-based source line of `schema.refs[i]` (when known).
 * @param {string} text
 * @returns {import('./model.js').Schema}
 */
export function parse(text) {
  const schema = emptySchema()
  schema.refLines = []
  const lines = stripBlockComments(String(text ?? '')).split(/\r?\n/)
  let table = null
  let inIndexes = false
  let pendingIndexes = []
  let enumBlock = null // DBML `Enum name { value ... }`
  const enums = new Map() // lower-case name -> values

  const err = (i, message) => schema.errors.push({ line: i + 1, message })
  const addRef = (ref, i) => {
    schema.refs.push(ref)
    schema.refLines.push(i + 1)
  }
  const closeTable = () => {
    for (const { line, idx } of pendingIndexes) {
      for (const f of idx.fields) {
        if (!table.fields.some((x) => x.name === f)) err(line, `Index uses unknown field "${f}" in table "${table.name}"`)
      }
    }
    pendingIndexes = []
    schema.tables.push(table)
    table = null
  }

  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i]
    const commentAt = findComment(raw)
    if (commentAt !== -1) raw = raw.slice(0, commentAt)
    const line = raw.trim()
    if (!line) continue

    if (enumBlock) {
      if (line === '}') {
        enums.set(enumBlock.name.toLowerCase(), enumBlock.values)
        enumBlock = null
      } else {
        const em = line.match(/^(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s[]+))\s*(\[.*\])?$/u)
        if (em) enumBlock.values.push(em[1] ?? em[2] ?? em[3] ?? em[4])
        else err(i, 'Invalid enum value')
      }
      continue
    }

    if (!table) {
      const em = line.match(new RegExp(`^Enum\\s+(${IDENT})\\s*\\{$`, 'iu'))
      if (em) {
        enumBlock = { name: unq(em[1]), values: [] }
        continue
      }
      let m = line.match(new RegExp(`^Table\\s+(${IDENT})\\s*(\\[.*\\])?\\s*\\{$`, 'iu'))
      if (m) {
        table = { name: unq(m[1]), note: null, embedded: false, fields: [], indexes: [] }
        if (m[2]) {
          for (const s of splitTop(m[2].slice(1, -1))) {
            const nm = s.match(/^note\s*:\s*([\s\S]+)$/i)
            if (nm) table.note = unquoteValue(nm[1].trim())
            else if (/^embedded$/i.test(s)) table.embedded = true
            else err(i, `Unknown table setting "${s}"`)
          }
        }
        if (schema.tables.some((t) => t.name === table.name)) err(i, `Duplicate table "${table.name}"`)
        continue
      }
      m = line.match(/^Ref[^:\s]*\s*:\s*(.+)$/i)
      if (m) {
        const ref = parseRef(m[1])
        if (ref?.mismatch) err(i, 'Both sides of a composite Ref must list the same number of columns')
        else if (ref) addRef(ref, i)
        else err(i, 'Invalid Ref, expected: Ref: table.field > table.field (composite: Ref: a.(x, y) > b.(p, q))')
        continue
      }
      err(i, `Unexpected "${line.slice(0, 30)}"`)
      continue
    }

    if (inIndexes) {
      if (line === '}') {
        inIndexes = false
        continue
      }
      const m = line.match(new RegExp(`^(?:\\(([^)]*)\\)|(${IDENT}))\\s*(\\[.*\\])?$`, 'u'))
      if (!m) {
        err(i, 'Invalid index')
        continue
      }
      const fields = splitTop(m[1] ?? m[2]).map(unq)
      const idx = { fields, unique: false, name: null }
      for (const s of splitTop(m[3] ? m[3].slice(1, -1) : '')) {
        if (/^unique$/i.test(s)) idx.unique = true
        else {
          const nm = s.match(/^name\s*:\s*([\s\S]+)$/i)
          if (nm) idx.name = unquoteValue(nm[1].trim())
          else err(i, `Unknown index setting "${s}"`)
        }
      }
      table.indexes.push(idx)
      pendingIndexes.push({ line: i, idx })
      continue
    }

    if (line === '}') {
      closeTable()
      continue
    }
    if (/^indexes\s*\{$/i.test(line)) {
      inIndexes = true
      continue
    }
    const nm = line.match(/^note\s*:\s*([\s\S]+)$/i)
    if (nm) {
      table.note = unquoteValue(nm[1].trim())
      continue
    }

    const { head, inner } = splitSettingsBlock(line)
    const settings = inner === null ? [] : splitTop(inner)
    const hm = head.match(new RegExp(`^(${IDENT})\\s+(.+)$`, 'u'))
    if (!hm) {
      err(i, 'Expected: <field name> <type> [settings]')
      continue
    }
    const f = newField(unq(hm[1]), hm[2].trim().replace(/^"([^"]*)"$/, '$1')) // DBML quotes types such as "varchar(255)[]"
    if (table.fields.some((x) => x.name === f.name)) err(i, `Duplicate field "${f.name}"`)
    for (const s of settings) {
      const low = s.toLowerCase().replace(/\s+/g, ' ')
      if (low === 'pk' || low === 'primary key') f.pk = true
      else if (low === 'unique') f.unique = true
      else if (low === 'not null') f.notNull = true
      else if (low === 'null') f.notNull = false
      else if (low === 'increment') f.increment = true
      else {
        const kv = s.match(/^(\w+)\s*:\s*([\s\S]+)$/)
        const key = kv?.[1].toLowerCase()
        if (!kv || !KEY_SETTINGS.has(key)) {
          err(i, `Unknown setting "${s.length > 24 ? s.slice(0, 24) + '…' : s}"`)
          continue
        }
        const val = kv[2].trim()
        if (key === 'default') {
          f.default = unquoteValue(val)
          f.defaultKind = valueKind(val)
        } else if (key === 'note') f.note = unquoteValue(val)
        else if (key === 'enum') {
          const list = parseEnumList(val)
          if (list) f.enum = list
          else err(i, "Invalid enum, expected: enum: ['a', 'b']")
        } else {
          const r = parseRef(`${quoteIdent(table.name)}.${quoteIdent(f.name)} ${val}`)
          if (r && !r.mismatch) addRef(r, i)
          else err(i, 'Invalid inline ref, expected [ref: > table.field]')
        }
      }
    }
    if (f.pk) f.notNull = true
    table.fields.push(f)
  }
  if (table) {
    err(lines.length - 1, `Table "${table.name}" is missing a closing "}"`)
    closeTable()
  }
  if (enumBlock) err(lines.length - 1, `Enum "${enumBlock.name}" is missing a closing "}"`)
  // a field whose type is an Enum block takes its values (and is a text column)
  if (enums.size) {
    for (const t of schema.tables) {
      for (const f of t.fields) {
        const values = enums.get(f.type.toLowerCase())
        if (values) {
          f.enum = [...values]
          f.type = 'varchar(255)'
        }
      }
    }
  }

  schema.refs.forEach((r, n) => {
    const at = (schema.refLines[n] ?? 1) - 1
    for (const side of [r.from, r.to]) {
      const t = schema.tables.find((x) => x.name === side.table)
      if (!t) err(at, `Ref points to unknown table "${side.table}"`)
      else {
        for (const name of endpointFields(side)) {
          if (!t.fields.some((f) => f.name === name)) err(at, `Ref points to unknown field "${side.table}.${name}"`)
        }
      }
    }
  })
  return schema
}
