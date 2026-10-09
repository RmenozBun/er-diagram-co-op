import { S, check, setArea, done } from './h.js'
import initSqlJs from 'sql.js'
import { PGlite } from '@electric-sql/pglite'
import pkg from 'node-sql-parser'
import fs from 'node:fs'
const { Parser } = pkg
const { parse, toSQL } = S
const SQL = await initSqlJs()
const pg = new PGlite()
const mp = new Parser()

const SQL_TYPES = ['int', 'bigint', 'smallint', 'decimal(10,2)', 'numeric(10,2)', 'float', 'double', 'varchar(255)', 'char(10)', 'text', 'boolean', 'date', 'time', 'timestamp', 'datetime', 'uuid', 'json', 'jsonb', 'blob', 'bytea', 'int[]', 'varchar(255)[]']
const OTHER = ['string', 'objectid', 'object', 'bool', 'number', 'mixed', 'buffer', 'binary', 'integer', 'real', 'tinyint', 'mediumtext', 'longtext', 'serial', 'bigserial', 'money', 'varchar', 'char', 'timestamptz', 'year', 'string[]', 'objectid[]', 'double precision', 'float4', 'int4', 'datetime2', 'nvarchar(50)', 'varbinary(16)', 'bit', 'enum', 'Int', 'VARCHAR(20)', 'Text']

const run = async (dialect, sql) => {
  if (dialect === 'sqlite') { const db = new SQL.Database(); try { db.exec(sql); return null } catch (e) { return e.message } }
  if (dialect === 'postgres') { await pg.exec('drop schema public cascade; create schema public;'); try { await pg.exec(sql); return null } catch (e) { return e.message } }
  try { mp.astify(sql, { database: 'mysql' }); return null } catch (e) { return 'parse: ' + e.message.slice(0, 60) }
}
const matrix = {}
for (const [group, types] of [['SQL_TYPES (editor list)', SQL_TYPES], ['other/mongo-ish', OTHER]]) {
  setArea('B type matrix ' + group)
  for (const t of types) {
    const sch = parse(`Table t {\n id int [pk]\n c ${t}\n}\n`)
    for (const d of ['postgres', 'mysql', 'sqlite']) {
      const sql = toSQL(sch, d)
      const err = await run(d, sql)
      matrix[`${group}|${t}|${d}`] = err
      check(`${d}: type "${t}" -> ${sql.match(/"c" ([^\n]*)|`c` ([^\n]*)/)?.slice(1).find(Boolean)}`, !err, err)
    }
  }
}
// defaults matrix
setArea('B defaults matrix')
const defs = [
  ['int', "5"], ['int', '-5'], ['float', '1.5'], ['varchar(10)', "'abc'"], ['varchar(10)', "'it''s'"], ['varchar(10)', "'007'"], ['varchar(10)', "'null'"], ['varchar(10)', "'true'"], ['varchar(10)', "''"],
  ['boolean', 'true'], ['boolean', 'false'], ['timestamp', '`now()`'], ['timestamp', '`current_timestamp`'], ['timestamp', '`CURRENT_TIMESTAMP`'], ['date', '`current_date`'], ['uuid', '`gen_random_uuid()`'], ['uuid', '`uuid_generate_v4()`'], ['int', '`1+2`'], ['varchar(10)', 'abc'], ['varchar(10)', "'a;b'"], ['json', "'{}'"], ['text', "'x'"], ['varchar(10)', "'a,b'"], ['varchar(10)', "'\\\\n'"], ['varchar(10)', '"dq"'], ['int', '1e3'], ['int', '+5'], ['decimal(5,2)', '.5'], ['varchar(20)', "'NULL'"], ['varchar(10)','null'],
]
for (const [type, dflt] of defs) {
  const sch = parse(`Table t {\n id int [pk]\n c ${type} [default: ${dflt}]\n}\n`)
  for (const d of ['postgres', 'sqlite', 'mysql']) {
    const sql = toSQL(sch, d)
    const err = await run(d, sql)
    const line = sql.match(/\n  [`"]c[`"] ([^\n]*)/)?.[1]
    check(`${d}: ${type} default ${dflt} -> ${line}`, !err, err)
  }
}
// value fidelity for tricky defaults on pg and sqlite
setArea('B default fidelity')
for (const [dflt, expected] of [["'null'", 'null'], ["'true'", 'true'], ["'007'", '007'], ["''", ''], ["'NULL'", 'NULL'], ["'1.50'", '1.50'], ["'now()'", 'now()'], ["'-5'", '-5']]) {
  const sch = parse(`Table t {\n id int [pk]\n c varchar(20) [default: ${dflt}]\n}\n`)
  for (const d of ['postgres', 'sqlite']) {
    const sql = toSQL(sch, d)
    let val
    try {
      if (d === 'sqlite') { const db = new SQL.Database(); db.exec(sql); db.run('insert into t(id) values (1)'); val = db.exec('select c from t')[0].values[0][0] } else { await pg.exec('drop schema public cascade; create schema public;'); await pg.exec(sql); await pg.exec('insert into t(id) values (1)'); val = (await pg.query('select c from t')).rows[0].c }
    } catch (e) { val = 'ERR ' + e.message }
    check(`${d}: varchar default ${dflt} stores ${JSON.stringify(expected)}`, val === expected, `got ${JSON.stringify(val)}; ddl line: ${sql.match(/\n  [`"]c[`"] ([^\n]*)/)?.[1]}`)
  }
}
fs.writeFileSync('out/type-matrix.json', JSON.stringify(matrix, null, 1))
done('b2.json')
