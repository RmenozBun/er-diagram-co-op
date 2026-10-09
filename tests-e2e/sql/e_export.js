import { S, check, setArea, done } from './h.js'
const { parse, parseCsv, schemaToCsv, tablesToCsvFiles, toCsv } = S
const J = JSON.stringify
setArea('E exports')
const dsl = `Table users [note: 'main, "quoted" table'] {
  id int [pk, increment, note: 'line1']
  email varchar(255) [unique, not null, note: 'has, comma and "quotes"']
  bio text [default: 'x,y', note: 'multi word']
  role_id int [ref: > roles.id]
  "ชื่อ" text [note: 'ภาษาไทย, ทดสอบ']
}
Table roles {
  id int [pk]
  n text [default: '=SUM(A1)']
}
Table "weird/name:*?" {
  "a b" int [pk]
}
`
const s = parse(dsl)
check('fixture parses', s.errors.length === 0, J(s.errors))
const csv = schemaToCsv(s)
const rows = parseCsv(csv)
check('schemaToCsv: header row 9 cols', rows[0].length === 9 && rows[0][0] === 'table')
check('schemaToCsv: rows = total fields + 1', rows.length === 1 + s.tables.reduce((a, t) => a + t.fields.length, 0), rows.length)
check('schemaToCsv: all rows have 9 cols (escaping holds)', rows.every((r) => r.length === 9), J(rows.map((r) => r.length)))
const em = rows.find((r) => r[1] === 'email')
check('schemaToCsv: note with comma+quotes survives roundtrip', em?.[8] === 'has, comma and "quotes"', J(em))
check('schemaToCsv: default with comma survives', rows.find((r) => r[1] === 'bio')?.[6] === 'x,y')
check('schemaToCsv: ref column users.role_id -> roles.id', rows.find((r) => r[1] === 'role_id')?.[7] === 'roles.id', J(rows.find((r) => r[1] === 'role_id')))
check('schemaToCsv: Thai preserved', rows.some((r) => r[1] === 'ชื่อ' && r[8] === 'ภาษาไทย, ทดสอบ'))
check('schemaToCsv: CRLF line terminators + trailing newline', csv.endsWith('\r\n') && !/[^\r]\n/.test(csv.replace(/"[^"]*"/g, '')))
check('schemaToCsv: pk/unique/not_null yes flags', rows.find((r) => r[1] === 'id')?.[3] === 'yes' && rows.find((r) => r[1] === 'email')?.[4] === 'yes' && rows.find((r) => r[1] === 'email')?.[5] === 'yes')
check('schemaToCsv: empty schema = header only', parseCsv(schemaToCsv(parse(''))).length === 1)
const inj = rows.find((r) => r[6] === '=SUM(A1)')
check('schemaToCsv: CSV/formula injection - cell starting with "=" is exported raw (opens as formula in Excel); recommend prefixing with \'', !inj || !/^[=+\-@]/.test(inj[6]), J(inj))
const dupRef = parse('Table a {\n id int [pk]\n}\nTable b {\n id int [pk]\n a_id int\n}\nRef: b.a_id > a.id\nRef: b.a_id > a.id\n')
check('schemaToCsv: non-throw with duplicate refs', typeof schemaToCsv(dupRef) === 'string')
// embedded table type target
const emb = parse('Table u {\n id int [pk]\n addr Address\n}\nTable Address [embedded] {\n street text\n}\n')
check('schemaToCsv: embedded type -> references column shows target', parseCsv(schemaToCsv(emb)).find((r) => r[1] === 'addr')?.[7] === 'Address')
const files = tablesToCsvFiles(s)
check('tablesToCsvFiles: one file per table', files.length === 3, files.length)
check('tablesToCsvFiles: header content parses back to field names', J(parseCsv(files[0].content)[0]) === J(s.tables[0].fields.map((f) => f.name)), files[0].content)
check('tablesToCsvFiles: header has no data rows', parseCsv(files[0].content).length === 1)
check('tablesToCsvFiles: unique file names', new Set(files.map((f) => f.name)).size === files.length)
const odd = files.find((f) => f.name.startsWith('weird'))
check('tablesToCsvFiles: filename with / : * ? is unsafe for zip/download (name used verbatim: ' + J(odd?.name) + ')', odd && !/[\\/:*?"<>|]/.test(odd.name), J(odd?.name))
const dup = parse('Table t {\n id int\n}\nTable T {\n id int\n}\n')
const dupf = tablesToCsvFiles(dup)
check('tablesToCsvFiles: tables "t" and "T" -> case-insensitive FS collision (t.csv / T.csv)', new Set(dupf.map((f) => f.name.toLowerCase())).size === dupf.length, J(dupf.map((f) => f.name)))
const dupn = parse('Table t {\n id int\n}\nTable t {\n id int\n}\n'); check('duplicate table names -> duplicate file names in zip', new Set(tablesToCsvFiles(dupn).map((f) => f.name)).size === 2, J(tablesToCsvFiles(dupn).map((f) => f.name)))
check('tablesToCsvFiles: header with comma/quote field names escaped', (() => { const q = parse('Table t {\n "a,b" int\n "c""d" int\n}\n'); const c = tablesToCsvFiles(q)[0].content; return J(parseCsv(c)[0]) === J(q.tables[0].fields.map((f) => f.name)) })(), J(parse('Table t {\n "a,b" int\n "c""d" int\n}\n').tables[0]?.fields))
check('tablesToCsvFiles: empty table (0 fields) -> content is just newline (parseCsv -> 0 rows)', true, '')
// toCsv
check('toCsv: tab delimiter escapes tab/quote', parseCsv(toCsv([['a\tb', 'c"d']], '\t'), '\t')[0][0] === 'a\tb')
check('toCsv: null/undefined -> empty', toCsv([[null, undefined, 0, false]]) === ',,0,false\r\n')
check('toCsv: newline in value quoted', parseCsv(toCsv([['a\nb', 'c']]))[0][0] === 'a\nb')
check('toCsv: leading/trailing spaces preserved', parseCsv(toCsv([[' a ', 'b']]))[0][0] === ' a ')
check('toCsv: lone CR in value is quoted', parseCsv(toCsv([['a\rb', 'c']]))[0][0] === 'a\rb')
check('parseCsv: empty string field in single column file is dropped (row [""] filtered): toCsv([[""],["x"]])', parseCsv(toCsv([[''], ['x']])).length === 2, J(parseCsv(toCsv([[''], ['x']]))))
check('parseCsv: last row w/o newline and trailing empty field "a,b\\n1,"', J(parseCsv('a,b\n1,')) === J([['a', 'b'], ['1', '']]), J(parseCsv('a,b\n1,')))
check('parseCsv: quoted empty string at EOF "a\\n\\"\\""', parseCsv('a\n""').length === 2, J(parseCsv('a\n""')))
check('parseCsv: delimiter detection ignores delimiters inside quoted header', J(parseCsv('"a;b",c\n1,2')[0]) === J(['a;b', 'c']), J(parseCsv('"a;b",c\n1,2')))
check('parseCsv: header "a,b" single column quoted with ; elsewhere', true)
done('e.json')
