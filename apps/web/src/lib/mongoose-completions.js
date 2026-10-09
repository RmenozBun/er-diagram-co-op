import { snippetCompletion } from '@codemirror/autocomplete'

/**
 * Autocomplete for the MongoDB editor (the short Mongoose form):
 *
 *   Model User { name: { type: String, required: true } }      Schema addressSchema { street: String }
 *
 * - top level: `Model` / `Schema` templates, and `[collection: "..."]` after a model name
 * - a new line inside a block: ready-made field templates (email, reference, enum, sub-document, timestamps ...)
 * - after `name:`  the types (short `String` or full `{ type: String }` form), after `type:` the types, inside `{ ... }` the options
 * - values: true / false, default values, enum list, regex for match, validate, min / max, model names inside `ref: ""`
 */

export const MONGOOSE_TYPES = [
  ['String', 'text'],
  ['Number', 'integer or decimal number'],
  ['Boolean', 'true / false'],
  ['Date', 'date + time'],
  ['Buffer', 'binary data'],
  ['mongoose.Schema.Types.ObjectId', 'ObjectId (_id or a reference)'],
  ['mongoose.Schema.Types.Mixed', 'any value'],
  ['mongoose.Schema.Types.Decimal128', 'exact decimal'],
  ['Map', 'key / value map'],
]

export const FIELD_OPTIONS = [
  ['required: true', 'the field must have a value'],
  ['unique: true', 'no two documents may share the value'],
  ['default: ', 'value used when none is given'],
  ['enum: []', 'allowed values'],
  ['ref: ""', 'name of the referenced model'],
  ['index: true', 'create an index on this field'],
  ['sparse: true', 'unique index that ignores documents without the field'],
  ['trim: true', 'strip spaces around the text'],
  ['lowercase: true', 'store as lower case'],
  ['uppercase: true', 'store as upper case'],
  ['match: /^.+$/', 'text must match this pattern'],
  ['minlength: 1', 'shortest allowed text'],
  ['maxlength: 255', 'longest allowed text'],
  ['min: 0', 'smallest allowed number / date'],
  ['max: 100', 'largest allowed number / date'],
  ['validate: ', 'your own check function'],
  ['immutable: true', 'cannot be changed after creation'],
  ['select: false', 'left out of query results by default'],
  ['alias: ""', 'another name for the field'],
  ['of: String', 'value type of a Map'],
]

/** Templates offered on a new line inside `Model X { ... }` (and inside a sub-document). */
const FIELD_TEMPLATES = [
  ['field', '${name}: { type: ${String}, required: true },', 'new field'],
  ['string', '${name}: { type: String, trim: true },', 'text'],
  ['number', '${count}: { type: Number, default: 0 },', 'number'],
  ['boolean', '${isActive}: { type: Boolean, default: true },', 'true / false'],
  ['date', '${happenedAt}: { type: Date },', 'date + time'],
  ['email', 'email: { type: String, required: true, unique: true, lowercase: true, trim: true },', 'unique, lower-cased email'],
  ['password', 'password: { type: String, required: true, select: false },', 'hidden from query results'],
  ['slug', 'slug: { type: String, required: true, unique: true, lowercase: true, trim: true },', 'unique url name'],
  ['enum', '${status}: { type: String, enum: [${"a"}, ${"b"}], default: ${"a"} },', 'one value of a fixed list'],
  ['reference', '${owner}: { type: mongoose.Schema.Types.ObjectId, ref: "${UserModel}", required: true },', 'ObjectId pointing at another model'],
  ['referenceArray', '${members}: [{ type: mongoose.Schema.Types.ObjectId, ref: "${UserModel}" }],', 'list of references'],
  ['tags', 'tags: { type: [String], default: [] },', 'list of strings'],
  ['embedded', '${address}: {\n\t${street}: { type: String },\n},', 'sub-document written in place'],
  ['embeddedArray', '${items}: {\n\ttype: [{\n\t\t${name}: { type: String },\n\t}],\n\tdefault: [],\n},', 'list of sub-documents'],
  ['subSchema', '${address}: ${addressSchema},', 'sub-document using a Schema block'],
  ['createdAt', 'createdAt: { type: Date, default: Date.now },', 'creation time'],
  ['updatedAt', 'updatedAt: { type: Date, default: Date.now },', 'last change'],
  ['deletedAt', 'deletedAt: { type: Date, default: null },', 'soft delete marker'],
  ['mixed', '${data}: { type: mongoose.Schema.Types.Mixed },', 'any value'],
  ['map', '${meta}: { type: Map, of: String },', 'key / value map'],
  ['noId', '_id: false,', 'sub-document without its own _id'],
]

const TOP_LEVEL = [
  ['Model', 'Model ${User} {\n\t${name}: { type: String, required: true },\n}', 'a collection (schema + model)', 20],
  ['Model + timestamps', 'Model ${User} {\n\t${name}: { type: String, required: true },\n\tcreatedAt: { type: Date, default: Date.now },\n\tupdatedAt: { type: Date, default: Date.now },\n}', 'a collection with createdAt / updatedAt', 10],
  ['Schema', 'Schema ${addressSchema} {\n\t${street}: { type: String },\n}', 'sub-schema other models use as a field type', 5],
]

const BOOLEAN_KEYS = /\b(required|unique|index|sparse|lowercase|uppercase|trim|immutable|select)\s*:\s*[\w]*$/
const DEFAULT_VALUES = [
  ['Date.now', 'now (for Date fields)'],
  ['[]', 'empty list'],
  ['{}', 'empty object'],
  ['null', 'no value'],
  ['0', 'zero'],
  ['""', 'empty text'],
  ['true', 'true'],
  ['false', 'false'],
]

/** Names usable in `ref: "..."`: the model names of the collections in the diagram (+ the blocks typed so far). */
export function modelNamesOf(schema, text = '') {
  const fromDiagram = schema.tables.filter((t) => !t.embedded).map((t) => t.note?.match(/Mongoose model "([^"]+)"/)?.[1]).filter(Boolean)
  // while the text has a syntax error (e.g. you are in the middle of typing) the diagram is stale: read the names from the text too
  const fromHeaders = [...String(text).matchAll(/^[ \t]*Model\s+([\p{L}_$][\p{L}\p{M}\p{N}_$]*)/gmu)].map((m) => `${m[1]}Model`)
  const fromFullCode = [...String(text).matchAll(/\bmodel\(\s*["']([^"']+)["']/g)].map((m) => m[1])
  return [...new Set([...fromHeaders, ...fromFullCode, ...fromDiagram])]
}

/** Names of the `Schema X { }` blocks: they can be used as a field type. */
export function subSchemaNamesOf(text = '') {
  return [...new Set([...String(text).matchAll(/^[ \t]*Schema\s+([\p{L}_$][\p{L}\p{M}\p{N}_$]*)/gmu)].map((m) => m[1]))]
}

/** Unclosed `{ [ (` in `text` (strings and comments skipped), each with the text of the line that opened it. */
export function openBrackets(text) {
  const stack = []
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '{' || ch === '[' || ch === '(') {
      const start = text.lastIndexOf('\n', i) + 1
      const stop = text.indexOf('\n', i)
      stack.push({ ch, line: text.slice(start, stop === -1 ? undefined : stop), index: i })
    } else if (ch === '}' || ch === ']' || ch === ')') stack.pop()
  }
  return stack
}

const optionSnippets = (suffix = '', used = new Set()) =>
  FIELD_OPTIONS.filter(([text]) => !used.has(text.split(':')[0])).map(([text, detail], i) =>
    snippetCompletion(text + suffix, { label: text.split(':')[0], detail, type: 'property', boost: 40 - i }),
  )

/** keys already written between `from` and the cursor, so they are not offered twice */
const usedKeys = (text) => new Set([...text.matchAll(/([\p{L}_$][\p{L}\p{M}\p{N}_$]*)\s*:/gu)].map((m) => m[1]))

/** @param {() => import('@er/schema').Schema} getSchema */
export function mongooseCompletions(getSchema) {
  const typeOptions = (text, { inArray = false, shorthand = false } = {}) => {
    const out = MONGOOSE_TYPES.map(([label, detail], i) => ({ label, detail, type: 'type', boost: 50 - i }))
    if (!inArray) {
      for (const [label, detail] of [['[String]', 'list of strings'], ['[Number]', 'list of numbers'], ['[mongoose.Schema.Types.ObjectId]', 'list of references']]) {
        out.push({ label, detail, type: 'type', boost: 5 })
      }
      out.push(snippetCompletion('[{\n\t${field}: { type: String },\n}]', { label: '[{ … }]', detail: 'list of sub-documents', type: 'class', boost: 6 }))
    }
    for (const name of subSchemaNamesOf(text)) {
      out.push({ label: name, detail: 'sub-schema', type: 'class', boost: 8 })
      if (!inArray) out.push({ label: `[${name}]`, detail: 'list of sub-documents', type: 'class' })
    }
    if (shorthand) {
      out.push(snippetCompletion('{ type: ${String}, required: true }', { label: '{ type: … }', detail: 'type with options', type: 'keyword', boost: 60 }))
      out.push(snippetCompletion('{\n\t${field}: { type: String },\n}', { label: '{ … }', detail: 'sub-document written in place', type: 'keyword', boost: 4 }))
    }
    return out
  }

  return (context) => {
    const { state, pos } = context
    const line = state.doc.lineAt(pos)
    const before = line.text.slice(0, pos - line.from)
    if (/^\s*\/\//.test(before)) return null
    const text = state.doc.toString()

    // ref: "Mem|"
    const refMatch = before.match(/\bref:\s*(["'])([\w$\p{L}]*)$/u)
    if (refMatch) {
      return {
        from: pos - refMatch[2].length,
        options: modelNamesOf(getSchema(), text).map((n) => ({ label: n, type: 'class', detail: 'model' })),
        validFor: /^[\w$\p{L}]*$/u,
      }
    }
    // inside any other string: nothing to suggest
    if ((before.match(/"/g) ?? []).length % 2 === 1 || (before.match(/'/g) ?? []).length % 2 === 1) return null

    const stack = openBrackets(state.doc.sliceString(0, pos))
    const top = stack[stack.length - 1]
    const word = context.matchBefore(/[\p{L}\p{M}\p{N}_$.]*/u) ?? { from: pos, to: pos }

    // Model User |   ->   [collection: "users"] {
    if (!stack.length && /^\s*(Model|Schema)\s+[\p{L}\p{M}\p{N}_$]+\s+$/u.test(before)) {
      return {
        from: pos,
        options: [
          snippetCompletion('{', { label: '{', detail: 'start of the field list', type: 'keyword', boost: 10 }),
          ...(/^\s*Model/.test(before) ? [snippetCompletion('[collection: "${users}"] {', { label: '[collection: "…"]', detail: 'use another collection name', type: 'keyword' })] : []),
        ],
      }
    }

    // values after `key:`
    const bool = before.match(BOOLEAN_KEYS)
    if (bool) {
      return { from: pos - before.match(/[\w]*$/)[0].length, options: ['true', 'false'].map((label, i) => ({ label, type: 'keyword', boost: 9 - i })), validFor: /^\w*$/ }
    }
    if (/\bdefault:\s*[\w$.]*$/.test(before)) {
      return { from: pos - before.match(/[\w$.]*$/)[0].length, options: DEFAULT_VALUES.map(([label, detail], i) => ({ label, detail, type: 'constant', boost: 20 - i })), validFor: /^[\w$.]*$/ }
    }
    if (/\benum:\s*$/.test(before)) {
      return { from: pos, options: [snippetCompletion('[${"a"}, ${"b"}, ${"c"}]', { label: '[ … ]', detail: 'allowed values', type: 'keyword' })] }
    }
    if (/\bmatch:\s*$/.test(before)) {
      return {
        from: pos,
        options: [
          snippetCompletion('/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/', { label: 'email pattern', detail: 'regular expression', type: 'keyword' }),
          snippetCompletion('/^[0-9]+$/', { label: 'digits only', detail: 'regular expression', type: 'keyword' }),
          snippetCompletion('/^${pattern}$/', { label: '/…/', detail: 'your own regular expression', type: 'keyword' }),
        ],
      }
    }
    if (/\bvalidate:\s*$/.test(before)) {
      return { from: pos, options: [snippetCompletion('{\n\tvalidator: (v) => ${v.length > 0},\n\tmessage: "${Invalid value}",\n}', { label: '{ validator, message }', detail: 'custom check', type: 'keyword' })] }
    }
    if (/\b(min|max|minlength|maxlength)\s*:\s*$/.test(before)) {
      return { from: pos, options: ['0', '1', '10', '100', '255'].map((label) => ({ label, type: 'constant' })) }
    }

    // type: String   /   type: [ ...
    const typeMatch = before.match(/\btype:\s*(\[?)\s*([\w$.]*)$/)
    if (typeMatch) {
      return { from: pos - typeMatch[2].length, options: typeOptions(text, { inArray: Boolean(typeMatch[1]) }), validFor: /^[\w$.]*$/ }
    }

    const isBlockBody = top?.ch === '{' && /^\s*(Model|Schema)\s/.test(top.line)
    const isSubDocument = top?.ch === '{' && (/^\s*[\w"'$\p{L}]+\s*:\s*\{\s*$/u.test(top.line) || /\[\s*\{\s*$/.test(top.line))

    // a field written in short form:  name: Str|
    if ((isBlockBody || isSubDocument) && /^\s*[\w"'$\p{L}]+\s*:\s*[\w$.]*$/u.test(before)) {
      const typed = before.match(/[\w$.]*$/)[0]
      return { from: pos - typed.length, options: typeOptions(text, { shorthand: true }), validFor: /^[\w$.]*$/ }
    }

    if (!word || (word.from === word.to && !context.explicit)) return null

    // inline options:  name: { type: String, req|
    if (top?.ch === '{' && /[\w"'$\p{L}]+:\s*\{[^{}]*$/u.test(before) && /\btype\b/.test(before)) {
      const used = usedKeys(before.slice(before.lastIndexOf('{')))
      return { from: word.from, options: optionSnippets('', used), validFor: /^[\w$]*$/ }
    }
    // a new line inside the field list of a model / schema / sub-document
    if ((isBlockBody || isSubDocument) && /^\s*[\w$\p{L}]*$/u.test(before)) {
      const options = FIELD_TEMPLATES.map(([label, template, detail], i) => snippetCompletion(template, { label, detail, type: 'keyword', boost: 30 - i }))
      if (isSubDocument && /^\s*[\w"'$\p{L}]+\s*:\s*\{\s*$/u.test(top.line)) {
        // `name: {` can also be the options of a field written long-hand
        const used = usedKeys(state.doc.sliceString(top.index, pos))
        options.push(snippetCompletion('type: ${String},', { label: 'type', detail: 'field type', type: 'property', boost: 60 }), ...optionSnippets(',', used))
      }
      return { from: word.from, options, validFor: /^[\w$]*$/ }
    }
    // a line inside `name: {`  (options of a field written long-hand)
    if (top?.ch === '{' && /^\s*[\w$\p{L}]*$/u.test(before)) {
      const options = optionSnippets(',', usedKeys(state.doc.sliceString(top.index, pos)))
      options.unshift(snippetCompletion('type: ${String},', { label: 'type', detail: 'field type', type: 'property', boost: 60 }))
      return { from: word.from, options, validFor: /^[\w$]*$/ }
    }
    // top level
    if (!stack.length && /^\s*[\w$\p{L}]*$/u.test(before)) {
      return {
        from: word.from,
        options: TOP_LEVEL.map(([label, template, detail, boost]) => snippetCompletion(template, { label, detail, type: 'keyword', boost })),
        validFor: /^[\w$]*$/,
      }
    }
    return null
  }
}
