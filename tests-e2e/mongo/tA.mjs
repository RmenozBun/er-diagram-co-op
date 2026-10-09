import fs from 'fs'
import * as L from './lib.mjs'
import { check } from './lib.mjs'
const A = 'A import'
const imp = (text, name = 'c') => L.mongoToSchema(L.parseMongoExport(text, name))
const sig = (s) => JSON.stringify(s.tables.map((t) => [t.name, t.embedded, t.fields.map((f) => [f.name, f.type, f.pk, f.notNull])]))
function rt(label, schema) {
  const code = L.serialize(schema)
  const p = L.parse(code)
  check(A, `${label}: serialize->parse no errors`, p.errors.length === 0, p.errors.slice(0, 3).map((e) => e.message + '@' + e.line).join('; '))
  const same = sig(p) === sig(schema)
  check(A, `${label}: parse(serialize) equals original`, same, same ? '' : 'structure differs')
  return { code, p }
}
const ty = (s, t, f) => s.tables.find((x) => x.name === t)?.fields.find((x) => x.name === f)?.type
const show = (s) => console.log(L.serialize(s))

// 1 extended json
let s = imp(JSON.stringify([{ _id: { $oid: '507f1f77bcf86cd799439011' }, d: { $date: '2020-01-01T00:00:00Z' }, n: { $numberLong: '5' }, dec: { $numberDecimal: '1.5' }, bin: { $binary: { base64: 'AA==', subType: '00' } }, i: { $numberInt: '3' }, dbl: { $numberDouble: '1.5' }, ts: { $timestamp: { t: 1, i: 1 } }, rx: { $regularExpression: { pattern: 'a', options: '' } }, d2: { $date: { $numberLong: '1577836800000' } }, u: { $uuid: 'x' }, mk: { $minKey: 1 } }]), 'ext')
show(s)
check(A, 'ext: _id objectid pk', ty(s, 'ext', '_id') === 'objectid' && s.tables[0].fields.find((f) => f.name === '_id').pk)
check(A, 'ext: $date -> date', ty(s, 'ext', 'd') === 'date')
check(A, 'ext: $numberLong -> long', ty(s, 'ext', 'n') === 'long', 'got ' + ty(s, 'ext', 'n'))
check(A, 'ext: $numberDecimal -> decimal', ty(s, 'ext', 'dec') === 'decimal', 'got ' + ty(s, 'ext', 'dec'))
check(A, 'ext: $binary -> buffer', ty(s, 'ext', 'bin') === 'buffer', 'got ' + ty(s, 'ext', 'bin'))
check(A, 'ext: $numberInt -> int', ty(s, 'ext', 'i') === 'int')
check(A, 'ext: $numberDouble -> double', ty(s, 'ext', 'dbl') === 'double')
check(A, 'ext: $timestamp -> date', ty(s, 'ext', 'ts') === 'date', 'got ' + ty(s, 'ext', 'ts'))
check(A, 'ext: $date{$numberLong} -> date', ty(s, 'ext', 'd2') === 'date', 'got ' + ty(s, 'ext', 'd2'))
check(A, 'ext: $uuid -> not plain string?', ty(s, 'ext', 'u') === 'uuid' || ty(s, 'ext', 'u') === 'string', 'got ' + ty(s, 'ext', 'u'))
rt('ext', s)

// 2 JSONL
s = imp('{"a":1,"b":"x"}\n{"a":2.5,"c":true}\n\n{"a":null}\n', 'lines')
show(s)
check(A, 'jsonl: a int+double -> double', ty(s, 'lines', 'a') === 'double')
check(A, 'jsonl: all keys present', ['a', 'b', 'c'].every((k) => ty(s, 'lines', k)))
rt('jsonl', s)
s = imp('{"a":1}\r\n{"a":2}\r\n'); check(A, 'jsonl CRLF', s.tables.length === 1)

// 3 object-of-collections
s = imp(JSON.stringify({ users: [{ name: 'a' }], 'order items': [{ q: 1 }], 'ผู้ใช้': [{ ชื่อ: 'ก' }] }))
show(s); rt('objcoll', s)
check(A, 'objcoll: 3 collections', s.tables.filter((t) => !t.embedded).length === 3, s.tables.map((t) => t.name).join(','))
s = imp(JSON.stringify({ a: [], b: [{ x: 1 }] })); show(s)
check(A, 'objcoll with empty array: table a exists', !!s.tables.find((t) => t.name === 'a'))
s = imp(JSON.stringify({ a: [1], b: 2 })); check(A, 'obj w/ mixed values -> single doc', s.tables.length === 1 && s.tables[0].name === 'c', s.tables.map((t) => t.name).join())
s = imp(JSON.stringify({ items: [{ a: 1 }] }), 'doc'); console.log('single doc {items:[{a:1}]} ->', s.tables.map((t) => t.name))
s = imp(JSON.stringify({ tags: ['a', 'b'] }), 'doc'); console.log('single doc {tags:[strings]} ->', JSON.stringify(s.tables.map((t) => [t.name, t.fields.map((f) => f.name + ' ' + f.type)])))
check(A, 'single doc {tags:["a","b"]} is a doc with field tags string[] (not collection "tags")', s.tables.some((t) => t.name === 'doc' && ty(s, 'doc', 'tags') === 'string[]'), JSON.stringify(s.tables.map((t) => [t.name, t.fields.map((f) => f.name + ' ' + f.type)])))
s = imp(JSON.stringify({ name: 'x', tags: [] }), 'doc'); console.log('single doc {name,tags:[]} ->', s.tables.map((t) => t.name))
s = imp(JSON.stringify({ tags: [] }), 'doc'); console.log('single doc {tags:[]} ->', s.tables.map((t) => t.name))

// 4 differing keys
s = imp(JSON.stringify([{ a: 1, b: 2 }, { a: 1 }, { a: null, c: 3 }]))
show(s)
const fb = s.tables[0].fields.find((f) => f.name === 'b'), fa = s.tables[0].fields.find((f) => f.name === 'a')
check(A, 'required-ness: field missing in some docs is optional', fb.notNull === false)
check(A, 'required-ness: field null in one doc is not required', fa.notNull === false, 'notNull=' + fa.notNull)
s = imp(JSON.stringify([{ a: 1 }, { a: 2 }])); check(A, 'required-ness: field in ALL docs -> not null (info)', s.tables[0].fields.find((f) => f.name === 'a').notNull === true, 'notNull=' + s.tables[0].fields.find((f) => f.name === 'a').notNull + ' (inferrer never marks required; acceptable but note)')

// 5 deep nesting
let deep = { v: 1 }; for (let i = 0; i < 8; i++) deep = { ['l' + i]: deep, k: i }
s = imp(JSON.stringify([deep])); show(s); rt('deep8', s)
check(A, 'deep: 9 tables', s.tables.length === 9, 'got ' + s.tables.length)

// 6 arrays
s = imp(JSON.stringify([{ p: ['a', 'b'], o: [{ x: 1 }, { x: 2, y: 'z' }], m: [1, 'a', true], aa: [[1, 2], [3]], e: [], eo: {}, mixobj: [{ q: 1 }, 'str'], nums: [1, 2.5] }]))
show(s); rt('arrays', s)
check(A, 'array primitives string[]', ty(s, 'c', 'p') === 'string[]')
check(A, 'array objects -> embedded Table[]', /\[\]$/.test(ty(s, 'c', 'o')) && s.tables.some((t) => t.embedded))
check(A, 'array mixed -> json[]', ty(s, 'c', 'm') === 'json[]', ty(s, 'c', 'm'))
check(A, 'array of arrays -> json[]', ty(s, 'c', 'aa') === 'json[]', ty(s, 'c', 'aa'))
check(A, 'empty array -> some array type', /\[\]$/.test(ty(s, 'c', 'e')), ty(s, 'c', 'e'))
check(A, 'empty object field has a type', !!ty(s, 'c', 'eo'), ty(s, 'c', 'eo'))
check(A, 'array mixing objects+primitives -> json[]', ty(s, 'c', 'mixobj') === 'json[]', 'got ' + ty(s, 'c', 'mixobj'))
check(A, 'nums [1,2.5] -> double[]', ty(s, 'c', 'nums') === 'double[]')

// 7 weird keys
const weird = { 'a.b': 1, 'with space': 2, $dollar: 3, 'ชื่อ': 'ก', '1abc': 4, 'q"uote': 5, "it's": 6, 'back`tick': 7, 'a}b': 1, 'x [pk]': 2, 'a//b': 3, nested: { 'in ner': { 'ไทย ลึก': 1 } }, Table: 1, indexes: 2, note: 3, ref: 4 }
s = imp(JSON.stringify([weird]), 'weird'); show(s)
const r = rt('weirdkeys', s)
const names = L.parse(r.code).tables.flatMap((t) => t.fields.map((f) => f.name))
for (const k of Object.keys(weird)) check(A, `weird key ${JSON.stringify(k)} survives round-trip`, names.includes(k), 'lost/changed -> parsed names: ' + names.filter((n) => n.includes(k.slice(0, 2))).join('|'))
s = imp(JSON.stringify([{ '': 8 }]), 'emptykey'); console.log('empty key ->', L.serialize(s)); rt('emptykey', s)
const pj = JSON.parse('{"__proto__": {"x":1}, "constructor": 2, "toString":3}')
try { s = L.mongoToSchema({ pp: [pj] }); console.log(L.serialize(s)); rt('__proto__', s); check(A, '__proto__ key handled', s.tables[0].fields.some((f) => f.name === '__proto__')) } catch (e) { check(A, '__proto__ key handled', false, e.message) }

// 8 collisions
s = imp(JSON.stringify([{ a_b: { x: 1 }, a: { b: { y: 1 } }, items: [{ i: 1 }], item: { z: 1 } }]), 'user')
show(s); rt('collide', s)
let n2 = s.tables.map((t) => t.name); check(A, 'embedded names unique', new Set(n2).size === n2.length, n2.join())
s = L.mongoToSchema({ User_Address: [{ a: 1 }], User: [{ address: { c: 1 } }] }); show(s)
check(A, 'embedded vs real collection name collision unique', new Set(s.tables.map((t) => t.name)).size === s.tables.length, s.tables.map((t) => t.name).join())
s = L.mongoToSchema({ User: [{ address: { c: 1 } }], user_address: [{ a: 1 }] }); show(s)
check(A, 'names unique case-insensitively', new Set(s.tables.map((t) => t.name.toLowerCase())).size === s.tables.length, s.tables.map((t) => t.name).join())
s = L.mongoToSchema({ 'a b': [{ x: 1 }], 'a-b': [{ x: 2 }], 'a.b': [{ x: 3 }] }); check(A, 'collections "a b","a-b","a.b" distinct', s.tables.length === 3 && new Set(s.tables.map((t) => t.name)).size === 3, s.tables.map((t) => t.name).join())
s = L.mongoToSchema({ 'ผู้ใช้': [{ x: 1 }] }); console.log('thai coll name ->', s.tables.map((t) => t.name)); check(A, 'Thai-only collection name preserved', !/^_*$/.test(s.tables[0].name) && /[ก-๙]/.test(s.tables[0].name), 'name=' + s.tables[0].name)
s = L.mongoToSchema({ '': [{ x: 1 }] }); console.log('empty coll name ->', JSON.stringify(s.tables[0].name)); rt('emptycollname', s)
s = L.mongoToSchema({ '123': [{ x: 1 }] }); console.log('digit coll name ->', JSON.stringify(s.tables[0].name)); rt('digitcoll', s)
// embedded name from Thai keys
s = imp(JSON.stringify([{ 'ที่อยู่': { 'ถนน': 'x' } }]), 'cust'); show(s); rt('thai-embedded', s)
check(A, 'Thai embedded key table name not "Cust_"', !/Cust_?$/.test(s.tables[1]?.name ?? ''), s.tables.map((t) => t.name).join())
// embedded collisions: two keys that sanitize identically
s = imp(JSON.stringify([{ 'ที่อยู่': { a: 1 }, 'ที่ทำงาน': { b: 1 } }]), 'cust'); show(s)
check(A, 'two different Thai embedded keys give distinct, informative tables', new Set(s.tables.map((t) => t.name)).size === 3, s.tables.map((t) => t.name).join())
// pascal() of embedded: key "a_b" in coll "x" vs "a" "b"
s = imp(JSON.stringify([{ 'order-line': [{ i: 1 }] }]), 'o'); show(s)

// 9 types
s = imp(JSON.stringify([{ id: '507f1f77bcf86cd799439011', d1: '2020-01-02', d2: '2020-01-02T03:04:05.123Z', d3: '2020-01-02T03:04:05+07:00', big: 12345678901, neg: -3, bool: true, s: '12345', hex23: 'abcdefabcdefabcdefabcde', word24: 'abcdefabcdefabcdefabcdef' }]))
show(s)
check(A, 'type: 24-hex -> objectid', ty(s, 'c', 'id') === 'objectid')
check(A, 'type: date strings -> date', ['d1', 'd2', 'd3'].every((k) => ty(s, 'c', k) === 'date'))
check(A, 'type: 12345678901 (>int32) -> long', ty(s, 'c', 'big') === 'long', 'got ' + ty(s, 'c', 'big'))
check(A, 'type: 23-hex -> string', ty(s, 'c', 'hex23') === 'string')
s = imp(JSON.stringify([{ _id: 'abc', v: 1 }, { _id: 'def' }])); check(A, '_id string stays string pk', ty(s, 'c', '_id') === 'string' && s.tables[0].fields.find((f) => f.name === '_id').pk)
s = imp(JSON.stringify([{ _id: 5, v: 1 }])); check(A, '_id int stays int', ty(s, 'c', '_id') === 'int')
s = imp(JSON.stringify([{ x: 1 }, { x: 'a' }, { x: { y: 1 } }])); show(s); rt('mixedtypes', s)
check(A, 'int,string,object across docs -> json', ty(s, 'c', 'x') === 'json', ty(s, 'c', 'x'))
s = imp(JSON.stringify([{ x: { $oid: '507f1f77bcf86cd799439011' } }, { x: '507f1f77bcf86cd799439011' }])); check(A, '$oid + hex string -> objectid', ty(s, 'c', 'x') === 'objectid')
s = imp(JSON.stringify([{ x: '507f1f77bcf86cd799439011' }, { x: 'hello' }])); check(A, 'hex + plain string -> string', ty(s, 'c', 'x') === 'string', ty(s, 'c', 'x'))
s = imp(JSON.stringify([{ x: '2020-01-01' }, { x: 'hello' }])); check(A, 'date-string + plain string -> string', ty(s, 'c', 'x') === 'string', ty(s, 'c', 'x'))
s = imp(JSON.stringify([{ x: 1 }, { x: 'a' }])); check(A, 'int + string -> json', ty(s, 'c', 'x') === 'json', ty(s, 'c', 'x'))
s = imp(JSON.stringify([{ x: null }, { x: null }])); check(A, 'all-null field -> string fallback', ty(s, 'c', 'x') === 'string', ty(s, 'c', 'x'))
s = imp(JSON.stringify([{ x: { $numberLong: '5' } }, { x: 3 }])); console.log('long+int ->', ty(s, 'c', 'x'))
s = imp(JSON.stringify([{ x: { $date: '2020-01-01T00:00:00Z' } }, { x: '2020-01-01' }])); check(A, '$date + date string -> date', ty(s, 'c', 'x') === 'date', ty(s, 'c', 'x'))

// 10 empties / invalid
check(A, 'empty file -> {}', JSON.stringify(L.parseMongoExport('')) === '{}')
check(A, 'whitespace only -> {}', JSON.stringify(L.parseMongoExport('  \n ')) === '{}')
let thrown = null; try { L.parseMongoExport('{not json') } catch (e) { thrown = e }
check(A, 'invalid JSON throws a readable error (not raw "Unexpected token")', thrown && !/Unexpected token|in JSON at position/.test(thrown.message), 'message: ' + thrown?.message)
thrown = null; try { L.parseMongoExport('{"a":1}\n{bad}\n') } catch (e) { thrown = e }
check(A, 'JSONL bad line: error mentions line number', thrown && /line/i.test(thrown.message), 'message: ' + thrown?.message)
s = imp('[]'); console.log('[] ->', JSON.stringify(s.tables)); check(A, 'empty array no crash', true)
s = imp('[{}]'); rt('emptydoc', s); console.log('[{}] ->', L.serialize(s))
s = imp('{}'); console.log('{} ->', JSON.stringify(s.tables))
for (const t of ['5', '"str"', 'null', '[1,2,3]', '[null,{"a":1}]', '[[1],[2]]', 'true']) { try { s = imp(t); console.log(t, '->', JSON.stringify(s.tables.map((x) => x.name))) } catch (e) { check(A, `input ${t} no crash`, false, e.message) } }
try { const o = L.parseMongoExport('﻿[{"a":1}]'); check(A, 'UTF-8 BOM prefixed JSON parses', Object.keys(o).length === 1) } catch (e) { check(A, 'UTF-8 BOM prefixed JSON parses', false, e.message) }
try { const o = L.parseMongoExport('﻿{"a":1}\n{"a":2}'); check(A, 'UTF-8 BOM JSONL parses', Object.keys(o).length === 1) } catch (e) { check(A, 'UTF-8 BOM JSONL parses', false, e.message) }
try { L.parseMongoExport('{\n "a":1\n}\n{\n "a":2\n}'); check(A, 'concatenated pretty-printed JSON docs (mongoexport --pretty)', true) } catch (e) { check(A, 'concatenated pretty-printed JSON docs (mongoexport --pretty)', false, e.message) }
// array with null elems -> crash?
try { s = L.mongoToSchema({ a: [null, 1, 'x', { q: 1 }] }); check(A, 'collection array containing primitives/null docs no crash', true) } catch (e) { check(A, 'collection array containing primitives/null docs no crash', false, e.message) }

// single doc
s = imp('{"name":"x","address":{"city":"y"}}', 'one'); show(s); rt('single', s)

// large
{
  const docs = []
  for (let i = 0; i < 50000; i++) docs.push({ _id: { $oid: i.toString(16).padStart(24, '0') }, name: 'n' + i, age: i % 90, ts: { $date: '2021-01-01T00:00:00Z' }, tags: ['a', 'b'], addr: { street: 's' + i, geo: { lat: 1.5, lng: 2.5 } }, items: [{ sku: 'x', q: 1 }, { sku: 'y', q: 2 }], ...(i % 3 ? { opt: i } : {}) })
  const txt = JSON.stringify(docs); const m0 = process.memoryUsage().heapUsed; const t0 = Date.now()
  const o = L.parseMongoExport(txt, 'big'); const t1 = Date.now()
  s = L.mongoToSchema(o); const t2 = Date.now()
  const code = L.serialize(s); const p = L.parse(code)
  console.log(`50k docs: ${(txt.length / 1e6).toFixed(1)}MB parse ${t1 - t0}ms infer ${t2 - t1}ms heap+${((process.memoryUsage().heapUsed - m0) / 1e6).toFixed(0)}MB tables=${s.tables.length}`)
  check(A, '50k docs (~' + (txt.length / 1e6).toFixed(0) + 'MB): total < 5s', t2 - t0 < 5000, `parse ${t1 - t0}ms infer ${t2 - t1}ms`)
  check(A, '50k docs: tables correct & reparse clean', s.tables.length === 4 && p.errors.length === 0, s.tables.map((t) => t.name).join())
  const jl = docs.map((d) => JSON.stringify(d)).join('\n'); const t3 = Date.now(); const o2 = L.parseMongoExport(jl, 'big')
  console.log('jsonl 50k parse', Date.now() - t3, 'ms docs', o2.big?.length)
  check(A, '50k JSONL parse', o2.big?.length === 50000, `${Date.now() - t3}ms`)
}
{
  const d = {}; for (let i = 0; i < 20000; i++) d['k' + i] = i
  let t0 = Date.now(); s = imp(JSON.stringify(d), 'huge'); console.log('20k keys doc', Date.now() - t0, 'ms fields', s.tables[0].fields.length)
  check(A, 'huge single doc (20k keys)', s.tables[0].fields.length >= 20000)
  const arr = { a: Array.from({ length: 200000 }, (_, i) => ({ i })) }
  t0 = Date.now(); s = imp(JSON.stringify(arr), 'huge2'); console.log('200k-element array of objs', Date.now() - t0, 'ms tables', s.tables.length)
  let dd = { z: 1 }; for (let i = 0; i < 3000; i++) dd = { n: dd }
  try { t0 = Date.now(); s = L.mongoToSchema({ deepc: [JSON.parse(JSON.stringify(dd))] }); console.log('3000-deep', s.tables.length, Date.now() - t0, 'ms'); check(A, '3000-deep nesting no crash', true) } catch (e) { check(A, '3000-deep nesting no crash', false, e.message) }
  // names get absurdly long?
  const longest = Math.max(...s.tables.map((t) => t.name.length)); console.log('longest table name in 3000-deep', longest)
}
s = imp(JSON.stringify([{ x: { $foo: 1 } }])); show(s); rt('dollarkey', s)
s = imp(JSON.stringify([{ x: { $oid: 'zzz' } }])); console.log('bad $oid ->', ty(s, 'c', 'x'))
L.summary()
fs.writeFileSync('res_A.json', JSON.stringify(L.results))
