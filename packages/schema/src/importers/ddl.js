import { emptySchema, endpointFields, newField } from '../model.js'
import { normalizeImportedType } from '../types.js'

// ----------------------------------------------------------------- names
const PART = '(?:"(?:[^"]|"\\")+"|`[^`]+`|\\[[^\\]]+\\]|[^\\s.(),;"`\\[\\]]+)'.replace('\\\\"', '""')
const NAME = `${PART}(?:\\s*\\.\\s*${PART})*`
const PART_RE = new RegExp(PART, 'g')

const unquotePart = (p) => {
  const t = p.trim()
  if (t.startsWith('"')) return t.slice(1, -1).replace(/""/g, '"')
  if (t.startsWith('`')) return t.slice(1, -1).replace(/``/g, '`')
  if (t.startsWith('[')) return t.slice(1, -1)
  return t
}
/** `schema.table` / `"my schema"."My Table"` -> last part, unquoted */
const lastName = (s) => unquotePart((s.match(PART_RE) ?? [s]).pop())
const allParts = (s) => (s.match(PART_RE) ?? []).map(unquotePart)

// ------------------------------------------------------- statement splitter
/**
 * One pass over the dump: removes comments, keeps string literals intact (including `''`, MySQL `\'`,
 * PostgreSQL `E'..'` and `$tag$..$tag$`) and splits on top-level `;`. `COPY ... FROM stdin` data blocks are skipped.
 */
function splitStatements(sql, backslashEscapes) {
  const out = []
  let cur = ''
  let depth = 0
  const n = sql.length
  let i = 0
  const atLineStart = () => /(^|\n)[ \t]*$/.test(cur)
  while (i < n) {
    const ch = sql[i]
    const nx = sql[i + 1]
    if (ch === '-' && nx === '-') {
      while (i < n && sql[i] !== '\n') i++
      cur += ' '
      continue
    }
    if (ch === '/' && nx === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      cur += ' '
      continue
    }
    if (ch === '#' && backslashEscapes && atLineStart()) {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (ch === "'") {
      const eString = /(^|[^\w$])[eE]$/.test(cur)
      let j = i + 1
      while (j < n) {
        if (sql[j] === '\\' && (backslashEscapes || eString)) j += 2
        else if (sql[j] === "'") {
          if (sql[j + 1] === "'") j += 2
          else break
        } else j++
      }
      cur += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === '"' || ch === '`') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) j += 2
          else break
        } else j++
      }
      cur += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === '$') {
      const m = sql.slice(i, i + 40).match(/^\$([A-Za-z_]\w*)?\$/)
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length)
        const stop = end === -1 ? n : end + m[0].length
        cur += sql.slice(i, stop)
        i = stop
        continue
      }
    }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ';' && depth <= 0) {
      const st = cur.trim()
      if (st) out.push(st)
      cur = ''
      depth = 0
      i++
      if (/^copy\b[\s\S]*\bfrom\s+stdin\b/i.test(st)) {
        const m = /\n\\\.[ \t]*(\r?\n|$)/.exec(sql.slice(i))
        i = m ? i + m.index + m[0].length : n
      }
      continue
    }
    cur += ch
    i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Split on top-level commas (string / paren aware). */
function splitTopLevel(body, backslashEscapes) {
  const out = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < body.length) {
        if (ch === "'" && backslashEscapes && body[j] === '\\') j += 2
        else if (body[j] === ch) {
          if (body[j + 1] === ch) j += 2
          else break
        } else j++
      }
      cur += body.slice(i, j + 1)
      i = j
    } else if (ch === '(') {
      depth++
      cur += ch
    } else if (ch === ')') {
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

/** Index of the ")" matching the "(" at `open`, string aware. */
function matchParen(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const ch = s[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < s.length && !(s[j] === ch && s[j + 1] !== ch)) j += s[j] === ch ? 2 : 1
      i = j
    } else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return -1
}

/** Column list `(a, b DESC, c(10))` -> ['a','b','c'], or null when it contains expressions. */
function indexCols(text, esc) {
  const cols = []
  for (const raw of splitTopLevel(text, esc)) {
    const cleaned = raw
      .replace(/\s+nulls\s+(first|last)\b/i, '')
      .replace(/\s+collate\s+\S+/i, '')
      .replace(/\s+(asc|desc)\b/i, '')
      .replace(/\s+(?:text|varchar)_pattern_ops\b/i, '')
      .replace(/\(\d+\)\s*$/, '')
      .trim()
    if (!new RegExp(`^${PART}$`).test(cleaned)) return null
    cols.push(unquotePart(cleaned))
  }
  return cols
}

// ----------------------------------------------------------------- defaults
function readDefault(rest, esc) {
  rest = rest.trimStart()
  let value
  let kind
  let used
  if (rest[0] === "'") {
    let j = 1
    while (j < rest.length) {
      if (esc && rest[j] === '\\') j += 2
      else if (rest[j] === "'") {
        if (rest[j + 1] === "'") j += 2
        else break
      } else j++
    }
    let inner = rest.slice(1, j)
    inner = esc ? inner.replace(/\\([\s\S])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', 0: '\0' })[c] ?? c).replace(/''/g, "'") : inner.replace(/''/g, "'")
    value = inner
    kind = 'string'
    used = j + 1
  } else if (rest[0] === '(') {
    const end = matchParen(rest, 0)
    if (end === -1) return null
    value = rest.slice(1, end).trim()
    kind = 'expr'
    used = end + 1
    const num = value.match(/^\(?(-?\d+(\.\d+)?)\)?$/)
    if (num) {
      value = num[1]
      kind = 'literal'
    }
  } else {
    const m = rest.match(/^[^\s,()]+/)
    if (!m) return null
    value = m[0]
    used = m[0].length
    if (rest[used] === '(') {
      const end = matchParen(rest, used)
      if (end === -1) return null
      value = rest.slice(0, end + 1)
      used = end + 1
      kind = 'expr'
    } else if (/^null$/i.test(value)) return { skip: true, used }
    else if (/^(true|false)$/i.test(value) || /^-?\d+(\.\d+)?$/.test(value)) kind = 'literal'
    else kind = 'expr' // current_timestamp, current_date, ...
  }
  // PostgreSQL casts: 'x'::character varying, nextval('s'::regclass)
  const cast = rest.slice(used).match(/^\s*::\s*[A-Za-z_]\w*(?:\s+(?:varying|precision|without time zone|with time zone))?(?:\s*\([^)]*\))?(?:\[\])?/)
  if (cast) used += cast[0].length
  return { value, kind, used }
}

// ------------------------------------------------------------------ columns
const TYPE_RE = /^([A-Za-z_]\w*(?: (?:varying|precision))?(?:\s*\([^)]*\))?(?: (?:without|with) time zone)?(?:\s*\[\d*\])*(?:\s+(?:unsigned|zerofill|signed))*)/i
const SERIALS = { serial: 'int', bigserial: 'bigint', smallserial: 'smallint', serial4: 'int', serial8: 'bigint' }

function parseColumn(item, esc, addRef) {
  const m = item.match(new RegExp(`^(${PART})\\s*([\\s\\S]*)$`))
  if (!m) return null
  const f = newField(unquotePart(m[1]), 'text')
  const rest = m[2].trim()
  let after = rest
  if (rest) {
    const tm = rest.match(TYPE_RE)
    let rawType = tm ? tm[1] : rest.split(/\s+/)[0]
    after = rest.slice(rawType.length)
    rawType = rawType.replace(/\s+/g, ' ').trim()
    const serial = SERIALS[rawType.toLowerCase()]
    if (serial) {
      f.type = serial
      f.increment = true
    } else {
      const nt = normalizeImportedType(rawType)
      f.type = nt.type
      if (nt.note) f.note = nt.note
    }
  }
  if (/\bprimary\s+key\b/i.test(after)) {
    f.pk = true
    f.notNull = true
  }
  if (/\bnot\s+null\b/i.test(after)) f.notNull = true
  if (/\bunique\b/i.test(after) && !/\bunique\s+(key|index)\s*\(/i.test(after)) f.unique = true
  if (/\bauto_?increment\b/i.test(after) || /\bgenerated\s+(always|by\s+default)\s+as\s+identity\b/i.test(after) || /\bidentity\s*\(/i.test(after)) f.increment = true
  const dm = after.match(/\bdefault\s+/i)
  if (dm) {
    const d = readDefault(after.slice(dm.index + dm[0].length), esc)
    if (d && !d.skip) {
      if (d.kind === 'expr' && /^nextval\s*\(/i.test(d.value)) f.increment = true
      else {
        f.default = d.value
        f.defaultKind = d.kind
      }
    }
  }
  const cm = after.match(/\bcomment\s+'((?:[^']|'')*)'/i)
  if (cm) f.note = [f.note, cm[1].replace(/''/g, "'")].filter(Boolean).join(' - ')
  const rm = after.match(new RegExp(`\\breferences\\s+(${NAME})\\s*(\\()?`, 'i'))
  if (rm) {
    let target = null
    if (rm[2]) {
      const open = after.indexOf('(', rm.index + rm[0].length - 1)
      const close = matchParen(after, open)
      target = indexCols(after.slice(open + 1, close), esc)?.[0] ?? null
    }
    addRef({ field: f.name, table: lastName(rm[1]), column: target })
  }
  return f
}

// -------------------------------------------------------------------- main
/**
 * Parse CREATE TABLE / ALTER TABLE / CREATE INDEX / COMMENT ON from a SQL dump
 * (PostgreSQL, MySQL, SQLite flavours). INSERT / COPY data and unknown statements are skipped.
 * @param {string} sqlText
 * @returns {import('../model.js').Schema}
 */
export function ddlToSchema(sqlText) {
  const schema = emptySchema()
  const src = String(sqlText ?? '')
  const esc = /ENGINE\s*=|mysqldump|\/\*!\d{5}|`/i.test(src)
  const statements = splitStatements(src, esc)
  const findTable = (name) => schema.tables.find((t) => t.name === name)
  const pending = [] // refs with implicit target columns

  const endpoint = (table, cols) => (cols.length > 1 ? { table, field: cols[0], fields: cols } : { table, field: cols[0] })
  const sameEndpoint = (a, b) => a.table === b.table && endpointFields(a).join('\u0000') === endpointFields(b).join('\u0000')
  const pushRef = (from, to) => {
    if (schema.refs.some((r) => sameEndpoint(r.from, from) && sameEndpoint(r.to, to))) return
    schema.refs.push({ from, to, type: '>' })
  }

  const uniqueOn = (table, cols) => {
    if (!table || !cols) return
    if (cols.length === 1) {
      const f = table.fields.find((x) => x.name === cols[0])
      if (f) f.unique = true
    } else table.indexes.push({ fields: cols, unique: true, name: null })
  }
  const pkOn = (table, cols) => {
    for (const c of cols ?? []) {
      const f = table?.fields.find((x) => x.name === c)
      if (f) {
        f.pk = true
        f.notNull = true
      }
    }
  }
  const fkOn = (tableName, colsText, refText, refCols) => {
    const from = indexCols(colsText, esc)
    const to = refCols ? indexCols(refCols, esc) : null
    if (!from) return
    const target = lastName(refText)
    if (!from.length) return
    if (to?.length === from.length) pushRef(endpoint(tableName, from), endpoint(target, to))
    else if (to?.length) pushRef({ table: tableName, field: from[0] }, { table: target, field: to[0] }) // column counts differ: keep the first pair
    else pending.push({ table: tableName, cols: from, target }) // REFERENCES parent  (implicit primary key)
  }

  for (const st of statements) {
    // ---------------------------------------------------------- CREATE TABLE
    const ct = st.match(new RegExp(`^create\\s+(?:(?:global\\s+|local\\s+)?(?:temporary|temp)\\s+|unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${NAME})\\s*\\(`, 'i'))
    if (ct) {
      const open = ct[0].length - 1
      const close = matchParen(st, open)
      if (close === -1) continue
      const table = { name: lastName(ct[1]), note: null, embedded: false, fields: [], indexes: [] }
      const tail = st.slice(close + 1)
      const tc = tail.match(/\bcomment\s*=?\s*'((?:[^']|'')*)'/i)
      if (tc) table.note = tc[1].replace(/''/g, "'")
      const tableRefs = []
      for (let item of splitTopLevel(st.slice(open + 1, close), esc)) {
        item = item.replace(new RegExp(`^constraint\\s+${PART}\\s+`, 'i'), '')
        let m
        if ((m = item.match(/^primary\s+key\s*(?:\w+\s*)?\(([\s\S]*)\)/i))) pkOn(table, indexCols(m[1], esc))
        else if ((m = item.match(new RegExp(`^foreign\\s+key\\s*(?:${PART}\\s*)?\\(([^)]*)\\)\\s*references\\s+(${NAME})\\s*(?:\\(([^)]*)\\))?`, 'i')))) tableRefs.push([m[1], m[2], m[3]])
        else if ((m = item.match(/^unique\s*(?:key|index)?\s*(?:[^\s(]+\s*)?\(([\s\S]*)\)/i))) uniqueOn(table, indexCols(m[1], esc))
        else if ((m = item.match(new RegExp(`^(?:fulltext\\s+|spatial\\s+)?(?:key|index)\\s+(?:(${PART})\\s*)?\\(([\\s\\S]*)\\)`, 'i')))) {
          const cols = indexCols(m[2], esc)
          if (cols && !/^(fulltext|spatial)/i.test(item)) table.indexes.push({ fields: cols, unique: false, name: m[1] ? unquotePart(m[1]) : null })
        } else if (/^(check|exclude|period|like|fulltext|spatial)\b/i.test(item)) continue
        else {
          const f = parseColumn(item, esc, (r) => (r.column ? pushRef({ table: table.name, field: r.field }, { table: r.table, field: r.column }) : pending.push({ table: table.name, cols: [r.field], target: r.table })))
          if (f && !table.fields.some((x) => x.name === f.name)) table.fields.push(f)
        }
      }
      schema.tables.push(table)
      for (const [cols, ref, refCols] of tableRefs) fkOn(table.name, cols, ref, refCols)
      continue
    }

    // ----------------------------------------------------------- ALTER TABLE
    const at = st.match(new RegExp(`^alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?(${NAME})\\s+([\\s\\S]+)$`, 'i'))
    if (at) {
      const tname = lastName(at[1])
      const table = findTable(tname)
      for (let action of splitTopLevel(at[2], esc)) {
        let m
        const bare = action.replace(new RegExp(`^add\\s+(?:constraint\\s+${PART}\\s+)?`, 'i'), 'add ')
        if ((m = bare.match(new RegExp(`^add\\s+foreign\\s+key\\s*(?:${PART}\\s*)?\\(([^)]*)\\)\\s*references\\s+(${NAME})\\s*(?:\\(([^)]*)\\))?`, 'i')))) fkOn(tname, m[1], m[2], m[3])
        else if ((m = bare.match(/^add\s+primary\s+key\s*\(([\s\S]*)\)/i))) pkOn(table, indexCols(m[1], esc))
        else if ((m = bare.match(/^add\s+unique\s*(?:key|index)?\s*(?:[^\s(]+\s*)?\(([\s\S]*)\)/i))) uniqueOn(table, indexCols(m[1], esc))
        else if ((m = bare.match(new RegExp(`^add\\s+(?:key|index)\\s+(?:(${PART})\\s*)?\\(([\\s\\S]*)\\)`, 'i')))) {
          const cols = indexCols(m[2], esc)
          if (table && cols) table.indexes.push({ fields: cols, unique: false, name: m[1] ? unquotePart(m[1]) : null })
        } else if ((m = action.match(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i)) && !/^(check|exclude|constraint|primary|foreign|unique|key|index|fulltext|spatial)\b/i.test(m[1])) {
          const f = parseColumn(m[1], esc, (r) => pending.push({ table: tname, cols: [r.field], target: r.table, column: r.column }))
          if (table && f && !table.fields.some((x) => x.name === f.name)) table.fields.push(f)
        } else if ((m = action.match(new RegExp(`^alter\\s+(?:column\\s+)?(${PART})\\s+(?:set\\s+default|add\\s+generated|set\\s+not\\s+null|drop\\s+not\\s+null)([\\s\\S]*)$`, 'i')))) {
          const f = table?.fields.find((x) => x.name === unquotePart(m[1]))
          if (f) {
            if (/set\s+not\s+null/i.test(action)) f.notNull = true
            else if (/add\s+generated/i.test(action)) f.increment = true
            else if (/set\s+default/i.test(action)) {
              const d = readDefault(m[2], esc)
              if (d && !d.skip) {
                if (d.kind === 'expr' && /^nextval\s*\(/i.test(d.value)) f.increment = true
                else {
                  f.default = d.value
                  f.defaultKind = d.kind
                }
              }
            }
          }
        } else if ((m = action.match(new RegExp(`^(?:modify|change)\\s+(?:column\\s+)?(${PART})\\s+([\\s\\S]+)$`, 'i')))) {
          const f = table?.fields.find((x) => x.name === unquotePart(m[1]))
          if (f && /\bauto_?increment\b/i.test(m[2])) f.increment = true
        }
      }
      continue
    }

    // ---------------------------------------------------------- CREATE INDEX
    const ix = st.match(new RegExp(`^create\\s+(unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(?:(${NAME})\\s+)?on\\s+(?:only\\s+)?(${NAME})\\s*(?:using\\s+\\w+\\s*)?\\(`, 'i'))
    if (ix) {
      const open = ix[0].length - 1
      const close = matchParen(st, open)
      const table = findTable(lastName(ix[3]))
      const cols = close === -1 ? null : indexCols(st.slice(open + 1, close), esc)
      if (table && cols) {
        if (ix[1] && cols.length === 1 && !ix[2]) uniqueOn(table, cols)
        else table.indexes.push({ fields: cols, unique: Boolean(ix[1]), name: ix[2] ? lastName(ix[2]) : null })
      }
      continue
    }

    // ----------------------------------------------------------- COMMENT ON
    const co = st.match(new RegExp(`^comment\\s+on\\s+(table|column)\\s+(${NAME})\\s+is\\s+'((?:[^']|'')*)'`, 'i'))
    if (co) {
      const text = co[3].replace(/''/g, "'")
      const parts = allParts(co[2])
      if (co[1].toLowerCase() === 'table') {
        const t = findTable(parts.pop())
        if (t) t.note = text
      } else {
        const col = parts.pop()
        const t = findTable(parts.pop())
        const f = t?.fields.find((x) => x.name === col)
        if (f) f.note = text
      }
    }
  }

  // references without a column list point at the target's primary key
  for (const p of pending) {
    const target = findTable(p.target)
    let to
    if (p.column) to = [p.column]
    else {
      const pks = target?.fields.filter((f) => f.pk).map((f) => f.name) ?? []
      to = pks.length === p.cols.length ? pks : [pks[0] ?? target?.fields[0]?.name].filter(Boolean)
    }
    if (!to.length) continue
    pushRef(endpoint(p.table, to.length === p.cols.length ? p.cols : [p.cols[0]]), endpoint(p.target, to))
  }
  return schema
}
