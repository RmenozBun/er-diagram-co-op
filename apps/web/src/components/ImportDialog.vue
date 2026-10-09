<script setup>
import { computed, ref, watch } from 'vue'
import { importFiles } from '../lib/files.js'

const props = defineProps({
  modelValue: Boolean,
  hasContent: Boolean,
  /** 'sql' | 'mongodb' | 'table' (CSV / Excel) */
  kind: { type: String, default: 'table' },
  currentMode: { type: String, default: 'sql' },
})
const emit = defineEmits(['update:modelValue', 'apply', 'toast'])

const KINDS = {
  sql: {
    badge: 'SQL',
    title: 'Import from a SQL database',
    color: 'primary',
    icon: 'mdi-database',
    exts: ['sql', 'sqlite', 'sqlite3', 'db', 'db3'],
    formats: [
      ['.sql', 'SQL dump (pg_dump, mysqldump, SQLite .dump)'],
      ['.sqlite · .db', 'SQLite database file'],
    ],
    hint: 'Tables, columns, keys, indexes and foreign keys are read from CREATE TABLE / ALTER TABLE / CREATE INDEX statements. INSERT data is ignored.',
  },
  mongodb: {
    badge: 'MongoDB',
    title: 'Import from MongoDB',
    color: 'success',
    icon: 'mdi-leaf',
    exts: ['js', 'mjs', 'cjs', 'json', 'jsonl', 'ndjson'],
    formats: [
      ['.js · .mjs', 'Mongoose model file: mongoose.Schema + mongoose.model (used as it is)'],
      ['.json', '$jsonSchema validator (e.g. users_collection_validator.json) or mongoexport data'],
      ['.jsonl · .ndjson', 'mongoexport data, one document per line'],
    ],
    hint: 'The editor shows real Mongoose code. A model file is loaded exactly as it is (hooks, methods and comments are kept); a validator JSON or exported documents are turned into a Mongoose schema.',
  },
  table: {
    badge: 'CSV · Excel',
    title: 'Import CSV / Excel',
    color: 'secondary',
    icon: 'mdi-table-arrow-right',
    exts: ['csv', 'tsv', 'txt', 'xlsx'],
    formats: [
      ['.csv · .tsv', 'one file = one table (column types are inferred)'],
      ['.xlsx', 'one sheet = one table'],
    ],
    hint: 'A sheet whose header is "Field, Type" is read as a schema description (e.g. obj, array(obj), string (ref: USER)); any other sheet is read as table data.',
  },
}
const cfg = computed(() => KINDS[props.kind] ?? KINDS.table)

const files = ref([])
const rejected = ref([])
const strategy = ref('append')
const target = ref('sql')
const targetTouched = ref(false)
const guess = ref(null)
const busy = ref(false)
const notes = ref([])
const dragging = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      files.value = []
      rejected.value = []
      notes.value = []
      guess.value = null
      targetTouched.value = false
      target.value = props.currentMode
      strategy.value = props.hasContent ? 'append' : 'replace'
    }
  },
)

const extOf = (name) => (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()

function addFiles(list) {
  const ok = []
  const bad = []
  for (const f of Array.from(list)) (cfg.value.exts.includes(extOf(f.name)) ? ok : bad).push(f)
  files.value = [...files.value, ...ok]
  rejected.value = bad.map((f) => `${f.name}: not a ${cfg.value.badge} file (accepted: ${cfg.value.exts.map((e) => '.' + e).join(' ')})`)
}
function onDrop(e) {
  dragging.value = false
  addFiles(e.dataTransfer.files)
}
function onPick(e) {
  addFiles(e.target.files)
  e.target.value = ''
}

// CSV / Excel: look at the content and suggest SQL or MongoDB (the user can still choose)
watch(files, async (list) => {
  guess.value = null
  if (props.kind !== 'table' || !list.length) return
  try {
    const preview = await importFiles(list)
    guess.value = preview.mode
    if (!targetTouched.value && preview.mode) target.value = preview.mode
  } catch {}
})

const targetCfg = computed(() => (target.value === 'mongodb' ? KINDS.mongodb : KINDS.sql))
const resultMode = computed(() => (props.kind === 'sql' ? 'sql' : props.kind === 'mongodb' ? 'mongodb' : target.value))
const resultCfg = computed(() => (resultMode.value === 'mongodb' ? KINDS.mongodb : KINDS.sql))

async function run() {
  busy.value = true
  try {
    const res = await importFiles(files.value, { target: resultMode.value })
    notes.value = res.notes
    if (!res.code.trim()) {
      emit('toast', 'Nothing could be imported from these files')
      return
    }
    emit('apply', { code: res.code, mode: resultMode.value, replace: strategy.value === 'replace' })
    emit('update:modelValue', false)
  } catch (e) {
    notes.value = [e.message]
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="640" @update:model-value="emit('update:modelValue', $event)">
    <v-card :style="{ borderTop: `4px solid rgb(var(--v-theme-${cfg.color}))` }">
      <v-card-title class="d-flex align-center ga-2">
        <v-chip :color="cfg.color" label size="small" variant="flat" :prepend-icon="cfg.icon">{{ cfg.badge }}</v-chip>
        <span>{{ cfg.title }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" @click="emit('update:modelValue', false)" />
      </v-card-title>
      <v-card-text>
        <div class="text-body-2 text-medium-emphasis mb-3">{{ cfg.hint }}</div>

        <label class="drop" :class="{ over: dragging }" :style="{ '--drop-color': `var(--v-theme-${cfg.color})` }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
          <v-icon size="36" :color="cfg.color">mdi-file-upload-outline</v-icon>
          <div class="mt-2">Drop {{ cfg.badge }} files here or click to browse</div>
          <div class="d-flex flex-wrap justify-center ga-2 mt-3">
            <v-chip v-for="[ext, text] in cfg.formats" :key="ext" size="small" variant="outlined" :color="cfg.color">
              <strong class="mr-1">{{ ext }}</strong> {{ text }}
            </v-chip>
          </div>
          <input type="file" multiple hidden :accept="cfg.exts.map((e) => '.' + e).join(',')" @change="onPick" />
        </label>

        <v-alert v-for="(r, i) in rejected" :key="'r' + i" type="warning" variant="tonal" density="compact" class="mt-2">{{ r }}</v-alert>

        <v-list v-if="files.length" density="compact" class="mt-2">
          <v-list-item v-for="(f, i) in files" :key="i" :title="f.name" :subtitle="(f.size / 1024).toFixed(1) + ' KB'">
            <template #append>
              <v-btn icon="mdi-close" size="x-small" variant="text" aria-label="Remove file" @click="files.splice(i, 1)" />
            </template>
          </v-list-item>
        </v-list>

        <div v-if="kind === 'table'" class="mt-4">
          <div class="text-subtitle-2 mb-1">Import as</div>
          <v-radio-group v-model="target" hide-details density="compact" @update:model-value="targetTouched = true">
            <v-radio value="sql">
              <template #label>
                <v-chip color="primary" label size="small" variant="flat" class="mr-2" prepend-icon="mdi-database">SQL</v-chip>
                tables &amp; columns (varchar, int, timestamp …)
              </template>
            </v-radio>
            <v-radio value="mongodb">
              <template #label>
                <v-chip color="success" label size="small" variant="flat" class="mr-2" prepend-icon="mdi-leaf">MongoDB</v-chip>
                collections &amp; fields (string, int, date, objectid …)
              </template>
            </v-radio>
          </v-radio-group>
          <div v-if="guess" class="text-caption text-medium-emphasis mt-1">
            The content looks {{ guess === 'mongodb' ? 'MongoDB-style (obj / array / objectid types)' : 'SQL-style' }}.
          </div>
        </div>

        <v-radio-group v-if="hasContent" v-model="strategy" inline hide-details class="mt-3">
          <v-radio label="Add to current diagram" value="append" />
          <v-radio label="Replace current diagram" value="replace" />
        </v-radio-group>

        <v-alert v-if="hasContent && resultMode !== currentMode && strategy === 'append'" type="info" variant="tonal" density="compact" class="mt-3">
          The diagram is in {{ currentMode === 'mongodb' ? 'MongoDB' : 'SQL' }} mode. Adding {{ resultCfg.badge }} content switches the editor to
          {{ resultCfg.badge }} mode and converts what is in it now ({{ resultCfg.badge === 'MongoDB' ? 'to Mongoose code' : 'to SQL DSL' }}; comments, hooks and methods are not carried over).
        </v-alert>

        <v-alert v-if="notes.length" type="info" variant="tonal" density="compact" class="mt-3">
          <div v-for="(n, i) in notes" :key="i">{{ n }}</div>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn :color="kind === 'table' ? targetCfg.color : cfg.color" variant="flat" :disabled="!files.length" :loading="busy" @click="run">
          Import {{ kind === 'table' ? 'as ' + targetCfg.badge : cfg.badge }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.drop {
  display: block;
  padding: 24px 16px;
  text-align: center;
  border: 2px dashed rgba(var(--drop-color), 0.55);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.drop:hover,
.drop.over {
  background: rgba(var(--drop-color), 0.08);
  border-color: rgb(var(--drop-color));
}
</style>
