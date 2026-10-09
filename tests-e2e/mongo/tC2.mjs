import fs from 'fs'
import * as L from './lib.mjs'
import { check } from './lib.mjs'
import { loadMongoose, validate, mongoose, runShell, require } from './harness.mjs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, ObjectId, Int32, Long, Double, Decimal128, Binary } from 'mongodb'
const C = 'C shell'
const server = await MongoMemoryServer.create()
const client = await MongoClient.connect(server.getUri())
console.log('mongod version', (await client.db('admin').command({ buildInfo: 1 })).version)
let n = 0
const freshDb = () => client.db('t' + ++n)
const tryInsert = async (coll, doc) => { try { await coll.insertOne(doc); return null } catch (e) { return e.code === 121 ? 'validation' : e.code === 11000 ? 'dup' : e.message.slice(0, 100) } }

const DSL = `
Table users {
  _id objectid [pk]
  email string [unique, not null]
  nick string [unique]
  age int
  score double
  price decimal
  big long
  active bool
  created date
  tags string[]
  address Address
  items Item[]
  mgr objectid
  meta json
  raw object
  bin buffer
  note text [note: 'free text']
  indexes {
    (age, email) [unique]
    email
  }
}
Table Address [embedded] {
  street string [not null]
  geo Geo
}
Table Geo [embedded] {
  lat double [not null]
  lng double
}
Table Item [embedded] {
  sku string [not null]
  qty int
}
Ref: users.mgr > users._id
`
{
  const schema = L.parse(DSL)
  const script = L.toMongoShell(schema)
  fs.writeFileSync('gen/shell_users.js', script)
  const db = freshDb()
  const res = await runShell(db, script)
  console.log('shell ops', res)
  check(C, 'users: all createCollection/createIndex calls succeed on real mongod', res.errors.length === 0, res.errors.join(' | '))
  const U = db.collection('users')
  const oid = () => new ObjectId()
  const good = () => ({ _id: oid(), email: 'a@x.com' + Math.random(), nick: 'n' + Math.random(), age: 5, score: 1.5, active: true, created: new Date(), tags: ['a'], address: { street: 's', geo: { lat: 1.5, lng: 2.5 } }, items: [{ sku: 'a', qty: 1 }], mgr: oid(), meta: { any: 1 }, raw: [1, 2], bin: new Binary(Buffer.from('x')), price: Decimal128.fromString('1.5'), big: Long.fromNumber(5), note: 'hi' })
  check(C, 'valid typed doc accepted', (await tryInsert(U, good())) === null, String(await tryInsert(U, good())))
  const rej = async (label, mut) => { const d = good(); mut(d); const r = await tryInsert(U, d); check(C, `invalid rejected: ${label}`, r === 'validation', 'result=' + r) }
  await rej('missing email', (d) => delete d.email)
  await rej('age is string', (d) => (d.age = 'x'))
  await rej('mgr is garbage string', (d) => (d.mgr = 'garbage'))
  await rej('address.street missing', (d) => delete d.address.street)
  await rej('items[0].qty string', (d) => (d.items[0].qty = 'a'))
  await rej('tags contains number', (d) => (d.tags = [1]))
  await rej('created is string', (d) => (d.created = '2020-01-01'))
  await rej('address.geo.lat missing', (d) => delete d.address.geo.lat)
  await rej('_id missing? (server adds) -> n/a', (d) => (d.email = 5))
  // accept checks
  const rej2 = async (label, mut) => { const d = good(); mut(d); const r = await tryInsert(U, d); check(C, `rejected (correct): ${label}`, r === 'validation', 'result=' + r) }
  const acc = async (label, mut) => { const d = good(); mut(d); const r = await tryInsert(U, d); check(C, `accepted: ${label}`, r === null, 'result=' + r); return r }
  await acc('optional fields omitted (only email)', (d) => { for (const k of Object.keys(d)) if (!['_id', 'email'].includes(k)) delete d[k] })
  // numeric representability (what real drivers/Mongoose produce)
  await acc('score: 10 (JS integer -> driver Int32) into double field', (d) => (d.score = 10))
  await acc('score: 10.0 via new Double(10)', (d) => (d.score = new Double(10)))
  await rej2('score: Long (5) into double field (strict: should be rejected)', (d) => (d.score = Long.fromNumber(5)))
  await acc('age: 5 as Int32 explicit', (d) => (d.age = new Int32(5)))
  await rej2('age: 3000000000 (JS number beyond int32 -> double) into int field (strict: should be rejected)', (d) => (d.age = 3000000000))
  await acc('big: 5 (JS number -> Int32) into long field', (d) => (d.big = 5))
  await rej2('big: 9007199254740993 as JS number into long field (strict: should be rejected)', (d) => (d.big = 9007199254740993))
  await rej2('price: 1.5 JS number into decimal field (strict: should be rejected)', (d) => (d.price = 1.5))
  await acc('age: null (explicit null for optional field)', (d) => (d.age = null))
  await acc('nick: null', (d) => (d.nick = null))
  await acc('address: null', (d) => (d.address = null))
  await acc('tags: null', (d) => (d.tags = null))
  await acc('extra undeclared field', (d) => (d.extra = 1))
  // unique + sparse
  const d1 = good(); delete d1.nick; d1.email = 'u1'; const d2 = good(); delete d2.nick; d2.email = 'u2'
  const r1 = await tryInsert(U, d1), r2 = await tryInsert(U, d2)
  check(C, 'two docs both WITHOUT optional unique field `nick` can coexist', r1 === null && r2 === null, `first=${r1} second=${r2} (unique index is not sparse)`)
  const d3 = good(); d3.email = 'dup-email'; const d4 = good(); d4.email = 'dup-email'; d4.age = 77; d3.age = 66
  await tryInsert(U, d3); check(C, 'unique email enforced', (await tryInsert(U, d4)) === 'dup')
  const idx = await U.indexes(); console.log('indexes', idx.map((i) => `${i.name}${i.unique ? ' unique' : ''}`))
  check(C, 'index list includes email_1 / nick_1 / age_1_email_1', ['email_1', 'nick_1', 'age_1_email_1'].every((n) => idx.some((i) => i.name === n)))
}

// duplicate-ish index declarations
{
  const db = freshDb()
  const s = L.parse('Table t {\n  _id objectid [pk]\n  email string [unique]\n  indexes {\n    email\n  }\n}')
  const script = L.toMongoShell(s); console.log(script)
  const res = await runShell(db, script)
  check(C, 'field [unique] + `indexes { email }` (same key, different options) does not error', res.errors.length === 0, res.errors.join(' | '))
  const s2 = L.parse('Table t {\n  _id objectid [pk]\n  a int\n  b int\n  indexes {\n    (a, b) [unique]\n    (a, b)\n  }\n}')
  const res2 = await runShell(freshDb(), L.toMongoShell(s2))
  check(C, 'same compound index declared unique and non-unique does not error', res2.errors.length === 0, res2.errors.join(' | '))
  const s3 = L.parse("Table t {\n  _id objectid [pk]\n  a int\n  b int\n  indexes {\n    (a, b) [name: 'my_idx', unique]\n  }\n}")
  const d3 = freshDb(); await runShell(d3, L.toMongoShell(s3)); const ix3 = await d3.collection('t').indexes()
  check(C, 'index [name: my_idx] honoured in mongosh output', ix3.some((i) => i.name === 'my_idx'), 'indexes=' + ix3.map((i) => i.name).join())
  const s4 = L.parse('Table t {\n  _id objectid [pk]\n  _id2 int\n  indexes {\n    zzz [unique]\n  }\n}')
  const r4 = await runShell(freshDb(), L.toMongoShell(s4)); check(C, 'index on nonexistent field is accepted by server (no warning in tool)', r4.errors.length === 0, r4.errors.join())
}

// names & edge cases against real mongod
const edge = {
  'zero tables': '',
  'table no fields': 'Table empty {\n}',
  'only embedded': 'Table E [embedded] {\n  a int\n}',
  '_id string pk': 'Table t {\n  _id string [pk]\n  a int\n}',
  '_id int pk': 'Table t {\n  _id int [pk]\n}',
  'id int pk (SQL style)': 'Table t {\n  id int [pk, increment]\n  a int\n}',
  'id objectid pk -> _id': 'Table t {\n  id objectid [pk]\n  a int\n}',
  'spaces/dots/Thai names': 'Table "a b" {\n  "x y" string\n  "ชื่อ" string [unique]\n  "a.b" int\n}\nTable "ผู้ใช้" {\n  a int\n  indexes {\n    ("a")\n  }\n}\nTable "a.b" {\n  a int [unique]\n}',
  'collection name with $': 'Table "a$b" {\n  a int [unique]\n}',
  'collection name system.x': 'Table "system.x" {\n  a int\n}',
  'collection name empty-ish "-"': 'Table "-" {\n  a int [unique]\n}',
  'collection name with quote': 'Table `a"b` {\n  a int [unique]\n}',
  'collection name with apostrophe': 'Table "it\'s" {\n  a int [unique]\n}',
  'ref to embedded-only': 'Table E [embedded] {\n  _id objectid [pk]\n  x int\n}\nTable t {\n  _id objectid [pk]\n  e_id objectid [not null]\n}\nRef: t.e_id > E._id',
  'N:M': 'Table a {\n  _id objectid [pk]\n}\nTable b {\n  _id objectid [pk]\n}\nRef: a._id <> b._id',
  'recursion': 'Table t {\n  _id objectid [pk]\n  n Node\n}\nTable Node [embedded] {\n  v int\n  next Node\n}',
  'compound unique': 'Table t {\n  a int\n  b int\n  indexes {\n    (a, b) [unique]\n  }\n}',
  'unknown types': 'Table t {\n  a foo\n  b varchar(20)\n  c jsonb\n  d money\n}',
  'enum/uuid/email/url': 'Table t {\n  a enum\n  b uuid\n  c email\n  d url\n}',
  'huge table 500 fields': 'Table t {\n' + Array.from({ length: 500 }, (_, i) => `  f${i} ${['int', 'string', 'date', 'bool'][i % 4]} ${i % 50 === 0 ? '[unique]' : ''}`).join('\n') + '\n}',
  'array of embedded arrays pk': 'Table t {\n  a E[]\n}\nTable E [embedded] {\n  b E2[]\n}\nTable E2 [embedded] {\n  c int [not null]\n}',
  'pk non-id name': 'Table t {\n  code string [pk]\n  a int\n}',
  'note makes description with quotes': "Table t {\n  a int [note: 'say \"hi\" \\\\n']\n}",
  'big index count (65 indexes)': 'Table t {\n' + Array.from({ length: 66 }, (_, i) => `  f${i} int [unique]`).join('\n') + '\n}',
}
for (const [name, dsl] of Object.entries(edge)) {
  const s = L.parse(dsl)
  let script, res
  try { script = L.toMongoShell(s) } catch (e) { check(C, `edge: ${name}`, false, 'generator threw ' + e.message); continue }
  try { res = await runShell(freshDb(), script) } catch (e) { check(C, `edge: ${name}`, false, 'script not valid JS/mongosh: ' + e.message.slice(0, 120)); continue }
  console.log(res.errors.length ? 'FAIL' : 'OK  ', name, res.errors.join(' | ').slice(0, 300))
  check(C, `edge: ${name}${s.errors.length ? ' (dsl errors: ' + s.errors.map((e) => e.message).join(';') + ')' : ''}`, res.errors.length === 0, res.errors.join(' | ').slice(0, 300))
}

// Mongoose (generated models) -> real server with generated validators: do they agree?
{
  const dsl = `Table prod {
  _id objectid [pk]
  name string [not null]
  price double [not null]
  qty int
  big long
  amount decimal
  nick string [unique]
  opt string
  made date
  tags string[]
  meta json
  dims Dims
}
Table Dims [embedded] {
  w double
  h int
}
`
  const schema = L.parse(dsl)
  const r = loadMongoose(schema, 'live'); const P = r.models.Prod
  const db = freshDb(); const out = await runShell(db, L.toMongoShell(schema)); console.log('live shell', out)
  await mongoose.connect(server.getUri(), { dbName: db.databaseName, autoIndex: true })
  P.schema.set('autoCreate', false)
  await P.init().catch((e) => console.log('init err', e.message))
  let k = 0; const nk = () => ({ nick: 'u' + ++k })
  const tryCreate = async (label, doc, expectOk = true) => {
    try { await P.create(doc); return null } catch (e) { return e.code === 121 || /validation/i.test(e.message) && e.code === 121 ? 'server-validation' : e.name === 'ValidationError' ? 'mongoose-validation' : e.code === 11000 ? 'dup' : e.message.slice(0, 120) }
  }
  const t = async (label, doc, want = null) => { const got = await tryCreate(label, doc); check('E roundtrip', `generated Mongoose model writes to generated validator: ${label}`, got === want, `result=${got}`) }
  await t('integer-valued price (price: 100) into `double` field', { name: 'a', price: 100, ...nk() })
  await t('fractional price (19.99)', { name: 'a', price: 19.99, ...nk() })
  await t('qty: 3 into int', { name: 'a', price: 1.5, qty: 3, ...nk() })
  await t('big: 5 into long field', { name: 'a', price: 1.5, big: 5, ...nk() })
  await t('big: 3e10 into long field', { name: 'a', price: 1.5, big: 3e10, ...nk() })
  await t('amount: 12.5 into decimal field', { name: 'a', price: 1.5, amount: 12.5, ...nk() })
  await t('nested dims {w: 2, h: 3}', { name: 'a', price: 1.5, dims: { w: 2, h: 3 }, ...nk() })
  await t('nested dims {w: 2.5, h: 3}', { name: 'a', price: 1.5, dims: { w: 2.5, h: 3 }, ...nk() })
  await t('two docs w/o unique-optional `nick` (index from Mongoose)', { name: 'b1', price: 1.5 })
  await t('second doc w/o `nick`', { name: 'b2', price: 1.5 })
  await t('explicit null for optional string', { name: 'a', price: 1.5, opt: null, ...nk() })
  await mongoose.disconnect()
}

console.log(L.results.filter((r) => !r.ok).length, 'failures')
L.summary()
fs.writeFileSync('res_C2.json', JSON.stringify(L.results))
await client.close(); await server.stop()
