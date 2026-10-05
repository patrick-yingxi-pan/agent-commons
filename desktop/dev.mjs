import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { findAvailableLoopbackPort, loopbackOrigin } from './runtime.mjs'
import { buildDesktopNativeRuntime } from './nativeBuild.mjs'

const require = createRequire(import.meta.url)
const VITE_BIN = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')
const ELECTRON_BIN = require('electron')

await buildDesktopNativeRuntime()

const uiPort = process.env.PORT ? Number(process.env.PORT) : await findAvailableLoopbackPort()
let backendPort = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : await findAvailableLoopbackPort()
while (uiPort === backendPort && !process.env.MOCK_PORT) backendPort = await findAvailableLoopbackPort()
if (uiPort === backendPort) throw new Error('Desktop UI and backend ports must differ.')

const children = []
let shuttingDown = false

function run(name, command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: 'inherit' })
  children.push(child)
  child.on('exit', (code) => {
    if (!shuttingDown) shutdown(code ?? 1, `${name} exited`)
  })
}

function shutdown(code, reason) {
  if (shuttingDown) return
  shuttingDown = true
  if (reason) console.log(`[desktop-dev] ${reason}; stopping the development stack.`)
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('ui', process.execPath, [VITE_BIN], { PORT: String(uiPort), MOCK_PORT: String(backendPort) })
run('electron', ELECTRON_BIN, ['.'], {
  AGENT_COMMONS_DEV_URL: loopbackOrigin(uiPort),
  AGENT_COMMONS_BACKEND_PORT: String(backendPort),
})
