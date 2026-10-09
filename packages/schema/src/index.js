export * from './model.js'
export { parse } from './parser.js'
export { serialize } from './serializer.js'
export { deriveRelations, embeddedTarget, rootTables } from './relations.js'
export { toSQL, SQL_DIALECTS } from './generators/sql.js'
export { toMongoose, toMongoShell } from './generators/mongo.js'
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

export const SAMPLE_MONGO = `// MongoDB: a field whose type is another table = embedded sub-document
Table users {
  _id objectid [pk]
  email string [unique, not null]
  address Address
  tags string[]
}

Table Address [embedded] {
  street string
  city string
  zip string
}

Table orders {
  _id objectid [pk]
  user_id objectid [not null]
  items OrderItem[]
  total double
  created_at date
}

Table OrderItem [embedded] {
  sku string
  qty int
  price double
}

Ref: orders.user_id > users._id
`

export { sqlTypeToMongo, tablesToMongo, normalizeImportedType } from './types.js'
