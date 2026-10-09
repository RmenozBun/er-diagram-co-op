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

// Fill and stroke are concrete values, not var() / stylesheet rules: the exported image has neither the page's CSS
// variables nor vue-flow's stylesheet, so otherwise the path turns into a filled black blob (or vanishes).
const style = computed(() => ({
  fill: 'none',
  stroke: props.selected ? theme.current.value.colors.primary : (theme.current.value.dark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.55)'),
  strokeWidth: props.selected ? 2.5 : 1.6,
  strokeDasharray: props.data?.kind === 'embed' ? '6 4' : undefined,
}))

const labelStyle = (x, y, pos) => ({
  transform: `translate(-50%, -50%) translate(${x + (pos === Position.Right ? 14 : -14)}px, ${y - 11}px)`,
})
</script>

<template>
  <BaseEdge :id="id" :path="path[0]" :style="style" />
  <EdgeLabelRenderer>
    <div v-if="data?.fromLabel" class="lbl" :style="labelStyle(sourceX, sourceY, sourcePosition)">{{ data.fromLabel }}</div>
    <div v-if="data?.toLabel" class="lbl" :style="labelStyle(targetX, targetY, targetPosition)">{{ data.toLabel }}</div>
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
</style>
