/**
 * Canonical type names for imported SQL types (keeps the diagram readable and the
 * regenerated DDL valid in every dialect).
 * @returns {{ type: string, note: string|null }}
 */
export function normalizeImportedType(raw) {
  let t = String(raw).trim().replace(/\s+/g, ' ').toLowerCase()
  let note = null
  t = t.replace(/\b(unsigned|signed|zerofill)\b/g, '').replace(/\s+/g, ' ').trim()
  t = t
    .replace(/^character varying/, 'varchar')
    .replace(/^character\b/, 'char')
    .replace(/^bpchar\b/, 'char')
    .replace(/^double precision$/, 'double')
    .replace(/^timestamp(\(\d+\))? without time zone$/, 'timestamp')
    .replace(/^timestamp(\(\d+\))? with time zone$/, 'timestamptz')
    .replace(/^time(\(\d+\))? without time zone$/, 'time')
    .replace(/^time(\(\d+\))? with time zone$/, 'timetz')
    .replace(/^int4$/, 'int')
    .replace(/^int8$/, 'bigint')
    .replace(/^int2$/, 'smallint')
    .replace(/^float8$/, 'double')
    .replace(/^float4$/, 'float')
    .replace(/^bool$/, 'boolean')
    .replace(/^tinyint\(1\)$/, 'boolean')
    .replace(/^tinyint\b(\(\d+\))?$/, 'smallint')
    .replace(/^mediumint\b(\(\d+\))?$/, 'int')
    .replace(/^(int|integer|bigint|smallint)\(\d+\)$/, '$1')
    .replace(/^(tinytext|mediumtext|longtext)$/, 'text')
    .replace(/^(tinyblob|mediumblob|longblob)$/, 'blob')
  const en = t.match(/^(enum|set)\s*\((.*)\)$/)
  if (en) {
    note = `${en[1]}: ${en[2].replace(/'/g, '').replace(/\s*,\s*/g, ', ')}`
    t = 'varchar(255)'
  }
  return { type: t, note }
}

const MONGO_OF = {
  int: 'int', integer: 'int', smallint: 'int', bigint: 'long', double: 'double', float: 'double', real: 'double',
  decimal: 'decimal', numeric: 'decimal', boolean: 'bool', bool: 'bool', date: 'date', timestamp: 'date', timestamptz: 'date',
  datetime: 'date', time: 'string', text: 'string', varchar: 'string', char: 'string', uuid: 'string', json: 'json', jsonb: 'json',
  blob: 'buffer', bytea: 'buffer',
}

/** "varchar(255)" -> "string", "int[]" -> "int[]", unknown names are kept. */
export function sqlTypeToMongo(type) {
  const isArray = /\[\]$/.test(String(type))
  const base = String(type).replace(/\[\]$/, '').replace(/\(.*\)$/, '').trim().toLowerCase()
  const mapped = MONGO_OF[base]
  return mapped ? mapped + (isArray ? '[]' : '') : String(type)
}

/** Returns copies of the tables with MongoDB type names; a primary key called "id" becomes "_id". */
export function tablesToMongo(tables) {
  return tables.map((t) => ({
    ...t,
    fields: t.fields.map((f) => ({
      ...f,
      type: sqlTypeToMongo(f.type),
      name: f.pk && f.name === 'id' && !t.fields.some((x) => x.name === '_id') ? '_id' : f.name,
    })),
  }))
}
