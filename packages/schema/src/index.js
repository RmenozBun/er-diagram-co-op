import { parse as _parse } from './parser.js'
import { toMongooseView as _toMongooseView } from './mongoView.js'
export * from './model.js'
export { parse } from './parser.js'
export { serialize } from './serializer.js'
export { deriveRelations, embeddedTarget, rootTables } from './relations.js'
export { toSQL, SQL_DIALECTS } from './generators/sql.js'
export { toMongoose, toMongoShell, toValidatorJson, convertMongooseModuleStyle, mergeMongooseSources } from './generators/mongo.js'
export { parseMongoose, looksLikeMongoose, looksLikeDsl } from './importers/mongoose.js'
export { parseCsv, toCsv, csvToSchema, rowsToSchema, inferType } from './importers/csv.js'
export { isSpecRows, specToSchema, parseSpecType, findSpecHeader } from './importers/spec.js'
export { ddlToSchema } from './importers/ddl.js'
export { parseMongoExport, mongoToSchema } from './importers/mongoJson.js'
export { schemaToCsv, tablesToCsvFiles } from './exporters.js'

export const SAMPLE_SQL = `// Use this DSL like dbdiagram.io
Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
  name varchar(100)
  created_at timestamp [default: \`now()\`]
}

Table posts {
  id int [pk, increment]
  user_id int [not null]
  title varchar(200) [not null]
  body text
}

Table tags {
  id int [pk, increment]
  name varchar(50) [unique]
}

Ref: posts.user_id > users.id
Ref: posts.id <> tags.id
`

export { sqlTypeToMongo, tablesToMongo, mongoTypeToSql, tablesToSql, mongoSchemaToSql, normalizeImportedType } from './types.js'
export { validatorToSchema, findValidators, collectionNameFromFile } from './importers/validator.js'
export { parseSource, convertSource, convertDocument } from './source.js'
export { parseView, viewToCode, codeToView, toMongooseView, mergeViews, splitView, hasViewBlocks, looksLikeFullMongoose, fixCommas } from './mongoView.js'

/** The same example as DSL text (used by tests and by the SQL <-> MongoDB conversions). */
export const SAMPLE_MONGO_DSL = `// MongoDB example: a field whose type is another table = embedded sub-document
Table users {
  _id objectid [pk]
  email string [unique, not null]
  name string [not null]
  role string [default: 'member', enum: ['member', 'admin']]
  address Address
  tags string[]
  createdAt date [default: \`now()\`]
}

Table Address [embedded] {
  street string
  city string
  zip string
}

Table orders {
  _id objectid [pk]
  user_id objectid [not null]
  status string [default: 'new', enum: ['new', 'paid', 'shipped']]
  items OrderItem[]
  total number [default: 0]
  createdAt date [default: \`now()\`]
}

Table OrderItem [embedded] {
  sku string [not null]
  qty number [not null, default: 1]
  price number
}

Ref: orders.user_id > users._id
`

/** Example shown in MongoDB mode: users with an embedded address, orders that reference users (short Mongoose form). */
export const SAMPLE_MONGO =
  '// MongoDB mode: one Model per collection, fields written like a mongoose.Schema. Edit it and the diagram follows.\n' +
  '// Import real Mongoose model files (.js) from the Import menu; Export > Mongoose writes the full file.\n\n' +
  _toMongooseView(_parse(SAMPLE_MONGO_DSL)).text
