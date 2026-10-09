import { describe, it, expect } from 'vitest'
import initSqlJs from 'sql.js'
import {
  parse, serialize, toSQL, toMongoose, toMongoShell, csvToSchema, parseCsv, inferType, ddlToSchema, mongoToSchema, parseMongoExport,
  specToSchema, isSpecRows, parseSpecType, schemaToCsv, tablesToCsvFiles, SAMPLE_SQL, SAMPLE_MONGO_DSL,
} from '../src/index.js'

const roundTrip = (s) => parse(serialize(s))

describe('Thai / Unicode identifiers', () => {
  it('parses unquoted Thai names (vowel and tone marks included)', () => {
    const s = parse('Table ผู้ใช้ {\n  รหัส int [pk]\n  ชื่อ varchar(50) [not null, note: \'ชื่อ-สกุล\']\n}\nTable คำสั่งซื้อ {\n  id int [pk]\n  ผู้ซื้อ int [ref: > ผู้ใช้.รหัส]\n}')
    expect(s.errors).toEqual([])
    expect(s.tables.map((t) => t.name)).toEqual(['ผู้ใช้', 'คำสั่งซื้อ'])
    expect(s.refs[0]).toMatchObject({ from: { table: 'คำสั่งซื้อ', field: 'ผู้ซื้อ' }, to: { table: 'ผู้ใช้', field: 'รหัส' } })
  })

  it('keeps Thai CSV headers and file names', () => {
    const s = csvToSchema('นักเรียน.csv', 'รหัส,ชื่อ-สกุล,city\n1,สมชาย ใจดี,BKK\n2,สมหญิง,CNX\n')
    expect(s.tables[0].name).toBe('นักเรียน')
    expect(s.tables[0].fields.map((f) => f.name)).toEqual(['รหัส', 'ชื่อ_สกุล', 'city'])
  })

  it('keeps Thai sheet names in spec imports and de-duplicates collisions', () => {
    const rows = (extra = []) => [['Field', 'Type'], ['id', 'obj'], ...extra]
    const s = specToSchema([{ name: 'ผู้ใช้งาน', rows: rows() }, { name: 'ลูกค้า', rows: rows([['owner', 'string (ref: ผู้ใช้งาน)']]) }, { name: 'ลูกค้า', rows: rows() }])
    expect(s.tables.map((t) => t.name)).toEqual(['ผู้ใช้งาน', 'ลูกค้า', 'ลูกค้า_2'])
    expect(s.refs).toEqual([{ from: { table: 'ลูกค้า', field: 'owner' }, to: { table: 'ผู้ใช้งาน', field: '_id' }, type: '>' }])
    expect(parse(serialize(s)).errors).toEqual([])
  })
})

describe('serialize <-> parse are inverse', () => {
  const nasty = ["it's", 'say "hi"', 'a]b[c', 'back\\slash', 'line1\nline2', '// not a comment', 'ไทย \'quote\'', "'", '']
  it('survives apostrophes, quotes, brackets, newlines in notes and defaults', () => {
    for (const text of nasty) {
      const s = parse('Table t {\n  id int [pk]\n  c varchar(10) [not null]\n}')
      s.tables[0].fields[1].note = text || null
      s.tables[0].fields[1].default = text
      s.tables[0].fields[1].defaultKind = 'string'
      s.tables[0].note = text || null
      const back = roundTrip(s)
      expect(back.errors, JSON.stringify(text)).toEqual([])
      expect(back.tables[0].fields[1].note, JSON.stringify(text)).toBe(text || null)
      expect(back.tables[0].fields[1].default, JSON.stringify(text)).toBe(text)
      expect(back.tables[0].fields[1].notNull).toBe(true)
      expect(back.tables[0].note).toBe(text || null)
    }
  })

  it('quotes odd identifiers in Ref lines and index lists', () => {
    const src = 'Table "my-table" {\n  "col 1" int [pk]\n  "ชื่อ ผู้ใช้" int\n  indexes {\n    ("col 1", "ชื่อ ผู้ใช้") [unique]\n  }\n}\nRef: "my-table"."ชื่อ ผู้ใช้" > "my-table"."col 1"'
    const a = parse(src)
    expect(a.errors).toEqual([])
    const b = roundTrip(a)
    expect(b.errors).toEqual([])
    expect(b.refs).toEqual(a.refs)
    expect(b.tables[0].indexes).toEqual(a.tables[0].indexes)
  })

  it('reports ref errors on the right line and flags unknown settings / index fields', () => {
    const s = parse('Table a {\n  id int [pk, bogus]\n  indexes {\n    nope\n  }\n}\n\nRef: a.id > zz.id')
    const lines = s.errors.map((e) => `${e.line}:${e.message.split(' ')[0]}`)
    expect(lines).toContain('2:Unknown')
    expect(lines).toContain('4:Index')
    expect(s.errors.find((e) => /unknown table/.test(e.message)).line).toBe(8)
  })

  it('preserves default kinds (expression / string / literal)', () => {
    const s = parse("Table t {\n  a int [default: 0]\n  b varchar(5) [default: '007']\n  c timestamp [default: `now()`]\n  d varchar(5) [default: 'null']\n}")
    const [, ...f] = [null, ...s.tables[0].fields]
    expect(f.map((x) => x.defaultKind)).toEqual(['literal', 'string', 'expr', 'string'])
    expect(roundTrip(s).tables[0].fields.map((x) => [x.default, x.defaultKind])).toEqual([['0', 'literal'], ['007', 'string'], ['now()', 'expr'], ['null', 'string']])
  })
})

describe('SQL generators executed on a real engine (SQLite via sql.js)', () => {
  const run = async (sql) => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run(sql)
    return db
  }

  it('SAMPLE_SQL runs on SQLite (default now() ok) and keeps its foreign key', async () => {
    const db = await run(toSQL(parse(SAMPLE_SQL), 'sqlite'))
    const fks = db.exec('pragma foreign_key_list(posts)')[0]?.values ?? []
    expect(fks.length).toBe(1)
    db.run("insert into users (email) values ('a@b.c')")
    expect(db.exec('select created_at from users')[0].values[0][0]).toBeTruthy()
    expect(() => db.run('insert into posts (user_id, title) values (999, "x")')).toThrow(/FOREIGN KEY/i)
  })

  it('one-to-one gets UNIQUE, string defaults keep leading zeros, expression defaults are not quoted', async () => {
    const s = parse("Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n  a_id int\n  zip varchar(10) [default: '007']\n  flag varchar(5) [default: 'null']\n  at timestamp [default: `now()`]\n}\nRef: b.a_id - a.id")
    const db = await run(toSQL(s, 'sqlite'))
    db.run('insert into a (id) values (1)')
    db.run('insert into b (id, a_id) values (1, 1)')
    expect(() => db.run('insert into b (id, a_id) values (2, 1)')).toThrow(/UNIQUE/i)
    db.run('insert into b (id, a_id) values (3, null)')
    const row = db.exec('select zip, flag from b where id = 1')[0].values[0]
    expect(row).toEqual(['007', 'null'])
  })

  it('postgres output quotes string defaults but not expressions; junction tables use table-level FKs', () => {
    const s = parse("Table a {\n  id uuid [pk, default: `gen_random_uuid()`]\n  zip varchar(10) [default: '007']\n}\nTable b {\n  id int [pk]\n}\nRef: a.zip <> b.id")
    const pg = toSQL(s, 'postgres')
    expect(pg).toContain('default gen_random_uuid()')
    expect(pg).toContain("default '007'")
    expect(pg).toMatch(/foreign key \("a_zip"\) references "a" \("zip"\)/)
    expect(toSQL(s, 'mysql')).toMatch(/foreign key \(`a_zip`\)/)
  })

  it('maps blob / tinyint / enum-ish MySQL types for PostgreSQL', () => {
    const pg = toSQL(parse('Table t {\n  a blob\n  b tinyint\n  c longtext\n  d int unsigned\n}'), 'postgres')
    expect(pg).toContain('"a" bytea')
    expect(pg).toContain('"b" smallint')
    expect(pg).toContain('"c" text')
    expect(pg).toContain('"d" int')
    expect(pg).not.toContain('unsigned')
  })
})

describe('SQL dump import (strings, comments, constraints)', () => {
  const mysqlDump = `
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
-- comment ; with semicolon
CREATE TABLE \`customers\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`email\` varchar(255) NOT NULL DEFAULT 'a--b/*c*/',
  \`status\` enum('new','vip') DEFAULT 'new' COMMENT 'it''s a status',
  \`deleted\` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_email\` (\`email\`),
  KEY \`idx_status\` (\`status\`(10))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO customers VALUES (1,'O\\'Brien -- not a comment; \\'/* x */','vip',0);
CREATE TABLE \`orders\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`customer_id\` int unsigned NOT NULL,
  PRIMARY KEY (\`id\`),
  CONSTRAINT \`fk_c\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB;
`
  it('mysqldump: apostrophes in INSERT values do not swallow later tables', () => {
    const s = ddlToSchema(mysqlDump)
    expect(s.tables.map((t) => t.name)).toEqual(['customers', 'orders'])
    expect(s.refs).toEqual([{ from: { table: 'orders', field: 'customer_id' }, to: { table: 'customers', field: 'id' }, type: '>' }])
    const c = s.tables[0].fields
    expect(c[0]).toMatchObject({ type: 'int', pk: true, increment: true })
    expect(c[1]).toMatchObject({ default: 'a--b/*c*/', notNull: true, unique: true })
    expect(c[2]).toMatchObject({ type: 'varchar(255)' })
    expect(c[2].note).toContain("it's a status")
    expect(c[3].type).toBe('boolean')
    expect(s.tables[0].indexes).toEqual([{ fields: ['status'], unique: false, name: 'idx_status' }])
    expect(parse(serialize(s)).errors).toEqual([])
  })

  const pgDump = `
SET statement_timeout = 0;
CREATE TABLE public."Order Details" (
  id bigserial PRIMARY KEY,
  "order id" integer NOT NULL,
  note character varying(50) DEFAULT 'x'::character varying,
  created timestamp without time zone DEFAULT now() NOT NULL,
  total numeric(10,2) DEFAULT 0,
  CONSTRAINT orders_total_check CHECK ((total >= 0))
);
CREATE TABLE public.orders (id integer NOT NULL);
COPY public.orders (id) FROM stdin;
1
2 -- tab separated ; data with a quote ' here
\\.
INSERT INTO public.orders VALUES (E'it\\'s; here');
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public."Order Details" ADD CONSTRAINT fk FOREIGN KEY ("order id") REFERENCES public.orders(id);
ALTER TABLE ONLY public."Order Details" ADD CONSTRAINT uq UNIQUE ("order id");
CREATE INDEX idx_created ON public."Order Details" USING btree (created DESC, "order id");
`
  it('pg_dump: schema-qualified quoted names, bigserial, CHECK, COPY blocks, ALTER constraints', () => {
    const s = ddlToSchema(pgDump)
    expect(s.tables.map((t) => t.name)).toEqual(['Order Details', 'orders'])
    const d = s.tables[0].fields
    expect(d.map((f) => f.name)).toEqual(['id', 'order id', 'note', 'created', 'total'])
    expect(d[0]).toMatchObject({ type: 'bigint', pk: true, increment: true })
    expect(d[2]).toMatchObject({ type: 'varchar(50)', default: 'x', defaultKind: 'string' })
    expect(d[3]).toMatchObject({ type: 'timestamp', default: 'now()', defaultKind: 'expr', notNull: true })
    expect(d[4]).toMatchObject({ type: 'numeric(10,2)', default: '0', defaultKind: 'literal' })
    expect(d[1].unique).toBe(true)
    expect(s.tables[1].fields[0].pk).toBe(true)
    expect(s.refs).toEqual([{ from: { table: 'Order Details', field: 'order id' }, to: { table: 'orders', field: 'id' }, type: '>' }])
    expect(s.tables[0].indexes).toEqual([{ fields: ['created', 'order id'], unique: false, name: 'idx_created' }])
  })

  it('SQLite: no duplicate refs, implicit REFERENCES target, typeless columns', () => {
    const s = ddlToSchema('CREATE TABLE p (id INTEGER PRIMARY KEY);\nCREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p, loose, FOREIGN KEY (p_id) REFERENCES p(id));')
    expect(s.refs).toEqual([{ from: { table: 'c', field: 'p_id' }, to: { table: 'p', field: 'id' }, type: '>' }])
    expect(s.tables[1].fields.map((f) => f.name)).toEqual(['id', 'p_id', 'loose'])
  })

  it('round trip through postgres DDL keeps tables, refs, pks and serial columns', async () => {
    const a = ddlToSchema(pgDump)
    const b = ddlToSchema(toSQL(a, 'postgres'))
    expect(b.tables.map((t) => t.name)).toEqual(a.tables.map((t) => t.name))
    expect(b.refs).toEqual(a.refs)
    expect(b.tables[0].fields[0]).toMatchObject({ pk: true, increment: true })
  })
})

describe('CSV inference', () => {
  it('mixed int/float columns are numeric, leading zeros stay text, booleans & dates validated', () => {
    expect(inferType(['1', '2.5', '3'])).toBe('double')
    expect(inferType(['007', '123'])).toBe('varchar(255)')
    expect(inferType(['yes', 'No', 'y'])).toBe('boolean')
    expect(inferType(['2020-01-31', '2020-13-45'])).toBe('varchar(255)')
    expect(inferType(['2020-02-30'])).toBe('varchar(255)')
    expect(inferType(['9999999999'])).toBe('bigint')
    expect(inferType(['', ''])).toBe('varchar(255)')
  })

  it('handles 300k text rows without a stack overflow', () => {
    const vals = Array.from({ length: 300000 }, (_, i) => `row-${i}`)
    expect(inferType(vals)).toBe('varchar(255)')
  })

  it('keeps blank rows in single-column files and drops only the trailing newline row', () => {
    expect(parseCsv('a\n\nb\n')).toEqual([['a'], [''], ['b']])
    expect(parseCsv('a,b\n1,2\n\n3,4\n')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })

  it('exports: formula injection neutralised, file names sanitised and unique', () => {
    const s = parse("Table t {\n  a int [note: '=HYPERLINK(1)']\n}\nTable T {\n  a int\n}\nTable \"x/y:z\" {\n  a int\n}")
    expect(schemaToCsv(s)).toContain("'=HYPERLINK(1)")
    expect(tablesToCsvFiles(s).map((f) => f.name)).toEqual(['t.csv', 'T_2.csv', 'x_y_z.csv'])
  })
})

describe('spec sheets: types, extra columns, header detection', () => {
  const t = (x) => parseSpecType(x)
  it('parses array and ref clauses', () => {
    expect(t('array(string) (ref: School)')).toMatchObject({ type: 'objectid[]', ref: 'School', isArray: true })
    expect(t('array (ref: School)')).toMatchObject({ type: 'objectid[]', ref: 'School' })
    expect(t('string[]').type).toBe('string[]')
    expect(t('array<string>').type).toBe('string[]')
    expect(t('array of int').type).toBe('int[]')
    expect(t('array(obj)').type).toBe('object[]')
    expect(t('array').type).toBe('json[]')
    expect(t('map').type).toBe('object')
    expect(t('num (0,1)')).toMatchObject({ type: 'int', note: '0,1' })
    expect(t('string (ref: SCHOOL)')).toMatchObject({ type: 'string', ref: 'SCHOOL' })
  })

  it('uses Required / Description / Default columns and finds a header below a title row', () => {
    const rows = [
      ['My collection'],
      [],
      ['Field', 'Type', 'Required', 'Description', 'Default'],
      ['id', 'obj', '', '', ''],
      ['name', 'string', 'yes', 'Display name', ''],
      ['active', 'bool', '', '', 'true'],
    ]
    expect(isSpecRows(rows)).toBe(true)
    const s = specToSchema([{ name: 'Things', rows }])
    const f = s.tables[0].fields
    expect(f.map((x) => x.name)).toEqual(['_id', 'name', 'active'])
    expect(f[1]).toMatchObject({ notNull: true, note: 'Display name' })
    expect(f[2]).toMatchObject({ default: 'true', defaultKind: 'literal' })
  })

  it('does not create a duplicate _id when a sheet has both id and _id', () => {
    const s = specToSchema([{ name: 'X', rows: [['Field', 'Type'], ['id', 'obj'], ['_id', 'objectid']] }])
    expect(s.tables[0].fields.filter((f) => f.name === '_id')).toHaveLength(1)
    expect(parse(serialize(s)).errors).toEqual([])
  })
})

describe('mongoexport inference', () => {
  it('Extended JSON numbers/dates/binary, plain strings stay strings, single doc with array field is a doc', () => {
    const docs = parseMongoExport(
      JSON.stringify([
        { _id: { $oid: '507f1f77bcf86cd799439011' }, big: { $numberLong: '9007199254740993' }, dec: { $numberDecimal: '12.50' }, bin: { $binary: { base64: 'AA==', subType: '00' } }, at: { $date: '2020-01-01T00:00:00Z' }, text: '2020-01-02', hex: '507f1f77bcf86cd799439011', n: 5000000000 },
      ]),
      'c',
    )
    const f = Object.fromEntries(mongoToSchema(docs).tables[0].fields.map((x) => [x.name, x.type]))
    expect(f).toMatchObject({ _id: 'objectid', big: 'long', dec: 'decimal', bin: 'buffer', at: 'date', text: 'string', hex: 'string', n: 'long' })
    expect(Object.keys(parseMongoExport('{"tags":["a","b"]}', 'doc'))).toEqual(['doc'])
    expect(Object.keys(parseMongoExport('{"users":[{"a":1}],"orders":[{"b":2}]}', 'x'))).toEqual(['users', 'orders'])
  })

  it('Thai collection names, pretty-printed documents and a readable error with a line number', () => {
    expect(Object.keys(parseMongoExport('[{"a":1}]', 'ผู้ใช้'))).toEqual(['ผู้ใช้'])
    expect(Object.values(parseMongoExport('{\n "a": 1\n}\n{\n "a": 2\n}', 'p'))[0]).toHaveLength(2)
    expect(() => parseMongoExport('{"a":1}\n{"b":\n', 'x')).toThrow(/Line 2|Invalid JSON/)
  })

  it('mixed int and double is double, int and long is long', () => {
    const s = mongoToSchema({ c: [{ a: 1, b: 1 }, { a: 1.5, b: 5000000000 }] })
    const f = Object.fromEntries(s.tables[0].fields.map((x) => [x.name, x.type]))
    expect(f).toMatchObject({ a: 'double', b: 'long' })
  })
})

describe('Mongo generators: valid files and tolerant validators', () => {
  it('toMongoose output has unique, valid identifiers for hostile table names', () => {
    const s = parse('Table user {\n  a int\n}\nTable User {\n  a int\n}\nTable "a-b" {\n  a int\n}\nTable "a b" {\n  a int\n}\nTable schema {\n  a int\n}\nTable number {\n  a int\n}\nTable "2024data" {\n  a int\n}\nTable "it\'s" {\n  a int\n}')
    const js = toMongoose(s, { style: 'cjs' })
    const ids = [...js.matchAll(/^const (\w+) = mongoose\.model/gm)].map((m) => m[1])
    expect(new Set(ids).size).toBe(8)
    const fakeMongoose = { Schema: Object.assign(class { index() {} }, { Types: { ObjectId: {}, Mixed: {}, Decimal128: {} } }), model: () => ({}) }
    expect(() => new Function('require', 'module', js)(() => fakeMongoose, { exports: {} })).not.toThrow()
  })

  it('validators accept ints in double fields, nulls in optional fields; unique optional fields are sparse', () => {
    const s = parse('Table p {\n  _id objectid [pk]\n  price double [not null]\n  nick string [unique]\n  big long\n  age int\n}')
    const sh = toMongoShell(s)
    expect(sh).toContain('"number"')
    expect(sh).toMatch(/"nick": \{\s*"bsonType": \[\s*"string",\s*"null"/)
    expect(sh).toContain('db.p.createIndex({ nick: 1 }, { unique: true, sparse: true })')
    expect(toMongoose(s)).toContain('unique: true, sparse: true')
    expect(toMongoose(parse('Table p {\n  d decimal\n}'))).toContain('Schema.Types.Decimal128')
  })

  it('field-level unique plus the same single-field index does not create a conflicting duplicate', () => {
    const s = parse('Table p {\n  email string [unique, not null]\n  indexes {\n    email\n  }\n}')
    const sh = toMongoShell(s)
    expect(sh.match(/createIndex/g)).toHaveLength(1)
  })

  it('index names are passed through; a table named like a type does not hijack fields', () => {
    const s = parse('Table p {\n  a string\n  b string\n  indexes {\n    (a, b) [name: \'my_idx\']\n  }\n}\nTable string {\n  x int\n}')
    expect(toMongoShell(s)).toContain('name: "my_idx"')
    expect(toMongoose(s)).toContain('name: "my_idx"')
    expect(s.tables[0].fields.every((f) => f.type === 'string')).toBe(true)
    expect(toMongoose(s)).toContain('a: { type: String }') // the table named string is not embedded into p.a
  })

  it('reserved Mongoose property names are flagged', () => {
    expect(toMongoose(parse('Table p {\n  schema string\n}'))).toContain('WARNING')
  })

  it('SAMPLE_MONGO still produces embedded sub-documents', () => {
    expect(toMongoose(parse(SAMPLE_MONGO_DSL))).toContain('city: { type: String }')
  })
})

describe('fuzz: serialize -> parse is the identity', () => {
  // small deterministic PRNG so failures are reproducible
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const WORDS = ['id', 'name', 'pk', 'not null', 'Table', 'ref', 'ผู้ใช้', 'ชื่อ สกุล', 'a-b', 'my table', 'x.y', "it's", 'say "hi"', 'a]b', 'tab\there', 'é', '日本語', 'int', '_x', '$y', '1abc', 'a,b', '// c']
  const TEXT = ['', 'plain', "it's", 'say "hi"', 'a]b[c', 'back\slash', 'line1\nline2', '// not a comment', 'ไทย \'quote\'', ' lead', 'trail ', 'a, b, c', '`tick`', '=cmd']
  const TYPES = ['int', 'varchar(255)', 'string[]', 'decimal(10,2)', 'objectid', 'object[]', 'text']

  it('300 random schemas survive a round trip (names, notes, defaults, refs, indexes)', () => {
    let failures = 0
    let example = null
    for (let n = 0; n < 300; n++) {
      const tables = []
      const tcount = 1 + Math.floor(rnd() * 3)
      for (let i = 0; i < tcount; i++) {
        let tname = pick(WORDS)
        while (tables.some((t) => t.name === tname)) tname += '_' + i
        const fields = []
        for (let j = 0; j < 1 + Math.floor(rnd() * 4); j++) {
          let fname = pick(WORDS)
          while (fields.some((f) => f.name === fname)) fname += '_' + j
          const kind = pick([null, 'literal', 'string', 'expr'])
          const f = { name: fname, type: pick(TYPES), pk: rnd() < 0.2, unique: rnd() < 0.2, notNull: false, increment: false, default: null, defaultKind: null, note: rnd() < 0.4 ? pick(TEXT) || null : null, enum: null, refModel: null, opts: null }
          f.notNull = f.pk || rnd() < 0.3
          if (kind) {
            f.defaultKind = kind
            f.default = kind === 'literal' ? pick(['0', 'true', '-1.5']) : kind === 'expr' ? pick(['now()', 'gen_random_uuid()']) : pick(TEXT)
          }
          fields.push(f)
        }
        const indexes = rnd() < 0.5 ? [{ fields: [fields[0].name], unique: rnd() < 0.5, name: rnd() < 0.5 ? pick(TEXT) || null : null }] : []
        tables.push({ name: tname, note: rnd() < 0.4 ? pick(TEXT) || null : null, embedded: rnd() < 0.2, fields, indexes })
      }
      const refs = []
      if (tables.length > 1 && rnd() < 0.7) refs.push({ from: { table: tables[0].name, field: tables[0].fields[0].name }, to: { table: tables[1].name, field: tables[1].fields[0].name }, type: pick(['>', '<', '-', '<>']) })
      const schema = { tables, refs, errors: [] }
      const text = serialize(schema)
      const back = parse(text)
      const same = JSON.stringify(back.tables) === JSON.stringify(tables) && JSON.stringify(back.refs) === JSON.stringify(refs)
      if (back.errors.length || !same) {
        failures++
        example ??= { text, errors: back.errors, back: JSON.stringify(back.tables), want: JSON.stringify(tables) }
      }
    }
    expect(example, example && JSON.stringify({ text: example.text, errors: example.errors })).toBeNull()
    expect(failures).toBe(0)
  })
})

describe('misc fixes', () => {
  it('/* block comments */ are ignored and keep line numbers', () => {
    const s = parse('/* header\n   spans lines */\nTable a {\n  id int /* inline */ [pk]\n  bad\n}')
    expect(s.tables[0].fields.map((f) => f.name)).toEqual(['id'])
    expect(s.errors.map((e) => e.line)).toEqual([5])
  })

  it('fields that are arrays in some documents and scalars in others are plain json', () => {
    const s = mongoToSchema({ c: [{ v: 1 }, { v: [1, 2] }, { w: [1] }, { w: [2, 3] }] })
    const f = Object.fromEntries(s.tables[0].fields.map((x) => [x.name, x.type]))
    expect(f).toMatchObject({ v: 'json', w: 'int[]' })
  })

  it('SQL: nvarchar keeps its length, identical indexes are created once, MySQL auto_increment gets a key', () => {
    const s = parse('Table t {\n  n nvarchar(50)\n  seq int [increment]\n  indexes {\n    n\n    n\n  }\n}')
    const pg = toSQL(s, 'postgres')
    expect(pg).toContain('"n" varchar(50)')
    expect(pg.match(/create index/g)).toHaveLength(1)
    expect(toSQL(s, 'mysql')).toContain('key (`seq`)')
  })
})

describe('composite (multi-column) foreign keys', () => {
  const dsl = `Table orders {
  region varchar(10) [pk]
  number int [pk]
}
Table order_lines {
  id int [pk]
  o_region varchar(10)
  o_number int
}
Ref: order_lines.(o_region, o_number) > orders.(region, number)`

  it('parses, serialises and re-parses the Ref line', () => {
    const s = parse(dsl)
    expect(s.errors).toEqual([])
    expect(s.refs[0]).toEqual({
      from: { table: 'order_lines', field: 'o_region', fields: ['o_region', 'o_number'] },
      to: { table: 'orders', field: 'region', fields: ['region', 'number'] },
      type: '>',
    })
    const text = serialize(s)
    expect(text).toContain('Ref: order_lines.(o_region, o_number) > orders.(region, number)')
    expect(parse(text).refs).toEqual(s.refs)
  })

  it('quoted / Thai column names work inside the list', () => {
    const s = parse('Table "my t" {\n  "a b" int\n  ชื่อ int\n}\nTable p {\n  x int\n  y int\n}\nRef: "my t".("a b", ชื่อ) > p.(x, y)')
    expect(s.errors).toEqual([])
    expect(parse(serialize(s)).refs).toEqual(s.refs)
  })

  it('reports mismatched column counts and unknown columns on the Ref line', () => {
    const a = parse(dsl.replace('(region, number)', '(region)'))
    expect(a.errors.map((e) => e.message).join()).toMatch(/same number of columns/)
    const b = parse(dsl.replace('(o_region, o_number)', '(o_region, nope)'))
    const e = b.errors.find((x) => /unknown field/.test(x.message))
    expect(e.message).toContain('nope')
    expect(e.line).toBe(10)
  })

  it('imports composite FKs from CREATE TABLE, ALTER TABLE and implicit REFERENCES', () => {
    const sql = `
CREATE TABLE orders (region varchar(10), number int, PRIMARY KEY (region, number));
CREATE TABLE a (id int PRIMARY KEY, r varchar(10), n int, FOREIGN KEY (r, n) REFERENCES orders (region, number));
CREATE TABLE b (id int PRIMARY KEY, r varchar(10), n int, CONSTRAINT fk_b FOREIGN KEY (r, n) REFERENCES orders);
CREATE TABLE c (id int PRIMARY KEY, r varchar(10), n int);
ALTER TABLE ONLY c ADD CONSTRAINT fk_c FOREIGN KEY (r, n) REFERENCES orders(region, number) ON DELETE CASCADE;
ALTER TABLE ONLY c ADD CONSTRAINT fk_c_again FOREIGN KEY (r, n) REFERENCES orders(region, number);
`
    const s = ddlToSchema(sql)
    const want = (t) => ({ from: { table: t, field: 'r', fields: ['r', 'n'] }, to: { table: 'orders', field: 'region', fields: ['region', 'number'] }, type: '>' })
    expect([...s.refs].sort((x, y) => x.from.table.localeCompare(y.from.table))).toEqual([want('a'), want('b'), want('c')]) // duplicate ALTER collapsed
    expect(parse(serialize(s)).errors).toEqual([])
    expect(parse(serialize(s)).refs).toEqual(s.refs)
  })

  it('single-column foreign keys are unchanged (no `fields` property)', () => {
    const s = ddlToSchema('CREATE TABLE p (id int PRIMARY KEY);\nCREATE TABLE c (id int PRIMARY KEY, p_id int, FOREIGN KEY (p_id) REFERENCES p(id));')
    expect(s.refs).toEqual([{ from: { table: 'c', field: 'p_id' }, to: { table: 'p', field: 'id' }, type: '>' }])
  })

  it('generates multi-column constraints for every dialect and SQLite enforces them', async () => {
    const s = parse(dsl)
    expect(toSQL(s, 'postgres')).toMatch(/foreign key \("o_region", "o_number"\) references "orders" \("region", "number"\)/)
    expect(toSQL(s, 'mysql')).toMatch(/foreign key \(`o_region`, `o_number`\) references `orders` \(`region`, `number`\)/)
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run(toSQL(s, 'sqlite'))
    expect(db.exec('pragma foreign_key_list(order_lines)')[0].values).toHaveLength(2) // one row per column of the key
    db.run("insert into orders values ('EU', 1)")
    db.run("insert into order_lines values (1, 'EU', 1)")
    expect(() => db.run("insert into order_lines values (2, 'EU', 2)")).toThrow(/FOREIGN KEY/i)
    expect(() => db.run("insert into order_lines values (3, 'US', 1)")).toThrow(/FOREIGN KEY/i)
  })

  it('one-to-one composite relation gets a composite UNIQUE', () => {
    const s = parse(dsl.replace('>', '-'))
    expect(toSQL(s, 'postgres')).toMatch(/unique \("o_region", "o_number"\)/)
  })

  it('round trip: composite FK -> PostgreSQL DDL -> import gives the same relation', () => {
    const a = parse(dsl)
    const b = ddlToSchema(toSQL(a, 'postgres'))
    expect(b.refs).toEqual(a.refs)
  })

  it('Mongo output and CSV export tolerate composite refs', () => {
    const s = parse(dsl)
    expect(() => toMongoose(s)).not.toThrow()
    expect(schemaToCsv(s)).toContain('orders.region+number')
  })
})

describe('CSV imported "as MongoDB"', () => {
  it('maps SQL type names to MongoDB type names and turns a pk called id into _id', async () => {
    const { sqlTypeToMongo, tablesToMongo } = await import('../src/index.js')
    expect(['varchar(255)', 'int', 'bigint', 'double', 'boolean', 'date', 'timestamp', 'text', 'int[]', 'weird'].map(sqlTypeToMongo)).toEqual([
      'string', 'int', 'long', 'double', 'bool', 'date', 'date', 'string', 'int[]', 'weird',
    ])
    const csv = csvToSchema('people.csv', 'id,name,age,joined,active\n1,Ann,31,2020-01-02,true\n2,Bo,22,2021-05-06,false\n')
    const [t] = tablesToMongo(csv.tables)
    expect(t.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['_id:int', 'name:string', 'age:int', 'joined:date', 'active:bool'])
    expect(t.fields[0].pk).toBe(true)
    expect(csv.tables[0].fields[0].name).toBe('id') // the SQL version is untouched
    expect(parse(serialize({ tables: [t], refs: [], errors: [] })).errors).toEqual([])
  })
})
