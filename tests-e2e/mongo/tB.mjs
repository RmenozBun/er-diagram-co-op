import fs from 'fs'
import ExcelJS from 'exceljs'
import * as L from './lib.mjs'
import { check } from './lib.mjs'
const B = 'B spec'
const ab = (buf) => buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf
const fld = (s, t, f) => s.tables.find((x) => x.name === t)?.fields.find((x) => x.name === f)
const spec = (name, rows) => ({ name, rows: [['Field', 'Type'], ...rows] })
const imp = (sheets) => L.importRows(sheets)
const clean = (r) => r

// ---- real school file
{
  const buf = fs.readFileSync(process.env.SCHOOL_XLSX ?? (console.error('set SCHOOL_XLSX to the path of the school workbook'), process.exit(0)))
  const sheets = await L.readXlsx(ab(buf))
  const { schema, code } = imp(sheets)
  const p = L.parse(code)
  check(B, 'school: 6 sheets read', sheets.length === 6)
  check(B, 'school: 5 spec sheets detected', sheets.filter((s) => L.isSpecRows(s.rows)).length === 5)
  check(B, 'school: reparse no errors', p.errors.length === 0, JSON.stringify(p.errors))
  for (const t of ['SCHOOL', 'USER', 'TRACKING', 'MEETING', 'IMPLEMENT']) check(B, `school: ${t}._id objectid pk`, fld(schema, t, '_id')?.type === 'objectid' && fld(schema, t, '_id')?.pk && !fld(schema, t, 'id'))
  check(B, 'school: 10 refs', schema.refs.length === 10, 'got ' + schema.refs.length)
  check(B, 'school: all refs point to _id', schema.refs.every((r) => r.to.field === '_id'))
  check(B, 'school: SCHOOL.createBy (user) -> USER (case-insens.)', schema.refs.some((r) => r.from.table === 'SCHOOL' && r.from.field === 'createBy' && r.to.table === 'USER'))
  check(B, 'school: ref field type is objectid (should match target pk)', fld(schema, 'TRACKING', 'schoolId')?.type === 'objectid', 'type is ' + fld(schema, 'TRACKING', 'schoolId')?.type + ' (string but Ref to objectid _id)')
  check(B, 'school: Notes become table notes', Boolean(schema.tables.find((t) => t.name === 'MEETING').note))
  check(B, 'school: STATUS sheet (lookup data) -> table with Mongo-unfriendly SQL types', fld(schema, 'STATUS_reference', 'Code')?.type === 'int' && fld(schema, 'STATUS_reference', 'Status_TH')?.type === 'varchar(255)', JSON.stringify(schema.tables.at(-1).fields.map((f) => f.type)))
  check(B, 'school: STATUS lookup rows (8 values) kept anywhere?', code.includes('จ่ายงาน'), 'row data dropped (by design for data sheets), only column types survive')
  check(B, 'school: "num (0,1)" hint kept as note only', fld(schema, 'USER', 'active')?.note === '0,1')
  check(B, 'school: "array" w/o inner type -> json[]', fld(schema, 'MEETING', 'product')?.type === 'json[]')
  check(B, 'school: "array(obj)" -> object[]', fld(schema, 'SCHOOL', 'contact')?.type === 'object[]')
  fs.writeFileSync('school.dsl', code)
}

// ---- type vocabulary
const types = ['int', 'integer', 'number', 'num', 'bool', 'boolean', 'float', 'double', 'ObjectId', 'objectid', 'Date', 'datetime', 'timestamp', 'String', 'string', 'text', 'array', 'array(string)', 'array(obj)', 'array<string>', 'array(ObjectId)', 'array(int)', 'obj', 'object', 'map', 'any', 'mixed', 'Number', 'INT', 'Boolean', 'long', 'decimal', 'bigint', 'uuid', 'email', 'buffer', 'binary', 'string[]', 'int[]', 'varchar(255)', 'enum', 'Mixed', 'time', 'long text', 'string ', ' string', 'string\t', 'double precision', 'Array(String)', 'array (string)', 'string(50)', 'ภาษาไทย', 'จำนวนเต็ม', 'String (ภาษาไทย)', 'array of string', 'dict', 'list', 'array<obj>', 'array[string]', 'Date/Time']
{
  const rows = types.map((t, i) => [`f${i}`, t])
  const { schema, code } = imp([spec('T', rows)])
  const p = L.parse(code)
  check(B, 'types: reparse no errors', p.errors.length === 0, JSON.stringify(p.errors.slice(0, 3)))
  const out = {}
  types.forEach((t, i) => (out[JSON.stringify(t)] = fld(schema, 'T', `f${i}`)?.type + (fld(schema, 'T', `f${i}`)?.note ? ` [note:${fld(schema, 'T', `f${i}`).note}]` : '')))
  console.log('TYPE MAP', out)
  fs.writeFileSync('typemap.json', JSON.stringify(out, null, 1))
  const expect = { int: 'int', integer: 'int', number: 'int', num: 'int', bool: 'bool', boolean: 'bool', float: 'double', double: 'double', ObjectId: 'objectid', objectid: 'objectid', Date: 'date', datetime: 'date', timestamp: 'date', String: 'string', string: 'string', text: 'string', array: 'json[]', 'array(string)': 'string[]', 'array(obj)': 'object[]', 'array<string>': 'string[]', 'array(ObjectId)': 'objectid[]', 'array(int)': 'int[]', obj: 'object', object: 'object', map: 'object', any: 'json', mixed: 'json', Number: 'int', INT: 'int', Boolean: 'bool', long: 'long', decimal: 'decimal', bigint: 'long', uuid: 'string', buffer: 'buffer', binary: 'buffer', 'string[]': 'string[]', 'int[]': 'int[]', 'varchar(255)': 'string', Mixed: 'json', 'string ': 'string', ' string': 'string', 'string\t': 'string', 'Array(String)': 'string[]', 'array (string)': 'string[]', 'array<obj>': 'object[]', 'array[string]': 'string[]', dict: 'object', list: 'json[]', 'array of string': 'string[]' }
  const bad = []
  let ok = 0
  for (const [k, v] of Object.entries(expect)) {
    const got = out[JSON.stringify(k)]?.replace(/ \[note:.*$/, '')
    if (got === v) ok++; else bad.push(`${k} => ${got} (expected ${v})`)
  }
  check(B, `types: vocabulary mapped sensibly (${ok}/${Object.keys(expect).length})`, bad.length === 0, bad.join('; '))
  for (const b of bad) console.log('  TYPE BAD', b)
}

// ---- misc variations
{
  // header casing, extra columns, trailing spaces, blank rows
  const sheets = [{ name: 'Person', rows: [['FIELD', 'TYPE', 'Required', 'Description', 'Default'], ['id', 'obj', 'Y', 'pk', ''], ['name ', ' string ', 'Y', 'Full name', 'n/a'], ['', '', '', '', ''], ['age', 'int', 'N', 'Age in years', '0'], ['nick', 'string', '', 'ชื่อเล่น', 'x'], ['Note', 'Hello world', '', '']] }]
  check(B, 'extra: header FIELD/TYPE upper-case detected as spec', L.isSpecRows(sheets[0].rows))
  const { schema, code } = imp(sheets)
  console.log(code)
  const name = fld(schema, 'Person', 'name')
  check(B, 'extra: trailing spaces trimmed (name)', !!name && name.type === 'string')
  check(B, 'extra: blank row skipped', schema.tables[0].fields.length === 4, 'fields=' + schema.tables[0].fields.length)
  check(B, 'extra: "Required" column is used (name notNull)', name?.notNull === true, 'Required column silently ignored: name.notNull=' + name?.notNull)
  check(B, 'extra: "Description" column used as note', name?.note === 'Full name', 'note=' + name?.note)
  check(B, 'extra: "Default" column used', fld(schema, 'Person', 'age')?.default === '0', 'default=' + fld(schema, 'Person', 'age')?.default)
  check(B, 'extra: Note row -> table note', schema.tables[0].note === 'Hello world')
  // Note row where Note text is in col 3 / multiple Note rows
}
{
  // different first-col header words
  for (const h of [['Column', 'Data type'], ['Name', 'Type'], ['field', 'datatype'], [' Field ', ' Type '], ['Field', 'Type', '', '']]) check(B, `header ${JSON.stringify(h)} detected`, L.isSpecRows([h, ['a', 'b']]))
  for (const h of [['ฟิลด์', 'ชนิด'], ['Field name', 'Type'], ['Fields', 'Types'], ['Attribute', 'Type'], ['Key', 'Type'], ['Field', 'Data Type']]) check(B, `header ${JSON.stringify(h)} detected`, L.isSpecRows([h, ['a', 'b']]), 'not detected -> treated as DATA table')
  check(B, 'empty sheet rows [] no crash', (() => { try { return L.isSpecRows([]) === false } catch { return false } })())
  check(B, 'header with only 1 column no crash', L.isSpecRows([['Field']]) === false)
  check(B, 'header with undefined cell', (() => { try { L.isSpecRows([[undefined, null]]); return true } catch (e) { return false } })(), 'String(undefined)')
}
{
  // refs: nonexistent table, case, self-ref, 2 sheets same name
  const { schema, code } = imp([
    spec('School', [['id', 'obj'], ['name', 'string'], ['parentId', 'string (ref: school)'], ['owner', 'string (ref: Ghost)'], ['boss', 'string (USER)'], ['x', 'string (ref:  SCHOOL )'], ['y', 'ObjectId (ref: School)'], ['z', 'array(string) (ref: School)'], ['zz', 'array (ref: School)'], ['w', 'string (ref: school.id)'], ['v', 'string (ref: ' + 'ผู้ใช้' + ')']]),
    spec('ผู้ใช้', [['id', 'obj'], ['n', 'string']]),
  ])
  console.log(code)
  const p = L.parse(code)
  check(B, 'ref: reparse no errors', p.errors.length === 0, JSON.stringify(p.errors))
  const hasRef = (f) => schema.refs.some((r) => r.from.field === f)
  check(B, 'ref: case-different ref (ref: school) resolves', hasRef('parentId'))
  check(B, 'ref: self-reference creates Ref School.parentId > School._id', schema.refs.some((r) => r.from.table === 'School' && r.to.table === 'School'))
  check(B, 'ref: unknown table (Ghost) -> no ref, no crash', !hasRef('owner'))
  check(B, 'ref: unknown table hint kept as note (user not told)', fld(schema, 'School', 'owner')?.note === 'ref: Ghost', 'note=' + fld(schema, 'School', 'owner')?.note)
  check(B, 'ref: bare (USER) with no such table -> note "USER"', fld(schema, 'School', 'boss')?.note === 'USER', 'note=' + fld(schema, 'School', 'boss')?.note)
  check(B, 'ref: extra spaces (ref:  SCHOOL )', hasRef('x'))
  check(B, 'ref: ObjectId type keeps objectid', fld(schema, 'School', 'y')?.type === 'objectid')
  check(B, 'ref: array(string) (ref: School) -> array of refs (objectid[])', fld(schema, 'School', 'z')?.type !== 'string[]' || hasRef('z'), `type=${fld(schema, 'School', 'z')?.type} ref=${hasRef('z')}`)
  check(B, 'ref: "array (ref: School)" -> ref array', hasRef('zz'), `type=${fld(schema, 'School', 'zz')?.type} ref=${hasRef('zz')} note=${fld(schema, 'School', 'zz')?.note}`)
  check(B, 'ref: "ref: school.id" (table.field form)', hasRef('w'), `ref=${hasRef('w')} note=${fld(schema, 'School', 'w')?.note}`)
  check(B, 'ref: Thai table name ref', hasRef('v'))
  const m = L.toMongoose(schema)
  console.log(m.split('\n').filter((l) => /ref:/.test(l)).join('\n'))
}
{
  // two sheets same name; sheet names with spaces/parentheses/Thai/digits/reserved
  const { schema, code } = imp([spec('Dup', [['id', 'obj']]), spec('Dup', [['id', 'obj'], ['x', 'int']]), spec('my sheet (v2)', [['id', 'obj']]), spec('ผู้ใช้งาน', [['id', 'obj']]), spec('ลูกค้า', [['id', 'obj']]), spec('2024 data', [['id', 'obj']]), spec('a.b-c', [['id', 'obj']]), spec('   ', [['id', 'obj']]), spec('!!!', [['id', 'obj']]), spec('Sheet1', [['id', 'obj']]), spec('sheet1', [['id', 'obj']]), spec('__proto__', [['id', 'obj']]), spec('constructor', [['id', 'obj']])])
  console.log(schema.tables.map((t) => t.name))
  const p = L.parse(code)
  check(B, 'sheetnames: reparse no errors', p.errors.length === 0, JSON.stringify(p.errors.slice(0, 3)))
  const names = schema.tables.map((t) => t.name)
  check(B, 'sheetnames: 2 sheets "Dup" kept distinct', names.filter((n) => n === 'Dup').length === 1 && names.length === new Set(names).size, 'names=' + names.join('|') + ' (duplicate table names!)')
  check(B, 'sheetnames: Thai names preserved', names.includes('ผู้ใช้งาน') && names.includes('ลูกค้า'), names.join('|'))
  check(B, 'sheetnames: case-insensitively unique (Sheet1/sheet1)', new Set(names.map((n) => n.toLowerCase())).size === names.length, names.join('|'))
  const m = L.toMongoose(schema)
  fs.writeFileSync('sheetnames.model.cjs', m)
}
{
  // self-contained: _id conversion in different variants
  const { schema } = imp([spec('A', [['id', 'obj'], ['_id', 'objectid'], ['name', 'string']]), spec('B', [['ID', 'obj'], ['Id', 'string']]), spec('C', [['_id', 'obj']]), spec('D', [['id', 'string']]), spec('E', [['id', 'int']]), spec('F', [['id', 'ObjectId']]), spec('G', [['id', 'object']]), spec('H', [['userId', 'obj']]), spec('I', [['id', 'array(obj)']]), spec('J', [['id', 'obj (ref: A)']])])
  const dump = (t) => schema.tables.find((x) => x.name === t).fields.map((f) => `${f.name}:${f.type}${f.pk ? ':pk' : ''}`).join(',')
  for (const t of 'ABCDEFGHIJ') console.log(t, dump(t))
  check(B, '_id: A has both id obj & _id objectid -> no duplicate field names', new Set(schema.tables[0].fields.map((f) => f.name)).size === schema.tables[0].fields.length, dump('A'))
  check(B, '_id: B "ID obj" + "Id string" -> converted w/o duplicates', new Set(schema.tables[1].fields.map((f) => f.name)).size === schema.tables[1].fields.length, dump('B'))
  check(B, '_id: C "_id obj" -> _id objectid pk', dump('C') === '_id:objectid:pk', dump('C'))
  check(B, '_id: D "id string" stays (not objectid)', dump('D') === 'id:string', dump('D'))
  check(B, '_id: E "id int" stays', dump('E') === 'id:int')
  check(B, '_id: F "id ObjectId" -> _id pk', dump('F') === '_id:objectid:pk', dump('F'))
  check(B, '_id: G "id object" -> _id pk', dump('G') === '_id:objectid:pk', dump('G'))
  check(B, '_id: H userId obj stays "object"', dump('H') === 'userId:object', dump('H'))
  check(B, '_id: J "id obj (ref: A)": ref-id keeps ref? (field renamed to _id pk AND ref)', true, dump('J') + ' refs=' + JSON.stringify(schema.refs.filter((r) => r.from.table === 'J')))
  const p = L.parse(L.serialize(schema)); check(B, '_id: reparse errors only dup-field related?', p.errors.length === 0, JSON.stringify(p.errors))
}

// ---- csv spec
{
  const csv = 'Field,Type,Required,Description\r\nid,obj,,\r\nname,string,Y,"ชื่อ, สกุล"\r\nowner,"string (ref: Other)",,\r\nNote,"a, b",,\r\n'
  const rows = L.parseCsv(csv)
  check(B, 'csv: spec detected', L.isSpecRows(rows))
  const s = L.specToSchema([{ name: 'Person', rows }])
  const sc = L.parseCsv('Field;Type\nid;obj\nx;int\n'); check(B, 'csv: semicolon delimiter spec', L.isSpecRows(sc))
  const tab = L.parseCsv('Field\tType\nid\tobj\nx\tint\n'); check(B, 'csv: tab delimiter spec', L.isSpecRows(tab))
  const bom = L.parseCsv('\uFEFFField,Type\nid,obj\n'); check(B, 'csv: BOM header spec', L.isSpecRows(bom))
  const sp = L.parseCsv('Field, Type\nid, obj\nx, int\n'); check(B, 'csv: "Field, Type" with space', L.isSpecRows(sp))
  // csv file name -> table name (importFiles uses file.name.replace ext) then clean(): file "my schema (1).csv"
  const s2 = L.specToSchema([{ name: 'my schema (1)', rows: sp }]); console.log('csv name ->', s2.tables[0].name)
  // header-only
  const s3 = L.specToSchema([{ name: 'Empty', rows: [['Field', 'Type']] }]); check(B, 'spec: header only -> table with zero fields', s3.tables[0].fields.length === 0)
  const code = L.serialize(s3); console.log(code); check(B, 'spec: zero-field table reparses', L.parse(code).errors.length === 0)
  // duplicates fields inside sheet
  const s4 = L.specToSchema([{ name: 'D', rows: [['Field', 'Type'], ['a', 'int'], ['a', 'string']] }])
  const pe = L.parse(L.serialize(s4)).errors; check(B, 'spec: duplicate field rows deduped/reported', pe.length === 0, 'reparse gives: ' + JSON.stringify(pe) + ' (importer emits duplicate fields silently)')
  // names needing quoting
  const s5 = L.specToSchema([{ name: 'Q', rows: [['Field', 'Type'], ['first name', 'string'], ['ชื่อ', 'string'], ['a.b', 'int'], ['x"y', 'int'], ['0', 'int'], ['Note x', 'int'], ['notes', 'hello'], ['Notes', 'second']] }])
  const code5 = L.serialize(s5); const p5 = L.parse(code5); console.log(code5)
  check(B, 'spec: weird field names reparse clean', p5.errors.length === 0, JSON.stringify(p5.errors))
}
// ---- xlsx via exceljs: shared strings, numbers, merged cells, hidden sheets, formulas
{
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Users')
  ws.addRow(['Field', 'Type', 'Required'])
  ws.addRow(['id', 'obj', true])
  ws.addRow(['name', 'string', false])
  ws.addRow([123, 'num', ''])
  ws.addRow(['age', 'num (18-99)'])
  ws.addRow(['ชื่อ', 'string (ภาษาไทย)'])
  ws.addRow(['f', { formula: '"str"&"ing"', result: 'string' }])
  ws.addRow(['g', { formula: 'A1', result: 'Field' }])
  ws.addRow(['rich', { richText: [{ text: 'str' }, { text: 'ing', font: { bold: true } }] }])
  ws.addRow(['bool', true])
  ws.addRow(['d', new Date('2020-01-01')])
  ws.addRow(['m1','m2']); ws.mergeCells('A12:B12')
  const hid = wb.addWorksheet('Hidden'); hid.state = 'hidden'; hid.addRow(['Field', 'Type']); hid.addRow(['id', 'obj'])
  const veryHidden = wb.addWorksheet('VeryHidden'); veryHidden.state = 'veryHidden'; veryHidden.addRow(['Field', 'Type']); veryHidden.addRow(['id', 'obj'])
  const emptyWs = wb.addWorksheet('Empty')
  const data = wb.addWorksheet('Data (lookup)'); data.addRow(['Code', 'Name']); data.addRow([1, 'a']); data.addRow([2, 'b'])
  const sparse = wb.addWorksheet('Sparse'); sparse.getCell('C3').value = 'Field'; sparse.getCell('D3').value = 'Type'; sparse.getCell('C4').value = 'x'; sparse.getCell('D4').value = 'int'
  const offs = wb.addWorksheet('Offset'); offs.addRow([]); offs.addRow(['Field', 'Type']); offs.addRow(['x', 'int'])
  const titled = wb.addWorksheet('Titled'); titled.addRow(['My collection']); titled.addRow(['Field', 'Type']); titled.addRow(['x', 'int'])
  const buf = await wb.xlsx.writeBuffer()
  fs.writeFileSync('exceljs_shared.xlsx', Buffer.from(buf))
  const sheets = await L.readXlsx(ab(Buffer.from(buf)))
  console.log(sheets.map((s) => `${s.name}: ${JSON.stringify(s.rows)}`).join('\n'))
  check(B, 'xlsx(shared strings): all 10 sheets read', sheets.length === 8, 'got ' + sheets.length)
  const u = sheets.find((s) => s.name === 'Users')
  check(B, 'xlsx: shared strings resolved', u.rows[1][0] === 'id' && u.rows[1][1] === 'obj')
  check(B, 'xlsx: numeric cell as text', u.rows[3][0] === '123')
  check(B, 'xlsx: formula cached value returned', u.rows[6][1] === 'string', JSON.stringify(u.rows[6]))
  check(B, 'xlsx: richText cell concatenated', u.rows[8][1] === 'string', JSON.stringify(u.rows[8]))
  check(B, 'xlsx: boolean cell', u.rows[9][1] === '1' || u.rows[9][1] === 'true', JSON.stringify(u.rows[9]) + ' (t="b" raw 1/0)')
  check(B, 'xlsx: date cell is readable (serial number shown?)', u.rows[10][1] !== '' , JSON.stringify(u.rows[10]))
  check(B, 'xlsx: Thai shared string', u.rows[5][0] === 'ชื่อ' && u.rows[5][1] === 'string (ภาษาไทย)')
  const sp = sheets.find((s) => s.name === 'Sparse'); check(B, 'xlsx: sparse sheet starting at C3: rows array has leading empty rows (header at row index 2)', true, JSON.stringify(sp.rows))
  console.log('sparse isSpec', L.isSpecRows(sp.rows))
  check(B, 'xlsx: sheet with blank first row + header in row 2 is recognized as spec', L.isSpecRows(sheets.find((s) => s.name === 'Offset').rows), JSON.stringify(sheets.find((s) => s.name === 'Offset').rows))
  check(B, 'xlsx: sheet with title row above header recognized as spec', L.isSpecRows(sheets.find((s) => s.name === 'Titled').rows), JSON.stringify(sheets.find((s) => s.name === 'Titled').rows))
  check(B, 'xlsx: sparse sheet (header at C3) recognized', L.isSpecRows(sp.rows), JSON.stringify(sp.rows))
  const hidden = sheets.filter((s) => ['Hidden', 'VeryHidden'].includes(s.name))
  check(B, 'xlsx: hidden sheets are skipped (user hid them)', hidden.length === 0, `hidden sheets imported: ${hidden.map((h) => h.name)}`)
  const { schema, code } = imp(sheets)
  console.log(code)
  const p = L.parse(code); check(B, 'xlsx: whole workbook DSL reparses clean', p.errors.length === 0, JSON.stringify(p.errors.slice(0, 4)))
  check(B, 'xlsx: empty sheet no crash/handled', true, 'tables=' + schema.tables.map((t) => t.name).join(','))
  const un = schema.tables.find((t) => t.name === 'Users')
  check(B, 'xlsx: numeric field name 123 kept', un.fields.some((f) => f.name === '123'))
  // merged cells
  console.log('merged row', JSON.stringify(u.rows[8]))
}
// ---- raw xlsx (inline strings) mimic of school file with weird XML: namespace prefixes, absolute rel targets
{
  const JSZip = (await import('jszip')).default
  async function build({ prefix = '', absTarget = false, noRef = false, sstOnly = false, noRels = false } = {}) {
    const z = new JSZip(); const p = prefix ? prefix + ':' : ''
    z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    z.file('xl/workbook.xml', `<?xml version="1.0"?><${p}workbook xmlns${prefix ? ':' + prefix : ''}="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><${p}sheets><${p}sheet name="A &amp; B" sheetId="1" r:id="rId1"/></${p}sheets></${p}workbook>`)
    z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="${absTarget ? '/xl/worksheets/sheet1.xml' : 'worksheets/sheet1.xml'}"/></Relationships>`)
    const cell = (r, t, v) => noRef ? `<${p}c t="inlineStr"><${p}is><${p}t>${v}</${p}t></${p}is></${p}c>` : `<${p}c r="${r}" t="inlineStr"><${p}is><${p}t>${v}</${p}t></${p}is></${p}c>`
    z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><${p}worksheet xmlns${prefix ? ':' + prefix : ''}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${p}sheetData><${p}row r="1">${cell('A1', 'inlineStr', 'Field')}${cell('B1', 'inlineStr', 'Type')}</${p}row><${p}row r="2">${cell('A2', '', 'id')}${cell('B2', '', 'obj')}</${p}row></${p}sheetData></${p}worksheet>`)
    return await z.generateAsync({ type: 'nodebuffer' })
  }
  for (const [label, opt] of [['plain', {}], ['ns prefix x:', { prefix: 'x' }], ['absolute rel target', { absTarget: true }], ['cells without r= attr', { noRef: true }]]) {
    try {
      const sh = await L.readXlsx(ab(await build(opt)))
      check(B, `xlsx raw: ${label}`, sh.length === 1 && L.isSpecRows(sh[0].rows) && sh[0].name === 'A & B', JSON.stringify(sh))
    } catch (e) { check(B, `xlsx raw: ${label}`, false, e.message) }
  }
  // not an xlsx
  try { await L.readXlsx(ab(Buffer.from('hello'))); check(B, 'xlsx: garbage file throws readable error', false, 'no throw') } catch (e) { check(B, 'xlsx: garbage file throws error', true, e.message) }
  const z = new JSZip(); z.file('x.txt', 'hi'); try { await L.readXlsx(ab(await z.generateAsync({ type: 'nodebuffer' }))); check(B, 'xlsx: zip without workbook throws "Not a valid .xlsx"', false, 'no throw') } catch (e) { check(B, 'xlsx: zip without workbook throws "Not a valid .xlsx"', /valid/.test(e.message), e.message) }
}
L.summary()
fs.writeFileSync('res_B.json', JSON.stringify(L.results))
