import { baseType, defaultKind, endpointFields, isArrayType, refSides } from '../model.js'
import { embeddedTarget } from '../relations.js'
import { normalizeImportedType } from '../types.js'

export const SQL_DIALECTS = ['postgres', 'mysql', 'sqlite']

// Lower-case base type -> dialect type. Anything not listed passes through unchanged.
const TYPE_MAP = {
  postgres: {
    string: 'varchar(255)', objectid: 'varchar(24)', object: 'jsonb', json: 'jsonb', mixed: 'jsonb', any: 'jsonb', double: 'double precision',
    datetime: 'timestamp', datetime2: 'timestamp', binary: 'bytea', buffer: 'bytea', blob: 'bytea', number: 'numeric', bool: 'boolean',
    long: 'bigint', tinyint: 'smallint', mediumint: 'integer', year: 'smallint', tinytext: 'text', mediumtext: 'text', longtext: 'text',
    nvarchar: 'varchar', nchar: 'char', ntext: 'text', varbinary: 'bytea', image: 'bytea', datetimeoffset: 'timestamptz', smalldatetime: 'timestamp',
  },
  mysql: {
    string: 'varchar(255)', objectid: 'char(24)', object: 'json', jsonb: 'json', mixed: 'json', any: 'json', double: 'double',
    timestamp: 'timestamp', timestamptz: 'datetime', timetz: 'time', bytea: 'blob', binary: 'blob', buffer: 'blob', number: 'decimal(20,6)',
    bool: 'tinyint(1)', boolean: 'tinyint(1)', uuid: 'char(36)', long: 'bigint', money: 'decimal(19,4)', text: 'text',
    datetime2: 'datetime', smalldatetime: 'datetime', datetimeoffset: 'datetime', nvarchar: 'varchar', nchar: 'char', ntext: 'text',
  },
  sqlite: {
    string: 'text', varchar: 'text', char: 'text', objectid: 'text', object: 'text', json: 'text', jsonb: 'text', mixed: 'text', any: 'text',
    uuid: 'text', double: 'real', float: 'real', bool: 'integer', boolean: 'integer', datetime: 'text', timestamp: 'text',
    timestamptz: 'text', date: 'text', time: 'text', number: 'numeric', bytea: 'blob', binary: 'blob', buffer: 'blob', long: 'integer',
    bigint: 'integer', int: 'integer', smallint: 'integer', money: 'numeric',
  },
}

const quote = (dialect, name) => (dialect === 'mysql' ? `\`${String(name).replace(/`/g, '``')}\`` : `"${String(name).replace(/"/g, '""')}"`)

function sqlType(schema, field, dialect) {
  if (embeddedTarget(schema, field)) return dialect === 'mysql' ? 'json' : dialect === 'postgres' ? 'jsonb' : 'text'
  if (isArrayType(field.type)) {
    if (dialect === 'postgres') return `${sqlType(schema, { ...field, type: field.type.replace(/\[\]$/, '') }, dialect)}[]`
    return dialect === 'mysql' ? 'json' : 'text'
  }
  const raw = normalizeImportedType(field.type).type
  const key = baseType(raw)
  const mapped = TYPE_MAP[dialect][key]
  const parens = raw.match(/\(.*\)$/)?.[0]
  let out = mapped ? (parens && !mapped.includes('(') ? mapped + parens : parens && key === baseType(mapped) ? raw : mapped) : raw
  if (dialect === 'mysql') {
    if (out === 'varchar') out = 'varchar(255)'
    if ((field.unique || field.pk) && /^(text|blob)$/.test(out)) out = out === 'text' ? 'varchar(255)' : 'varbinary(255)'
  }
  return out
}

function defaultSql(f, dialect) {
  if (f.default === null || f.default === undefined) return null
  const kind = defaultKind(f)
  const v = String(f.default)
  if (kind === 'literal') return v
  if (kind === 'string') return `'${(dialect === 'mysql' ? v.replace(/\\/g, '\\\\') : v).replace(/'/g, "''")}'`
  // expression
  const isNow = /^(now\(\)|current_timestamp(\(\))?|localtimestamp(\(\))?)$/i.test(v)
  if (dialect === 'postgres') return v
  if (isNow) return 'current_timestamp'
  if (/^(current_date|current_time|curdate\(\)|curtime\(\))$/i.test(v)) return v.replace(/^curdate\(\)$/i, 'current_date').replace(/^curtime\(\)$/i, 'current_time')
  return `(${v})`
}

const SERIAL = { serial: 'int', bigserial: 'bigint', smallserial: 'smallint' }

/**
 * @param {import('../model.js').Schema} schema
 * @param {'postgres'|'mysql'|'sqlite'} dialect
 */
export function toSQL(schema, dialect = 'postgres') {
  const Q = (n) => quote(dialect, n)
  const tables = schema.tables
    .filter((t) => !t.embedded)
    .map((t) => ({
      ...t,
      // `serial` / `bigserial` are really "integer + auto increment"
      fields: t.fields.map((f) => (SERIAL[baseType(f.type)] ? { ...f, type: SERIAL[baseType(f.type)], increment: true } : f)),
    }))
  const byName = new Map(tables.map((t) => [t.name, t]))
  const usedNames = new Set(tables.map((t) => t.name.toLowerCase()))

  // Resolve relations once: foreign keys per child table + junction tables
  const fks = []
  const junctions = []
  const fkNames = new Set()
  const fkName = (base) => {
    let n = base
    let i = 2
    while (fkNames.has(n.toLowerCase())) n = `${base}_${i++}`
    fkNames.add(n.toLowerCase())
    return n
  }
  for (const ref of schema.refs) {
    const a = byName.get(ref.from.table)
    const b = byName.get(ref.to.table)
    if (!a || !b) continue
    if (ref.type === '<>') {
      const fa = a.fields.find((f) => f.name === ref.from.field)
      const fb = b.fields.find((f) => f.name === ref.to.field)
      if (!fa || !fb) continue
      junctions.push({ a, b, fa, fb })
      continue
    }
    const s = refSides(ref)
    const child = byName.get(s.child.table)
    const parent = byName.get(s.parent.table)
    if (!child || !parent) continue
    const cc = endpointFields(s.child)
    const pc = endpointFields(s.parent)
    if (cc.length !== pc.length) continue
    if (!cc.every((n) => child.fields.some((f) => f.name === n)) || !pc.every((n) => parent.fields.some((f) => f.name === n))) continue
    fks.push({ child: s.child, parent: s.parent, cols: cc, refCols: pc, unique: !s.many, name: fkName(`fk_${s.child.table}_${cc.join('_')}`) })
  }

  const out = []
  if (dialect === 'sqlite') out.push('pragma foreign_keys = on;')

  for (const t of tables) {
    const pks = t.fields.filter((f) => f.pk)
    const cols = t.fields.map((f) => {
      const type = sqlType(schema, f, dialect)
      if (f.increment && dialect === 'sqlite' && f.pk && pks.length === 1) return `  ${Q(f.name)} integer primary key autoincrement`
      let line
      if (f.increment && dialect === 'postgres') line = `  ${Q(f.name)} ${/^(big|int8)/i.test(type) ? 'bigserial' : /^small/i.test(type) ? 'smallserial' : 'serial'}`
      else line = `  ${Q(f.name)} ${type}`
      if (f.increment && dialect === 'mysql') line += ' auto_increment'
      if (f.pk && pks.length === 1) line += ' primary key'
      if (f.notNull && !f.pk) line += ' not null'
      if (f.unique && !f.pk) line += ' unique'
      if (f.enum?.length) line += ` check (${Q(f.name)} in (${f.enum.map((v) => (typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`)).join(', ')}))`
      const d = f.increment && dialect !== 'sqlite' ? null : defaultSql(f, dialect)
      if (d !== null && !(dialect === 'mysql' && /^(text|blob|json)/i.test(type) && !d.startsWith('('))) line += ` default ${d}`
      return line
    })
    if (pks.length > 1) cols.push(`  primary key (${pks.map((p) => Q(p.name)).join(', ')})`)
    if (dialect === 'mysql') {
      for (const f of t.fields) if (f.increment && !(f.pk && pks.length === 1) && !f.unique) cols.push(`  key (${Q(f.name)})`)
    }
    if (dialect === 'sqlite') {
      for (const fk of fks.filter((x) => x.child.table === t.name)) {
        if (fk.unique) cols.push(`  unique (${fk.cols.map(Q).join(', ')})`)
        cols.push(`  foreign key (${fk.cols.map(Q).join(', ')}) references ${Q(fk.parent.table)} (${fk.refCols.map(Q).join(', ')})`)
      }
    }
    out.push(`create table ${Q(t.name)} (\n${cols.join(',\n')}\n);`)

    const seenIndex = new Set()
    for (const ix of t.indexes) {
      if (!ix.fields.every((f) => t.fields.some((x) => x.name === f))) continue
      const sig = `${ix.unique}:${ix.fields.join('\u0000')}`
      if (seenIndex.has(sig)) continue
      seenIndex.add(sig)
      const name = ix.name ?? `${t.name}_${ix.fields.join('_')}_${ix.unique ? 'uq' : 'idx'}`
      out.push(`create ${ix.unique ? 'unique ' : ''}index ${Q(name)} on ${Q(t.name)} (${ix.fields.map(Q).join(', ')});`)
    }
  }

  for (const j of junctions) {
    const same = j.a === j.b
    let name = `${j.a.name}_${j.b.name}`
    let n = 2
    while (usedNames.has(name.toLowerCase())) name = `${j.a.name}_${j.b.name}_${n++}`
    usedNames.add(name.toLowerCase())
    const ca = same ? `left_${j.fa.name}` : `${j.a.name}_${j.fa.name}`
    const cb = same ? `right_${j.fb.name}` : `${j.b.name}_${j.fb.name}`
    const idType = (f) => sqlType(schema, f, dialect).replace(/serial/i, (m) => (/big/i.test(m) ? 'bigint' : 'integer'))
    out.push(
      `create table ${Q(name)} (\n  ${Q(ca)} ${idType(j.fa)} not null,\n  ${Q(cb)} ${idType(j.fb)} not null,\n  primary key (${Q(ca)}, ${Q(cb)}),\n  foreign key (${Q(ca)}) references ${Q(j.a.name)} (${Q(j.fa.name)}),\n  foreign key (${Q(cb)}) references ${Q(j.b.name)} (${Q(j.fb.name)})\n);`,
    )
  }

  if (dialect !== 'sqlite') {
    for (const fk of fks) {
      out.push(
        `alter table ${Q(fk.child.table)} add constraint ${Q(fk.name)} foreign key (${fk.cols.map(Q).join(', ')}) references ${Q(fk.parent.table)} (${fk.refCols.map(Q).join(', ')});`,
      )
      if (fk.unique) {
        out.push(`alter table ${Q(fk.child.table)} add constraint ${Q(fkName(`uq_${fk.child.table}_${fk.cols.join('_')}`))} unique (${fk.cols.map(Q).join(', ')});`)
      }
    }
  }

  return out.join('\n\n') + '\n'
}
