import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import * as L from './lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const require = createRequire(import.meta.url)
export const mongoose = require('mongoose')
fs.mkdirSync(path.join(here, 'gen'), { recursive: true })

let counter = 0
/** Write the toMongoose() output to a file and require it. Returns {models, error, file, code} */
export function loadMongoose(schemaOrDsl, tag = 'm') {
  const schema = typeof schemaOrDsl === 'string' ? L.parse(schemaOrDsl) : schemaOrDsl
  const code = L.toMongoose(schema)
  const file = path.join(here, 'gen', `${tag.replace(/[^\w]+/g, '_')}_${++counter}.cjs`)
  fs.writeFileSync(file, code)
  for (const n of mongoose.modelNames()) mongoose.deleteModel(n)
  try {
    delete require.cache[file]
    const models = require(file)
    return { models, file, code, schema }
  } catch (error) {
    for (const n of mongoose.modelNames()) mongoose.deleteModel(n)
    return { error, file, code, schema }
  }
}

/** validateSync helper: returns array of error paths ([] = valid) */
export function validate(Model, doc) {
  try {
    const d = new Model(doc)
    const e = d.validateSync()
    return e ? Object.keys(e.errors) : []
  } catch (err) {
    return ['!throw:' + err.message.slice(0, 80)]
  }
}

/** Run toMongoShell() output against a real Mongo (driver). Returns {ok, errors[]} */
export async function runShell(db, script) {
  const ops = []
  const mkColl = (name) => ({
    createIndex: (spec, opts) => ops.push(['createIndex', name, spec, opts ?? {}]),
  })
  const dbProxy = new Proxy({}, {
    get(_, prop) {
      if (prop === 'createCollection') return (name, opts) => ops.push(['createCollection', name, opts ?? {}])
      if (prop === 'getCollection') return (n) => mkColl(n)
      return mkColl(String(prop))
    },
  })
  vm.runInNewContext(script, { db: dbProxy }, { timeout: 5000 })
  const errors = []
  for (const op of ops) {
    try {
      if (op[0] === 'createCollection') await db.createCollection(op[1], op[2])
      else await db.collection(op[1]).createIndex(op[2], op[3])
    } catch (e) {
      errors.push(`${op[0]} ${op[1]}: ${e.message.slice(0, 160)}`)
    }
  }
  return { ops: ops.length, errors }
}
