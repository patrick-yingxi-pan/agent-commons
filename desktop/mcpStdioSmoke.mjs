/** Offline packaged stdio MCP acceptance. By default an owned ASAR copy's
 * native confirmation accepts only this exact fixture executable/arguments/
 * cwd/environment. Optional --native-review instead uses the original app and
 * requires actual dialog approval. Neither mode proves public-server,
 * signed-release or Intel acceptance. The repository-authored peer runs without a
 * shell or network and writes only its explicit temporary trace file. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { launchPackagedDesktop, closePackagedDesktop } from './smoke.mjs'
import { packagedExecutable } from './smokePaths.mjs'
import { createMcpFixturePackage } from './mcpLoopbackSmokePackage.mjs'
import { startMcpOAuthMessagesSmokeFixture, MCP_OAUTH_MESSAGES_SMOKE_MODEL,
  MCP_OAUTH_MESSAGES_SMOKE_PROMPT, MCP_OAUTH_MESSAGES_SMOKE_QUERY } from './mcpOAuthMessagesSmokeFixture.mjs'
import { MCP_STDIO_GRANT_FILE } from './mcpStdioGrantVault.mjs'
import { createHash } from 'node:crypto'
import { prepareContributionStdioSmoke, assertContributionStdioInterrupted,
  recoverContributionStdioSmoke, assertRevokedContributionStdioSmoke } from './contributionStdioSmoke.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PEER = join(ROOT, 'desktop', 'mcpStdioSmokePeer.mjs')
const GATE = 'AC_MCP_STDIO_FIXTURE_ALLOW'
const GATE_KEYS = [GATE, 'AC_MCP_STDIO_FIXTURE_EXECUTABLE', 'AC_MCP_STDIO_FIXTURE_CWD',
  'AC_MCP_STDIO_FIXTURE_ARGS', 'AC_MCP_STDIO_FIXTURE_ENV']

export function parseMcpStdioSmokeOptions(argv) {
  if (!Array.isArray(argv) || argv.some(argument => argument !== '--native-review')) {
    throw new Error('Usage: node desktop/mcpStdioSmoke.mjs [--native-review]')
  }
  return Object.freeze({ nativeReview: argv.includes('--native-review') })
}

function asarPathForExecutable(executable) {
  return join(dirname(dirname(executable)), 'Resources', 'app.asar')
}

async function asarSha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function api(page, path, body, key = randomUUID(), method = body === undefined ? 'GET' : 'POST') {
  const result = await page.evaluate(async ({ path, body, key, method }) => {
    const response = await fetch(`/api/v1${path}`, { method,
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { path, body, key, method })
  assert.ok(result.status >= 200 && result.status < 300, `${method} ${path}: HTTP ${result.status}`)
  return result.body
}

export function mcpStdioSmokePatches() {
  return [{ path: 'desktop/main.mjs',
    before: 'const result = await dialog.showMessageBox(mainWindow, {',
    after: `const result = await (async (_owner, _options) => ({ response: process.env.${GATE} === '1' &&
      launch.executable === process.env.AC_MCP_STDIO_FIXTURE_EXECUTABLE &&
      launch.cwd === process.env.AC_MCP_STDIO_FIXTURE_CWD &&
      JSON.stringify(launch.args) === process.env.AC_MCP_STDIO_FIXTURE_ARGS &&
      JSON.stringify(launch.env) === process.env.AC_MCP_STDIO_FIXTURE_ENV ? 1 : 0 }))(mainWindow, {` }]
}

function traceRows(text) { return text.split('\n').filter(Boolean).map(line => JSON.parse(line)) }
async function assertNoRawFixtureData(profile, tracePath, launch) {
  const trace = await readFile(tracePath, 'utf8')
  assert.equal(trace.includes(launch.executable), false, 'launch details do not enter the child protocol trace')
  assert.equal(trace.includes('AC_MCP_STDIO_FIXTURE_ALLOW'), false)
  const grantPath = join(profile, MCP_STDIO_GRANT_FILE)
  const grant = await readFile(grantPath)
  assert.ok(grant.byteLength > 0, 'the native encrypted grant exists in isolated user data')
  assert.equal(grant.includes(Buffer.from(launch.executable)), false, 'the grant file does not contain plaintext launch settings')
  for (const name of ['store.db', 'store.db-wal', 'store.db-shm']) {
    const bytes = await readFile(join(profile, name)).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error })
    assert.equal(bytes.includes(Buffer.from(launch.executable)), false, `launch settings do not enter ${name}`)
  }
}

async function prepareInteractiveCall(page, origin, model, connectionId, label) {
  const provider = await api(page, '/providers', { label: 'Local stdio smoke model', modelFamily: 'claude',
    effortLevels: ['Low'], models: [{ id: MCP_OAUTH_MESSAGES_SMOKE_MODEL, label: 'Local stdio fixture' }],
    config: { baseURL: model.origin, model: MCP_OAUTH_MESSAGES_SMOKE_MODEL } })
  const session = await api(page, '/sessions', { providerId: provider.id, modelId: MCP_OAUTH_MESSAGES_SMOKE_MODEL })
  await page.goto(`${origin}/s/${session.id}`)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^MCP server/ }).click()
  const choice = picker.getByRole('button', { name: new RegExp(label) })
  await expect(choice).toContainText('Approval required for every call')
  await choice.click()
  if (await picker.isVisible()) await picker.getByRole('button', { name: 'Done', exact: true }).click()
  assert.ok((await api(page, `/sessions/${session.id}/contexts`)).some(row => row.id === connectionId))
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill(MCP_OAUTH_MESSAGES_SMOKE_PROMPT)
  await composer.press('Enter')
  const card = page.locator('[data-mcp-tool-status="proposed"]').filter({ hasText: 'records.search' })
  await expect(card.getByRole('button', { name: 'Run tool', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(card).toContainText(`"query": "${MCP_OAUTH_MESSAGES_SMOKE_QUERY}"`)
  return { id: session.id, card }
}

function storedActivities(profile, sessionId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?').get('sessions', sessionId)
    assert.ok(row)
    return JSON.parse(row.json).messages.flatMap(message => message.toolActivities ?? [])
  } finally { database.close() }
}

function storedStdioConnection(profile, connectionId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM kv WHERE key = ?').get('mcpConnections')
    assert.ok(row, 'the private MCP connection singleton is persisted')
    const matches = JSON.parse(row.json).connections.filter(connection => connection.id === connectionId)
    assert.equal(matches.length, 1, 'the exact stdio connection persists once')
    return matches[0]
  } finally { database.close() }
}

function storedActivityAuthority(profile, sessionId, activityId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const rows = database.prepare('SELECT json FROM entities WHERE slice = ?').all('mcpActivityAuthorities')
      .map(row => JSON.parse(row.json)).filter(row => row.sessionId === sessionId && row.activityId === activityId)
    assert.equal(rows.length, 1, 'the private per-call person anchor persists exactly once')
    return rows[0]
  } finally { database.close() }
}

export async function smokePackagedMcpStdio({ executable = packagedExecutable(), nativeReview = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('Packaged stdio acceptance requires macOS')
  if (typeof nativeReview !== 'boolean') throw new Error('Invalid native review mode')
  const sourceAsar = asarPathForExecutable(executable)
  const sourceAsarSha256 = nativeReview ? await asarSha256(sourceAsar) : undefined
  const profile = await mkdtemp(join(tmpdir(), 'ac-native-stdio-smoke-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-stdio-smoke')
  const tracePath = join(profile, 'peer-trace.jsonl')
  const label = `Local stdio fixture ${randomUUID().slice(0, 8)}`
  const launch = Object.freeze({ executable: process.execPath, args: Object.freeze([PEER, tracePath]), cwd: ROOT,
    env: Object.freeze({ AC_MCP_STDIO_FIXTURE_TRACE: tracePath }) })
  const priorEnv = new Map([...GATE_KEYS, 'DATA_FILE', 'DATABASE_PATH'].map(key => [key, process.env[key]]))
  const setFixtureEnv = () => {
    for (const key of GATE_KEYS) delete process.env[key]
    process.env.DATA_FILE = join(profile, 'unused-store.json')
    process.env.DATABASE_PATH = join(profile, 'store.db')
    if (!nativeReview) {
      process.env[GATE] = '1'
      process.env.AC_MCP_STDIO_FIXTURE_EXECUTABLE = launch.executable
      process.env.AC_MCP_STDIO_FIXTURE_CWD = launch.cwd
      process.env.AC_MCP_STDIO_FIXTURE_ARGS = JSON.stringify(launch.args)
      process.env.AC_MCP_STDIO_FIXTURE_ENV = JSON.stringify(launch.env)
    }
  }
  setFixtureEnv()
  let model, copied, run
  let stage = 'startup'
  try {
    await mkdir(evidenceRoot, { recursive: true })
    const evidence = await mkdtemp(join(evidenceRoot, 'run-'))
    model = await startMcpOAuthMessagesSmokeFixture()
    if (!nativeReview) copied = await createMcpFixturePackage(executable, mcpStdioSmokePatches())
    run = await launchPackagedDesktop(copied?.executable ?? executable, profile)
    let { page, origin } = run
    const identity = await api(page, '/auth/signup', { name: 'Native stdio owner',
      email: `native-stdio-${randomUUID()}@example.test`, password: 'isolated-native-stdio-password' })
    await page.reload()
    const list = await api(page, '/mcp-connections')
    assert.equal(list.capabilities.localProcesses, true, 'the packaged macOS desktop admits local-process capability')
    assert.equal(await page.evaluate(() => typeof window.agentCommonsDesktop?.mcpStdio?.start), 'function')

    stage = 'rendered-local-setup-and-native-inspection'
    await page.goto(`${origin}/contexts`)
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
    const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
    await create.getByLabel('Name', { exact: true }).fill(label)
    await create.getByLabel('Transport').selectOption('stdio')
    await create.getByRole('button', { name: 'Save server', exact: true }).click()
    await page.getByRole('main').getByRole('button', { name: label, exact: true }).click()
    const connectionId = new URL(page.url()).pathname.split('/').at(-1)
    assert.ok(connectionId)
    const detailPath = new URL(page.url()).pathname
    const connection = await api(page, `/mcp-connections/${connectionId}`)
    assert.equal(connection.transport, 'stdio')
    await page.getByRole('button', { name: 'Configure local server', exact: true }).click()
    const setup = page.getByRole('dialog', { name: `Configure ${label}`, exact: true })
    await setup.getByLabel('Executable path', { exact: true }).fill(launch.executable)
    await setup.getByLabel('Working directory', { exact: true }).fill(launch.cwd)
    await setup.getByRole('textbox', { name: 'Arguments (JSON array)', exact: true }).fill(JSON.stringify(launch.args))
    await setup.getByRole('textbox', { name: 'Environment (JSON object)', exact: true }).fill(JSON.stringify(launch.env))
    if (nativeReview) {
      console.log(`[desktop-stdio-smoke] native-review-ready connection=${connectionId} label=${JSON.stringify(label)}; inspect and approve the exact local fixture in the native review dialog`)
    }
    await setup.getByRole('button', { name: 'Review & inspect', exact: true }).click({ timeout: 30_000 })
    await expect(setup.locator('[data-mcp-stdio-phase="connected"]')).toBeVisible({ timeout: 30_000 })
    const inspected = await api(page, `/mcp-connections/${connectionId}`)
    assert.equal(inspected.status, 'connected')
    assert.deepEqual(inspected.tools.map(tool => tool.name), ['records.search'])
    const ownedConnection = storedStdioConnection(profile, connectionId)
    assert.equal(ownedConnection.tenantId, identity.tenant.id)
    assert.equal(ownedConnection.ownerUserId, identity.user.id)
    assert.equal(ownedConnection.transport, 'stdio')
    assert.match(ownedConnection.grantReference, /^MCP_STDIO_[A-F0-9]{32}$/)
    await setup.getByRole('button', { name: 'Close', exact: true }).click()
    const afterInspection = traceRows(await readFile(tracePath, 'utf8'))
    assert.equal(afterInspection.filter(row => row.kind === 'process-start').length, 1)
    assert.deepEqual(afterInspection.filter(row => row.kind === 'request').map(row => row.method), ['server/discover', 'tools/list'])
    await page.screenshot({ path: join(evidence, 'inspected-catalog.png'), fullPage: true })

    stage = 'separate-rendered-tool-approval-and-one-call'
    const proposed = await prepareInteractiveCall(page, origin, model, connectionId, label)
    const beforeRun = traceRows(await readFile(tracePath, 'utf8'))
    assert.equal(beforeRun.filter(row => row.method === 'tools/call').length, 0, 'proposal alone does not execute the child tool')
    await proposed.card.getByRole('button', { name: 'Run tool', exact: true }).click()
    const result = page.locator('[data-mcp-tool-status="done"]').filter({ hasText: 'records.search' })
    await expect(result).toContainText(`Local fixture result for: ${MCP_OAUTH_MESSAGES_SMOKE_QUERY}`, { timeout: 30_000 })
    const calls = traceRows(await readFile(tracePath, 'utf8')).filter(row => row.kind === 'request' && row.method === 'tools/call')
    assert.equal(calls.length, 1, 'one rendered, explicit approval causes exactly one stdio call')
    assert.deepEqual(calls[0].params.arguments, { query: MCP_OAUTH_MESSAGES_SMOKE_QUERY })
    const activities = storedActivities(profile, proposed.id)
    assert.equal(activities.filter(activity => activity.status === 'done').length, 1)
    const completedActivity = activities.find(activity => activity.status === 'done')
    assert.ok(completedActivity)
    assert.equal(completedActivity.mcpResult.content[0].text, `Local fixture result for: ${MCP_OAUTH_MESSAGES_SMOKE_QUERY}`)
    const activityAuthority = storedActivityAuthority(profile, proposed.id, completedActivity.id)
    assert.deepEqual(activityAuthority, { sessionId: proposed.id, activityId: completedActivity.id,
      connectionId, tenantId: identity.tenant.id, ownerUserId: identity.user.id })
    assert.equal(model.requests.length, 2, 'only the proposal and truthful post-result prose reach the local model fixture')
    await assertNoRawFixtureData(profile, tracePath, launch)
    await page.screenshot({ path: join(evidence, 'approved-result.png'), fullPage: true })

    stage = 'local-contribution-resolution-and-pending-interruption'
    const contribution = await prepareContributionStdioSmoke({ page, origin, profile, connectionId, identity, tracePath, evidence })

    stage = 'durable-owner-relaunch-without-auto-launch'
    await closePackagedDesktop(run); run = undefined
    assertContributionStdioInterrupted(profile, contribution)
    run = await launchPackagedDesktop(copied?.executable ?? executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, identity.user.id)
    assert.equal((await api(page, `/mcp-connections/${connectionId}`)).status, 'connected')
    assert.deepEqual(storedStdioConnection(profile, connectionId), ownedConnection,
      'the private connection owner and opaque native grant reference survive full relaunch')
    assert.deepEqual(storedActivityAuthority(profile, proposed.id, completedActivity.id), activityAuthority,
      'the exact completed tool receipt remains bound to the same private owner after relaunch')
    await page.goto(`${origin}/s/${proposed.id}`)
    await expect(page.locator('[data-mcp-tool-status="done"]')).toContainText(`Local fixture result for: ${MCP_OAUTH_MESSAGES_SMOKE_QUERY}`)
    assert.equal(traceRows(await readFile(tracePath, 'utf8')).filter(row => row.kind === 'process-start').length, 4,
      'startup and receipt rendering never start another local child')
    assert.equal(model.requests.length, 2, 'a completed relaunch does not rerun the model')
    await assertNoRawFixtureData(profile, tracePath, launch)
    await page.screenshot({ path: join(evidence, 'approved-result-relaunched.png'), fullPage: true })
    await recoverContributionStdioSmoke({ page, origin, profile, connectionId, identity, tracePath, evidence }, contribution)

    stage = 'disconnect-and-remove-revokes-local-connection'
    await page.goto(`${origin}${detailPath}`)
    const grantBeforeDisconnect = await readFile(join(profile, MCP_STDIO_GRANT_FILE))
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect.poll(async () => (await api(page, `/mcp-connections/${connectionId}`)).status).toBe('disconnected')
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeEnabled()
    const grantPath = join(profile, MCP_STDIO_GRANT_FILE)
    const disconnectedGrant = await readFile(grantPath)
    assert.equal(disconnectedGrant.equals(grantBeforeDisconnect), false,
      'disconnect immediately retires the native grant before the connection can be removed')
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('dialog', { name: new RegExp(`Remove ${label}\\?`) }).getByRole('button', { name: 'Remove server', exact: true }).click()
    await expect.poll(async () => {
      const response = await page.evaluate(async id => (await fetch(`/api/v1/mcp-connections/${id}`)).status, connectionId)
      return response
    }).toBe(404)
    assert.equal((await readFile(grantPath)).equals(disconnectedGrant), true,
      'removal preserves the already-retired native grant state and does not recreate a launch authority')
    assert.equal(traceRows(await readFile(tracePath, 'utf8')).filter(row => row.kind === 'process-start').length, 4,
      'disconnect/removal do not start the configured program')
    await assertRevokedContributionStdioSmoke({ page, origin, profile, connectionId, identity, tracePath, evidence }, contribution)
    await assertNoRawFixtureData(profile, tracePath, launch)
    console.log(`[desktop-stdio-smoke] packaged local process · ${nativeReview ? 'actual native review' : 'exact disposable fixture-only native approval'} · modern discovery/catalog inspection · separate per-call approval · interactive result and Contribution work resolution · pending recovery/replay without dispatch · durable owner relaunch without auto-launch · disconnect/removal`)
    console.log(`[desktop-stdio-smoke] evidence ${evidence}`)
    if (nativeReview && await asarSha256(sourceAsar) !== sourceAsarSha256) {
      throw new Error('The original packaged ASAR changed during native review acceptance')
    }
  } catch (error) {
    throw new Error(`Packaged stdio acceptance failed during ${stage}: ${error instanceof Error ? error.message : 'unavailable'}`)
  } finally {
    await closePackagedDesktop(run).catch(() => {})
    await model?.close?.().catch(() => {})
    await copied?.close?.().catch(() => {})
    await rm(profile, { recursive: true, force: true }).catch(() => {})
    for (const [key, value] of priorEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let options
  try { options = parseMcpStdioSmokeOptions(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 2 }
  if (options) smokePackagedMcpStdio(options).catch(error => { console.error(error.message); process.exitCode = 1 })
}
