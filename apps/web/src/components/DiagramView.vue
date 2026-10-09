<script setup>
import { computed, markRaw } from 'vue'
import { VueFlow, useVueFlow, Position } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { deriveRelations } from '@er/schema'
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

const nodes = computed(() =>
  props.schema.tables.map((t, i) => ({
    id: t.name,
    type: 'table',
    position: positionOf(t.name, i),
    data: { table: t, mode: props.mode },
  })),
)

const LABELS = {
  '>': ['N', '1'],
  '<': ['1', 'N'],
  '-': ['1', '1'],
  '<>': ['N', 'N'],
}

const edges = computed(() => {
  const index = new Map(props.schema.tables.map((t, i) => [t.name, i]))
  const centerX = (name) => positionOf(name, index.get(name)).x + NODE_WIDTH / 2
  return deriveRelations(props.schema).map((r) => {
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
      data: { kind: r.kind, fromLabel, toLabel },
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
    filter: (node) => !node.classList?.contains('vue-flow__minimap') && !node.classList?.contains('vue-flow__controls'),
    pixelRatio,
  }
  // The live pan/zoom transform sits on the pane (a child of the captured viewport): neutralise it while capturing
  // so the export never depends on how the user has panned or zoomed.
  const previous = pane.style.transform
  pane.style.transform = `translate(${pad - minX}px, ${pad - minY}px) scale(1)`
  try {
    const task = kind === 'svg' ? toSvg(el, { ...opts, pixelRatio: 1 }) : toPng(el, opts)
    return await Promise.race([task, new Promise((_, reject) => setTimeout(() => reject(new Error('Image export timed out - keep this tab visible and try again.')), 30000))])
  } finally {
    pane.style.transform = previous
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
  >
    <Background :pattern-color="dark ? '#555' : '#c8c8c8'" :gap="22" />
    <Controls position="bottom-left" />
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
}
</style>
