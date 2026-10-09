# ER Designer - browser E2E report (UI)

Tester: QA (built-in Browser pane, Chromium 152 shell, Vite dev server + workerd relay, localhost). Date: 2026-10-08.
Other testers were running Node load tests against the relay at the same time, so timings are somewhat noisy.

## Verdict

The app is in good shape for its core flows: boot, live diagram, parser errors, autocomplete, mode switch, every importer (CSV, xlsx, pg/MySQL dump, SQLite, mongoexport), all code/CSV/ZIP exports, project save/open, and real-time collaboration through the relay (live text, awareness, concurrent edits, fresh client, offline-edit then reconnect). The Excel school file imports exactly as expected (6 tables, MongoDB, `_id`, 10 refs, STATUS table last, no errors, no overlaps).

There is one clear major bug: **PNG/SVG export depends on the current pan/zoom** (blank or cropped/shifted image in the normal state after "Fit"). Other notable bugs: non-ASCII (Thai/accented) identifiers are rejected by the DSL and silently stripped on import, `bigserial` import yields `bigbigint`, "Leave room (keep a local copy)" does not keep the room content, ref validation errors always say "Line 1", and the app bar overlaps at 375 px.

## Results

| Area | Check | Result | Evidence |
|---|---|---|---|
| Boot | Fresh load, console | PASS (minor warning) | No errors. One recurring `[Vue Flow] options parameter is deprecated` warning (DiagramView `useVueFlow({id:'er'})`). A 404 for `favicon.ico` is the pane itself (page declares an inline data-URI icon). |
| Boot | Sample: 3 tables, edges, 1/N labels | PASS | 3 nodes, 2 edges, labels "1","N","N","N" in DOM/screenshot |
| Boot | No overflow at 375/640/1024/1280 | PASS | `scrollWidth==innerWidth`, `scrollHeight==innerHeight` at all four; split column layout < 760px, row layout above |
| Boot | App bar reachable | PARTIAL | 640/1024/1280 OK. At 375 px the MongoDB toggle (x 122-219) is overlapped by the avatar (171-199) and Share button (207-247); label shows "MONG". Bug 6. Status chip is `d-none d-md-inline-flex` so the connection state is invisible below 960px (Bug 9). |
| Boot | Dark mode | PASS | editor bg rgb(35,38,43)/text white, canvas rgb(27,29,33), gutter, dialogs and popup dark; persisted in localStorage `er-theme`. Syntax colours (purple `pk`, dark-orange `Table`) are not re-tuned for dark (cosmetic, Bug 12). |
| Boot | Reload persistence | PASS | mode, code, dragged position (translate 99,197) and theme survive reload |
| Editor | New table appears <300 ms | PASS | 151 ms from CM dispatch to new node in DOM |
| Editor | Syntax errors + line numbers + click | PARTIAL | Syntax errors: correct lines (7, 9); click moves cursor to line 7. But "Ref points to unknown table/field" errors always report "Line 1" (Bug 3). |
| Editor | Delete table removes edges | PASS | edges 2 -> 1, node removed; dangling-ref error shown |
| Editor | 150 tables | PASS | all 150 nodes rendered 591 ms after insert; auto layout ~1.0 s; workspace stays viewport-high (`scrollHeight 800`, cm-scroller scrollHeight 19853 scrolls internally) - the stretch bug is fixed |
| Editor | Pan/zoom smoothness at 150 tables | PASS (noisy) | synthetic ctrl-wheel for 3 s: median frame 13.9 ms, p95 14.7 ms, one 1 s stall (first frame). Pane rAF is throttled so absolute numbers are indicative only |
| Autocomplete | SQL type popup | PASS | typing `name va` -> `varchar(255)`, `varchar(255)[]`; Enter inserts `varchar(255)` |
| Autocomplete | Settings inside `[` | PASS | Ctrl+Space inside `[` lists default:, increment, not null, note:, null, pk, primary key, ref: >, unique; Enter on `re` -> `ref: > ` |
| Autocomplete | `ref: >` and `Ref:` targets/operators | PASS | `users.id`, `ac.name`; after `Ref: a.b ` lists `-`, `<`, `<>`, `>` with descriptions |
| Autocomplete | Mongo types + tables + `Name[]` | PASS | lists Addr/users, `Addr[]`, `users[]` first, then string/int/long/.../object[] |
| Autocomplete | Ctrl+Space, Enter | PASS | (async: popup appears ~300-600 ms after key in the pane) |
| Autocomplete | **Tab accepts** | FAIL | Tab indents the line instead (keymap has `indentWithTab`, `completionKeymap` has only Enter). Bug 8 |
| Autocomplete | Dark theme / viewport | PASS | popup bg rgb(35,38,43), selected rgb(17,119,204)/white; at 375 px the popup fits (right edge 375) |
| Autocomplete | Detail for half-typed line | cosmetic | a field listed as `ac.name  varchar(255) [ref` (type column shows unparsed tail) |
| Mode | Toggle SQL/MongoDB, rapid 40x | PASS | ends on last click, no errors |
| Mode | Default export tab | PASS | Mongo -> Mongoose, SQL -> PostgreSQL; chip order puts mongosh before Mongoose (sort comparator, cosmetic) |
| Mode | New / Load sample + confirm | PASS | Load sample in Mongo mode gives Mongo sample; confirm honoured |
| Diagram | Drag table persists in `positions` | PASS | dispatching mouse events: position updated, survives reload, bot sees `POS` map; (real `left_click_drag` could not be used - pane screenshot/coords are scaled) |
| Diagram | Auto layout / Fit / zoom / minimap | PASS | Auto layout on school xlsx: 0 overlaps; Fit, Controls and minimap present and working |
| Diagram | Embedded tables dashed teal, edges, self-ref | PASS | Mongo sample: dashed borders on Address/OrderItem, dashed edges with 1/N labels; `self.parent_id` self-ref draws 1 edge |
| Import | CSV single, multiple, `id` -> pk | PASS | people.csv + orders.csv -> 2 tables, `id int [pk]` |
| Import | Excel school xlsx | PASS | 6 tables (SCHOOL, USER, TRACKING, MEETING, IMPLEMENT, STATUS_reference last), mode MongoDB, 5 `_id objectid [pk]`, 10 refs, 0 overlaps, no editor errors |
| Import | PostgreSQL dump | PARTIAL | tables/FKs fine; `bigserial` -> `bigbigint` (Bug 2); duplicate FK (inline + ALTER) yields duplicate `Ref:` line |
| Import | MySQL dump | PASS | backticks, AUTO_INCREMENT, FK `ON DELETE CASCADE` -> 1 ref |
| Import | SQLite binary (sql.js in page) | PASS | authors/books, autoincrement pk, FK ref |
| Import | mongoexport .jsonl / .json | PASS | `$oid` -> objectid, nested object -> embedded `UsersAddr`, array, `$date` -> date; mode MongoDB |
| Import | Replace vs Add | PASS | Add kept authors,books + added customers,invoices |
| Import | Corrupt/unsupported files | PASS | "file is not a database", JSON syntax error text, "unsupported file type, skipped"; doc unchanged, toast "Nothing could be imported", app intact |
| Import | Drag & drop zone | PASS | dragover sets `.over`, drop lists file |
| Import | 5 MB CSV (110k rows) | PASS | longest main-thread block 230 ms (long task), total < 1 s |
| Import | CSV type inference | cosmetic | decimals (`1.5`) become `varchar(255) [not null]` |
| Import | **Thai names** | FAIL | file `นักเรียน.csv` with Thai headers -> `Table column { column int ...; column_2 ...}` (names lost). Bug 5 |
| Export | All code targets | PASS | PostgreSQL/MySQL/SQLite/Mongoose/mongosh/Diagram source generated for Mongo sample |
| Export | Copy | PARTIAL | pane denies clipboard (`Write permission denied`); app correctly falls back to toast "Copy failed - select the text"; success path not testable |
| Export | Download | PASS | captured `schema-mysql.sql` blob link |
| Export | Schema CSV / Tables ZIP | PASS | `schema.csv` header+rows correct; ZIP has `_schema.csv`, users.csv, Address.csv, orders.csv, OrderItem.csv with header rows |
| Export | **PNG / SVG correctness** | FAIL | blank or shifted/cropped unless pan=(0,0) zoom=1. Bug 1 |
| Export | PNG at identity viewport | PASS | 2104x792 (expected 1052x396 css x2), dark bg rgb(27,29,33), content 80..2023 x 80..711 (40 px pad each side); light mode also correct (content 77..582) |
| Export | SVG | PARTIAL | size 1052x396 correct, but the background colour sits on the translated clone: 28 px transparent strip top/left, bg clipped 28 px at right/bottom (Bug 1 b) |
| Export | 150-table PNG | PASS (degraded) | 2500x19468 css px diagram -> 2162x16384 px PNG (canvas limit, whole diagram scaled to ~0.42x), 9 s |
| Project file | Save / modify / Open | PASS | `diagram.dbd.json` keys format/version/mode/code/positions; reopening restores code (identical), mode, positions exactly |
| Project file | Corrupt/wrong JSON | PASS | "Not a valid project file (invalid JSON).", "Not an ER Designer project file." (empty, `{}`, `[1,2]`, `code:5`), doc untouched |
| Collab | Share -> hash, chip Live | PASS | `#/r/08085q1x12`, chip "Live" (clipboard denied in pane -> fallback toast) |
| Collab | Bot text/table appears live | PASS | `from_bot` table node appeared within ~1 s, bot avatar `R` |
| Collab | Concurrent edits convergence | PASS | bot inserted 100 lines at doc start every 20 ms while browser appended 40 lines: both ended with 100 bot + 40 web lines, no duplicates, identical text |
| Collab | Avatars / name+colour propagate | PASS | rename "Renamed Me" + colour `#8e24aa` seen by bot awareness (colorLight updated); 3 peers shown as 3 avatars (no overflow handling) |
| Collab | Leave room | FAIL | returns to Solo, but shows the *old solo* document, not the room's content (Bug 4) |
| Collab | New client (empty IDB) | PASS | opening `#/r/qa-fresh-1` with no local data pulled text from relay on first load (mode SQL, 1 node) |
| Collab | Offline edits sync after reconnect | PASS | `provider.disconnect()`, edit, `provider.connect()` -> relay contained `offline_edit2` (fresh bot read) |
| Collab | Offline chip | NOT VERIFIED | could not make the socket drop in the pane: client `ws.close()` stayed in CLOSING for >7 s (the relay closes in 5 ms from Node), so chip stayed "Live". Relay was not stopped. |
| Robust | Rapid mode toggle, rapid hash switch (12x, 30 ms) | PASS | no errors, app consistent |
| Robust | Dialog open/close repeatedly | PASS | no leaks (one dialog left open was a test-script race; Esc closed it) |
| Robust | Empty project | PASS | hint "Write a Table on the left, or import a file" |
| Robust | Names with spaces/quotes | PASS | `"my table"`, `"ตาราง ไทย"` quoted work |
| Robust | Unquoted Thai/accented identifiers | FAIL | Bug 5 |
| Robust | 1000-char field name | PASS (cosmetic) | node renders, width 304 px, no crash |
| Robust | Back/forward + invalid room hash | PARTIAL | `#/r/abc`, `#/r/bad%20room!`, 65-char ids silently fall back to Solo without any message (Bug 10); back/forward navigation itself works |
| A11y | Esc closes dialogs, menu keyboard (Enter, Down, Enter) | PASS | menu opened, item activated, focus returned to the button |
| A11y | Icon-only buttons labelled | FAIL | theme toggle, Share/File/Export icon buttons (< 960px), diagram controls have no `aria-label`/`title`; avatar (profile) is a clickable div, not keyboard reachable (Bug 7) |

## Bugs found

### 1. PNG/SVG export depends on the current pan/zoom (major)
Repro: open sample (or any diagram), press Fit (or pan/zoom anywhere), Export > Image (PNG). Observed: with viewport `translate(64,242) scale(0.76)` the PNG (2104x792) contains only a part of two nodes at the bottom-left (users/Address missing); with `translate(135,230) scale(2)` in light mode the PNG is completely blank (content bbox empty). With the viewport at (0,0,1) the PNG is correct. SVG at (100,60,0.5) still contains `transform: matrix(0.5,0,0,0.5,100,60)` on the inner pane.
Cause: `toImage` targets `.er-flow .vue-flow__viewport` and puts the translate/scale on it, but the live transform is on its child `.vue-flow__transformationpane`, which html-to-image copies as an inline style so the two transforms compose.
Fix: `apps/web/src/components/DiagramView.vue` `toImage`: either pass the `.vue-flow__transformationpane` as the element and put `style.transform` there, or add an `onClone`/`style` override resetting the inner pane transform to `none`/`translate(pad-minX,pad-minY) scale(1)`. Also apply `backgroundColor` to a wrapper that is not translated (SVG output currently has a 28 px transparent strip top/left because the bg lives on the translated clone). (b, cosmetic) the export promise never resolves when the tab is in the background because html-to-image waits on `requestAnimationFrame`; add a timeout + toast. Observed in the pane as an apparent hang until the page painted.

### 2. SQL import: `bigserial` becomes `bigbigint` (major for PostgreSQL dumps)
Repro: import `CREATE TABLE posts (id bigserial PRIMARY KEY, ...)`. Observed `id bigbigint [pk, increment]`. Expected `bigint`.
Cause: `packages/schema/src/importers/ddl.js` line ~118 `f.type.replace(/serial/i, ...)` replaces only the `serial` part of `bigserial`. Fix: `f.type = /^big/i.test(f.type) ? 'bigint' : /^small/i.test(f.type) ? 'smallint' : 'int'`. Related minor: inline `REFERENCES` plus `ALTER TABLE ... FOREIGN KEY` for the same column produces two identical `Ref:` lines (dedupe in `ddlToSchema`).

### 3. "Ref points to unknown table/field" always reports Line 1 (minor)
Repro: `Ref: a.id > zz.id` on line 10 -> error button says "Line 1". Same for inline `[ref: > a.nope]`.
Cause: `packages/schema/src/parser.js` lines 182-183 `err(0, ...)`. Fix: remember the source line index of each ref when parsing and pass it to `err`.

### 4. "Leave room (keep a local copy)" does not keep the room content (major)
Repro: Share, edit in the room (or have a peer add a table), click the leave icon. Observed: Solo mode shows the earlier solo document (the room's added table and 100 lines absent). Expected (by tooltip): the room content as a local copy.
Cause: `App.vue` `leaveRoom()` only clears the hash; Solo uses the separate IndexedDB `er-designer:local`. Fix: before clearing the hash copy `code/mode/positions` into the local doc (e.g. `sessionStorage` seed like `share()` does, applied when no room) or ask whether to replace the local diagram.

### 5. Non-ASCII identifiers rejected (DSL) and stripped (import) (major for Thai users)
Repro a: DSL `Table ตาราง_ไทย { รหัส int [pk] }` or `Table café {...}`: "Unexpected ..." on every line and the table is not created (quoted `"ตาราง ไทย"` works, but the unquoted field `ชื่อ varchar(50)` inside a quoted table also fails: "Expected: <field name> <type>").
Repro b: import `นักเรียน.csv` with header `รหัส,ชื่อ,city` -> `Table column { column int ...; column_2 varchar(255)...}` (Thai names replaced, first column even typed int as `column`).
Cause: `IDENT` in `packages/schema/src/parser.js` line 3 is `[A-Za-z_][\w$]*`, importer sanitising strips non-ASCII. Fix: use Unicode (`[\p{L}_][\p{L}\p{N}_$]*` with the `u` flag), and have the serializer quote names that still need it instead of dropping characters.

### 6. App bar overlap at 375 px (minor)
Repro: viewport 375 wide: SQL/MongoDB toggle (122-219) overlaps the avatar (171-199) and Share icon (207-247); the MongoDB label is clipped to "MONG" and its right half is covered. Fix: `App.vue` app bar: hide avatars or shrink toggle (`size="x-small"`, `min-width`) below 400 px, or move peers into the File menu.

### 7. Accessibility: unlabelled icon buttons (minor)
Theme toggle, icon-only Share/File/Export (< `md`), Vue Flow control buttons have no `aria-label`/`title`; the user avatar opens the profile dialog via a plain `v-avatar @click` (not focusable). Fix: add `aria-label`/`title`, make the avatar a `v-btn`.

### 8. Tab does not accept an autocomplete suggestion (minor)
Repro: Ctrl+Space, press Tab. Result: the line is indented (4 spaces) and the popup closes/filters. Expected (feature request): Tab accepts. Fix: `CodeEditor.vue` keymap: add `{ key: 'Tab', run: acceptCompletion }` before `indentWithTab`.

### 9. Connection status invisible on narrow screens (minor)
`App.vue` status chip has `d-none d-md-inline-flex`; below 960 px there is no Live/Offline indicator at all. Fix: show an icon-only chip/badge on the avatar or app bar for small screens.

### 10. Invalid room hash silently falls back to solo (minor)
`#/r/abc`, ids with illegal chars or > 64 chars load the Solo doc with no message while the URL still looks like a room link. Fix: toast "Invalid room id" and normalise the hash, or accept shorter ids.

### 11. Misc cosmetic
- `useVueFlow({ id: 'er' })` deprecated: use `useVueFlow('er')` (console warning on every load, `DiagramView.vue`).
- Export-code chip order: `ordered` sort comparator is inconsistent (mongosh is placed before Mongoose), `ExportDialog.vue`.
- `randomRoomId()` gives ids like `08085q1x12` (padStart zeros, ~40 bits): fine but low entropy for "private" rooms.
- CSV import types decimals as `varchar(255)`; default `now()` imported as quoted string `'now()'` instead of a backtick expression.
- Auto layout of 150 chained tables yields a 2500x19468 px strip (poor aspect ratio) and a 150-table PNG is downscaled to the 16384 px canvas limit.

### 12. Dark-mode syntax colours (cosmetic)
`CodeEditor.vue` `HighlightStyle` uses fixed light-theme colours (`#7c3aed` on `rgb(35,38,43)` is about 3:1 contrast). Provide a dark highlight style.

## Not tested / limitations
- Real `left_click_drag` on diagram nodes (pane screenshot coordinates are scaled/lagging); dragging was done with dispatched mouse events (same d3-drag path).
- Clipboard success path (permission denied in the pane); only the fallback toast verified.
- Offline status chip on an abrupt relay loss: the socket never left CLOSING in the pane, and the relay must not be stopped. Reconnect/sync after `disconnect()`/`connect()` was verified.
- Live screenshot of the autocomplete popup in light mode (only DOM checks); real cursors of remote users (`.cm-ySelectionInfo`) were not observed because the bots only edited, they set no selection.
- An early console burst of Vue errors (`Cannot set properties of null (setting '__vnode')`, hoisted vnode warnings) appeared in my very first page session after a room->local hash change, with the page left over from before; I could not reproduce it in a clean load or in 12 rapid hash switches (likely dev-server HMR/dedupe artifact), so it is not listed as a bug.
- Timings are from the dev server (unminified) with other load tests running.

## Cleanup
`apps/web/public/_qa` removed, viewport emulation reset to desktop. Helper files kept in `tests-e2e/ui/` (`bot.mjs`: Yjs peer bot with append/typing/watch modes; `genbig.mjs`: big CSV generator). Rooms created on the relay: `08085q1x12`, `qa-fresh-1`, `qa-boot-1`, `rapid-room-*`, `valid-room-xyz1`. The browser's solo IndexedDB currently holds a 150-table diagram from the last test.
