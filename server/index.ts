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
import { CORS_HEADERS, sendError } from './http/respond.ts'
import { buildRouter } from './routes/index.ts'
import { store, startRunDaemon } from './store.ts'
import { startModelServer } from './model/index.ts'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'
const ROOT = dirname(fileURLToPath(import.meta.url))
const DIST = join(ROOT, '..', 'dist')

// Turn on filesystem persistence and rehydrate from the last snapshot, so UI
// operations (sent messages, attached context, created sessions, schedules,
// recents, relation edits) survive a restart. Only the real server does this;
// tests import the router directly and stay in-memory.
store.initPersistence()

const router = buildRouter()

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

  // CORS preflight.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
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
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
  // Send the Buffer's exact bytes. `body.toString()` would UTF-8-decode it, which
  // is lossy for binary assets (fonts, images, the favicon) — text assets survive
  // either way, but binaries would be corrupted, so write the Buffer verbatim.
  res.end(body)
}

server.listen(PORT, HOST, () => {
  console.log(`[mock-backend] http://${HOST}:${PORT}${API_BASE_PATH}  ·  epoch ${store.epoch}`)
  console.log(`[mock-backend] serving ${existsSync(DIST) ? 'built UI (dist/) + ' : ''}API`)
  // In mock mode, boot the Anthropic-compatible model server in-process so one
  // command (`npm run dev` / `npm start`) is a complete stack. The backend reaches
  // it over loopback HTTP through the Anthropic SDK (see server/generate.ts).
  // Pointed at the real API (ANTHROPIC_BASE_URL=https://api.anthropic.com) — or
  // with MODEL_INLINE=0 — this stands down.
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  const usingMockModel = !baseUrl || /\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)/.test(baseUrl)
  if (usingMockModel && process.env.MODEL_INLINE !== '0') startModelServer()
  // The scheduled-run daemon: fires a run on a cadence and pushes it to clients.
  const stopDaemon = startRunDaemon()
  // Clean shutdown (the dev --watch restart sends SIGTERM): stop the daemon's
  // interval so it can't outlive the process / pile up across restarts.
  const shutdown = () => {
    stopDaemon()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
})
