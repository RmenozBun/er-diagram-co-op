<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { acceptCompletion, autocompletion, completionKeymap, completionStatus } from '@codemirror/autocomplete'
import { StreamLanguage, HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import * as Y from 'yjs'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { dslCompletions } from '../lib/completions.js'

const props = defineProps({
  ytext: { type: Object, required: true },
  awareness: { type: Object, required: true },
  mode: { type: String, default: 'sql' },
  schema: { type: Object, default: () => ({ tables: [], refs: [], errors: [] }) },
})

const host = ref(null)
let view = null
let undoManager = null

const dsl = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/^(Table|Ref|indexes)\b/i)) return 'keyword'
    if (stream.match(/^'[^']*'|^"[^"]*"|^`[^`]*`/)) return 'string'
    if (stream.match(/^(pk|primary key|unique|not null|null|increment|default|ref|note|embedded|name)\b(?=\s*[,:\]])/i)) return 'atom'
    if (stream.match(/^-?\d+(\.\d+)?\b/)) return 'number'
    if (stream.match(/^(<>|>|<|-)(?=\s)/)) return 'operator'
    if (stream.match(/^[{}()[\]]/)) return 'bracket'
    stream.next()
    return null
  },
})

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--cm-keyword)', fontWeight: '600' },
  { tag: t.string, color: 'var(--cm-string)' },
  { tag: t.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: t.atom, color: 'var(--cm-atom)' },
  { tag: t.number, color: 'var(--cm-number)' },
  { tag: t.operator, color: 'var(--cm-operator)', fontWeight: '700' },
])

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'rgb(var(--v-theme-surface))', color: 'rgb(var(--v-theme-on-surface))', fontSize: '13.5px' },
  '.cm-content': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', caretColor: 'rgb(var(--v-theme-on-surface))' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'rgba(var(--v-theme-on-surface), 0.4)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(var(--v-theme-primary), 0.06)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-cursor': { borderLeftColor: 'rgb(var(--v-theme-on-surface))' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
})

function mount() {
  undoManager = new Y.UndoManager(props.ytext)
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        dsl,
        syntaxHighlighting(highlight),
        placeholder('Table users {\n  id int [pk]\n}'),
        autocompletion({ override: [dslCompletions(() => props.mode, () => props.schema)], icons: false }),
        keymap.of([...completionKeymap, { key: 'Tab', run: (view) => (completionStatus(view.state) === 'active' ? acceptCompletion(view) : false) }, ...yUndoManagerKeymap, indentWithTab, ...defaultKeymap]),
        yCollab(props.ytext, props.awareness, { undoManager }),
        theme,
      ],
    }),
  })
}

onMounted(mount)
onBeforeUnmount(() => {
  view?.destroy()
  undoManager?.destroy()
})

watch(
  () => props.ytext,
  () => {
    view?.destroy()
    undoManager?.destroy()
    mount()
  },
)

defineExpose({
  goToLine(line) {
    if (!view) return
    const l = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines))
    view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true })
    view.focus()
  },
})
</script>

<template>
  <div ref="host" class="code-editor" />
</template>

<style>
.code-editor {
  height: 100%;
  overflow: hidden;
}
/* autocomplete popup follows the app theme */
.cm-tooltip.cm-tooltip-autocomplete {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}
.cm-tooltip-autocomplete ul li[aria-selected] {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.cm-completionDetail {
  opacity: 0.65;
  margin-left: 0.8em;
  font-style: normal;
}
/* remote cursors from y-codemirror.next */
.cm-ySelectionInfo {
  font-size: 11px;
  padding: 1px 5px;
  font-family: system-ui, sans-serif;
  opacity: 1 !important;
}
</style>
