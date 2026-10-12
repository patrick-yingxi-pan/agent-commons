/** Separate local Routine acceptance. Only native dialog answers and relaunch
 * spawning are fixtures in a disposable ASAR; production source stays sealed. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { createMcpFixturePackage } from './mcpLoopbackSmokePackage.mjs'
import { mcpStdioSmokePatches } from './mcpStdioSmoke.mjs'
import { routineMcpLocalRestorePatches } from './routineMcpLocalRestoreFixture.mjs'
import { ROUTINE_MESSAGES_SMOKE_MODEL, startRoutineMessagesSmokeFixture } from './routineMessagesSmokeFixture.mjs'
import { MCP_STDIO_GRANT_FILE } from './mcpStdioGrantVault.mjs'
import { AUTH_ROOT_FILE } from './authRoot.mjs'
import { packagedExecutable } from './smokePaths.mjs'
import { launchPackagedDesktop, closePackagedDesktop } from './smoke.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const WAIT = 45_000
const RESULT = 'Local fixture result for: routine-native-smoke'
const ENV_KEYS = ['DATA_FILE', 'DATABASE_PATH', 'AC_MCP_STDIO_FIXTURE_ALLOW',
  'AC_MCP_STDIO_FIXTURE_EXECUTABLE', 'AC_MCP_STDIO_FIXTURE_CWD', 'AC_MCP_STDIO_FIXTURE_ARGS', 'AC_MCP_STDIO_FIXTURE_ENV']

async function api(page, path, body, { method = body === undefined ? 'GET' : 'POST', status = 200 } = {}) {
  const result = await page.evaluate(async ({ path, body, method }) => {
    const response = await fetch(`/api/v1${path}`, { method,
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { path, body, method })
  assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result.body)}`)
  return result.body
}

function stored(profile, key) {
  const db = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = db.prepare('SELECT json FROM kv WHERE key = ?').get(key)
    assert.ok(row, `the actual SQLite ${key} slice exists`)
    return JSON.parse(row.json)
  } finally { db.close() }
}

async function rows(path) {
  const text = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function configureLocal(page, origin, launch, profile, tracePath) {
  const label = 'Native Routine local program'
  await page.goto(`${origin}/contexts`)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
  const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
  await create.getByLabel('Name', { exact: true }).fill(label)
  await create.getByLabel('Transport').selectOption('stdio')
  await create.getByRole('button', { name: 'Save server', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: label, exact: true }).click()
  const id = new URL(page.url()).pathname.split('/').at(-1)
  const baseline = stored(profile, 'mcpConnections')
  for (const phase of ['cancelled', 'connected']) {
    await page.getByRole('button', { name: 'Configure local server', exact: true }).click()
    const setup = page.getByRole('dialog', { name: `Configure ${label}`, exact: true })
    await setup.getByLabel('Executable path', { exact: true }).fill(launch.executable)
    await setup.getByLabel('Working directory', { exact: true }).fill(launch.cwd)
    await setup.getByRole('textbox', { name: 'Arguments (JSON array)', exact: true }).fill(JSON.stringify(launch.args))
    await setup.getByRole('textbox', { name: 'Environment (JSON object)', exact: true }).fill(JSON.stringify(launch.env))
    await setup.getByRole('button', { name: 'Review & inspect', exact: true }).click()
    await expect(setup.locator(`[data-mcp-stdio-phase="${phase}"]`)).toBeVisible({ timeout: WAIT })
    if (phase === 'cancelled') {
      assert.deepEqual(stored(profile, 'mcpConnections'), baseline)
      assert.deepEqual(await rows(tracePath), [], 'native Cancel never launches a child')
      await assert.rejects(readFile(join(profile, MCP_STDIO_GRANT_FILE)), { code: 'ENOENT' })
    }
    await setup.getByRole('button', { name: 'Close', exact: true }).click()
  }
  const connection = await api(page, `/mcp-connections/${id}`)
  assert.equal(connection.transport, 'stdio')
  assert.equal(connection.status, 'connected')
  assert.deepEqual(connection.tools.map(tool => tool.name), ['records.search'])
  assert.deepEqual((await rows(tracePath)).filter(row => row.kind === 'request').map(row => row.method), ['server/discover', 'tools/list'])
  return connection
}

async function createRoutine(page, model) {
  const provider = await api(page, '/providers', { label: 'Local Routine model', modelFamily: 'claude', effortLevels: ['Low'],
    models: [{ id: ROUTINE_MESSAGES_SMOKE_MODEL, label: 'Local model fixture' }],
    config: { baseURL: model.origin, model: ROUTINE_MESSAGES_SMOKE_MODEL } })
  const prompt = await api(page, '/system-prompts', { label: 'Local Routine prompt', targetFamily: 'claude',
    body: 'Use the exact reviewed external MCP tool once, then describe its result.' })
  const agent = await api(page, '/agents', { label: 'Local Routine agent', providerId: provider.id,
    systemPromptId: prompt.id, tools: [], instructions: 'Use only the reviewed external tool.' })
  const templates = await api(page, '/schedule-templates')
  const template = templates.find(row => row.name === 'Blank recipe') ?? templates[0]
  return api(page, '/schedules', { seed: { ...template.seed, name: 'Local Routine packaged acceptance', enabled: true,
    prompt: 'Use records.search with query routine-native-smoke.', agentId: agent.id, providerId: provider.id,
    modelId: ROUTINE_MESSAGES_SMOKE_MODEL, model: 'Local Routine model', effort: 'Low', steps: [], runs: [],
    delivery: { tool: { id: 'session', label: 'New session', tone: 'workspace' }, target: 'New session' } } })
}

async function approve(page, origin, id, { checkBack = false } = {}) {
  const task = (await api(page, '/schedules')).find(row => row.id === id)
  if (!task.enabled) await api(page, `/schedules/${id}`, { enabled: true, expectedRevision: task.revision }, { method: 'PATCH' })
  await page.goto(`${origin}/scheduled/${id}/external-mcp`)
  const panel = page.getByRole('region', { name: 'External MCP', exact: true })
  const choice = panel.locator('article').filter({ hasText: 'Native Routine local program' })
  await expect(choice).toContainText('Local program')
  await choice.getByRole('checkbox').check()
  await panel.getByLabel('Fixed values for records.search').fill('{"query":"routine-native-smoke"}')
  await panel.getByLabel('Maximum calls per run').fill('1')
  await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
  const review = panel.locator('[aria-label="Approval review"]')
  const acknowledgment = review.getByRole('checkbox', { name: /I understand and explicitly approve unattended local-program launch/ })
  const save = review.getByRole('button', { name: 'Approve these tools', exact: true })
  await expect(acknowledgment).toHaveAttribute('aria-checked', 'false')
  await expect(save).toBeDisabled()
  if (checkBack) {
    await acknowledgment.check()
    await review.getByRole('button', { name: 'Back to choices', exact: true }).click()
    await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
    await expect(acknowledgment).toHaveAttribute('aria-checked', 'false')
    await expect(save).toBeDisabled()
  }
  await acknowledgment.check()
  await save.click()
  await expect(panel.getByText('Approval active', { exact: true })).toBeVisible({ timeout: WAIT })
}

async function start(page, origin, id) {
  await page.goto(`${origin}/scheduled/${id}`)
  await page.getByRole('button', { name: 'Run now', exact: true }).click()
}

async function backup(run, profile) {
  await run.page.goto(`${run.origin}/customize`)
  const directory = join(profile, 'snapshots')
  const before = new Set(await readdir(directory))
  await run.page.getByRole('button', { name: 'Back up now', exact: true }).click()
  await expect(run.page.getByRole('status').filter({ hasText: /^Saved backup-/ })).toBeVisible()
  const added = (await readdir(directory)).filter(name => !before.has(name))
  assert.equal(added.length, 1)
  return { path: join(directory, added[0]), state: JSON.parse(await readFile(join(directory, added[0]), 'utf8')) }
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode }
  return new Promise((resolve, reject) => {
    const finish = (error, value) => { clearTimeout(timer); child.off('error', failed); child.off('close', closed); error ? reject(error) : resolve(value) }
    const failed = error => finish(error)
    const closed = (code, signal) => finish(null, { code, signal })
    const timer = setTimeout(() => finish(new Error('Native restore did not exit within its bound')), WAIT)
    child.once('error', failed); child.once('close', closed)
  })
}

export async function smokePackagedRoutineMcpLocal({ executable = packagedExecutable(), extraPatches = [] } = {}) {
  if (process.platform !== 'darwin') throw new Error('Local Routine packaged acceptance requires macOS')
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'ac-routine-local-')))
  const evidenceRoot = join(ROOT, '.data', 'desktop-routine-local-smoke')
  await mkdir(evidenceRoot, { recursive: true })
  const evidence = await mkdtemp(join(evidenceRoot, 'run-'))
  const tracePath = join(profile, 'peer.jsonl'), controlPath = join(profile, 'peer-control.json')
  const restoreControl = join(profile, 'restore-control.json'), restoreTrace = join(profile, 'restore.jsonl')
  const launch = { executable: process.execPath, args: [join(ROOT, 'desktop', 'routineMcpLocalSmokePeer.mjs'), tracePath, controlPath], cwd: ROOT, env: {} }
  const priorEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]))
  const mode = value => writeFile(controlPath, JSON.stringify({ mode: value }), { mode: 0o600 })
  const counts = async () => { const trace = await rows(tracePath); return {
    starts: trace.filter(row => row.kind === 'process-start').length,
    calls: trace.filter(row => row.method === 'tools/call').length,
  } }
  let fixture, model, run, stage = 'startup'
  try {
    Object.assign(process.env, { DATA_FILE: join(profile, 'unused.json'), DATABASE_PATH: join(profile, 'store.db'),
      AC_MCP_STDIO_FIXTURE_ALLOW: '1', AC_MCP_STDIO_FIXTURE_EXECUTABLE: launch.executable,
      AC_MCP_STDIO_FIXTURE_CWD: launch.cwd, AC_MCP_STDIO_FIXTURE_ARGS: JSON.stringify(launch.args), AC_MCP_STDIO_FIXTURE_ENV: '{}' })
    await mode('normal')
    fixture = await createMcpFixturePackage(executable, [...mcpStdioSmokePatches(),
      ...routineMcpLocalRestorePatches({ controlPath: restoreControl, tracePath: restoreTrace }), ...extraPatches])
    model = await startRoutineMessagesSmokeFixture()
    run = await launchPackagedDesktop(fixture.executable, profile)
    const identity = await api(run.page, '/auth/signup', { name: 'Local Routine owner',
      email: `routine-local-${randomUUID()}@example.test`, password: 'isolated-local-routine-password' })
    await run.page.reload()
    stage = 'native-setup-cancel-then-allow'
    const connection = await configureLocal(run.page, run.origin, launch, profile, tracePath)
    const owner = stored(profile, 'mcpConnections').connections.find(row => row.id === connection.id)
    assert.equal(owner.ownerUserId, identity.user.id)
    assert.equal(owner.tenantId, identity.tenant.id)
    const custody = await readFile(join(profile, MCP_STDIO_GRANT_FILE))
    assert.equal(custody.includes(Buffer.from(launch.executable)), false, 'OS-encrypted custody never stores launch details as plaintext')
    const authRoot = await readFile(join(profile, AUTH_ROOT_FILE))
    const task = await createRoutine(run.page, model)
    const review = () => api(run.page, `/schedules/${task.id}/mcp-permission`)
    const noReplay = async expected => assert.deepEqual(await counts(), expected, 'recovery/revocation never launches or replays a child')
    const relaunch = async () => {
      const oldOrigin = run.origin
      await closePackagedDesktop(run); run = undefined
      await expect.poll(() => fetch(`${oldOrigin}/healthz`).then(() => true).catch(() => false), { timeout: 5_000 }).toBe(false)
      run = await launchPackagedDesktop(fixture.executable, profile)
      assert.equal((await api(run.page, '/me')).user.id, identity.user.id, 'full native relaunch preserves the signed-in person')
      assert.deepEqual(await readFile(join(profile, AUTH_ROOT_FILE)), authRoot)
      assert.deepEqual(await readFile(join(profile, MCP_STDIO_GRANT_FILE)), custody)
    }
    stage = 'separate-local-consent-and-real-run'
    await approve(run.page, run.origin, task.id, { checkBack: true })
    assert.deepEqual(await counts(), { starts: 1, calls: 0 }, 'setup and Routine approval do not execute a tool')
    const approved = await review()
    assert.equal(approved.policy.approval.localPrograms, true)
    await start(run.page, run.origin, task.id)
    await expect.poll(async () => (await review()).runs.some(row => row.status === 'ok'), { timeout: WAIT }).toBe(true)
    const completed = (await review()).runs.find(row => row.status === 'ok')
    assert.equal(completed.calls.length, 1, 'the completed run must contain the exact reviewed local call, not a tool-less model answer')
    assert.equal(completed.calls[0].status, 'done')
    assert.equal(completed.calls[0].transport, 'stdio')
    assert.equal(completed.calls[0].result.content[0].text, RESULT)
    const exactLedger = stored(profile, 'routineMcp').runs.find(row => row.runId === completed.runId)
    assert.deepEqual(exactLedger.permission.localAuthority.connectionIds, [connection.id])
    assert.equal(exactLedger.permission.localAuthority.ownerUserId, identity.user.id)
    const shared = (await api(run.page, '/schedules')).find(row => row.id === task.id)
    assert.equal(shared.runs.find(row => row.id === completed.runId).detail, 'Routine MCP local acceptance completed.')
    assert.equal(JSON.stringify(shared).includes(connection.id), false, 'ordinary output excludes person-private connection authority')
    const calls = (await rows(tracePath)).filter(row => row.method === 'tools/call')
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].params.arguments, { query: 'routine-native-smoke' })
    await run.page.goto(`${run.origin}/scheduled/${task.id}/external-mcp`)
    await expect(run.page.getByText(RESULT, { exact: false })).toBeVisible()
    await run.page.screenshot({ path: join(evidence, 'local-completed.png'), fullPage: true })
    const completedCounts = await counts()
    await relaunch()
    assert.deepEqual(stored(profile, 'routineMcp').runs.find(row => row.runId === completed.runId), exactLedger)
    await noReplay(completedCounts)
    await run.page.goto(`${run.origin}/scheduled/${task.id}/external-mcp`)
    await run.page.getByRole('button', { name: 'Revoke approval', exact: true }).click()
    await expect.poll(async () => (await review()).policy.approval).toBe(null)
    await noReplay(completedCounts)

    stage = 'startup-failure-without-tool-submission'
    await mode('hold-startup')
    await approve(run.page, run.origin, task.id)
    await start(run.page, run.origin, task.id)
    await expect.poll(async () => (await review()).runs.some(row => row.calls.some(call => call.status === 'failed')), { timeout: WAIT }).toBe(true)
    const startup = (await review()).runs.find(row => row.calls.some(call => call.status === 'failed'))
    assert.equal(startup.calls[0].result, undefined)
    assert.equal(startup.calls[0].transport, 'stdio')
    assert.equal((await review()).policy.approval, null)
    assert.equal((await api(run.page, '/schedules')).find(row => row.id === task.id).enabled, false)
    assert.equal((await counts()).calls, completedCounts.calls, 'startup failure sent no tool call')
    await run.page.goto(`${run.origin}/scheduled/${task.id}/external-mcp`)
    await expect(run.page.getByText(/local program may have had effects during startup/)).toBeVisible()
    await run.page.screenshot({ path: join(evidence, 'startup-failed.png'), fullPage: true })
    const failedCounts = await counts()
    await relaunch(); await noReplay(failedCounts)

    stage = 'pending-call-backup-and-relaunch-uncertainty'
    await mode('hold-call')
    await approve(run.page, run.origin, task.id)
    await start(run.page, run.origin, task.id)
    await expect.poll(async () => (await counts()).calls, { timeout: WAIT }).toBe(failedCounts.calls + 1)
    const pending = (await review()).runs.find(row => row.calls.some(call => call.status === 'pending'))
    assert.ok(pending, 'the real pending call is durable before interrupting the process')
    const saved = await backup(run, profile)
    assert.equal(saved.state.routineMcp.runs.find(row => row.runId === pending.runId).calls[0].status, 'pending')
    assert.equal(JSON.stringify(saved.state).includes(launch.executable), false)
    const pendingCounts = await counts()
    await relaunch(); await noReplay(pendingCounts)
    const interrupted = (await review()).runs.find(row => row.runId === pending.runId)
    assert.equal(interrupted.phase, 'interrupted')
    assert.equal(interrupted.calls[0].status, 'uncertain')
    assert.equal((await review()).policy.approval, null)
    await run.page.goto(`${run.origin}/scheduled/${task.id}/external-mcp`)
    await expect(run.page.getByText(/Local program · records.search · Outcome uncertain/)).toBeVisible()
    await run.page.screenshot({ path: join(evidence, 'uncertain-relaunch.png'), fullPage: true })

    stage = 'managed-backup-native-restore'
    // Two Routines share the same frozen Agent. Its one-call capacity keeps
    // the second run genuinely queued, with no child launch or call receipt.
    const queuedTask = await api(run.page, '/schedules', { seed: { ...task,
      name: 'Queued local Routine restore', enabled: true, runs: [] } })
    await approve(run.page, run.origin, task.id)
    await approve(run.page, run.origin, queuedTask.id)
    await start(run.page, run.origin, task.id)
    await expect.poll(async () => (await counts()).calls, { timeout: WAIT }).toBe(pendingCounts.calls + 1)
    const restorePending = (await review()).runs.find(row => row.calls.some(call => call.status === 'pending'))
    assert.ok(restorePending)
    await start(run.page, run.origin, queuedTask.id)
    const queuedReview = await api(run.page, `/schedules/${queuedTask.id}/mcp-permission`)
    assert.equal(queuedReview.runs.length, 1)
    const queuedRun = queuedReview.runs[0]
    assert.equal(queuedRun.status, 'running')
    assert.deepEqual(queuedRun.calls, [], 'the second Routine has no reserved call before restore')
    const queuedPublic = (await api(run.page, '/schedules')).find(row => row.id === queuedTask.id).runs[0]
    assert.equal(queuedPublic.attempts, 0, 'shared Agent capacity holds the second run before model admission')
    const restoreSaved = await backup(run, profile)
    assert.equal(restoreSaved.state.routineMcp.runs.find(row => row.runId === restorePending.runId).calls[0].status, 'pending')
    assert.deepEqual(restoreSaved.state.routineMcp.runs.find(row => row.runId === queuedRun.runId).calls, [])
    const restoreCounts = await counts()
    const { artifact: marker } = await api(run.page, '/artifacts', { name: 'Post-backup restoration marker', kind: 'doc', body: 'Only the pre-restore safety copy should retain this.' }, { status: 201 })
    const beforeRestore = new Set(await readdir(join(profile, 'snapshots')))
    await writeFile(restoreControl, JSON.stringify({ selectedPath: restoreSaved.path }), { mode: 0o600 })
    await run.page.goto(`${run.origin}/customize`)
    const exiting = waitForExit(run.child)
    // Observe rejection immediately even if clicking the renderer fails first.
    void exiting.catch(() => {})
    await run.page.getByRole('button', { name: 'Restore backup…', exact: true }).click()
    assert.deepEqual(await exiting, { code: 0, signal: null }, 'real native restore exits successfully')
    await run.browser.close().catch(() => {})
    run = undefined
    const ceremony = await rows(restoreTrace)
    assert.deepEqual(ceremony.map(row => row.event), ['picker', 'confirmation', 'relaunch', 'exit'])
    assert.equal(ceremony[1].options.defaultId, 0)
    const safetyNames = (await readdir(join(profile, 'snapshots'))).filter(name => !beforeRestore.has(name))
    assert.equal(safetyNames.length, 1, 'native restore makes exactly one fresh safety copy')
    const safety = JSON.parse(await readFile(join(profile, 'snapshots', safetyNames[0]), 'utf8'))
    assert.ok(safety.graph.extraArtifacts.some(row => row.id === marker.id), 'safety backup preserves post-backup work')
    run = await launchPackagedDesktop(fixture.executable, profile)
    assert.equal((await api(run.page, '/me')).user.id, identity.user.id)
    assert.equal((await api(run.page, '/artifacts')).some(row => row.id === marker.id), false, 'actual restore replaced SQLite with the chosen earlier state')
    assert.deepEqual(await readFile(join(profile, AUTH_ROOT_FILE)), authRoot)
    assert.deepEqual(await readFile(join(profile, MCP_STDIO_GRANT_FILE)), custody)
    const restored = await review()
    assert.equal(restored.policy.approval, null, 'explicit restore withdraws local-program approval')
    assert.equal(restored.runs.find(row => row.runId === restorePending.runId).calls[0].status, 'uncertain')
    assert.deepEqual(stored(profile, 'routineMcp').runs.find(row => row.runId === completed.runId), exactLedger)
    const restoredTask = (await api(run.page, '/schedules')).find(row => row.id === task.id)
    assert.equal(restoredTask.enabled, false)
    assert.match(restoredTask.runs.find(row => row.id === restorePending.runId).detail, /Stopped after restoring a backup/)
    const restoredQueue = await api(run.page, `/schedules/${queuedTask.id}/mcp-permission`)
    assert.equal(restoredQueue.policy.approval, null)
    assert.equal(restoredQueue.runs[0].phase, 'interrupted', 'restored queued work must be interrupted before admission')
    assert.equal(restoredQueue.runs[0].status, 'failed')
    assert.deepEqual(restoredQueue.runs[0].calls, [], 'restored queued work is terminal even without a receipt')
    const restoredQueuedTask = (await api(run.page, '/schedules')).find(row => row.id === queuedTask.id)
    assert.equal(restoredQueuedTask.enabled, false)
    assert.equal(restoredQueuedTask.runs[0].attempts, 0)
    await noReplay(restoreCounts)
    await run.page.goto(`${run.origin}/scheduled/${task.id}/external-mcp`)
    await expect(run.page.getByText(/Local program · records.search · Outcome uncertain/)).toHaveCount(2)
    await run.page.screenshot({ path: join(evidence, 'explicit-restore.png'), fullPage: true })
    await writeFile(join(evidence, 'receipt.json'), JSON.stringify({
      sourceAsarSha256: fixture.sourceAsarSha256, fixtureAsarSha256: fixture.fixtureAsarSha256,
      platform: process.platform, architecture: process.arch, calls: await counts(),
      checks: ['rendered-local-consent', 'real-child-result', 'OS-custody', 'startup-failure',
        'signed-in-relaunch-no-replay', 'pending-and-zero-receipt-queued-native-restore', 'pre-restore-safety-copy'],
    }, null, 2))
    console.log(`[desktop-routine-local-smoke] real authored child · separate rendered consent · OS custody · private SQLite result · startup failure · relaunch uncertainty without replay · native managed restore + safety copy · evidence ${evidence}`)
  } catch (error) {
    await run?.page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(join(evidence, 'restore-trace.json'), JSON.stringify(await rows(restoreTrace), null, 2)).catch(() => {})
    throw new Error(`Local Routine acceptance failed during ${stage}: ${error.message} (evidence ${evidence})`, { cause: error })
  } finally {
    try { await closePackagedDesktop(run); await model?.close(); await fixture?.close() }
    finally {
      for (const [key, value] of priorEnv) value === undefined ? delete process.env[key] : process.env[key] = value
      await rm(profile, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedRoutineMcpLocal()
