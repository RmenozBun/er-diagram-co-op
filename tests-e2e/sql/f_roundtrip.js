import { S, check, setArea, done } from './h.js'
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
const { parse, serialize, toSQL, ddlToSchema } = S
const J = JSON.stringify
setArea('F roundtrip DSL->PG->DDL->DSL')

const cases = {
  sample: S.SAMPLE_SQL,
  rich: `Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
  name varchar(100) [default: 'N/A']
  score numeric(10,2) [default: 0, not null]
  active boolean [default: true]
  created_at timestamp [default: \`current_timestamp\`]
  tags text[]
  meta jsonb
  indexes {
    name
    (email, name) [unique, name: 'uq_email_name']
  }
}
Table posts {
  id bigint [pk, increment]
  user_id int [not null]
  title varchar(200) [not null]
}
Table order_items {
  order_id int [pk]
  line_no int [pk]
  qty int [default: 1]
}
Table comments {
  id int [pk, increment]
  post_id bigint
  parent_id int
}
Table profile {
  id int [pk]
  user_id int [unique]
}
Ref: posts.user_id > users.id
Ref: comments.post_id > posts.id
Ref: comments.parent_id > comments.id
Ref: profile.user_id - users.id
`,
  reserved: `Table "user" {
  id int [pk]
  "order" int
}
Table "order" {
  id int [pk]
  user_id int
}
Ref: "order".user_id > "user".id
`,
  m2m: 'Table a {\n id int [pk]\n}\nTable b {\n id int [pk]\n}\nRef: a.id <> b.id\n',
}
const norm = (s) => {
  const t = {}
  for (const x of s.tables) {
    t[x.name] = {
      fields: Object.fromEntries(x.fields.map((f) => [f.name, { type: f.type, pk: f.pk, unique: f.unique && !f.pk, notNull: f.notNull || f.pk, inc: f.increment, def: f.default }])),
      idx: x.indexes.map((i) => `${i.unique ? 'U' : ''}(${i.fields.join()})`).sort(),
    }
  }
  return { t, refs: s.refs.map((r) => `${r.from.table}.${r.from.field}>${r.to.table}.${r.to.field}`).sort() }
}
for (const [name, dsl] of Object.entries(cases)) {
  const a = parse(dsl)
  check(`${name}: parses`, a.errors.length === 0, J(a.errors))
  const pgSql = toSQL(a, 'postgres')
  fs.writeFileSync(`out/rt-${name}.sql`, pgSql)
  const pg = new PGlite(); const errs = []
  for (const st of pgSql.split(String.fromCharCode(10, 10))) { if (!st.trim()) continue; try { await pg.exec(st) } catch (e) { errs.push(e.message) } }
  check(`${name}: PG DDL executes`, errs.length === 0, errs.join('|'))
  const b = ddlToSchema(pgSql)
  const dslB = serialize(b); fs.writeFileSync(`out/rt-${name}.dsl`, dslB)
  const bp = parse(dslB)
  check(`${name}: re-imported DSL parses w/o errors`, bp.errors.length === 0, J(bp.errors))
  const A = norm(a), B = norm(b)
  // tables
  const missingT = Object.keys(A.t).filter((k) => !B.t[k]); const extraT = Object.keys(B.t).filter((k) => !A.t[k])
  if (name !== 'm2m') check(`${name}: same table set`, !missingT.length && !extraT.length, `missing ${missingT} extra ${extraT}`)
  for (const [tn, tv] of Object.entries(A.t)) {
    if (!B.t[tn]) continue
    for (const [fn, fv] of Object.entries(tv.fields)) {
      const g = B.t[tn].fields[fn]
      if (!g) { check(`${name}: field ${tn}.${fn} present`, false, 'missing'); continue }
      const diffs = []
      const T = (x) => x.replace(/^serial$/, 'int').replace(/^integer$/, 'int').replace(/^character varying/, 'varchar').replace(/^timestamp without time zone$/, 'timestamp').replace(/^double precision$/, 'double')
      if (T(fv.type) !== T(g.type)) diffs.push(`type ${fv.type} -> ${g.type}`)
      for (const k of ['pk', 'unique', 'notNull', 'inc']) if (!!fv[k] !== !!g[k]) diffs.push(`${k} ${fv[k]} -> ${g[k]}`)
      if ((fv.def ?? null) !== (g.def ?? null)) diffs.push(`default ${fv.def} -> ${g.def}`)
      check(`${name}: ${tn}.${fn} identical after PG roundtrip`, !diffs.length, diffs.join('; '))
    }
    check(`${name}: ${tn} indexes identical (${J(tv.idx)})`, J(tv.idx) === J(B.t[tn].idx), `${J(tv.idx)} -> ${J(B.t[tn].idx)}`)
  }
  const refsA = A.refs.map((r) => r).sort()
  check(`${name}: refs preserved (${refsA.length}); m2m becomes junction table (expected)`, name === 'm2m' ? B.refs.length === 2 : J(refsA.filter((r) => true)) === J(B.refs) || J(refsA) === J(B.refs), `${J(refsA)} -> ${J(B.refs)}`)
  // second-generation stability
  const pg2 = toSQL(parse(dslB), 'postgres')
  check(`${name}: second generation of PG DDL stable (idempotent)`, name === 'm2m' || pg2 === pgSql || pg2.replace(/\s+/g, ' ') === pgSql.replace(/\s+/g, ' '), 'diff')
}
// one-to-one => unique constraint is created as separate alter; importer misses ALTER ADD CONSTRAINT UNIQUE
{
  const a = parse('Table u {\n id int [pk]\n}\nTable p {\n id int [pk]\n u_id int\n}\nRef: p.u_id - u.id\n')
  const b = ddlToSchema(toSQL(a, 'postgres'))
  check('one-to-one (-) survives roundtrip as unique FK (uq via ALTER TABLE ADD CONSTRAINT UNIQUE is dropped by importer)', b.tables.find((t) => t.name === 'p').fields.find((f) => f.name === 'u_id').unique, 'unique lost')
}
// roundtrip through sqlite & mysql generators -> importer
for (const d of ['mysql', 'sqlite']) {
  const a = parse(cases.rich)
  const b = ddlToSchema(toSQL(a, d))
  const A = norm(a), B = norm(b)
  check(`rich: ${d} DDL -> import keeps all ${Object.keys(A.t).length} tables`, Object.keys(A.t).every((k) => B.t[k]), J(Object.keys(B.t)))
  check(`rich: ${d} DDL -> import keeps FK refs (${A.refs.length})`, J(A.refs) === J(B.refs), `${J(A.refs)} -> ${J(B.refs)}`)
  check(`rich: ${d} DDL -> import keeps pk/inc of users.id`, B.t.users?.fields.id.pk && B.t.users?.fields.id.inc, J(B.t.users?.fields.id))
}
done('f.json')
