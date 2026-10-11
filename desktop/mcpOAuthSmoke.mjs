/** Offline packaged OAuth composition. Only a disposable ASAR copy replaces
 * DNS/socket destinations and system-browser handoff. Parsers, PKCE/callback,
 * native IPC, OS vault, child protocol, HTTP routes and durable state stay real.
 * This is not public-issuer, OS-browser, signed-release or Intel acceptance. */
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
import { startMcpOAuthSmokeFixture, MCP_OAUTH_FIXTURE_SECRET_CANARIES } from './mcpOAuthSmokeFixture.mjs'
import { MCP_CREDENTIAL_FILE } from './mcpCredentialVault.mjs'
import { startMcpOAuthMessagesSmokeFixture, MCP_OAUTH_MESSAGES_SMOKE_MODEL,
  MCP_OAUTH_MESSAGES_SMOKE_PROMPT } from './mcpOAuthMessagesSmokeFixture.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CONTRIBUTION_ARGUMENTS = Object.freeze({ query: 'native-oauth-contribution-record' })
async function captureTranscript(page, path) {
  // A visible tool card can precede its parent turn's entry animation.
  // Wait for the rendered state we review, not merely the card's existence.
  await expect.poll(() => page.evaluate(() => {
    const turns = [...document.querySelectorAll('[data-turn]')]
    return turns.length >= 2 && turns.every(turn => Number.parseFloat(getComputedStyle(turn).opacity) >= 0.99)
  })).toBe(true)
  await page.screenshot({ path, fullPage: true })
}

async function api(page, path, body, key = randomUUID()) {
  const reply = await page.evaluate(async ({ path, body, key }) => {
    const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { path, body, key })
  assert.ok(reply.status >= 200 && reply.status < 300, `${path}: HTTP ${reply.status} ${JSON.stringify(reply.body)}`)
  return reply.body
}

function persistedActivity(profile, sessionId, activityId) {
  const db = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = db.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?').get('sessions', sessionId)
    assert.ok(row, 'the actual SQLite conversation exists')
    const activities = JSON.parse(row.json).messages.flatMap(message => message.toolActivities ?? [])
    const matches = activities.filter(activity => activity.id === activityId)
    assert.equal(matches.length, 1, 'the exact persisted activity is unambiguous')
    const authorities = db.prepare('SELECT json FROM entities WHERE slice = ?').all('mcpActivityAuthorities')
      .map(entry => JSON.parse(entry.json)).filter(entry => entry.sessionId === sessionId && entry.activityId === activityId)
    assert.equal(authorities.length, 1, 'the native call retains exactly one private person anchor')
    return { activity: matches[0], authority: authorities[0] }
  } finally { db.close() }
}

function persistedContribution(profile, contributionId) {
  const db = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = db.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?').get('contributions', contributionId)
    assert.ok(row, 'the exact Contribution exists in the actual SQLite store')
    return JSON.parse(row.json)
  } finally { db.close() }
}

/** The native acceptance oracle checks actual private SQLite data against the
 * public receipt, including one remaining act that still requires new consent. */
export function assertOAuthContributionReceipt(stored, current, { tenantId, ownerUserId, connectionId, canRun = true }) {
  assert.equal(stored.effectAttempts.length, 1, 'exactly one Contribution call is retained')
  assert.equal(stored.envelope.lines.length, 1)
  const line = stored.envelope.lines[0]
  const attempt = stored.effectAttempts[0]
  assert.deepEqual(line.mcpAuthority, { tenantId, ownerUserId, call: attempt.call }, 'the envelope and receipt retain the exact person-bound call')
  assert.equal(attempt.ownerUserId, ownerUserId, 'the durable receipt retains its private OAuth owner')
  assert.equal(attempt.tenantId, tenantId)
  assert.equal(attempt.projectId, stored.projectId)
  assert.equal(attempt.contributionId, stored.id)
  assert.equal(attempt.envelopeVersion, 1)
  assert.equal(stored.envelope.version, 1)
  assert.equal(stored.envelope.approvedVersion, 1)
  assert.equal(attempt.lineId, line.id)
  assert.equal(attempt.status, 'done')
  assert.equal(line.cardinality, 2)
  assert.equal(line.used, 1, 'the unused act is not executed automatically')
  assert.match(attempt.callHash, /^[a-f0-9]{64}$/)
  assert.match(attempt.call.schemaHash, /^[a-f0-9]{64}$/)
  assert.ok(Number.isSafeInteger(attempt.call.connectionRevision) && attempt.call.connectionRevision >= 0)
  assert.deepEqual(attempt.call, { connectionId, connectionRevision: attempt.call.connectionRevision,
    toolName: 'records.search', schemaHash: attempt.call.schemaHash, arguments: CONTRIBUTION_ARGUMENTS })
  assert.deepEqual(attempt.result, { resultType: 'complete', isError: false,
    content: [{ type: 'text', text: `Fixture record for ${CONTRIBUTION_ARGUMENTS.query}` }],
    structuredContent: { query: CONTRIBUTION_ARGUMENTS.query, record: 'fixture-record-1' } })
  assert.equal(current.id, stored.id)
  assert.equal(current.projectId, stored.projectId)
  assert.deepEqual(current.effects, [{ id: attempt.id, envelopeVersion: attempt.envelopeVersion, lineId: line.id,
    actor: attempt.actor, connectionLabel: attempt.connectionLabel, toolName: attempt.call.toolName,
    arguments: CONTRIBUTION_ARGUMENTS, startedAt: attempt.startedAt, status: 'done',
    finishedAt: attempt.finishedAt, summary: attempt.summary, result: attempt.result }], 'the public receipt is exact and contains no private authority')
  assert.equal(current.envelope.lines.length, 1)
  assert.equal(current.envelope.lines[0].used, 1)
  assert.deepEqual(current.envelope.lines[0].mcp, { connectionLabel: 'Native OAuth fixture', toolName: 'records.search',
    arguments: CONTRIBUTION_ARGUMENTS, ...(canRun ? { canRun: true } : {}) })
  const publicHistory = JSON.stringify({ envelope: current.envelope, effects: current.effects })
  for (const privateValue of [ownerUserId, connectionId, ...MCP_OAUTH_FIXTURE_SECRET_CANARIES]) {
    assert.equal(publicHistory.includes(privateValue), false, 'private OAuth identity and credentials never enter shared Contribution history')
  }
  for (const privateField of ['mcpAuthority', 'ownerUserId', 'callHash', 'credentialReference']) {
    assert.equal(publicHistory.includes(`"${privateField}"`), false, `${privateField} remains private`)
  }
}

async function executeContributionCall({ page, origin, profile, evidence, fixture, identity, connectionId }) {
  const { project } = await api(page, '/projects', { name: 'Native OAuth Contribution', description: '' })
  const contribution = await api(page, `/projects/${project.id}/contributions`, {
    title: 'Read one separately approved OAuth record', summary: 'One explicit call, with one act left for a future confirmation.',
  })
  const path = `/projects/${project.id}/contributions/${contribution.id}`
  const route = `/projects/${project.id}/changes/${contribution.id}`
  const authority = { tenantId: identity.tenant.id, ownerUserId: identity.user.id, connectionId }
  await page.goto(`${origin}${route}`)
  await page.getByRole('button', { name: 'Declare effects', exact: true }).click()
  await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
  await page.getByLabel('MCP tool 1', { exact: true }).selectOption({ label: 'Native OAuth fixture · records.search' })
  await page.getByLabel('MCP arguments 1', { exact: true }).fill(JSON.stringify(CONTRIBUTION_ARGUMENTS))
  await page.getByLabel('Max acts 1', { exact: true }).fill('2')
  await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  assert.equal(fixture.snapshot().counts.mcpCalls, 1, 'proposing a Contribution leaves only the earlier interactive call')
  assert.equal(persistedContribution(profile, contribution.id).envelope.lines[0].mcpAuthority.ownerUserId, identity.user.id)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toBeVisible()
  assert.equal(fixture.snapshot().counts.mcpCalls, 1, 'envelope approval grants no execution')
  await page.getByRole('button', { name: 'Review & run', exact: true }).click()
  const consent = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
  await expect(consent).toContainText('visible to every Project reader')
  await expect(consent).toContainText('credentials stay private')
  await expect(consent).toContainText('running again may duplicate')
  await expect(page.getByLabel('Approved arguments for records.search', { exact: true })).toContainText(CONTRIBUTION_ARGUMENTS.query)
  assert.equal(fixture.snapshot().counts.mcpCalls, 1, 'opening the separate Run confirmation never dispatches')
  await consent.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'contribution-consent.png') })
  const outgoing = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1${path}/effects`)
  await consent.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
  const request = await outgoing
  const key = request.headers()['idempotency-key']
  const body = request.postDataJSON()
  assert.ok(key, 'rendered Contribution Run has an exact durable retry identity')
  const card = page.locator('[data-contribution-effect-status="done"]')
  await expect(card).toContainText(`Fixture record for ${CONTRIBUTION_ARGUMENTS.query}`, { timeout: 30_000 })
  const completed = (await api(page, `/projects/${project.id}/contributions`)).find(row => row.id === contribution.id)
  assert.ok(completed)
  const stored = persistedContribution(profile, contribution.id)
  assertOAuthContributionReceipt(stored, completed, authority)
  assert.deepEqual(body, { lineId: stored.envelope.lines[0].id, expectedVersion: 1 })
  const calls = fixture.snapshot().requests.filter(request => request.headers['mcp-method'] === 'tools/call')
  assert.equal(calls.length, 2, 'one interactive call and one Contribution call were separately confirmed')
  assert.deepEqual(calls.map(request => {
    const params = JSON.parse(request.body).params
    return { name: params.name, arguments: params.arguments }
  }), [
    { name: 'records.search', arguments: { query: 'native-oauth-approved-record' } },
    { name: 'records.search', arguments: CONTRIBUTION_ARGUMENTS },
  ])
  await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'contribution-result.png') })
  return { id: contribution.id, path, route, key, body, completed, stored, authority }
}

async function prepareInteractiveCall(page, origin, model, connectionId) {
  const provider = await api(page, '/providers', { label: 'OAuth local model', modelFamily: 'claude',
    effortLevels: ['Low'], models: [{ id: MCP_OAUTH_MESSAGES_SMOKE_MODEL, label: 'OAuth smoke fixture' }],
    config: { baseURL: model.origin, model: MCP_OAUTH_MESSAGES_SMOKE_MODEL } })
  const session = await api(page, '/sessions', { providerId: provider.id, modelId: MCP_OAUTH_MESSAGES_SMOKE_MODEL })
  await page.goto(`${origin}/s/${session.id}`)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^MCP server/ }).click()
  const choice = picker.getByRole('button', { name: /Native OAuth fixture/ })
  await expect(choice).toContainText('Approval required for every call')
  await choice.click()
  await expect(page.getByTitle('Open in sidebar').filter({ hasText: 'Native OAuth fixture' })).toBeVisible()
  if (await picker.isVisible()) await picker.getByRole('button', { name: 'Done', exact: true }).click()
  const contexts = await api(page, `/sessions/${session.id}/contexts`)
  assert.ok(contexts.some(context => context.id === connectionId), 'rendered attachment reached the exact owner-filtered backend binding')
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill(MCP_OAUTH_MESSAGES_SMOKE_PROMPT)
  await composer.press('Enter')
  const card = page.locator('[data-mcp-tool-status="proposed"]').filter({ hasText: 'records.search' })
  await expect(card.getByRole('button', { name: 'Run tool', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(card).toContainText('"query": "native-oauth-approved-record"')
  await expect(card).toContainText('Approval applies only to this call')
  const saved = await api(page, `/sessions/${session.id}`)
  const proposed = saved.messages.flatMap(message => message.toolActivities ?? []).filter(activity => activity.status === 'proposed')
  assert.equal(proposed.length, 1)
  assert.equal(proposed[0].connectorId, connectionId)
  assert.equal(model.requests.length, 2, 'the real model loop staged consent and completed its truthful pending reply')
  assert.ok(saved.messages.some(message => message.role === 'assistant' &&
    message.content.includes('awaiting your approval; it has not run yet.')))
  return { sessionId: session.id, activity: proposed[0], card }
}

export function oauthSmokePatches(origin) {
  const url = new URL(origin)
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.protocol, 'http:')
  assert.equal(url.origin, origin)
  const local = JSON.stringify(origin)
  const socket = `(url, options, callback) => fixtureHttpRequest(new URL(url.pathname + url.search, ${local}), { ...options, lookup: undefined }, callback)`
  return [
    { path: 'desktop/mcpOAuthHttp.mjs', before: "import { request as httpsRequest } from 'node:https'",
      after: "import { request as fixtureHttpRequest } from 'node:http'" },
    { path: 'desktop/mcpOAuthHttp.mjs', before: 'resolve = host => lookup(host, { all: true, verbatim: true }), request = httpsRequest',
      after: `resolve = async () => [{ address: '8.8.8.8', family: 4 }], request = ${socket}` },
    { path: 'server/mcpHttpTransport.ts', before: "import { request as httpsRequest } from 'node:https'",
      after: "import { request as fixtureHttpRequest } from 'node:http'" },
    { path: 'server/mcpHttpTransport.ts', before: 'resolve = (host: string): Promise<Address[]> => lookup(host, { all: true, verbatim: true }),',
      after: "resolve = async () => [{ address: '8.8.8.8', family: 4 }]," },
    { path: 'server/mcpHttpTransport.ts', before: 'https = httpsRequest,', after: `https = ${socket},` },
    { path: 'desktop/main.mjs', before: 'openBrowser: url => shell.openExternal(url),',
      after: `openBrowser: async raw => {
        const url = new URL(raw)
        const response = await fetch(new URL(url.pathname + url.search, ${local}), { redirect: 'manual' })
        if (response.status !== 302) throw new Error('Fixture browser handoff failed')
        const callback = new URL(response.headers.get('location'))
        if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1') throw new Error('Fixture callback refused')
        if (!(await fetch(callback)).ok) throw new Error('Fixture callback failed')
      },` },
  ]
}

async function assertPrivateStorage(profile, canaries) {
  const vaultBytes = await readFile(join(profile, MCP_CREDENTIAL_FILE))
  const vault = JSON.parse(vaultBytes)
  assert.equal(Object.keys(vault.entries).length, 1, 'only the bound OAuth grant is retained')
  for (const file of [MCP_CREDENTIAL_FILE, 'store.db', 'store.db-wal', 'store.db-shm']) {
    const bytes = await readFile(join(profile, file)).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error })
    for (const canary of canaries) assert.equal(bytes.includes(Buffer.from(canary)), false, `raw OAuth tokens absent from ${file}`)
  }
}

export async function smokePackagedMcpOAuth({ executable = packagedExecutable() } = {}) {
  if (process.platform !== 'darwin') throw new Error('Packaged OAuth acceptance requires macOS')
  const profile = await mkdtemp(join(tmpdir(), 'ac-native-oauth-smoke-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-oauth-smoke')
  await mkdir(evidenceRoot, { recursive: true })
  const evidence = await mkdtemp(join(evidenceRoot, 'run-'))
  let fixture, model, copied, run
  let stage = 'startup'
  try {
    fixture = await startMcpOAuthSmokeFixture()
    copied = await createMcpFixturePackage(executable, oauthSmokePatches(fixture.origin))
    run = await launchPackagedDesktop(copied.executable, profile)
    let { page, origin } = run
    const identity = await api(page, '/auth/signup', { name: 'Native OAuth owner',
      email: `native-oauth-${randomUUID()}@example.test`, password: 'isolated-native-oauth-password' })
    await page.reload()
    const catalog = await api(page, '/mcp-connections')
    assert.equal(catalog.capabilities.deviceOAuthCredentials, true, 'native storage synchronization admits OAuth')
    assert.equal(await page.evaluate(() => typeof window.agentCommonsDesktop?.mcpOAuth?.start), 'function')
    stage = 'rendered-review'
    await page.goto(`${origin}/contexts`)
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    await page.getByRole('dialog', { name: 'Add context', exact: true }).getByRole('button', { name: 'Add an MCP server' }).click()
    const create = page.getByRole('dialog', { name: 'Add an MCP server', exact: true })
    await create.getByLabel('Name').fill('Native OAuth fixture')
    await create.getByLabel('Server URL').fill(fixture.resource)
    await create.getByLabel('Authentication').selectOption('device-oauth')
    await create.getByRole('button', { name: 'Save server', exact: true }).click()
    await page.getByRole('main').getByRole('button', { name: 'Native OAuth fixture', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Native OAuth fixture', exact: true })).toBeVisible()
    const detailPath = new URL(page.url()).pathname
    const id = new URL(page.url()).pathname.split('/').at(-1)
    await page.getByRole('button', { name: 'Sign in with OAuth', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Sign in to Native OAuth fixture', exact: true })
    await review.getByRole('button', { name: 'Find sign-in options', exact: true }).click()
    await review.getByLabel('Authorization server').selectOption(fixture.issuer)
    await review.getByRole('button', { name: 'Review access request', exact: true }).click()
    const readScope = review.getByRole('checkbox', { name: 'records:read · suggested by server', exact: true })
    await expect(readScope).toHaveAttribute('aria-checked', 'false')
    await readScope.click()
    await expect(readScope).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: join(evidence, 'scope-review.png'), fullPage: true })
    stage = 'native-callback-and-inspection'
    await review.getByRole('button', { name: 'Continue to browser sign-in', exact: true }).click()
    await expect(review).toHaveCount(0, { timeout: 30_000 })
    const detail = await api(page, `/mcp-connections/${id}`)
    assert.equal(detail.status, 'connected')
    assert.equal(detail.tools.length, 1)
    await assertPrivateStorage(profile, MCP_OAUTH_FIXTURE_SECRET_CANARIES)
    assert.equal(fixture.snapshot().counts.codes, 1, 'one browser authorization is redeemed')
    assert.equal(fixture.snapshot().counts.refreshes, 0)
    assert.equal(fixture.snapshot().counts.mcpCalls, 0, 'sign-in/inspection grants no tool-call consent')
    await page.screenshot({ path: join(evidence, 'connected.png'), fullPage: true })

    stage = 'full-native-relaunch'
    await closePackagedDesktop(run); run = undefined
    run = await launchPackagedDesktop(copied.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, identity.user.id)
    assert.equal((await api(page, `/mcp-connections/${id}`)).status, 'connected')
    await assertPrivateStorage(profile, MCP_OAUTH_FIXTURE_SECRET_CANARIES)
    stage = 'saved-grant-refresh-and-disconnect'
    // Wait for this fixture's deliberately short-lived grant, not a retry of
    // an external request. Refresh is exercised by one explicit catalog act.
    const expireAt = Date.now() + 61_000
    while (Date.now() < expireAt) await new Promise(resolve => setTimeout(resolve, Math.min(1_000, expireAt - Date.now())))
    await page.goto(`${origin}${detailPath}`)
    await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
    const inspection = page.getByRole('dialog', { name: 'Inspect MCP server', exact: true })
    await inspection.getByRole('button', { name: 'Inspect catalog', exact: true }).click()
    await expect(inspection).toHaveCount(0, { timeout: 30_000 })
    await expect.poll(async () => (await api(page, `/mcp-connections/${id}`)).revision).toBeGreaterThan(detail.revision)
    assert.equal(fixture.snapshot().counts.codes, 1, 'relaunch and refresh do not reopen authorization')
    assert.equal(fixture.snapshot().counts.refreshes, 1, 'one explicit catalog act resolves one refreshed native grant')
    assert.equal(fixture.snapshot().counts.mcpCalls, 0)
    await assertPrivateStorage(profile, MCP_OAUTH_FIXTURE_SECRET_CANARIES)

    stage = 'model-proposal-and-explicit-tool-consent'
    model = await startMcpOAuthMessagesSmokeFixture()
    const proposed = await prepareInteractiveCall(page, origin, model, id)
    assert.equal(fixture.snapshot().counts.mcpCalls, 0, 'a model proposal and attachment still grant no tool consent')
    const pending = persistedActivity(profile, proposed.sessionId, proposed.activity.id)
    assert.equal(pending.activity.status, 'proposed')
    assert.deepEqual(pending.authority, { sessionId: proposed.sessionId, activityId: proposed.activity.id,
      connectionId: id, tenantId: identity.tenant.id, ownerUserId: identity.user.id })
    assert.equal(JSON.stringify(proposed.activity).includes(identity.user.id), false, 'the public card does not expose its private owner')
    await captureTranscript(page, join(evidence, 'tool-consent.png'))
    const decisionPath = `/sessions/${proposed.sessionId}/tool-activities/${proposed.activity.id}`
    const decisionRequest = page.waitForRequest(request => request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/v1${decisionPath}`)
    await proposed.card.getByRole('button', { name: 'Run tool', exact: true }).click()
    const decision = await decisionRequest
    const decisionKey = decision.headers()['idempotency-key']
    assert.ok(decisionKey, 'rendered consent uses a durable exact decision identity')
    assert.deepEqual(decision.postDataJSON(), { decision: 'confirm' })
    const doneCard = page.locator('[data-mcp-tool-status="done"]').filter({ hasText: 'records.search' })
    await expect(doneCard).toContainText('Fixture record for native-oauth-approved-record', { timeout: 30_000 })
    const calls = fixture.snapshot().requests.filter(request => request.headers['mcp-method'] === 'tools/call')
    assert.equal(calls.length, 1, 'only the separately confirmed exact call was dispatched')
    assert.deepEqual(JSON.parse(calls[0].body).params.arguments, { query: 'native-oauth-approved-record' })
    assert.equal(JSON.parse(calls[0].body).params.name, 'records.search')
    const completed = persistedActivity(profile, proposed.sessionId, proposed.activity.id)
    assert.equal(completed.activity.status, 'done')
    assert.ok(completed.activity.mcpResult, 'the exact tool result is durable in the activity contract')
    assert.deepEqual(completed.activity.mcpResult.structuredContent, { query: 'native-oauth-approved-record', record: 'fixture-record-1' })
    assert.deepEqual(completed.authority, pending.authority)
    for (const canary of MCP_OAUTH_FIXTURE_SECRET_CANARIES) {
      assert.equal(JSON.stringify(model.requests).includes(canary), false, 'OAuth tokens never enter the model request')
      assert.equal(JSON.stringify(await api(page, `/sessions/${proposed.sessionId}`)).includes(canary), false, 'OAuth tokens never enter the public transcript')
    }
    await assertPrivateStorage(profile, MCP_OAUTH_FIXTURE_SECRET_CANARIES)
    await captureTranscript(page, join(evidence, 'tool-result.png'))

    stage = 'contribution-proposal-approval-and-separate-run'
    const contribution = await executeContributionCall({ page, origin, profile, evidence, fixture, identity, connectionId: id })
    assert.equal(model.requests.length, 2, 'Contribution approval and Run add no model calls')
    await assertPrivateStorage(profile, MCP_OAUTH_FIXTURE_SECRET_CANARIES)

    stage = 'tool-and-contribution-receipt-relaunch-and-exact-replay'
    await closePackagedDesktop(run); run = undefined
    run = await launchPackagedDesktop(copied.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, identity.user.id)
    assert.deepEqual(persistedActivity(profile, proposed.sessionId, proposed.activity.id), completed)
    await page.goto(`${origin}/s/${proposed.sessionId}`)
    await expect(page.locator('[data-mcp-tool-status="done"]')).toContainText('Fixture record for native-oauth-approved-record')
    const replay = await api(page, decisionPath, { decision: 'confirm' }, decisionKey)
    assert.deepEqual(replay, completed.activity, 'a lost response reconciles the exact durable receipt after full restart')
    assert.equal(fixture.snapshot().counts.mcpCalls, 2, 'neither relaunch nor exact interactive receipt replay dispatches again')
    await captureTranscript(page, join(evidence, 'tool-result-relaunched.png'))

    await page.goto(`${origin}${contribution.route}`)
    const contributionCard = page.locator('[data-contribution-effect-status="done"]')
    await expect(contributionCard).toContainText(`Fixture record for ${CONTRIBUTION_ARGUMENTS.query}`)
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toBeVisible()
    const contributionReplay = await api(page, `${contribution.path}/effects`, contribution.body, contribution.key)
    assert.deepEqual(contributionReplay.effects, contribution.completed.effects, 'exact Contribution replay returns the saved receipt after restart')
    assert.deepEqual(persistedContribution(profile, contribution.id), contribution.stored, 'private owner, call and result survive full relaunch unchanged')
    assertOAuthContributionReceipt(persistedContribution(profile, contribution.id), contributionReplay, contribution.authority)
    assert.equal(fixture.snapshot().counts.mcpCalls, 2, 'remaining cardinality and exact Contribution replay grant no automatic dispatch')
    await contributionCard.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, 'contribution-result-relaunched.png') })

    stage = 'disconnect-after-tool-and-contribution-receipts'
    await page.goto(`${origin}${detailPath}`)
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect.poll(async () => (await api(page, `/mcp-connections/${id}`)).status).toBe('disconnected')
    await expect.poll(async () => Object.keys(JSON.parse(await readFile(join(profile, MCP_CREDENTIAL_FILE), 'utf8')).entries).length).toBe(0)
    await page.screenshot({ path: join(evidence, 'disconnected.png'), fullPage: true })
    assert.deepEqual(await api(page, decisionPath, { decision: 'confirm' }, decisionKey), completed.activity)
    const disconnectedContribution = await api(page, `${contribution.path}/effects`, contribution.body, contribution.key)
    assert.deepEqual(disconnectedContribution.effects, contribution.completed.effects)
    assert.deepEqual(persistedContribution(profile, contribution.id), contribution.stored)
    assertOAuthContributionReceipt(persistedContribution(profile, contribution.id), disconnectedContribution, { ...contribution.authority, canRun: false })
    await page.goto(`${origin}${contribution.route}`)
    await expect(page.locator('[data-contribution-effect-status="done"]')).toContainText(`Fixture record for ${CONTRIBUTION_ARGUMENTS.query}`)
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await page.locator('[data-contribution-effect-status="done"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, 'contribution-result-disconnected.png') })
    assert.equal(fixture.snapshot().counts.mcpCalls, 2, 'disconnect preserves both receipts without granting another dispatch')
    console.log('[desktop-oauth-smoke] reviewed scopes · real PKCE/callback · OS vault · refresh · rendered attach/model proposal/separate consent · Contribution proposal/separate approval/Run · two exact separately confirmed MCP calls · private SQLite owners + results · signed-in relaunch and exact receipt replays without redispatch · disconnect retains receipts and removes Run')
    console.log(`[desktop-oauth-smoke] evidence ${evidence}`)
  } catch (error) {
    if (model) console.error('[desktop-oauth-smoke] model evidence', JSON.stringify({ accepted: model.requests.length,
      probes: model.probes.length, rejected: model.rejected }))
    await run?.page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {})
    throw new Error(`Packaged OAuth acceptance failed at ${stage}`, { cause: error })
  } finally {
    await closePackagedDesktop(run)
    await copied?.close()
    await model?.close()
    await fixture?.close()
    await rm(profile, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedMcpOAuth()
