# ER Designer - real-time collaboration QA (relay at localhost:8787)

Date: 2026-10-08. Relay: `wrangler dev` 4.148.0 / workerd 1.20261006.1, partyserver 0.5.10, y-partyserver 2.2.0, yjs 13.6.33. Machine: 12 logical cores, Windows 10. All scripts are in `tests-e2e/realtime/`, raw JSON in `tests-e2e/realtime/out/`. No source under apps/, packages/, scripts/ was modified.

## Verdict

**Correctness: good. Capacity: comfortable for the stated 5-6 users, fine up to about 10 users, degraded at about 20, collapsing at 40.** In every convergence run with N <= 20 all clients ended with byte-identical text, positions and meta, and a fresh joiner saw the same state (no divergence, no lost edit, no duplicated text; also after offline edits and after a full relay restart). With 6 users all typing (3 edits/s each) and all dragging (10 moves/s each) at the same time, end-to-end propagation was **p50 1-2 ms / p95 4 ms / p99 6 ms / max 11 ms** (local relay, measured). At 10 users p95 was 9 ms (text) / 7 ms (positions). At 20 users in the worst-case profile p95 was about 230-280 ms; at 40 users the relay saturates (seconds to tens of seconds of backlog, no convergence within 60 s). The cost that dominates at scale is **awareness (cursor) traffic**, not document updates (bug 1). All numbers are local (no network latency); the Internet figures at the end are an estimate, not a measurement.

## Scenario results

Profile "worst" = every bot types 3 edits/s (table / column / char inserts at random line positions, ~20% deletes) AND moves a random table 10x/s AND updates its cursor awareness 2x/s, for 20 s. Profile "realistic" = every bot 1 edit/s, only 2 bots dragging at 10 moves/s, cursor 2x/s. Latency = writer's local write -> observed in another bot's doc (timestamp embedded in the text / position value, single clock). Values in ms, format p50/p95/p99/max.

| # | Scenario | Result | Numbers |
|---|---|---|---|
| 1/2 | N=2 worst (`t1-converge-latency.mjs 2`) | PASS | converged; text 1/2/3/3; pos 1/2/3/3 |
| 1/2 | N=6 worst | PASS | converged; text 1/4/6/10; pos 2/3/6/11; 441 delivered updates/s (30 KB/s) |
| 1/2 | N=10 worst | PASS | converged; text 2/9/21/30; pos 3/7/20/39; 1232 updates/s |
| 1/2 | N=20 worst, 1 client process | correctness PASS, latency FAIL | text 145/1083/1308/1719; pos 144/1275/1806/2433. The client process was also CPU-bound, so this overstates relay latency |
| 1/2 | N=20 worst, 4 client processes (`t1-multi.mjs 20 4 20 3 10 all`) | correctness PASS, latency degraded | converged (settle 0.6 s); text 57/229/276/421; pos 79/252/297/355; 5147 updates/s |
| 1/2 | N=40 worst, 1 process and 8 processes | FAIL | not converged within 60 s / 90 s (backlog still draining); text p50 10-15 s, p95 41-66 s; 28-34% of position updates not observed individually (coalesced or still queued) |
| 2 | Realistic, N=6 (`t1-multi.mjs 6 2 20 1 10 2`) | PASS | text 2/4/9/13, pos 2/3/9/14 |
| 2 | Realistic, N=10 | PASS | text 2/12/22/26, pos 2/13/27/47 |
| 2 | Realistic, N=20 | degraded | text 34/275/320/423, pos 48/266/331/395 (converged) |
| 2 | Realistic, N=40 | FAIL (latency) | text p50 6.0 s, p95 33 s; converged only after ~33 s |
| 2 | Realistic, N=20 / N=40 **without awareness** (`NOAWARE=1`) | PASS | N=20: text 3/7/22/55, pos 3/6/10/19. N=40: text 5/19/59/75, pos 4/11/17/87. Same document traffic; only cursor updates removed |
| 3 | Late joiner: doc = 4800 lines / 200 tables / 363 KB text / 200 positions / 373 KB Yjs state (`t3-late-joiner.mjs`) | PASS | single joiner to `synced` with full content: 14-17 ms (5 runs). 6 simultaneous joiners (3 rounds): p50 40 / p95 58 / max 58 ms. Content identical every time |
| 4a | Drop + offline edits: 65 offline edits while 3 bots wrote 195 (`t4a-offline-edits.mjs`) | PASS | converged 220 ms after reconnect; 0 missing, 0 duplicated markers, 260/260 position keys. NB: needed `ws.close(1000)` to go offline, see bug 3 |
| 4b | Relay restart, 5 bots writing continuously incl. during the outage (`t4b-relay-restart.mjs`, run 3 times; last run with non-blocking harness) | PASS | bots detected the drop in ~0.37 s and auto-reconnected ~50 ms after the relay answered HTTP 200; 3.7 s from kill to all 5 connected+synced (dominated by wrangler boot, ~2.7 s). 315 marker edits (some written while relay was down): 0 missing, **0 duplicated**; the 20 seeded tables appear exactly once; `meta.seeded` preserved; fresh joiner identical. No text duplication |
| 5 | Room isolation, 2 rooms x 3 bots, 10 s concurrent edits (`t5-isolation.mjs`) | PASS | no text / positions / awareness / meta leakage either way; each room converged independently (mode sql vs mongodb stayed separate) |
| 6 | Awareness, 6 bots (`t6-awareness.mjs`) | PASS | each bot sees all 6 (self + 5) within 27 ms, identical views. Disappearance after disconnect: clean close(1000) 60 ms; `provider.destroy()` 64 ms; killed process (TCP reset) 63 ms |
| 6b | Half-open connection: TCP proxy stops forwarding, sockets stay open (`t6b-halfopen.mjs`) | FAIL | ghost user still visible after 150 s (test cap); never removed |
| 7 | Soak 180 s, 6 bots (~1076 edits + 12 pos/s + cursors) (`t7-soak.mjs`) | PASS | 0 dropped connections, 0 errors, converged; latency 2/4/6/327 (p50/p95/p99/max). Memory: test node RSS 72 -> 99 MB; workerd DO host 144 -> 212 MB at 136 s, then 201 MB at 151-181 s (looks like GC sawtooth on a 66 KB doc; not proven). New relay log: 0 errors |

Harness caveats (honest limits): timestamps are `Date.now()` (1 ms resolution); load generator and relay share one machine (12 cores; the relay's Durable Object is single-threaded, so it is the bottleneck, not the machine); "delivery ratio" for positions is 0.95-0.99 in converged runs only because a later write to the same key can overwrite the marker before my observer reads it (last-writer-wins) - state convergence was checked separately; text delivery ratio was 1.0 in all converged runs. Server-side throughput is not directly exposed by the relay; I report client-side delivered updates/s instead (sum over bots of Y.Doc `update` events). The old relay log (`...tasks/bj6ha9a83.output`) contains 121 `Uncaught Error: Network connection lost` lines, produced by my overload runs (N=40) and by abrupt `process.exit`/kill of clients (teardown noise, not seen in normal runs). Because test 4b restarts the relay, **the relay now running on :8787 is the one started by `restart-relay.ps1` (hidden cmd window), logging to `tests-e2e/results/relay-restarted.log`** (0 errors there); the original background task output no longer receives logs.

## Bugs / risks found

### 1. [major] Relay throughput collapses with many users; awareness (cursor) traffic is disproportionately expensive
- Repro: `cd tests-e2e/realtime; node --no-warnings t1-multi.mjs 40 4 20 1 10 2 -x` vs `NOAWARE=1 node --no-warnings t1-multi.mjs 40 4 20 1 10 2 -x`.
- Observed: with 2 cursor updates/s per user: p50 text latency 6 s / p95 33 s, convergence after 33 s. Without them (same document traffic, ~2400 doc updates/s delivered): p50 5 ms / p95 19 ms. At N=20: p95 275 ms vs 7 ms. Note N=20 "worst" sends ~5000 doc updates/s with p95 ~250 ms, while the realistic N=20 profile with only ~800 doc updates/s plus ~800 awareness deliveries/s reaches the same p95, so an awareness message costs several times a doc update.
- Expected: cursor messages cost about the same as other small messages.
- Likely cause (from reading `y-partyserver/dist/server/index.js`, NOT profiled): for every incoming awareness message the server runs `applyAwarenessUpdate`, whose `update` handler calls `setAwarenessIds -> conn.setState(...)` for the sender each time, and then re-broadcasts the message to all connections including the sender, giving O(N^2) messages per second.
- Suggested fix: (a) client: throttle awareness updates to ~10/s per user (debounce the cursor changes coming from `yCollab`) - cheapest and biggest win; (b) patch/upstream y-partyserver: only call `setAwarenessIds` when `added`/`removed` is non-empty, and do not echo awareness to its sender; (c) for rooms above ~15 users coalesce awareness on the server (batch every 50-100 ms).
- Practical impact for 5-6 users: none measured (p95 4 ms).

### 2. [major for real life; production behaviour untested] Ghost presence on half-open connections
- Repro: `node --no-warnings t6b-halfopen.mjs` (~150 s).
- Observed: a client whose connection silently stops (sleeping laptop, Wi-Fi loss, no FIN/RST) stays in everyone's awareness list (avatar/cursor) for more than 150 s; clean closes and killed processes vanish in ~60 ms. y-partyserver clears the awareness `_checkInterval` on both client and server (the 30 s y-protocols timeout is disabled) and there is no heartbeat.
- Expected: disappears within about 30-60 s.
- Fix: have every client re-publish awareness every ~15 s and, in the web app, drop peers not updated for 30-45 s (`awarenessProtocol.removeAwarenessStates`), or add a server-side ping/idle timeout. Production Cloudflare may detect dead sockets sooner than local workerd - not verified.

### 3. [minor] Code-less WebSocket close is never acknowledged; `provider.disconnect()` followed by `connect()` does not work
- Repro: `node --no-warnings repro-codeless-close-hang.mjs` (`close()` stays in CLOSING forever; `close(1000)` completes in ~11 ms; same with the `ws` package) and `node --no-warnings repro-disconnect-connect-noop.mjs` (after `disconnect()`, `wsconnected` stays true and `connect()` is a no-op, so offline edits are NOT pushed). My first run of the offline test failed for this reason: 65 offline edits never reached peers and vice versa, no convergence in 20 s.
- Cause: `partyserver/dist/index.js` `closeQuietly()` intentionally skips replying to close codes 1005/1006/1015, but `WebSocket.close()` without a code (which `WebsocketProvider.disconnect()` calls) yields 1005 while the peer is alive and waiting for the reply.
- Impact: the web app only calls `provider.destroy()` (server-side cleanup works, 64 ms), so no user-visible bug today; but any future "work offline / reconnect" button built on `disconnect()/connect()` will silently not sync, and the status never reports `disconnected`.
- Fix: in partyserver reply `ws.close(1000)` for 1005 (only skip 1006/1015), or in the app use `provider.ws.close(1000)` with `shouldConnect=false`. Whether browsers behave the same against production Cloudflare is not verified.

### 4. [minor / design risk] No persistence
- State lives only in the Durable Object memory and in clients' docs. Verified positive: a relay restart is fully healed from client docs with no duplication (test 4b). Risk: when the last client leaves, or the relay restarts while nobody is connected, the server copy is gone (each user's IndexedDB copy re-merges when they reopen the link, but a person on another browser/device sees an empty room). During a restart window a new visitor can reach an empty room; the app's `seedIfNeeded` could then seed a sample (needs a pending sessionStorage seed and empty text) - not reproduced, flagged only.
- Fix if it matters: implement `onSave/onLoad` of `YServer` with Durable Object storage (debounced).

### 5. [minor / inconclusive] Relay memory behaviour
- workerd DO host grew 144 -> 212 MB over 136 s with a 66 KB doc and 6 light users, then fell to ~201 MB. Probably GC; a 30+ minute soak is needed to rule out a leak.

### 6. [info] App-side cost
- `App.vue` `syncPeers` runs on every awareness `change` (every remote cursor move) and rebuilds the peers array; with many users that is re-render work proportional to N x cursor rate. Throttling cursor updates (bug 1 fix a) addresses both.

## Estimate for real Internet latency (ESTIMATE, not measured)
Everything above ran on loopback, so network time was ~0. For real users, one edit's end-to-end delay is roughly (RTT of sender to the Durable Object + RTT of receiver to the Durable Object) / 2 plus the 2-10 ms processing measured here. The DO lives in one place (near the first user who opens the room). Assumed typical values: everyone in the same region (RTT 20-50 ms to the DO): about 20-60 ms; users on different continents (RTT 100-250 ms): about 100-250 ms for the farthest pair; mobile / poor Wi-Fi adds 20-100 ms plus jitter. With 5-6 users this should feel real-time for typing and dragging for a same-region team. A single Durable Object is single-threaded and Cloudflare production limits could not be tested locally; the collapse point measured here (roughly 3-5k small messages/s delivered) is for local workerd and production will differ.

## How to reproduce everything
```
cd D:\collaborative_tool\tests-e2e\realtime
node --no-warnings t1-converge-latency.mjs <N> 20      # single process, N=2,6,10,20,40
node --no-warnings t1-multi.mjs <N> <procs> 20 <editsPerBot> <movesPerDragger> <draggers|all> [tag]   # multi-process; NOAWARE=1 removes cursor updates
node --no-warnings t3-late-joiner.mjs
node --no-warnings t4a-offline-edits.mjs
node --no-warnings t4b-relay-restart.mjs      # restarts the relay via restart-relay.ps1 (kills wrangler/workerd only, never vite)
node --no-warnings t5-isolation.mjs
node --no-warnings t6-awareness.mjs ; node --no-warnings t6b-halfopen.mjs
node --no-warnings t7-soak.mjs 180
```
