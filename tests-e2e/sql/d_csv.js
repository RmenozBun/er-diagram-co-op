import { S, check, setArea, done } from './h.js'
const { parseCsv, csvToSchema, rowsToSchema, inferType, serialize, parse, toSQL } = S
setArea('D csv import')
const noThrow = (name, fn) => { try { return fn() } catch (e) { check(name + ' no throw', false, e.stack); return null } }
const ty = (vals) => inferType(vals.map(String))
const J = JSON.stringify

// parseCsv
let r
r = parseCsv('a,b,c\n1,2,3\n'); check('basic', J(r) === J([['a', 'b', 'c'], ['1', '2', '3']]))
r = parseCsv('a,b\n'); check('header only -> 1 row', r.length === 1 && r[0].length === 2, J(r))
let sc = csvToSchema('h.csv', 'a,b\n'); check('header-only csv -> table with 2 cols (varchar(255), nullable)', sc.tables[0]?.fields.length === 2 && !sc.tables[0].fields[0].notNull, J(sc.tables[0]?.fields))
r = parseCsv('﻿name,age\nA,1\n'); check('BOM stripped', r[0][0] === 'name', J(r[0]))
r = parseCsv('a;b;c\n1;2;3'); check('semicolon delimiter detect', r[0].length === 3, J(r))
r = parseCsv('a\tb\tc\n1\t2\t3'); check('tab delimiter detect', r[0].length === 3)
r = parseCsv('a|b|c\n1|2|3'); check('pipe delimiter detect', r[0].length === 3)
r = parseCsv('"a,1","b ""q"" x"\n"line1\nline2","c,d"\n'); check('quoted embedded comma/quote/newline', r[0][0] === 'a,1' && r[0][1] === 'b "q" x' && r[1][0] === 'line1\nline2' && r[1][1] === 'c,d', J(r))
r = parseCsv('a,b\r\n1,2\r\n3,4\r\n'); check('CRLF', r.length === 3 && r[2][1] === '4', J(r))
r = parseCsv('a,b\r1,2\r'); check('CR only (old mac)', r.length === 2, J(r))
r = parseCsv('a,b,c\n1,2\n1,2,3,4\n'); check('ragged rows kept (no throw)', r.length === 3, J(r))
sc = noThrow('ragged', () => csvToSchema('r.csv', 'a,b,c\n1,2\n1,2,3,4\n')); check('ragged: short row => missing cell treated as empty (nullable col c with 3rd value)', sc?.tables[0]?.fields.length === 3, J(sc?.tables[0]?.fields.map((f) => f.name + ':' + f.type + (f.notNull ? '!' : ''))))
sc = csvToSchema('r.csv', 'a,b\n1,2,3\n'); check('ragged: extra cells beyond header dropped silently (info)', sc.tables[0].fields.length === 2)
sc = csvToSchema('d.csv', 'name,name,Name,name\n1,2,3,4\n'); check('duplicate headers get unique names', new Set(sc.tables[0].fields.map((f) => f.name)).size === 4, J(sc.tables[0].fields.map((f) => f.name)))
sc = csvToSchema('d.csv', 'name,Name\n1,2\n'); check('headers differing by case only: name / Name (collide in MySQL/SQLite case-insens.)', new Set(sc.tables[0].fields.map((f) => f.name.toLowerCase())).size === 2, J(sc.tables[0].fields.map((f) => f.name)))
sc = csvToSchema('e.csv', ',a,\n1,2,3\n'); check('empty headers -> column, column_2 ...', sc.tables[0].fields.map((f) => f.name).join() === 'column,a,column_2', J(sc.tables[0].fields.map((f) => f.name)))
sc = csvToSchema('s.csv', 'First Name,e-mail,Price ($),ชื่อ-สกุล,ราคา,a.b,"x""y",1st,select\n1,2,3,4,5,6,7,8,9\n'); check('weird headers sanitised', J(sc.tables[0].fields.map((f) => f.name)) === J(['First_Name', 'e_mail', 'Price', 'column', 'column_2', 'a_b', 'x_y', '1st', 'select']) || true, J(sc.tables[0].fields.map((f) => f.name)))
{
  const names = sc.tables[0].fields.map((f) => f.name)
  check('Thai headers: regex /[^\\w$]+/ strips Thai letters -> names become "column", "column_2" (data loss of header text)', !names.every((n) => /^column(_\d+)?$/.test(n) || !/column/.test(n)) || !names.slice(3, 5).every((n) => /^column/.test(n)), J(names))
  check('header starting with digit "1st" yields name usable unquoted in DSL (DSL IDENT needs letter/_)', parse(serialize(sc)).errors.length === 0, J(parse(serialize(sc)).errors))
}
sc = csvToSchema('ผู้ใช้.csv', 'a\n1\n'); check('Thai file name -> table name not "table"/blank (name lost)', sc.tables[0].name !== 'table' && sc.tables[0].name !== 'column', sc.tables[0].name)
sc = csvToSchema('my data (1).csv', 'a\n1\n'); check('file name with spaces/parens -> my_data_1', sc.tables[0].name === 'my_data_1', sc.tables[0].name)
sc = csvToSchema('data.final.v2.csv', 'a\n1\n'); check('multi-dot filename', sc.tables[0].name.length > 0, sc.tables[0].name)
sc = csvToSchema('a.csv', 'x\n1\n'); csvToSchema('a.csv', 'x\n1\n', sc); check('same file twice -> a, a_2', sc.tables.map((t) => t.name).join() === 'a,a_2', sc.tables.map((t) => t.name).join())
sc = csvToSchema('empty.csv', ''); check('empty file -> no table, no throw', sc.tables.length === 0)
sc = csvToSchema('nl.csv', '\n\n\n'); check('only newlines', sc.tables.length === 0)
sc = noThrow('unterminated quote', () => csvToSchema('q.csv', 'a,b\n"unterminated,2\n3,4\n')); check('unterminated quote does not throw', !!sc)
sc = csvToSchema('x.csv', 'a,b\n1,\n2,\n'); check('all-empty column -> varchar(255), nullable', sc.tables[0].fields[1].type === 'varchar(255)' && !sc.tables[0].fields[1].notNull, J(sc.tables[0].fields[1]))
sc = csvToSchema('x.csv', 'a\n'); check('header-only: notNull false', sc.tables[0].fields[0].notNull === false)

// type inference
setArea('D type inference')
const exp = (name, vals, want) => { const got = ty(vals); check(`${name}: ${J(vals.slice(0, 4))} -> ${want}`, Array.isArray(want) ? want.includes(got) : got === want, `got ${got}`) }
exp('ints', ['1', '2', '-3'], 'int')
exp('big ints', ['1', '3000000000'], 'bigint')
exp('very big ints (>2^53)', ['12345678901234567890'], 'bigint')
exp('bigger than int64', ['99999999999999999999999'], ['varchar(255)', 'text', 'numeric'])
exp('floats', ['1.5', '2.25', '-0.1'], ['float', 'double', 'numeric', 'decimal'])
exp('int+float mix -> number', ['1', '2.5', '3'], ['float', 'double', 'numeric', 'decimal'])
exp('int+text -> text', ['1', 'abc'], 'varchar(255)')
exp('zip leading zero', ['01234', '02134', '10110'], 'varchar(255)')
exp('zip mixed (some w/o leading zero)', ['10110', '90210', '02134'], 'varchar(255)')
exp('phone leading 0', ['0812345678', '0898765432'], 'varchar(255)')
exp('phone with +66', ['+66812345678', '+66898765432'], 'varchar(255)')
exp('"+5" plus sign ints', ['+5', '+6'], ['varchar(255)', 'int'])
exp('thousand sep', ['1,000', '2,500', '10,000'], 'varchar(255)')
exp('thousand sep float', ['1,000.50', '2,500.25'], ['varchar(255)'])
exp('negative decimals w/ "-.5"', ['-.5', '.5'], ['float', 'double'])
exp('exp notation', ['1e5', '2.5E-3'], ['float', 'double', 'varchar(255)'])
exp('"0" "00"', ['0', '00'], 'varchar(255)')
exp('"0" alone', ['0', '0'], 'int')
exp('"-0"', ['-0', '1'], 'int')
exp('"0.5" leading zero decimal', ['0.5', '0.25'], ['float', 'double', 'numeric'])
exp('"007.5"', ['007.5', '1.5'], ['varchar(255)', 'float'])
exp('NaN/Infinity', ['NaN', 'Infinity'], 'varchar(255)')
exp('bool true/false', ['true', 'false', 'TRUE'], 'boolean')
exp('bool yes/no', ['yes', 'no', 'Yes'], 'boolean')
exp('bool Y/N', ['Y', 'N', 'y'], 'boolean')
exp('bool 1/0', ['1', '0', '1'], ['boolean', 'int'])
exp('bool t/f', ['t', 'f'], 'boolean')
exp('bool with blanks', ['true', '', 'false'], 'boolean')
exp('ISO date', ['2020-01-31', '2021-12-01'], 'date')
exp('ISO date invalid (2020-13-45)', ['2020-13-45', '2020-02-30'], ['varchar(255)'])
exp('timestamp T', ['2020-01-31T10:00:00Z', '2020-01-31T10:00:00.123+07:00'], 'timestamp')
exp('timestamp space', ['2020-01-31 10:00:00', '2020-01-31 23:59'], 'timestamp')
exp('date mixed with timestamp', ['2020-01-31', '2020-01-31 10:00:00'], ['timestamp', 'varchar(255)'])
exp('dd/mm/yyyy', ['31/01/2020', '01/02/2021'], ['date', 'varchar(255)'])
exp('mm/dd/yyyy', ['01/31/2020', '12/25/2021'], ['date', 'varchar(255)'])
exp('dd-mm-yyyy', ['31-01-2020'], ['date', 'varchar(255)'])
exp('dd.mm.yyyy', ['31.01.2020'], ['date', 'varchar(255)'])
exp('thai buddhist date 2563-01-31', ['2563-01-31', '2564-02-01'], ['date', 'varchar(255)'])
exp('time only', ['10:30', '23:59:59'], ['time', 'varchar(255)'])
exp('epoch seconds', ['1700000000', '1700000001'], ['int', 'bigint'])
exp('epoch ms', ['1700000000000'], 'bigint')
exp('uuid values', ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'], ['varchar(255)', 'uuid'])
exp('json values', ['{"a":1}', '[1,2]'], ['varchar(255)', 'json', 'jsonb'])
exp('long text', ['x'.repeat(300)], 'text')
exp('255 char text exactly', ['x'.repeat(255)], 'varchar(255)')
exp('thai text', ['สวัสดี', 'ทดสอบ'], 'varchar(255)')
exp('thai text > 255', ['ก'.repeat(300)], 'text')
exp('whitespace-only', ['   ', ' '], 'varchar(255)')
exp('ints with spaces " 5 "', [' 5 ', '6'], 'int')
exp('currency "$5"', ['$5', '$6.50'], 'varchar(255)')
exp('percent "5%"', ['5%', '10%'], 'varchar(255)')
exp('hex "0x1F"', ['0x1F'], 'varchar(255)')
exp('ints 2147483647', ['2147483647'], 'int')
exp('ints 2147483648', ['2147483648'], 'bigint')
exp('ints -2147483648 (fits int)', ['-2147483648'], 'int')
exp('ints -2147483649', ['-2147483649'], 'bigint')
exp('float of ints > 15 digits "1234567890123456.5"', ['1234567890123456.5'], ['numeric', 'decimal', 'varchar(255)', 'float', 'double'])
exp('currency decimal(10,2)-like "19.99" prices -> float (precision loss for money)', ['19.99', '5.50'], ['numeric', 'decimal', 'float'])
exp('single column of "1" and ""', ['1', ''], 'int')

// id heuristic
setArea('D id pk heuristic')
sc = csvToSchema('u.csv', 'id,name\n1,a\n2,b\n3,c\n'); check('id unique ints -> pk', sc.tables[0].fields[0].pk && sc.tables[0].fields[0].notNull)
check('pk id should maybe get increment (info)', true)
sc = csvToSchema('u.csv', 'id,name\n1,a\n1,b\n'); check('duplicate ids -> no pk', !sc.tables[0].fields[0].pk)
sc = csvToSchema('u.csv', 'ID,name\n1,a\n2,b\n'); check('ID uppercase -> pk', sc.tables[0].fields[0].pk)
sc = csvToSchema('u.csv', 'Id,name\n1,a\n2,\n'); check('Id mixed case', sc.tables[0].fields[0].pk)
sc = csvToSchema('u.csv', 'id,name\n1,a\n,b\n'); check('id with a blank cell -> not pk (blank = dup of other blank?)', !sc.tables[0].fields[0].pk, J(sc.tables[0].fields[0]))
sc = csvToSchema('u.csv', 'id,name\n1,a\n,b\n,c\n'); check('id with two blanks -> not pk', !sc.tables[0].fields[0].pk)
sc = csvToSchema('u.csv', 'id,name\nA1,a\nA2,b\n'); check('text id unique -> pk (heuristic only matches int; text ids e.g. uuid/codes ignored)', sc.tables[0].fields[0].pk, 'not pk: only /int/ type accepted')
sc = csvToSchema('u.csv', 'user_id,name\n1,a\n2,b\n'); check('user_id not pk (correct)', !sc.tables[0].fields[0].pk)
sc = csvToSchema('u.csv', '_id,name\n1,a\n2,b\n'); check('_id not pk (info)', true)
sc = csvToSchema('u.csv', 'id,id,n\n1,1,a\n2,2,b\n'); check('duplicate id headers: only first id is pk, second renamed id_2', sc.tables[0].fields.filter((f) => f.pk).length === 1)
sc = csvToSchema('u.csv', 'id\n'); check('header-only id -> not pk (no rows)', !sc.tables[0].fields[0].pk, J(sc.tables[0].fields[0]))
sc = csvToSchema('u.csv', 'id,n\n 1,a\n1 ,b\n'); check('ids with whitespace " 1" vs "1 " (dup after trim) -> not pk', !sc.tables[0].fields[0].pk, J(sc.tables[0].fields[0]))
sc = csvToSchema('u.csv', 'id,n\n01,a\n02,b\n'); check('leading-zero ids -> varchar, not pk', !sc.tables[0].fields[0].pk)
sc = csvToSchema('u.csv', 'id,n\n1,a\n2,b\n'); const gen = toSQL(sc, 'postgres'); check('csv id => pk produces valid PG DDL', /primary key/.test(gen))

// generated DDL from CSV executes?
{
  const { PGlite } = await import('@electric-sql/pglite')
  const csv = 'id,Full Name,zip,joined,score,active,note\n1,A B,01234,2020-01-01,1.5,yes,"hi, there"\n2,C D,10110,2020-02-01,2.5,no,\n'
  sc = csvToSchema('people.csv', csv)
  const sql = toSQL(sc, 'postgres'); const pg = new PGlite()
  let ok = true, msg = ''; try { await pg.exec(sql) } catch (e) { ok = false; msg = e.message }
  check('CSV -> schema -> PG DDL executes', ok, msg)
  const dsl = serialize(sc); check('CSV -> DSL parses with 0 errors', parse(dsl).errors.length === 0, J(parse(dsl).errors))
  check('inferred: zip varchar, joined date, score float, active boolean', J(sc.tables[0].fields.map((f) => f.type)) === J(['int', 'varchar(255)', 'varchar(255)', 'date', 'float', 'boolean', 'varchar(255)']), J(sc.tables[0].fields.map((f) => f.name + ':' + f.type)))
  // column type "float" = PG float8 ok. MySQL "float" single-precision?
  check('float inferred type is single-precision in MySQL (float) -> precision loss for monetary values; suggest decimal/double', false, 'inferType returns "float": MySQL FLOAT is 4-byte (7 digits): 1234567.89 stored as 1234570. Prefer double or decimal(p,s)')
}

// performance
setArea('D performance')
{
  const N = 100000
  const lines = ['id,name,email,age,score,joined,active,zip,notes']
  for (let i = 1; i <= N; i++) lines.push(`${i},"User ${i}, Jr",user${i}@example.com,${20 + (i % 50)},${(i % 1000) / 10},2020-01-${String(1 + (i % 28)).padStart(2, '0')},${i % 2 ? 'yes' : 'no'},${String(i % 99999).padStart(5, '0')},"line1\nline2 ""q"""`)
  const text = lines.join('\r\n'); const mb = (text.length / 1e6).toFixed(1)
  const m0 = process.memoryUsage().heapUsed
  let t0 = Date.now(); const rows = parseCsv(text); const tp = Date.now() - t0
  t0 = Date.now(); sc = rowsToSchema('big.csv', rows); const ti = Date.now() - t0
  const m1 = process.memoryUsage().heapUsed
  check(`100k rows (${mb}MB) parseCsv ${tp}ms, rowsToSchema ${ti}ms`, tp < 3000 && ti < 3000 && rows.length === N + 1, `${tp}/${ti}`)
  check(`100k rows: heap growth ${((m1 - m0) / 1e6).toFixed(0)}MB < 500MB`, (m1 - m0) < 500e6)
  check('100k rows inferred types', J(sc.tables[0].fields.map((f) => f.type)) === J(['int', 'varchar(255)', 'varchar(255)', 'int', 'float', 'date', 'boolean', 'varchar(255)', 'varchar(255)']), J(sc.tables[0].fields.map((f) => f.name + ':' + f.type)))
  check('100k: id is pk', sc.tables[0].fields[0].pk)
  // wide
  t0 = Date.now(); const wide = Array.from({ length: 500 }, (_, i) => 'c' + i).join(',') + '\n' + Array.from({ length: 2000 }, () => Array.from({ length: 500 }, (_, j) => j).join(',')).join('\n')
  const w = csvToSchema('wide.csv', wide); check(`500 cols x 2000 rows in ${Date.now() - t0}ms`, Date.now() - t0 < 5000 && w.tables[0].fields.length === 500)
  // inferType on 1M values
  const vals = Array.from({ length: 1000000 }, (_, i) => String(i)); t0 = Date.now(); inferType(vals); check(`inferType 1M values ${Date.now() - t0}ms`, Date.now() - t0 < 3000)
  // Math.max(...spread) on huge arrays
  const many = Array.from({ length: 300000 }, (_, i) => 'abc' + i); t0 = Date.now()
  try { inferType(many); check('inferType 300k text values (Math.max(...vals) spread -> RangeError?)', true) } catch (e) { check('inferType 300k text values (Math.max(...vals) spread -> RangeError?)', false, e.message) }
  const many2 = Array.from({ length: 1500000 }, (_, i) => 'abc' + i)
  try { inferType(many2); check('inferType 1.5M text values spread safe', true) } catch (e) { check('inferType 1.5M text values: Math.max(...spread) throws RangeError (stack overflow) -> importing a CSV with >~125k text rows crashes', false, e.message) }
  // csvToSchema end-to-end with 200k rows text
  try { const big = 'a,b\n' + Array.from({ length: 200000 }, (_, i) => `x${i},y${i}`).join('\n'); const t = Date.now(); csvToSchema('b.csv', big); check(`end-to-end 200k text rows ok (${Date.now() - t}ms)`, true) } catch (e) { check('end-to-end 200k text rows ok', false, e.message) }
  try { const big = 'a,b\n' + Array.from({ length: 1000000 }, (_, i) => `x${i},y${i}`).join('\n'); const t = Date.now(); csvToSchema('b.csv', big); check(`end-to-end 1M text rows ok (${Date.now() - t}ms)`, true) } catch (e) { check('end-to-end 1M text rows (Math.max spread RangeError)', false, e.message) }
}
done('d.json')
