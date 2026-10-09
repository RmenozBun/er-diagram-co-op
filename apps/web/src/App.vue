<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useTheme, useDisplay } from 'vuetify'
import { parseSource, convertDocument, codeToView, mergeViews, looksLikeFullMongoose, looksLikeDsl, schemaToCsv, tablesToCsvFiles, SAMPLE_SQL, SAMPLE_MONGO } from '@er/schema'
import CodeEditor from './components/CodeEditor.vue'
import DiagramView from './components/DiagramView.vue'
import ExportDialog from './components/ExportDialog.vue'
import ImportDialog from './components/ImportDialog.vue'
import { createSession, getUser, saveUser, randomRoomId, setUserOnAwareness } from './lib/collab.js'
import { autoLayout } from './lib/layout.js'
import { download, makeProjectFile, normalizeEol, readProjectFile, readText } from './lib/files.js'

const theme = useTheme()
const { mdAndUp, xs } = useDisplay()
const dark = computed(() => theme.global.name.value === 'dark')
watch(
  dark,
  (d) => {
    document.documentElement.classList.toggle('er-dark', d)
    try {
      localStorage.setItem('er-theme', d ? 'dark' : 'light')
    } catch {}
  },
  { immediate: true },
)

// ---------------------------------------------------------------- session
const user = ref(getUser())
const session = shallowRef(null)
const code = ref('')
const extras = ref(null) // what the short MongoDB form leaves out (options, hooks, methods): stored next to the text
const mode = ref('sql')
const positions = ref({})
const schema = ref(parseSource('', 'sql'))
const peers = ref([])
const connection = ref('local')
const ready = ref(false)

let cleanup = []
let parseTimer = null

/** the extras travel as one JSON string in the shared meta map (null = none) */
function setExtras(ymeta, value) {
  if (value) ymeta.set('extras', JSON.stringify(value))
  else ymeta.delete('extras')
}

const roomFromHash = () => location.hash.match(/^#\/r\/([\w-]{4,64})$/)?.[1] ?? null

function init() {
  cleanup.forEach((fn) => fn())
  cleanup = []
  session.value?.destroy()
  ready.value = false

  if (location.hash.startsWith('#/r/') && !roomFromHash()) {
    history.replaceState(null, '', location.pathname + location.search)
    toast('That room link is not valid (ids are 4-64 letters, digits, - or _). Opened your own diagram instead.')
  }
  const s = createSession(roomFromHash(), user.value)
  session.value = s
  const { ytext, ymeta, ypos, awareness, provider } = s

  const syncCode = () => (code.value = ytext.toString())
  const syncMode = () => {
    mode.value = ymeta.get('mode') === 'mongodb' ? 'mongodb' : 'sql'
    try {
      extras.value = JSON.parse(ymeta.get('extras') || 'null')
    } catch {
      extras.value = null
    }
  }
  const syncPos = () => (positions.value = ypos.toJSON())
  const syncPeers = () => {
    peers.value = Array.from(awareness.getStates().entries())
      .filter(([, st]) => st.user)
      .map(([id, st]) => ({ id, ...st.user, me: id === awareness.clientID }))
  }
  ytext.observe(syncCode)
  ymeta.observe(syncMode)
  ypos.observe(syncPos)
  awareness.on('change', syncPeers)
  cleanup.push(() => {
    ytext.unobserve(syncCode)
    ymeta.unobserve(syncMode)
    ypos.unobserve(syncPos)
    awareness.off('change', syncPeers)
  })

  const seedIfNeeded = () => {
    if (!s.roomId) {
      // "Leave room" hands the room's content over as this browser's local diagram
      let carried = null
      try {
        carried = JSON.parse(sessionStorage.getItem('er-local-seed') || 'null')
        sessionStorage.removeItem('er-local-seed')
      } catch {}
      if (carried) {
        s.doc.transact(() => {
          ytext.delete(0, ytext.length)
          ytext.insert(0, carried.code)
          ymeta.set('seeded', true)
          ymeta.set('mode', carried.mode)
          setExtras(ymeta, carried.extras)
          for (const k of Array.from(ypos.keys())) ypos.delete(k)
          for (const [k, v] of Object.entries(carried.positions ?? {})) ypos.set(k, v)
        })
        return
      }
    }
    if (ymeta.get('seeded')) return
    const seedKey = s.roomId ? `er-seed:${s.roomId}` : null
    let seed = null
    if (seedKey) {
      try {
        seed = JSON.parse(sessionStorage.getItem(seedKey) || 'null')
        sessionStorage.removeItem(seedKey)
      } catch {}
      if (!seed || ytext.length > 0) return
    } else {
      seed = { mode: 'sql', code: SAMPLE_SQL, positions: {} }
    }
    s.doc.transact(() => {
      ymeta.set('seeded', true)
      ymeta.set('mode', seed.mode)
      setExtras(ymeta, seed.extras)
      ytext.insert(0, seed.code)
      for (const [k, v] of Object.entries(seed.positions ?? {})) ypos.set(k, v)
    })
  }

  if (provider) {
    connection.value = 'connecting'
    const onStatus = ({ status }) => (connection.value = status)
    provider.on('status', onStatus)
    const onSync = (synced) => synced && seedIfNeeded()
    provider.on('sync', onSync)
    cleanup.push(() => {
      provider.off('status', onStatus)
      provider.off('sync', onSync)
    })
  } else {
    connection.value = 'local'
  }

  s.localReady.then(() => {
    if (session.value !== s) return
    syncCode()
    syncMode()
    syncPos()
    syncPeers()
    if (!provider) seedIfNeeded()
    if (!provider && mode.value === 'mongodb' && looksLikeDsl(code.value)) {
      const converted = convertDocument({ code: code.value }, 'sql', 'mongodb')
      s.doc.transact(() => {
        ytext.delete(0, ytext.length)
        ytext.insert(0, converted.code)
        setExtras(ymeta, converted.extras)
      })
    } else if (!provider && mode.value === 'mongodb' && looksLikeFullMongoose(code.value)) {
      // a whole Mongoose file saved by an earlier version: show the short form, keep the rest as extras
      try {
        const view = codeToView(code.value)
        if (view.text) {
          s.doc.transact(() => {
            ytext.delete(0, ytext.length)
            ytext.insert(0, view.text)
            setExtras(ymeta, view.extras)
          })
        }
      } catch {}
    }
    if (!provider && ytext.toString().includes('\r')) {
      const clean = normalizeEol(ytext.toString())
      s.doc.transact(() => {
        ytext.delete(0, ytext.length)
        ytext.insert(0, clean)
      })
    }
    schema.value = parseSource(code.value, mode.value, extras.value)
    ready.value = true
  })
}

// the editor text is DSL in SQL mode and the short Mongoose form (Model X { ... }) in MongoDB mode
watch([code, mode, extras], ([c, m, x]) => {
  clearTimeout(parseTimer)
  parseTimer = setTimeout(() => {
    const fresh = parseSource(c, m, x)
    // a code error that hides everything (typing in the middle of a Mongoose model) keeps the last good diagram on screen
    schema.value = fresh.errors.length && !fresh.tables.length && schema.value.tables.length ? { ...schema.value, errors: fresh.errors } : fresh
  }, 120)
})

function onHashChange() {
  init()
}

onMounted(() => {
  init()
  window.addEventListener('hashchange', onHashChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange)
  cleanup.forEach((fn) => fn())
  session.value?.destroy()
})

// ---------------------------------------------------------------- actions
const snackbar = ref({ show: false, text: '' })
const toast = (text) => (snackbar.value = { show: true, text })

const exportOpen = ref(false)
const exportTarget = ref('')
const importOpen = ref(false)
const importKind = ref('table')

function openExport(target) {
  exportTarget.value = target
  exportOpen.value = true
}
function openImport(kind) {
  importKind.value = kind
  importOpen.value = true
}
const profileOpen = ref(false)
const diagram = ref(null)
const editor = ref(null)

const inRoom = computed(() => Boolean(session.value?.roomId))
const others = computed(() => peers.value.filter((p) => !p.me))

const MODE_NAME = { sql: 'SQL', mongodb: 'MongoDB' }
const isUntouchedSample = () => {
  const text = code.value.trim()
  return text === SAMPLE_SQL.trim() || text === SAMPLE_MONGO.trim()
}

/** SQL <-> MongoDB. While the editor still shows one of the built-in examples (nothing of yours in it) the example follows the mode. */
function setMode(m) {
  if (m === mode.value) return
  if (isUntouchedSample()) {
    replaceAll({ newCode: m === 'mongodb' ? SAMPLE_MONGO : SAMPLE_SQL, newMode: m })
    setTimeout(() => runAutoLayout(parseSource(code.value, m, extras.value)), 50)
    toast(`Showing the ${MODE_NAME[m]} example. Once you edit the diagram, switching mode never replaces your work.`)
  } else if (!code.value.trim()) {
    session.value.ymeta.set('mode', m)
  } else {
    // the editor holds DSL in SQL mode and the short Mongoose form in MongoDB mode, so the text has to be converted
    if (schema.value.errors.length) {
      toast('Fix the errors in the editor first: the text has to be converted to the other mode.')
      return
    }
    const to = m === 'mongodb' ? 'Mongoose models' : 'SQL DSL'
    if (!confirm(`Convert this ${MODE_NAME[mode.value]} diagram to ${to}?\n\nTables, fields, keys and relations are kept. Comments, hooks and methods are not carried over. (This changes the diagram for everyone in the room.)`)) return
    const converted = convertDocument({ code: code.value, extras: extras.value }, mode.value, m)
    replaceAll({ newCode: converted.code, newMode: m, newExtras: converted.extras, newPositions: positions.value })
    const fresh = parseSource(converted.code, m, converted.extras)
    if (fresh.tables.some((t) => !positions.value[t.name])) setTimeout(() => runAutoLayout(fresh), 50)
    toast(`Converted to ${to}.`)
  }
}

function onMove(name, pos) {
  session.value.ypos.set(name, pos)
}

async function runAutoLayout(targetSchema = schema.value) {
  if (!targetSchema.tables.length) return
  try {
    const result = await autoLayout(targetSchema)
    session.value.doc.transact(() => {
      for (const [name, pos] of Object.entries(result)) session.value.ypos.set(name, pos)
    })
    setTimeout(() => diagram.value?.fitView(), 60)
  } catch (e) {
    toast(`Auto layout failed: ${e.message}`)
  }
}

function replaceAll({ newCode, newMode, newExtras = null, newPositions = {} }) {
  const { doc, ytext, ymeta, ypos } = session.value
  doc.transact(() => {
    ytext.delete(0, ytext.length)
    ytext.insert(0, normalizeEol(newCode))
    ymeta.set('seeded', true)
    if (newMode) ymeta.set('mode', newMode)
    setExtras(ymeta, (newMode ?? mode.value) === 'mongodb' ? newExtras : null)
    for (const k of Array.from(ypos.keys())) ypos.delete(k)
    for (const [k, v] of Object.entries(newPositions)) ypos.set(k, v)
  })
}

function confirmReplace() {
  return !code.value.trim() || confirm('This replaces the current diagram for everyone in the room. Continue?')
}

function newDiagram() {
  if (!confirmReplace()) return
  replaceAll({ newCode: '', newMode: mode.value })
}

function loadSample() {
  if (!confirmReplace()) return
  replaceAll({ newCode: mode.value === 'mongodb' ? SAMPLE_MONGO : SAMPLE_SQL, newMode: mode.value })
  setTimeout(() => runAutoLayout(parseSource(code.value, mode.value, extras.value)), 50)
}

async function onApplyImport({ code: imported, extras: importedExtras = null, mode: importedMode, replace }) {
  const { ytext, doc, ymeta } = session.value
  const current = code.value
  if (replace || !current.trim()) {
    replaceAll({ newCode: imported, newMode: importedMode, newExtras: importedExtras })
  } else if (importedMode === 'mongodb') {
    // keep the existing models and add the imported ones (hooks and methods of imported files ride along in the extras)
    const base = mode.value === 'mongodb' ? { code: current, extras: extras.value } : convertDocument({ code: current }, mode.value, 'mongodb')
    const merged = mergeViews({ text: base.code, extras: base.extras }, { text: imported, extras: importedExtras })
    replaceAll({ newCode: merged.text, newMode: 'mongodb', newExtras: merged.extras, newPositions: positions.value })
  } else if (mode.value !== 'sql') {
    replaceAll({ newCode: convertDocument({ code: current, extras: extras.value }, mode.value, 'sql').code + '\n' + imported, newMode: 'sql', newPositions: positions.value })
  } else {
    doc.transact(() => {
      const sep = ytext.length && !ytext.toString().endsWith('\n\n') ? (ytext.toString().endsWith('\n') ? '\n' : '\n\n') : ''
      ytext.insert(ytext.length, normalizeEol(sep + imported))
      ymeta.set('mode', 'sql')
    })
  }
  await runAutoLayout(parseSource(code.value, importedMode, extras.value))
  toast(`Import complete (${MODE_NAME[importedMode] ?? 'diagram'})`)
}

const projectInput = ref(null)
async function onOpenProject(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try {
    const p = readProjectFile(await readText(file))
    if (!confirmReplace()) return
    replaceAll({ newCode: p.code, newMode: p.mode, newExtras: p.extras, newPositions: p.positions })
    setTimeout(() => diagram.value?.fitView(), 100)
    toast(`Opened ${file.name}`)
  } catch (err) {
    toast(err.message)
  }
}

function saveProject() {
  download(makeProjectFile({ mode: mode.value, code: code.value, extras: extras.value, positions: positions.value }), 'diagram.dbd.json', 'application/json')
}

function exportCsvSchema() {
  download(schemaToCsv(schema.value), 'schema.csv', 'text/csv;charset=utf-8')
}

async function exportCsvZip() {
  if (!schema.value.tables.length) return toast('Nothing to export yet')
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('_schema.csv', schemaToCsv(schema.value))
  for (const f of tablesToCsvFiles(schema.value)) zip.file(f.name, f.content)
  download(await zip.generateAsync({ type: 'blob' }), 'tables-csv.zip')
}

async function exportImage(kind) {
  try {
    const dataUrl = await diagram.value.toImage(kind)
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `diagram.${kind}`
    a.click()
  } catch (e) {
    toast(e.message || 'Image export failed')
  }
}

async function share() {
  if (!inRoom.value) {
    const id = randomRoomId()
    try {
      sessionStorage.setItem(
        `er-seed:${id}`,
        JSON.stringify({ mode: mode.value, code: code.value, extras: extras.value, positions: positions.value }),
      )
    } catch {}
    location.hash = `#/r/${id}`
  }
  try {
    await navigator.clipboard.writeText(location.href)
    toast('Room link copied - send it to your teammates')
  } catch {
    toast('Copy the address bar link to invite teammates')
  }
}

function leaveRoom() {
  try {
    sessionStorage.setItem('er-local-seed', JSON.stringify({ mode: mode.value, code: code.value, extras: extras.value, positions: positions.value }))
  } catch {}
  location.hash = ''
  toast('You left the room. Its current content is now your local diagram.')
}

// show everyone on wide screens; on phones just you plus a "+N" counter
const visiblePeers = computed(() => (xs.value ? peers.value.filter((p) => p.me) : peers.value))
const hiddenPeers = computed(() => peers.value.length - visiblePeers.value.length)

function saveProfile() {
  saveUser(user.value)
  setUserOnAwareness(session.value.awareness, user.value)
  profileOpen.value = false
}
const SWATCHES = ['#e53935', '#8e24aa', '#3949ab', '#039be5', '#00897b', '#7cb342', '#fb8c00', '#6d4c41']

// ------------------------------------------------------------ split pane
const leftWidth = ref(Math.min(460, Math.round(window.innerWidth * 0.38)))
const dragging = ref(false)
function startDrag(e) {
  dragging.value = true
  const startX = e.clientX
  const startW = leftWidth.value
  const move = (ev) => (leftWidth.value = Math.max(260, Math.min(window.innerWidth * 0.8, startW + ev.clientX - startX)))
  const up = () => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const statusChip = computed(() => {
  switch (connection.value) {
    case 'connected':
      return { text: 'Live', color: 'success', icon: 'mdi-access-point' }
    case 'connecting':
      return { text: 'Connecting…', color: 'warning', icon: 'mdi-loading mdi-spin' }
    case 'disconnected':
      return { text: 'Offline - changes kept locally', color: 'error', icon: 'mdi-wifi-off' }
    default:
      return { text: 'Solo (autosaved in this browser)', color: 'default', icon: 'mdi-content-save-outline' }
  }
})
</script>

<template>
  <v-app>
    <v-app-bar flat density="comfortable" border="b">
      <v-app-bar-title class="flex-grow-0 mr-2" :style="{ minWidth: mdAndUp ? '150px' : '40px' }">
        <v-icon color="primary" class="mr-1">mdi-database-edit-outline</v-icon>
        <strong v-if="mdAndUp">ER Designer</strong>
      </v-app-bar-title>

      <v-btn-toggle :model-value="mode" mandatory density="compact" variant="outlined" divided :color="mode === 'mongodb' ? 'success' : 'primary'" @update:model-value="setMode">
        <v-btn value="sql" :size="xs ? 'x-small' : 'small'">SQL</v-btn>
        <v-btn value="mongodb" :size="xs ? 'x-small' : 'small'">{{ xs ? 'Mongo' : 'MongoDB' }}</v-btn>
      </v-btn-toggle>

      <v-spacer />

      <v-chip :color="statusChip.color" size="small" variant="tonal" class="mr-2 d-none d-md-inline-flex" :prepend-icon="statusChip.icon">
        {{ statusChip.text }}
      </v-chip>
      <v-icon class="mr-2 d-md-none" :color="statusChip.color" :title="statusChip.text" :aria-label="statusChip.text" role="img" size="small">{{ statusChip.icon }}</v-icon>

      <div class="d-flex align-center mr-2">
        <v-tooltip v-for="p in visiblePeers" :key="p.id" location="bottom" :text="p.me ? `${p.name} (you) - click to edit` : p.name">
          <template #activator="{ props: tp }">
            <v-avatar
              v-bind="tp"
              :color="p.color"
              size="28"
              class="ml-n1 border"
              :role="p.me ? 'button' : 'img'"
              :tabindex="p.me ? 0 : undefined"
              :aria-label="p.me ? 'Edit your name and colour' : p.name"
              :style="p.me ? 'cursor:pointer' : ''"
              @click="p.me && (profileOpen = true)"
              @keyup.enter="p.me && (profileOpen = true)"
            >
              <span class="text-caption font-weight-bold text-white">{{ p.name.slice(0, 1).toUpperCase() }}</span>
            </v-avatar>
          </template>
        </v-tooltip>
        <span v-if="hiddenPeers > 0" class="text-caption ml-1">+{{ hiddenPeers }}</span>
      </div>

      <v-btn color="primary" variant="flat" size="small" :prepend-icon="mdAndUp ? 'mdi-share-variant' : undefined" :icon="!mdAndUp" class="mr-1" :aria-label="inRoom ? 'Copy room link' : 'Share (create a room)'" @click="share">
        <template v-if="mdAndUp">{{ inRoom ? 'Copy link' : 'Share' }}</template>
        <v-icon v-else>mdi-share-variant</v-icon>
      </v-btn>
      <v-btn v-if="inRoom" variant="text" size="small" icon="mdi-exit-to-app" title="Leave room (keep a local copy)" aria-label="Leave room" @click="leaveRoom" />

      <v-menu>
        <template #activator="{ props: mp }">
          <v-btn v-bind="mp" variant="text" size="small" :prepend-icon="mdAndUp ? 'mdi-file-outline' : undefined" :icon="!mdAndUp" aria-label="File menu" :append-icon="mdAndUp ? 'mdi-menu-down' : undefined">
            <template v-if="mdAndUp">File</template>
            <v-icon v-else>mdi-file-outline</v-icon>
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item prepend-icon="mdi-file-plus-outline" title="New (empty)" @click="newDiagram" />
          <v-list-item prepend-icon="mdi-shape-outline" title="Load sample" @click="loadSample" />
          <v-divider />
          <v-list-item prepend-icon="mdi-folder-open-outline" title="Open project file…" subtitle=".dbd.json" @click="projectInput.click()" />
          <v-list-item prepend-icon="mdi-content-save-outline" title="Save project file" subtitle="continue later" @click="saveProject" />
        </v-list>
      </v-menu>

      <v-menu>
        <template #activator="{ props: mp }">
          <v-btn v-bind="mp" variant="text" size="small" :prepend-icon="mdAndUp ? 'mdi-database-import-outline' : undefined" :icon="!mdAndUp" aria-label="Import menu" :append-icon="mdAndUp ? 'mdi-menu-down' : undefined">
            <template v-if="mdAndUp">Import</template>
            <v-icon v-else>mdi-database-import-outline</v-icon>
          </v-btn>
        </template>
        <v-list density="compact" min-width="310">
          <v-list-subheader class="head head-sql"><v-icon size="14">mdi-database</v-icon> SQL</v-list-subheader>
          <v-list-item prepend-icon="mdi-file-code-outline" title="SQL dump (.sql)" subtitle="pg_dump, mysqldump, SQLite .dump" @click="openImport('sql')" />
          <v-list-item prepend-icon="mdi-database-outline" title="SQLite database (.sqlite, .db)" @click="openImport('sql')" />
          <v-divider />
          <v-list-subheader class="head head-mongo"><v-icon size="14">mdi-leaf</v-icon> MongoDB</v-list-subheader>
          <v-list-item prepend-icon="mdi-language-javascript" title="Mongoose model (.js)" subtitle="fields are shown; hooks and methods are kept for export" @click="openImport('mongodb')" />
          <v-list-item prepend-icon="mdi-code-json" title="Validator JSON ($jsonSchema)" subtitle="e.g. users_collection_validator.json" @click="openImport('mongodb')" />
          <v-list-item prepend-icon="mdi-database-export-outline" title="mongoexport data (.json, .jsonl)" subtitle="schema is inferred from the documents" @click="openImport('mongodb')" />
          <v-divider />
          <v-list-subheader class="head head-table"><v-icon size="14">mdi-table</v-icon> CSV / Excel</v-list-subheader>
          <v-list-item prepend-icon="mdi-file-delimited-outline" title="CSV / TSV" subtitle="you choose: as SQL or as MongoDB" @click="openImport('table')" />
          <v-list-item prepend-icon="mdi-file-excel-outline" title="Excel (.xlsx)" subtitle="one sheet = one table" @click="openImport('table')" />
        </v-list>
      </v-menu>

      <v-menu>
        <template #activator="{ props: mp }">
          <v-btn v-bind="mp" variant="text" size="small" :prepend-icon="mdAndUp ? 'mdi-export' : undefined" :icon="!mdAndUp" aria-label="Export menu" :append-icon="mdAndUp ? 'mdi-menu-down' : undefined">
            <template v-if="mdAndUp">Export</template>
            <v-icon v-else>mdi-export</v-icon>
          </v-btn>
        </template>
        <v-list density="compact" min-width="310">
          <v-list-subheader class="head head-sql"><v-icon size="14">mdi-database</v-icon> SQL</v-list-subheader>
          <v-list-item prepend-icon="mdi-elephant" title="PostgreSQL" subtitle="CREATE TABLE …" @click="openExport('postgres')" />
          <v-list-item prepend-icon="mdi-dolphin" title="MySQL" @click="openExport('mysql')" />
          <v-list-item prepend-icon="mdi-database-outline" title="SQLite" @click="openExport('sqlite')" />
          <v-divider />
          <v-list-subheader class="head head-mongo"><v-icon size="14">mdi-leaf</v-icon> MongoDB</v-list-subheader>
          <v-list-item prepend-icon="mdi-language-javascript" title="Mongoose models (.js)" subtitle="the complete file: schema + mongoose.model(...)" @click="openExport('mongoose')" />
          <v-list-item prepend-icon="mdi-code-json" title="Validator JSON ($jsonSchema)" @click="openExport('validator')" />
          <v-list-item prepend-icon="mdi-console" title="mongosh script (validators + indexes)" @click="openExport('mongosh')" />
          <v-divider />
          <v-list-subheader class="head head-table"><v-icon size="14">mdi-file-multiple-outline</v-icon> Any mode</v-list-subheader>
          <v-list-item prepend-icon="mdi-code-braces" title="Diagram source (DSL text)" @click="openExport('dsl')" />
          <v-list-item prepend-icon="mdi-file-delimited-outline" title="Schema as CSV" @click="exportCsvSchema" />
          <v-list-item prepend-icon="mdi-folder-zip-outline" title="Tables as CSV (ZIP)" @click="exportCsvZip" />
          <v-divider />
          <v-list-item prepend-icon="mdi-file-image-outline" title="Image (PNG)" @click="exportImage('png')" />
          <v-list-item prepend-icon="mdi-svg" title="Image (SVG)" @click="exportImage('svg')" />
        </v-list>
      </v-menu>

      <v-btn variant="text" size="small" :icon="dark ? 'mdi-weather-sunny' : 'mdi-weather-night'" :aria-label="dark ? 'Switch to light theme' : 'Switch to dark theme'" @click="theme.global.name.value = dark ? 'light' : 'dark'" />
    </v-app-bar>

    <v-main>
      <div v-if="session && ready" class="split">
        <div class="pane-left" :style="{ width: leftWidth + 'px' }">
          <div style="flex: 1; min-height: 0">
            <CodeEditor ref="editor" :key="session.doc.guid" :ytext="session.ytext" :awareness="session.awareness" :mode="mode" :schema="schema" />
          </div>
          <div v-if="schema.errors.length" class="errors">
            <button v-for="(e, i) in schema.errors" :key="i" @click="editor?.goToLine(e.line)">Line {{ e.line }}: {{ e.message }}</button>
          </div>
        </div>
        <div class="divider" :class="{ active: dragging }" @pointerdown.prevent="startDrag" />
        <div class="pane-right">
          <div class="overlay-tools">
            <v-btn size="small" variant="flat" color="surface" prepend-icon="mdi-auto-fix" @click="runAutoLayout()">Auto layout</v-btn>
            <v-btn size="small" variant="flat" color="surface" icon="mdi-fit-to-screen-outline" title="Fit to screen" aria-label="Fit to screen" @click="diagram?.fitView()" />
          </div>
          <div v-if="!schema.tables.length" class="empty-hint">
            <div class="text-center">
              <v-icon size="48">mdi-table-plus</v-icon>
              <div v-if="mode === 'mongodb'" class="mt-2">Write <code>Model User { ... }</code> on the left, or import a model file</div>
              <div v-else class="mt-2">Write a <code>Table</code> on the left, or import a file</div>
            </div>
          </div>
          <DiagramView ref="diagram" :schema="schema" :positions="positions" :dark="dark" :mode="mode" @move="onMove" />
        </div>
      </div>
      <div v-else class="d-flex align-center justify-center" style="height: 100%">
        <v-progress-circular indeterminate color="primary" />
      </div>
    </v-main>

    <ExportDialog v-model="exportOpen" :schema="schema" :code="code" :extras="extras" :mode="mode" :initial-target="exportTarget" @toast="toast" />
    <ImportDialog v-model="importOpen" :kind="importKind" :current-mode="mode" :has-content="Boolean(code.trim())" @apply="onApplyImport" @toast="toast" />
    <input ref="projectInput" type="file" accept=".json,.dbd" hidden @change="onOpenProject" />

    <v-dialog v-model="profileOpen" max-width="360">
      <v-card title="Your name & colour">
        <v-card-text>
          <v-text-field v-model="user.name" label="Display name" maxlength="24" autofocus @keyup.enter="saveProfile" />
          <div class="d-flex ga-2 flex-wrap">
            <v-avatar
              v-for="c in SWATCHES"
              :key="c"
              :color="c"
              size="30"
              style="cursor: pointer"
              :class="{ 'elevation-6': user.color === c }"
              @click="user.color = c"
            >
              <v-icon v-if="user.color === c" color="white" size="18">mdi-check</v-icon>
            </v-avatar>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="flat" :disabled="!user.name.trim()" @click="saveProfile">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" timeout="3500">{{ snackbar.text }}</v-snackbar>
  </v-app>
</template>
