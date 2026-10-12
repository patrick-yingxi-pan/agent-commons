/** Native Contribution execution with a disposable loopback-enabled package.
 * The source package is first proved public-only and never modified. Only the
 * copied startup scope is a fixture; UI, HTTP transport, OS vault, schema worker,
 * receipts, SQLite and full-process recovery remain the packaged implementation.
 * This is not public-service, TLS, signed-release or Intel acceptance.
 */
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
import { MCP_CREDENTIAL_FILE } from './mcpCredentialVault.mjs'
import { AUTH_ROOT_FILE } from './authRoot.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000
const BEARER = 'isolated-contribution-mcp-native-canary'
const PASSWORD = 'isolated-contribution-native-password'
const ARGUMENTS = { text: 'Explicit native Contribution call · café · 東京' }

async function request(page, path, body, { key = randomUUID(), status = 200 } = {}) {
  const response = await page.evaluate(async ({ path, body, key }) => {
    const response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }, { path, body, key })
  assert.equal(response.status, status, `Packaged Contribution MCP ${path}: expected HTTP ${status}`)
  return response.body
}

function storedContribution(profile, id) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?').get('contributions', id)
    assert.ok(row, 'the exact Contribution exists in the actual SQLite store')
    return JSON.parse(row.json)
  } finally { database.close() }
}

function storedOpenWork(profile, id) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?').get('openSubGoals', id)
    assert.ok(row, 'the exact Open Work item exists in the actual SQLite store')
    return JSON.parse(row.json)
  } finally { database.close() }
}

function assertPublic(value, privateValues) {
  const text = JSON.stringify(value)
  assert.ok(privateValues.every(secret => !text.includes(secret)), 'Project-visible history must not reveal private connection authority')
  assert.ok(!text.includes('mcpAuthority') && !text.includes('credentialReference'), 'private binding fields must be absent')
}

async function assertSecretStorage(profile, reference) {
  const vaultBytes = await readFile(join(profile, MCP_CREDENTIAL_FILE))
  assert.equal(vaultBytes.includes(Buffer.from(BEARER)), false, 'the native credential is encrypted on disk')
  const vault = JSON.parse(vaultBytes.toString('utf8'))
  assert.deepEqual(Object.keys(vault.entries), [reference], 'the OS vault retains exactly the one bound credential')
  for (const name of ['store.db', 'store.db-wal', 'store.db-shm']) {
    const bytes = await readFile(join(profile, name)).catch(error => {
      if (error.code === 'ENOENT') return Buffer.alloc(0)
      throw error
    })
    assert.equal(bytes.includes(Buffer.from(BEARER)), false, 'SQLite never contains the raw native MCP token')
  }
}

async function confirmOneCall(page) {
  await page.getByRole('button', { name: 'Review & run', exact: true }).click()
  const consent = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
  await expect(consent).toContainText('credentials stay private')
  await expect(consent).toContainText('running again may duplicate')
  await consent.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
}

/** Exercise the public executable's automation refusal on its own disposable
 * profile. The eligible standing Commission proves the gate blocks real mock
 * execution, while the accepted work posts remain open. This profile is removed
 * before the separate loopback-fixture acceptance starts. */
async function smokePackagedAutomationPosture({ executable, launch, close }) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-commons-automation-smoke-'))
  let run
  try {
    run = await launch(executable, profile)
    const { page } = run
    await request(page, '/auth/signup', {
      name: 'Native Automation Owner', email: `native-automation-${randomUUID()}@example.test`, password: PASSWORD,
    })
    const capabilities = await request(page, '/capabilities')
    assert.equal(capabilities.features?.simulatedAutomation, false, 'the original packaged executable advertises no fixture automation')

    const project = await request(page, '/projects', {
      name: 'Native release automation gate', description: 'Disposable smoke-only setup.',
    }, { status: 201 })
    const provider = await request(page, '/providers', {
      label: 'Native automation gate provider', modelFamily: 'claude', effortLevels: ['Low'],
      models: [{ id: `automation-gate-${randomUUID()}`, label: 'No-op acceptance model' }],
    })
    const prompt = await request(page, '/system-prompts', {
      label: 'Native automation gate prompt', body: 'Unused: this smoke never makes a model call.', targetFamily: 'claude',
    })
    const agent = await request(page, '/agents', {
      label: 'Native automation gate Agent', providerId: provider.id, systemPromptId: prompt.id,
      tools: [], instructions: 'Unused by this smoke.',
    })
    const commission = await request(page, '/commissions', {
      role: 'writer', agentId: agent.id, projectId: project.project.id, standing: true,
    })

    const dispatchBefore = await request(page, '/dispatch')
    const projectTarget = `native-automation-project-${randomUUID()}`
    const proxyTarget = `native-automation-proxy-${randomUUID()}`
    const projectEffect = await request(page, `/projects/${project.project.id}/effects`, {
      commissionId: commission.id, subGoal: 'must-not-fire', type: 'charge', target: projectTarget,
    }, { status: 409 })
    assert.equal(projectEffect.error?.code, 'capability_unavailable')
    const proxyEffect = await request(page, `/agents/${agent.id}/proxy`, {
      fromAgentId: `requester-${randomUUID()}`, capability: 'charge', target: proxyTarget,
    }, { status: 409 })
    assert.equal(proxyEffect.error?.code, 'capability_unavailable')
    const dispatchRefusal = await request(page, '/dispatch', {
      title: 'Must not simulate a packaged Dispatch', detail: 'The release smoke expects a capability refusal.',
    }, { status: 409 })
    assert.equal(dispatchRefusal.error?.code, 'capability_unavailable')

    const dispatchAfter = await request(page, '/dispatch')
    assert.deepEqual(dispatchAfter.map(row => row.id), dispatchBefore.map(row => row.id), 'refused Dispatch creates no feed row')
    const currentAgent = await request(page, `/agents/${agent.id}`)
    assert.equal(currentAgent.contributions ?? 0, 0, 'refused project effect creates no synthetic credit')
    const audit = await request(page, '/audit')
    assert.equal(audit.some(row => row.target === projectTarget || row.target === proxyTarget), false,
      'refused effects create no audit receipt')

    const subGoal = `native-open-work-${randomUUID()}`
    const posted = await request(page, `/projects/${project.project.id}/open-subgoals`, {
      subGoal, type: 'charge', target: `budget:${subGoal}`,
    })
    assert.equal(posted.status, 'open', 'a valid native work post stays open despite an eligible standing Agent')
    const a2aSubGoal = `native-a2a-work-${randomUUID()}`
    const a2a = await request(page, `/a2a/projects/${project.project.id}`, {
      jsonrpc: '2.0', id: a2aSubGoal, method: 'message/send',
      params: { message: {
        kind: 'message', role: 'user', messageId: a2aSubGoal,
        parts: [
          { kind: 'text', text: a2aSubGoal },
          { kind: 'data', data: { type: 'charge', target: `budget:${a2aSubGoal}` } },
        ],
      } },
    })
    assert.equal(a2a.result?.status?.state, 'submitted', 'accepted A2A work stays submitted, not synthetically completed')
    const backlog = await request(page, `/projects/${project.project.id}/open-subgoals`)
    assert.equal(backlog.length, 2)
    assert.ok(backlog.every(row => row.status === 'open'), 'both accepted work items remain open')
    console.log('[desktop-automation-smoke] original packaged capabilities · Dispatch/project-effect/Agent-proxy refusals · accepted open native/A2A work')
  } finally {
    await close(run)
    await rm(profile, { recursive: true, force: true })
  }
}

export async function smokePackagedContributionMcp({ executable = packagedExecutable() } = {}) {
  if (process.platform !== 'darwin') {
    console.log('[desktop-contribution-mcp-smoke] not run: this OS-backed fixture acceptance requires macOS')
    return
  }
  const profile = await mkdtemp(join(tmpdir(), 'agent-commons-contribution-mcp-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-contribution-mcp-smoke')
  await mkdir(evidenceRoot, { recursive: true })
  const evidenceDirectory = await mkdtemp(join(evidenceRoot, 'run-'))
  let fixturePackage, peer, run
  let stage = 'production-loopback-refusal'
  try {
    peer = await startContributionMcpSmokePeer({ bearer: BEARER })
    run = await launchPackagedDesktop(executable, profile)
    let { page, origin } = run
    const owner = await request(page, '/auth/signup', {
      name: 'Native Contribution Owner', email: 'native-contribution-owner@example.test', password: PASSWORD,
    })
    const normalList = await request(page, '/mcp-connections')
    assert.equal(normalList.capabilities.loopbackConnections, false, 'the unmodified package stays public-only')
    await request(page, '/mcp-connections', {
      creationId: randomUUID(), label: 'Must be refused', endpoint: peer.url, authentication: 'none',
    }, { status: 400 })
    assert.equal(peer.authorizations.length, 0, 'production refusal does not contact the local peer')
    await closePackagedDesktop(run)
    run = undefined

    stage = 'production-automation-refusal'
    await smokePackagedAutomationPosture({ executable, launch: launchPackagedDesktop, close: closePackagedDesktop })

    stage = 'fixture-copy-and-real-inspection'
    fixturePackage = await createMcpLoopbackSmokePackage(executable)
    run = await launchPackagedDesktop(fixturePackage.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await request(page, '/me')).user.id, owner.user.id, 'OS-backed sign-in survives the independent launch')
    const capabilities = (await request(page, '/mcp-connections')).capabilities
    assert.equal(capabilities.loopbackConnections, true, 'only the disposable fixture copy admits the loopback peer')
    assert.equal(capabilities.deviceBearerCredentials, true, 'the real OS-backed credential bridge is available')
    const { connection } = await request(page, '/mcp-connections', {
      creationId: randomUUID(), label: 'Native exact-call fixture', endpoint: peer.url, authentication: 'device-bearer',
    })
    const { binding } = await request(page, `/mcp-connections/${connection.id}/credential-binding`)
    assert.deepEqual(binding, { connectionId: connection.id, tenantId: owner.tenant.id, endpoint: peer.url })
    const reference = await page.evaluate(async ({ binding, bearer }) =>
      window.agentCommonsDesktop.mcpCredentials.provision(binding, bearer), { binding, bearer: BEARER })
    const inspected = await request(page, `/mcp-connections/${connection.id}/inspect`, {
      operationId: randomUUID(), expectedRevision: connection.revision, credentialReference: reference,
    })
    assert.equal(inspected.connection.execution, 'approval-required')
    assert.equal(peer.calls.length, 0, 'catalog inspection never executes an effect')
    await assertSecretStorage(profile, reference)
    const privateValues = [BEARER, reference, peer.url, connection.id]
    assertPublic(await request(page, '/mcp-connections'), [BEARER, reference, peer.url])

    stage = 'rendered-proposal-approval-and-call'
    const { project } = await request(page, '/projects', { name: 'Native exact MCP calls', description: '' }, { status: 201 })
    const contribution = await request(page, `/projects/${project.id}/contributions`, {
      title: 'Publish one reviewed record', summary: 'Only the frozen arguments go to the local peer.',
    })
    const path = `/projects/${project.id}/contributions/${contribution.id}`
    const route = `/projects/${project.id}/changes/${contribution.id}`
    const saved = () => storedContribution(profile, contribution.id)
    const current = async () => (await request(page, `/projects/${project.id}/contributions`)).find(row => row.id === contribution.id)
    const submissions = []
    const observe = currentPage => currentPage.on('request', outgoing => {
      if (outgoing.method() === 'POST' && new URL(outgoing.url()).pathname === `/api/v1${path}/effects`) {
        submissions.push({ body: outgoing.postDataJSON(), key: outgoing.headers()['idempotency-key'] })
      }
    })
    observe(page)
    await page.goto(`${origin}${route}`)
    await page.getByRole('button', { name: 'Declare effects', exact: true }).click()
    await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
    await page.getByLabel('MCP tool 1', { exact: true }).selectOption({ label: 'Native exact-call fixture · write_record' })
    await page.getByLabel('MCP arguments 1', { exact: true }).fill(JSON.stringify(ARGUMENTS))
    await page.getByLabel('Max acts 1', { exact: true }).fill('3')
    await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toBeVisible()
    assert.equal(peer.calls.length, 0, 'proposing and approving an envelope never dispatches')
    await page.getByRole('button', { name: 'Review & run', exact: true }).click()
    const consent = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
    await expect(consent).toContainText('visible to every Project reader')
    assert.equal(peer.calls.length, 0, 'opening the separate confirmation never dispatches')
    await consent.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidenceDirectory, 'exact-call-consent.png') })
    await consent.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
    await expect(page.locator('[data-contribution-effect-status="done"]')).toBeVisible({ timeout: TIMEOUT_MS })
    assert.deepEqual(peer.calls, [{ name: 'write_record', arguments: ARGUMENTS }])
    const completed = await current()
    assert.deepEqual(completed.effects[0].arguments, ARGUMENTS)
    assert.deepEqual(completed.effects[0].result, {
      resultType: 'complete', isError: false,
      content: [{ type: 'text', text: 'The isolated fixture accepted one record.' }],
      structuredContent: { accepted: true, recordId: 'smoke-record-1' },
    }, 'the public receipt retains the exact normalized peer result')
    assert.equal(completed.envelope.lines[0].used, 1)
    assert.equal(saved().effectAttempts[0].status, 'done')
    assert.deepEqual(saved().effectAttempts[0].call.arguments, ARGUMENTS)
    assert.deepEqual(saved().effectAttempts[0].result, completed.effects[0].result, 'SQLite retains the same exact result')
    await expect(page.locator('[data-contribution-effect-status="done"]')).toContainText('smoke-record-1')
    assertPublic(completed, privateValues)
    await page.locator('[data-contribution-effect-status="done"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidenceDirectory, 'owner-done.png') })

    stage = 'real-account-reader-and-foreign-walls'
    const reader = await request(page, '/auth/signup', {
      name: 'Native Contribution Reader', email: 'native-contribution-reader@example.test', password: PASSWORD,
    })
    await request(page, '/auth/session', { userId: owner.user.id })
    await request(page, '/grants', { subject: { kind: 'project', id: project.id }, audience: { kind: 'org', orgId: reader.tenant.id }, tier: 'view' })
    await request(page, '/auth/session', { userId: reader.user.id })
    const shared = await current()
    assert.deepEqual(shared.effects, completed.effects, 'a reader receives the exact inert receipt')
    assert.equal(shared.envelope.lines[0].mcp.canRun, undefined, 'sharing never grants the owner’s connection')
    assertPublic(shared, privateValues)
    await request(page, `/mcp-connections/${connection.id}`, undefined, { status: 404 })
    await page.goto(`${origin}${route}`)
    await expect(page.locator('[data-contribution-effect-status="done"]')).toBeVisible()
    await expect(page.locator('[data-contribution-effect-status="done"]')).toContainText('smoke-record-1')
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await page.locator('[data-contribution-effect-status="done"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidenceDirectory, 'reader-history.png') })
    await request(page, '/auth/signup', {
      name: 'Native Contribution Outsider', email: 'native-contribution-outsider@example.test', password: PASSWORD,
    })
    await request(page, `/projects/${project.id}/contributions`, undefined, { status: 404 })
    await page.goto(`${origin}${route}`)
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.locator('[data-contribution-effect-status]')).toHaveCount(0)
    await expect(page.getByRole('main')).not.toContainText(ARGUMENTS.text)
    await request(page, '/auth/session', { userId: owner.user.id })
    await page.goto(`${origin}${route}`)

    stage = 'pending-before-process-exit'
    peer.setMode('hold')
    await confirmOneCall(page)
    await expect.poll(() => peer.calls.length).toBe(2)
    await expect.poll(() => saved().effectAttempts.at(-1).status).toBe('pending')
    const pending = saved()
    assert.equal(pending.envelope.lines[0].used, 2, 'the second slot commits before awaiting an external result')
    assert.equal(submissions.length, 2)
    const interrupted = submissions.at(-1)
    assert.ok(interrupted.key, 'the rendered call has an exact retry identity')
    const authBeforeQuit = await readFile(join(profile, AUTH_ROOT_FILE))
    const oldOrigin = origin
    await closePackagedDesktop(run)
    run = undefined
    await assert.rejects(fetch(`${oldOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }))
    assert.equal(saved().effectAttempts.at(-1).status, 'pending', 'real process exit leaves the submitted attempt durably pending')

    stage = 'independent-relaunch-without-replay'
    peer.setMode('success')
    run = await launchPackagedDesktop(fixturePackage.executable, profile)
    ;({ page, origin } = run)
    observe(page)
    assert.equal((await request(page, '/me')).user.id, owner.user.id)
    assert.deepEqual(await readFile(join(profile, AUTH_ROOT_FILE)), authBeforeQuit, 'relaunch preserves the exact OS-encrypted authentication root')
    await page.goto(`${origin}${route}`)
    await expect(page.locator('[data-contribution-effect-status="uncertain"]')).toBeVisible({ timeout: TIMEOUT_MS })
    const recovered = await current()
    assert.deepEqual(recovered.effects[0], completed.effects[0], 'the earlier completed receipt survives exactly')
    assert.equal(saved().effectAttempts.at(-1).status, 'uncertain', 'startup recovery durably records uncertainty')
    assert.equal(recovered.effects.at(-1).id, pending.effectAttempts.at(-1).id)
    assert.equal(recovered.envelope.lines[0].used, 2, 'uncertain execution retains its reserved slot')
    assert.equal(peer.calls.length, 2, 'restart and mounting never redispatch')
    const replay = await request(page, `${path}/effects`, interrupted.body, { key: interrupted.key })
    assert.deepEqual(replay.effects, recovered.effects, 'same-key Retry returns the saved receipt after relaunch')
    assert.equal(peer.calls.length, 2, 'exact Retry is receipt-only, not another external call')
    assertPublic(recovered, privateValues)
    await assertSecretStorage(profile, reference)
    await page.locator('[data-contribution-effect-status="uncertain"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidenceDirectory, 'recovered-uncertain.png') })

    stage = 'new-explicit-call-and-managed-backup'
    await confirmOneCall(page)
    await expect(page.locator('[data-contribution-effect-status="done"]')).toHaveCount(2, { timeout: TIMEOUT_MS })
    assert.deepEqual(peer.calls, Array.from({ length: 3 }, () => ({ name: 'write_record', arguments: ARGUMENTS })))
    assert.ok(peer.authorizations.length > 0 && peer.authorizations.every(row => row.value === `Bearer ${BEARER}`),
      'every actual peer request uses the bound OS-vault credential')
    const final = saved()
    assert.deepEqual(final.effectAttempts.map(row => row.status), ['done', 'uncertain', 'done'])
    assert.deepEqual(final.effectAttempts[2].result, {
      ...completed.effects[0].result, structuredContent: { accepted: true, recordId: 'smoke-record-2' },
    }, 'a fresh confirmed run saves its own result, not the previous receipt')
    assert.equal(final.envelope.lines[0].used, 3)
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    const backup = await page.evaluate(() => window.agentCommonsDesktop.data.createBackup())
    assert.match(backup.fileName, /^backup-[A-Za-z0-9.-]+\.json$/)
    const bytes = await readFile(join(profile, 'snapshots', backup.fileName))
    assert.equal(bytes.includes(Buffer.from(BEARER)), false, 'portable backup excludes the raw MCP credential')
    const portable = JSON.parse(bytes.toString('utf8'))
    assert.deepEqual(portable.contributions.find(row => row.id === contribution.id).effectAttempts, final.effectAttempts)
    await page.locator('[data-contribution-effect-status="done"]').last().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidenceDirectory, 'cardinality-exhausted.png') })

    stage = 'linked-project-work-run-and-resolution'
    const linkedWork = await request(page, `/projects/${project.id}/open-subgoals`, {
      subGoal: `Native linked MCP work ${randomUUID()}`,
      type: 'mcp.mutate',
      target: 'write_record',
    })
    assert.equal(linkedWork.status, 'open')
    assert.equal(storedOpenWork(profile, linkedWork.id).status, 'open')
    const linkedContribution = await request(page, `/projects/${project.id}/contributions`, {
      title: `Resolve ${linkedWork.subGoal}`,
      summary: 'Run the exact approved mutation and land it to resolve this work item.',
      subGoal: linkedWork.subGoal,
      workItemId: linkedWork.id,
    })
    assert.equal(linkedContribution.workItemId, linkedWork.id)
    const linkedRoute = `/projects/${project.id}/changes/${linkedContribution.id}`
    const linkedSaved = () => storedContribution(profile, linkedContribution.id)
    await page.goto(`${origin}${linkedRoute}`)
    await page.getByRole('button', { name: 'Declare effects', exact: true }).click()
    await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
    await page.getByLabel('MCP tool 1', { exact: true }).selectOption({ label: 'Native exact-call fixture · write_record' })
    const linkedArguments = { text: `Exact linked work ${linkedWork.id}` }
    await page.getByLabel('MCP arguments 1', { exact: true }).fill(JSON.stringify(linkedArguments))
    await page.getByLabel('Max acts 1', { exact: true }).fill('1')
    await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toBeVisible()
    assert.equal(peer.calls.length, 3, 'the linked work post and approved envelope do not execute the MCP tool')
    await confirmOneCall(page)
    await expect(page.locator('[data-contribution-effect-status="done"]')).toBeVisible({ timeout: TIMEOUT_MS })
    assert.deepEqual(peer.calls.at(-1), { name: 'write_record', arguments: linkedArguments })
    const readyItem = (await request(page, `/projects/${project.id}/open-subgoals`)).find(row => row.id === linkedWork.id)
    assert.equal(readyItem.status, 'open', 'a successful MCP result is evidence, not implicit resolution')
    assert.equal(storedOpenWork(profile, linkedWork.id).status, 'open', 'the real SQLite row remains open before Land')
    assert.equal(linkedSaved().status, 'open', 'the saved Contribution remains open before the separate landing act')

    await page.getByRole('button', { name: 'Land and resolve work', exact: true }).click()
    await expect(page.locator('[data-linked-work-item-resolution]')).toHaveText('This Contribution landed and resolved the linked work item.', { timeout: TIMEOUT_MS })
    const resolved = (await request(page, `/projects/${project.id}/open-subgoals`)).find(row => row.id === linkedWork.id)
    const savedResolved = storedOpenWork(profile, linkedWork.id)
    assert.equal(resolved.status, 'done')
    assert.equal(savedResolved.status, 'done', 'the owner resolution is durable in the actual SQLite store')
    assert.deepEqual(resolved.contributionResolution, savedResolved.contributionResolution)
    assert.equal(resolved.contributionResolution.contributionId, linkedContribution.id)
    assert.equal(resolved.contributionResolution.effectId, linkedSaved().effectAttempts[0].id)
    assert.equal(typeof resolved.contributionResolution.by, 'string')
    assert.equal(resolved.resolvedBy, undefined, 'human Contribution resolution never claims Commission credit')
    assert.equal(savedResolved.resolvedBy, undefined, 'SQLite keeps the Commission resolver field absent')
    assert.equal(savedResolved.resolvedByLabel, undefined)
    assert.equal(savedResolved.resolvedByOwner, undefined)
    assert.equal(linkedSaved().status, 'landed')
    assert.equal(linkedSaved().workItemResolution, undefined, 'readiness is a live projection, never stored')
    const publicLinked = (await request(page, `/projects/${project.id}/contributions`)).find(row => row.id === linkedContribution.id)
    assert.equal(publicLinked.workItemResolution, 'closed')
    assert.equal(peer.calls.length, 4, 'landing itself makes no second external call')
    await page.screenshot({ path: join(evidenceDirectory, 'linked-work-resolved.png') })

    stage = 'linked-project-work-relaunch'
    await closePackagedDesktop(run)
    run = undefined
    run = await launchPackagedDesktop(fixturePackage.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await request(page, '/me')).user.id, owner.user.id, 'the linked resolution survives a complete signed-in relaunch')
    await page.goto(`${origin}${linkedRoute}`)
    await expect(page.locator('[data-linked-work-item-resolution]')).toHaveText('This Contribution landed and resolved the linked work item.', { timeout: TIMEOUT_MS })
    assert.equal((await request(page, `/projects/${project.id}/open-subgoals`)).find(row => row.id === linkedWork.id).status, 'done')
    assert.equal(storedOpenWork(profile, linkedWork.id).status, 'done')
    assert.equal(peer.calls.length, 4, 'relaunch and rendered review never replay a completed linked effect')

    await writeFile(join(evidenceDirectory, 'evidence.json'), `${JSON.stringify({
      checkedAt: new Date().toISOString(), sourceAsarSha256: fixturePackage.sourceAsarSha256,
      fixtureAsarSha256: fixturePackage.fixtureAsarSha256, toolCalls: peer.calls.length,
      statuses: final.effectAttempts.map(row => row.status), originalPackagePublicOnly: true,
      realOsVaultAndAuthentication: true, exactRetryWithoutReplay: true,
      sharedReceiptWithoutConnectionAuthority: true, durableBackup: true,
      linkedProjectWorkResolvedBySeparateOwnerLanding: true, linkedResolutionSurvivesRelaunch: true,
      scope: 'Disposable unsigned macOS package copy: only startup allowLoopback changed for a local HTTP peer. Not production TLS/public-service, signed/notarized or Intel acceptance.',
    }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    console.log(`[desktop-contribution-mcp-smoke] exact consent · OS vault · owner/reader/foreign · SQLite · real interrupted call · signed-in relaunch without replay · backup · evidence ${evidenceDirectory}`)
  } catch (error) {
    if (run) await run.page.screenshot({ path: join(evidenceDirectory, 'failure.png') }).catch(() => {})
    throw new Error(`Packaged Contribution MCP failed at ${stage}: ${String(error.message).replaceAll(BEARER, '<redacted>')}`)
  } finally {
    try { await closePackagedDesktop(run) }
    finally {
      try { await peer?.close() }
      finally {
        try { await fixturePackage?.close() }
        finally { await rm(profile, { recursive: true, force: true }) }
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedContributionMcp()
