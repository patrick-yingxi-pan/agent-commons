/** Separate packaged Commission acceptance, never signed-candidate validation.
 * Only the owned ASAR copy admits loopback. UI, worker, schema transport,
 * OS credential custody, SQLite and process recovery remain real. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { launchPackagedDesktop, closePackagedDesktop } from './smoke.mjs'
import { packagedExecutable } from './smokePaths.mjs'
import { createMcpLoopbackSmokePackage } from './mcpLoopbackSmokePackage.mjs'
import { startContributionMcpSmokePeer } from './contributionMcpSmokeFixture.mjs'
import { COMMISSION_MESSAGES_SMOKE_MODEL, startCommissionMessagesSmokeFixture } from './commissionMessagesSmokeFixture.mjs'
import { MCP_CREDENTIAL_FILE } from './mcpCredentialVault.mjs'
import { AUTH_ROOT_FILE } from './authRoot.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const WAIT = 30_000
const PASSWORD = 'isolated-commission-native-password'
const BEARER = 'isolated-commission-mcp-native-canary'
const ARGUMENTS = { text: 'Private Commission native record · café · 東京' }

async function api(page, path, body, { status = 200 } = {}) {
  const response = await page.evaluate(async ({ path, body, key }) => {
    const response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }, { path, body, key: randomUUID() })
  assert.equal(response.status, status, `Packaged Commission ${path}: expected HTTP ${status}, received ${response.status}`)
  return response.body
}

function stored(profile, slice, id) {
  const db = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    if (slice === 'usageReservations' && id === undefined) {
      const manifest = db.prepare('SELECT json FROM kv WHERE key = ?').get('__slices__')
      assert.ok(manifest && JSON.parse(manifest.json).includes(slice), 'the actual SQLite usage slice exists')
      return db.prepare('SELECT json FROM entities WHERE slice = ? ORDER BY idx').all(slice).map(row => JSON.parse(row.json))
    }
    const row = id === undefined
      ? db.prepare('SELECT json FROM kv WHERE key = ?').get(slice)
      : db.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?').get(slice, id)
    assert.ok(row, `actual SQLite retains ${slice}${id ? `/${id}` : ''}`)
    return JSON.parse(row.json)
  } finally { db.close() }
}

async function assertSecretStorage(profile, reference) {
  const bytes = await readFile(join(profile, MCP_CREDENTIAL_FILE))
  assert.equal(bytes.includes(Buffer.from(BEARER)), false, 'the real OS vault encrypts the fixture credential')
  assert.deepEqual(Object.keys(JSON.parse(bytes).entries), [reference])
  for (const file of ['store.db', 'store.db-wal', 'store.db-shm']) {
    const content = await readFile(join(profile, file)).catch(error => {
      if (error.code === 'ENOENT') return Buffer.alloc(0)
      throw error
    })
    assert.equal(content.includes(Buffer.from(BEARER)), false, 'product persistence excludes raw MCP credentials')
  }
}

function assertPublic(value, privateValues) {
  const text = JSON.stringify(value)
  for (const secret of privateValues) assert.equal(text.includes(secret), false, 'public work contains no private Commission call data')
  for (const field of ['credentialReference', 'fixedArguments', 'reviewHash', 'commissionMcp']) {
    assert.equal(text.includes(`"${field}"`), false, `public work excludes ${field}`)
  }
}

// Observe longer than the production worker's five-second cadence. Every poll
// checks cardinality; a one-time check immediately after revoke is insufficient.
async function assertQuiet(peer, model, calls, preparations) {
  const started = Date.now()
  await expect.poll(() => {
    assert.equal(peer.calls.length, calls, 'represented or unapproved work never redispatches')
    assert.equal(model.preparations.length, preparations, 'no hidden repeat model preparation')
    return Date.now() - started
  }, { timeout: 10_000, intervals: [100, 250, 500] }).toBeGreaterThan(5_500)
}

async function configure(page, model, connection) {
  const { project } = await api(page, '/projects', {
    name: 'Native Commission MCP acceptance', description: 'Disposable local-peer acceptance project.',
  }, { status: 201 })
  await api(page, '/relations/ops', { op: { kind: 'scope-context', projectId: project.id, projectName: project.name,
    context: { kind: 'connector', label: 'write_record', meta: 'Only the locally authored smoke tool.' } } })
  const provider = await api(page, '/providers', {
    label: 'Commission local model', modelFamily: 'claude', effortLevels: ['Low'],
    models: [{ id: COMMISSION_MESSAGES_SMOKE_MODEL, label: 'Commission smoke model' }],
    authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] },
    config: { baseURL: model.origin, model: COMMISSION_MESSAGES_SMOKE_MODEL },
  })
  const prompt = await api(page, '/system-prompts', {
    label: 'Commission smoke instructions', body: 'Prepare only the one reviewed tool call.', targetFamily: 'claude',
  })
  const agent = await api(page, '/agents', {
    label: 'Native Commission Agent', providerId: provider.id, systemPromptId: prompt.id, tools: [],
    authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] }, instructions: 'Use only the exact reviewed values.',
  })
  const commission = await api(page, '/commissions', { agentId: agent.id, projectId: project.id, role: 'writer', standing: true })
  return { project, provider, agent, commission, connection }
}

async function openPanel(page, origin, fixture) {
  await page.goto(`${origin}/projects/${fixture.project.id}`)
  const row = page.locator(`[data-contributor-row="${fixture.commission.id}"]`)
  await expect(row).toBeVisible({ timeout: WAIT })
  await row.getByRole('button', { name: 'Unattended MCP…', exact: true }).click()
  const panel = row.locator('[data-commission-mcp]')
  await expect(panel.getByRole('heading', { name: `Unattended MCP · ${fixture.agent.label}`, exact: true })).toBeVisible()
  return panel
}

async function reviewApproval(panel, fixture, count = 2) {
  await panel.getByLabel('Unattended endpoint', { exact: true }).selectOption(fixture.provider.id)
  await panel.getByLabel('Unattended model', { exact: true }).selectOption(COMMISSION_MESSAGES_SMOKE_MODEL)
  const card = panel.locator('article').filter({ hasText: fixture.connection.label })
  await card.getByRole('checkbox').check()
  await card.getByLabel('Fixed values for write_record', { exact: true }).fill(JSON.stringify(ARGUMENTS))
  await panel.getByLabel('Maximum work items', { exact: true }).fill(String(count))
  await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
  const review = panel.locator('[data-commission-mcp-review]')
  await expect(review).toContainText('Destination, audience and limits')
  await expect(review).toContainText(fixture.provider.label)
  await expect(review).toContainText(JSON.stringify(ARGUMENTS, null, 2))
  return review
}

async function approve(review, panel) {
  await review.getByRole('button', { name: 'Approve unattended work', exact: true }).click()
  await expect(panel.locator('[data-commission-mcp-status]')).toHaveText('Approval active', { timeout: WAIT })
}

export async function smokePackagedCommissionMcp({ executable = packagedExecutable() } = {}) {
  if (process.platform !== 'darwin') {
    console.log('[desktop-commission-mcp-smoke] not run: OS-backed package acceptance requires macOS')
    return
  }
  const profile = await mkdtemp(join(tmpdir(), 'agent-commons-commission-mcp-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-commission-mcp-smoke')
  await mkdir(evidenceRoot, { recursive: true })
  const evidenceDirectory = await mkdtemp(join(evidenceRoot, 'run-'))
  let run, fixturePackage, peer, model
  let stage = 'original-package-loopback-refusal'
  try {
    peer = await startContributionMcpSmokePeer({ bearer: BEARER })
    model = await startCommissionMessagesSmokeFixture({ arguments: ARGUMENTS })
    run = await launchPackagedDesktop(executable, profile)
    let { page, origin } = run
    const owner = await api(page, '/auth/signup', {
      name: 'Native Commission Owner', email: `native-commission-${randomUUID()}@example.test`, password: PASSWORD,
    })
    assert.equal((await api(page, '/mcp-connections')).capabilities.loopbackConnections, false)
    await api(page, '/mcp-connections', { creationId: randomUUID(), label: 'Must refuse loopback', endpoint: peer.url, authentication: 'none' }, { status: 400 })
    assert.equal(peer.authorizations.length, 0, 'original package refuses without contacting the peer')
    await closePackagedDesktop(run); run = undefined

    stage = 'disposable-copy-and-real-OS-custody'
    fixturePackage = await createMcpLoopbackSmokePackage(executable)
    run = await launchPackagedDesktop(fixturePackage.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, owner.user.id)
    const capabilities = (await api(page, '/mcp-connections')).capabilities
    assert.equal(capabilities.loopbackConnections, true)
    assert.equal(capabilities.deviceBearerCredentials, true)
    const created = await api(page, '/mcp-connections', {
      creationId: randomUUID(), label: 'Native Commission private peer', endpoint: peer.url, authentication: 'device-bearer',
    })
    const { binding } = await api(page, `/mcp-connections/${created.connection.id}/credential-binding`)
    assert.deepEqual(binding, { connectionId: created.connection.id, tenantId: owner.tenant.id, endpoint: peer.url })
    const reference = await page.evaluate(({ binding, bearer }) => window.agentCommonsDesktop.mcpCredentials.provision(binding, bearer), { binding, bearer: BEARER })
    const { connection } = await api(page, `/mcp-connections/${created.connection.id}/inspect`, {
      operationId: randomUUID(), expectedRevision: created.connection.revision, credentialReference: reference,
    })
    assert.equal(connection.execution, 'approval-required')
    await assertSecretStorage(profile, reference)
    const fixture = await configure(page, model, connection)
    const permissionPath = `/commissions/${fixture.commission.id}/mcp-permission`
    const workPath = `/projects/${fixture.project.id}/open-subgoals`
    const postWork = title => api(page, workPath, { subGoal: title, type: 'mcp.mutate', target: 'write_record', note: 'Disposable local acceptance work.' })
    const privateValues = [BEARER, reference, peer.url, connection.id, ARGUMENTS.text, 'smoke-record-1']
    const first = await postWork('Native Commission successful work')
    assert.equal(first.status, 'open')

    stage = 'rendered-fresh-owner-approval'
    let panel = await openPanel(page, origin, fixture)
    const review = await reviewApproval(panel, fixture)
    await assertQuiet(peer, model, 0, 0)
    assert.equal((await api(page, permissionPath)).policy.approval, null, 'standing and a frozen review are not permission')
    await review.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidenceDirectory, 'fresh-review.png'), fullPage: true })
    await approve(review, panel)
    const approval = (await api(page, permissionPath)).policy.approval
    assert.equal(approval.execution.modelId, COMMISSION_MESSAGES_SMOKE_MODEL)
    assert.deepEqual(approval.tools[0].fixedArguments, ARGUMENTS)

    stage = 'real-worker-model-effect-and-SQLite'
    await expect.poll(async () => (await api(page, permissionPath)).claims.find(row => row.work.itemId === first.id)?.status, { timeout: WAIT }).toBe('done')
    const completed = (await api(page, permissionPath)).claims.find(row => row.work.itemId === first.id)
    assert.deepEqual(peer.calls, [{ name: 'write_record', arguments: ARGUMENTS }])
    assert.equal(model.preparations.length, 1, 'one tool-free preparation precedes one exact effect')
    assert.deepEqual(completed.call.arguments, ARGUMENTS)
    assert.deepEqual(completed.result.structuredContent, { accepted: true, recordId: 'smoke-record-1' })
    const savedClaim = stored(profile, 'commissionMcp').claims.find(row => row.id === completed.id)
    assert.equal(savedClaim.permission.ownerUserId, owner.user.id)
    assert.deepEqual(savedClaim.attempt.result, completed.result)
    const usage = stored(profile, 'usageReservations').find(row => row.id === completed.id)
    assert.equal(usage.status, 'settled')
    assert.equal(usage.tenantId, owner.tenant.id)
    assert.deepEqual(usage.report, { inputTokens: 17, outputTokens: 9 })
    const done = (await api(page, workPath)).find(row => row.id === first.id)
    assert.equal(done.status, 'done')
    assert.equal(done.commissionResolution, 'mcp')
    assert.equal(stored(profile, 'openSubGoals', first.id).commissionResolution, undefined, 'provenance is derived, not persisted')
    assert.equal((await api(page, `/agents/${fixture.agent.id}`)).contributions, 1)
    assertPublic(done, privateValues)
    await panel.getByRole('button', { name: 'Refresh review', exact: true }).click()
    const receipt = panel.locator(`[data-commission-mcp-receipt="${completed.id}"]`)
    await expect(receipt).toContainText('Call succeeded')
    await receipt.locator('summary').click()
    await expect(receipt).toContainText('smoke-record-1')
    await receipt.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidenceDirectory, 'private-success.png'), fullPage: true })

    stage = 'reader-and-foreign-privacy'
    const reader = await api(page, '/auth/signup', { name: 'Commission reader', email: `reader-${randomUUID()}@example.test`, password: PASSWORD })
    await api(page, '/auth/session', { userId: owner.user.id })
    await api(page, '/grants', { subject: { kind: 'project', id: fixture.project.id }, audience: { kind: 'org', orgId: reader.tenant.id }, tier: 'view' })
    await api(page, '/auth/session', { userId: reader.user.id })
    const shared = await api(page, workPath)
    assert.equal(shared.find(row => row.id === first.id).commissionResolution, 'mcp')
    assertPublic(shared, privateValues)
    await api(page, permissionPath, undefined, { status: 404 })
    await api(page, `/mcp-connections/${connection.id}`, undefined, { status: 404 })
    await page.goto(`${origin}/projects/${fixture.project.id}`)
    await expect(page.getByRole('main')).toContainText(fixture.project.name)
    await expect(page.locator('[data-commission-mcp]')).toHaveCount(0)
    await expect(page.getByRole('main')).not.toContainText(ARGUMENTS.text)
    await api(page, '/auth/signup', { name: 'Commission outsider', email: `outsider-${randomUUID()}@example.test`, password: PASSWORD })
    await api(page, workPath, undefined, { status: 404 })
    await api(page, permissionPath, undefined, { status: 404 })
    await api(page, '/auth/session', { userId: owner.user.id })

    stage = 'signed-in-full-relaunch-and-revoke'
    const authRoot = await readFile(join(profile, AUTH_ROOT_FILE))
    const oldOrigin = origin
    await closePackagedDesktop(run); run = undefined
    await assert.rejects(fetch(`${oldOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }))
    run = await launchPackagedDesktop(fixturePackage.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, owner.user.id, 'ordinary account remains signed in across full native relaunch')
    assert.deepEqual(await readFile(join(profile, AUTH_ROOT_FILE)), authRoot)
    assert.deepEqual((await api(page, permissionPath)).claims.find(row => row.id === completed.id), completed)
    assert.deepEqual((await api(page, permissionPath)).policy.approval, approval)
    panel = await openPanel(page, origin, fixture)
    await panel.getByRole('button', { name: 'Revoke approval', exact: true }).click()
    await expect(panel.locator('[data-commission-mcp-status]')).toHaveText('No unattended approval')
    const second = await postWork('Native Commission interrupted work')
    await assertQuiet(peer, model, 1, 1)
    assert.equal((await api(page, workPath)).find(row => row.id === second.id).status, 'open')

    stage = 'pending-effect-before-process-exit'
    peer.setMode('hold')
    await approve(await reviewApproval(panel, fixture), panel)
    await expect.poll(() => peer.calls.length, { timeout: WAIT }).toBe(2)
    const pending = stored(profile, 'commissionMcp').claims.find(row => row.work.itemId === second.id)
    assert.equal(pending.phase, 'effect')
    assert.equal(pending.attempt.status, 'pending', 'the exact effect receipt is durable before the peer returns')
    assert.deepEqual(pending.attempt.call.arguments, ARGUMENTS)
    assert.equal(stored(profile, 'usageReservations').find(row => row.id === pending.id).status, 'settled')
    const exitOrigin = origin
    await closePackagedDesktop(run); run = undefined
    await assert.rejects(fetch(`${exitOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }))
    assert.equal(stored(profile, 'commissionMcp').claims.find(row => row.id === pending.id).attempt.status, 'pending', 'process exit leaves submitted work pending for startup recovery')

    stage = 'rendered-startup-uncertainty-without-replay'
    peer.setMode('success')
    run = await launchPackagedDesktop(fixturePackage.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, owner.user.id)
    panel = await openPanel(page, origin, fixture)
    await expect(panel.locator(`[data-commission-mcp-receipt="${pending.id}"]`)).toContainText('Outcome uncertain', { timeout: WAIT })
    const recovered = await api(page, permissionPath)
    assert.equal(recovered.claims.find(row => row.id === pending.id).status, 'uncertain')
    assert.equal(stored(profile, 'commissionMcp').claims.find(row => row.id === pending.id).attempt.status, 'uncertain')
    assert.equal(recovered.policy.approval, null, 'startup withdraws the interrupted grant')
    assert.deepEqual(recovered.claims.find(row => row.id === completed.id), completed)
    assert.equal((await api(page, `/agents/${fixture.agent.id}`)).contributions, 1, 'uncertainty awards no completion credit')
    await panel.locator(`[data-commission-mcp-receipt="${pending.id}"]`).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidenceDirectory, 'recovered-uncertain.png'), fullPage: true })

    stage = 'renewed-approval-cannot-replay-represented-work'
    await approve(await reviewApproval(panel, fixture), panel)
    await assertQuiet(peer, model, 2, 2)
    assert.equal((await api(page, workPath)).find(row => row.id === second.id).status, 'open')
    const third = await postWork('Native Commission new work after review')
    await expect.poll(async () => (await api(page, permissionPath)).claims.find(row => row.work.itemId === third.id)?.status, { timeout: WAIT }).toBe('done')
    assert.deepEqual(peer.calls, Array.from({ length: 3 }, () => ({ name: 'write_record', arguments: ARGUMENTS })))
    assert.equal(model.preparations.length, 3)
    assert.equal((await api(page, `/agents/${fixture.agent.id}`)).contributions, 2, 'only the two known successful work items earn credit')
    await panel.getByRole('button', { name: 'Revoke approval', exact: true }).click()
    await expect(panel.locator('[data-commission-mcp-status]')).toHaveText('No unattended approval')
    assert.ok(peer.authorizations.length > 0 && peer.authorizations.every(row => row.value === `Bearer ${BEARER}`))
    await assertSecretStorage(profile, reference)

    stage = 'managed-backup-retains-private-history'
    const final = stored(profile, 'commissionMcp')
    assert.deepEqual(final.claims.map(row => row.attempt.status), ['done', 'uncertain', 'done'])
    const backup = await page.evaluate(() => window.agentCommonsDesktop.data.createBackup())
    assert.match(backup.fileName, /^backup-[A-Za-z0-9.-]+\.json$/)
    const bytes = await readFile(join(profile, 'snapshots', backup.fileName))
    assert.equal(bytes.includes(Buffer.from(BEARER)), false)
    const portable = JSON.parse(bytes)
    assert.deepEqual(portable.commissionMcp, final)
    assert.deepEqual(portable.usageReservations, stored(profile, 'usageReservations'))
    await writeFile(join(evidenceDirectory, 'evidence.json'), `${JSON.stringify({
      checkedAt: new Date().toISOString(), sourceAsarSha256: fixturePackage.sourceAsarSha256,
      fixtureAsarSha256: fixturePackage.fixtureAsarSha256, toolCalls: peer.calls.length,
      modelPreparations: model.preparations.length, claimStatuses: final.claims.map(row => row.attempt.status),
      originalPackagePublicOnly: true, realOsVaultAndAuthentication: true,
      renderedApprovalAndRevoke: true, privateReceiptWithPublicProvenance: true,
      pendingOnDiskBeforeRelaunch: true, renewedApprovalDoesNotReplay: true, durableBackup: true,
      scope: 'Unsigned local macOS disposable ASAR copy; only startup loopback admission changed. Not public-service, paid-provider, signed/notarized, Intel or explicit-restore acceptance.',
    }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    console.log(`[desktop-commission-mcp-smoke] owner approval/revoke · real worker/model/MCP · OS vault · private SQLite claims and usage · public provenance · full signed-in relaunch · uncertain work never replays after renewal · backup · evidence ${evidenceDirectory}`)
  } catch (error) {
    if (run?.page) await run.page.screenshot({ path: join(evidenceDirectory, 'failure.png'), fullPage: true }).catch(() => {})
    throw new Error(`Packaged Commission MCP failed during ${stage}: ${String(error.message).replaceAll(BEARER, '<redacted>')} (evidence: ${evidenceDirectory})`, { cause: error })
  } finally {
    try { await closePackagedDesktop(run) }
    finally {
      try { await model?.close(); await peer?.close() }
      finally {
        try { await fixturePackage?.close() }
        finally { await rm(profile, { recursive: true, force: true }) }
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedCommissionMcp()
