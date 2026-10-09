import { emptySchema, newField } from '../model.js'

/** Minimal RFC4180 CSV parser (handles quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text, delimiter) {
  const src = String(text).replace(/^﻿/, '')
  const d = delimiter ?? detectDelimiter(src)
  const rows = []
  let row = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === d) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop()
  // blank lines inside a multi-column file carry no data; in a single-column file they are empty values
  return rows[0]?.length > 1 ? rows.filter((r) => !(r.length === 1 && r[0] === '')) : rows
}

function detectDelimiter(src) {
  const first = src.split(/\r?\n/)[0] ?? ''
  const counts = [',', ';', '\t', '|'].map((c) => [c, first.split(c).length])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 1 ? counts[0][0] : ','
}

export function toCsv(rows, delimiter = ',') {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return new RegExp(`["\\n\\r${delimiter === '\t' ? '\\t' : delimiter}]`).test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(esc).join(delimiter)).join('\r\n') + '\r\n'
}

const BOOLS = /^(true|false|yes|no|y|n|t|f)$/i
const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/
const INT = /^-?\d+$/

function validDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** Infer a SQL-ish column type from sample string values (single pass, safe for millions of rows). */
export function inferType(values) {
  let count = 0
  let maxLen = 0
  let bool = true
  let num = true
  let int = true
  let dot = false
  let date = true
  let ts = true
  let big = false
  let overflow = false
  for (const raw of values) {
    const v = (raw ?? '').trim()
    if (v === '') continue
    count++
    if (v.length > maxLen) maxLen = v.length
    if (bool && !BOOLS.test(v)) bool = false
    if (num) {
      if (!NUMBER.test(v) || /^-?0\d/.test(v)) num = false
      else if (INT.test(v)) {
        if (v.length >= 10) {
          try {
            const b = BigInt(v)
            if (b > 2147483647n || b < -2147483648n) big = true
            if (b > 9223372036854775807n || b < -9223372036854775808n) overflow = true
          } catch {
            num = false
          }
        }
      } else {
        int = false
        dot = true
      }
    }
    if (date) {
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!m || !validDate(+m[1], +m[2], +m[3])) date = false
    }
    if (ts) {
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/)
      if (!m || !validDate(+m[1], +m[2], +m[3])) ts = false
    }
  }
  if (!count) return 'varchar(255)'
  if (bool) return 'boolean'
  if (num && !overflow) return dot || !int ? 'double' : big ? 'bigint' : 'int'
  if (date) return 'date'
  if (ts) return 'timestamp'
  return maxLen > 255 ? 'text' : 'varchar(255)'
}

// Unicode-aware (Thai, accented letters, ...): only characters that are neither letters, digits, _ nor $ are replaced
const cleanName = (s, fallback) => String(s).trim().replace(/[^\p{L}\p{M}\p{N}_$]+/gu, '_').replace(/^_+|_+$/g, '') || fallback
const clean = (s) => cleanName(s, 'column')
const tableName = (s) => cleanName(String(s).replace(/\.[^.]+$/, ''), 'table')

/**
 * Build a Schema containing one table from CSV text (header row required).
 * @param {string} name   file name or table name
 * @param {string} text
 */
export function csvToSchema(name, text, schema = emptySchema()) {
  return rowsToSchema(name, parseCsv(text), schema)
}

/** Same as csvToSchema but for already-parsed rows (e.g. an Excel sheet). */
export function rowsToSchema(name, rows, schema = emptySchema()) {
  if (!rows.length) return schema
  const header = rows[0]
  const body = rows.slice(1)
  const seen = new Map()
  const fields = header.map((h, i) => {
    let n = clean(h)
    const key = n.toLowerCase()
    const c = seen.get(key) ?? 0
    seen.set(key, c + 1)
    if (c) n = `${n}_${c + 1}`
    const col = body.map((r) => r[i])
    const f = newField(n, inferType(col))
    const nonEmpty = col.filter((v) => v !== undefined && v !== '')
    f.notNull = nonEmpty.length === col.length && col.length > 0
    return f
  })
  const id = fields.find((f) => /^_?id$/i.test(f.name) && /^(int|bigint|varchar|text|uuid)/.test(f.type))
  if (id) {
    const values = body.map((r) => String(r[fields.indexOf(id)] ?? '').trim())
    if (values.length && values.every((v) => v !== '') && new Set(values).size === values.length) {
      id.pk = true
      id.notNull = true
    }
  }
  let tn = tableName(name)
  let k = 2
  while (schema.tables.some((t) => t.name === tn)) tn = `${tableName(name)}_${k++}`
  schema.tables.push({ name: tn, note: null, embedded: false, fields, indexes: [] })
  return schema
}
