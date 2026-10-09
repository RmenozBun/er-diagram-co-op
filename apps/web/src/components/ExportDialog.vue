<script setup>
import { computed, ref, watch } from 'vue'
import { toSQL, toMongoose, viewToCode, toMongoShell, toValidatorJson, serialize, rootTables } from '@er/schema'
import { download } from '../lib/files.js'

const props = defineProps({
  modelValue: Boolean,
  /** the diagram as a schema (parsed from the editor) */
  schema: { type: Object, required: true },
  /** the editor text: DSL in SQL mode, the short Mongoose form (Model X { ... }) in MongoDB mode */
  code: { type: String, default: '' },
  /** what the short form leaves out (options, hooks, methods) */
  extras: { type: Object, default: null },
  mode: { type: String, default: 'sql' },
  /** which tab to open on: postgres | mysql | sqlite | mongoose | validator | mongosh | dsl (default: first of the current mode) */
  initialTarget: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'toast'])

const GROUPS = [
  {
    id: 'sql',
    badge: 'SQL',
    color: 'primary',
    icon: 'mdi-database',
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
    targets: [
      { id: 'mongoose', label: 'Mongoose models (.js)', ext: 'js' },
      { id: 'validator', label: 'Validator JSON ($jsonSchema)', ext: 'json' },
      { id: 'mongosh', label: 'mongosh script (validators + indexes)', ext: 'js' },
    ],
  },
  {
    id: 'both',
    badge: 'Diagram source',
    color: 'secondary',
    icon: 'mdi-code-braces',
    targets: [{ id: 'dsl', label: 'DSL text', ext: 'dbd' }],
  },
]
const TARGETS = GROUPS.flatMap((g) => g.targets.map((t) => ({ ...t, group: g })))

const target = ref('postgres')
const style = ref('esm') // Mongoose module style: ES modules or CommonJS
watch(
  () => props.modelValue,
  (open) => {
    if (open) target.value = props.initialTarget || (props.mode === 'mongodb' ? 'mongoose' : 'postgres')
  },
)

const current = computed(() => TARGETS.find((t) => t.id === target.value) ?? TARGETS[0])
const mismatch = computed(() => current.value.group.id !== 'both' && current.value.group.id !== props.mode)
const roots = computed(() => rootTables(props.schema))

const output = computed(() => {
  if (!props.modelValue) return ''
  try {
    switch (target.value) {
      case 'postgres':
      case 'mysql':
      case 'sqlite':
        return toSQL(props.schema, target.value)
      case 'mongoose':
        // in MongoDB mode the editor holds the short form: the full file is put together from it and the kept hooks / options
        return props.mode === 'mongodb' ? viewToCode(props.code, props.extras, { style: style.value }) : toMongoose(props.schema, { style: style.value })
      case 'validator':
        return toValidatorJson(props.schema)
      case 'mongosh':
        return toMongoShell(props.schema)
      default:
        return props.mode === 'mongodb' ? serialize(props.schema) : props.code
    }
  } catch (e) {
    return `-- Could not generate: ${e.message}`
  }
})

const fileName = computed(() => {
  const only = roots.value.length === 1 ? roots.value[0].name : null
  switch (target.value) {
    case 'mongoose':
      return only ? `${only}.model.js` : 'models.js'
    case 'validator':
      return only ? `${only}_collection_validator.json` : 'validators.json'
    case 'mongosh':
      return 'mongo-setup.js'
    case 'dsl':
      return 'diagram.dbd'
    default:
      return `schema-${target.value}.sql`
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
  download(output.value, fileName.value, current.value.ext === 'json' ? 'application/json' : 'text/plain;charset=utf-8')
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

        <div v-if="target === 'mongoose'" class="d-flex align-center ga-3 mt-3">
          <span class="text-body-2">Module style</span>
          <v-btn-toggle v-model="style" mandatory density="compact" variant="outlined" divided color="success">
            <v-btn value="esm" size="small">import / export (ES modules)</v-btn>
            <v-btn value="cjs" size="small">require / module.exports</v-btn>
          </v-btn-toggle>
        </div>

        <v-alert v-if="mismatch" type="info" variant="tonal" density="compact" class="mt-3">
          This diagram is in {{ mode === 'mongodb' ? 'MongoDB' : 'SQL' }} mode. Types are converted to
          {{ current.group.badge }} equivalents automatically; review the result before using it.
        </v-alert>
        <v-alert v-if="target === 'mongoose' && mode === 'mongodb'" type="success" variant="tonal" density="compact" class="mt-3">
          The complete model file: your fields from the editor plus the <code>import</code>, <code>mongoose.model(...)</code> and export lines, and any hooks or methods kept from imported files.
        </v-alert>
        <pre class="out">{{ output }}</pre>
        <v-alert v-if="schema.errors.length" type="warning" variant="tonal" density="compact" class="mt-3">
          The editor text has {{ schema.errors.length }} problem(s); the output may be incomplete.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn prepend-icon="mdi-content-copy" @click="copy">Copy</v-btn>
        <v-btn :color="current.group.color" variant="flat" prepend-icon="mdi-download" @click="save">Download {{ fileName }}</v-btn>
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
