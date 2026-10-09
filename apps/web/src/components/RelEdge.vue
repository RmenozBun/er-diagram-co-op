<script setup>
import { computed } from 'vue'
import { useTheme } from 'vuetify'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position } from '@vue-flow/core'

const props = defineProps({
  id: String,
  sourceX: Number,
  sourceY: Number,
  targetX: Number,
  targetY: Number,
  sourcePosition: String,
  targetPosition: String,
  markerStart: String,
  markerEnd: String,
  data: Object,
  selected: Boolean,
})

const theme = useTheme()

const path = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    curvature: 0.35,
  }),
)

// where the key goes: 'down' = tables that use the selected table's key, 'up' = tables whose key it uses, 'link' = many-to-many neighbour
const state = computed(() => props.data?.state ?? 'normal')
const colors = computed(() => {
  const c = theme.current.value.colors
  return {
    normal: theme.current.value.dark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.55)',
    down: c.primary,
    link: c.primary,
    up: c.secondary,
  }
})
const lineColor = computed(() => (props.selected ? theme.current.value.colors.primary : colors.value[state.value] ?? colors.value.normal))
const highlighted = computed(() => state.value === 'down' || state.value === 'up' || state.value === 'link')

// Fill and stroke are concrete values, not var() / stylesheet rules: the exported image has neither the page's CSS
// variables nor vue-flow's stylesheet, so otherwise the path turns into a filled black blob (or vanishes).
const style = computed(() => ({
  fill: 'none',
  stroke: lineColor.value,
  strokeWidth: props.selected ? 2.5 : highlighted.value ? 2.4 : 1.6,
  strokeDasharray: props.data?.kind === 'embed' ? '6 4' : undefined,
  opacity: state.value === 'dim' ? 0.15 : 1,
}))

const dotsOn = computed(() => props.data?.animated && props.data?.flow && props.data.flow !== 'none' && state.value !== 'dim')

const labelStyle = (x, y, pos) => ({
  transform: `translate(-50%, -50%) translate(${x + (pos === Position.Right ? 14 : -14)}px, ${y - 11}px)`,
  opacity: state.value === 'dim' ? 0.2 : 1,
})
const tipStyle = computed(() => ({ transform: `translate(-50%, -50%) translate(${path.value[1]}px, ${path.value[2]}px)` }))
</script>

<template>
  <BaseEdge :id="id" :path="path[0]" :style="style" :marker-start="markerStart" :marker-end="markerEnd" />
  <!-- dots moving from the table that owns the key (PK) to the table that uses it (FK); left out of exported images -->
  <path v-if="dotsOn" :d="path[0]" class="er-flow-dots" :class="data.flow" :style="{ stroke: lineColor }" />
  <EdgeLabelRenderer>
    <div v-if="data?.fromLabel" class="lbl" :style="labelStyle(sourceX, sourceY, sourcePosition)">{{ data.fromLabel }}</div>
    <div v-if="data?.toLabel" class="lbl" :style="labelStyle(targetX, targetY, targetPosition)">{{ data.toLabel }}</div>
    <div v-if="highlighted && data?.tip" class="tip" :style="tipStyle">{{ data.tip }}</div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.lbl {
  position: absolute;
  pointer-events: none;
  font-size: 11px;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 4px;
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-surface), 0.85);
}
.tip {
  position: absolute;
  pointer-events: none;
  white-space: nowrap;
  font-size: 11px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  padding: 1px 6px;
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-surface), 0.95);
  border: 1px solid rgba(var(--v-border-color), 0.35);
}
.er-flow-dots {
  fill: none;
  stroke-width: 4;
  stroke-linecap: round;
  stroke-dasharray: 0.1 15;
  pointer-events: none;
  animation: er-flow-forward 0.9s linear infinite;
}
.er-flow-dots.reverse {
  animation-name: er-flow-reverse;
}
@keyframes er-flow-forward {
  to {
    stroke-dashoffset: -15.1;
  }
}
@keyframes er-flow-reverse {
  to {
    stroke-dashoffset: 15.1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .er-flow-dots {
    animation: none;
  }
}
</style>
