/** Dev launcher — boots the mock backend and the Vite UI together, so
 *  `npm run dev` gives you a real frontend + backend with one command. Zero
 *  dependencies: just Node's child_process, with line-prefixed output and a
 *  clean shared shutdown. Run them separately with `npm run server` / `dev:ui`. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { observeChild, stopOwnedChildren } from './childProcessLifecycle.mjs'

// Resolve Vite's CLI from wherever the package actually lives. In a git worktree
// that shares the parent checkout's hoisted node_modules, a path hardcoded
// relative to cwd ('node_modules/vite/bin/vite.js') doesn't exist — Node's
// upward resolution finds the real one.
const require = createRequire(import.meta.url)
const VITE_BIN = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')

const procs = []
let shuttingDown = false

// The UI dev-server port. A host (e.g. a preview runner) may assign one via PORT;
// otherwise Vite's default (5173) applies.
const UI_PORT = process.env.PORT
// The mock backend's port — kept distinct from the UI port. An explicit MOCK_PORT
// wins; otherwise derive it from the UI port (+1) when that was host-assigned, so
// two dev stacks on different assigned ports don't both grab 8787 (and the backends
// can't collide). Falls back to 8787 for a plain `npm run dev`. The Vite proxy
// targets this same port (passed into the UI child below).
const MOCK_PORT = process.env.MOCK_PORT ?? (UI_PORT ? String(Number(UI_PORT) + 1) : '8787')

function run(name, command, args, color, env) {
  const p = spawn(command, args, { env: { ...process.env, ...env },
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  const owned = observeChild(p, { processGroup: true })
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `
  const pipe = (stream, out) => {
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) out.write(prefix + line + '\n')
    })
  }
  pipe(p.stdout, process.stdout)
  pipe(p.stderr, process.stderr)
  p.on('error', error => {
    process.stderr.write(prefix + `could not start: ${error.message}\n`)
    shutdown(1)
  })
  owned.outcome.then(({ code, signal, closed }) => {
    if (shuttingDown) return
    process.stdout.write(prefix + `closed (${signal ?? code}) — shutting the other process down\n`)
    shutdown(closed ? code ?? 1 : 1)
  })
  procs.push(owned)
  return p
}

async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  const result = await stopOwnedChildren(procs)
  if (!result.complete || result.errors.length) {
    process.stderr.write('Dev stack shutdown could not be confirmed cleanly.\n')
  }
  process.exitCode = result.complete && result.errors.length === 0 ? code : 1
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
// A disappearing parent must not strand the backend just because log forwarding
// encountered a closed pipe before its signal handler could finish.
process.stdout.on('error', () => { void shutdown(1) })
process.stderr.on('error', () => { void shutdown(1) })

// 36 = cyan (backend), 35 = magenta (ui). Interactive development watches the
// backend by default. Owned verification stacks are immutable for their whole
// run and explicitly opt out: one recursive watcher per Playwright shard can
// otherwise exhaust the host's file-descriptor limit before a browser starts.
const SERVER_ARGS =
  process.env.SERVER_WATCH === 'off' ? ['server/index.ts'] : ['--watch', 'server/index.ts']
// The server gets PORT pinned so it binds the mock port regardless of any
// inherited PORT (which targets the UI).
run('server', 'node', SERVER_ARGS, '36', { PORT: MOCK_PORT })
// Pass MOCK_PORT through so the UI's Vite proxy (vite.config.ts) targets the same
// backend port the server just bound — including the derived one above.
run('ui', 'node', [VITE_BIN], '35', { MOCK_PORT })
