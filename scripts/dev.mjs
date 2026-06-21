/** Dev launcher — boots the mock backend and the Vite UI together, so
 *  `npm run dev` gives you a real frontend + backend with one command. Zero
 *  dependencies: just Node's child_process, with line-prefixed output and a
 *  clean shared shutdown. Run them separately with `npm run server` / `dev:ui`. */
import { spawn } from 'node:child_process'

const procs = []
let shuttingDown = false

function run(name, command, args, color) {
  const p = spawn(command, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
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

// 36 = cyan (backend), 35 = magenta (ui).
run('server', 'node', ['--watch', 'server/index.ts'], '36')
run('ui', 'node', ['node_modules/vite/bin/vite.js'], '35')
