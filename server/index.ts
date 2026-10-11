/** ── The mock backend, entry point ─────────────────────────────────────────
 *  A standalone zero-dependency HTTP server, run directly by Node 26's native
 *  TypeScript (`node server/index.ts`). It IS the backend the UI talks to:
 *
 *   • Native desktop: this runs as a local sidecar; the app loads the UI and
 *     points it at `http://127.0.0.1:<port>`. Later it can reach the real
 *     Anthropic API + native resources without the UI changing.
 *   • Web: the same server serves the built UI *and* the API from one origin —
 *     so the desktop and web experiences are byte-identical.
 *
 *  In dev, Vite serves the UI with HMR and proxies `/api/*` here. */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_BASE_PATH } from '../contract/index.ts'
import { CORS_HEADERS, SECURITY_HEADERS, sendError, sendJson } from './http/respond.ts'
import { platformCard } from './a2a.ts'
import { buildRouter } from './routes/index.ts'
import { configureScheduleExecutor, store } from './store/index.ts'
import { startRoutineScheduler } from './scheduler.ts'
import { createRoutineRunner } from './routineRunner.ts'
import { startModelServer } from './model/index.ts'
import { positiveNumberEnv } from './env.ts'
import { closePersistence } from './persistence/persist.ts'
import { enforceOrigin } from './http/origin.ts'
import { initializeMcpRuntime } from './mcpRuntime.ts'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'
const ROOT = dirname(fileURLToPath(import.meta.url))
const DIST = join(ROOT, '..', 'dist')

// The auth gate is ON by default for every REAL boot (dev / server / start):
// pre-sign-in, the app shows the front door and the API refuses data reads —
// nobody's world renders without a verified session (multi-account §12,
// hardened 2026-07). `AUTH_GATE=off` opts a boot out (e.g. the E2E stack,
// which impersonates via the dev header seam and drives sign-in explicitly
// where it tests it). Tests import the router directly and never run this
// file, so the suite's ungated default is untouched — the flag stays
// read-per-request in store.capabilities(), togglable without a reload.
process.env.AUTH_GATE ??= 'require'

// Turn on filesystem persistence and rehydrate from the last snapshot, so UI
// operations (sent messages, attached context, created sessions, schedules,
// recents, relation edits) survive a restart. Only the real server does this;
// tests import the router directly and stay in-memory.
store.initPersistence()
await initializeMcpRuntime(store.mcpCredentialBindings())
// Release/checkpoint the embedded database on every orderly exit, including the
// graceful signal path below and its bounded hard-exit fallback. A crash still
// relies on SQLite WAL recovery; an ordinary app quit should not.
process.on('exit', closePersistence)

const router = buildRouter()
const routineRunner = createRoutineRunner(store)
configureScheduleExecutor((taskId, runId) => routineRunner.enqueue(taskId, runId))

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)

  // With an exact deployment origin, browser traffic from anywhere else is
  // refused before static, API, MCP, or preflight handling. This is especially
  // load-bearing for the desktop sidecar: loopback is reachable from webpages.
  if (!enforceOrigin(req, res)) return

  // CORS preflight.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  // The A2A discovery convention (docs/a2a-integration.md, D20): the platform's
  // Agent Card at the well-known server-root path. The same card is served at
  // `GET /api/v1/a2a/card` (the router home, which dev + tests exercise); this
  // mount exists because foreign agents look here by convention.
  if (url.pathname === '/.well-known/agent-card.json') {
    sendJson(res, platformCard(url.origin))
    return
  }

  // The MCP door's canonical root mount (access-parity INV-11): MCP clients
  // conventionally point at `<origin>/mcp`. The same endpoint is served at
  // `/api/v1/mcp` (the router home, which dev + tests exercise); this mount
  // just routes the conventional path to it.
  if (url.pathname === '/mcp') {
    const handled = await router.handle(req, res, url)
    if (!handled && !res.writableEnded) sendError(res, 'not_found', `No route ${req.method} /mcp`)
    return
  }

  // API requests: strip the version prefix and route.
  if (url.pathname === API_BASE_PATH || url.pathname.startsWith(API_BASE_PATH + '/')) {
    const apiUrl = new URL(url.href)
    apiUrl.pathname = url.pathname.slice(API_BASE_PATH.length) || '/'
    const handled = await router.handle(req, res, apiUrl)
    if (!handled && !res.writableEnded) {
      sendError(res, 'not_found', `No route ${req.method} ${url.pathname}`)
    }
    return
  }

  // Everything else: serve the built UI (when present). SPA fallback to
  // index.html so client-side state survives a deep link / refresh.
  serveStatic(url.pathname, res)
})

function serveStatic(pathname: string, res: import('node:http').ServerResponse): void {
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('UI not built. Run `npm run build`, or use `npm run dev` for the dev server.')
    return
  }
  let filePath = join(DIST, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''))
  // Reject path traversal: the resolved path must stay inside DIST. A crafted
  // `/../../etc/passwd` normalizes out of dist/, so fall back to index.html.
  const distRoot = resolve(DIST)
  if (resolve(filePath) !== distRoot && !resolve(filePath).startsWith(distRoot + sep)) {
    filePath = join(DIST, 'index.html')
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(DIST, 'index.html') // SPA fallback
  }
  const body = readFileSync(filePath)
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
  // Send the Buffer's exact bytes. `body.toString()` would UTF-8-decode it, which
  // is lossy for binary assets (fonts, images, the favicon) — text assets survive
  // either way, but binaries would be corrupted, so write the Buffer verbatim.
  res.end(body)
}

server.listen(PORT, HOST, () => {
  console.log(`[mock-backend] http://${HOST}:${PORT}${API_BASE_PATH}  ·  epoch ${store.epoch}`)
  console.log(`[mock-backend] serving ${existsSync(DIST) ? 'built UI (dist/) + ' : ''}API`)
  // In development, boot the Anthropic-compatible model server in-process so
  // `npm run dev` is a complete review stack. Release profiles force
  // MODEL_INLINE=0 and therefore require an explicitly configured endpoint; a
  // direct server boot can make the same choice. The backend reaches either
  // endpoint over HTTP through the Anthropic SDK (see server/generate.ts).
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  const usingMockModel = !baseUrl || /\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)/.test(baseUrl)
  if (usingMockModel && process.env.MODEL_INLINE !== '0') startModelServer()
  // Reclaim any execution-aware run left in-flight by the previous process
  // before the cadence producer admits new work.
  routineRunner.start()
  // Waiting person reviews own no open remote session and never resume I/O on
  // restart. Local expiry only releases their private state and history hold.
  store.expireMcpInputReviews()
  const inputReviewExpiry = setInterval(() => store.expireMcpInputReviews(), 30_000)
  inputReviewExpiry.unref()
  // One desktop process owns the durable routine cursor. The same narrow port
  // can later sit behind a hosted queue/leader without changing run identity.
  const stopScheduler = startRoutineScheduler({
    listSchedules: () => store.listSchedules(),
    runSchedule: (id, options) => store.runSchedule(id, options),
    recordSkippedScheduleFire: (id, scheduledFor, at) => store.recordSkippedScheduleFire(id, scheduledFor, at),
    setScheduleNextFire: (id, nextFireAt, now) => store.setScheduleNextFire(id, nextFireAt, now),
    reapStaleRunners: (ttlMs) => store.registry.reapStale(ttlMs),
  })
  // Graceful shutdown (the dev --watch restart sends SIGTERM): begin draining so the load
  // balancer's /readyz probe fails (stops routing new traffic here), then stop accepting
  // new connections and let in-flight requests finish before exiting. A long-lived stream
  // (SSE) would otherwise hold `close()` open forever, so force-close lingering connections
  // shortly after, with a bounded hard-exit fallback. Exiting in the same tick (the old
  // behaviour) made the drain unobservable and killed in-flight work.
  const DRAIN_GRACE_MS = positiveNumberEnv(process.env.DRAIN_GRACE_MS, 5_000)
  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    store.beginDraining()
    stopScheduler()
    routineRunner.stop()
    clearInterval(inputReviewExpiry)
    server.close(() => process.exit(0)) // exits once all connections have closed
    // Let normal in-flight requests finish, then force-close lingering streams so close()
    // can complete; a hard fallback guarantees exit even then. Both unref'd so they never
    // keep the process alive on their own.
    setTimeout(() => server.closeAllConnections?.(), 1_000).unref()
    setTimeout(() => process.exit(0), DRAIN_GRACE_MS).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
})
