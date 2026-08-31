import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000
const OUTPUT_LIMIT = 16_384

export function packagedExecutable(root = ROOT, targetPlatform = platform(), targetArch = arch()) {
  const artifact = join(root, 'out', `Agent Commons-${targetPlatform}-${targetArch}`)
  if (targetPlatform === 'darwin') return join(artifact, 'Agent Commons.app', 'Contents', 'MacOS', 'Agent Commons')
  if (targetPlatform === 'win32') return join(artifact, 'Agent Commons.exe')
  return join(artifact, 'Agent Commons')
}

function appendTail(current, chunk) {
  return `${current}${chunk}`.slice(-OUTPUT_LIMIT)
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise((resolve) => setTimeout(() => resolve(true), 5_000)),
  ])
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))])
  }
}

export async function smokePackagedDesktop({ executable = packagedExecutable() } = {}) {
  if (!existsSync(executable)) throw new Error(`Packaged desktop executable is missing: ${executable}`)

  const userDataPath = await mkdtemp(join(tmpdir(), 'agent-commons-desktop-smoke-'))
  let output = ''
  const child = spawn(executable, [`--user-data-dir=${userDataPath}`], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output = appendTail(output, chunk) })
  child.stderr.on('data', (chunk) => { output = appendTail(output, chunk) })

  try {
    const origin = await new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.stdout.off('data', inspect)
        child.stderr.off('data', inspect)
        child.off('error', onError)
        child.off('exit', onExit)
        error ? reject(error) : resolve(value)
      }
      const inspect = () => {
        const match = output.match(/\[desktop\] ready (http:\/\/127\.0\.0\.1:\d+)/)
        if (!match) return
        finish(null, match[1])
      }
      const onError = (error) => finish(error)
      const onExit = (code, signal) => finish(
        new Error(`Packaged desktop exited before readiness (${signal ?? `code ${code}`}).\n\n${output}`),
      )
      const timeout = setTimeout(
        () => finish(new Error(`Packaged desktop did not become ready.\n\n${output}`)),
        TIMEOUT_MS,
      )
      child.stdout.on('data', inspect)
      child.stderr.on('data', inspect)
      child.once('error', onError)
      child.once('exit', onExit)
    })

    const response = await fetch(origin, { redirect: 'error' })
    const html = await response.text()
    if (!response.ok || !html.includes('<title>Agent Commons</title>')) {
      throw new Error(`Packaged renderer probe failed with HTTP ${response.status}.`)
    }
    if (!existsSync(join(userDataPath, 'store.db'))) {
      throw new Error('Packaged desktop did not create its SQLite store under isolated OS user data.')
    }
    console.log(`[desktop-smoke] ready ${origin} · isolated SQLite · built renderer`)
  } finally {
    await stop(child)
    await rm(userDataPath, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedDesktop()
