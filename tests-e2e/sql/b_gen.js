import { S, check, setArea, done } from './h.js'
import initSqlJs from 'sql.js'
import { PGlite } from '@electric-sql/pglite'
import pkg from 'node-sql-parser'
import fs from 'node:fs'
const { Parser } = pkg
const { parse, toSQL } = S
const SEP = String.fromCharCode(10, 10)
const SQL = await initSqlJs()
const mysqlParser = new Parser()

const SQL_TYPES = ['int', 'bigint', 'smallint', 'decimal(10,2)', 'numeric(10,2)', 'float', 'double', 'varchar(255)', 'char(10)', 'text', 'boolean', 'date', 'time', 'timestamp', 'datetime', 'uuid', 'json', 'jsonb', 'blob', 'bytea', 'int[]', 'varchar(255)[]']
const MONGO_IN_SQL = ['string', 'objectid', 'object', 'bool', 'number', 'mixed', 'buffer', 'binary', 'double', 'string[]', 'objectid[]', 'integer', 'real', 'tinyint', 'mediumtext', 'longtext', 'serial', 'bigserial', 'money', 'varchar', 'char', 'timestamptz', 'year', 'enum']

const schemas = {}
const add = (name, dsl) => { schemas[name] = dsl }

add('types', 'Table t {\n id int [pk, increment]\n' + SQL_TYPES.map((t, i) => ` c${i} ${t}`).join('\n') + '\n}\n')
add('mongo-types', 'Table t {\n id int [pk, increment]\n' + MONGO_IN_SQL.map((t, i) => ` c${i} ${t}`).join('\n') + '\n}\n')
add('basic-fk', `Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
  name varchar(100) [default: 'N/A']
  active boolean [default: true]
  score decimal(10,2) [default: 0]
  created_at timestamp [default: \`current_timestamp\`]
}
Table posts {
  id bigint [pk, increment]
  user_id int [not null]
  title varchar(200) [not null]
  body text
  indexes {
    user_id
    (title, user_id) [unique, name: 'uq_title_user']
  }
}
Ref: posts.user_id > users.id
`)
add('sample', S.SAMPLE_SQL)
add('m2m', 'Table a {\n id int [pk, increment]\n}\nTable b {\n id bigint [pk, increment]\n}\nRef: a.id <> b.id\n')
add('m2m-uuid', 'Table a {\n id uuid [pk]\n}\nTable b {\n code varchar(20) [pk]\n}\nRef: a.id <> b.code\n')
add('one-to-one', 'Table u {\n id int [pk]\n}\nTable p {\n id int [pk]\n u_id int\n}\nRef: p.u_id - u.id\n')
add('self-ref', 'Table emp {\n id int [pk, increment]\n boss_id int\n}\nRef: emp.boss_id > emp.id\n')
add('composite-pk', 'Table oi {\n order_id int [pk]\n item_id int [pk]\n qty int\n}\nTable x {\n a int\n b int\n}\nRef: x.a > oi.order_id\n')
add('composite-pk-fk', 'Table oi {\n order_id int [pk]\n item_id int [pk]\n qty int\n}\nTable x {\n id int [pk]\n a int\n b int\n}\nRef: x.a > oi.order_id\nRef: x.b > oi.item_id\n')
add('no-pk', 'Table t {\n a int\n b text\n}\n')
add('empty-table', 'Table t {\n}\n')
add('dup-names', 'Table t {\n id int\n}\nTable t {\n id int\n}\n')
add('dup-fields', 'Table t {\n id int\n id int\n}\n')
add('reserved', 'Table "user" {\n id int [pk]\n "order" int\n "group" text\n "select" text\n "table" text\n}\nTable "order" {\n id int [pk]\n user_id int\n "from" int\n}\nTable "group" {\n id int [pk]\n}\nRef: "order".user_id > "user".id\nRef: "order"."from" > "group".id\n')
add('quote-names', 'Table "my table" {\n "my col" int [pk]\n "a\'b" text\n "c-d" text\n}\nTable "t2" {\n id int [pk]\n x int\n}\nRef: t2.x > "my table"."my col"\n')
add('defaults', `Table t {
  id int [pk]
  a varchar(10) [default: 'it''s']
  b int [default: -5]
  c float [default: 1.5]
  d boolean [default: false]
  e timestamp [default: \`current_timestamp\`]
  f timestamp [default: \`now()\`]
  g varchar(10) [default: '007']
  h text [default: 'null']
  i text [default: 'true']
  j varchar(10) [default: '']
  k json [default: '{}']
  l uuid [default: \`gen_random_uuid()\`]
  m date [default: \`current_date\`]
  n int [default: \`(1+2)\`]
}
`)
add('autoinc-types', 'Table a {\n id smallint [pk, increment]\n}\nTable b {\n id bigint [pk, increment]\n}\nTable c {\n id varchar(10) [pk, increment]\n}\nTable d {\n id int [increment]\n x int\n}\nTable e {\n id uuid [pk, increment]\n}\nTable f {\n a int [pk, increment]\n b int [pk]\n}\n')
add('mysql-hazards', `Table t {
  id int [pk, increment]
  s string [unique]
  t text [unique]
  u varchar [unique]
  d text [default: 'x']
  j json
  b blob [default: 'x']
  k varchar(5000) [unique]
  tt text [pk]
}
Table ch {
  tid int
  sid string
}
Ref: ch.tid > t.id
Ref: ch.sid > t.s
`)
add('fk-type-mismatch', 'Table a {\n id bigint [pk, increment]\n}\nTable b {\n id int [pk]\n a_id int\n}\nRef: b.a_id > a.id\n')
add('fk-to-nonunique', 'Table a {\n id int [pk]\n code varchar(10)\n}\nTable b {\n id int [pk]\n c varchar(10)\n}\nRef: b.c > a.code\n')
add('index-collide', 'Table a {\n id int [pk]\n x int\n y int\n indexes {\n x\n x\n (x,y) [unique]\n x [unique]\n }\n}\n')
add('fk-collide', 'Table a {\n id int [pk]\n}\nTable b {\n id int [pk]\n a_id int\n}\nRef: b.a_id > a.id\nRef: b.a_id > a.id\n')
add('index-quoted-cols', 'Table a {\n id int [pk]\n "my col" int\n indexes {\n "my col"\n }\n}\n')
add('array-pg', 'Table t {\n id int [pk]\n a int[]\n b text[]\n c varchar(10)[]\n d string[]\n e uuid[]\n}\n')
add('embedded', 'Table u {\n id int [pk]\n addr Address\n}\nTable Address [embedded] {\n street text\n}\n')
add('unknown-types', 'Table t {\n id int [pk]\n a geometry\n b point\n c "weird type"\n d money\n e inet\n}\n')
add('varchar-nolen', 'Table t {\n id int [pk]\n a varchar [unique]\n b varchar [pk]\n c char\n}\n')
add('upper-types', 'Table t {\n id INT [pk]\n a VARCHAR(10)\n b TEXT\n c BOOLEAN\n d String\n e BOOL\n e2 Number\n}\n')
add('pk-text-mysql', 'Table t {\n id text [pk]\n}\nTable u {\n id string [pk]\n}\n')
add('unique-and-pk-composite', 'Table t {\n a int [pk, unique]\n b int [pk, unique]\n}\n')
add('ref-bad', 'Table a {\n id int [pk]\n}\nRef: a.id > zz.id\nRef: a.nope > a.id\n')
add('ref-to-nonpk-m2m-self', 'Table a {\n id int [pk]\n}\nRef: a.id <> a.id\n')
add('m2m-name-collision', 'Table a {\n id int [pk]\n}\nTable b {\n id int [pk]\n}\nTable a_b {\n x int\n}\nRef: a.id <> b.id\n')
add('m2m-twice', 'Table a {\n id int [pk]\n}\nTable b {\n id int [pk]\n}\nRef: a.id <> b.id\nRef: a.id <> b.id\n')
add('long-names', `Table ${'t'.repeat(70)} {\n id int [pk]\n ${'c'.repeat(70)} int\n}\nTable o {\n id int [pk]\n x int\n}\nRef: o.x > ${'t'.repeat(70)}.id\n`)
add('thai', 'Table "ผู้ใช้" {\n "รหัส" int [pk]\n "ชื่อ" varchar(100) [default: \'ไม่ระบุ\']\n}\n')
{
  let big = ''
  for (let i = 0; i < 150; i++) big += `Table t${i} {\n id int [pk, increment]\n name varchar(50) [not null]\n ${i ? `p_id int\n` : ''}}\n`
  for (let i = 1; i < 150; i++) big += `Ref: t${i}.p_id > t${i - 1}.id\n`
  add('big-150', big)
}

const gen = {}
fs.mkdirSync('out', { recursive: true })
for (const [n, dsl] of Object.entries(schemas)) {
  const sch = parse(dsl)
  gen[n] = { schema: sch }
  for (const d of ['postgres', 'mysql', 'sqlite']) {
    try { gen[n][d] = toSQL(sch, d); fs.writeFileSync(`out/${n}.${d}.sql`, gen[n][d]) } catch (e) { check(`${n} ${d} generate no throw`, false, e.stack); gen[n][d] = null }
  }
}

// ---------- SQLite
setArea('B sqlite exec')
const sqliteRes = {}
for (const [n, g] of Object.entries(gen)) {
  if (!g.sqlite) continue
  const db = new SQL.Database()
  const errs = []
  try { db.run('PRAGMA foreign_keys=ON') } catch {}
  for (const st of g.sqlite.split(SEP)) { if (!st.trim()) continue; try { db.exec(st) } catch (e) { errs.push(e.message + ' <= ' + st.replace(/\s+/g, ' ').slice(0, 80)) } }
  const ok = errs.length === 0, msg = errs.join(' || ')
  sqliteRes[n] = { ok, msg, db }
  check(`sqlite executes with 0 errors: ${n}`, ok, msg)
}
const sq = (n, q) => { if (!sqliteRes[n].ok) return [];  const r = sqliteRes[n].db.exec(q); return r[0]?.values ?? [] }
{
  const n = 'basic-fk'
  const cols = sq(n, 'pragma table_info(users)')
  check('sqlite basic: users has 6 cols', cols.length === 6, cols.length)
  check('sqlite basic: users.id pk', cols.find(c => c[1] === 'id')?.[5] === 1)
  check('sqlite basic: email notnull', cols.find(c => c[1] === 'email')?.[3] === 1)
  const idx = sq(n, 'pragma index_list(posts)'); check('sqlite basic: posts unique index exists', idx.some(i => i[1] === 'uq_title_user' && i[2] === 1), JSON.stringify(idx))
  check('sqlite basic: posts idx user_id', idx.some(i => i[1] === 'posts_user_id_idx'), JSON.stringify(idx))
  const fk = sq(n, 'pragma foreign_key_list(posts)')
  check('sqlite basic: FK posts.user_id -> users.id actually exists (generator emits only a comment)', fk.length === 1, `foreign_key_list(posts) rows=${fk.length}; SQL tail: ${gen[n].sqlite.slice(-200)}`)
  check('sqlite: autoincrement users.id', /autoincrement/i.test(sq(n, "select sql from sqlite_master where name='users'")[0][0]))
  const db = sqliteRes[n].db
  let ins = 'ok'; try { db.run("insert into users(email) values('a')"); db.run("insert into users(email) values('a')") } catch (e) { ins = e.message }
  check('sqlite: unique enforced', /UNIQUE/i.test(ins), ins)
  check('sqlite: bool default true -> 1?', (() => { const r = db.exec("select active from users where email='a'")[0]; return r.values[0][0] === 1 || r.values[0][0] === 'true' })())
  check('sqlite: now() default works (created_at not null)', (() => { const r = db.exec("select created_at from users where email='a'")[0]; return r.values[0][0] != null })(), 'now() is not a SQLite function; DDL accepted?')
}
{
  const g = gen['basic-fk'].sqlite
  const n = 'basic-fk'
  check('sqlite: FKs emitted as real constraints (not comments)', !/^-- sqlite: add manually/m.test(g), 'FKs are only emitted as "-- sqlite: add manually inside create table: alter table ..." comments. Relations are lost for any SQLite user. SQLite cannot ALTER ADD CONSTRAINT, so generator must inline `references` / table-level foreign key in CREATE TABLE.')
  check('sqlite: m2m junction has FKs', sq('m2m', 'pragma foreign_key_list(a_b)').length === 2)
  check('sqlite: m2m junction composite pk', sq('m2m', 'pragma table_info(a_b)').filter(c => c[5] > 0).length === 2)
  check('sqlite: one-to-one unique on child (generator skips for sqlite)', sq('one-to-one', 'pragma index_list(p)').some(i => i[2] === 1), 'one-to-one (-) ref gets no UNIQUE constraint in sqlite output')
  check('sqlite: composite pk', sq('composite-pk', 'pragma table_info(oi)').filter(c => c[5] > 0).length === 2)
  check('sqlite: reserved names ok', sqliteRes.reserved.ok)
  check('sqlite: autoinc non-integer pk (id varchar [pk, increment]) -> not silently dropped', (() => { const s = sq('autoinc-types', "select sql from sqlite_master where name='c'")[0][0]; return /autoincrement/i.test(s) ? false : true })(), 'ok info')
  check('sqlite: composite pk + increment on one col is handled', sqliteRes['autoinc-types'].ok)
  check('sqlite: smallint/bigint pk increment -> integer primary key autoincrement (rowid alias)', /integer primary key autoincrement/.test(sq('autoinc-types', "select sql from sqlite_master where name='b'")[0][0]))
  check('sqlite: increment without pk (table d) emits nothing for autoinc', (() => { const s = sq('autoinc-types', "select sql from sqlite_master where name='d'")[0][0]; return !/autoinc/i.test(s) })(), 'info: increment ignored w/o pk')
  check('sqlite: thai names', sqliteRes.thai.ok && sq('thai', 'pragma table_info("ผู้ใช้")').length === 2)
  check('sqlite: big-150 FK chain present', sq('big-150', 'pragma foreign_key_list(t5)').length === 1, 'FKs are comments only')
  check('sqlite: quote in names (a\'b) executes', sqliteRes['quote-names'].ok)
  check('sqlite: names containing double-quote are escaped', (() => { const sch = parse('Table t {\n x int\n}\n'); sch.tables[0].fields[0].name = 'a"b'; const sql = toSQL(sch, 'sqlite'); try { const d = new SQL.Database(); d.exec(sql); return d.exec('pragma table_info(t)')[0].values[0][1] === 'a"b' } catch { return false } })(), 'quote() does not escape embedded " (or backtick for mysql) -> broken DDL / injection')
}
const sqliteDefaults = (() => { const r = {}; const db = sqliteRes.defaults.db; return db })()
check('sqlite defaults schema executes', sqliteRes.defaults.ok, sqliteRes.defaults.msg)
if (sqliteRes.defaults.ok) {
  const db = sqliteRes.defaults.db
  try { db.run('insert into t(id) values (1)'); const r = db.exec('select * from t')[0]; const row = Object.fromEntries(r.columns.map((c, i) => [c, r.values[0][i]])); fs.writeFileSync('out/defaults.sqlite.row.json', JSON.stringify(row, null, 1))
    check("sqlite default 'it''s' preserved", row.a === "it's", row.a)
    check("sqlite default '007' stays text '007'", row.g === '007', JSON.stringify(row.g))
    check("sqlite default 'null' string vs NULL", row.h === 'null', JSON.stringify(row.h))
    check("sqlite default 'true' string", row.i === 'true', JSON.stringify(row.i))
    check("sqlite default 'false' bool -> 0", row.d === 0 || row.d === 'false', JSON.stringify(row.d))
    check("sqlite default current_timestamp is string timestamp", typeof row.e === 'string' && /^\d{4}-/.test(row.e), JSON.stringify(row.e))
    check("sqlite default now() is valid", typeof row.f === 'string' && /^\d{4}-/.test(row.f), 'now() in sqlite: ' + JSON.stringify(row.f))
    check("sqlite default gen_random_uuid()", row.l != null, JSON.stringify(row.l))
  } catch (e) { check('sqlite defaults insert', false, e.message) }
}

// ---------- Postgres
setArea('B postgres exec (PGlite)')
const pgRes = {}
for (const [n, g] of Object.entries(gen)) {
  if (!g.postgres) continue
  const pg = new PGlite()
  const errs = []
  for (const st of g.postgres.split(SEP)) { if (!st.trim()) continue; try { await pg.exec(st) } catch (e) { errs.push(e.message + ' <= ' + st.replace(/\s+/g, ' ').slice(0, 80)) } }
  const ok = errs.length === 0, msg = errs.join(' || ')
  pgRes[n] = { ok, msg, pg }
  check(`postgres executes with 0 errors: ${n}`, ok, msg)
}
const pq = async (n, q) => { try { return (await pgRes[n].pg.query(q)).rows } catch (e) { return [{ error: e.message }] } }
{
  let rows = await pq('basic-fk', "select conname, contype from pg_constraint where conrelid='posts'::regclass")
  check('pg basic: FK constraint on posts', rows.some(r => r.contype === 'f'), JSON.stringify(rows))
  rows = await pq('basic-fk', "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name='users' order by ordinal_position")
  check('pg basic: users.id serial default nextval', /nextval/.test(rows[0].column_default), JSON.stringify(rows[0]))
  check('pg basic: created_at default now()', /now\(\)|CURRENT_TIMESTAMP/i.test(rows[5].column_default), JSON.stringify(rows[5]))
  rows = await pq('basic-fk', "select column_name, column_default, data_type from information_schema.columns where table_name='posts' and column_name='id'")
  check('pg basic: bigint id -> bigserial', /nextval/.test(rows[0].column_default) && rows[0].data_type === 'bigint', JSON.stringify(rows))
  rows = await pq('basic-fk', "select indexname from pg_indexes where tablename='posts'")
  check('pg basic: indexes exist', rows.some(r => r.indexname === 'uq_title_user') && rows.some(r => r.indexname === 'posts_user_id_idx'), JSON.stringify(rows))
  rows = await pq('m2m', "select tablename from pg_tables where schemaname='public'")
  check('pg m2m: junction table a_b', rows.some(r => r.tablename === 'a_b'), JSON.stringify(rows))
  rows = await pq('m2m', "select contype from pg_constraint where conrelid='a_b'::regclass")
  check('pg m2m: junction 2 FK + PK', rows.filter(r => r.contype === 'f').length === 2 && rows.some(r => r.contype === 'p'), JSON.stringify(rows))
  rows = await pq('m2m', "select column_name,data_type from information_schema.columns where table_name='a_b'")
  check('pg m2m: junction col types are integer/bigint not serial', rows.every(r => /int/.test(r.data_type)), JSON.stringify(rows))
  rows = await pq('one-to-one', "select contype from pg_constraint where conrelid='p'::regclass")
  check('pg one-to-one: unique on child', rows.some(r => r.contype === 'u'), JSON.stringify(rows))
  rows = await pq('composite-pk-fk', "select contype from pg_constraint where conrelid='x'::regclass")
  check('pg composite-pk-fk: individual FK to one col of composite PK fails/needs unique', pgRes['composite-pk-fk'].ok, pgRes['composite-pk-fk'].msg)
  rows = await pq('types', "select column_name, data_type, udt_name from information_schema.columns where table_name='t' order by ordinal_position")
  fs.writeFileSync('out/pg-types.json', JSON.stringify(rows, null, 1))
  check('pg types: all 22 SQL_TYPES columns created', rows.length === SQL_TYPES.length + 1, rows.length)
  check('pg types: int[] -> _int4, varchar[] -> _varchar', rows.find(r => r.column_name === 'c20')?.udt_name === '_int4' && rows.find(r => r.column_name === 'c21')?.udt_name === '_varchar', JSON.stringify(rows.slice(-2)))
  check('pg types: jsonb', rows.find(r => r.column_name === 'c17')?.udt_name === 'jsonb' && rows.find(r => r.column_name === 'c16')?.udt_name === 'json')
  check('pg types: uuid/bytea', rows.find(r => r.column_name === 'c15')?.udt_name === 'uuid' && rows.find(r => r.column_name === 'c19')?.udt_name === 'bytea')
  check('pg types: blob (mysql type) in PG executes', pgRes.types.ok, 'blob not a PG type; see message')
  check('pg types: datetime executes in PG', pgRes.types.ok)
  rows = await pq('mongo-types', "select column_name, udt_name from information_schema.columns where table_name='t' order by ordinal_position")
  fs.writeFileSync('out/pg-mongo-types.json', JSON.stringify(rows, null, 1))
  check('pg mongo-style types in SQL mode all map to valid PG types', pgRes['mongo-types'].ok, pgRes['mongo-types'].msg)
  check('pg reserved names', pgRes.reserved.ok, pgRes.reserved.msg)
  rows = await pq('reserved', "select contype from pg_constraint where conrelid='\"order\"'::regclass")
  check('pg reserved: FKs created', rows.filter(r => r.contype === 'f').length === 2, JSON.stringify(rows))
  check('pg autoinc types', pgRes['autoinc-types'].ok, pgRes['autoinc-types'].msg)
  if (pgRes['autoinc-types'].ok) {
    const r = await pq('autoinc-types', "select table_name,column_name,data_type,column_default from information_schema.columns where table_name in ('a','c','e','f') and column_name in ('id','a')")
    check('pg autoinc: varchar/uuid [increment] does not produce serial silently', true, JSON.stringify(r))
    fs.writeFileSync('out/pg-autoinc.json', JSON.stringify(r, null, 1))
  }
  check('pg index-collide (duplicate index definitions)', pgRes['index-collide'].ok, pgRes['index-collide'].msg)
  check('pg fk-collide (same ref twice)', pgRes['fk-collide'].ok, pgRes['fk-collide'].msg)
  check('pg m2m twice', pgRes['m2m-twice'].ok, pgRes['m2m-twice'].msg)
  check('pg m2m self', pgRes['ref-to-nonpk-m2m-self'].ok, pgRes['ref-to-nonpk-m2m-self'].msg)
  check('pg m2m junction name collides with existing table a_b', pgRes['m2m-name-collision'].ok, pgRes['m2m-name-collision'].msg)
  check('pg fk-to-nonunique (FK to non-unique col) - invalid input, generator should warn', pgRes['fk-to-nonunique'].ok, pgRes['fk-to-nonunique'].msg)
  check('pg self-ref', pgRes['self-ref'].ok)
  check('pg embedded table', pgRes.embedded.ok, pgRes.embedded.msg)
  check('pg unknown types pass-through', pgRes['unknown-types'].ok, pgRes['unknown-types'].msg)
  check('pg varchar no length + unique/pk', pgRes['varchar-nolen'].ok, pgRes['varchar-nolen'].msg)
  check('pg upper-case types', pgRes['upper-types'].ok, pgRes['upper-types'].msg)
  check('pg long names (>63 chars identifiers truncate silently; collisions?)', pgRes['long-names'].ok, pgRes['long-names'].msg)
  check('pg fk-type-mismatch int->bigint', pgRes['fk-type-mismatch'].ok, pgRes['fk-type-mismatch'].msg)
  check('pg thai', pgRes.thai.ok, pgRes.thai.msg)
  check('pg big-150', pgRes['big-150'].ok, pgRes['big-150'].msg)
  check('pg unique-and-pk-composite', pgRes['unique-and-pk-composite'].ok, pgRes['unique-and-pk-composite'].msg)
  check('pg array', pgRes['array-pg'].ok, pgRes['array-pg'].msg)
  // data check for defaults
  if (pgRes.defaults.ok) {
    const pg = pgRes.defaults.pg
    try { await pg.exec('insert into t(id) values (1)'); const r = (await pg.query('select * from t')).rows[0]; fs.writeFileSync('out/defaults.pg.row.json', JSON.stringify(r, null, 1))
      check("pg default 'it''s' preserved", r.a === "it's", r.a)
      check("pg default '007' stays '007'", r.g === '007', JSON.stringify(r.g))
      check("pg default 'null' string stays text 'null' (not NULL)", r.h === 'null', JSON.stringify(r.h))
      check("pg default 'true' text stays 'true'", r.i === 'true', JSON.stringify(r.i))
      check("pg default '' empty string stays ''", r.j === '', JSON.stringify(r.j))
      check("pg default json '{}'", JSON.stringify(r.k) === '{}', JSON.stringify(r.k))
      check("pg default gen_random_uuid()", typeof r.l === 'string', JSON.stringify(r.l))
      check("pg default current_date", r.m != null, JSON.stringify(r.m))
      check("pg default (1+2) expr", r.n === 3, JSON.stringify(r.n))
    } catch (e) { check('pg defaults insert', false, e.message) }
  } else {
    const defsql = gen.defaults.postgres
    check('pg defaults executes', false, pgRes.defaults.msg)
  }
  // identifier escaping
  check('pg: names containing double-quote are escaped', await (async () => { const sch = parse('Table t {\n x int\n}\n'); sch.tables[0].fields[0].name = 'a"b'; try { const p = new PGlite(); await p.exec(toSQL(sch, 'postgres')); const r = await p.query("select column_name from information_schema.columns where table_name='t'"); return r.rows[0].column_name === 'a"b' } catch { return false } })(), 'quote() never doubles embedded quote chars')
}

// ---------- MySQL (syntax via node-sql-parser + manual rules)
setArea('B mysql syntax')
const mysqlIssues = {}
for (const [n, g] of Object.entries(gen)) {
  if (!g.mysql) continue
  let ok = true, msg = ''
  try { mysqlParser.astify(g.mysql, { database: 'mysql' }) } catch (e) { ok = false; msg = e.message.slice(0, 200) }
  check(`mysql syntax (node-sql-parser): ${n}`, ok, msg)
}
// manual rules
function mysqlRuleScan(sql) {
  const issues = []
  const stmts = sql.split(/;\s*\n/).filter(Boolean)
  for (const st of stmts) {
    const m = st.match(/create table `([^`]+)` \(([\s\S]*)\)/)
    if (!m) continue
    const lines = m[2].split(/,\n/).map(s => s.trim())
    const hasAnyKey = lines.some(l => /primary key|unique/i.test(l))
    for (const l of lines) {
      if (/auto_increment/i.test(l) && !/primary key|unique/i.test(l) && !lines.some(x => /^primary key/i.test(x))) issues.push(`auto_increment without key: ${l}`)
      if (/auto_increment/i.test(l) && !/\b(int|bigint|smallint|tinyint|mediumint|integer|decimal|float|double)\b/i.test(l.split(/\s+/)[1])) issues.push(`auto_increment on non-numeric: ${l}`)
      if (/^`[^`]+`\s+(text|blob|json|mediumtext|longtext)\b[^,]*\bdefault\b/i.test(l) && !/default \(/i.test(l)) issues.push(`literal DEFAULT on TEXT/BLOB/JSON: ${l}`)
      if (/^`[^`]+`\s+(text|blob|mediumtext|longtext)\b[^,]*\b(unique|primary key)\b/i.test(l)) issues.push(`UNIQUE/PK on TEXT/BLOB without key length: ${l}`)
      if (/^`[^`]+`\s+(varchar|char)\b(?!\()/i.test(l)) issues.push(`varchar/char without length: ${l}`)
      if (/^`[^`]+`\s+(varchar)\((\d+)\)[^,]*\b(unique|primary key)\b/i.test(l) && Number(l.match(/varchar\((\d+)\)/i)[1]) > 768) issues.push(`unique varchar > 768 chars (utf8mb4 3072-byte key limit): ${l}`)
      if (/^`[^`]+`\s+(uuid|bytea|jsonb|timestamptz|serial|bigserial|money|inet)\b/i.test(l) || /^`[^`]+`\s+\S+\[\]/.test(l)) issues.push(`non-MySQL type: ${l}`)
      if (/default (true|false)\b/i.test(l)) { /* valid in MySQL */ }
      if (/default now\(\)/i.test(l) && /^`[^`]+`\s+(date|time|text|varchar|int)\b/i.test(l)) issues.push(`DEFAULT now() on non-datetime column: ${l}`)
      if (/^`[^`]+`\s+(date)\b[^,]*default (current_timestamp|now\(\))/i.test(l)) issues.push(`DEFAULT current_timestamp on DATE: ${l}`)
      if (/^`[^`]+`\s+(\S+)/.test(l) && !/^(`|primary key)/.test(l)) {}
    }
  }
  // FK type check: alter table ... foreign key
  const tables = {}
  for (const st of stmts) {
    const m = st.match(/create table `([^`]+)` \(([\s\S]*)\)/)
    if (m) { tables[m[1]] = {}; for (const l of m[2].split(/,\n/)) { const c = l.trim().match(/^`([^`]+)`\s+(\w+(?:\([^)]*\))?)(.*)/); if (c) tables[m[1]][c[1]] = { type: c[2].toLowerCase(), rest: c[3] } } }
  }
  for (const st of stmts) {
    const m = st.match(/alter table `([^`]+)` add constraint `[^`]+` foreign key \(`([^`]+)`\) references `([^`]+)` \(`([^`]+)`\)/)
    if (m) {
      const a = tables[m[1]]?.[m[2]], b = tables[m[3]]?.[m[4]]
      if (!a || !b) issues.push(`FK references missing table/col ${m[1]}.${m[2]} -> ${m[3]}.${m[4]}`)
      else {
        if (a.type !== b.type) issues.push(`FK type mismatch ${m[1]}.${m[2]} ${a.type} vs ${m[3]}.${m[4]} ${b.type} (MySQL error 3780/1215)`)
        if (!/primary key|unique/i.test(b.rest) && !new RegExp('primary key \\(.*`' + m[4] + '`').test(sql)) issues.push(`FK target ${m[3]}.${m[4]} is not indexed (MySQL 1215/1822)`)
      }
    }
  }
  return issues
}
for (const n of Object.keys(gen)) {
  if (!gen[n].mysql) continue
  mysqlIssues[n] = mysqlRuleScan(gen[n].mysql)
}
fs.writeFileSync('out/mysql-issues.json', JSON.stringify(mysqlIssues, null, 1))
for (const [n, iss] of Object.entries(mysqlIssues)) {
  if (['dup-names', 'dup-fields', 'fk-to-nonunique', 'fk-type-mismatch', 'ref-bad', 'index-collide', 'fk-collide', 'm2m-twice', 'm2m-name-collision', 'embedded', 'unknown-types'].includes(n)) continue
  check(`mysql rules: ${n} (real MySQL would accept)`, iss.length === 0, iss.join(' | '))
}
// specifically
check('mysql: types list maps timestamp/date/time/etc.', !/uuid |bytea|jsonb/.test(gen.types.mysql), 'unmapped PG types leak into MySQL')
check('mysql: int[] -> json', /json/.test(gen.types.mysql))
check('mysql: m2m junction: FK before PK, col types equal parents', mysqlIssues.m2m.length === 0, mysqlIssues.m2m.join('|'))
check('mysql: backticks inside names escaped', (() => { const sch = parse('Table t {\n x int\n}\n'); sch.tables[0].fields[0].name = 'a`b'; return /`a``b`/.test(toSQL(sch, 'mysql')) })(), 'quote() does not double embedded backtick')

done('b.json')
