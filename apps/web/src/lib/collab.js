import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import YProvider from 'y-partyserver/provider'

const RELAY_HOST = import.meta.env.VITE_RELAY_HOST || 'localhost:8787'
const isLocalHost = /^(localhost|127\.|\[::1\])/.test(RELAY_HOST)

const COLORS = ['#e53935', '#8e24aa', '#3949ab', '#039be5', '#00897b', '#7cb342', '#fb8c00', '#6d4c41']

const CURSOR_THROTTLE_MS = 100 // cursor updates are the most expensive messages for the relay (QA: realtime.md bug 1)
const HEARTBEAT_MS = 15000 // re-publish presence so peers can tell we are alive
const PEER_TIMEOUT_MS = 45000 // drop peers silent for this long (half-open connections never send a close)
const IDLE_DISCONNECT_MS = 10 * 60 * 1000 // hidden tab for this long -> close the socket (saves relay duration)

const ROOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 12 chars from a 36-letter alphabet (~62 bits) - unguessable enough for "anyone with the link" rooms */
export function randomRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('')
}

export function getUser() {
  try {
    const saved = JSON.parse(localStorage.getItem('er-user') || 'null')
    if (saved?.name) return saved
  } catch {}
  const user = {
    name: `Guest ${Math.floor(100 + Math.random() * 900)}`,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }
  saveUser(user)
  return user
}

export function saveUser(user) {
  try {
    localStorage.setItem('er-user', JSON.stringify(user))
  } catch {}
}

/** Send at most one `cursor` awareness update per `ms` (the last one always goes out). */
function throttleCursor(awareness, ms) {
  const original = awareness.setLocalStateField.bind(awareness)
  let timer = null
  let pending = null
  let last = 0
  const flush = () => {
    timer = null
    last = Date.now()
    const p = pending
    pending = null
    if (p) original('cursor', p.value)
  }
  awareness.setLocalStateField = (field, value) => {
    if (field !== 'cursor') return original(field, value)
    pending = { value }
    if (timer) return
    const wait = ms - (Date.now() - last)
    if (wait <= 0) flush()
    else timer = setTimeout(flush, wait)
  }
  return () => clearTimeout(timer)
}

/** Heartbeat + removal of peers that stopped updating. Returns a cleanup function. */
function watchPeers(awareness) {
  const beat = setInterval(() => {
    const state = awareness.getLocalState()
    if (state) awareness.setLocalState({ ...state })
  }, HEARTBEAT_MS)
  const sweep = setInterval(() => {
    const now = Date.now()
    const stale = []
    for (const [id, meta] of awareness.meta) {
      if (id !== awareness.clientID && awareness.states.has(id) && now - meta.lastUpdated > PEER_TIMEOUT_MS) stale.push(id)
    }
    if (stale.length) removeAwarenessStates(awareness, stale, 'timeout')
  }, HEARTBEAT_MS / 3)
  return () => {
    clearInterval(beat)
    clearInterval(sweep)
  }
}

/**
 * One shared Y.Doc:
 *   code      Y.Text  - the DSL source (source of truth for tables/relations)
 *   meta      Y.Map   - { mode: 'sql' | 'mongodb', seeded }
 *   positions Y.Map   - tableName -> { x, y }
 * With a roomId the doc syncs through the Cloudflare relay; it is always autosaved
 * to IndexedDB in this browser so a closed tab does not lose work.
 */
export function createSession(roomId, user) {
  const doc = new Y.Doc()
  const idb = new IndexeddbPersistence(`er-designer:${roomId ?? 'local'}`, doc)
  let provider = null
  let awareness
  const cleanups = []
  if (roomId) {
    provider = new YProvider(RELAY_HOST, roomId, doc, {
      party: 'document',
      protocol: isLocalHost ? 'ws' : 'wss',
    })
    awareness = provider.awareness
    cleanups.push(watchPeers(awareness))

    // Close the socket while the tab is hidden for a long time; reconnect (and resync) when it is shown again.
    let idleTimer = null
    let idle = false
    const goIdle = () => {
      idle = true
      provider.shouldConnect = false
      provider.ws?.close(1000) // a code-less close is never acknowledged by the relay
    }
    const onVisibility = () => {
      clearTimeout(idleTimer)
      if (document.hidden) idleTimer = setTimeout(goIdle, IDLE_DISCONNECT_MS)
      else if (idle) {
        idle = false
        provider.shouldConnect = true
        provider.connect()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    cleanups.push(() => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(idleTimer)
    })
  } else {
    awareness = new Awareness(doc)
  }
  cleanups.push(throttleCursor(awareness, CURSOR_THROTTLE_MS))
  awareness.setLocalStateField('user', { name: user.name, color: user.color, colorLight: user.color + '33' })

  return {
    doc,
    roomId,
    awareness,
    provider,
    ytext: doc.getText('code'),
    ymeta: doc.getMap('meta'),
    ypos: doc.getMap('positions'),
    localReady: idb.whenSynced,
    destroy() {
      cleanups.forEach((fn) => fn())
      provider?.destroy()
      idb.destroy()
      doc.destroy()
    },
  }
}

export function setUserOnAwareness(awareness, user) {
  awareness.setLocalStateField('user', { name: user.name, color: user.color, colorLight: user.color + '33' })
}
