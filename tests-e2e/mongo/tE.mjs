import fs from 'fs'
import * as L from './lib.mjs'
import { check } from './lib.mjs'
import { loadMongoose, validate, mongoose, runShell, require } from './harness.mjs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { useMongoIds } from '../../packages/schema/src/generators/mongo.js'
const { EJSON } = require('bson')
const E = 'E round trip'
console.log('mongoose', mongoose.version)

// ------------- E1: DSL -> mongoose paths vs DSL fields
const INSTANCE = { string: 'String', text: 'String', int: 'Number', long: 'Number', double: 'Number', decimal: 'Decimal128', bool: 'Boolean', boolean: 'Boolean', date: 'Date', objectid: 'ObjectId', json: 'Mixed', object: 'Mixed', buffer: 'Buffer' }
function pathInfo(sch, name) {
  const p = sch.path(name)
  if (p) return { inst: p.instance, arr: p.instance === 'Array', elem: p.instance === 'Array' ? (p.caster?.instance ?? (p.$isMongooseDocumentArray ? 'DocArray' : p.options?.type?.[0]?.name ?? '?')) : null, p }
  if (sch.pathType(name) === 'nested') return { inst: 'nested' }
  return null
}
const SRC = [L.SAMPLE_MONGO, `
Table prod {
  _id objectid [pk]
  name string [not null]
  qty int
  big long
  price double
  amount decimal
  ok bool
  at date
  tags string[]
  nums int[]
  refs objectid[]
  meta json
  raw object
  bin buffer
  dim Dim
  dims Dim[]
  owner objectid
}
Table Dim [embedded] {
  w double
  h double
  unit string
}
Ref: prod.owner > prod._id
`, (fs.existsSync('school.dsl') ? fs.readFileSync('school.dsl', 'utf8') : '')]
for (const [si, dsl] of SRC.entries()) {
  const schema = useMongoIds(L.parse(dsl))
  const r = loadMongoose(L.parse(dsl), 'e1_' + si)
  check(E, `E1[${si}] compiles`, !r.error, r.error?.message)
  if (r.error) continue
  const roots = L.rootTables(schema)
  let total = 0, good = 0; const bad = []
  for (const t of roots) {
    const Model = Object.values(r.models).find((m) => m.collection.name === t.name)
    if (!Model) { bad.push(`no model for ${t.name}`); continue }
    for (const f of t.fields) {
      if (f.pk && f.name === '_id') continue
      total++
      const info = pathInfo(Model.schema, f.name)
      if (!info) { bad.push(`${t.name}.${f.name}: path missing`); continue }
      const isRef = schema.refs.some((x) => (x.from.table === t.name && x.from.field === f.name) || (x.type === '<' && x.to.table === t.name && x.to.field === f.name))
      const emb = L.embeddedTarget(schema, f)
      const arr = /\[\]$/.test(f.type)
      const b = f.type.replace(/\[\]$/, '').toLowerCase()
      let want = emb ? (arr ? 'Array' : 'nested') : isRef ? (arr ? 'Array' : 'ObjectId') : arr ? 'Array' : (INSTANCE[b] ?? 'String')
      if (want === 'nested' && info.inst === 'Mixed') want = 'Mixed' // recursion fallback
      if (info.inst === want) good++; else bad.push(`${t.name}.${f.name}: dsl ${f.type} -> mongoose ${info.inst} (wanted ${want})`)
    }
  }
  console.log(`E1[${si}] ${good}/${total}`, bad)
  // decimal known mismatch counted
  check(E, `E1[${si}] mongoose path types match DSL (${good}/${total})`, bad.length === 0, bad.join('; '))
}

// ------------- E2: DSL -> serialize -> parse equality
for (const [si, dsl] of SRC.entries()) {
  const a = L.parse(dsl)
  const code = L.serialize(a)
  const b = L.parse(code)
  const norm = (s) => JSON.stringify({ t: s.tables, r: s.refs.map((r) => [r.from, r.to, r.type]) })
  check(E, `E2[${si}] parse(serialize(parse(dsl))) deep-equals parse(dsl)`, norm(a) === norm(b) && b.errors.length === 0, JSON.stringify(b.errors))
  check(E, `E2[${si}] serialize idempotent`, L.serialize(b) === code)
}
// randomized DSL fuzz of serialize/parse
{
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const names = ['a', 'b_c', 'ผู้ใช้', 'with space', 'x.y', 'Table', 'it\'s', '1x', 'ref', 'note', 'pk', 'not null', '$d', 'q"q', 'a-b', 'unique', 'indexes']
  const types = ['string', 'int', 'objectid', 'date', 'string[]', 'json', 'double', 'bool', 'varchar(255)', 'decimal(10,2)', 'int[]']
  const vals = [null, 'x', "it's", 'a b', '5', '-1.5', 'now()', 'ผม', 'a,b', '[x]', '// c', '', 'true', '007']
  let bad = 0, tot = 0; const samples = []
  for (let n = 0; n < 300; n++) {
    const tables = []
    for (let i = 0; i < 2; i++) {
      const fields = []
      const used = new Set()
      for (let j = 0; j < 4; j++) {
        const nm = pick(names); if (used.has(nm)) continue; used.add(nm)
        const f = { ...L.newField(nm, pick(types)), pk: rnd() < 0.2, unique: rnd() < 0.2, notNull: rnd() < 0.3, default: pick(vals), note: pick(vals) }
        if (f.pk) f.notNull = true
        if (rnd() < 0.5) f.note = null
        fields.push(f)
      }
      tables.push({ name: i ? pick(['T2', 'tbl 2', 'ตาราง']) : pick(['T1', 'order', 'my table']), note: pick([null, null, 'n', 'x y']), embedded: rnd() < 0.2, fields, indexes: [] })
    }
    if (tables[0].name === tables[1].name) continue
    tot++
    const s = { tables, refs: [], errors: [] }
    const code = L.serialize(s); const p = L.parse(code)
    const same = JSON.stringify(p.tables) === JSON.stringify(tables)
    if (p.errors.length || !same) { bad++; if (samples.length < 6) samples.push({ errors: p.errors.slice(0, 2), code: code.slice(0, 220) }) }
  }
  console.log(`fuzz serialize/parse: ${tot - bad}/${tot} ok`); console.log(JSON.stringify(samples.slice(0, 4), null, 1))
  check(E, `E2 fuzz: serialize->parse identity on random schemas (${tot - bad}/${tot})`, bad === 0, `${bad} schemas changed/failed; e.g. ${JSON.stringify(samples[0])}`)
}

// ------------- E3: docs -> schema -> models -> validate originals
const mk = (o) => o
const D = {}
D.users = [
  { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'ก', email: 'a@x.com', age: 31, score: 10, created: { $date: '2021-01-01T00:00:00Z' }, tags: ['a', 'b'], address: { street: 's', city: 'c', geo: { lat: 13.7, lng: 100.5 } }, orders: [{ sku: 'a', qty: 1, price: 10 }, { sku: 'b', qty: 2, price: 5.5 }], active: true },
  { _id: { $oid: '507f1f77bcf86cd799439012' }, name: 'ข', email: null, age: null, score: 2.5, created: { $date: '2021-02-01T00:00:00Z' }, tags: [], address: null, orders: [], active: false, extra: 'only here' },
  { _id: { $oid: '507f1f77bcf86cd799439013' }, name: 'ค', score: 3, tags: ['x'], address: { street: 's2', geo: { lat: 1, lng: 2 } }, orders: [{ sku: 'c', qty: 1 }], active: true, ref: { $oid: '507f1f77bcf86cd799439011' } },
]
D.big = [{ _id: { $oid: '507f1f77bcf86cd799439021' }, n: { $numberLong: '9007199254740993' }, d: { $numberDecimal: '12.50' }, i: { $numberInt: '5' }, x: 1.5, big: 12345678901, ts: { $date: { $numberLong: '1577836800000' } }, bin: { $binary: { base64: 'AAEC', subType: '00' } } }]
D.mixed = [{ v: 1 }, { v: 'a' }, { v: [1, 2] }, { v: { z: 1 } }, { v: null }, { w: [1, 'a', { q: 1 }] }, { w: [[1], [2]] }]
D.dates = [{ s: '2020-01-02', t: '2020-01-02T03:04:05Z', u: 'hello', hex: '507f1f77bcf86cd799439011', hex2: 'not an id' }, { s: '2020-01-02', t: '2020-01-02T03:04:05Z', u: '2020-01-03', hex: '507f1f77bcf86cd799439012', hex2: 'abcdefabcdefabcdefabcdef' }]
D.thai = [{ ชื่อ: 'สมชาย', ที่อยู่: { ถนน: 'สุขุมวิท', จังหวัด: 'กรุงเทพ' }, 'เบอร์ โทร': ['081', '082'] }]
D.nested = [{ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }]
D.arrays = [{ aoo: [{ x: 1 }, { x: 'a' }], aoo2: [{ x: 1, y: { z: 1 } }, { y: null }], prim: [1, 2.5], strs: ['a'], ids: ['507f1f77bcf86cd799439011'], nulls: [null, 1] }]
D.reserved = [{ type: 'a', errors: 1, collection: 'x', save: 1, id: 7, constructor: 'c', __v: 3, schema: 's' }]
D.keys = [{ 'a.b': 1, 'with space': 2, $d: 3, 'ชื่อ': 'ก' }]
D.pk = [{ _id: 'abc', v: 1 }, { _id: 'def', v: 2 }]
D.intid = [{ _id: 1, v: 1 }, { _id: 2, v: 2 }]
D.objid = [{ _id: { $oid: '507f1f77bcf86cd799439031' }, parent: { $oid: '507f1f77bcf86cd799439031' }, kids: [{ $oid: '507f1f77bcf86cd799439031' }] }]

const server = await MongoMemoryServer.create()
const client = await MongoClient.connect(server.getUri())
let dbn = 100
for (const [name, docs] of Object.entries(D)) {
  const cols = L.parseMongoExport(JSON.stringify(docs), name)
  const schema = L.mongoToSchema(cols)
  const dsl = L.serialize(schema)
  const p = L.parse(dsl)
  if (p.errors.length) console.log(name, 'DSL errors', JSON.stringify(p.errors))
  const real = EJSON.parse(JSON.stringify(docs), { relaxed: false }) // typed BSON
  const relaxed = EJSON.parse(JSON.stringify(docs), { relaxed: true })
  // mongoose
  const r = loadMongoose(p.errors.length ? schema : p, 'e3_' + name)
  if (r.error) { check(E, `E3[${name}] generated mongoose compiles`, false, r.error.message.split('\n')[0]); }
  else {
    const Model = Object.values(r.models).find((m) => m.collection.name === L.rootTables(schema)[0]?.name) ?? Object.values(r.models)[0]
    const rejected = []
    relaxed.forEach((d, i) => { const e = validate(Model, d); if (e.length) rejected.push(`doc${i}: ${e.join(',')}`) })
    check(E, `E3[${name}] mongoose model accepts original docs (${relaxed.length - rejected.length}/${relaxed.length})`, rejected.length === 0, rejected.join(' | '))
  }
  // mongo validator on real server
  const db = client.db('e3_' + ++dbn)
  let res
  try { res = await runShell(db, L.toMongoShell(p.errors.length ? schema : p)) } catch (e) { check(E, `E3[${name}] shell script runs`, false, e.message); continue }
  check(E, `E3[${name}] shell script runs on mongod`, res.errors.length === 0, res.errors.join(' | '))
  const coll = db.collection(L.rootTables(schema)[0].name)
  const rej = []
  for (const [i, d] of relaxed.entries()) { try { await coll.insertOne(d) } catch (e) { rej.push(`doc${i}: ${e.code === 121 ? JSON.stringify(e.errInfo?.details?.schemaRulesNotSatisfied?.map((x) => x.operatorName + ':' + (x.propertiesNotSatisfied ?? x.missingProperties ?? '').toString().slice(0, 80)) ?? '').slice(0, 220) : e.message.slice(0, 100)}`) } }
  check(E, `E3[${name}] mongod validator accepts original docs, relaxed EJSON (${relaxed.length - rej.length}/${relaxed.length})`, rej.length === 0, rej.join(' | '))
  if (name === 'big') {
    const db2 = client.db('e3_' + ++dbn); await runShell(db2, L.toMongoShell(p)); const c2 = db2.collection(L.rootTables(schema)[0].name)
    try { await c2.insertOne(real[0]); check(E, 'E3[big] exact typed BSON docs (Long/Decimal128/Int32) accepted by validator', true) } catch (e) { check(E, 'E3[big] exact typed BSON docs (Long/Decimal128/Int32) accepted by validator', false, JSON.stringify(e.errInfo?.details?.schemaRulesNotSatisfied?.[0]?.propertiesNotSatisfied?.map((x) => x.propertyName + ':' + x.details?.[0]?.reason) ?? e.message)) }
  }
  if (['users', 'mixed', 'dates', 'keys', 'reserved'].includes(name)) console.log(`--- ${name} DSL\n${dsl}`)
}
await client.close(); await server.stop()
L.summary()
fs.writeFileSync('res_E.json', JSON.stringify(L.results))
