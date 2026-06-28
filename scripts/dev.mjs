/** Dev launcher — boots the mock backend and the Vite UI together, so
 *  `npm run dev` gives you a real frontend + backend with one command. Zero
 *  dependencies: just Node's child_process, with line-prefixed output and a
 *  clean shared shutdown. Run them separately with `npm run server` / `dev:ui`. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Resolve Vite's CLI from wherever the package actually lives. In a git worktree
// that shares the parent checkout's hoisted node_modules, a path hardcoded
// relative to cwd ('node_modules/vite/bin/vite.js') doesn't exist — Node's
// upward resolution finds the real one.
const require = createRequire(import.meta.url)
const VITE_BIN = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')

const procs = []
let shuttingDown = false

// The mock backend's port. Pin it (don't inherit PORT) so it can't collide with
// the UI dev server's port when a host sets PORT for the UI (e.g. a preview
// runner). The Vite proxy targets this same port.
const MOCK_PORT = process.env.MOCK_PORT ?? '8787'

function run(name, command, args, color, env) {
  const p = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
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
  p.on('exit', (code) => {
    if (shuttingDown) return
    process.stdout.write(prefix + `exited (${code}) — shutting the other process down\n`)
    shutdown(code ?? 1)
  })
  procs.push(p)
  return p
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const p of procs) p.kill('SIGTERM')
  setTimeout(() => process.exit(code), 200)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// 36 = cyan (backend), 35 = magenta (ui). The server gets PORT pinned so it
// binds the mock port regardless of any inherited PORT (which targets the UI).
run('server', 'node', ['--watch', 'server/index.ts'], '36', { PORT: MOCK_PORT })
run('ui', 'node', [VITE_BIN], '35')
