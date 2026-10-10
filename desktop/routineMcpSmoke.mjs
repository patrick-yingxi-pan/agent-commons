/** Packaged owner-reviewed Routine MCP acceptance. Only the disposable ASAR
 * copy admits loopback; packaged UI, scheduler, model seam, MCP transport,
 * policy/receipt persistence and process restart recovery remain real. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { createMcpLoopbackSmokePackage } from './mcpLoopbackSmokePackage.mjs'
import { startRoutineMcpSmokePeer } from './routineMcpSmokeFixture.mjs'
import { ROUTINE_MESSAGES_SMOKE_MODEL, startRoutineMessagesSmokeFixture } from './routineMessagesSmokeFixture.mjs'
import { packagedExecutable } from './smokePaths.mjs'
import { launchPackagedDesktop, closePackagedDesktop } from './smoke.mjs'

const PASSWORD = 'isolated-routine-native-password'
const WAIT = 45_000
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

async function api(page, path, body, { status = 200, key = randomUUID() } = {}) {
  const result = await page.evaluate(async ({ path, body, key }) => {
    const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { path, body, key })
  assert.equal(result.status, status, `Routine MCP ${path}: expected HTTP ${status}`)
  return result.body
}

function persistedRoutineMcp(profile) {
  const db = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = db.prepare('SELECT json FROM kv WHERE key = ?').get('routineMcp')
    assert.ok(row, 'the actual SQLite private routineMcp slice exists')
    return JSON.parse(row.json)
  } finally { db.close() }
}

async function configure(page, modelFixture, peer) {
  const identity = await api(page, '/auth/signup', {
    name: 'Native Routine MCP Owner', email: `native-routine-${randomUUID()}@example.test`, password: PASSWORD,
  })
  await page.reload()
  const provider = await api(page, '/providers', { label: 'Routine local model', modelFamily: 'claude',
    effortLevels: ['Low'], models: [{ id: ROUTINE_MESSAGES_SMOKE_MODEL, label: 'Routine smoke fixture' }],
    config: { baseURL: modelFixture.origin, model: ROUTINE_MESSAGES_SMOKE_MODEL } })
  const prompt = await api(page, '/system-prompts', { label: 'Routine smoke prompt',
    body: 'Use the exact reviewed external MCP tool once, then describe its result.', targetFamily: 'claude' })
  const agent = await api(page, '/agents', { label: 'Routine smoke agent', providerId: provider.id,
    systemPromptId: prompt.id, tools: [], instructions: 'Use only the reviewed external tool.' })
  const created = await api(page, '/mcp-connections', { creationId: randomUUID(), label: 'Native Routine peer', endpoint: peer.url, authentication: 'none' })
  const connection = created.connection
  await api(page, `/mcp-connections/${connection.id}/inspect`, { operationId: randomUUID(), expectedRevision: connection.revision })
  const templates = await api(page, '/schedule-templates')
  const template = templates.find(row => row.name === 'Blank recipe') ?? templates[0]
  const task = await api(page, '/schedules', { seed: { ...template.seed, name: 'Native Routine MCP acceptance', enabled: true,
    prompt: 'Use inspect_records with query routine-native-smoke.', agentId: agent.id, providerId: provider.id,
    modelId: ROUTINE_MESSAGES_SMOKE_MODEL, model: 'Routine local model', effort: 'Low', steps: [],
    delivery: { tool: { id: 'session', label: 'New session', tone: 'workspace' }, target: 'New session' }, runs: [] } })
  return { identity, task, connection }
}

export async function smokePackagedRoutineMcp({ executable = packagedExecutable(), launch = launchPackagedDesktop, close = closePackagedDesktop } = {}) {
  if (process.platform !== 'darwin') {
    console.log('[desktop-routine-mcp-smoke] not run: loopback package acceptance requires macOS')
    return
  }
  const profile = await mkdtemp(join(tmpdir(), 'agent-commons-routine-mcp-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-routine-mcp-smoke')
  await mkdir(evidenceRoot, { recursive: true })
  const evidenceDirectory = await mkdtemp(join(evidenceRoot, 'run-'))
  let fixturePackage, peer, model, run
  let stage = 'startup'
  try {
    fixturePackage = await createMcpLoopbackSmokePackage(executable)
    peer = await startRoutineMcpSmokePeer()
    model = await startRoutineMessagesSmokeFixture()
    run = await launch(fixturePackage.executable, profile)
    let { page, origin } = run
    const { identity, task, connection } = await configure(page, model, peer)
    stage = 'rendered-owner-approval'
    await page.goto(`${origin}/scheduled/${task.id}/external-mcp`)
    const panel = () => page.getByRole('region', { name: 'External MCP' })
    await expect(panel().getByText('inspect_records', { exact: true })).toBeVisible({ timeout: 25_000 })
    const header = page.locator('header').filter({ has: page.locator('[data-routine-delivery-icon]') })
    await expect(header.getByText('New workflow', { exact: true })).toBeVisible()
    await expect(header.getByText('Active', { exact: true })).toBeVisible()
    await panel().getByRole('checkbox').check()
    await panel().getByLabel('Fixed values for inspect_records').fill('{"query":"routine-native-smoke"}')
    await panel().getByLabel('Maximum calls per run').fill('2')
    await panel().getByRole('button', { name: 'Review approval', exact: true }).click()
    const reviewStep = panel().locator('[aria-label="Approval review"]')
    await expect(reviewStep).toContainText('Native Routine peer')
    await reviewStep.getByRole('button', { name: 'Approve these tools', exact: true }).click()
    await expect(panel().getByText('Approval active', { exact: true })).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: join(evidenceDirectory, 'owner-approved.png'), fullPage: true })

    stage = 'real-runner-model-and-MCP'
    await page.goto(`${origin}/scheduled/${task.id}`)
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect.poll(async () => (await api(page, `/schedules/${task.id}/mcp-permission`)).runs.some(row => row.status === 'ok' && row.calls.some(call => call.status === 'done')),
      { timeout: WAIT }).toBe(true)
    const current = await api(page, `/schedules/${task.id}/mcp-permission`)
    const ledger = current.runs.find(row => row.status === 'ok' && row.calls.some(call => call.status === 'done'))
    assert.ok(ledger)
    assert.deepEqual(peer.calls, [{ name: 'inspect_records', arguments: { query: 'routine-native-smoke' } }], 'the real transport dispatched the one exact reviewed call')
    assert.equal(model.requests.length, 2, 'the real runner made one tool-use turn and one post-result model turn')
    const permission = current.policy.approval
    assert.equal(permission.tools[0].connectionId, connection.id)
    assert.deepEqual(permission.tools[0].fixedArguments, { query: 'routine-native-smoke' })
    const stored = persistedRoutineMcp(profile)
    assert.equal(stored.policies.find(row => row.routineId === task.id)?.policy.approval?.reviewHash, permission.reviewHash)
    assert.equal(stored.runs.find(row => row.runId === ledger.runId)?.calls[0]?.status, 'done')
    const sharedRows = await api(page, '/schedules')
    const sharedTask = sharedRows.find(row => row.id === task.id)
    const completedRun = sharedTask?.runs?.find(row => row.id === ledger.runId)
    assert.equal(completedRun?.status, 'ok')
    assert.equal(completedRun?.detail, 'Routine MCP local acceptance completed.', 'the exact model answer is delivered to the routine output')
    assert.equal(JSON.stringify(sharedTask).includes('routineMcp'), false, 'private approval and receipts are absent from public Routine output')
    await page.goto(`${origin}/scheduled/${task.id}/external-mcp`)
    await expect(panel().getByRole('heading', { name: 'Private run receipts', exact: true })).toBeVisible()
    await expect(panel().getByText(/Fixture records inspected/)).toBeVisible()
    await page.screenshot({ path: join(evidenceDirectory, 'private-receipt-and-output.png'), fullPage: true })

    stage = 'signed-in-relaunch-and-revoke'
    const oldOrigin = origin
    await close(run); run = undefined
    await expect.poll(() => fetch(`${oldOrigin}/api/v1/me`).then(response => response.status).catch(() => 0), { timeout: 5_000 }).toBe(0)
    run = await launch(fixturePackage.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, identity.user.id, 'ordinary account remains signed in across full native relaunch')
    const reopened = await api(page, `/schedules/${task.id}/mcp-permission`)
    assert.equal(reopened.policy.approval?.reviewHash, permission.reviewHash)
    assert.equal(reopened.runs.find(row => row.runId === ledger.runId)?.calls[0]?.status, 'done')
    await page.goto(`${origin}/scheduled/${task.id}/external-mcp`)
    await page.getByRole('button', { name: 'Revoke approval', exact: true }).click()
    await expect(page.getByRole('region', { name: 'External MCP' }).getByText('No unattended MCP tools', { exact: true })).toBeVisible({ timeout: 20_000 })
    assert.equal((await api(page, `/schedules/${task.id}/mcp-permission`)).policy.approval, null)
    assert.equal(peer.calls.length, 1, 'relaunch and revocation never repeat an already completed external call')

    stage = 'interrupted-after-known-MCP-result'
    await page.getByRole('checkbox').check()
    await page.getByLabel('Fixed values for inspect_records').fill('{"query":"routine-native-smoke"}')
    await page.getByRole('button', { name: 'Review approval', exact: true }).click()
    await panel().locator('[aria-label="Approval review"]').getByRole('button', { name: 'Approve these tools', exact: true }).click()
    await expect(panel().getByText('Approval active', { exact: true })).toBeVisible({ timeout: 20_000 })
    model.holdFinal()
    await page.goto(`${origin}/scheduled/${task.id}`)
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect.poll(() => peer.calls.length, { timeout: WAIT }).toBe(2)
    await expect.poll(() => model.heldCount, { timeout: WAIT }).toBe(1)
    const beforeQuit = await api(page, `/schedules/${task.id}/mcp-permission`)
    const inFlight = beforeQuit.runs.find(row => row.calls.some(call => call.status === 'done' && row.status === 'running'))
    assert.ok(inFlight, 'the durable receipt exists after the peer returned but before the model final response')
    assert.equal(persistedRoutineMcp(profile).runs.find(row => row.runId === inFlight.runId)?.calls[0]?.status, 'done')
    const exitOrigin = origin
    await close(run); run = undefined
    await expect.poll(() => fetch(`${exitOrigin}/api/v1/me`).then(response => response.status).catch(() => 0), { timeout: 5_000 }).toBe(0)
    run = await launch(fixturePackage.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, identity.user.id)
    const recovered = await api(page, `/schedules/${task.id}/mcp-permission`)
    const interrupted = recovered.runs.find(row => row.runId === inFlight.runId)
    assert.equal(interrupted?.phase, 'interrupted')
    assert.equal(interrupted?.status, 'failed')
    assert.equal(interrupted?.calls[0]?.status, 'done', 'known success remains a private exact receipt, not a retry signal')
    assert.equal(recovered.policy.approval, null, 'interrupted external work suspends the standing approval')
    assert.equal((await api(page, '/schedules')).find(row => row.id === task.id)?.enabled, false)
    assert.equal(peer.calls.length, 2, 'startup recovery did not repeat the known external call')
    await page.goto(`${origin}/scheduled/${task.id}/external-mcp`)
    await expect(page.getByText(/This run was interrupted/)).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: join(evidenceDirectory, 'interrupted-after-relaunch.png'), fullPage: true })
    console.log(`[desktop-routine-mcp-smoke] disposable loopback package · rendered owner approval/revoke · real Routine runner → local Messages → MCP → reply · private SQLite ledger + output · signed-in relaunch · known-result interruption without replay · evidence ${evidenceDirectory}`)
  } catch (error) {
    if (run?.page) await run.page.screenshot({ path: join(evidenceDirectory, 'failure.png'), fullPage: true }).catch(() => {})
    throw new Error(`Packaged Routine MCP smoke failed during ${stage}: ${error instanceof Error ? error.message : String(error)} (evidence: ${evidenceDirectory})`, { cause: error })
  } finally {
    await close(run)
    await model?.close(); await peer?.close(); await fixturePackage?.close()
    await rm(profile, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedRoutineMcp()
