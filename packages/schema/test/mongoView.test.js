import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseMongoose, parseSource, parseView, parse, serialize, mongoSchemaToSql, toSQL, convertSource, codeToView, viewToCode, mergeViews, splitView, fixCommas, hasViewBlocks, looksLikeFullMongoose, convertDocument, SAMPLE_MONGO,
} from '../src/index.js'

const dir = dirname(fileURLToPath(import.meta.url))
const usersModel = readFileSync(join(dir, 'fixtures/users.model.js'), 'utf8')

const shape = (schema) =>
  schema.tables.map((t) => ({
    name: t.name,
    embedded: t.embedded,
    fields: t.fields.map((f) => ({ name: f.name, type: f.type, pk: f.pk, unique: f.unique, notNull: f.notNull, enum: f.enum, refModel: f.refModel, default: f.default })),
  }))

describe('short form: Model Name { ... }', () => {
  it('shows only the fields of a model file (no import / mongoose.model / export)', () => {
    const { text } = codeToView(usersModel)
    expect(text).toMatch(/^Model User \{/)
    expect(text).toContain('login: { type: String, required: true, unique: true },')
    expect(text).not.toMatch(/import|mongoose\.model|export|\.pre\(/)
  })

  it('draws the same diagram as the full file', () => {
    const { text, extras } = codeToView(usersModel)
    const view = parseSource(text, 'mongodb', extras)
    expect(view.errors).toEqual([])
    expect(shape(view)).toEqual(shape(parseMongoose(usersModel)))
  })

  it('keeps hooks, other imports, options and names for export (full file comes back)', () => {
    const { text, extras } = codeToView(usersModel)
    const full = viewToCode(text, extras)
    expect(full).toContain('import nowLocal from "../clock.js";')
    expect(full).toContain("usersSchema.pre('save'")
    expect(full).toContain('// update updatedOn')
    expect(full).toContain('const User = mongoose.model("UserModel", usersSchema, "users");')
    expect(full).toContain('export default User;')
    expect(full.match(/^import mongoose/gm)).toHaveLength(1)
    // the hooks sit between the schema and the model, as in the original
    expect(full.indexOf('usersSchema.pre')).toBeLessThan(full.indexOf('mongoose.model('))
    expect(shape(parseMongoose(full))).toEqual(shape(parseMongoose(usersModel)))
  })

  it('edits to the fields show up in the exported file, hooks stay', () => {
    const { text, extras } = codeToView(usersModel)
    const edited = text.replace('nickname:', 'handle:')
    const full = viewToCode(edited, extras)
    expect(full).toContain('handle: { type: String')
    expect(full).not.toContain('nickname')
    expect(full).toContain("usersSchema.pre('save'")
  })

  it('CommonJS export', () => {
    const { text, extras } = codeToView(usersModel)
    const cjs = viewToCode(text, extras, { style: 'cjs' })
    expect(cjs).toContain('const mongoose = require("mongoose");')
    expect(cjs).toContain('module.exports = User;')
    expect(cjs).not.toMatch(/^import /m)
  })

  it('handles a model without the const, an inline schema, a sub-schema and a custom collection', () => {
    const code = `const mongoose = require('mongoose');
const { Schema } = mongoose;
const addressSchema = new Schema({ street: String, city: { type: String, required: true } }, { _id: false });
module.exports = mongoose.model('Person', new Schema({ name: String, home: addressSchema }, { timestamps: true }), 'people');`
    const { text, extras } = codeToView(code)
    expect(text).toContain('Schema addressSchema {')
    expect(text).toContain('Model Person [collection: "people"] {')
    const s = parseSource(text, 'mongodb', extras)
    expect(s.errors).toEqual([])
    expect(s.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['people', 'Address']))
    expect(s.tables.find((t) => t.name === 'people').fields.map((f) => f.name)).toEqual(expect.arrayContaining(['name', 'home', 'createdAt', 'updatedAt'])) // timestamps option is kept
    const full = viewToCode(text, extras)
    expect(full).toContain('const { Schema } = mongoose;')
    expect(full).toContain('{ timestamps: true }')
    expect(full).toContain('const Person = mongoose.model("Person", ')
    expect(full).toContain('"people"')
    expect(parseMongoose(full).errors).toEqual([])
  })

  it('a schema written on one line is shown one field per line', () => {
    const { text } = codeToView('import mongoose from "mongoose";\nconst s = new mongoose.Schema({ a: String, b: { type: Number, default: 1 } });\nmongoose.model("A", s, "as");')
    expect(text).toBe('Model A {\n  a: String,\n  b: { type: Number, default: 1 },\n}\n')
  })

  it('a schema that has no options argument keeps Mongoose defaults (versionKey is not forced off)', () => {
    const { text, extras } = codeToView('import mongoose from "mongoose";\nconst s = new mongoose.Schema({ a: String });\nconst A = mongoose.model("A", s, "as");')
    expect(viewToCode(text, extras)).toContain('{},\n);')
  })
})

describe('short form: writing it by hand', () => {
  it('commas between fields are optional', () => {
    const text = `Model Item {
  name: { type: String, required: true }
  price: Number
  tags: [String]
  note: { type: String, default: "a, b" } // trailing comment
  dims: {
    w: Number
    h: Number
  }
}`
    const s = parseView(text)
    expect(s.errors).toEqual([])
    expect(s.tables.find((t) => t.name === 'items').fields.map((f) => f.name)).toEqual(['_id', 'name', 'price', 'tags', 'note', 'dims'])
    expect(s.tables.map((t) => t.name)).toContain('Dims')
    const full = viewToCode(text)
    expect(parseMongoose(full).errors).toEqual([])
    expect(full).toContain('const itemsSchema = new mongoose.Schema(')
    expect(full).toContain('const Item = mongoose.model("ItemModel", itemsSchema, "items");')
  })

  it('fixCommas leaves existing commas and multi-line values alone', () => {
    const body = '\n  a: { type: String },\n  b: {\n    type: [String],\n    default: [],\n  },\n  c: Number\n'
    expect(fixCommas(body)).toBe(body)
    expect(fixCommas('\n  a: String\n  b: Number\n')).toBe('\n  a: String,\n  b: Number\n')
  })

  it('reports errors on the line the editor shows', () => {
    const text = 'Model A {\n  name: String\n}\n\nModel B {\n  x: { type: String,, }\n}\n'
    const s = parseView(text)
    expect(s.errors).toHaveLength(1)
    expect(s.errors[0].line).toBe(6)
  })

  it('reports stray text, a missing brace and duplicate names', () => {
    expect(parseView('hello\nModel A {\n  x: String\n}').errors[0]).toMatchObject({ line: 1 })
    expect(parseView('Model A {\n  x: String\n').errors[0]).toMatchObject({ line: 1, message: expect.stringContaining('closing') })
    const dup = parseView('Model A {\n x: String\n}\nModel A {\n y: String\n}')
    expect(dup.errors[0]).toMatchObject({ line: 4, message: expect.stringContaining('twice') })
    expect(dup.tables).toHaveLength(1)
  })

  it('no text and comment-only text are an empty diagram, not an error', () => {
    expect(parseView('').errors).toEqual([])
    expect(parseView('// nothing yet\n').errors).toEqual([])
  })

  it('braces and quotes inside strings and regular expressions do not end a block', () => {
    const text = 'Model A {\n  a: { type: String, match: /^[}{]+$/, default: "}" }\n  b: { type: String, default: \'{\' }\n}\nModel B {\n  x: Number\n}'
    const { blocks, errors } = splitView(text)
    expect(errors).toEqual([])
    expect(blocks.map((b) => b.name)).toEqual(['A', 'B'])
  })

  it('refs by model name draw a relation; Thai names work', () => {
    const text = `Model ลูกค้า {
  ชื่อ: { type: String, required: true }
}
Model Order {
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "ลูกค้าModel" }
}`
    const s = parseView(text)
    expect(s.errors).toEqual([])
    expect(s.refs).toHaveLength(1)
  })
})

describe('short form: conversions, legacy text and merging', () => {
  it('the sample is short-form text', () => {
    expect(hasViewBlocks(SAMPLE_MONGO)).toBe(true)
    expect(looksLikeFullMongoose(SAMPLE_MONGO)).toBe(false)
    expect(SAMPLE_MONGO).not.toMatch(/^import|mongoose\.model\(/m)
  })

  it('a whole Mongoose file saved by an older version is still drawn', () => {
    expect(looksLikeFullMongoose(usersModel)).toBe(true)
    const s = parseSource(usersModel, 'mongodb')
    expect(s.errors).toEqual([])
    expect(s.tables[0].name).toBe('users')
  })

  it('SQL -> MongoDB writes short form and keeps composite indexes in the extras', () => {
    const { code, extras } = convertDocument({ code: 'Table t {\n  a int\n  b int\n  indexes {\n    (a, b) [unique]\n  }\n}' }, 'sql', 'mongodb')
    expect(code).toContain('Model T [collection: "t"] {')
    expect(extras.models.T.before.join('\n')).toContain('.index({ a: 1, b: 1 }, { unique: true })')
    expect(viewToCode(code, extras)).toMatch(/tSchema\.index\(\{ a: 1, b: 1 \}, \{ unique: true \}\);/)
  })

  it('merging adds models and renames a name that exists already', () => {
    const a = { text: 'Model User {\n  a: String\n}\n', extras: null }
    const b = codeToView('import mongoose from "mongoose";\nconst s = new mongoose.Schema({ b: String });\ns.methods.hi = function () {};\nconst User = mongoose.model("OtherUser", s, "others");\n')
    const merged = mergeViews(a, b)
    expect(merged.text).toContain('Model User {')
    expect(merged.text).toContain('Model User2 [collection: "others"] {')
    const full = viewToCode(merged.text, merged.extras)
    expect(full).toContain('s.methods.hi')
    expect(full).toContain('export { User, User2 };')
    expect(parseMongoose(full).errors).toEqual([])
  })
})

describe('MongoDB -> SQL: the DSL is converted for real, not just renamed', () => {
  const toSqlDsl = () => convertSource(SAMPLE_MONGO, 'mongodb', 'sql')

  it('sub-documents become json columns and their tables disappear', () => {
    const dsl = toSqlDsl()
    expect(dsl).not.toMatch(/embedded|Table Address|Table Item/)
    expect(dsl).toMatch(/address jsonb/)
    expect(dsl).toMatch(/items jsonb/)
    expect(dsl).not.toMatch(/objectid|\bstring\b|\bnumber\b|\bdate\b/)
    const back = parse(dsl)
    expect(back.errors).toEqual([])
    expect(back.tables.map((t) => t.name)).toEqual(['users', 'orders'])
    expect(back.refs).toHaveLength(1)
    expect(toSQL(back, 'postgres')).toContain('"address" jsonb')
  })

  it('DBML: enum fields become Enum blocks, no inline enum and no embedded tables', () => {
    const dbml = serialize(mongoSchemaToSql(parseSource(SAMPLE_MONGO, 'mongodb')), { dbml: true })
    expect(dbml).toContain('Enum users_role {\n  member\n  admin\n}')
    expect(dbml).toContain("role users_role [default: 'member']")
    expect(dbml).not.toMatch(/enum:|embedded|objectid/)
    expect(dbml).toContain('Ref: orders.user_id > users._id')
  })

  it('a table that is only embedded is dropped, a collection that has its own pk is kept', () => {
    const s = parseSource('Model A {\n  b: { x: String }\n}\nModel B {\n  y: String\n}', 'mongodb')
    const sql = mongoSchemaToSql(s)
    expect(sql.tables.map((t) => t.name)).toEqual(['as', 'bs'])
    expect(sql.tables[0].fields.find((f) => f.name === 'b').type).toBe('jsonb')
  })
})

describe('MongoDB -> SQL: defaults that are JavaScript are not written as SQL', () => {
  it('a function default becomes a note, now() stays', () => {
    const s = parseSource('Model T {\n  at: { type: Date, default: Date.now }\n  by: { type: String, default: nowLocal }\n}', 'mongodb')
    const sql = mongoSchemaToSql(s)
    const f = (n) => sql.tables[0].fields.find((x) => x.name === n)
    expect(f('at').default).toBe('now()')
    expect(f('by').default).toBeNull()
    expect(f('by').note).toContain('nowLocal')
    expect(toSQL(sql, 'mysql')).not.toMatch(/nowLocal(?!.*COMMENT)/)
    expect(toSQL(sql, 'mysql')).toMatch(/`at` timestamp/i)
  })
})
