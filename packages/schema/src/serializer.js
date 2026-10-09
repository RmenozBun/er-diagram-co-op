import { defaultKind } from './model.js'

const IDENT_OK = /^[\p{L}_][\p{L}\p{M}\p{N}_$]*$/u

/** Quote an identifier when it is not a plain (Unicode) word. */
export const q = (name) => {
  const n = String(name).replace(/[\r\n]+/g, ' ')
  if (IDENT_OK.test(n)) return n
  if (!n.includes('"')) return `"${n}"`
  if (!n.includes('`')) return `\`${n}\``
  return `"${n.replace(/"/g, "'")}"`
}

/** Single-quoted string with \\ \' and newlines escaped (the parser understands these). */
export const str = (v) =>
  `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n').replace(/\r/g, '\\r')}'`

function defaultText(f) {
  const kind = defaultKind(f)
  if (kind === 'expr' && !String(f.default).includes('`')) return `\`${f.default}\``
  if (kind === 'literal' && /^[\w.+-]+$/.test(f.default)) return f.default
  return str(f.default)
}

/**
 * Serialise a Schema back to the DSL text (used by importers).
 * `options.dbml`: write DBML for dbdiagram.io instead - the one difference is that an `enum: [...]` setting becomes an `Enum` block
 * (dbdiagram.io has no inline enum) and the field takes that enum as its type.
 * @param {import('./model.js').Schema} schema
 * @param {{ dbml?: boolean }} [options]
 */
export function serialize(schema, options = {}) {
  const blocks = []
  const enums = []
  const usedEnumNames = new Set()
  const enumFor = (t, f) => {
    if (!f.enum?.length || !f.enum.every((v) => typeof v === 'string')) return null
    let name = `${t.name}_${f.name}`.replace(/[^\p{L}\p{M}\p{N}_]+/gu, '_')
    for (let i = 2; usedEnumNames.has(name); i++) name = `${name}_${i}`
    usedEnumNames.add(name)
    enums.push(`Enum ${q(name)} {\n${f.enum.map((v) => `  ${IDENT_OK.test(v) ? v : JSON.stringify(v)}`).join('\n')}\n}`)
    return name
  }
  for (const t of schema.tables) {
    const lines = []
    const tset = []
    if (t.embedded && !options.dbml) tset.push('embedded')
    if (t.note) tset.push(`note: ${str(t.note)}`)
    lines.push(`Table ${q(t.name)}${tset.length ? ` [${tset.join(', ')}]` : ''} {`)
    for (const f of t.fields) {
      const s = []
      if (f.pk) s.push('pk')
      if (f.increment) s.push('increment')
      if (f.unique) s.push('unique')
      if (f.notNull && !f.pk) s.push('not null')
      if (f.default !== null && f.default !== undefined) s.push(`default: ${defaultText(f)}`)
      const enumName = options.dbml ? enumFor(t, f) : null
      if (f.enum?.length && !options.dbml) s.push(`enum: [${f.enum.map((v) => (typeof v === 'number' ? v : str(v))).join(', ')}]`)
      if (f.note) s.push(`note: ${str(f.note)}`)
      lines.push(`  ${q(f.name)} ${enumName ? q(enumName) : f.type}${s.length ? ` [${s.join(', ')}]` : ''}`)
    }
    if (t.indexes.length) {
      lines.push('', '  indexes {')
      for (const ix of t.indexes) {
        const s = []
        if (ix.unique) s.push('unique')
        if (ix.name) s.push(`name: ${str(ix.name)}`)
        const cols = ix.fields.length > 1 ? `(${ix.fields.map(q).join(', ')})` : q(ix.fields[0])
        lines.push(`    ${cols}${s.length ? ` [${s.join(', ')}]` : ''}`)
      }
      lines.push('  }')
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }
  const ep = (e) => `${q(e.table)}.${e.fields?.length > 1 ? `(${e.fields.map(q).join(', ')})` : q(e.field)}`
  const refs = schema.refs.map((r) => `Ref: ${ep(r.from)} ${r.type} ${ep(r.to)}`)
  return [...enums, ...blocks, refs.join('\n')].filter(Boolean).join('\n\n') + '\n'
}
