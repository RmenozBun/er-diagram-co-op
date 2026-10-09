import fs from 'fs'
import * as L from './lib.mjs'
import { check } from './lib.mjs'
// Ref target labels produced by fieldTargets(): `${t.name}.${f.name}` - are they parseable?
for (const [t, f] of [['users', '_id'], ['ที่อยู่', 'x'], ['my table', 'y'], ['a', 'first name'], ['a', 'ชื่อ']]) {
  const p = L.parse(`Table "${t}" {\n  "${f}" int\n}\nTable z {\n  k int\n}\nRef: z.k > ${t}.${f}\n`)
  const bad = p.errors.some((e) => /Invalid Ref/.test(e.message))
  check('D autocomplete', `Ref target label "${t}.${f}" (as inserted by completion) parses`, !bad, JSON.stringify(p.errors.map((e) => e.message)))
}
// duplicates between sources in importFiles flow: json collection + spec sheet with same name
{
  const schema = L.emptySchema()
  const s = L.mongoToSchema(L.parseMongoExport('[{"a":1}]', 'USER'))
  schema.tables.push(...s.tables)
  L.specToSchema([{ name: 'USER', rows: [['Field', 'Type'], ['id', 'obj'], ['n', 'string']] }], schema)
  const names = schema.tables.map((t) => t.name)
  const code = L.serialize(schema)
  check('B spec', 'importFiles: spec sheet name equal to an already-imported collection/table -> unique names', new Set(names).size === names.length, 'names=' + names.join() + ' parse errors=' + JSON.stringify(L.parse(code).errors))
}
// two csv/xlsx files whose sheets are specs with same name
{
  const schema = L.emptySchema()
  L.specToSchema([{ name: 'A', rows: [['Field', 'Type'], ['id', 'obj']] }, { name: 'A', rows: [['Field', 'Type'], ['id', 'obj']] }], schema)
  check('B spec', 'two spec sheets with the same name -> unique table names (data sheets get _2 suffix)', new Set(schema.tables.map((t) => t.name)).size === 2, schema.tables.map((t) => t.name).join())
}
// mode detection for a primitive-only spec sheet (replicates files.js condition)
{
  const schema = L.emptySchema()
  L.specToSchema([{ name: 'P', rows: [['Field', 'Type'], ['id', 'string'], ['n', 'num'], ['d', 'datetime'], ['ok', 'bool']] }], schema)
  const detects = schema.tables.some((t) => t.fields.some((f) => /^(object|objectid)(\[\])?$/.test(f.type) || f.type.endsWith('[]')))
  console.log('primitive-only spec -> DSL types', schema.tables[0].fields.map((f) => f.type).join(','), '| files.js sets mode=mongodb:', detects)
  check('B spec', 'primitive-only spec sheet (string/int/date/bool) switches app to MongoDB mode', detects, 'mode stays null/unchanged; types string/bool are not valid SQL types either')
  const sql = L.toSQL(schema, 'postgres')
  console.log(sql.split('\n').slice(0, 8).join('\n'))
}
// spec importer with newline in Note / cells (multi-line Excel cell)
{
  const { schema, code } = L.importRows([{ name: 'T', rows: [['Field', 'Type'], ['id', 'obj'], ['a', 'string (line1\nline2)'], ['Note', 'first line\nsecond line'], ['b', "string (user's id)"]] }])
  const p = L.parse(code)
  console.log(code)
  check('B spec', 'multi-line cell in type hint / Note row does not corrupt the generated DSL', p.errors.length === 0, JSON.stringify(p.errors))
  check('B spec', "apostrophe in hint (user's id) keeps note & field intact", p.tables[0]?.fields.find((f) => f.name === 'b')?.type === 'string', JSON.stringify(p.tables[0]?.fields.find((f) => f.name === 'b')?.type))
}
// 'string (detail)' where 'detail' is another sheet's name => unintended ref
{
  const { schema } = L.importRows([{ name: 'detail', rows: [['Field', 'Type'], ['id', 'obj']] }, { name: 'T', rows: [['Field', 'Type'], ['id', 'obj'], ['status', 'string (detail)'], ['kind', 'num (detail)'], ['x', 'date (detail)']] }])
  console.log('hint equal to sheet name -> refs', JSON.stringify(schema.refs))
  check('B spec', 'a plain parenthetical hint that equals another sheet name is not silently turned into a relation for non-string types (date/num)', !schema.refs.some((r) => r.from.field === 'x' || r.from.field === 'kind'), JSON.stringify(schema.refs.map((r) => r.from.field)))
}
// dup/ID: `id obj` + a ref field
{
  const { schema } = L.importRows([{ name: 'A', rows: [['Field', 'Type'], ['id', 'obj'], ['parent', 'string (ref: A)']] }])
  console.log('self ref ->', JSON.stringify(schema.refs), L.toMongoose(schema).split('\n').filter((l) => /parent/.test(l)).join(''))
}
L.summary()
fs.writeFileSync('res_F.json', JSON.stringify(L.results))
