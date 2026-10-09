<script setup>
import { computed, ref, watch } from 'vue'
import { toSQL, toMongoose, toMongoShell } from '@er/schema'
import { download } from '../lib/files.js'

const props = defineProps({
  modelValue: Boolean,
  schema: { type: Object, required: true },
  code: { type: String, default: '' },
  mode: { type: String, default: 'sql' },
  /** which tab to open on: postgres | mysql | sqlite | mongoose | mongosh | dsl (default: first of the current mode) */
  initialTarget: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'toast'])

const GROUPS = [
  {
    id: 'sql',
    badge: 'SQL',
    color: 'primary',
    icon: 'mdi-database',
    note: 'CREATE TABLE statements',
    targets: [
      { id: 'postgres', label: 'PostgreSQL', ext: 'sql' },
      { id: 'mysql', label: 'MySQL', ext: 'sql' },
      { id: 'sqlite', label: 'SQLite', ext: 'sql' },
    ],
  },
  {
    id: 'mongodb',
    badge: 'MongoDB',
    color: 'success',
    icon: 'mdi-leaf',
    note: 'Mongoose models / mongosh scripts',
    targets: [
      { id: 'mongoose', label: 'Mongoose models', ext: 'js' },
      { id: 'mongosh', label: 'mongosh (validators + indexes)', ext: 'js' },
    ],
  },
  {
    id: 'both',
    badge: 'Diagram source',
    color: 'secondary',
    icon: 'mdi-code-braces',
    note: 'the text on the left, works in both modes',
    targets: [{ id: 'dsl', label: 'DSL text', ext: 'dbd' }],
  },
]
const TARGETS = GROUPS.flatMap((g) => g.targets.map((t) => ({ ...t, group: g })))

const target = ref('postgres')
watch(
  () => props.modelValue,
  (open) => {
    if (open) target.value = props.initialTarget || (props.mode === 'mongodb' ? 'mongoose' : 'postgres')
  },
)

const current = computed(() => TARGETS.find((t) => t.id === target.value) ?? TARGETS[0])
const mismatch = computed(() => current.value.group.id !== 'both' && current.value.group.id !== props.mode)

const output = computed(() => {
  if (!props.modelValue) return ''
  try {
    switch (target.value) {
      case 'postgres':
      case 'mysql':
      case 'sqlite':
        return toSQL(props.schema, target.value)
      case 'mongoose':
        return toMongoose(props.schema)
      case 'mongosh':
        return toMongoShell(props.schema)
      default:
        return props.code
    }
  } catch (e) {
    return `-- Could not generate: ${e.message}`
  }
})

async function copy() {
  try {
    await navigator.clipboard.writeText(output.value)
    emit('toast', 'Copied to clipboard')
  } catch {
    emit('toast', 'Copy failed - select the text and copy manually')
  }
}
function save() {
  const base = target.value === 'dsl' ? 'diagram' : `schema-${target.value}`
  download(output.value, `${base}.${current.value.ext}`)
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="900" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card :style="{ borderTop: `4px solid rgb(var(--v-theme-${current.group.color}))` }">
      <v-card-title class="d-flex align-center ga-2">
        <v-chip :color="current.group.color" label size="small" variant="flat" :prepend-icon="current.group.icon">{{ current.group.badge }}</v-chip>
        <span>Export {{ current.label }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" @click="emit('update:modelValue', false)" />
      </v-card-title>
      <v-card-text>
        <div v-for="g in GROUPS" :key="g.id" class="group-row">
          <div class="group-label" :style="{ color: `rgb(var(--v-theme-${g.color}))` }">
            <v-icon size="16" :color="g.color">{{ g.icon }}</v-icon>
            <strong>{{ g.badge }}</strong>
            <span v-if="g.id === mode" class="current-tag">current mode</span>
          </div>
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="t in g.targets"
              :key="t.id"
              :color="g.color"
              :variant="target === t.id ? 'flat' : 'outlined'"
              :aria-pressed="target === t.id"
              label
              @click="target = t.id"
            >
              {{ t.label }}
            </v-chip>
          </div>
        </div>

        <v-alert v-if="mismatch" type="info" variant="tonal" density="compact" class="mt-3">
          This diagram is in {{ mode === 'mongodb' ? 'MongoDB' : 'SQL' }} mode. Types are converted to
          {{ current.group.badge }} equivalents automatically; review the result before using it.
        </v-alert>
        <pre class="out">{{ output }}</pre>
        <v-alert v-if="schema.errors.length" type="warning" variant="tonal" density="compact" class="mt-3">
          The diagram source has {{ schema.errors.length }} problem(s); the output may be incomplete.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn prepend-icon="mdi-content-copy" @click="copy">Copy</v-btn>
        <v-btn :color="current.group.color" variant="flat" prepend-icon="mdi-download" @click="save">Download .{{ current.ext }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.group-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
}
.group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 150px;
  font-size: 13px;
}
.current-tag {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgb(var(--v-theme-on-surface));
}
.out {
  margin-top: 12px;
  padding: 12px;
  max-height: 46vh;
  overflow: auto;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 6px;
  white-space: pre;
}
</style>
