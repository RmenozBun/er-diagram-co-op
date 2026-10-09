// Real-engine check of the Mongoose-code workflow: real mongoose + real mongod (mongodb-memory-server).
// Run: cd tests-e2e/mongo && node tG_mongoose_mode.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as L from '../../packages/schema/src/index.js'

const require = createRequire(import.meta.url)
const mongoose = require('mongoose')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
}

mkdirSync('gen', { recursive: true })
const load = async (code, file) => {
  // generated ES module -> file next to node_modules/mongoose so `import mongoose from "mongoose"` resolves
  writeFileSync(file, code)
  return import(pathToFileURL(file).href + '?t=' + Date.now())
}

const server = await MongoMemoryServer.create()
const client = await MongoClient.connect(server.getUri())
try {
  // 1. the user's real model, regenerated from the diagram, is valid Mongoose code
  const original = readFileSync('../../packages/schema/test/fixtures/users.model.js', 'utf8')
  const schema = L.parseMongoose(original)
  // the original imports a helper that is not available here: stub it so the file can be loaded
  const regenerated = 'const nowInBangkok = () => "now";\n' + L.toMongoose(schema).replace('import mongoose from "mongoose";', 'import mongoose from "mongoose";')
  const mod = await load(regenerated, 'gen/mode_users.mjs')
  const User = mod.default
  check('1. regenerated users model loads in real Mongoose', typeof User === 'function' && User.modelName === 'UserModel' && User.collection.name === 'users')
  const good = { username: 'a', password: 'p', CustomerID: 'C1', fullname: 'A B', role: 3, licenseNumbers: [{ professionType: 'x', licenseNumber: '1' }] }
  check('1b. valid document passes validation', (await new User(good).validate().then(() => true, () => false)) === true)
  const missing = await new User({ username: 'a' }).validate().then(() => null, (e) => Object.keys(e.errors))
  check('1c. required fields are enforced', missing?.includes('password') && missing?.includes('CustomerID') && missing?.includes('fullname') && missing?.includes('role'), JSON.stringify(missing))
  check('1d. enum is enforced', (await new User({ ...good, membershipStatus: 'bogus' }).validate().then(() => true, () => false)) === false)
  check('1e. embedded sub-document fields are required', (await new User({ ...good, licenseNumbers: [{ professionType: 'x' }] }).validate().then(() => true, () => false)) === false)

  // 2. validator JSON generated from the same diagram works on a real mongod
  const validator = JSON.parse(L.toValidatorJson(schema))
  const db = client.db('mode_users')
  await db.createCollection('users', { validator })
  const coll = db.collection('users')
  const ins = (doc) => coll.insertOne(doc).then(() => 'ok', (e) => (e.code === 121 ? 'rejected' : e.message))
  check('2. valid document is accepted by the validator', (await ins({ ...good })) === 'ok')
  check('2b. missing required field is rejected', (await ins({ username: 'b' })) === 'rejected')
  check('2c. unknown property is rejected (additionalProperties: false)', (await ins({ ...good, username: 'c', surprise: 1 })) === 'rejected')
  check('2d. wrong enum value is rejected', (await ins({ ...good, username: 'd', membershipStatus: 'bogus' })) === 'rejected')
  check('2e. optional ObjectId reference may be null (as in the model default)', (await ins({ ...good, username: 'e', memberId: null })) === 'ok')
  check('2f. a document created by Mongoose itself passes the validator', await (async () => {
    const m = mongoose.createConnection(server.getUri() + 'mode_users')
    const M = m.model('UserModel2', User.schema, 'users')
    try {
      await M.create({ ...good, username: 'from-mongoose', CustomerID: 'C-M', memberId: null })
      return true
    } catch (e) {
      return e.message
    } finally {
      await m.close()
    }
  })() === true)

  // 3. the hand-made validator from the user (file 2) accepts the same documents as ours
  const handMade = JSON.parse(readFileSync('../../packages/schema/test/fixtures/users_collection_validator.json', 'utf8'))
  const db2 = client.db('mode_users_handmade')
  await db2.createCollection('users', { validator: handMade })
  const both = async (doc) => [await coll.insertOne({ ...doc }).then(() => 'ok', () => 'rejected'), await db2.collection('users').insertOne({ ...doc }).then(() => 'ok', () => 'rejected')]
  const cases = [
    ['valid', { ...good, username: 'v1', CustomerID: 'V1' }],
    ['missing role', { username: 'v2', password: 'p', CustomerID: 'V2', fullname: 'x' }],
    ['extra property', { ...good, username: 'v3', CustomerID: 'V3', nope: 1 }],
    ['bad enum', { ...good, username: 'v4', CustomerID: 'V4', membershipStatus: 'x' }],
    ['bad license item', { ...good, username: 'v5', CustomerID: 'V5', licenseNumbers: [{ professionType: 'x' }] }],
  ]
  for (const [name, doc] of cases) {
    const [ours, theirs] = await both(doc)
    check(`3. ours and the hand-made validator agree on "${name}"`, ours === theirs, `ours=${ours} hand-made=${theirs}`)
  }

  // 4. the SQL <-> Mongo sample conversion produces code that real Mongoose accepts
  mongoose.deleteModel('UserModel') // the sample defines its own UserModel
  const sample = await load(L.SAMPLE_MONGO, 'gen/mode_sample.mjs')
  const { User: U, Order: O } = sample
  check('4. SAMPLE_MONGO loads in real Mongoose', U?.modelName === 'UserModel' && O?.modelName === 'OrderModel')
  check('4b. its reference and embedded array validate', (await new O({ user_id: new mongoose.Types.ObjectId(), items: [{ sku: 'a', qty: 2 }] }).validate().then(() => true, () => false)) === true)
  check('4c. a bad reference is rejected', (await new O({ user_id: 'nope', items: [] }).validate().then(() => true, () => false)) === false)
} catch (e) {
  check('run completed without an exception', false, e.stack)
} finally {
  await client.close()
  await server.stop()
}
console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
