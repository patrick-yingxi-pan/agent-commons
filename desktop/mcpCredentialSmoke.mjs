/** Packaged MCP credential lifecycle acceptance.
 *
 * This is intentionally smaller than the general desktop smoke. It uses the
 * real packaged Electron executable and OS safeStorage, but never invokes MCP
 * discovery or a tool. A public HTTPS connection is created only as a durable
 * test row; its inspected catalog is seeded while the app is stopped so this
 * smoke has no live external network dependency.
 */
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { packagedExecutable } from './smokePaths.mjs'
import { MCP_CREDENTIAL_FILE } from './mcpCredentialVault.mjs'
import { MCP_MODERN_VERSION } from '../server/mcpDiscovery.ts'
import { SqliteBackend } from '../server/persistence/sqlite.ts'
import { findAvailableLoopbackPort, loopbackOrigin } from './runtime.mjs'

const TIMEOUT_MS = 30_000
const SMOKE_SECRET = 'agent-commons-mcp-native-smoke-secret'
const REPLACEMENT_SECRET = 'agent-commons-mcp-native-replacement-secret'
const PROVISIONAL_SECRET = 'agent-commons-mcp-native-provisional-secret'
const SMOKE_SECRETS = [SMOKE_SECRET, REPLACEMENT_SECRET, PROVISIONAL_SECRET]
const ENDPOINT = 'https://example.invalid/mcp'

function tail(current, chunk) {
  return `${current}${chunk}`.slice(-16_384)
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return SMOKE_SECRETS.reduce((redacted, secret) => redacted.replaceAll(secret, '<redacted>'), message)
}

const containsSecret = value => SMOKE_SECRETS.some(secret => value.includes(secret))

async function stop(child) {
  if (!child) return
  const exited = () => child.exitCode !== null || child.signalCode !== null
  if (exited() && child.stdout.closed && child.stderr.closed) return
  let onClose
  // `exit` alone does not prove final stdout/stderr bytes have been delivered.
  const closed = new Promise(resolve => { onClose = resolve; child.once('close', onClose) })
  const wait = async milliseconds => {
    let timer
    try {
      return await Promise.race([
        closed.then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds) }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    if (!exited()) child.kill('SIGTERM')
    if (await wait(5_000)) return
    if (!exited()) child.kill('SIGKILL')
    if (!await wait(1_000)) throw new Error('Packaged Electron did not stop and drain its log streams.')
  } finally {
    child.off('close', onClose)
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
  let secretLogged = false
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
  const capture = chunk => {
    // Retain the verdict even when an earlier log rolls out of the bounded tail.
    secretLogged ||= containsSecret(`${output}${chunk}`)
    output = tail(output, chunk)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
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
    return { child, browser, page, origin, secretLogged: () => secretLogged }
  } catch (error) {
    await browser?.close().catch(() => {})
    await stop(child)
    assert.equal(secretLogged, false, 'A failed packaged launch logged a raw smoke secret.')
    throw error
  }
}

async function close(run) {
  if (!run) return
  await run.browser.close().catch(() => {})
  await stop(run.child)
  assert.equal(run.secretLogged(), false, 'A packaged launch log contains a raw smoke secret.')
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

async function seedBoundConnection(userDataPath, connectionId, tenantId, reference, endpoint, expectedRevision) {
  const database = new SqliteBackend(join(userDataPath, 'store.db'))
  try {
    const state = database.load()
    if (!state?.mcpConnections) throw new Error('Packaged startup smoke found no persisted MCP state.')
    const row = state.mcpConnections.connections.find((candidate) => candidate.id === connectionId && candidate.tenantId === tenantId)
    if (!row) throw new Error('Packaged startup smoke could not find its test connection.')
    assert.equal(row.revision, expectedRevision, 'The offline catalog fixture must advance the exact saved revision.')
    row.revision += 1
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

async function assertStoredDatabaseRedacted(userDataPath, phase) {
  for (const filename of ['store.db', 'store.db-wal', 'store.db-shm']) {
    const path = join(userDataPath, filename)
    if (!existsSync(path)) continue
    const raw = await readFile(path)
    if (SMOKE_SECRETS.some(secret => raw.includes(Buffer.from(secret)))) {
      throw new Error(`The ${phase} SQLite ${filename} contains the raw smoke secret.`)
    }
  }
}

async function assertPrivateVault(userDataPath, references) {
  const path = join(userDataPath, MCP_CREDENTIAL_FILE)
  const raw = await readFile(path, 'utf8')
  const state = JSON.parse(raw)
  if (containsSecret(raw)) throw new Error('The packaged MCP vault contains a raw smoke secret.')
  assert.deepEqual(Object.keys(state.entries).sort(), [...references].sort(), 'The encrypted vault must retain exactly the expected references.')
  if (process.platform !== 'win32' && (((await stat(path)).mode & 0o777) !== 0o600)) {
    throw new Error('The packaged MCP vault is not private to the OS user.')
  }
  return state
}

async function readMcpList(page, origin, references, cleanupPending = false) {
  const listed = await page.evaluate(async (url) => {
    const response = await fetch(url)
    return { status: response.status, text: await response.text() }
  }, `${origin}/api/v1/mcp-connections`)
  assert.equal(listed.status, 200, 'The ordinary MCP connection list must remain available.')
  assert.equal(containsSecret(listed.text) || listed.text.includes(ENDPOINT) || references.some(reference => listed.text.includes(reference)), false,
    'Ordinary MCP connection reads exposed an endpoint, credential reference, or raw secret.')
  const list = JSON.parse(listed.text)
  assert.equal(list.capabilities?.deviceBearerCredentials, true, 'Real OS-backed credentials must remain available.')
  assert.equal(list.capabilities?.loopbackConnections, false, 'Production loopback scope must remain disabled.')
  assert.equal(list.capabilities?.credentialCleanupPending, cleanupPending, 'Ordinary reads must report actual credential cleanup state.')
  return list
}

function assertConnection(list, id, status, revision) {
  const connection = list.connections?.find(candidate => candidate.id === id)
  assert.ok(connection, 'The exact saved MCP connection must remain visible.')
  assert.equal(connection.status, status, 'Credential work must not change the acknowledged connection state.')
  assert.equal(connection.revision, revision, 'Credential work must preserve the expected product revision.')
  assert.equal(connection.execution, 'unavailable', 'Credential acceptance must not enable external tool execution.')
  assert.equal('endpoint' in connection || 'credentialReference' in connection, false, 'Public connections must exclude credential bindings.')
}

async function provision(page, connectionId, tenantId, secret) {
  const response = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/mcp-connections/${encodeURIComponent(id)}/credential-binding`)
    return { status: response.status, body: await response.json() }
  }, connectionId)
  assert.equal(response.status, 200, 'The owner-only credential binding must remain available.')
  const binding = response.body.binding
  assert.deepEqual(binding, { connectionId, tenantId, endpoint: ENDPOINT }, 'Native provision must target the exact server audience.')
  return page.evaluate(async ({ binding, secret }) =>
    window.agentCommonsDesktop.mcpCredentials.provision(binding, secret), { binding, secret })
}

function assertDurableDisconnect(userDataPath, connectionId, tenantId, revision) {
  // Observe the committed WAL through a separate read-only connection, without
  // stopping the app (which would replace explicit cleanup Retry with startup).
  const database = new DatabaseSync(join(userDataPath, 'store.db'), { readOnly: true })
  try {
    const slice = database.prepare('SELECT json FROM kv WHERE key = ?').get('mcpConnections')
    const row = JSON.parse(slice.json).connections.find(candidate => candidate.id === connectionId && candidate.tenantId === tenantId)
    assert.ok(row, 'Native cleanup failure must not remove the saved connection.')
    assert.equal(row.connected, false, 'Disconnect must commit to SQLite despite native cleanup failure.')
    assert.equal(row.revision, revision, 'SQLite must retain the acknowledged disconnect revision.')
    assert.equal(row.credentialReference, undefined, 'A disconnected row must revoke its credential binding before native cleanup.')
  } finally {
    database.close()
  }
}

async function withBlockedVaultPublication(userDataPath, operation) {
  const path = join(userDataPath, MCP_CREDENTIAL_FILE)
  const backup = `${path}.smoke-backup`
  const original = await readFile(path)
  await rename(path, backup)
  let obstructed = false
  try {
    // Only this isolated test-owned filename is obstructed. SQLite stays writable;
    // native atomic file publication fails before rename, not after durability.
    await mkdir(path, { mode: 0o700 })
    obstructed = true
    await operation()
    assert.ok((await readFile(backup)).equals(original), 'A failed native publication must preserve the original encrypted bytes.')
  } finally {
    if (obstructed) await rmdir(path) // exact empty test directory, never recursive
    await rename(backup, path)
  }
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
    const reference = await provision(page, connectionId, tenantId, SMOKE_SECRET)
    const references = [reference]
    await assertPrivateVault(userDataPath, references)

    await assertStoredDatabaseRedacted(userDataPath, 'initial')
    await close(run)
    run = undefined

    await seedBoundConnection(userDataPath, connectionId, tenantId, reference, ENDPOINT, 0)
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    assertConnection(await readMcpList(page, origin, references), connectionId, 'connected', 1)
    const loopbackRefusal = await postJson(page, '/api/v1/mcp-connections', {
      creationId: 'native-mcp-refused-loopback', label: 'Refused local server',
      endpoint: 'http://127.0.0.1:9/mcp', authentication: 'none',
    })
    if (loopbackRefusal.status !== 400) throw new Error('Packaged MCP setup admitted an unapproved loopback endpoint.')
    await assertPrivateVault(userDataPath, [reference])

    const replacement = await provision(page, connectionId, tenantId, REPLACEMENT_SECRET)
    assert.notEqual(replacement, reference, 'Token replacement must mint a distinct encrypted reference.')
    references.push(replacement)
    await assertPrivateVault(userDataPath, [reference, replacement])
    assertConnection(await readMcpList(page, origin, references), connectionId, 'connected', 1)
    await assertStoredDatabaseRedacted(userDataPath, 'replacement')
    await close(run)
    run = undefined
    await seedBoundConnection(userDataPath, connectionId, tenantId, replacement, ENDPOINT, 1)
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    await assertPrivateVault(userDataPath, [replacement])
    assertConnection(await readMcpList(page, origin, references), connectionId, 'connected', 2)

    const provisionalRow = await postJson(page, '/api/v1/mcp-connections', {
      creationId: 'native-mcp-unrelated-provisional', label: 'Unrelated provisional MCP token', endpoint: ENDPOINT, authentication: 'device-bearer',
    })
    assert.equal(provisionalRow.status, 200, 'The unrelated test connection must be created.')
    const provisionalId = JSON.parse(provisionalRow.text).connection.id
    const provisional = await provision(page, provisionalId, tenantId, PROVISIONAL_SECRET)
    references.push(provisional)
    await assertPrivateVault(userDataPath, [replacement, provisional])

    const connectionPath = `/api/v1/mcp-connections/${encodeURIComponent(connectionId)}`
    await withBlockedVaultPublication(userDataPath, async () => {
      const disconnected = await postJson(page, `${connectionPath}/disconnect`, { expectedRevision: 2 })
      assert.equal(disconnected.status, 200, 'Native cleanup failure must not undo an acknowledged disconnect.')
      const body = JSON.parse(disconnected.text)
      assert.equal(body.credentialCleanup, 'pending', 'Failed encrypted-vault publication must require explicit cleanup Retry.')
      assertConnection({ connections: [body.connection] }, connectionId, 'disconnected', 3)
      assertConnection(await readMcpList(page, origin, references, true), connectionId, 'disconnected', 3)
      assertDurableDisconnect(userDataPath, connectionId, tenantId, 3)
    })
    await assertPrivateVault(userDataPath, [replacement, provisional])
    const retried = await postJson(page, `${connectionPath}/credential-cleanup`, {})
    assert.equal(retried.status, 200, 'Explicit credential cleanup Retry must remain available.')
    const retryBody = JSON.parse(retried.text)
    assert.equal(retryBody.credentialCleanup, 'complete', 'Restoring vault publication must allow explicit cleanup to finish.')
    assertConnection({ connections: [retryBody.connection] }, connectionId, 'disconnected', 3)
    await assertPrivateVault(userDataPath, [provisional])
    assertConnection(await readMcpList(page, origin, references), connectionId, 'disconnected', 3)
    assertDurableDisconnect(userDataPath, connectionId, tenantId, 3)
    await assertStoredDatabaseRedacted(userDataPath, 'cleanup retry')

    const removed = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/mcp-connections/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 3 }) })
      return { status: response.status, body: await response.json() }
    }, connectionId)
    if (removed.status !== 200 || removed.body.removed !== true || removed.body.credentialCleanup !== 'complete') {
      throw new Error('MCP remove did not acknowledge the disconnected cleanup state.')
    }
    await assertPrivateVault(userDataPath, [provisional])
    await close(run)
    run = undefined
    run = await launch(executable, userDataPath)
    ;({ page, origin } = run)
    await assertPrivateVault(userDataPath, [])
    const finalList = await readMcpList(page, origin, references)
    assert.equal(finalList.connections.some(connection => connection.id === connectionId), false, 'Removal must survive a full relaunch.')
    assertConnection(finalList, provisionalId, 'unverified', 0)
    await assertStoredDatabaseRedacted(userDataPath, 'final')
    await close(run)
    run = undefined
    console.log('[desktop-mcp-smoke] real packaged Electron + OS safeStorage · provision-only IPC · token replacement/relaunch reconciliation · HTTPS-only/no-loopback posture · secret exclusion · durable disconnect despite real vault-write failure · explicit cleanup retry · unrelated provisional preservation · removed/orphan relaunch cleanup')
  } catch (error) {
    throw new Error(`Packaged MCP credential smoke failed: ${safeError(error)}`)
  } finally {
    try {
      await close(run)
    } finally {
      await rm(userDataPath, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await smokePackagedMcpCredentials().catch((error) => {
    console.error(safeError(error))
    process.exitCode = 1
  })
}
