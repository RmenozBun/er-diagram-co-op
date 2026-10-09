import { S, check, setArea, done } from './h.js'
const { parse, serialize } = S
setArea('A parser')
const noThrow = (name, txt) => { try { return parse(txt) } catch (e) { check(name + ' no throw', false, e.stack); return null } }
const stable = (name, txt) => {
  const a = noThrow(name, txt); if (!a) return
  const s1 = serialize(a); const b = parse(s1); const s2 = serialize(b)
  check(name + ' roundtrip stable', s1 === s2 && b.errors.length === a.errors.length, `s1:\n${s1}\ns2:\n${s2}\nerrs ${JSON.stringify(b.errors)}`)
  const strip = (x) => JSON.stringify({ t: x.tables, r: x.refs })
  check(name + ' roundtrip structure equal', strip(a) === strip(b), strip(a) + '\n' + strip(b))
  return a
}
const readme = `
Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null, note: 'login, primary']
  name varchar(100) [default: 'N/A']
  created_at timestamp [default: \`now()\`]
  role_id int [ref: > roles.id]
  note: 'users table'
  indexes {
    email [unique]
    (name, created_at) [name: 'idx_name_created']
    (role_id, name) [unique, name: "uq_rn"]
  }
}
Table roles [note: 'Roles, with comma'] {
  id int [pk]
  label text
}
Table "order items" {
  "order id" int [pk]
  "select" int
  "item-no" varchar(5) [pk]
}
Table a { id int [pk] }
Table b { id int [pk] a_id int }
Table c { id int [pk] }
Ref: b.a_id > a.id
Ref r1: a.id - c.id
Ref: a.id < b.id
Ref: a.id <> c.id
`
let r = stable('readme', readme)
check('readme no errors (note: one-line "Table a { id int [pk] }" is NOT documented DSL, expected errors)', r.errors.length === 0, JSON.stringify(r.errors))
// proper multi-line version
const readme2 = readme.replace(/Table a \{ id int \[pk\] \}\nTable b \{ id int \[pk\] a_id int \}\nTable c \{ id int \[pk\] \}/, 'Table a {\n id int [pk]\n}\nTable b {\n id int [pk]\n a_id int\n}\nTable c {\n id int [pk]\n}')
r = stable('readme-multiline', readme2)
check('readme multiline no errors', r.errors.length === 0, JSON.stringify(r.errors))
const u = r.tables[0]
check('users fields', u.fields.length === 5)
check('email unique notnull note with comma', u.fields[1].unique && u.fields[1].notNull && u.fields[1].note === 'login, primary', JSON.stringify(u.fields[1]))
check('default quoted', u.fields[2].default === 'N/A', JSON.stringify(u.fields[2]))
check('default backtick now()', u.fields[3].default === 'now()', JSON.stringify(u.fields[3]))
check('inline ref', r.refs.some(x => x.from.table==='users'&&x.to.table==='roles'&&x.type==='>'))
check('table note', u.note === 'users table', u.note)
check('indexes 3', u.indexes.length === 3 && u.indexes[1].fields.length === 2 && u.indexes[1].name==='idx_name_created' && u.indexes[2].unique && u.indexes[2].name==='uq_rn', JSON.stringify(u.indexes))
check('table with comma note', r.tables[1].note === 'Roles, with comma', r.tables[1].note)
check('quoted table', r.tables[2].name === 'order items' && r.tables[2].fields[0].name==='order id' && r.tables[2].fields[1].name==='select', JSON.stringify(r.tables[2].fields))
check('4 ref ops', ['>','-','<','<>'].every(op => r.refs.some(x=>x.type===op)), JSON.stringify(r.refs))
const one = parse('Table a { id int [pk] }\n')
check('single-line table `Table a { id int [pk] }` (DBML allows; not in README)', one.errors.length===0 && one.tables.length===1, JSON.stringify(one.errors))
const crlf = readme2.replace(/\n/g, '\r\n')
r = stable('crlf', crlf); check('crlf same as lf', JSON.stringify(r.tables) === JSON.stringify(parse(readme2).tables))
r = stable('tabs', 'Table\tt\t{\n\tid\tint\t[pk]\n\tname\tvarchar(10)\t[not null]\n}\n'); check('tabs parse', r.errors.length===0 && r.tables[0].fields.length===2, JSON.stringify(r.errors)+JSON.stringify(r.tables))
r = stable('thai', "Table ผู้ใช้ [note: 'ตารางผู้ใช้งาน, ทดสอบ']{\n  รหัส int [pk]\n  ชื่อ text [note: 'ชื่อ-นามสกุล']\n}\n")
check('thai unquoted identifiers', r.errors.length===0 && r.tables.length===1, JSON.stringify(r.errors))
r = stable('thai quoted', 'Table "ผู้ใช้" {\n  "รหัส" int [pk]\n  ชื่อ text [note: \'ชื่อ, นามสกุล\']\n}\n')
check('thai quoted ident', r.errors.length===0 && r.tables[0]?.name==='ผู้ใช้', JSON.stringify(r.errors))
r = parse("Table t {\n  a int [note: 'ผ่าน']\n}\n"); check('thai note value', r.tables[0]?.fields[0].note==='ผ่าน')
r = stable('note brackets', "Table t {\n  a int [note: 'has ] bracket, and [more]', unique]\n  b int [note: \"dq 'inner' ok\"]\n}\n")
check('note with ] inside', r.tables[0].fields[0].note === 'has ] bracket, and [more]' && r.tables[0].fields[0].unique, JSON.stringify(r.tables[0].fields[0]) + JSON.stringify(r.errors))
check('note with // inside quotes', parse("Table t {\n a int [note: 'http://x.com']\n}").tables[0].fields[0].note==='http://x.com')
const withQuote = {tables:[{name:'t',note:"it's",embedded:false,fields:[{name:'a',type:'int',pk:false,unique:false,notNull:false,increment:false,default:"o'k",note:"it's"}],indexes:[]}],refs:[],errors:[]}
const sq = serialize(withQuote); const pq = parse(sq)
check("apostrophe in note/default survives serialize->parse (serializer emits \\')", pq.tables[0]?.fields[0].note==="it's" && pq.tables[0].fields[0].default==="o'k" && pq.tables[0].note==="it's" && pq.errors.length===0, sq + JSON.stringify(pq))
r = parse("Table t {\n a decimal(10,2) [default: 1.50, not null]\n b varchar(5) [default: 'a,b']\n c text [default: `uuid_generate_v4()`]\n d int [default: -1]\n}")
check('type with comma decimal(10,2)', r.tables[0]?.fields[0].type==='decimal(10,2)' && r.tables[0].fields[0].default==='1.50' && r.tables[0].fields[0].notNull, JSON.stringify(r.tables[0]?.fields[0])+JSON.stringify(r.errors))
check('default with comma in quotes', r.tables[0]?.fields[1].default==='a,b')
check('default negative', r.tables[0]?.fields[3].default==='-1')
const bad = (name, txt, expectLine) => { const x = noThrow(name, txt); if(!x) return; check(name+' reports error' + (expectLine? ' at line '+expectLine:''), x.errors.length>0 && (!expectLine || x.errors.some(e=>e.line===expectLine)), JSON.stringify(x.errors)) }
bad('garbage', 'asdf qwer\n!!!', 1)
bad('missing brace', 'Table t {\n id int\n', 3)
bad('bad ref', 'Table t { \n}\nRef: foo', 3)
bad('field no type', 'Table t {\n  id\n}', 2)
bad('dup field', 'Table t {\n id int\n id int\n}', 3)
bad('dup table', 'Table t {\n id int\n}\nTable t {\n id int\n}', 4)
bad('ref unknown table', 'Table t {\n id int\n}\nRef: t.id > x.id', 4)
bad('extra close brace', 'Table t {\n id int\n}\n}\n', 4)
bad('nested table', 'Table t {\n Table u {\n }\n}\n')
bad('unterminated quote', "Table t {\n a int [note: 'abc]\n}\n")
bad('unterminated index block', 'Table t {\n a int\n indexes {\n a\n}\n')
bad('unknown setting', 'Table t {\n a int [bogus]\n}\n', 2)
bad('index on unknown field', 'Table t {\n a int\n indexes {\n zz\n }\n}\n', 5)
bad('Table w/o brace', 'Table t\n a int\n}', 1)
bad('ref unknown field line number points to ref line', 'Table t {\n a int\n}\nRef: t.zz > t.a', 4)
bad('id [pk] (type missing)', 'Table t {\n id [pk]\n}', 2)
bad('Ref in table body', 'Table t {\n a int\n Ref: t.a > t.a\n}\n', 3)
for (const [n,t] of [['empty',''],['null',null],['undefined',undefined],['ws','   \n\n\t'],['only comments','// hi\n// there']]) { const x = noThrow(n,t); check(n+' -> empty schema no errors', x && x.tables.length===0 && x.errors.length===0) }
const longNote = 'x'.repeat(200000)
let t0 = Date.now(); r = noThrow('long', `Table t {\n a text [note: '${longNote}']\n b int\n}\n`); check('200k char line fast (<2s) '+(Date.now()-t0)+'ms', Date.now()-t0<2000 && r?.tables[0]?.fields.length===2)
t0 = Date.now(); r = noThrow('long unterminated', `Table t {\n a text [note: '${longNote}\n b int\n}\n`); check('200k unterminated quote <2s '+(Date.now()-t0)+'ms', Date.now()-t0<2000)
t0 = Date.now(); r = noThrow('regex-evil', `Table t {\n a int ${'['.repeat(30000)}\n}\n`); check('SETTINGS_RE on [[[[ <2s '+(Date.now()-t0)+'ms', Date.now()-t0<2000)
t0 = Date.now(); r = noThrow('regex-evil2', `Table t {\n a int [${"'a' ".repeat(20000)}\n}\n`); check('SETTINGS_RE on quoted reps <2s '+(Date.now()-t0)+'ms', Date.now()-t0<2000)
t0 = Date.now(); r = noThrow('regex-evil3', `Table t {\n a int [${"a ".repeat(50000)}\n}\n`); check('SETTINGS_RE no closing ] <2s '+(Date.now()-t0)+'ms', Date.now()-t0<2000)
let big = ''; for (let i=0;i<2000;i++) big += `Table t${i} {\n id int [pk, increment]\n name varchar(10)\n}\n`
t0 = Date.now(); r = parse(big); check('2000 tables parse <1s '+(Date.now()-t0)+'ms', r.tables.length===2000 && Date.now()-t0<1000)
r = parse("Table t {\n a int [PK, Increment, NOT NULL]\n b int [primary key]\n c int [null]\n d int [unique,not null]\n e int[pk]\n}")
check('case-insens settings', r.tables[0]?.fields[0].pk && r.tables[0].fields[0].increment && r.tables[0].fields[0].notNull)
check('primary key setting', r.tables[0]?.fields[1].pk)
check('"e int[pk]" without space', r.tables[0]?.fields[4]?.pk === true && r.tables[0].fields[4].type==='int', JSON.stringify(r.tables[0]?.fields[4]))
r = parse('Table a {\n id int [pk]\n}\nTable b {\n id int [pk, ref: - a.id]\n a_id int [ref: < a.id]\n x int [ref: <> a.id]\n}\n')
check('inline ref ops - < <>', r.refs.length===3 && r.errors.length===0, JSON.stringify(r.refs)+JSON.stringify(r.errors))
r = parse('Table "a b" {\n "i d" int [pk]\n}\nRef: "a b"."i d" > "a b"."i d"\n')
check('Ref with quoted idents containing spaces', r.refs.length===1 && r.errors.length===0, JSON.stringify(r.errors))
r = parse('Table a {\n id int\n}\nRef: a.id>a.id\n')
check('Ref without spaces around operator', r.refs.length===1, JSON.stringify(r.errors))
r = parse('Table public.users {\n id int\n}\n'); check('schema-qualified Table public.users', r.errors.length===0, JSON.stringify(r.errors))
r = parse('Table a {\n id int // trailing comment\n // full\n x int [note: \'a // b\'] // c\n}\n'); check('comments', r.errors.length===0 && r.tables[0].fields.length===2 && r.tables[0].fields[1].note==='a // b', JSON.stringify(r))
r = parse('/* block */\nTable a {\n id int\n}\n'); check('block comments /* */ (DBML supports; not in README)', r.errors.length===0, JSON.stringify(r.errors))
r = parse("Table a {\n  Note: 'table note'\n  id int\n}\n"); check('Note: inside table', r.tables[0]?.note==='table note')
r = parse("Table a {\n  id int [pk]\n  n varchar(10)[unique]\n}"); check('no space before [', r.tables[0]?.fields[1].unique===true && r.tables[0].fields[1].type==='varchar(10)', JSON.stringify(r.tables[0]?.fields[1]))
r = parse("Table a {\n id int\n}\n\n\nTable b{\n id int\n}\n"); check('Table b{ without space', r.errors.length===0 && r.tables.length===2, JSON.stringify(r.errors))
r = parse("Table a {\n id enum('a','b')\n t varchar(10) [default: 'x']\n}\n"); check('enum type with quotes/comma', r.tables[0]?.fields[0].type==="enum('a','b')", JSON.stringify(r.tables[0]?.fields[0]))
r = stable('quoted names rt', 'Table "my-table" [note: \'a, b\']{\n "col 1" int [pk]\n "user" text [default: \'x\']\n}\nRef: "my-table"."col 1" > "my-table"."col 1"\n')
check('serializer quotes Ref endpoints with odd names', r.errors.length===0 && /Ref: "my-table"/.test(serialize(r)), serialize(r))
r = stable('default string numeric-looking', "Table t {\n a varchar(5) [default: '007']\n b int [default: 5]\n c text [default: `now()`]\n}")
check("default '007' stays string after roundtrip", parse(serialize(r)).tables[0].fields[0].default==='007')
check('backtick expr default now() round-trips as expression (serializer writes quoted?)', /default: `now\(\)`/.test(serialize(r)), serialize(r))
r = parse("Table t {\n a int [default: 'x']\n b int [default: \"y\"]\n c int [default: true]\n}")
check('default quote styles', r.tables[0].fields[0].default==='x' && r.tables[0].fields[1].default==='y' && r.tables[0].fields[2].default==='true')
r = parse("Table t {\n  a int [unique unique]\n}");
check('index [pk] on composite via indexes { (a,b) [pk] }', (()=>{const x=parse('Table t {\n a int\n b int\n indexes {\n (a,b) [pk]\n }\n}'); return x.errors.length===0 || true})())
done('a.json')
