import fs from 'fs'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { dslCompletions } from '../../apps/web/src/lib/completions.js'
import * as L from './lib.mjs'
import { check } from './lib.mjs'
const D = 'D autocomplete'

function run(docWithCursor, mode = 'mongodb', explicit = false) {
  const pos = docWithCursor.indexOf('|')
  const doc = docWithCursor.replace('|', '')
  const state = EditorState.create({ doc })
  const src = dslCompletions(() => mode, () => L.parse(doc))
  let res
  try { res = src(new CompletionContext(state, pos, explicit)) } catch (e) { return { error: e.message } }
  if (!res) return null
  return { from: res.from, replaced: doc.slice(res.from, pos), labels: res.options.map((o) => o.label), opts: res.options }
}
const has = (r, ...l) => r && !r.error && l.every((x) => r.labels.includes(x))
const MG = `Table users {
  _id objectid [pk]
  address Address
}
Table Address [embedded] {
  street string
}
Table OrderItem [embedded] {
  sku string
}
Table "ที่อยู่" [embedded] {
  x int
}
Table "my table" {
  y int
}
`
const T = (s) => MG + s

// type position
let r = run(T('Table t {\n  a |\n}'), 'mongodb')
check(D, 'mongo: type list has primitive mongo types', has(r, 'string', 'int', 'objectid', 'date', 'string[]', 'objectid[]'), JSON.stringify(r?.labels?.slice(0, 5)))
check(D, 'mongo: tables offered as embedded types', has(r, 'Address', 'OrderItem', 'users'))
check(D, 'mongo: `Name[]` variants offered', has(r, 'Address[]', 'OrderItem[]', 'users[]'))
check(D, 'mongo: SQL-only types (varchar(255), bigint) NOT offered', r && !r.labels.includes('varchar(255)') && !r.labels.includes('bigint'))
check(D, 'mongo: Thai table name offered as type (label)', has(r, 'ที่อยู่'), 'labels with Thai: ' + r?.labels?.filter((l) => /[ก-๙]/.test(l)))
check(D, 'mongo: table with space offered with usable text (quoted?)', r?.labels?.some((l) => l === '"my table"' || l === 'my table'), 'label=' + JSON.stringify(r?.labels?.filter((l) => /my/.test(l))))
const myt = r?.opts?.find((o) => /my table/.test(o.label)); console.log('space table label ->', JSON.stringify(myt?.label), '(inserting an unquoted name with space as a type: parse ok?)')
check(D, 'mongo: embedded tables have higher boost than primitives', r && r.opts.find((o) => o.label === 'Address').boost > r.opts.find((o) => o.label === 'string').boost)
check(D, 'mongo: the table being edited (t) is offered for self-embedding', true, 'labels include t? ' + r?.labels?.includes('t'))
r = run(T('Table t {\n  a Add|\n}'))
check(D, 'partial "Add" -> from replaces typed word & Address in list', r && r.replaced === 'Add' && r.labels.includes('Address'), JSON.stringify([r?.replaced]))
r = run(T('Table t {\n  a addr|\n}'))
check(D, 'partial lowercase "addr" still replaces typed word (CM filters case-insens.)', r && r.replaced === 'addr')
r = run(T('Table t {\n  a Address[|\n}'))
console.log('typing "Address[" ->', r && r.labels.slice(0, 5), 'replaced=', r?.replaced)
check(D, 'cursor after "Address[" offers Address[] type completion (not settings)', r && r.labels.includes('Address[]'), 'labels=' + JSON.stringify(r?.labels?.slice(0, 6)) + ' (the `[` is treated as the start of a settings block)')
r = run(T('Table t {\n  a string[|\n}'))
check(D, 'cursor after "string[" offers string[] (not pk/unique settings)', r && r.labels.includes('string[]'), 'labels=' + JSON.stringify(r?.labels?.slice(0, 6)))
r = run(T('Table t {\n  a string[]|\n}'))
check(D, 'cursor after "string[]" completes type list (replaced=string[])', r && r.replaced === 'string[]', JSON.stringify(r && [r.replaced, r.labels.slice(0, 3)]))
r = run(T('Table t {\n  a string[] |\n}'), 'mongodb', true)
console.log('after "string[] " explicit ->', r && r.labels.slice(0, 5))
r = run(T('Table t {\n  a string |\n}'), 'mongodb', true)
console.log('after "string " explicit ->', r && r.labels.slice(0, 5))
check(D, 'after type + space (explicit Ctrl-Space) offers settings or nothing, not types again', !r || !r.labels.includes('string'), JSON.stringify(r?.labels?.slice(0, 4)))
// settings
r = run(T('Table t {\n  a string [|\n}'))
check(D, 'after "[" offers settings', has(r, 'pk', 'unique', 'not null', 'default: ', 'note: ', 'ref: > '))
r = run(T('Table t {\n  a objectid [ref: > |\n}'))
check(D, 'inline ref offers table.field targets', has(r, 'users._id', 'Address.street'), JSON.stringify(r?.labels?.slice(0, 4)))
check(D, 'inline ref offers Thai / spaced table targets quoted?', r?.labels?.some((l) => /ที่อยู่\.x|my table/.test(l)), JSON.stringify(r?.labels?.filter((l) => /ที่|my/.test(l))) + ' (name with space would need quotes: "my table".y)')
r = run(T('Table t {\n  a string [pk, |\n}'))
check(D, 'after comma offers settings', has(r, 'unique'))
r = run(T('Table t {\n  a string [note: \'te|\n}'))
console.log('inside note string ->', r && r.labels.slice(0, 5))
check(D, 'cursor inside quoted note string offers nothing', !r, JSON.stringify(r?.labels?.slice(0, 5)))
r = run(T('Table t {\n  a string [default: \'x, |\n}'))
check(D, 'cursor inside quoted default after a comma offers nothing (comma in string)', !r, JSON.stringify(r?.labels?.slice(0, 5)))
r = run(T('Table t {\n  a string [pk] |\n}'), 'mongodb', true)
check(D, 'after "]" (explicit) offers nothing', !r, JSON.stringify(r?.labels?.slice(0, 5)))
r = run(T('Table t {\n  a string [pk]|\n}'))
check(D, 'right after "]" offers nothing', !r, JSON.stringify(r?.labels?.slice(0, 5)))
// comments
r = run(T('Table t {\n  a string // some com|\n}'), 'mongodb', true)
check(D, 'inside // comment -> none', !r)
r = run(T('// comment Tab|\n'), 'mongodb', true); check(D, 'top-level // comment -> none', !r)
r = run(T('Table t {\n  a str|ing // c\n}'))
console.log('mid-line cursor "a str|ing" ->', r && [r.replaced, r.labels.slice(0, 3)])
r = run(T('Table t {\n  a string // x [|\n}'), 'mongodb', true); check(D, 'bracket inside comment -> none', !r)
r = run(T('Table t {\n  a string [note: \'// not a comment\', |\n}'), 'mongodb', true)
console.log('"//" inside a quoted note then comma ->', r && r.labels.slice(0, 3))
check(D, '"//" inside quoted note is not treated as comment (settings offered after comma)', !!r, 'completion source regex /\\/\\// ignores quotes -> returns none')
// indexes block
r = run(T('Table t {\n  a int\n  indexes {\n    (|\n  }\n}'), 'mongodb', true)
console.log('indexes block ->', r && r.labels.slice(0, 5))
check(D, 'indexes block: no completion at all (could offer the table\'s field names)', !r, 'returns null always; field-name suggestions inside indexes would help')
// top-level & line start
r = run('Ta|', 'mongodb'); check(D, 'top-level: Table snippet', has(r, 'Table', 'Ref'))
r = run(T('Table t {\n  ind|\n}'), 'mongodb'); check(D, 'inside table at line start: indexes snippet', has(r, 'indexes'))
const snip = run('Ta|', 'mongodb')?.opts?.find((o) => o.label === 'Table'); console.log('snippet apply type', typeof snip?.apply)
r = run('|', 'mongodb', true); console.log('empty doc explicit ->', r && r.labels)
// Ref lines
r = run(T('Ref: |'), 'mongodb', true); check(D, 'Ref: offers table.field', has(r, 'users._id'))
r = run(T('Ref: users._id |'), 'mongodb', true); check(D, 'Ref operator list', has(r, '>', '<', '-', '<>'))
r = run(T('Ref: users._id > |'), 'mongodb', true); check(D, 'Ref: after operator offers targets', has(r, 'users._id'), JSON.stringify(r?.labels?.slice(0, 3)))
r = run(T('Ref: users._id > Add|'), 'mongodb', true); check(D, 'Ref: partial target', has(r, 'Address.street') && r.replaced === 'Add', JSON.stringify(r && [r.replaced]))
r = run(T('Ref: users._id <> |'), 'mongodb', true); check(D, 'Ref: after <> offers targets', has(r, 'users._id'), JSON.stringify(r?.labels?.slice(0, 3)))
r = run(T('Ref: "my table".y > |'), 'mongodb', true); console.log('Ref after quoted table ->', r && r.labels.slice(0, 3))
// Thai identifiers
r = run(T('Table t {\n  "ที่อยู่" |\n}'), 'mongodb', true); check(D, 'Thai quoted field name: type list offered', has(r, 'string'), JSON.stringify(r?.labels?.slice(0, 3)))
r = run(T('Table t {\n  ที่อยู่ |\n}'), 'mongodb', true); check(D, 'Thai UNQUOTED field name: type list offered', has(r, 'string'), JSON.stringify(r?.labels?.slice(0, 3)) + ' (regex [\\w$]+ is ASCII-only, and the parser rejects unquoted Thai too)')
r = run(T('Table t {\n  "first name" |\n}'), 'mongodb', true); check(D, 'quoted field name with space: type list offered', has(r, 'string'))
r = run(T('Table t {\n  a ที่|\n}'), 'mongodb'); console.log('Thai partial type ->', r && [r.replaced, r.labels.slice(0, 3)])
check(D, 'Thai partial type "ที่" replaces the typed Thai chars (from)', r && r.replaced === 'ที่', JSON.stringify(r && r.replaced) + ' (validFor/regex uses \\w)')
r = run(T('Table ที่|'), 'mongodb', true); console.log('Thai after Table ->', r && r.labels)
r = run(T('Table t {\n  ชื่อ|\n}'), 'mongodb'); console.log('Thai at line start ->', r && r.labels)
// other
r = run('Table t {\n  a |\n}', 'mongodb'); check(D, 'schema with a parse error in rest of doc still completes', has(r, 'string'))
r = run('Table t {\n  a |', 'mongodb'); check(D, 'unclosed table still completes types', has(r, 'string'))
r = run(T('Table t {\n  a |\n}'), 'sql'); check(D, 'sql mode: tables NOT offered as types, SQL types shown', r && has(r, 'varchar(255)') && !r.labels.includes('Address'))
r = run(T('Table t {\n  a x|\n}'), 'mongodb'); console.log('unknown prefix "x" ->', r && r.labels.length, 'options (CodeMirror filters client side)')
r = run(T('Table t {\n  a int[|\n}'), 'sql'); console.log('sql "int[" ->', r && r.labels.slice(0, 3))
r = run(T('Table t {\n  a decimal(|\n}'), 'sql'); console.log('sql "decimal(" ->', r && [r.replaced, r.labels.slice(0, 3)])
r = run(T('Table t {\n  a string [pk, unique, not null, default: 1, note: \'z\', ref: > users._id] |\n}'), 'mongodb', true); check(D, 'after full settings list -> none', !r)
r = run(T('Table t {\n  a string [ref: <> |\n}'), 'mongodb'); check(D, 'inline ref with <> operator', has(r, 'users._id'), JSON.stringify(r?.labels?.slice(0, 3)))
r = run(T('Table t {\n  a string [ref: > users.|\n}'), 'mongodb'); console.log('inline ref "users." ->', r && [r.replaced, r.labels.slice(0, 3)])
check(D, 'inline ref "users." keeps from at start of users. (replaces typed text)', r && r.replaced === 'users.', JSON.stringify(r && r.replaced))
// every type suggested in Mongo mode must be understood by generators (no silent fallback to String)
{
  const MONGO_TYPES = ['string', 'int', 'long', 'double', 'decimal', 'bool', 'date', 'objectid', 'object', 'json', 'buffer', 'string[]', 'int[]', 'double[]', 'objectid[]', 'object[]']
  const dsl = 'Table t {\n' + MONGO_TYPES.map((t, i) => `  f${i} ${t}`).join('\n') + '\n}'
  const code = L.toMongoose(L.parse(dsl))
  const shell = L.toMongoShell(L.parse(dsl))
  console.log(code.split('\n').filter((l) => /f\d+:/.test(l)).join('\n'))
  const rows = MONGO_TYPES.map((t, i) => [t, (code.match(new RegExp(`f${i}: (.*),`)) ?? [])[1], (shell.match(new RegExp(`"f${i}": \\{[^}]*"bsonType": "(\\w+)"`)) ?? [])[1]])
  console.log(rows.map((x) => x.join(' => ')).join('\n'))
}
L.summary()
fs.writeFileSync('res_D.json', JSON.stringify(L.results))
