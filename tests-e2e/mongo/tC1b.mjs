import fs from 'fs'
import * as L from './lib.mjs'
import { check } from './lib.mjs'
import { loadMongoose, validate, mongoose } from './harness.mjs'
const C = 'C mongoose'
const OID = () => new mongoose.Types.ObjectId()

// Thai quoted
{
  const dsl = `Table "ผู้ใช้" {
  _id objectid [pk]
  "ชื่อ" string [not null]
  "first name" string
  "อายุ" int
  "ที่อยู่" "ที่อยู่ย่อย"
}
Table "ที่อยู่ย่อย" [embedded] {
  "ถนน" string [not null]
}
Table "คำสั่งซื้อ" {
  _id objectid [pk]
  "ผู้ซื้อ" objectid
}
Ref: "คำสั่งซื้อ"."ผู้ซื้อ" > "ผู้ใช้"._id
`
  const s = L.parse(dsl)
  console.log('thai dsl errors', JSON.stringify(s.errors))
  check(C, 'Thai quoted DSL parses', s.errors.length === 0, JSON.stringify(s.errors))
  const r = loadMongoose(s, 'thai')
  console.log(r.code)
  check(C, 'Thai quoted names compile in mongoose', !r.error, r.error?.message)
  if (!r.error) console.log(Object.keys(r.models))
}
// Thai field type for embedded: type text w/o quotes
{
  const dsl = 'Table t {\n  "ที่อยู่" ที่อยู่ย่อย\n}\nTable "ที่อยู่ย่อย" [embedded] {\n  a int\n}\n'
  const s = L.parse(dsl); console.log('thai type unquoted errors', JSON.stringify(s.errors))
  console.log('relations', JSON.stringify(L.deriveRelations(s).map((x) => x.kind + ':' + x.from.table + '>' + x.to.table)))
}
// serialize of refs/indexes with names that need quoting
{
  const base = L.parse('Table "ผู้ใช้" {\n  _id objectid [pk]\n  "first name" objectid\n}\nTable b {\n  _id objectid [pk]\n  "ชื่อ" objectid\n  "a b" string\n  indexes {\n    ("ชื่อ", "a b") [unique]\n  }\n}\nRef: b."ชื่อ" > "ผู้ใช้"._id\n')
  console.log('base errors', JSON.stringify(base.errors))
  const code = L.serialize(base)
  console.log(code)
  const p = L.parse(code)
  check('A import', 'serialize(): Ref lines with non-ASCII/space names are quoted (reparse clean)', p.errors.length === 0, JSON.stringify(p.errors))
  check('A import', 'serialize(): refs preserved after reparse', p.refs.length === base.refs.length, `refs ${p.refs.length}/${base.refs.length}`)
  check('A import', 'serialize(): index fields with non-ASCII/space names quoted', p.errors.every((e) => !/index/i.test(e.message)) && JSON.stringify(p.tables[1].indexes) === JSON.stringify(base.tables[1].indexes), JSON.stringify(p.tables[1].indexes))
}
// the spec path: Thai field name that is a ref
{
  const { schema, code } = L.importRows([{ name: 'USER', rows: [['Field', 'Type'], ['id', 'obj']] }, { name: 'DOC', rows: [['Field', 'Type'], ['id', 'obj'], ['ผู้สร้าง', 'string (user)'], ['created by', 'string (user)'], ['ok', 'string (user)']] }])
  console.log(code)
  const p = L.parse(code)
  check('B spec', 'spec: Thai / spaced field with (user) ref -> serialize->parse keeps all 3 refs', p.errors.length === 0 && p.refs.length === 3, `refs ${p.refs.length}/3 errors ${JSON.stringify(p.errors)}`)
}
// serialize escaping of quotes in notes/defaults
{
  const mk = (note, def) => ({ tables: [{ name: 't', note, embedded: false, fields: [{ name: 'a', type: 'string', pk: false, unique: false, notNull: false, increment: false, default: def, note }], indexes: [] }], refs: [], errors: [] })
  for (const v of ["it's", 'say "hi"', 'a, b', 'x] y', 'back\\slash', "a'b'c", 'line1\nline2', 'ผม/ฉัน', 'with // slash', '[brackets]']) {
    const s = mk(v, v)
    const code = L.serialize(s)
    const p = L.parse(code)
    const f = p.tables[0]?.fields[0]
    const okk = p.errors.length === 0 && f?.note === v && f?.default === v && p.tables[0].note === v
    check('A import', `serialize/parse roundtrip of note+default ${JSON.stringify(v)}`, okk, `errors=${JSON.stringify(p.errors)} note=${JSON.stringify(f?.note)} default=${JSON.stringify(f?.default)} tnote=${JSON.stringify(p.tables[0]?.note)}`)
  }
}
// code-injection through names in generated mongoose file
{
  const evil = "x'); globalThis.__PWNED = 1; ('"
  const s = { tables: [{ name: evil, note: null, embedded: false, fields: [{ name: 'a', type: 'int', pk: false, unique: false, notNull: false, increment: false, default: null, note: null }], indexes: [] }], refs: [], errors: [] }
  const r = loadMongoose(s, 'inject')
  console.log('injection compile:', r.error?.message?.split('\n')[0], 'pwned=', globalThis.__PWNED)
  check(C, 'table name cannot inject JS into generated mongoose file', globalThis.__PWNED !== 1 && !r.error, r.error?.message?.split('\n')[0] + ' pwned=' + globalThis.__PWNED)
  const s2 = { tables: [{ name: 'a', note: null, embedded: false, fields: [{ name: 'f', type: 'int', pk: false, unique: false, notNull: false, increment: false, default: '"); globalThis.__P2 = 1; ("', note: null }], indexes: [] }], refs: [], errors: [] }
  const r2 = loadMongoose(s2, 'inject2'); console.log('default injection', r2.error?.message?.split('\n')[0], globalThis.__P2)
  const s3 = { tables: [{ name: 'a', note: null, embedded: false, fields: [{ name: 'f', type: 'int', pk: false, unique: false, notNull: false, increment: false, default: null, note: null }], indexes: [{ fields: ['f); globalThis.__P3 = 1; ({'], unique: false, name: null }] }], refs: [], errors: [] }
  const r3 = loadMongoose(s3, 'inject3'); console.log('index injection', r3.error?.message?.split('\n')[0], globalThis.__P3)
}
// pascal-case collision handling summary
for (const [a, b] of [['user', 'User'], ['user_profile', 'UserProfile'], ['user-profile', 'user profile'], ['user_profile', 'user__profile']]) {
  const s = L.parse(`Table "${a}" {\n  x int\n}\nTable "${b}" {\n  x int\n}\n`)
  const r = loadMongoose(s, 'coll')
  console.log(`collision ${a} / ${b}:`, r.error ? 'ERR ' + r.error.message.split('\n')[0] : 'ok ' + Object.keys(r.models))
}
// tables whose name equals a primitive type hijack the type
{
  const s = L.parse('Table string {\n  x int\n}\nTable t {\n  name string\n  d date\n}\nTable date {\n  y int\n}\n')
  const rel = L.deriveRelations(s)
  console.log('table named "string"/"date" hijack ->', rel.map((x) => `${x.from.table}.${x.from.field}->${x.to.table}`))
  check('C mongoose', 'a table named like a primitive type (string/date) does not hijack fields of that type', rel.filter((x) => x.kind === 'embed').length === 0, JSON.stringify(rel.map((x) => x.id)))
}
L.summary()
fs.writeFileSync('res_C1b.json', JSON.stringify(L.results))
