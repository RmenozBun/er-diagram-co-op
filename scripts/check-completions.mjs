// Quick sanity check of the editor autocomplete source (no browser needed).
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { dslCompletions } from '../apps/web/src/lib/completions.js'
import { parse, SAMPLE_MONGO } from '@er/schema'

function run(doc, mode) {
  const state = EditorState.create({ doc })
  const src = dslCompletions(() => mode, () => parse(doc))
  const res = src(new CompletionContext(state, doc.length, true))
  return res ? res.options.map((o) => o.label) : null
}
const show = (name, v) => console.log(name.padEnd(34), v ? v.slice(0, 8).join(', ') + (v.length > 8 ? ` … (${v.length})` : '') : v)
show('sql type  "Table t {\n  id "', run('Table t {\n  id ', 'sql'))
show('sql type partial "var"', run('Table t {\n  name var', 'sql'))
show('mongo type', run('Table t {\n  name ', 'mongo'.replace('mongo', 'mongodb')))
show('mongo type has tables', run(SAMPLE_MONGO + '\nTable x {\n  a ', 'mongodb')?.filter((l) => /Address|OrderItem/.test(l)))
show('settings "[ "', run('Table t {\n  id int [', 'sql'))
show('settings after comma', run('Table t {\n  id int [pk, ', 'sql'))
show('ref in settings', run('Table a {\n  id int\n}\nTable t {\n  x int [ref: > ', 'sql'))
show('Ref: target', run('Table a {\n  id int\n}\nRef: ', 'sql'))
show('Ref operator', run('Table a {\n  id int\n}\nRef: a.id ', 'sql'))
show('top-level keyword', run('Ta', 'sql'))
show('inside table first word', run('Table t {\n  ind', 'sql'))
show('comment -> none', run('Table t {\n  id int // ', 'sql'))
show('indexes block -> none', run('Table t {\n  indexes {\n    ', 'sql'))

console.log('--- regression cases from QA ---')
const has = (v, label) => Boolean(v?.includes(label))
console.log('"string[" offers string[] (mongo):', has(run('Table t {\n  tags string[', 'mongodb'), 'string[]'))
console.log('"int[" offers int[] (sql):', has(run('Table t {\n  tags int[', 'sql'), 'int[]'))
console.log('"[" after type still offers settings:', has(run('Table t {\n  id int [', 'sql'), 'pk'))
console.log('Thai field then type:', has(run('Table ผู้ใช้ {\n  ชื่อ ', 'sql'), 'varchar(255)'))
console.log('// inside quotes is not a comment:', has(run("Table t {\n  a int [note: '// x', ", 'sql'), 'pk'))
console.log('no suggestions inside quoted note:', run("Table t {\n  a int [note: 'abc ", 'sql') === null)
console.log('Ref targets quote odd names:', JSON.stringify(run('Table "my table" {\n  "first name" int\n}\nRef: ', 'sql')))
