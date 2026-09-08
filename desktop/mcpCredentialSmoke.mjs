/** Packaged MCP credential startup acceptance.
 *
 * This is intentionally smaller than the general desktop smoke. It uses the
 * real packaged Electron executable and OS safeStorage, but never invokes MCP
 * discovery or a tool. A public HTTPS connection is created only as a durable
 * test row; its inspected catalog is seeded while the app is stopped so this
 * smoke has no live external network dependency.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { packagedExecutable } from './smokePaths.mjs'
import { MCP_CREDENTIAL_FILE } from './mcpCredentialVault.mjs'
import { MCP_MODERN_VERSION } from '../server/mcpDiscovery.ts'
import { SqliteBackend } from '../server/persistence/sqlite.ts'
import { findAvailableLoopbackPort, loopbackOrigin } from './runtime.mjs'

const TIMEOUT_MS = 30_000
const SMOKE_SECRET = 'agent-commons-mcp-native-smoke-secret'
const ENDPOINT = 'https://example.invalid/mcp'

function tail(current, chunk) {
  return `${current}${chunk}`.slice(-16_384)
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replaceAll(SMOKE_SECRET, '<redacted>')
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
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

async function waitForCdp(origin) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(1_000) })).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Packaged Electron did not expose its smoke debugging endpoint.')
}

async function launch(executable, userDataPath) {
  const debuggingOrigin = loopbackOrigin(await findAvailableLoopbackPort())
  let output = ''
  const child = spawn(executable, [
    `--user-data-dir=${userDataPath}`,
    `--remote-debugging-port=${new URL(debuggingOrigin).port}`,
  ], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output = tail(output, chunk) })
  child.stderr.on('data', (chunk) => { output = tail(output, chunk) })
  let browser
  try {
    const origin = await new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.stdout.off('data', inspect)
        child.stderr.off('data', inspect)
        child.off('error', onError)
        child.off('exit', onExit)
        error ? reject(error) : resolve(value)
      }
      const inspect = () => {
        const match = output.match(/\[desktop\] ready (http:\/\/127\.0\.0\.1:\d+)/)
        if (match) finish(null, match[1])
      }
      const onError = (error) => finish(error)
      const onExit = (code, signal) => finish(new Error(`Packaged desktop exited before readiness (${signal ?? `code ${code}`}).\n${output}`))
      const timer = setTimeout(() => finish(new Error(`Packaged desktop did not become ready.\n${output}`)), TIMEOUT_MS)
      child.on('error', onError)
      child.on('exit', onExit)
      child.stdout.on('data', inspect)
      child.stderr.on('data', inspect)
      inspect()
    })
    await waitForCdp(debuggingOrigin)
    browser = await chromium.connectOverCDP(debuggingOrigin)
    const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith(origin))
    if (!page) throw new Error('Packaged Electron did not expose its trusted renderer page.')
    return { child, browser, page, origin, output: () => output }
  } catch (error) {
    await browser?.close().catch(() => {})
    await stop(child)
    throw error
  }
}

async function close(run) {
  if (!run) return
  await run.browser.close().catch(() => {})
  await stop(run.child)
}

async function postJson(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, text: await response.text() }
  }, { path, body })
}

async function seedBoundConnection(userDataPath, connectionId, tenantId, reference, endpoint) {
  const database = new SqliteBackend(join(userDataPath, 'store.db'))
  try {
    const state = database.load()
    if (!state?.mcpConnections) throw new Error('Packaged startup smoke found no persisted MCP state.')
    const row = state.mcpConnections.connections.find((candidate) => candidate.id === connectionId && candidate.tenantId === tenantId)
    if (!row) throw new Error('Packaged startup smoke could not find its test connection.')
    row.revision = 1
    row.connected = true
    row.credentialReference = reference
    row.inspection = {
      protocolVersion: MCP_MODERN_VERSION,
      cleanup: 'not-needed',
      inspectedAt: Date.now(),
      tools: [],
    }
    if (row.endpoint !== endpoint || row.authentication !== 'device-bearer') {
      throw new Error('Packaged startup smoke connection binding changed unexpectedly.')
    }
    database.save(state)
  } finally {
    database.close()
  }
}

async function vaultState(userDataPath) {
  return JSON.parse(await readFile(join(userDataPath, MCP_CREDENTIAL_FILE), 'utf8'))
}

async function assertStoredDatabaseRedacted(userDataPath, phase) {
  for (const filename of ['store.db', 'store.db-wal', 'store.db-shm']) {
    const path = join(userDataPath, filename)
    if (!existsSync(path)) continue
    const raw = await readFile(path)
    if (raw.includes(Buffer.from(SMOKE_SECRET))) {
      throw new Error(`The ${phase} SQLite ${filename} contains the raw smoke secret.`)
    }
  }
}

async function assertPrivateVault(userDataPath, reference) {
  const path = join(userDataPath, MCP_CREDENTIAL_FILE)
  const raw = await readFile(path, 'utf8')
  const state = JSON.parse(raw)
  if (raw.includes(SMOKE_SECRET)) throw new Error('The packaged MCP vault contains the raw smoke secret.')
  if (!state.entries?.[reference]) throw new Error('The packaged MCP vault lost the provisioned reference.')
  if (process.platform !== 'win32' && (((await stat(path)).mode & 0o777) !== 0o600)) {
    throw new Error('The packaged MCP vault is not private to the OS user.')
  }
  return state
}

async function readMcpList(page, origin) {
  return page.evaluate(async (url) => {
    const response = await fetch(url)
    return { status: response.status, text: await response.text() }
  }, `${origin}/api/v1/mcp-connections`)
}

export async function smokePackagedMcpCredentials({ executable = packagedExecutable() } = {}) {
  if (!existsSync(executable)) throw new Error(`Packaged desktop executable is missing: ${executable}`)
  const userDataPath = await mkdtemp(join(tmpdir(), 'agent-commons-mcp-smoke-'))
  let run
  let connectionId
  let tenantId
  try {
    run = await launch(executable, userDataPath)
    let { page, origin } = run
    const bridge = await page.evaluate(() => ({
      available: typeof window.agentCommonsDesktop?.mcpCredentials?.provision === 'function',
      keys: Object.keys(window.agentCommonsDesktop?.mcpCredentials ?? {}).sort(),
    }))
    if (!bridge.available || bridge.keys.join(',') !== 'provision') {
      throw new Error('Real OS-backed MCP credential provision bridge is unavailable.')
    }

    const identity = await page.evaluate(async () => {
      const response = await fetch('/api/v1/auth/signup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Native MCP Smoke', email: 'native-mcp-smoke@example.test', password: 'native-mcp-smoke-password' }),
      })
      if (!response.ok) throw new Error(`MCP smoke signup returned HTTP ${response.status}`)
      return response.json()
    })
    tenantId = identity.tenant.id

    const created = await postJson(page, '/api/v1/mcp-connections', {
      creationId: 'native-mcp-startup-smoke', label: 'Native MCP startup smoke', endpoint: ENDPOINT, authentication: 'device-bearer',
    })
    if (created.status !== 200) throw new Error(`MCP smoke connection creation returned HTTP ${created.status}`)
    connectionId = JSON.parse(created.text).connection.id
    const bindingResponse = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/mcp-connections/${encodeURIComponent(id)}/credential-binding`)
      return { status: response.status, body: await response.json() }
    }, connectionId)
    if (bindingResponse.status !== 200) throw new Error(`MCP smoke binding lookup returned HTTP ${bindingResponse.status}`)
    const binding = bindingResponse.body.binding
    const reference = await page.evaluate(async ({ binding, secret }) =>
      window.agentCommonsDesktop.mcpCredentials.provision(binding, secret), { binding, secret: SMOKE_SECRET })
    await assertPrivateVault(userDataPath, reference)

    await assertStoredDatabaseRedacted(userDataPath, 'initial')
    if (run.output().includes(SMOKE_SECRET)) throw new Error('The initial packaged launch log contains the raw smoke secret.')
    await close(run)
    run = undefined

    await seedBoundConnection(userDataPath, connectionId, tenantId, reference, ENDPOINT)
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    if (run.output().includes(SMOKE_SECRET)) throw new Error('The packaged startup log contains the raw smoke secret.')

    const listed = await readMcpList(page, origin)
    if (listed.status !== 200) throw new Error(`MCP smoke list returned HTTP ${listed.status}`)
    if (listed.text.includes(ENDPOINT) || listed.text.includes(reference) || listed.text.includes(SMOKE_SECRET)) {
      throw new Error('Ordinary MCP connection reads exposed endpoint, credential reference, or raw secret.')
    }
    const list = JSON.parse(listed.text)
    if (list.capabilities?.deviceBearerCredentials !== true || list.capabilities?.loopbackConnections !== false || list.capabilities?.credentialCleanupPending !== false) {
      throw new Error('MCP startup did not retain secure device credentials with loopback disabled.')
    }
    const loopbackRefusal = await postJson(page, '/api/v1/mcp-connections', {
      creationId: 'native-mcp-refused-loopback', label: 'Refused local server',
      endpoint: 'http://127.0.0.1:9/mcp', authentication: 'none',
    })
    if (loopbackRefusal.status !== 400) throw new Error('Packaged MCP setup admitted an unapproved loopback endpoint.')
    const visible = list.connections?.find((connection) => connection.id === connectionId)
    if (!visible || visible.status !== 'connected' || visible.execution !== 'unavailable' || 'endpoint' in visible || 'credentialReference' in visible) {
      throw new Error('The relaunched MCP connection projection is incomplete or over-privileged.')
    }
    await assertPrivateVault(userDataPath, reference)

    const disconnected = await postJson(page, `/api/v1/mcp-connections/${encodeURIComponent(connectionId)}/disconnect`, { expectedRevision: 1 })
    if (disconnected.status !== 200) throw new Error(`MCP smoke disconnect returned HTTP ${disconnected.status}`)
    const disconnectBody = JSON.parse(disconnected.text)
    if (disconnectBody.credentialCleanup !== 'complete' || disconnectBody.connection?.status !== 'disconnected') {
      throw new Error('MCP disconnect did not acknowledge complete credential cleanup.')
    }
    const afterDisconnect = await vaultState(userDataPath)
    if (afterDisconnect.entries?.[reference] !== undefined || JSON.stringify(afterDisconnect).includes(SMOKE_SECRET)) {
      throw new Error('MCP disconnect left the bound credential reference behind.')
    }
    const removed = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/mcp-connections/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2 }) })
      return { status: response.status, body: await response.json() }
    }, connectionId)
    if (removed.status !== 200 || removed.body.removed !== true || removed.body.credentialCleanup !== 'complete') {
      throw new Error('MCP remove did not acknowledge the disconnected cleanup state.')
    }
    await assertStoredDatabaseRedacted(userDataPath, 'final')
    console.log('[desktop-mcp-smoke] real packaged Electron + OS safeStorage provision · persisted binding startup reconciliation · HTTPS-only/no-loopback posture · ordinary-read redaction · disconnect cleanup')
  } catch (error) {
    throw new Error(`Packaged MCP credential smoke failed: ${safeError(error)}`)
  } finally {
    await close(run)
    await rm(userDataPath, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await smokePackagedMcpCredentials().catch((error) => {
    console.error(safeError(error))
    process.exitCode = 1
  })
}
