import { emptySchema } from './model.js'
import { parseMongoose, parseJs, pluralize } from './importers/mongoose.js'
import { toMongoose, convertMongooseModuleStyle } from './generators/mongo.js'

/**
 * The MongoDB editor shows a short form of a Mongoose file instead of the whole module:
 *
 *   Model User {                         ->   const usersSchema = new mongoose.Schema({ ... }, { ... });
 *     email: { type: String, unique: true },    const User = mongoose.model("UserModel", usersSchema, "users");
 *   }
 *   Schema addressSchema { street: String }     (a sub-schema other schemas can use as a type)
 *
 * Everything that is not the field list (the import, schema options, hooks, methods, helper code, exports) is kept in `extras`
 * next to the text and put back by `viewToCode`. `codeToView` goes the other way for imported model files.
 */

const IDENT = '[\\p{L}_$][\\p{L}\\p{M}\\p{N}_$]*'
const HEADER_RE = new RegExp(`^(Model|Schema)\\s+(${IDENT})\\s*(\\[[^\\]\\n]*\\])?\\s*\\{`, 'u')
const HEADER_LINE_RE = new RegExp(`^[ \\t]*(Model|Schema)\\s+${IDENT}\\s*(\\[[^\\]\\n]*\\])?\\s*\\{`, 'mu')
const DEFAULT_OPTIONS = '{ timestamps: false, versionKey: false }'

const words = (n) => String(n).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)
const camel = (n) => {
  const p = words(n).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  return p ? p[0].toLowerCase() + p.slice(1) : p
}
const pascal = (n) => words(n).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
const defaultCollection = (name) => pluralize(String(name).toLowerCase())
const defaultSchemaVar = (collection) => `${camel(collection) || 'collection'}Schema`

/** True when the text uses the short form (at least one `Model X {` / `Schema X {` header). */
export const hasViewBlocks = (text) => HEADER_LINE_RE.test(String(text))
/** A whole Mongoose module pasted or saved by an older version (no short-form headers). */
export const looksLikeFullMongoose = (text) => /new\s+(?:mongoose\.)?Schema\s*\(/.test(String(text)) && !hasViewBlocks(text)

// ------------------------------------------------------------------ scanning

/**
 * The significant tokens of JavaScript-like text: every code character on its own, strings / regular expressions / template
 * literals as one span; comments and whitespace are skipped. Each span is { start, end, ch } (ch = the last character).
 */
function spansOf(text) {
  const spans = []
  let prev = ''
  let i = 0
  const push = (start, end, ch) => {
    spans.push({ start, end, ch })
    prev = ch
  }
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i++
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1
      push(i, Math.min(j + 1, text.length), '"')
      i = Math.min(j + 1, text.length)
    } else if (ch === '/' && (prev === '' || ':(,=[!&|?{};+-*%<>~^'.includes(prev))) {
      let j = i + 1
      let inClass = false
      while (j < text.length && text[j] !== '\n' && (inClass || text[j] !== '/')) {
        if (text[j] === '\\') j++
        else if (text[j] === '[') inClass = true
        else if (text[j] === ']') inClass = false
        j++
      }
      j++
      while (/[a-z]/i.test(text[j] ?? '')) j++
      push(i, Math.min(j, text.length), '"')
      i = Math.min(j, text.length)
    } else {
      push(i, i + 1, ch)
      i++
    }
  }
  return spans
}

const OPEN = '{[('
const CLOSE = '}])'
const lineStarts = (text) => {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}
const lineOfIndex = (starts, index) => {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= index) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Short form allows leaving out the commas between fields (one field per line): put them back so the text is a valid object body. */
export function fixCommas(body) {
  const spans = spansOf(body)
  if (!spans.length) return body
  const starts = lineStarts(body)
  const rows = new Map() // line -> { first, last, depthStart, depthEnd }
  let depth = 0
  for (const s of spans) {
    const line = lineOfIndex(starts, s.start)
    let row = rows.get(line)
    if (!row) rows.set(line, (row = { first: s, last: s, depthStart: depth, depthEnd: depth }))
    row.last = s
    if (OPEN.includes(s.ch)) depth++
    else if (CLOSE.includes(s.ch)) depth--
    row.depthEnd = depth
  }
  const order = [...rows.keys()].sort((a, b) => a - b)
  const inserts = []
  for (let k = 0; k < order.length - 1; k++) {
    const a = rows.get(order[k])
    const b = rows.get(order[k + 1])
    if (a.depthEnd !== b.depthStart || a.depthEnd < 0) continue
    if (',{[(:=+-*/%&|?<>!~^.'.includes(a.last.ch)) continue
    if (!new RegExp(`^(?:["'][^"'\\n]+["']|${IDENT})\\s*:`, 'u').test(body.slice(b.first.start, b.first.start + 120))) continue
    inserts.push(a.last.end)
  }
  let out = body
  for (const at of inserts.reverse()) out = out.slice(0, at) + ',' + out.slice(at)
  return out
}

/** Adds the comma after the last field (the generated code ends every field with one). */
function endWithComma(body) {
  const spans = spansOf(body)
  const last = spans[spans.length - 1]
  if (!last || last.ch === ',') return body
  return body.slice(0, last.end) + ',' + body.slice(last.end)
}

/** Drops comments and line breaks from a one-line-able object literal (keeps the wrapper's line numbers equal to the editor's). */
function collapse(code) {
  const spans = spansOf(code)
  let out = ''
  let prevEnd = 0
  for (const s of spans) {
    out += (out && /\s/.test(code.slice(prevEnd, s.start)) ? ' ' : '') + code.slice(s.start, s.end)
    prevEnd = s.end
  }
  return out
}

function dedent(text) {
  const lines = text.replace(/\t/g, '  ').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  const min = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length), Infinity)
  return lines.map((l) => (l.trim() ? l.slice(Number.isFinite(min) ? min : 0) : '')).join('\n')
}
const indent = (text, n) => text.split('\n').map((l) => (l.trim() ? ' '.repeat(n) + l : '')).join('\n')

// ----------------------------------------------------------------- splitting

/**
 * Finds the `Model X { ... }` / `Schema X { ... }` blocks of the short form.
 * @returns {{ blocks: Array<{ kind: 'Model'|'Schema', name: string, collection: string|null, line: number, headStart: number, bodyStart: number, bodyEnd: number, body: string }>, errors: Array<{ line: number, message: string }> }}
 */
export function splitView(text) {
  const source = String(text ?? '')
  const spans = spansOf(source)
  const starts = lineStarts(source)
  const blocks = []
  const errors = []
  const seen = new Set()
  let i = 0
  while (i < spans.length) {
    const s = spans[i]
    const line = lineOfIndex(starts, s.start) + 1
    const m = HEADER_RE.exec(source.slice(s.start, s.start + 400))
    if (!m) {
      errors.push({ line, message: 'Expected "Model Name {" or "Schema Name {" here (one block per collection)' })
      const lineEnd = starts[line] ?? source.length
      while (i < spans.length && spans[i].start < lineEnd) i++
      continue
    }
    const headEnd = s.start + m[0].length
    while (i < spans.length && spans[i].start < headEnd) i++
    let depth = 1
    let closeAt = -1
    for (; i < spans.length; i++) {
      const ch = spans[i].ch
      if (OPEN.includes(ch)) depth++
      else if (CLOSE.includes(ch)) depth--
      if (depth === 0) {
        closeAt = spans[i].start
        i++
        break
      }
    }
    if (closeAt === -1) {
      errors.push({ line, message: `"${m[2]}" is missing its closing }` })
      break
    }
    if (seen.has(m[2])) {
      errors.push({ line, message: `"${m[2]}" is defined twice` })
      continue
    }
    seen.add(m[2])
    const collection = m[3]?.match(/\bcollection\s*:\s*(["'])(.*?)\1/)?.[2] ?? null
    blocks.push({ kind: m[1], name: m[2], collection, line, headStart: s.start, bodyStart: headEnd, bodyEnd: closeAt, body: source.slice(headEnd, closeAt) })
  }
  return { blocks, errors }
}

// ------------------------------------------------------------------- parsing

const jsString = (v) => JSON.stringify(v)

/** The names a block gets in the generated module when the extras do not say otherwise. */
function namesFor(block, extra) {
  const collection = block.collection ?? defaultCollection(block.name)
  return {
    collection,
    schemaVar: block.kind === 'Schema' ? block.name : extra?.schemaVar ?? defaultSchemaVar(collection),
    modelName: extra?.modelName ?? `${block.name}Model`,
    options: extra?.options ?? DEFAULT_OPTIONS,
  }
}

/** Short form text -> Schema (the diagram). Line numbers of errors are the editor's. */
export function parseView(text, extras = null) {
  const source = String(text ?? '')
  const { blocks, errors } = splitView(source)
  if (!blocks.length) {
    const schema = emptySchema()
    if (spansOf(source).length) schema.errors.push(...errors)
    return schema
  }
  // wrapper: the same text with each header / closing brace swapped for real Mongoose code on the same line
  let wrapped = ''
  let at = 0
  for (const b of blocks) {
    const extra = extras?.models?.[b.name]
    const n = namesFor(b, extra)
    // text between blocks is only kept when it is comments / blank (anything else was reported as an error)
    wrapped += source.slice(at, b.headStart).replace(/[^\n]/g, (c) => (/\s/.test(c) ? c : ' '))
    wrapped += `const ${n.schemaVar} = new mongoose.Schema({`
    wrapped += fixCommas(b.body)
    wrapped += `}, ${collapse(n.options)});`
    if (b.kind === 'Model') wrapped += ` const ${b.name} = mongoose.model(${jsString(n.modelName)}, ${n.schemaVar}, ${jsString(n.collection)});`
    at = b.bodyEnd + 1
  }
  wrapped += source.slice(at).replace(/[^\n]/g, (c) => (/\s/.test(c) ? c : ' '))
  const schema = parseMongoose(wrapped)
  schema.errors.push(...errors)
  schema.errors.sort((a, b) => a.line - b.line)
  return schema
}

// ----------------------------------------------------------- view -> module

/**
 * Short form + extras -> a complete Mongoose module (what Export > Mongoose models writes).
 * @param {{ style?: 'esm' | 'cjs' }} [options]
 */
export function viewToCode(text, extras = null, options = {}) {
  const { blocks } = splitView(text)
  const used = new Set(blocks.map((b) => b.name))
  const lines = ['import mongoose from "mongoose";']
  if (extras?.preamble?.length) lines.push('', ...extras.preamble)
  const emit = (b) => {
    const extra = extras?.models?.[b.name]
    let n = namesFor(b, extra)
    if (b.kind === 'Model' && !extra?.schemaVar) {
      let v = n.schemaVar
      for (let k = 2; used.has(v); k++) v = `${n.schemaVar}${k}`
      used.add(v)
      n = { ...n, schemaVar: v }
    }
    const body = endWithComma(fixCommas(dedent(b.body)))
    const def = body.trim() ? `{\n${indent(body, 4)}\n  }` : extra?.defExpr ?? '{}'
    const out = ['', `const ${n.schemaVar} = new mongoose.Schema(\n  ${def},\n  ${n.options},\n);`]
    if (extra?.before?.length) out.push('', ...extra.before)
    if (b.kind === 'Model') out.push('', `const ${b.name} = mongoose.model(${jsString(n.modelName)}, ${n.schemaVar}, ${jsString(n.collection)});`)
    if (extra?.after?.length) out.push('', ...extra.after)
    lines.push(...out)
  }
  blocks.filter((b) => b.kind === 'Schema').forEach(emit)
  blocks.filter((b) => b.kind === 'Model').forEach(emit)
  if (extras?.trailer?.length) lines.push('', ...extras.trailer)
  const models = blocks.filter((b) => b.kind === 'Model').map((b) => b.name)
  if (models.length) lines.push('', models.length === 1 ? `export default ${models[0]};` : `export { ${models.join(', ')} };`)
  const code = lines.join('\n') + '\n'
  return options.style === 'cjs' ? convertMongooseModuleStyle(code, 'cjs') : code
}

// ----------------------------------------------------------- module -> view

const memberName = (n) => (n?.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' ? n.property.name : null)
const isSchemaCtor = (n) =>
  n &&
  (n.type === 'NewExpression' || n.type === 'CallExpression') &&
  ((n.callee.type === 'Identifier' && n.callee.name === 'Schema') || (memberName(n.callee) === 'Schema' && n.callee.object.type !== 'MemberExpression'))
const isModelCall = (n) =>
  n?.type === 'CallExpression' && ((n.callee.type === 'Identifier' && n.callee.name === 'model') || memberName(n.callee) === 'model') && n.arguments[0]?.type === 'Literal'
const isMongooseRequire = (n) => n?.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require' && n.arguments[0]?.value === 'mongoose'

function identifiersIn(node) {
  const names = new Set()
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'Identifier') names.add(n.name)
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'type') continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  }
  visit(node)
  return names
}

const keyOfModel = (constName, modelName) => {
  if (constName) return constName
  const stripped = pascal(modelName).replace(/Model$/, '')
  const base = (stripped || pascal(modelName) || 'Model').replace(/[^\p{L}\p{M}\p{N}_$]/gu, '')
  return /^[\p{L}_$]/u.test(base) ? base : `_${base}`
}

/**
 * A Mongoose model file -> { text, extras }. Throws the parser's error (with `.loc`) when the file has a syntax error.
 * Only the field lists are shown; the rest goes to `extras` (hooks and methods stay attached to their model).
 */
export function codeToView(source) {
  const code = String(source ?? '')
  const ast = parseJs(code)
  const body = ast.body
  const schemas = new Map() // variable -> { node, def, opts, start, statement }
  const models = [] // { constName, modelName, schemaVar, inline, collection, start, statement }
  const others = [] // { statement, from, text, ids }
  const preamble = []
  let prevEnd = 0

  const take = (st) => {
    const text = code.slice(prevEnd, st.end).trim()
    return text
  }
  const addModel = (st, call, constName) => {
    const [nameArg, schemaArg, collArg] = call.arguments
    const entry = { constName, modelName: nameArg.value, start: st.start, collection: collArg?.type === 'Literal' && typeof collArg.value === 'string' ? collArg.value : pluralize(nameArg.value) }
    if (schemaArg?.type === 'Identifier') entry.schemaVar = schemaArg.name
    else if (isSchemaCtor(schemaArg)) entry.inline = { def: schemaArg.arguments[0], opts: schemaArg.arguments[1] }
    else return false
    models.push(entry)
    return true
  }

  for (const st of body) {
    let handled = false
    const node = st.type === 'ExportNamedDeclaration' && st.declaration ? st.declaration : st
    if (st.type === 'ImportDeclaration' && st.source.value === 'mongoose') {
      const keep = st.specifiers.filter((sp) => sp.local.name !== 'mongoose')
      if (keep.length === st.specifiers.length || keep.some((sp) => sp.type !== 'ImportSpecifier')) preamble.push(code.slice(st.start, st.end))
      else if (keep.length) preamble.push(`import { ${keep.map((sp) => (sp.imported.name === sp.local.name ? sp.local.name : `${sp.imported.name} as ${sp.local.name}`)).join(', ')} } from "mongoose";`)
      handled = true
    } else if (st.type === 'VariableDeclaration' && st.declarations.length === 1 && isMongooseRequire(st.declarations[0].init)) {
      const d = st.declarations[0]
      if (!(d.id.type === 'Identifier' && d.id.name === 'mongoose')) preamble.push(code.slice(st.start, st.end))
      handled = true
    } else if (node.type === 'VariableDeclaration' && node.declarations.length === 1) {
      const d = node.declarations[0]
      if (d.id.type === 'Identifier' && isSchemaCtor(d.init)) {
        schemas.set(d.id.name, { def: d.init.arguments[0], opts: d.init.arguments[1], start: st.start })
        handled = true
      } else if (d.id.type === 'Identifier' && isModelCall(d.init)) handled = addModel(st, d.init, d.id.name)
    } else if (st.type === 'ExportDefaultDeclaration' && isModelCall(st.declaration)) {
      handled = addModel(st, st.declaration, null)
    } else if (st.type === 'ExpressionStatement') {
      const e = st.expression
      if (isModelCall(e)) handled = addModel(st, e, null) // a bare `mongoose.model("X", schema, "xs");`
      else if (e.type === 'AssignmentExpression' && e.left.type === 'MemberExpression' && /^(module\.exports|exports\.\w+)$/.test(code.slice(e.left.start, e.left.end))) {
        if (isModelCall(e.right)) handled = addModel(st, e.right, null)
        else if (e.right.type === 'Identifier' || (e.right.type === 'ObjectExpression' && e.right.properties.every((p) => p.type === 'Property' && p.value.type === 'Identifier'))) handled = true
      }
    } else if (st.type === 'ExportDefaultDeclaration' && st.declaration.type === 'Identifier') handled = true
    else if (st.type === 'ExportNamedDeclaration' && !st.declaration) handled = true
    if (!handled) others.push({ statement: st, text: take(st), ids: identifiersIn(st) })
    prevEnd = st.end
  }

  if (!schemas.size && !models.some((m) => m.inline)) {
    return { text: '', extras: null }
  }

  // one block per model, one per schema no model uses
  const blocks = []
  const usedVars = new Set()
  for (const m of models) {
    const parts = m.inline ?? schemas.get(m.schemaVar)
    if (!parts) continue
    if (m.schemaVar) usedVars.add(m.schemaVar)
    blocks.push({ kind: 'Model', name: keyOfModel(m.constName, m.modelName), constName: m.constName, schemaVar: m.schemaVar ?? null, modelName: m.modelName, collection: m.collection, parts, start: schemas.get(m.schemaVar)?.start ?? m.start })
  }
  for (const [v, parts] of schemas) {
    if (!usedVars.has(v)) blocks.push({ kind: 'Schema', name: v, schemaVar: v, parts, start: parts.start })
  }
  blocks.sort((a, b) => a.start - b.start)

  const extras = { version: 1, preamble, trailer: [], models: {} }
  const optionsText = (opts) => (opts ? code.slice(opts.start, opts.end) : null)
  const out = []
  for (const b of blocks) {
    const header = `${b.kind} ${b.name}${b.kind === 'Model' && b.collection !== defaultCollection(b.name) ? ` [collection: ${jsString(b.collection)}]` : ''} {`
    const def = b.parts.def?.type === 'ObjectExpression' ? b.parts.def : null
    // a schema written on one line gets one field per line
    const bodyText = !def
      ? ''
      : def.properties.length > 1 && !code.slice(def.start, def.end).includes('\n')
        ? def.properties.map((p) => `${code.slice(p.start, p.end)},`).join('\n')
        : dedent(code.slice(def.start + 1, def.end - 1))
    out.push(`${header}${bodyText ? `\n${indent(bodyText, 2)}\n` : '\n'}}`)

    const entry = {}
    const norm = (s) => s.replace(/\s+/g, ' ').trim()
    const options = optionsText(b.parts.opts)
    if (options && norm(options) !== DEFAULT_OPTIONS) entry.options = options
    if (!options && b.kind === 'Model') entry.options = '{}'
    if (b.kind === 'Model') {
      const coll = b.collection ?? defaultCollection(b.name)
      if (b.schemaVar && b.schemaVar !== defaultSchemaVar(coll)) entry.schemaVar = b.schemaVar
      if (b.modelName !== `${b.name}Model`) entry.modelName = b.modelName
    }
    if (!def && b.parts.def) entry.defExpr = code.slice(b.parts.def.start, b.parts.def.end)
    b.entry = entry
    extras.models[b.name] = entry
  }

  // hooks, methods, helpers: attached to the model whose schema / model variable they use
  const firstDeclaration = Math.min(...blocks.map((b) => b.start), Infinity)
  for (const o of others) {
    const viaModel = blocks.find((x) => x.constName && o.ids.has(x.constName))
    const viaSchema = blocks.find((x) => x.schemaVar && o.ids.has(x.schemaVar))
    const byVar = viaModel ? { block: viaModel, where: 'after' } : viaSchema ? { block: viaSchema, where: 'before' } : null
    if (byVar) (byVar.block.entry[byVar.where] ??= []).push(o.text)
    else if (o.statement.start < firstDeclaration) preamble.push(o.text)
    else extras.trailer.push(o.text)
  }
  for (const [k, e] of Object.entries(extras.models)) {
    if (!Object.keys(e).length) delete extras.models[k]
  }
  const empty = !extras.preamble.length && !extras.trailer.length && !Object.keys(extras.models).length
  return { text: out.join('\n\n') + '\n', extras: empty ? null : extras }
}

/** A Schema -> short form text (+ extras for what the short form cannot show, e.g. composite indexes). */
export function toMongooseView(schema) {
  const full = toMongoose(schema)
  const warnings = full.match(/^\/\/ WARNING.*$/gm) ?? []
  const { text, extras } = codeToView(full)
  return { text: warnings.length ? `${warnings.join('\n')}\n\n${text}` : text, extras }
}

/** Appends the models of `added` ({ text, extras }) to `base`; a model name that already exists in `base` gets a number. */
export function mergeViews(base, added) {
  if (!String(base?.text ?? '').trim()) return { text: added.text, extras: added.extras ?? null }
  const taken = new Set(splitView(base.text).blocks.map((b) => b.name))
  let text = String(added.text)
  const models = { ...(added.extras?.models ?? {}) }
  const blocks = splitView(text).blocks
  for (const b of [...blocks].reverse()) {
    if (!taken.has(b.name)) continue
    let name = b.name
    for (let k = 2; taken.has(name); k++) name = `${b.name}${k}`
    text = text.slice(0, b.headStart) + text.slice(b.headStart, b.bodyStart).replace(b.name, name) + text.slice(b.bodyStart)
    if (models[b.name]) {
      models[name] = models[b.name]
      delete models[b.name]
    }
  }
  const a = base.extras
  const x = added.extras
  const extras =
    a || x
      ? {
          version: 1,
          preamble: [...new Set([...(a?.preamble ?? []), ...(x?.preamble ?? [])])],
          trailer: [...(a?.trailer ?? []), ...(x?.trailer ?? [])],
          models: { ...(a?.models ?? {}), ...models },
        }
      : null
  return { text: `${String(base.text).trimEnd()}\n\n${text.trim()}\n`, extras }
}
