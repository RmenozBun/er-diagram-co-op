import fs from 'fs'
import * as L from './lib.mjs'
import { check } from './lib.mjs'
import { loadMongoose, validate, mongoose } from './harness.mjs'
const C = 'C mongoose'
const OID = () => new mongoose.Types.ObjectId()
const ok = (e) => e.length === 0

// ---------- 1. big realistic schema: embedded + ref + N:M + self + deep
const DSL1 = `
Table user {
  _id objectid [pk]
  email string [unique, not null]
  name string [not null, default: 'anon']
  age int [default: 18]
  score double [default: 1.5]
  active bool [default: true]
  created_at date [default: \`now()\`]
  address Address
  tags string[]
  parent_id objectid
  manager_id objectid
  bio text [note: 'enum: a,b,c']
  avatar buffer
  meta json
  raw object
  amount decimal
  big long
  indexes {
    (name, age) [unique]
    email
  }
}
Table Address [embedded] {
  street string [not null]
  geo Geo
  lines Line[]
}
Table Geo [embedded] {
  lat double [not null]
  lng double
  deep Deep
}
Table Deep [embedded] {
  a Deeper
}
Table Deeper [embedded] {
  b Deepest
}
Table Deepest [embedded] {
  c string [not null]
}
Table Line [embedded] {
  sku string
  qty int [not null]
}
Table order {
  _id objectid [pk]
  user_id objectid [not null]
  items OrderItem[]
  order_item OrderItem
  status string [default: 'new']
}
Table OrderItem [embedded] {
  sku string [not null]
  price double
}
Table order_item {
  id objectid [pk]
  order_id objectid
}
Table tags {
  _id objectid [pk]
  label string
}
Table category {
  _id objectid [pk]
  parent_id objectid
  children category[]
}
Ref: user.parent_id > user._id
Ref: user.manager_id > user._id
Ref: order.user_id > user._id
Ref: order_item.order_id > order._id
Ref: category.parent_id > category._id
Ref: user._id <> tags._id
`
{
  const r = loadMongoose(DSL1, 'big')
  console.log(r.code)
  check(C, 'big schema: parse has no errors', L.parse(DSL1).errors.length === 0, JSON.stringify(L.parse(DSL1).errors))
  check(C, 'big schema: compiles with real mongoose', !r.error, r.error?.message)
  if (!r.error) {
    const { user: _u, User, Order, OrderItem, Category, Tags } = r.models
    check(C, 'models exported: User, Order, OrderItem(non-embedded order_item), Category, Tags', !!(User && Order && Category && Tags), Object.keys(r.models).join())
    // name collision: order.items type OrderItem (embedded) vs table order_item (root) -> both Pascal 'OrderItem'
    check(C, 'collision: `order_item` root table vs `OrderItem` embedded table -> exports ok', !!r.models.OrderItem, Object.keys(r.models).join())
    const good = { email: 'a@b.c', name: 'x', address: { street: 's', geo: { lat: 1, lng: 2, deep: { a: { b: { c: 'z' } } } }, lines: [{ sku: 'a', qty: 1 }] }, tags: ['a'], parent_id: OID(), manager_id: OID(), tags_ids: [OID()] }
    check(C, 'valid user doc validates', ok(validate(User, good)), JSON.stringify(validate(User, good)))
    check(C, 'missing required email rejected', validate(User, { ...good, email: undefined }).includes('email'))
    check(C, 'garbage ObjectId ref rejected (parent_id)', validate(User, { ...good, parent_id: 'garbage' }).includes('parent_id'))
    check(C, 'valid ObjectId string accepted', ok(validate(User, { ...good, parent_id: String(OID()) })))
    check(C, 'garbage in ref array tags_ids rejected', validate(User, { ...good, tags_ids: ['nope'] }).length > 0)
    check(C, 'embedded required: address.street missing rejected', validate(User, { ...good, address: { geo: { lat: 1 } } }).includes('address.street'))
    check(C, 'deep embedded required: c missing rejected', validate(User, { ...good, address: { street: 's', geo: { lat: 1, deep: { a: { b: {} } } } } }).some((p) => p.endsWith('b.c')), JSON.stringify(validate(User, { ...good, address: { street: 's', geo: { lat: 1, deep: { a: { b: {} } } } } })))
    check(C, 'embedded array required qty missing rejected', validate(User, { ...good, address: { street: 's', lines: [{ sku: 'a' }] } }).some((p) => /qty/.test(p)))
    check(C, 'Number field rejects "abc"', validate(User, { ...good, age: 'abc' }).includes('age'))
    check(C, 'Boolean field rejects "maybe"', validate(User, { ...good, active: 'maybe' }).includes('active'))
    check(C, 'Date field rejects "notadate"', validate(User, { ...good, created_at: 'notadate' }).includes('created_at'))
    const d = new User(good)
    check(C, 'default number (age 18)', d.age === 18, 'age=' + d.age)
    check(C, 'default double (score 1.5)', d.score === 1.5)
    check(C, 'default bool true', d.active === true)
    check(C, "default string 'anon'", d.name === 'anon')
    check(C, 'default now() -> Date', d.created_at instanceof Date)
    check(C, 'default for unique-index/other not set where absent', d.bio === undefined)
    const sch = User.schema
    check(C, 'unique:true on email', sch.path('email').options.unique === true)
    const idx = sch.indexes().map((i) => JSON.stringify(i[0]) + JSON.stringify({ u: i[1].unique ?? false }))
    console.log('user indexes', idx)
    check(C, 'compound unique index (name, age)', sch.indexes().some((i) => i[0].name === 1 && i[0].age === 1 && i[1].unique === true))
    check(C, 'single-field index email', sch.indexes().some((i) => Object.keys(i[0]).join() === 'email'))
    check(C, 'collection name = table name ("user")', User.collection.name === 'user', User.collection.name)
    check(C, 'parent_id has ref User', sch.path('parent_id').options.ref === 'User')
    check(C, 'tags_ids is array of ObjectId ref Tags', sch.path('tags_ids') && sch.path('tags_ids').caster?.options?.ref === 'Tags' || sch.path('tags_ids')?.options?.type?.[0]?.ref === 'Tags', 'ref=' + JSON.stringify(sch.path('tags_ids')?.options))
    check(C, 'buffer/meta/raw paths types', sch.path('avatar').instance === 'Buffer' && sch.path('meta').instance === 'Mixed' && sch.path('raw').instance === 'Mixed')
    check(C, 'decimal -> Number (Decimal128 lost)', sch.path('amount').instance === 'Decimal128', 'instance=' + sch.path('amount').instance)
    check(C, 'long -> Number path', sch.path('big').instance === 'Number' || sch.path('big').instance === 'BigInt' || sch.path('big').instance === 'Long', 'instance=' + sch.path('big').instance)
    const Cat = r.models.Category
    check(C, 'self reference + recursive embedded array compile', !!Cat && Cat.schema.path('parent_id').options.ref === 'Category')
    console.log('category.children ->', Cat?.schema.path('children')?.instance, Cat?.schema.path('children')?.caster?.instance)
    // ref to embedded-only target
  }
}

// ---------- 2. model-name / identifier hazards (each in isolation)
const hazards = {
  'table `user` + `User` (case twins)': 'Table user {\n  _id objectid [pk]\n}\nTable User {\n  _id objectid [pk]\n}',
  'table `order_item` + `orderItem`': 'Table order_item {\n  a int\n}\nTable orderItem {\n  a int\n}',
  'name starts with digit "2024data"': 'Table "2024data" {\n  a int\n}',
  'Thai table name': 'Table ผู้ใช้ {\n  ชื่อ string [not null]\n  อายุ int\n}',
  'Thai quoted table with space': 'Table "ผู้ใช้ งาน" {\n  ชื่อ string\n}',
  'table `__proto__`': 'Table __proto__ {\n  a int\n}',
  'table `constructor`': 'Table constructor {\n  a int\n}',
  'table `schema`': 'Table schema {\n  a int\n}',
  'table `Schema`': 'Table Schema {\n  a int\n}',
  'table `mongoose`': 'Table mongoose {\n  a int\n}',
  'table `date`': 'Table date {\n  a date [default: `now()`]\n}',
  'table `string`': 'Table string {\n  a string\n}',
  'table `number`': 'Table number {\n  a int\n}',
  'table `boolean`': 'Table boolean {\n  a bool\n}',
  'table `buffer`': 'Table buffer {\n  a buffer\n}',
  'table `object`': 'Table object {\n  a int\n}',
  'table `array`': 'Table array {\n  a int\n}',
  'table `module`': 'Table module {\n  a int\n}',
  'table `exports`': 'Table exports {\n  a int\n}',
  'table `require`': 'Table require {\n  a int\n}',
  'table `class`/`function` (JS keywords)': 'Table class {\n  a int\n}\nTable function {\n  a int\n}',
  'table `a-b` / `a b`': 'Table "a-b" {\n  a int\n}\nTable "a b" {\n  a int\n}',
  'table `a_b` vs `a-b` vs `a b`': 'Table a_b {\n  a int\n}\nTable "a-b" {\n  a int\n}\nTable "a b" {\n  a int\n}',
  'table with $ in name': 'Table "a$b" {\n  a int\n}\nTable $x {\n  a int\n}',
  'table with quote chars `it\'s`': 'Table "it\'s" {\n  a int\n}',
  'table name with backslash': 'Table `a\\b` {\n  a int\n}',
  'table name with double-quote (backtick quoted)': 'Table `a"b` {\n  a int\n}',
  'table with emoji': 'Table "📦box" {\n  a int\n}',
  'table name only digits "123"': 'Table "123" {\n  a int\n}',
  'table "order" and "Order" and "ORDER"': 'Table order {\n  a int\n}\nTable Order {\n  a int\n}\nTable ORDER {\n  a int\n}',
  'zero tables': '',
  'table with no fields': 'Table empty {\n}',
  'only embedded tables': 'Table E [embedded] {\n  a int\n}',
  'field named _id non-objectid (string)': 'Table t {\n  _id string [pk]\n  a int\n}',
  'field named _id int pk': 'Table t {\n  _id int [pk]\n}',
  'pk `id` int (SQL style)': 'Table t {\n  id int [pk, increment]\n  a int\n}',
  'pk `id` objectid -> _id': 'Table t {\n  id objectid [pk]\n  a int\n}',
  'pk `id` objectid + also `_id` field': 'Table t {\n  id objectid [pk]\n  _id objectid\n}',
  'field named `type`': 'Table t {\n  type string [not null]\n  name string\n}',
  'embedded with field `type`': 'Table t {\n  addr Addr\n}\nTable Addr [embedded] {\n  type string\n  city string\n}',
  'field named `__proto__`': 'Table t {\n  __proto__ string\n  a int\n}',
  'field named `constructor`/`toString`': 'Table t {\n  constructor string\n  toString string\n}',
  'field names with dots "a.b"': 'Table t {\n  "a.b" string\n  a int\n}',
  'field names with $': 'Table t {\n  "$x" string\n}',
  'field names reserved by mongoose (errors, schema, isNew, collection, db, save, validate, set, get, init)': 'Table t {\n  errors string\n  schema string\n  isNew string\n  collection string\n  db string\n  save string\n  validate string\n  set string\n  get string\n  init string\n  on string\n}',
  'field names reserved single: `errors`': 'Table t {\n  errors string\n}',
  'field names reserved single: `schema`': 'Table t {\n  schema string\n}',
  'field names reserved single: `collection`': 'Table t {\n  collection string\n}',
  'field names reserved single: `db`': 'Table t {\n  db string\n}',
  'field names reserved single: `save`': 'Table t {\n  save string\n}',
  'field names reserved single: `isNew`': 'Table t {\n  isNew string\n}',
  'field names reserved single: `get`': 'Table t {\n  get string\n}',
  'field named `id` (virtual conflict)': 'Table t {\n  id string\n}',
  'field Thai / spaces / digits': 'Table t {\n  "first name" string\n  ชื่อ string\n  "1x" int\n}',
  'default with quotes/newline': "Table t {\n  a string [default: 'it\\'s']\n  b string [default: \"say \\\"hi\\\"\"]\n}",
  'default `now()` on string and date': 'Table t {\n  a date [default: `now()`]\n  b string [default: `now()`]\n  c timestamp [default: `CURRENT_TIMESTAMP`]\n}',
  'default numeric on string field': 'Table t {\n  a string [default: 0]\n  b int [default: -5]\n  c double [default: 1.5]\n  d bool [default: false]\n  e string [default: null]\n  f string [default: \'\']\n}',
  'default string looking like a number "007"': "Table t {\n  a string [default: '007']\n}",
  'default expression `uuid()`': 'Table t {\n  a string [default: `uuid()`]\n}',
  'default on array / embedded': 'Table t {\n  a string[] [default: 0]\n  b E [default: 1]\n}\nTable E [embedded] {\n  x int\n}',
  'ref to embedded-only table': 'Table E [embedded] {\n  _id objectid [pk]\n  x int\n}\nTable t {\n  _id objectid [pk]\n  e_id objectid\n}\nRef: t.e_id > E._id',
  'N:M with both root tables': 'Table a {\n  _id objectid [pk]\n}\nTable b {\n  _id objectid [pk]\n}\nRef: a._id <> b._id',
  'N:M where from-table has field named b_ids': 'Table a {\n  _id objectid [pk]\n  b_ids string[]\n}\nTable b {\n  _id objectid [pk]\n}\nRef: a._id <> b._id',
  'N:M twice to same table': 'Table a {\n  _id objectid [pk]\n}\nTable b {\n  _id objectid [pk]\n  x int\n}\nRef: a._id <> b._id\nRef: a._id <> b.x',
  'one-to-one ref': 'Table a {\n  _id objectid [pk]\n  b_id objectid\n}\nTable b {\n  _id objectid [pk]\n}\nRef: a.b_id - b._id',
  'one-to-many `<` ref': 'Table a {\n  _id objectid [pk]\n}\nTable b {\n  _id objectid [pk]\n  a_id objectid\n}\nRef: a._id < b.a_id',
  'ref to non-objectid field (string key)': 'Table a {\n  code string [pk]\n}\nTable b {\n  _id objectid [pk]\n  a_code string\n}\nRef: b.a_code > a.code',
  'ref inside embedded table': 'Table a {\n  _id objectid [pk]\n  e E\n}\nTable E [embedded] {\n  user_id objectid\n}\nTable u {\n  _id objectid [pk]\n}\nRef: E.user_id > u._id',
  'array of refs via inline ref': 'Table u {\n  _id objectid [pk]\n}\nTable a {\n  _id objectid [pk]\n  friends objectid[] [ref: > u._id]\n}',
  'unique + not null + default combos': 'Table t {\n  a string [unique, not null, default: \'x\']\n  b int [unique]\n  c string[] [unique]\n}',
  'index on missing field': 'Table t {\n  a int\n  indexes {\n    zzz [unique]\n    (a, yyy)\n  }\n}',
  'index names (name: "foo")': 'Table t {\n  a int\n  b int\n  indexes {\n    (a, b) [name: \'my_idx\', unique]\n  }\n}',
  'index with Thai/quoted fields': 'Table t {\n  "first name" string\n  ชื่อ string\n  indexes {\n    (ชื่อ, "first name") [unique]\n  }\n}',
  'embedded self-recursion': 'Table t {\n  _id objectid [pk]\n  n Node\n}\nTable Node [embedded] {\n  v int\n  next Node\n  kids Node[]\n}',
  'embedded mutual recursion A<->B': 'Table t {\n  _id objectid [pk]\n  a A\n}\nTable A [embedded] {\n  b B\n}\nTable B [embedded] {\n  a A\n  v int [not null]\n}',
  'embedded type case-insensitive match ("address" vs Address)': 'Table t {\n  a address\n  b ADDRESS[]\n}\nTable Address [embedded] {\n  s string [not null]\n}',
  'type names unknown': 'Table t {\n  a foo\n  b varchar(20)\n  c Foo[]\n  d jsonb\n  e enum\n  f money\n}',
  'embedded table that has pk (becomes root too?)': 'Table t {\n  e E\n}\nTable E {\n  _id objectid [pk]\n  x int\n}',
  'table referencing itself embedded not-array': 'Table t {\n  _id objectid [pk]\n  me t\n}',
  'duplicate field names': 'Table t {\n  a int\n  a string\n}',
  'duplicate table names': 'Table t {\n  a int\n}\nTable t {\n  b int\n}',
  'huge table (500 fields)': 'Table t {\n' + Array.from({ length: 500 }, (_, i) => `  f${i} ${['int', 'string', 'date', 'bool'][i % 4]}`).join('\n') + '\n}',
  'timestamps-ish: created_at/updated_at': 'Table t {\n  created_at date [default: `now()`]\n  updated_at date\n}',
  'notes with quotes': "Table t [note: 'it\\'s a \"note\"'] {\n  a int [note: 'x\\'y']\n}",
}
const hz = {}
for (const [name, dsl] of Object.entries(hazards)) {
  const schema = L.parse(dsl)
  const perr = schema.errors.map((e) => e.message)
  let r
  try { r = loadMongoose(schema, 'hz') } catch (e) { r = { error: e, code: '(generator threw)' } }
  hz[name] = { perr, error: r.error?.message?.split('\n')[0], code: r.code }
  const good = !r.error
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}${perr.length ? '  [dsl errors: ' + perr.join('; ') + ']' : ''}${r.error ? '\n      -> ' + r.error.message.split('\n')[0].slice(0, 200) : ''}`)
  // pass criteria: compile; for DSL w/ parse errors (dup names) we don't count
  if (!perr.length) check(C, `hazard compiles: ${name}`, good, r.error?.message?.split('\n')[0].slice(0, 200))
  else check(C, `hazard (invalid DSL, informational): ${name}`, good, r.error?.message?.split('\n')[0].slice(0, 200))
}
fs.writeFileSync('res_C1_hazards.json', JSON.stringify(hz, null, 1))

// ---------- 3. targeted behavioural checks of hazards
{
  let r = loadMongoose('Table t {\n  _id objectid [pk]\n  type string [not null]\n  name string\n}', 'type')
  if (!r.error) check(C, 'top-level field named `type` required works', validate(r.models.T, { name: 'x' }).includes('type'), JSON.stringify(validate(r.models.T, { name: 'x' })))
  r = loadMongoose('Table t {\n  _id objectid [pk]\n  addr Addr\n}\nTable Addr [embedded] {\n  type string [not null]\n  city string\n}', 'type2')
  if (!r.error) {
    const T = r.models.T
    console.log('embedded `type` paths:', Object.keys(T.schema.paths))
    check(C, 'embedded sub-doc with a field named `type` keeps both fields (addr.city path exists)', !!T.schema.path('addr.city') || !!T.schema.path('addr')?.schema?.path('city'), 'paths=' + Object.keys(T.schema.paths).join())
  }
  r = loadMongoose('Table t {\n  __proto__ string\n  a int\n}', 'proto')
  if (!r.error) { const T = r.models.T; console.log('__proto__ field paths', Object.keys(T.schema.paths)); check(C, 'field `__proto__` is a real schema path', !!T.schema.path('__proto__'), 'paths=' + Object.keys(T.schema.paths)) }
  r = loadMongoose('Table t {\n  "a.b" string\n  a int\n}', 'dot')
  if (!r.error) console.log('dot paths', Object.keys(r.models.T.schema.paths), 'a.b is nested path -> conflicts with field a')
  r = loadMongoose('Table user {\n  _id objectid [pk]\n}\nTable User {\n  _id objectid [pk]\n}', 'twin')
  console.log('twin tables models', r.error ? 'ERR ' + r.error.message.split('\n')[0] : Object.keys(r.models))
  r = loadMongoose('Table t {\n  _id objectid [pk]\n  a date [default: `now()`]\n}', 'now')
  if (!r.error) { const t = new r.models.T({}); check(C, 'default now() produced Date near now', t.a instanceof Date && Math.abs(Date.now() - t.a) < 5000) }
  r = loadMongoose("Table t {\n  a string [default: 'it\\'s']\n  b string [default: \"say \\\"hi\\\"\"]\n}", 'quotes')
  if (!r.error) { const t = new r.models.T({}); console.log('defaults', JSON.stringify(t.toObject())); check(C, "default 'it\\'s' roundtrips as it's", t.a === "it's", JSON.stringify(t.a)) }
  r = loadMongoose('Table t [note: \'x\'] {\n  a string [default: \'C:\\\\temp\']\n}', 'bs')
  if (!r.error) console.log('backslash default', JSON.stringify(new r.models.T({}).a), 'dsl default parsed', JSON.stringify(L.parse('Table t {\n  a string [default: \'C:\\\\temp\']\n}').tables[0].fields[0].default))
  // N:M naming
  r = loadMongoose('Table a {\n  _id objectid [pk]\n}\nTable "b c" {\n  _id objectid [pk]\n}\nRef: a._id <> "b c"._id', 'nmq')
  console.log('N:M to table with space: parse errs', JSON.stringify(L.parse('Table a {\n  _id objectid [pk]\n}\nTable "b c" {\n  _id objectid [pk]\n}\nRef: a._id <> "b c"._id').errors), r.error ? r.error.message : 'compiled')
  // ref to embedded-only
  r = loadMongoose(hazards['ref to embedded-only table'], 'refemb')
  if (!r.error) console.log('ref->embedded-only: model names', mongoose.modelNames(), 'ref=', r.models.T.schema.path('e_id').options.ref)
  // unique + missing field duplicates (needs DB) in tC2
  // embedded self-recursion value acceptance
  r = loadMongoose(hazards['embedded self-recursion'], 'rec')
  if (!r.error) check(C, 'recursive embedded: nested doc accepted (Mixed)', ok(validate(r.models.T, { n: { v: 1, next: { v: 2 }, kids: [{ v: 3 }] } })), JSON.stringify(validate(r.models.T, { n: { v: 1, next: { v: 2 }, kids: [{ v: 3 }] } })))
  r = loadMongoose(hazards['embedded type case-insensitive match ("address" vs Address)'], 'ci')
  if (!r.error) check(C, 'embedded type matching is case-insensitive (address -> Address) validates required s', validate(r.models.T, { a: {} }).includes('a.s'), JSON.stringify(validate(r.models.T, { a: {} })))
  r = loadMongoose(hazards['embedded table that has pk (becomes root too?)'], 'embpk')
  if (!r.error) console.log('embedded-with-pk exports:', Object.keys(r.models))
  r = loadMongoose(hazards['pk `id` objectid + also `_id` field'], 'idid')
  if (!r.error) console.log('id+_id paths', Object.keys(r.models.T.schema.paths))
  r = loadMongoose(hazards['pk `id` int (SQL style)'], 'idint')
  if (!r.error) console.log('pk id int paths', Object.keys(r.models.T.schema.paths), '(pk not unique, no required)', JSON.stringify(r.models.T.schema.path('id').options))
  r = loadMongoose(hazards['field named _id non-objectid (string)'], 'idstr')
  if (!r.error) { console.log('_id string path', r.models.T.schema.path('_id').instance); check(C, '_id string pk stays String', r.models.T.schema.path('_id').instance === 'String') }
  r = loadMongoose('Table t {\n  a string\n  b int\n  indexes {\n    (a, b) [name: \'my_idx\', unique]\n  }\n}', 'ixn')
  if (!r.error) console.log('named index ->', JSON.stringify(r.models.T.schema.indexes()), '(name ignored in mongoose output)')
}
L.summary()
fs.writeFileSync('res_C1.json', JSON.stringify(L.results))
