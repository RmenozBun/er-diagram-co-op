import { describe, it, expect } from 'vitest'
import {
  parse, serialize, toSQL, toMongoose, toMongoShell, csvToSchema, parseCsv, ddlToSchema,
  mongoToSchema, parseMongoExport, deriveRelations, rootTables, schemaToCsv, SAMPLE_SQL, SAMPLE_MONGO_DSL, isSpecRows, specToSchema,
} from '../src/index.js'

describe('parser', () => {
  it('parses the SQL sample without errors', () => {
    const s = parse(SAMPLE_SQL)
    expect(s.errors).toEqual([])
    expect(s.tables.map((t) => t.name)).toEqual(['users', 'posts', 'tags'])
    const email = s.tables[0].fields[1]
    expect(email).toMatchObject({ name: 'email', type: 'varchar(255)', unique: true, notNull: true })
    expect(s.tables[0].fields[3].default).toBe('now()')
    expect(s.refs).toHaveLength(2)
  })

  it('supports inline refs, indexes, notes, array types', () => {
    const s = parse(`
Table a {
  id int [pk]
  tags string[] [note: 'hello, world']
}
Table b {
  id int [pk]
  a_id int [ref: > a.id]
  indexes {
    (id, a_id) [unique]
    a_id
  }
}`)
    expect(s.errors).toEqual([])
    expect(s.tables[0].fields[1]).toMatchObject({ type: 'string[]', note: 'hello, world' })
    expect(s.refs[0]).toMatchObject({ from: { table: 'b', field: 'a_id' }, to: { table: 'a', field: 'id' }, type: '>' })
    expect(s.tables[1].indexes).toEqual([
      { fields: ['id', 'a_id'], unique: true, name: null },
      { fields: ['a_id'], unique: false, name: null },
    ])
  })

  it('collects errors instead of throwing', () => {
    const s = parse('Table x {\n  id\n}\nRef: a.b > c.d\nbogus')
    expect(s.errors.length).toBeGreaterThanOrEqual(3)
  })

  it('round-trips through serialize', () => {
    const a = parse(SAMPLE_SQL)
    const b = parse(serialize(a))
    expect(b.errors).toEqual([])
    expect(b.tables).toEqual(a.tables)
    expect(b.refs).toEqual(a.refs)
  })
})

describe('sql generator', () => {
  const s = parse(SAMPLE_SQL)
  it('postgres', () => {
    const sql = toSQL(s, 'postgres')
    expect(sql).toContain('"id" serial primary key')
    expect(sql).toContain('"email" varchar(255) not null unique')
    expect(sql).toContain('foreign key ("user_id") references "users" ("id")')
    expect(sql).toContain('create table "posts_tags"')
  })
  it('mysql', () => {
    const sql = toSQL(s, 'mysql')
    expect(sql).toContain('`id` int auto_increment primary key')
  })
  it('sqlite', () => {
    expect(toSQL(s, 'sqlite')).toContain('"id" integer primary key autoincrement')
  })
})

describe('mongo generator', () => {
  const s = parse(SAMPLE_MONGO_DSL)
  it('has no parse errors and 2 root tables', () => {
    expect(s.errors).toEqual([])
    expect(rootTables(s).map((t) => t.name)).toEqual(['users', 'orders'])
    expect(deriveRelations(s).filter((r) => r.kind === 'embed')).toHaveLength(2)
  })
  it('mongoose with sub-documents and refs', () => {
    const js = toMongoose(s)
    expect(js).toContain('mongoose.model("UserModel", usersSchema, "users")')
    expect(js).toContain('ref: "UserModel"')
    expect(js).toContain('type: [{')
    expect(js).toContain('city: { type: String }')
  })
  it('mongosh validator', () => {
    const sh = toMongoShell(s)
    expect(sh).toContain('db.createCollection("users"')
    expect(sh).toMatch(/"bsonType": \[\s*"array"/)
    expect(sh).toContain('db.users.createIndex({ email: 1 }, { unique: true })')
  })
})

describe('importers', () => {
  it('csv -> table with inferred types', () => {
    const csv = 'id,name,price,active,created\r\n1,"Smith, J",9.5,true,2024-01-02\r\n2,Bob,10.25,false,2024-01-03\r\n'
    expect(parseCsv(csv)[1][1]).toBe('Smith, J')
    const s = csvToSchema('products.csv', csv)
    const t = s.tables[0]
    expect(t.name).toBe('products')
    expect(t.fields.map((f) => f.type)).toEqual(['int', 'varchar(255)', 'double', 'boolean', 'date'])
    expect(t.fields[0].pk).toBe(true)
  })

  it('sql dump -> schema', () => {
    const s = ddlToSchema(`
      -- comment
      CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, created timestamp DEFAULT now());
      CREATE TABLE \`posts\` (
        id int NOT NULL AUTO_INCREMENT,
        user_id int NOT NULL,
        title varchar(200),
        PRIMARY KEY (id),
        CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB;
      INSERT INTO users VALUES (1,'a','b');
      CREATE INDEX idx_title ON posts (title);
    `)
    expect(s.tables.map((t) => t.name)).toEqual(['users', 'posts'])
    expect(s.tables[0].fields[0]).toMatchObject({ pk: true, increment: true, type: 'int' })
    expect(s.tables[0].fields[1]).toMatchObject({ unique: true, notNull: true, type: 'varchar(255)' })
    expect(s.tables[1].fields[0]).toMatchObject({ pk: true, increment: true })
    expect(s.refs).toEqual([{ from: { table: 'posts', field: 'user_id' }, to: { table: 'users', field: 'id' }, type: '>' }])
    expect(s.tables[1].indexes[0]).toMatchObject({ fields: ['title'], name: 'idx_title' })
    // and it can be re-parsed from the DSL
    expect(parse(serialize(s)).errors).toEqual([])
  })

  it('mongo export -> schema with embedded tables', () => {
    const docs = parseMongoExport(
      '{"_id":{"$oid":"507f1f77bcf86cd799439011"},"name":"A","address":{"city":"X","zip":"1"},"items":[{"sku":"a","qty":1}]}\n{"_id":{"$oid":"507f1f77bcf86cd799439012"},"name":"B","address":{"city":"Y"},"items":[]}',
      'orders',
    )
    const s = mongoToSchema(docs)
    const text = serialize(s)
    const re = parse(text)
    expect(re.errors).toEqual([])
    const orders = re.tables.find((t) => t.name === 'orders')
    expect(orders.fields.find((f) => f.name === '_id')).toMatchObject({ type: 'objectid', pk: true })
    expect(orders.fields.find((f) => f.name === 'address').type).toBe('OrdersAddress')
    expect(orders.fields.find((f) => f.name === 'items').type).toBe('OrdersItem[]')
    expect(rootTables(re).map((t) => t.name)).toEqual(['orders'])
  })

  it('schema -> csv', () => {
    const csv = schemaToCsv(parse(SAMPLE_SQL))
    expect(csv.split('\r\n')[0]).toBe('table,field,type,primary_key,unique,not_null,default,references,note')
    expect(csv).toContain('posts,user_id,int')
  })
})

describe('schema-spec sheets (Field/Type)', () => {
  const sheet = (name, rows) => ({ name, rows: [['Field', 'Type'], ...rows] })
  const sheets = [
    sheet('SCHOOL', [['id', 'obj'], ['detail', 'obj'], ['contact', 'array(obj)'], ['createBy', 'string (user)'], ['createAt', 'datetime']]),
    sheet('USER', [['id', 'obj'], ['username', 'string'], ['role', 'num (3 roles)'], ['active', 'num (0,1)']]),
    sheet('TRACKING', [['id', 'obj'], ['schoolId', 'string (ref: SCHOOL)'], ['product', 'array'], ['Note', 'only creator can edit']]),
  ]

  it('detects spec rows', () => {
    expect(isSpecRows([['Field', 'Type'], ['id', 'obj']])).toBe(true)
    expect(isSpecRows([['id', 'name'], ['1', 'a']])).toBe(false)
  })

  it('maps types, notes and relations', () => {
    const s = specToSchema(sheets)
    const school = s.tables.find((t) => t.name === 'SCHOOL')
    expect(school.fields.map((f) => f.type)).toEqual(['objectid', 'object', 'object[]', 'objectid', 'date'])
    expect(school.fields[0]).toMatchObject({ name: '_id', pk: true })
    const user = s.tables.find((t) => t.name === 'USER')
    expect(user.fields.find((f) => f.name === 'role')).toMatchObject({ type: 'int', note: '3 roles' })
    const tracking = s.tables.find((t) => t.name === 'TRACKING')
    expect(tracking.note).toBe('only creator can edit')
    expect(tracking.fields.map((f) => f.name)).not.toContain('Note')
    expect(tracking.fields.find((f) => f.name === 'product').type).toBe('json[]')
    expect(s.refs).toEqual(
      expect.arrayContaining([
        { from: { table: 'SCHOOL', field: 'createBy' }, to: { table: 'USER', field: '_id' }, type: '>' },
        { from: { table: 'TRACKING', field: 'schoolId' }, to: { table: 'SCHOOL', field: '_id' }, type: '>' },
      ]),
    )
    expect(parse(serialize(s)).errors).toEqual([])
  })
})

describe('mongo id handling', () => {
  it('exports a pk objectid called "id" as _id', () => {
    const s = parse(`Table a {
  id objectid [pk]
  name string
}
Table b {
  id objectid [pk]
  a_id objectid
}
Ref: b.a_id > a.id`)
    const js = toMongoose(s)
    expect(js).not.toMatch(/\bid:/)
    expect(js).toContain('ref: "AModel"')
    expect(toMongoShell(s)).toContain('"_id"')
    expect(toMongoShell(s)).not.toContain('"id"')
  })
})
