import { S, check, setArea, done } from './h.js'
import initSqlJs from 'sql.js'
import fs from 'node:fs'
const { ddlToSchema, serialize, parse, toSQL } = S
const SQL = await initSqlJs()
const CLEAN = process.env.CLEAN === '1'
const rd = (f) => { let t = fs.readFileSync(f, 'utf8'); if (CLEAN && !f.includes('sqlite')) t = t.split(String.fromCharCode(10)).filter((l) => !/^(INSERT INTO|COPY |[0-9]|LOCK TABLES|UNLOCK)/.test(l) && l.trim() !== String.fromCharCode(92) + '.').join(String.fromCharCode(10)); return t }
const sA = setArea; const setArea2 = (a) => sA(a + (CLEAN ? ' [data lines removed]' : ' [with INSERT/COPY data]'))
const T = (s, n) => s.tables.find((t) => t.name === n)
const F = (s, t, f) => T(s, t)?.fields.find((x) => x.name === f)
const hasRef = (s, ft, ff, tt, tf) => s.refs.some((r) => r.from.table === ft && r.from.field === ff && r.to.table === tt && r.to.field === tf)
let re
const dump = (n, s) => fs.writeFileSync(`out/import-${n}.dsl`, serialize(s))
const noThrow = (name, fn) => { try { return fn() } catch (e) { check(name + ' no throw', false, e.stack); return null } }

// ---------------- PostgreSQL pg_dump
setArea2('C import pg_dump')
let s = noThrow('pg', () => ddlToSchema(rd('fixtures/pg_dump.sql')))
dump('pg', s)
check('tables found = 5 (users, orders, order_items, products, group)', s.tables.length === 5, s.tables.map((t) => t.name).join(','))
check('no phantom table from COPY/INSERT data text ("evil")', !T(s, 'evil'))
check('users.id PK (via ALTER TABLE ONLY ADD CONSTRAINT PRIMARY KEY)', F(s, 'users', 'id')?.pk)
check('users.id increment (DEFAULT nextval via ALTER COLUMN SET DEFAULT / sequence OWNED BY)', F(s, 'users', 'id')?.increment, 'serial-ness lost: ' + JSON.stringify(F(s, 'users', 'id')))
check('users.email UNIQUE (ALTER TABLE ADD CONSTRAINT UNIQUE)', F(s, 'users', 'email')?.unique, 'ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (col) not handled')
check('varchar(255)', F(s, 'users', 'email')?.type === 'character varying(255)' || F(s, 'users', 'email')?.type === 'varchar(255)', F(s, 'users', 'email')?.type)
check('type "character varying(255)" normalised to varchar(255) (cosmetic)', F(s, 'users', 'email')?.type === 'varchar(255)', F(s, 'users', 'email')?.type)
check('numeric(10,2)', F(s, 'users', 'balance')?.type === 'numeric(10,2)', F(s, 'users', 'balance')?.type)
check('balance default 0.00 + not null', F(s, 'users', 'balance')?.default === '0.00' && F(s, 'users', 'balance')?.notNull, JSON.stringify(F(s, 'users', 'balance')))
check('timestamp without time zone type', /^timestamp/.test(F(s, 'users', 'created_at')?.type ?? ''), F(s, 'users', 'created_at')?.type)
check('timestamp type kept exactly as "timestamp without time zone" (round-trips to PG?)', F(s, 'users', 'created_at')?.type === 'timestamp without time zone', F(s, 'users', 'created_at')?.type)
check('created_at default now()', F(s, 'users', 'created_at')?.default === 'now()', F(s, 'users', 'created_at')?.default)
check('timestamp with time zone', F(s, 'users', 'updated_at')?.type === 'timestamp with time zone', F(s, 'users', 'updated_at')?.type)
check('boolean default true', F(s, 'users', 'is_active')?.default === 'true', F(s, 'users', 'is_active')?.default)
check("text default with '' and ; and \" and ::text cast", F(s, 'users', 'bio')?.default === `it's; a "bio"`, JSON.stringify(F(s, 'users', 'bio')?.default))
check('text[] array type', F(s, 'users', 'tags')?.type === 'text[]', F(s, 'users', 'tags')?.type)
check("jsonb default '{}'::jsonb -> {}", F(s, 'users', 'meta')?.default === '{}', F(s, 'users', 'meta')?.default)
check("varchar default 'new'::character varying -> new", F(s, 'users', 'status')?.default === 'new', F(s, 'users', 'status')?.default)
check('CHECK constraint inside CREATE TABLE ignored (no phantom field)', T(s, 'users')?.fields.length === 11, T(s, 'users')?.fields.length)
check('orders.id bigint PK', F(s, 'orders', 'id')?.pk && F(s, 'orders', 'id')?.type === 'bigint')
check('double precision type', F(s, 'orders', 'total')?.type === 'double precision', F(s, 'orders', 'total')?.type)
check('character(10)', F(s, 'orders', 'note')?.type === 'character(10)' || F(s, 'orders', 'note')?.type === 'char(10)', F(s, 'orders', 'note')?.type)
check('composite PK order_items (order_id,line_no)', F(s, 'order_items', 'order_id')?.pk && F(s, 'order_items', 'line_no')?.pk && !F(s, 'order_items', 'sku')?.pk)
check('quoted "Name" column preserved case', !!F(s, 'products', 'Name'), T(s, 'products')?.fields.map((f) => f.name).join())
check('table "group" (reserved, quoted) schema-qualified', !!T(s, 'group'), s.tables.map((t) => t.name).join())
check('uuid default gen_random_uuid()', F(s, 'group', 'id')?.default === 'gen_random_uuid()', F(s, 'group', 'id')?.default)
check('FK orders.user_id -> users.id (ALTER TABLE ONLY ... ADD CONSTRAINT FK ... ON DELETE CASCADE)', hasRef(s, 'orders', 'user_id', 'users', 'id'))
check('FK order_items.order_id -> orders.id (ON UPDATE .. ON DELETE ..)', hasRef(s, 'order_items', 'order_id', 'orders', 'id'))
check('FK order_items.sku -> products.sku', hasRef(s, 'order_items', 'sku', 'products', 'sku'))
check('3 refs total', s.refs.length === 3, s.refs.length)
const ixs = T(s, 'orders')?.indexes ?? []
check('index idx_orders_user (USING btree)', ixs.some((i) => i.name === 'idx_orders_user' && i.fields.join() === 'user_id'), JSON.stringify(ixs))
check('index with DESC: idx_orders_placed fields = placed_at,user_id (no " DESC" in names)', ixs.some((i) => i.name === 'idx_orders_placed' && i.fields.join() === 'placed_at,user_id'), JSON.stringify(ixs))
const uix = T(s, 'users')?.indexes ?? []
check('expression index lower((email)::text) skipped or sane (no garbage column names)', uix.every((i) => i.fields.every((f) => /^\w+$/.test(f))), JSON.stringify(uix))
// regenerate
const dsl = serialize(s); re = parse(dsl)
check('serialize(import) re-parses with 0 errors', re.errors.length === 0, JSON.stringify(re.errors))
const pgOut = toSQL(re, 'postgres')
const { PGlite } = await import('@electric-sql/pglite')
const pg = new PGlite(); const errs = []
for (const st of pgOut.split(String.fromCharCode(10, 10))) { if (!st.trim()) continue; try { await pg.exec(st) } catch (e) { errs.push(e.message + ' <= ' + st.replace(/\s+/g, ' ').slice(0, 90)) } }
check('regenerated PG DDL executes cleanly in PGlite', errs.length === 0, errs.join(' || '))
fs.writeFileSync('out/import-pg.regen.sql', pgOut)

// ---------------- MySQL
setArea2('C import mysqldump')
s = noThrow('mysql', () => ddlToSchema(rd('fixtures/mysqldump.sql')))
dump('mysql', s)
check('tables = 5 (customers, orders, order_lines, tags, customer_tags)', s.tables.length === 5, s.tables.map((t) => t.name).join(','))
check('no phantom tables from INSERT strings (`bad`)', !T(s, 'bad') && !T(s, 'evil'))
check('customers.id PK + auto_increment + int', F(s, 'customers', 'id')?.pk && F(s, 'customers', 'id')?.increment && F(s, 'customers', 'id')?.type === 'int', JSON.stringify(F(s, 'customers', 'id')))
check('email varchar(191) not null (COLLATE clause ignored)', F(s, 'customers', 'email')?.type === 'varchar(191)' && F(s, 'customers', 'email')?.notNull, JSON.stringify(F(s, 'customers', 'email')))
check('email unique (UNIQUE KEY uk_email)', F(s, 'customers', 'email')?.unique, JSON.stringify(F(s, 'customers', 'email')))
check('name varchar(100) with CHARACTER SET', F(s, 'customers', 'name')?.type === 'varchar(100)', JSON.stringify(F(s, 'customers', 'name')))
check('decimal(10,2) unsigned type keeps unsigned or drops cleanly', /^decimal\(10,2\)/.test(F(s, 'customers', 'credit')?.type), F(s, 'customers', 'credit')?.type)
check("credit default '0.00' -> 0.00", F(s, 'customers', 'credit')?.default === '0.00', F(s, 'customers', 'credit')?.default)
check("enum('active','blocked','pending') type preserved", /^enum\(/.test(F(s, 'customers', 'status')?.type), F(s, 'customers', 'status')?.type)
check("enum default 'pending'", F(s, 'customers', 'status')?.default === 'pending', F(s, 'customers', 'status')?.default)
check('datetime default CURRENT_TIMESTAMP', F(s, 'customers', 'created')?.default?.toLowerCase() === 'current_timestamp', F(s, 'customers', 'created')?.default)
check('timestamp ... ON UPDATE CURRENT_TIMESTAMP: type = timestamp', F(s, 'customers', 'updated')?.type === 'timestamp', F(s, 'customers', 'updated')?.type)
check('tinyint(1)', F(s, 'customers', 'flags')?.type === 'tinyint(1)', F(s, 'customers', 'flags')?.type)
check('flags default 0', F(s, 'customers', 'flags')?.default === '0', F(s, 'customers', 'flags')?.default)
check("column COMMENT with ; and parens doesn't break (bio longtext)", F(s, 'customers', 'bio')?.type === 'longtext', F(s, 'customers', 'bio')?.type)
check('COMMENT imported as note (nice-to-have)', !!F(s, 'customers', 'bio')?.note, 'comment dropped')
check('bigint unsigned', /^bigint/.test(F(s, 'customers', 'big')?.type))
check('index idx_name_status (name,status)', T(s, 'customers')?.indexes.some((i) => i.name === 'idx_name_status' && i.fields.join() === 'name,status'), JSON.stringify(T(s, 'customers')?.indexes))
check('FULLTEXT KEY skipped without crash', true)
check('orders.id bigint pk inc', F(s, 'orders', 'id')?.pk && F(s, 'orders', 'id')?.increment && F(s, 'orders', 'id')?.type === 'bigint')
check('orders.ref_code unique (UNIQUE KEY uk_ref)', F(s, 'orders', 'ref_code')?.unique)
check('orders json type', F(s, 'orders', 'payload')?.type === 'json')
check('FK orders.customer_id -> customers.id (ON DELETE CASCADE ON UPDATE RESTRICT)', hasRef(s, 'orders', 'customer_id', 'customers', 'id'))
check('self FK orders.parent_id -> orders.id', hasRef(s, 'orders', 'parent_id', 'orders', 'id'))
check('FK order_lines.order_id -> orders.id', hasRef(s, 'order_lines', 'order_id', 'orders', 'id'))
check('FK customer_tags both', hasRef(s, 'customer_tags', 'customer_id', 'customers', 'id') && hasRef(s, 'customer_tags', 'tag_id', 'tags', 'id'))
check('composite PK order_lines', F(s, 'order_lines', 'order_id')?.pk && F(s, 'order_lines', 'line')?.pk)
check('composite unique key (order_id,sku) -> unique index', T(s, 'order_lines')?.indexes.some((i) => i.unique && i.fields.join() === 'order_id,sku'), JSON.stringify(T(s, 'order_lines')?.indexes))
check('prefix-length key `sku`(10) -> field sku', T(s, 'order_lines')?.indexes.some((i) => i.fields.join() === 'sku'), JSON.stringify(T(s, 'order_lines')?.indexes))
check('qty default 1', F(s, 'order_lines', 'qty')?.default === '1', F(s, 'order_lines', 'qty')?.default)
check('refs total = 5', s.refs.length === 5, s.refs.length)
re = parse(serialize(s))
check('re-parse 0 errors', re.errors.length === 0, JSON.stringify(re.errors))
const myOut = toSQL(re, 'mysql')
fs.writeFileSync('out/import-mysql.regen.sql', myOut)
const pkg = (await import('node-sql-parser')).default
try { new pkg.Parser().astify(myOut, { database: 'mysql' }); check('regenerated MySQL DDL parses', true) } catch (e) { check('regenerated MySQL DDL parses', false, e.message.slice(0, 150)) }
const pgFromMy = toSQL(re, 'postgres')
{
  const pg2 = new PGlite(); const e2 = []
  for (const st of pgFromMy.split(String.fromCharCode(10, 10))) { if (!st.trim()) continue; try { await pg2.exec(st) } catch (e) { e2.push(e.message + ' <= ' + st.replace(/\s+/g, ' ').slice(0, 90)) } }
  check('MySQL dump -> DSL -> Postgres DDL executes in PGlite', e2.length === 0, e2.join(' || '))
  const sl = new SQL.Database(); const e3 = []
  for (const st of toSQL(re, 'sqlite').split(String.fromCharCode(10, 10))) { if (!st.trim()) continue; try { sl.exec(st) } catch (e) { e3.push(e.message + ' <= ' + st.replace(/\s+/g, ' ').slice(0, 90)) } }
  check('MySQL dump -> DSL -> SQLite DDL executes in sql.js', e3.length === 0, e3.join(' || '))
}

// ---------------- SQLite hand + real file
setArea('C import sqlite')
s = noThrow('sqlite', () => ddlToSchema(fs.readFileSync('fixtures/sqlite_hand.sql', 'utf8')))
dump('sqlite-hand', s)
check('tables = 4 (authors, books, "book tags", no_pk) - view/trigger not tables', s.tables.length === 4, s.tables.map((t) => t.name).join(','))
check('authors.id integer pk + AUTOINCREMENT', F(s, 'authors', 'id')?.pk && F(s, 'authors', 'id')?.increment, JSON.stringify(F(s, 'authors', 'id')))
check('authors.name not null unique', F(s, 'authors', 'name')?.unique && F(s, 'authors', 'name')?.notNull)
check("default 'N/A; unknown'", F(s, 'authors', 'bio')?.default === 'N/A; unknown', F(s, 'authors', 'bio')?.default)
check('books.id INTEGER PRIMARY KEY (rowid) -> pk', F(s, 'books', 'id')?.pk)
check('inline REFERENCES authors(id) ON DELETE CASCADE', hasRef(s, 'books', 'author_id', 'authors', 'id'))
check('table-level FOREIGN KEY (editor_id) ... ON DELETE SET NULL ON UPDATE CASCADE', hasRef(s, 'books', 'editor_id', 'authors', 'id'))
check('VARCHAR(200) lowercased', F(s, 'books', 'title')?.type === 'varchar(200)', F(s, 'books', 'title')?.type)
check('isbn char(13) unique', F(s, 'books', 'isbn')?.unique && F(s, 'books', 'isbn')?.type === 'char(13)')
check('price default 9.99 real', F(s, 'books', 'price')?.default === '9.99' && F(s, 'books', 'price')?.type === 'real', JSON.stringify(F(s, 'books', 'price')))
check('CHECK (price >= 0) ignored, no phantom field', T(s, 'books')?.fields.length === 9, T(s, 'books')?.fields.map((f) => f.name).join())
check('added DATETIME default CURRENT_TIMESTAMP', F(s, 'books', 'added')?.default?.toLowerCase() === 'current_timestamp')
check('table "book tags" w/ space', !!T(s, 'book tags'), s.tables.map((t) => t.name).join())
check('[tag name] bracket-quoted column', !!F(s, 'book tags', 'tag name'), T(s, 'book tags')?.fields.map((f) => f.name).join())
check('composite pk ("book id", [tag name]) w/ WITHOUT ROWID', F(s, 'book tags', 'book id')?.pk && F(s, 'book tags', 'tag name')?.pk, JSON.stringify(T(s, 'book tags')?.fields))
check('FK from "book tags"."book id" -> books.id', hasRef(s, 'book tags', 'book id', 'books', 'id'))
check('no_pk columns with no type: `a, b` (typeless columns) kept', T(s, 'no_pk')?.fields.length === 3, JSON.stringify(T(s, 'no_pk')?.fields.map((f) => f.name + ':' + f.type)))
check('index idx_books_title (title COLLATE NOCASE) -> field title', T(s, 'books')?.indexes.some((i) => i.name === 'idx_books_title' && i.fields.join() === 'title'), JSON.stringify(T(s, 'books')?.indexes))
check('unique index author_id,title', T(s, 'books')?.indexes.some((i) => i.unique && i.fields.join() === 'author_id,title'))
check('partial index with WHERE: handled w/o garbage', T(s, 'books')?.indexes.every((i) => i.fields.every((f) => /^\w+$/.test(f))), JSON.stringify(T(s, 'books')?.indexes))
check('trigger body with ; does not create junk', !s.tables.some((t) => /update|trg/i.test(t.name)))
re = parse(serialize(s))
check('sqlite hand: re-parse errors == 0 (refs for "book tags" must be quoted by serializer)', re.errors.length === 0, JSON.stringify(re.errors) + '\n' + serialize(s).split('\n').filter((l) => /^Ref/.test(l)).join('\n'))
check('sqlite hand: refs survive serialize->parse (quoted/space names)', re.refs.length === s.refs.length, `before=${s.refs.length} after=${re.refs.length}`)

// real binary sqlite file
{
  const db = new SQL.Database()
  db.run(fs.readFileSync('fixtures/sqlite_hand.sql', 'utf8').replace('PRAGMA foreign_keys = ON;', ''))
  db.run("create table extra (id integer primary key, note text default 'it''s', n numeric(10,2), ts timestamp default (datetime('now')), c1 text check (c1 in ('a','b')), g integer generated always as (id*2) virtual)")
  const bin = db.export(); fs.writeFileSync('fixtures/real.sqlite', bin)
  const db2 = new SQL.Database(new Uint8Array(fs.readFileSync('fixtures/real.sqlite')))
  const res = db2.exec("select sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by case type when 'table' then 0 else 1 end")
  const ddl = (res[0]?.values ?? []).map((r) => r[0]).join(';\n')
  fs.writeFileSync('out/real-sqlite-master.sql', ddl)
  s = noThrow('sqlite-file', () => ddlToSchema(ddl)); dump('sqlite-file', s)
  check('binary sqlite: 5 tables (authors, books, book tags, no_pk, extra)', s.tables.length === 5, s.tables.map((t) => t.name).join())
  check('binary sqlite: view/trigger in sqlite_master dont create tables', !s.tables.some((t) => t.name === 'v'))
  check('binary sqlite: FKs (3) found', s.refs.length === 3, s.refs.length)
  check('binary sqlite: extra.note default "it\'s"', F(s, 'extra', 'note')?.default === "it's", F(s, 'extra', 'note')?.default)
  check('binary sqlite: numeric(10,2)', F(s, 'extra', 'n')?.type === 'numeric(10,2)', F(s, 'extra', 'n')?.type)
  check("binary sqlite: default (datetime('now')) expression", F(s, 'extra', 'ts')?.default != null, JSON.stringify(F(s, 'extra', 'ts')))
  check("binary sqlite: column with inline CHECK(c1 in ('a','b')) keeps type text", F(s, 'extra', 'c1')?.type === 'text', JSON.stringify(F(s, 'extra', 'c1')))
  check('binary sqlite: generated column parsed as column g', !!F(s, 'extra', 'g'), T(s, 'extra')?.fields.map((f) => f.name + ':' + f.type).join())
  check('binary sqlite: indexes imported (3 on books)', T(s, 'books')?.indexes.length === 3, JSON.stringify(T(s, 'books')?.indexes))
  check('binary sqlite: sqlite autoindex-based UNIQUE shows as unique', F(s, 'books', 'isbn')?.unique)
}

// ---------------- Edge statements
setArea('C import edge cases')
const E = (name, sql, fn) => { const sc = noThrow(name, () => ddlToSchema(sql)); if (sc) fn(sc) }
E('semi in string', "CREATE TABLE a (id int primary key, note varchar(20) DEFAULT 'a;b', b int);\nCREATE TABLE c (id int);", (x) => check("';' inside string literal in DEFAULT", x.tables.length === 2 && F(x, 'a', 'note')?.default === 'a;b' && !!F(x, 'a', 'b'), JSON.stringify(x.tables)))
E('semi in comment', "CREATE TABLE a (\n id int, -- comment; with semi\n b int /* x; y */\n);", (x) => check('; inside -- and /* */ comments', x.tables[0]?.fields.length === 2, JSON.stringify(x.tables)))
E('comment markers in strings', "CREATE TABLE a (id int, s varchar(10) DEFAULT '--x', t varchar(10) DEFAULT '/* y */', u int);", (x) => check("'--x' / '/* */' inside string literals not stripped as comments", x.tables[0]?.fields.length === 4 && F(x, 'a', 's')?.default === '--x', JSON.stringify(x.tables[0]?.fields.map((f) => f.name + '=' + f.default))))
E('hash in string', "CREATE TABLE a (id int, s varchar(10) DEFAULT 'x',\n#hash comment\n u int);", (x) => check('# comment (mysql) stripped', x.tables[0]?.fields.length === 3, JSON.stringify(x.tables[0]?.fields.map((f) => f.name))))
E('multiline', 'CREATE TABLE\n  "a b"\n(\n  id\n    int\n    NOT NULL\n    PRIMARY KEY,\n  x\n    varchar(\n 10 )\n);', (x) => check('multi-line statement with newlines inside type', x.tables[0]?.name === 'a b' && F(x, 'a b', 'x')?.type.replace(/\s/g, '') === 'varchar(10)', JSON.stringify(x.tables)))
E('no space before paren', 'CREATE TABLE a(id int PRIMARY KEY,b int);', (x) => check('CREATE TABLE a(...) no spaces', x.tables[0]?.fields.length === 2, JSON.stringify(x.tables)))
E('upper/lower', 'create table A (ID INT primary key, Name VARCHAR(5) not null);', (x) => check('case preserved for identifiers, types lowercased', F(x, 'A', 'ID')?.type === 'int' && F(x, 'A', 'Name')?.type === 'varchar(5)', JSON.stringify(x.tables)))
E('serial', 'CREATE TABLE a (id SERIAL PRIMARY KEY, b BIGSERIAL, c smallserial);', (x) => check('serial/bigserial/smallserial -> int/bigint + increment', F(x, 'a', 'id')?.type === 'int' && F(x, 'a', 'id')?.increment && F(x, 'a', 'b')?.type === 'bigint' && F(x, 'a', 'b')?.increment && F(x, 'a', 'c')?.increment, JSON.stringify(x.tables[0].fields.map((f) => f.type + (f.increment ? '+inc' : '')))))
E('identity', 'CREATE TABLE a (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, b bigint GENERATED BY DEFAULT AS IDENTITY (START WITH 10));', (x) => check('GENERATED ... AS IDENTITY -> increment, type', F(x, 'a', 'id')?.increment && F(x, 'a', 'id')?.type === 'int' && F(x, 'a', 'b')?.increment && F(x, 'a', 'b')?.type === 'bigint', JSON.stringify(x.tables[0].fields)))
E('named inline', 'CREATE TABLE a (id int CONSTRAINT pk_a PRIMARY KEY, b int CONSTRAINT nn NOT NULL CONSTRAINT u1 UNIQUE);', (x) => check('inline named constraints', F(x, 'a', 'id')?.pk && F(x, 'a', 'b')?.notNull && F(x, 'a', 'b')?.unique, JSON.stringify(x.tables[0].fields)))
E('quoted type', 'CREATE TABLE a (id int, c "char"(1), d "double precision", e int[][], f character varying, g time(3) without time zone, h interval day to second);', (x) => check('odd types (array 2D, time(3) w/o tz, character varying w/o length, interval)', x.tables[0]?.fields.length === 7 && x.tables[0].fields.every((f) => f.type), JSON.stringify(x.tables[0]?.fields.map((f) => f.name + ':' + f.type))))
E('pk col-list quoted', 'CREATE TABLE a (`x` int, `y` int, PRIMARY KEY (`x`,`y`), KEY `k` (`x`));', (x) => check('backtick composite pk', F(x, 'a', 'x')?.pk && F(x, 'a', 'y')?.pk))
E('fk multi-col', 'CREATE TABLE p (a int, b int, PRIMARY KEY (a,b));\nCREATE TABLE c (x int, y int, FOREIGN KEY (x,y) REFERENCES p(a,b));', (x) => check('composite FK (x,y)->(a,b): both pairs captured (known limitation: only first)', x.refs.length === 2, JSON.stringify(x.refs)))
E('fk no cols', 'CREATE TABLE p (id int primary key);\nCREATE TABLE c (pid int REFERENCES p);', (x) => check('inline REFERENCES p (without column list) -> ref to p.id', x.refs.length === 1, JSON.stringify(x.refs)))
E('fk before table', 'ALTER TABLE c ADD CONSTRAINT f FOREIGN KEY (pid) REFERENCES p(id);\nCREATE TABLE p (id int primary key);\nCREATE TABLE c (pid int);', (x) => check('ALTER FK before CREATE order-independent', x.refs.length === 1))
E('alter add column', 'CREATE TABLE a (id int);\nALTER TABLE a ADD COLUMN b varchar(10) NOT NULL;\nALTER TABLE a ADD PRIMARY KEY (id);', (x) => check('ALTER TABLE ADD COLUMN applied (pg dumps/migrations)', !!F(x, 'a', 'b') && F(x, 'a', 'id')?.pk, T(x, 'a')?.fields.map((f) => f.name).join()))
E('alter pk only', 'CREATE TABLE public.a (id int);\nALTER TABLE ONLY public.a ADD CONSTRAINT a_pkey PRIMARY KEY (id);', (x) => check('ALTER ONLY schema-qualified PK', F(x, 'a', 'id')?.pk))
E('alter unique idx', 'CREATE TABLE a (id int, e text);\nALTER TABLE a ADD CONSTRAINT u UNIQUE (e);\nALTER TABLE a ADD UNIQUE (id, e);', (x) => check('ALTER TABLE ADD UNIQUE (single/composite)', F(x, 'a', 'e')?.unique && x.tables[0].indexes.length === 1, JSON.stringify(x.tables[0])))
E('create table as / like', 'CREATE TABLE a (id int);\nCREATE TABLE b AS SELECT * FROM a;\nCREATE TABLE c (LIKE a);\nCREATE TABLE d PARTITION OF a FOR VALUES IN (1);', (x) => check('CREATE TABLE AS / LIKE / PARTITION OF produce no crash/junk', x.tables.length >= 1))
E('unlogged/temp', 'CREATE UNLOGGED TABLE a (id int);\nCREATE TEMPORARY TABLE b (id int);\nCREATE TABLE IF NOT EXISTS c (id int);\nCREATE OR REPLACE VIEW v AS select 1;', (x) => check('CREATE UNLOGGED/TEMP TABLE recognised (UNLOGGED missing?)', x.tables.length === 3, x.tables.map((t) => t.name).join()))
E('mysql inline', 'CREATE TABLE a (id int PRIMARY KEY AUTO_INCREMENT, n int UNSIGNED ZEROFILL NOT NULL, `desc` text);', (x) => check('AUTO_INCREMENT after PRIMARY KEY, unsigned zerofill type', F(x, 'a', 'id')?.increment && /^int/.test(F(x, 'a', 'n')?.type) && F(x, 'a', 'desc')?.type === 'text', JSON.stringify(x.tables[0].fields.map((f) => f.type))))
E('mysql type with space', 'CREATE TABLE a (n int unsigned NOT NULL, d double precision NOT NULL, m decimal(5,2) unsigned);', (x) => check('"int unsigned" kept, double precision', x.tables[0]?.fields.length === 3, JSON.stringify(x.tables[0].fields.map((f) => f.type))))
E('double dash in default', "CREATE TABLE a (id int, u varchar(100) DEFAULT 'http://x.com/a--b');", (x) => check("default 'http://x.com/a--b' ('--' inside string eaten by comment stripper?)", F(x, 'a', 'u')?.default === 'http://x.com/a--b', JSON.stringify(F(x, 'a', 'u'))))
E('default with paren', "CREATE TABLE a (id int, d varchar(10) DEFAULT (concat('a','b')), e int DEFAULT (1+2), f timestamp DEFAULT CURRENT_TIMESTAMP(6), g text DEFAULT 'a, b');", (x) => check('DEFAULT expressions with parens/commas', x.tables[0]?.fields.length === 4 && F(x, 'a', 'g')?.default === 'a, b', JSON.stringify(x.tables[0]?.fields.map((f) => f.name + '=' + f.default))))
E('dollar quoting', "CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN new; END; $$ LANGUAGE plpgsql;\nCREATE TABLE after_fn (id int);", (x) => check('PL/pgSQL $$ body with ; does not swallow following tables', x.tables.some((t) => t.name === 'after_fn'), x.tables.map((t) => t.name).join()))
E('thai', 'CREATE TABLE `ผู้ใช้` (`รหัส` int PRIMARY KEY, `ชื่อ` varchar(50) DEFAULT \'ไม่ระบุ\' COMMENT \'ชื่อ\');', (x) => check('thai identifiers + default', F(x, 'ผู้ใช้', 'รหัส')?.pk && F(x, 'ผู้ใช้', 'ชื่อ')?.default === 'ไม่ระบุ'))
E('crlf', 'CREATE TABLE a (\r\n  id int NOT NULL,\r\n  b varchar(5)\r\n);\r\n', (x) => check('CRLF', x.tables[0]?.fields.length === 2 && x.tables[0].fields[0].type === 'int'))
E('empty', '', (x) => check('empty input', x.tables.length === 0))
E('garbage', 'hello world; select 1; \u0000\u0001 )))((( ', (x) => check('garbage no crash', true))
E('unbalanced', 'CREATE TABLE a (id int, b int', (x) => check('unbalanced paren no crash', true))
E('quoted ident with comma/paren', 'CREATE TABLE "we,ird(name)" ("a,b" int, "c)d" text);', (x) => check('quoted identifiers containing , ( )', x.tables[0]?.fields.length === 2, JSON.stringify(x.tables)))
E('escaped quotes backslash', "INSERT INTO t VALUES ('it\\'s; here');\nCREATE TABLE after_bs (id int);", (x) => check("MySQL backslash-escaped quote inside INSERT string followed by ; keeps statements aligned", x.tables.some((t) => t.name === 'after_bs'), x.tables.map((t) => t.name).join()))
E('E string', "INSERT INTO t VALUES (E'it\\'s; here');\nCREATE TABLE after_e (id int);", (x) => check("PG E'..\\'..' strings keep statements aligned", x.tables.some((t) => t.name === 'after_e'), x.tables.map((t) => t.name).join()))
E('comment w/ apostrophe', "-- it's a dump\nCREATE TABLE a (id int);\n/* don't */\nCREATE TABLE b (id int);", (x) => check("apostrophe inside comments does not unbalance quotes", x.tables.length === 2, x.tables.map((t) => t.name).join()))
E('comment w/ apostrophe (mysqldump COMMENT)', "CREATE TABLE a (\n id int COMMENT 'user''s id',\n b int COMMENT \"it's\"\n);\nCREATE TABLE z (id int);", (x) => check("COMMENT 'user''s id'", x.tables.length === 2 && x.tables[0].fields.length === 2, JSON.stringify(x.tables.map((t) => t.name))))
E('perf', Array.from({ length: 800 }, (_, i) => `CREATE TABLE t${i} (id int primary key, a varchar(10) default 'x', b int references t0(id));`).join('\n'), (x) => check('800 tables parse', x.tables.length === 800))
{
  const big = Array.from({ length: 3000 }, (_, i) => `CREATE TABLE t${i} (id int primary key, a varchar(10) default 'x', b int references t0(id));`).join('\n') + '\n' + Array.from({ length: 200000 }, (_, i) => `INSERT INTO t0 VALUES (${i}, 'some text ${i}; with semi', ${i});`).join('\n')
  const t0 = Date.now(); const x = ddlToSchema(big); const dt = Date.now() - t0
  check(`3000 tables + 200k INSERTs (${(big.length / 1e6).toFixed(1)} MB) imports in <10s (took ${dt}ms)`, dt < 10000 && x.tables.length === 3000, `${dt}ms tables=${x.tables.length}`)
}
{
  const t0 = Date.now()
  const ins = 'INSERT INTO t VALUES (1, 2);\n'.repeat(1000) + 'x'.repeat(5e6)
  const x = ddlToSchema('CREATE TABLE a (id int);\n' + ins); const dt = Date.now() - t0
  check(`5MB single non-terminated statement fast (took ${dt}ms)`, dt < 5000)
}
{
  // catastrophic regex check on CREATE TABLE
  const t0 = Date.now(); ddlToSchema('CREATE TABLE a (' + 'x int, '.repeat(20000) + ')' + ')'.repeat(1) + ' '.repeat(50000)); const dt = Date.now() - t0
  check(`create-table regex w/ 20k columns fast (took ${dt}ms)`, dt < 5000)
}
done(CLEAN ? 'c_clean.json' : 'c.json')
