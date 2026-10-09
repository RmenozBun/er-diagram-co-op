<script setup>
import { computed } from 'vue'
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

const style = computed(() => ({
  stroke: props.selected ? 'rgb(var(--v-theme-primary))' : 'rgba(var(--v-theme-on-surface), 0.55)',
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
