<script setup>
import { computed, markRaw, nextTick, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import { VueFlow, useVueFlow, Position, MarkerType, Panel } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { deriveRelations, refSides, endpointFields } from '@er/schema'
import TableNode from './TableNode.vue'
import RelEdge from './RelEdge.vue'
import { NODE_WIDTH, gridPosition } from '../lib/layout.js'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

const props = defineProps({
  schema: { type: Object, required: true },
  positions: { type: Object, required: true },
  dark: Boolean,
  mode: { type: String, default: 'sql' },
})
const emit = defineEmits(['move'])

const nodeTypes = { table: markRaw(TableNode) }
const edgeTypes = { rel: markRaw(RelEdge) }

const { fitView, getNodes, getViewport } = useVueFlow('er')

const positionOf = (name, index) => props.positions[name] ?? gridPosition(props.schema, index)

const theme = useTheme()

// ---------------------------------------------------------------- data flow
// The key of a table (its PK) flows to the tables that use it (their FK / sub-document field). `parent` owns the key, `child` uses it.
const fieldsText = (ep) => (ep.field == null ? '' : `.${endpointFields(ep).join(', ')}`)
const relInfos = computed(() =>
  deriveRelations(props.schema).map((r) => {
    let parent = r.from
    let child = r.to
    let direction = 'none' // forward: the key flows source -> target, reverse: target -> source
    if (r.kind === 'embed') direction = 'forward'
    else {
      const sides = refSides(r)
      if (sides) {
        parent = sides.parent
        child = sides.child
        direction = parent === r.from ? 'forward' : 'reverse'
      }
    }
    const tip =
      r.kind === 'embed'
        ? `${parent.table} embeds ${child.table}`
        : direction === 'none'
          ? `${r.from.table}${fieldsText(r.from)} <> ${r.to.table}${fieldsText(r.to)}`
          : `${parent.table}${fieldsText(parent)} -> ${child.table}${fieldsText(child)}`
    return { id: r.id, kind: r.kind, type: r.type, from: r.from, to: r.to, parent, child, direction, tip }
  }),
)

const selected = ref(null) // the table whose key flow is highlighted
const flowOn = ref(true) // moving dots on the lines
try {
  flowOn.value = localStorage.getItem('er-flow') !== 'off'
} catch {}
watch(flowOn, (on) => {
  try {
    localStorage.setItem('er-flow', on ? 'on' : 'off')
  } catch {}
})
watch(
  () => props.schema,
  (schema) => {
    if (selected.value && !schema.tables.some((t) => t.name === selected.value)) selected.value = null
  },
)

/** Everything reachable from the selected table: where its key flows to (down), where the keys it uses come from (up). */
const flow = computed(() => {
  const sel = selected.value
  const edgeState = new Map()
  const related = new Set()
  const down = []
  const up = []
  if (!sel) return { edgeState, related, down, up, links: [] }
  related.add(sel)
  const links = []
  const walk = (dir, rows) => {
    const seen = new Set([sel])
    const queue = [{ table: sel, depth: 0 }]
    while (queue.length) {
      const { table, depth } = queue.shift()
      for (const r of relInfos.value) {
        if (r.direction === 'none') continue
        const here = dir === 'down' ? r.parent.table : r.child.table
        if (here !== table) continue
        const next = dir === 'down' ? r.child.table : r.parent.table
        if (!edgeState.has(r.id) || (dir === 'down' && edgeState.get(r.id) === 'up')) edgeState.set(r.id, dir)
        rows.push({ depth: depth + 1, table: next, via: r.tip, kind: r.kind, type: r.type })
        related.add(next)
        if (!seen.has(next)) {
          seen.add(next)
          queue.push({ table: next, depth: depth + 1 })
        }
      }
    }
  }
  walk('down', down)
  walk('up', up)
  for (const r of relInfos.value) {
    if (r.direction === 'none' && (r.from.table === sel || r.to.table === sel)) {
      edgeState.set(r.id, 'link')
      const other = r.from.table === sel ? r.to.table : r.from.table
      related.add(other)
      links.push({ depth: 1, table: other, via: r.tip, kind: r.kind, type: r.type })
    }
  }
  return { edgeState, related, down, up, links }
})

const selectedTable = computed(() => props.schema.tables.find((t) => t.name === selected.value) ?? null)
const selectedKey = computed(() => selectedTable.value?.fields.filter((f) => f.pk).map((f) => f.name).join(', ') ?? '')

function select(name) {
  selected.value = selected.value === name ? null : name
}

/** fields of each table that hold a foreign key (shown with an FK badge) */
const fkFields = computed(() => {
  const map = new Map()
  for (const r of relInfos.value) {
    if (r.kind !== 'ref' || r.direction === 'none') continue
    if (!map.has(r.child.table)) map.set(r.child.table, new Set())
    for (const f of endpointFields(r.child)) map.get(r.child.table).add(f)
  }
  return map
})

const nodes = computed(() =>
  props.schema.tables.map((t, i) => ({
    id: t.name,
    type: 'table',
    position: positionOf(t.name, i),
    class: selected.value && !flow.value.related.has(t.name) ? 'er-dim' : selected.value === t.name ? 'er-picked' : '',
    data: { table: t, mode: props.mode, fk: [...(fkFields.value.get(t.name) ?? [])] },
  })),
)

const LABELS = {
  '>': ['N', '1'],
  '<': ['1', 'N'],
  '-': ['1', '1'],
  '<>': ['N', 'N'],
}

/** arrow head on the end that uses the key (the FK / the sub-document), coloured like the line */
function arrows(info) {
  if (info.direction === 'none') return {}
  const c = theme.current.value.colors
  const state = !selected.value ? 'normal' : flow.value.edgeState.get(info.id) ?? 'dim'
  const color = state === 'down' ? c.primary : state === 'up' ? c.secondary : props.dark ? '#aeb4bd' : '#6b7280'
  const marker = { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }
  return info.direction === 'forward' ? { markerEnd: marker } : { markerStart: marker }
}

const edges = computed(() => {
  const index = new Map(props.schema.tables.map((t, i) => [t.name, i]))
  const centerX = (name) => positionOf(name, index.get(name)).x + NODE_WIDTH / 2
  return relInfos.value.map((info) => {
    const r = info
    const self = r.from.table === r.to.table
    const fromLeftOfTo = centerX(r.from.table) <= centerX(r.to.table)
    const sSide = self || fromLeftOfTo ? 'r' : 'l'
    const tSide = self ? 'r' : fromLeftOfTo ? 'l' : 'r'
    const [fromLabel, toLabel] = r.kind === 'embed' ? ['1', r.type === '<' ? 'N' : '1'] : LABELS[r.type] ?? ['', '']
    return {
      id: r.id,
      type: 'rel',
      source: r.from.table,
      target: r.to.table,
      sourceHandle: `${r.from.field ?? '__table'}-${sSide}`,
      targetHandle: `${r.to.field ?? '__table'}-${tSide}`,
      sourcePosition: sSide === 'r' ? Position.Right : Position.Left,
      targetPosition: tSide === 'r' ? Position.Right : Position.Left,
      ...arrows(info),
      data: {
        kind: r.kind,
        fromLabel,
        toLabel,
        flow: info.direction,
        animated: flowOn.value,
        tip: info.tip,
        state: !selected.value ? 'normal' : flow.value.edgeState.get(r.id) ?? 'dim',
      },
    }
  })
})

function onDrag(e) {
  emit('move', e.node.id, { x: Math.round(e.node.position.x), y: Math.round(e.node.position.y) })
}

async function toImage(kind = 'png') {
  const nodesNow = getNodes.value
  if (!nodesNow.length) throw new Error('Nothing to export yet.')
  const { toPng, toSvg } = await import('html-to-image')
  const pad = 40
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodesNow) {
    const w = n.dimensions?.width ?? NODE_WIDTH
    const h = n.dimensions?.height ?? 120
    minX = Math.min(minX, n.computedPosition.x)
    minY = Math.min(minY, n.computedPosition.y)
    maxX = Math.max(maxX, n.computedPosition.x + w)
    maxY = Math.max(maxY, n.computedPosition.y + h)
  }
  const width = Math.ceil(maxX - minX + pad * 2)
  const height = Math.ceil(maxY - minY + pad * 2)
  const el = document.querySelector('.er-flow .vue-flow__viewport')
  const pane = el?.querySelector('.vue-flow__transformationpane')
  if (!el || !pane) throw new Error('Diagram is not ready yet.')
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--er-bg').trim() || '#ffffff'
  // Browsers cap canvases at about 16k px: lower the pixel ratio for very large diagrams
  const pixelRatio = Math.max(0.25, Math.min(2, 16000 / Math.max(width, height)))
  const opts = {
    backgroundColor: bg,
    width,
    height,
    style: { width: `${width}px`, height: `${height}px`, transform: 'none' },
    filter: (node) =>
      !node.classList?.contains('vue-flow__minimap') && !node.classList?.contains('vue-flow__controls') && !node.classList?.contains('er-flow-dots'),
    pixelRatio,
  }
  // The live pan/zoom transform sits on the pane (a child of the captured viewport): neutralise it while capturing
  // so the export never depends on how the user has panned or zoomed.
  // The picture shows every line the same way, whichever table is highlighted on screen.
  const picked = selected.value
  selected.value = null
  await nextTick()
  // vue-flow applies node classes a moment after the data changes: the class below shows every table normally right away
  const flowEl = document.querySelector('.er-flow')
  flowEl?.classList.add('er-exporting')
  const previous = pane.style.transform
  pane.style.transform = `translate(${pad - minX}px, ${pad - minY}px) scale(1)`
  try {
    const task = kind === 'svg' ? toSvg(el, { ...opts, pixelRatio: 1 }) : toPng(el, opts)
    return await Promise.race([task, new Promise((_, reject) => setTimeout(() => reject(new Error('Image export timed out - keep this tab visible and try again.')), 30000))])
  } finally {
    pane.style.transform = previous
    flowEl?.classList.remove('er-exporting')
    selected.value = picked
  }
}

defineExpose({ fitView: () => fitView({ padding: 0.2, duration: 300 }), toImage, getViewport })
</script>

<template>
  <VueFlow
    id="er"
    class="er-flow"
    :nodes="nodes"
    :edges="edges"
    :node-types="nodeTypes"
    :edge-types="edgeTypes"
    :nodes-connectable="false"
    :elements-selectable="true"
    :min-zoom="0.1"
    :max-zoom="2"
    :default-viewport="{ x: 40, y: 40, zoom: 0.9 }"
    :fit-view-on-init="true"
    connection-mode="loose"
    @node-drag="onDrag"
    @node-drag-stop="onDrag"
    @node-click="({ node }) => select(node.id)"
    @pane-click="selected = null"
  >
    <Background :pattern-color="dark ? '#555' : '#c8c8c8'" :gap="22" />
    <Controls position="bottom-left" />
    <Panel position="top-left" class="er-flow-panel">
      <div class="er-flow-bar">
        <v-switch v-model="flowOn" density="compact" hide-details color="primary" label="Data flow" aria-label="Show moving dots from each key to the tables that use it" />
      </div>
      <div v-if="!selectedTable" class="er-flow-hint">Click a table to see where its key flows</div>
      <div v-else class="er-flow-card">
        <div class="er-flow-title">
          <strong>{{ selectedTable.name }}</strong>
          <span v-if="selectedKey" class="er-flow-pk">key: {{ selectedKey }}</span>
          <v-spacer />
          <v-btn icon="mdi-close" size="x-small" variant="text" aria-label="Clear highlight" @click="selected = null" />
        </div>
        <div class="er-flow-section down">Key flows to ({{ flow.down.length }})</div>
        <div v-if="!flow.down.length" class="er-flow-none">no table uses it</div>
        <button v-for="(row, i) in flow.down" :key="'d' + i" class="er-flow-row" :style="{ paddingLeft: 6 + (row.depth - 1) * 14 + 'px' }" :title="row.via" @click="selected = row.table">
          <span class="er-flow-name">{{ row.table }}</span>
          <span class="er-flow-via">{{ row.via }}</span>
        </button>
        <div class="er-flow-section up">Uses keys of ({{ flow.up.length }})</div>
        <div v-if="!flow.up.length" class="er-flow-none">none</div>
        <button v-for="(row, i) in flow.up" :key="'u' + i" class="er-flow-row" :style="{ paddingLeft: 6 + (row.depth - 1) * 14 + 'px' }" :title="row.via" @click="selected = row.table">
          <span class="er-flow-name">{{ row.table }}</span>
          <span class="er-flow-via">{{ row.via }}</span>
        </button>
        <template v-if="flow.links.length">
          <div class="er-flow-section">Many-to-many ({{ flow.links.length }})</div>
          <button v-for="(row, i) in flow.links" :key="'l' + i" class="er-flow-row" :title="row.via" @click="selected = row.table">
            <span class="er-flow-name">{{ row.table }}</span>
            <span class="er-flow-via">{{ row.via }}</span>
          </button>
        </template>
      </div>
    </Panel>
    <MiniMap pannable zoomable :mask-color="dark ? 'rgba(0,0,0,.55)' : 'rgba(240,240,240,.6)'" />
  </VueFlow>
</template>

<style>
.er-flow {
  background: var(--er-bg);
}
.er-flow .vue-flow__minimap {
  background: rgb(var(--v-theme-surface));
}
.er-flow .vue-flow__controls-button {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border-color: rgba(var(--v-border-color), 0.3);
}
.er-flow .vue-flow__controls-button svg {
  fill: currentColor;
}
.er-flow .vue-flow__node-table {
  cursor: grab;
  transition: opacity 0.15s;
}
.er-flow .vue-flow__node.er-dim {
  opacity: 0.3;
}
.er-flow.er-exporting .vue-flow__node,
.er-flow.er-exporting .vue-flow__node-table {
  transition: none; /* the picture reads the computed style at once: no fade */
}
.er-flow.er-exporting .vue-flow__node.er-dim {
  opacity: 1;
}
.er-flow.er-exporting .vue-flow__node.er-picked .tbl {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.er-flow .vue-flow__node.er-picked .tbl {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary)), 0 2px 8px rgba(0, 0, 0, 0.12);
}
/* key flow panel */
.er-flow-panel {
  max-width: 280px;
  font-size: 12px;
}
.er-flow-bar {
  display: inline-block;
  padding: 0 10px 0 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), 0.92);
  border: 1px solid rgba(var(--v-border-color), 0.3);
}
.er-flow-bar .v-switch {
  height: 32px;
}
.er-flow-hint {
  margin-top: 6px;
  padding: 3px 8px;
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-surface), 0.85);
}
.er-flow-card {
  margin-top: 6px;
  max-height: 42vh;
  overflow: auto;
  padding: 6px;
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-surface), 0.96);
  border: 1px solid rgba(var(--v-border-color), 0.3);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
}
.er-flow-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.er-flow-pk {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  opacity: 0.7;
}
.er-flow-section {
  margin-top: 6px;
  font-weight: 600;
}
.er-flow-section.down {
  color: rgb(var(--v-theme-primary));
}
.er-flow-section.up {
  color: rgb(var(--v-theme-secondary));
}
.er-flow-none {
  padding-left: 6px;
  opacity: 0.55;
}
.er-flow-row {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 2px 6px;
  text-align: left;
  border-radius: 4px;
}
.er-flow-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.07);
}
.er-flow-name {
  font-weight: 600;
}
.er-flow-via {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11px;
  opacity: 0.7;
}
</style>
