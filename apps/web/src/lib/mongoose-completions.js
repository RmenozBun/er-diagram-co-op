import { snippetCompletion } from '@codemirror/autocomplete'

/**
 * Autocomplete for Mongoose code (MongoDB mode): types after `type:`, model names inside `ref: "..."`, option keys inside a field
 * definition, a field template inside the schema body and model / schema templates at the top level.
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
  ['trim: true', 'strip spaces around the text'],
  ['lowercase: true', 'store as lower case'],
  ['uppercase: true', 'store as upper case'],
  ['min: 0', 'smallest allowed number / date'],
  ['max: 100', 'largest allowed number / date'],
  ['minlength: 1', 'shortest allowed text'],
  ['maxlength: 255', 'longest allowed text'],
  ['immutable: true', 'cannot be changed after creation'],
  ['select: false', 'left out of query results by default'],
]

const pascalWord = (n) => String(n).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
const singularWord = (n) => (/ies$/i.test(n) ? n.replace(/ies$/i, 'y') : /(ss|us)$/i.test(n) ? n : n.replace(/s$/i, ''))

/** Names usable in `ref: "..."`: the model names of the collections in the diagram. */
export function modelNamesOf(schema, text = '') {
  const fromDiagram = schema.tables
    .filter((t) => !t.embedded)
    .map((t) => t.note?.match(/Mongoose model "([^"]+)"/)?.[1] ?? `${pascalWord(singularWord(t.name))}Model`)
  // while the code has a syntax error (e.g. you are in the middle of typing) the diagram is stale: read the names from the text too
  const fromText = [...String(text).matchAll(/\bmodel\(\s*["']([^"']+)["']/g)].map((m) => m[1])
  return [...new Set([...fromText, ...fromDiagram])]
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

const optionSnippets = (suffix = '') =>
  FIELD_OPTIONS.map(([text, detail], i) => snippetCompletion(text + suffix, { label: text.split(':')[0], detail, type: 'property', boost: 40 - i }))

/** @param {() => import('@er/schema').Schema} getSchema */
export function mongooseCompletions(getSchema) {
  return (context) => {
    const { state, pos } = context
    const line = state.doc.lineAt(pos)
    const before = line.text.slice(0, pos - line.from)
    if (/^\s*\/\//.test(before)) return null

    // ref: "Mem|"
    const refMatch = before.match(/\bref:\s*(["'])([\w$]*)$/)
    if (refMatch) {
      return {
        from: pos - refMatch[2].length,
        options: modelNamesOf(getSchema(), state.doc.toString()).map((n) => ({ label: n, type: 'class', detail: 'model' })),
        validFor: /^[\w$]*$/,
      }
    }
    // inside any other string: nothing to suggest
    if ((before.match(/"/g) ?? []).length % 2 === 1 || (before.match(/'/g) ?? []).length % 2 === 1) return null

    // type: String   /   type: [ ...
    const typeMatch = before.match(/\btype:\s*(\[?)\s*([\w$.]*)$/)
    if (typeMatch) {
      const inArray = Boolean(typeMatch[1])
      const options = MONGOOSE_TYPES.map(([label, detail], i) => ({ label, detail, type: 'type', boost: 50 - i }))
      if (!inArray) {
        for (const [label, detail] of [['[String]', 'array of strings'], ['[Number]', 'array of numbers'], ['[mongoose.Schema.Types.ObjectId]', 'array of references']]) {
          options.push({ label, detail, type: 'type', boost: 5 })
        }
        options.push(snippetCompletion('[{\n\t${field}: { type: String },\n}]', { label: '[{ … }]', detail: 'array of embedded documents', type: 'class', boost: 6 }))
      }
      for (const t of getSchema().tables.filter((x) => x.embedded)) {
        options.push({ label: inArray ? t.name : `[${t.name}]`, detail: 'embedded document', type: 'class' })
      }
      return { from: pos - typeMatch[2].length, options, validFor: /^[\w$.]*$/ }
    }

    const stack = openBrackets(state.doc.sliceString(0, pos))
    const top = stack[stack.length - 1]
    const word = context.matchBefore(/[\w$]*/)
    if (!word || (word.from === word.to && !context.explicit)) return null

    // inline options:  name: { type: String, req|
    if (top?.ch === '{' && /\w+:\s*\{[^{}]*$/.test(before) && /\btype\b/.test(before)) {
      return { from: word.from, options: optionSnippets(), validFor: /^[\w$]*$/ }
    }
    // a line inside `name: {`  (options of a field, or an embedded document)
    if (top?.ch === '{' && /^\s*[\w"'$]+\s*:\s*\{\s*$/.test(top.line) && /^\s*[\w$]*$/.test(before)) {
      const options = optionSnippets(',')
      options.unshift(snippetCompletion('type: ${String},', { label: 'type', detail: 'field type', type: 'property', boost: 60 }))
      return { from: word.from, options, validFor: /^[\w$]*$/ }
    }
    // a line inside the schema body: a new field
    const head = state.doc.sliceString(0, top?.index ?? 0).split('\n').slice(-2).join('\n').trimEnd()
    const insideSchema = top?.ch === '{' && (/Schema\s*\(\s*\{?\s*$/.test(top.line) || /Schema\s*\($/.test(head))
    if (insideSchema && /^\s*[\w$]*$/.test(before)) {
      return {
        from: word.from,
        options: [
          snippetCompletion('${name}: { type: ${String}, required: true },', { label: 'field', detail: 'new field', type: 'keyword', boost: 10 }),
          snippetCompletion('${name}: { type: [{\n\t${field}: { type: String },\n}], default: [] },', { label: 'embeddedArray', detail: 'array of embedded documents', type: 'keyword' }),
          snippetCompletion('${name}: { type: mongoose.Schema.Types.ObjectId, ref: "${Model}" },', { label: 'reference', detail: 'reference to another model', type: 'keyword' }),
        ],
        validFor: /^[\w$]*$/,
      }
    }
    // top level
    if (!stack.length && /^\s*[\w$]*$/.test(before)) {
      return {
        from: word.from,
        options: [
          snippetCompletion(
            'const ${name}Schema = new mongoose.Schema(\n\t{\n\t\t${field}: { type: String, required: true },\n\t},\n\t{ timestamps: false, versionKey: false },\n);\n\nconst ${Name} = mongoose.model("${Name}Model", ${name}Schema, "${names}");',
            { label: 'model', detail: 'schema + model', type: 'keyword', boost: 10 },
          ),
          snippetCompletion('import mongoose from "mongoose";', { label: 'import', detail: 'import mongoose', type: 'keyword' }),
        ],
        validFor: /^[\w$]*$/,
      }
    }
    return null
  }
}
