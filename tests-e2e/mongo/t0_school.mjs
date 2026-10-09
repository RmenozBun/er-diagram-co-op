import fs from 'fs'
import * as L from './lib.mjs'
const buf = fs.readFileSync('C:/Users/User/Downloads/schoole_er_diagram_na.xlsx')
const sheets = await L.readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength))
for (const s of sheets) { console.log('==', s.name, s.rows.length, L.isSpecRows(s.rows)); for (const r of s.rows) console.log(JSON.stringify(r)) }
const { schema, code } = L.importRows(sheets)
console.log(code)
console.log('reparse errors', L.parse(code).errors)
console.log(L.toMongoose(schema))
console.log(L.toMongoShell(schema))
