import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseMongoose, toMongoose, toValidatorJson, validatorToSchema, collectionNameFromFile, parseSource, convertSource, parse, serialize,
  mergeMongooseSources, mergeViews, codeToView, viewToCode, convertMongooseModuleStyle, looksLikeMongoose, looksLikeDsl, SAMPLE_MONGO, SAMPLE_SQL, toSQL,
} from '../src/index.js'

const dir = dirname(fileURLToPath(import.meta.url))
const usersModel = readFileSync(join(dir, 'fixtures/users.model.js'), 'utf8')
const usersValidator = JSON.parse(readFileSync(join(dir, 'fixtures/users_collection_validator.json'), 'utf8'))

const field = (schema, table, name) => schema.tables.find((t) => t.name === table).fields.find((f) => f.name === name)
const shape = (schema) =>
  schema.tables.map((t) => ({
    name: t.name,
    embedded: t.embedded,
    fields: t.fields.map((f) => ({ name: f.name, type: f.type, pk: f.pk, unique: f.unique, notNull: f.notNull, enum: f.enum, refModel: f.refModel, default: f.default })),
  }))

describe('Mongoose model files (the real users.model.js)', () => {
  const s = parseMongoose(usersModel)

  it('is read without errors: one collection plus an embedded sub-document', () => {
    expect(s.errors).toEqual([])
    expect(s.tables.map((t) => `${t.name}${t.embedded ? ' (embedded)' : ''}`)).toEqual(['users', 'Certificate (embedded)'])
  })

  it('keeps types, required / unique, enum, defaults, index, ref and embedded arrays', () => {
    const users = s.tables[0]
    expect(users.fields.map((f) => f.name)).toEqual([
      '_id', 'login', 'secret', 'nickname', 'accountCode', 'displayName', 'avatarUrl', 'level', 'active', 'tier', 'partnerId', 'partnerNumber', 'certificates', 'createdOn', 'updatedOn',
    ])
    expect(field(s, 'users', '_id')).toMatchObject({ type: 'objectid', pk: true })
    expect(field(s, 'users', 'login')).toMatchObject({ type: 'string', notNull: true, unique: true })
    expect(field(s, 'users', 'accountCode')).toMatchObject({ unique: true, notNull: true })
    expect(field(s, 'users', 'level')).toMatchObject({ type: 'number', notNull: true })
    expect(field(s, 'users', 'active')).toMatchObject({ default: '1', defaultKind: 'literal' })
    expect(field(s, 'users', 'nickname')).toMatchObject({ default: '', defaultKind: 'string' })
    expect(field(s, 'users', 'tier')).toMatchObject({ enum: ['free', 'silver', 'gold', 'banned'], default: 'free' })
    expect(users.indexes).toEqual([{ fields: ['tier'], unique: false, name: null }])
    expect(field(s, 'users', 'partnerId')).toMatchObject({ type: 'objectid', refModel: 'PartnerModel', default: 'null', defaultKind: 'literal' })
    expect(field(s, 'users', 'createdOn')).toMatchObject({ default: 'nowLocal', defaultKind: 'expr' }) // a function reference
    expect(field(s, 'users', 'certificates').type).toBe('Certificate[]')
    expect(s.tables[1].fields.map((f) => `${f.name}:${f.type}:${f.notNull}`)).toEqual(['kind:string:true', 'code:string:true'])
  })

  it('hooks (pre save / pre update) and the helper import do not disturb it', () => {
    expect(usersModel).toContain("usersSchema.pre('save'")
    expect(s.errors).toEqual([])
  })

  it('regenerates (almost) the same file: parse(toMongoose(x)) == x', () => {
    const code = toMongoose(s)
    expect(code).toContain('const usersSchema = new mongoose.Schema(')
    expect(code).toContain('const User = mongoose.model("UserModel", usersSchema, "users");')
    expect(code).toContain('export default User;')
    expect(code).toContain('login: { type: String, required: true, unique: true },')
    expect(code).toContain('partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "PartnerModel", default: null },')
    expect(code).toContain('enum: ["free", "silver", "gold", "banned"],')
    expect(code).toContain('createdOn: { type: String, default: nowLocal },')
    expect(code).toContain('{ timestamps: false, versionKey: false }')
    expect(shape(parseMongoose(code))).toEqual(shape(s))
  })

  it('exports the $jsonSchema validator in the same form as the hand-made users_collection_validator.json', () => {
    const generated = JSON.parse(toValidatorJson(s))
    const want = usersValidator.$jsonSchema
    const got = generated.$jsonSchema
    expect(got.bsonType).toBe('object')
    expect(got.additionalProperties).toBe(false)
    expect(got.required).toEqual(want.required)
    expect(Object.keys(got.properties)).toEqual(Object.keys(want.properties))
    for (const [name, prop] of Object.entries(want.properties)) {
      expect(got.properties[name].bsonType, name).toEqual(prop.bsonType)
    }
    expect(got.properties.certificates.items.required).toEqual(want.properties.certificates.items.required)
    expect(Object.keys(got.properties.certificates.items.properties)).toEqual(Object.keys(want.properties.certificates.items.properties))
    expect(got.properties.tier.enum).toEqual(expect.arrayContaining(want.properties.tier.enum))
  })
})

describe('validator JSON (users_collection_validator.json) as an import', () => {
  it('is recognised as a validator, not read as sample data', () => {
    const name = collectionNameFromFile('users_collection_validator.json')
    expect(name).toBe('users')
    const s = validatorToSchema(usersValidator, name)
    expect(s.tables.map((t) => t.name)).toEqual(['users', 'Certificate'])
  })

  it('gives the same structure as the Mongoose file', () => {
    const fromJson = validatorToSchema(usersValidator, 'users')
    const fromModel = parseMongoose(usersModel)
    const cmp = (schema) =>
      schema.tables.map((t) => ({ name: t.name, fields: t.fields.map((f) => `${f.name}:${f.type}:${f.notNull}:${(f.enum ?? []).join('|')}`) }))
    expect(cmp(fromJson)).toEqual(cmp(fromModel))
  })

  it('picks up the details that the descriptions mention (unique, default, referenced model)', () => {
    const s = validatorToSchema(usersValidator, 'users')
    expect(field(s, 'users', 'login')).toMatchObject({ unique: true })
    expect(field(s, 'users', 'accountCode')).toMatchObject({ unique: true })
    expect(field(s, 'users', 'nickname')).toMatchObject({ default: '', defaultKind: 'string' })
    expect(field(s, 'users', 'active')).toMatchObject({ default: '1', defaultKind: 'literal' })
    expect(field(s, 'users', 'tier')).toMatchObject({ default: 'free' })
    expect(field(s, 'users', 'partnerId')).toMatchObject({ refModel: 'PartnerModel' })
  })

  it('understands several shapes and ignores non-validators', () => {
    const doc = { $jsonSchema: { bsonType: 'object', properties: { a: { bsonType: 'string' } } } }
    expect(validatorToSchema({ users: doc, posts: doc })?.tables.map((t) => t.name)).toEqual(['users', 'posts'])
    expect(validatorToSchema([{ name: 'x', options: { validator: doc } }])?.tables[0].name).toBe('x')
    expect(validatorToSchema({ a: 1, b: [1, 2] })).toBeNull()
    expect(validatorToSchema([{ name: 'plain document', value: 1 }])).toBeNull()
  })
})

describe('Mongoose syntax variants', () => {
  it('CommonJS, destructured Schema, shorthand types, inline schema, nested objects, timestamps and _id: false', () => {
    const code = `
const mongoose = require('mongoose')
const { Schema } = mongoose
const addressSchema = new Schema({ street: String, city: { type: String, required: true } }, { _id: false })
const postSchema = new Schema({
  title: { type: String, required: [true, 'title is needed'], trim: true, maxlength: 80 },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tags: [String],
  meta: { views: { type: Number, default: 0 }, likes: Number },
  address: addressSchema,
  history: [{ at: Date, by: String }],
  extra: Schema.Types.Mixed,
  price: mongoose.Schema.Types.Decimal128,
  states: [{ type: String, enum: ['a', 'b'] }],
}, { timestamps: true })
const userSchema = new Schema({ name: String })
module.exports = {
  User: mongoose.model('User', userSchema),
  Post: mongoose.models.Post || mongoose.model('Post', postSchema, 'blog_posts'),
}`
    const s = parseMongoose(code)
    expect(s.errors).toEqual([])
    const names = s.tables.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['users', 'blog_posts', 'Address', 'Meta', 'History']))
    expect(field(s, 'blog_posts', 'title')).toMatchObject({ type: 'string', notNull: true })
    expect(field(s, 'blog_posts', 'title').opts).toEqual({ trim: true, maxlength: 80 })
    expect(field(s, 'blog_posts', 'tags').type).toBe('string[]')
    expect(field(s, 'blog_posts', 'meta').type).toBe('Meta')
    expect(field(s, 'blog_posts', 'address').type).toBe('Address')
    expect(field(s, 'blog_posts', 'history').type).toBe('History[]')
    expect(field(s, 'blog_posts', 'extra').type).toBe('json')
    expect(field(s, 'blog_posts', 'price').type).toBe('decimal')
    expect(field(s, 'blog_posts', 'states')).toMatchObject({ type: 'string[]', enum: ['a', 'b'] })
    expect(field(s, 'blog_posts', 'createdAt')).toMatchObject({ type: 'date', note: 'timestamps' }) // added by `timestamps: true`
    expect(s.tables.find((t) => t.name === 'Address').noId).toBe(true)
    expect(s.tables.find((t) => t.name === 'Address').embedded).toBe(true)
    // a ref to a model of the same file becomes a relation
    expect(s.refs).toEqual([{ from: { table: 'blog_posts', field: 'author' }, to: { table: 'users', field: '_id' }, type: '>' }])
  })

  it('reports syntax errors with the right line, and a helpful message when there is no schema', () => {
    const bad = parseMongoose('const a = 1\nconst s = new mongoose.Schema({\n  name: { type: String,\n')
    expect(bad.errors).toHaveLength(1)
    expect(bad.errors[0].line).toBeGreaterThanOrEqual(3)
    expect(parseMongoose('const x = 1').errors[0].message).toMatch(/No mongoose.Schema found/)
    expect(parseMongoose('   ').errors).toEqual([])
  })

  it('Thai text in comments, strings and names is fine', () => {
    const s = parseMongoose('// สคีมาลูกค้า\nconst c = new mongoose.Schema({ ชื่อ: { type: String, default: "ไม่ระบุ" } })\nmongoose.model("ลูกค้า", c, "ลูกค้า")')
    expect(s.errors).toEqual([])
    expect(s.tables[0].name).toBe('ลูกค้า')
    expect(field(s, 'ลูกค้า', 'ชื่อ')).toMatchObject({ default: 'ไม่ระบุ', defaultKind: 'string' })
  })
})

describe('MongoDB mode: the editor holds Mongoose code', () => {
  it('SAMPLE_MONGO is valid Mongoose code that parses into a diagram', () => {
    const s = parseSource(SAMPLE_MONGO, 'mongodb')
    expect(s.errors).toEqual([])
    expect(s.tables.filter((t) => !t.embedded).map((t) => t.name)).toEqual(['users', 'orders'])
    expect(s.refs).toHaveLength(1)
    expect(looksLikeMongoose(SAMPLE_MONGO)).toBe(true)
    expect(looksLikeDsl(SAMPLE_MONGO)).toBe(false)
    expect(looksLikeDsl(SAMPLE_SQL)).toBe(true)
  })

  it('converts SQL DSL <-> Mongoose code (both directions, types renamed)', () => {
    const code = convertSource(SAMPLE_SQL, 'sql', 'mongodb')
    expect(code).toContain('Model User {')
    expect(code).not.toContain('mongoose.model(')
    expect(code).toContain('email: { type: String, required: true, unique: true }')
    expect(parseSource(code, 'mongodb').errors).toEqual([])
    const back = convertSource(code, 'mongodb', 'sql')
    const s = parse(back)
    expect(s.errors).toEqual([])
    expect(field(s, 'users', 'email')).toMatchObject({ type: 'varchar(255)', unique: true, notNull: true })
    expect(field(s, 'users', '_id').type).toBe('varchar(24)')
    expect(toSQL(s, 'postgres')).toContain('create table "users"')
    expect(s.tables.every((t) => !t.note)).toBe(true) // the "Mongoose model" notes are not carried into SQL
  })

  it('enum becomes a CHECK constraint in SQL', () => {
    const s = parse("Table t {\n  status varchar(10) [enum: ['a', 'b\\'c', 1]]\n}")
    expect(s.errors).toEqual([])
    expect(toSQL(s, 'postgres')).toContain(`check ("status" in ('a', 'b''c', 1))`)
    expect(parse(serialize(s)).tables[0].fields[0].enum).toEqual(['a', "b'c", 1])
  })

  it('merging model files keeps a single valid module', () => {
    const a = convertSource(SAMPLE_SQL, 'sql', 'mongodb')
    const b = 'import mongoose from "mongoose";\nconst petSchema = new mongoose.Schema({ name: String });\nconst Pet = mongoose.model("PetModel", petSchema, "pets");\nexport default Pet;\n'
    const merged = mergeViews({ text: a, extras: null }, codeToView(b))
    const full = viewToCode(merged.text, merged.extras)
    expect(full.match(/^import mongoose/gm)).toHaveLength(1)
    expect(full).toContain('export { User, Post, Tag, Pet };')
    expect(parseSource(merged.text, 'mongodb', merged.extras).errors).toEqual([])
    expect(parseMongoose(full).errors).toEqual([])
    expect(parseMongoose(full).tables.map((t) => t.name)).toEqual(expect.arrayContaining(['users', 'pets']))
    // the whole-file merge (older saved projects) still works
    expect(mergeMongooseSources(viewToCode(a), b).match(/^import mongoose/gm)).toHaveLength(1)
  })

  it('ES module <-> CommonJS switch', () => {
    const esm = 'import mongoose from "mongoose";\n\nconst User = mongoose.model("UserModel", usersSchema, "users");\n\nexport default User;\n'
    const cjs = convertMongooseModuleStyle(esm, 'cjs')
    expect(cjs).toContain('const mongoose = require("mongoose");')
    expect(cjs).toContain('module.exports = User;')
    expect(convertMongooseModuleStyle(cjs, 'esm')).toBe(esm)
    expect(convertMongooseModuleStyle('export { A, B };', 'cjs')).toBe('module.exports = { A, B };')
  })
})

describe('module style switch with other imports', () => {
  it('converts every import / require line, not only mongoose', () => {
    const esm = 'import mongoose from "mongoose";\nimport nowLocal from "../clock.js";\nimport { a, b } from "./x.js";\n\nexport default User;\n'
    const cjs = convertMongooseModuleStyle(esm, 'cjs')
    expect(cjs).toBe('const mongoose = require("mongoose");\nconst nowLocal = require("../clock.js");\nconst { a, b } = require("./x.js");\n\nmodule.exports = User;\n')
    expect(convertMongooseModuleStyle(cjs, 'esm')).toBe(esm.replace('{ a, b }', '{ a, b }'))
    expect(convertMongooseModuleStyle(usersModel, 'cjs')).not.toMatch(/^import\s/m)
  })
})

describe('converting a Mongoose diagram to SQL and back', () => {
  it('keeps the collection structure: ObjectIds, enums, required, unique, embedded documents', () => {
    const toSql = convertSource(usersModel, 'mongodb', 'sql')
    const back = parseSource(convertSource(toSql, 'sql', 'mongodb'), 'mongodb')
    expect(back.errors).toEqual([])
    const want = shape(parseMongoose(usersModel))
    const got = shape(back)
    const pick = (s) => s.map((t) => ({ name: t.name, fields: t.fields.map((f) => ({ name: f.name, type: f.type, notNull: f.notNull, unique: f.unique, enum: f.enum })) }))
    expect(pick(got)).toEqual(pick(want))
  })

  it('a plain SQL "id int pk increment" becomes an ObjectId _id in MongoDB', () => {
    const code = convertSource('Table items {\n  id int [pk, increment]\n  name varchar(50) [not null]\n}', 'sql', 'mongodb')
    expect(code).not.toContain('_id:') // `_id` is implicit (ObjectId)
    const s = parseSource(code, 'mongodb')
    expect(s.tables[0].fields[0]).toMatchObject({ name: '_id', type: 'objectid', pk: true })
  })
})
