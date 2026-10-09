<script setup>
import { Handle, Position } from '@vue-flow/core'
import { NODE_WIDTH, HEADER_H, ROW_H } from '../lib/layout.js'

defineProps({ id: String, data: Object })

// Inline SVG (mdi-key / mdi-numeric-1-box-outline) rather than the icon font, which does not survive image export
const KEY_PATH = 'M7 14C5.9 14 5 13.1 5 12S5.9 10 7 10 9 10.9 9 12 8.1 14 7 14M12.6 10C11.8 7.7 9.6 6 7 6C3.7 6 1 8.7 1 12S3.7 18 7 18C9.6 18 11.8 16.3 12.6 14H16V18H20V14H23V10H12.6Z'
const UNIQUE_PATH = 'M14,17H12V9H10V7H14M5,3A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3H5M5,5H19V19H5V5Z'
</script>

<template>
  <div class="tbl" :class="{ embedded: data.table.embedded }" :style="{ width: NODE_WIDTH + 'px' }">
    <div class="tbl-head" :style="{ height: HEADER_H + 'px' }" :title="data.table.note || ''">
      <Handle id="__table-l" type="source" :position="Position.Left" class="hd" />
      <Handle id="__table-r" type="source" :position="Position.Right" class="hd" />
      <span class="name">{{ data.table.name }}</span>
      <span v-if="data.table.embedded" class="badge">embedded</span>
      <span v-else-if="data.mode === 'mongodb'" class="badge">collection</span>
    </div>
    <div v-for="f in data.table.fields" :key="f.name" class="row" :style="{ height: ROW_H + 'px' }" :title="f.note || ''">
      <Handle :id="f.name + '-l'" type="source" :position="Position.Left" class="hd" />
      <Handle :id="f.name + '-r'" type="source" :position="Position.Right" class="hd" />
      <span class="key">
        <svg v-if="f.pk" width="14" height="14" viewBox="0 0 24 24" fill="#ffa000"><path :d="KEY_PATH" /></svg>
        <svg v-else-if="f.unique" width="14" height="14" viewBox="0 0 24 24" fill="#42a5f5"><path :d="UNIQUE_PATH" /></svg>
      </span>
      <span class="fname" :class="{ nn: f.notNull && !f.pk }">{{ f.name }}</span>
      <span class="ftype">{{ f.type }}</span>
    </div>
    <div v-if="!data.table.fields.length" class="row empty" :style="{ height: ROW_H + 'px' }">no fields</div>
  </div>
</template>

<style scoped>
.tbl {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1.5px solid rgba(var(--v-border-color), 0.4);
  border-radius: 8px;
  overflow: visible;
  font-size: 13px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}
.tbl.embedded {
  border-style: dashed;
  border-color: rgb(var(--v-theme-secondary));
}
.tbl-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  font-weight: 600;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  border-radius: 6px 6px 0 0;
  cursor: grab;
}
.embedded .tbl-head {
  background: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-on-secondary));
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  margin-left: auto;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.25);
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 0 6px;
  border-top: 1px solid rgba(var(--v-border-color), 0.12);
}
.key {
  width: 16px;
  display: inline-flex;
  justify-content: center;
}
.fname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fname.nn {
  font-weight: 600;
}
.ftype {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11.5px;
  opacity: 0.6;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  opacity: 0.5;
  font-style: italic;
  padding-left: 12px;
}
:deep(.hd) {
  opacity: 0;
  width: 6px;
  height: 6px;
  min-width: 0;
  pointer-events: none;
}
</style>
