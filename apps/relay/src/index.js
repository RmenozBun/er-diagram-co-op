import { routePartykitRequest } from 'partyserver'
import { YServer } from 'y-partyserver'
import { originAllowed } from './origin.js'
import { expireIfStale, hasStoredRoom, isEmptyRoom, loadDocument, saveDocument, touch } from './persist.js'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const TOUCH_EVERY_MS = 10 * 60 * 1000

/**
 * One Durable Object per room.
 *
 * The shared Yjs document lives in memory while people are connected and is saved to the Durable Object's
 * own storage (debounced, and immediately when the last person leaves). A room that nobody opened for
 * ROOM_TTL_DAYS (default 15) is deleted by a daily alarm. Rooms that were never written to are not stored.
 *
 * `hibernate: false` keeps the doc in memory while sockets are connected. (Hibernation would evict the object between
 * messages; it could be enabled now that the doc is restored from storage, but that needs a new round of load tests.)
 */
export class Document extends YServer {
  static options = { hibernate: false }
  static callbackOptions = { debounceWait: 3000, debounceMaxWait: 15000 }

  #queue = Promise.resolve()
  #lastTouch = 0

  get #ttlMs() {
    return Number(this.env.ROOM_TTL_DAYS ?? 15) * DAY
  }
  get #sweepMs() {
    return Math.max(1000, Number(this.env.ROOM_SWEEP_HOURS ?? 24) * HOUR)
  }

  async onLoad() {
    const storage = this.ctx.storage
    if (await expireIfStale(storage, this.#ttlMs)) return undefined
    return (await loadDocument(storage))?.doc
  }

  /** Called by YServer shortly after the document changed. Saves are serialised so they never overlap. */
  onSave() {
    this.#queue = this.#queue.then(() => this.#persist()).catch((err) => console.error('failed to persist room:', err))
    return this.#queue
  }

  async #persist() {
    const storage = this.ctx.storage
    if (isEmptyRoom(this.document) && !(await hasStoredRoom(storage))) return // never store rooms nobody wrote to
    await saveDocument(storage, this.document)
    await this.#armAlarm()
  }

  async #armAlarm() {
    const storage = this.ctx.storage
    if ((await storage.getAlarm()) === null) await storage.setAlarm(Date.now() + this.#sweepMs)
  }

  onConnect(conn, ctx) {
    super.onConnect(conn, ctx)
    const now = Date.now()
    if (now - this.#lastTouch > TOUCH_EVERY_MS) {
      this.#lastTouch = now
      this.#queue = this.#queue
        .then(async () => {
          await touch(this.ctx.storage, now)
          if (await hasStoredRoom(this.ctx.storage)) await this.#armAlarm()
        })
        .catch((err) => console.error('touch failed:', err))
    }
  }

  onClose(conn, code, reason, wasClean) {
    super.onClose(conn, code, reason, wasClean)
    // last person left: save right away instead of waiting for the debounce, and stamp "last used"
    if ([...this.getConnections()].length === 0) {
      this.#lastTouch = Date.now()
      this.onSave().then(() => touch(this.ctx.storage)).catch((err) => console.error('final save failed:', err))
    }
  }

  /** Daily: delete the stored room when it has not been used for ROOM_TTL_DAYS, otherwise check again later. */
  async onAlarm() {
    const storage = this.ctx.storage
    if ([...this.getConnections()].length > 0) return storage.setAlarm(Date.now() + this.#sweepMs)
    if (await expireIfStale(storage, this.#ttlMs)) {
      this.#clearMemory() // this object may still be alive: forget the old content too
      console.log(`[er] room ${this.name} expired and was deleted`)
      return undefined
    }
    if (await hasStoredRoom(storage)) await storage.setAlarm(Date.now() + this.#sweepMs)
    return undefined
  }

  /** Empties the in-memory document (only called while nobody is connected). */
  #clearMemory() {
    const doc = this.document
    doc.transact(() => {
      const text = doc.getText('code')
      text.delete(0, text.length)
      for (const name of ['positions', 'meta']) {
        const map = doc.getMap(name)
        for (const key of Array.from(map.keys())) map.delete(key)
      }
    })
  }
}

const ROOM_ID = /^[\w-]{4,64}$/
const text = (status, body) => new Response(body, { status, headers: { 'content-type': 'text/plain' } })

export default {
  async fetch(request, env) {
    const guard = (req, lobby) => {
      if (!ROOM_ID.test(lobby.name)) return text(400, 'Invalid room id (4-64 letters, digits, - or _)')
      if (!originAllowed(req.headers.get('Origin'), env.ALLOWED_ORIGINS)) return text(403, 'Origin not allowed')
    }
    const res = await routePartykitRequest(request, env, {
      cors: { 'Access-Control-Allow-Origin': '*' },
      onBeforeConnect: guard,
      onBeforeRequest: guard,
    })
    return res ?? text(200, 'ER relay is running. Connect via /parties/document/<room>.')
  },
}

