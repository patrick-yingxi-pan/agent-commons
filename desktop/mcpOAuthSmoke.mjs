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
import { startMcpOAuthSmokeFixture, MCP_OAUTH_FIXTURE_SECRET_CANARIES, MCP_OAUTH_FORM_QUERY,
  MCP_OAUTH_FORM_STATE, MCP_OAUTH_FORM_ANSWER, MCP_OAUTH_FORM_MESSAGE } from './mcpOAuthSmokeFixture.mjs'
import { MCP_CREDENTIAL_FILE } from './mcpCredentialVault.mjs'
import { startMcpOAuthMessagesSmokeFixture, MCP_OAUTH_MESSAGES_SMOKE_MODEL,
  MCP_OAUTH_MESSAGES_SMOKE_PROMPT } from './mcpOAuthMessagesSmokeFixture.mjs'
import { startMcpOAuthRoutineMessagesSmokeFixture, MCP_OAUTH_ROUTINE_MODEL, MCP_OAUTH_ROUTINE_PROMPT,
  MCP_OAUTH_ROUTINE_ARGUMENTS, MCP_OAUTH_ROUTINE_RESULT, MCP_OAUTH_ROUTINE_FINAL_TEXT,
} from './mcpOAuthRoutineMessagesSmokeFixture.mjs'
import { runSessionId } from '../contract/ids.ts'

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

async function api(page, path, body, key = randomUUID(), method = body === undefined ? 'GET' : 'POST') {
  const reply = await page.evaluate(async ({ path, body, key, method }) => {
    const response = await fetch(`/api/v1${path}`, { method,
      headers: { 'content-type': 'application/json', 'idempotency-key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { path, body, key, method })
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

function persistedInputFlow(profile, sessionId, decisionId) {
  const db = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const flows = db.prepare('SELECT json FROM entities WHERE slice = ?').all('mcpInputFlows')
      .map(row => JSON.parse(row.json)).filter(row => row.sessionId === sessionId && row.decisionId === decisionId)
    assert.equal(flows.length, 1, 'the exact private MCP form flow exists in actual SQLite')
    return flows[0]
  } finally { db.close() }
}

/** Feature-specific mode reuses the same real native custody and product path.
 * A bounded opt-in peer asks once; a lost HTTP acknowledgement is not a retry. */
async function smokePrivateInput({ initialRun, relaunch, profile, evidence, fixture, model, identity, connectionId }) {
  let { page, origin } = initialRun
  const proposed = await prepareInteractiveCall(page, origin, model, connectionId)
  const decisionPath = `/sessions/${proposed.sessionId}/tool-activities/${proposed.activity.id}`
  const inputPath = `${decisionPath}/input`
  const protocolCalls = () => fixture.snapshot().requests.filter(row => row.headers['mcp-method'] === 'tools/call')
  assert.equal(protocolCalls().length, 0)
  await proposed.card.getByRole('button', { name: 'Run tool', exact: true }).click()
  await expect(page.locator('[data-mcp-input-review]')).toHaveAttribute('data-mcp-input-round', '1', { timeout: 30_000 })
  const waiting = persistedActivity(profile, proposed.sessionId, proposed.activity.id)
  assert.equal(waiting.activity.status, 'awaiting-input')
  const decisionId = waiting.activity.decisionId
  const flow = persistedInputFlow(profile, proposed.sessionId, decisionId)
  assert.equal(flow.ownerUserId, identity.user.id)
  assert.equal(flow.tenantId, identity.tenant.id)
  assert.equal(flow.round, 1)
  assert.equal(flow.pending.requestState, MCP_OAUTH_FORM_STATE)
  assert.deepEqual(flow.receipts, [])
  const sharedSession = await api(page, `/sessions/${proposed.sessionId}`)
  assert.equal(JSON.stringify(waiting.activity).includes(identity.user.id), false, 'public activity omits its private person anchor')
  for (const hidden of [MCP_OAUTH_FORM_STATE, MCP_OAUTH_FORM_MESSAGE, MCP_OAUTH_FORM_ANSWER]) {
    const encoded = JSON.stringify(hidden).slice(1, -1)
    assert.equal(JSON.stringify(waiting.activity).includes(encoded), false, 'public activity omits private form state')
    assert.equal(JSON.stringify(sharedSession).includes(encoded), false)
  }
  assert.equal(protocolCalls().length, 1)
  await captureTranscript(page, join(evidence, 'private-form-awaiting.png'))

  ;({ page, origin } = await relaunch())
  assert.equal((await api(page, '/me')).user.id, identity.user.id)
  await page.goto(`${origin}/s/${proposed.sessionId}`)
  const review = page.locator('[data-mcp-input-review]')
  await expect(review).toHaveAttribute('data-mcp-input-round', '1', { timeout: 30_000 })
  assert.deepEqual(persistedInputFlow(profile, proposed.sessionId, decisionId), flow)
  assert.deepEqual(persistedActivity(profile, proposed.sessionId, proposed.activity.id), waiting)
  assert.equal(protocolCalls().length, 1, 'waiting review relaunch cannot resubmit its tool')
  await captureTranscript(page, join(evidence, 'private-form-relaunched.png'))

  const inputRequests = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith(`/api/v1${inputPath}`)) inputRequests.push({
      method: request.method(), path: new URL(request.url()).pathname + new URL(request.url()).search,
      ...(request.method() === 'POST' ? { body: request.postDataJSON() } : {}),
    })
  })
  let lostAcknowledgements = 0
  await page.route(url => url.pathname === `/api/v1${inputPath}`, async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    const headers = { ...route.request().headers() }; delete headers.origin
    const response = await route.fetch({ headers })
    assert.equal(response.status(), 200, 'the real response commits before transport loss')
    lostAcknowledgements += 1
    await route.abort()
  })
  await review.getByLabel('Review note (required)', { exact: true }).fill(MCP_OAUTH_FORM_ANSWER)
  await review.getByLabel('Approve this response (required)', { exact: true }).selectOption('true')
  await review.getByRole('button', { name: 'Continue with responses', exact: true }).click()
  const recovery = page.locator('[data-mcp-input-recovery]')
  await expect(page.locator('[data-mcp-input-attempt="receipt"]')).toBeVisible({ timeout: 30_000 })
  assert.equal(lostAcknowledgements, 1)
  const submissions = inputRequests.filter(row => row.method === 'POST')
  assert.equal(submissions.length, 1, 'automatic and explicit recovery never rePOST the reviewed response')
  const command = submissions[0].body
  assert.deepEqual(command.responses, { review: { action: 'accept', content: { note: MCP_OAUTH_FORM_ANSWER, approved: true } } })
  assert.equal(command.decisionId, decisionId)
  assert.equal(command.round, 1)
  const receiptPath = `${inputPath}/receipts/${command.responseId}?decisionId=${encodeURIComponent(decisionId)}`
  // The recovery command loads lazily: the existing receipt can still be
  // visible immediately after click. Await this exact new read, not old UI.
  const checking = page.waitForResponse(response => response.request().method() === 'GET' &&
    new URL(response.url()).pathname + new URL(response.url()).search === `/api/v1${receiptPath}`)
  await recovery.getByRole('button', { name: 'Check status', exact: true }).click()
  const checked = await checking
  assert.equal(checked.status(), 200)
  assert.equal((await checked.json()).activity.status, 'done')
  await expect(page.locator('[data-mcp-input-attempt="receipt"]')).toBeVisible()
  await expect.poll(() => inputRequests.filter(row => row.method === 'GET' && row.path === `/api/v1${receiptPath}`).length,
    { message: 'both lost-acknowledgement recovery and Check status read the exact receipt' }).toBe(2)
  assert.equal(inputRequests.filter(row => row.method === 'POST').length, 1, 'Check status never rePOSTs')
  const completedReceipt = await api(page, receiptPath)
  assert.equal(completedReceipt.activity.status, 'done')
  const completed = persistedActivity(profile, proposed.sessionId, proposed.activity.id)
  const completedFlow = persistedInputFlow(profile, proposed.sessionId, decisionId)
  assert.equal(completed.activity.status, 'done')
  assert.equal(completedFlow.pending, undefined)
  assert.equal(completedFlow.receipts.length, 1)
  assert.deepEqual(Object.keys(completedFlow.receipts[0]).sort(), ['action', 'payloadHash', 'responseId', 'round'])
  assert.equal(completedFlow.receipts[0].responseId, command.responseId)
  assert.match(completedFlow.receipts[0].payloadHash, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(completedFlow).includes(MCP_OAUTH_FORM_ANSWER), false)
  const calls = protocolCalls().map(row => JSON.parse(row.body))
  assert.equal(calls.length, 2)
  assert.notEqual(calls[0].id, calls[1].id)
  assert.deepEqual(calls[0].params.arguments, { query: MCP_OAUTH_FORM_QUERY })
  assert.deepEqual(calls[1].params.arguments, calls[0].params.arguments)
  assert.equal(calls[1].params.requestState, MCP_OAUTH_FORM_STATE)
  assert.deepEqual(calls[1].params.inputResponses, command.responses)
  assert.deepEqual(calls[1].params._meta['io.modelcontextprotocol/clientCapabilities'], { elicitation: { form: {} } })
  for (const file of ['store.db', 'store.db-wal', 'store.db-shm']) {
    const bytes = await readFile(join(profile, file)).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error })
    assert.equal(bytes.includes(Buffer.from(MCP_OAUTH_FORM_ANSWER)), false, `private answers never persist in ${file}`)
  }
  assert.equal(JSON.stringify(model.requests).includes(MCP_OAUTH_FORM_ANSWER), false)
  assert.equal(JSON.stringify(await api(page, `/sessions/${proposed.sessionId}`)).includes(MCP_OAUTH_FORM_ANSWER), false)
  await recovery.getByRole('button', { name: 'Review latest', exact: true }).click()
  await expect(recovery).toHaveCount(0)
  await expect(page.locator('[data-mcp-tool-status="done"]')).toContainText(`Fixture record for ${MCP_OAUTH_FORM_QUERY}`)
  await captureTranscript(page, join(evidence, 'private-form-result.png'))

  ;({ page, origin } = await relaunch())
  assert.equal((await api(page, '/me')).user.id, identity.user.id)
  assert.deepEqual(persistedActivity(profile, proposed.sessionId, proposed.activity.id), completed)
  assert.deepEqual(persistedInputFlow(profile, proposed.sessionId, decisionId), completedFlow)
  assert.deepEqual(await api(page, receiptPath), completedReceipt)
  await page.goto(`${origin}/s/${proposed.sessionId}`)
  await expect(page.locator('[data-mcp-tool-status="done"]')).toContainText(`Fixture record for ${MCP_OAUTH_FORM_QUERY}`)
  await expect(page.locator('[data-mcp-input-review]')).toHaveCount(0)
  assert.equal(protocolCalls().length, 2, 'completed relaunch and exact receipt GET do not dispatch another call')
  assert.equal(model.requests.length, 2, 'form review and recovery never invoke the model')
  await assertPrivateStorage(profile, MCP_OAUTH_FIXTURE_SECRET_CANARIES)
  await captureTranscript(page, join(evidence, 'private-form-result-relaunched.png'))
}

function persistedContribution(profile, contributionId) {
  const db = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = db.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?').get('contributions', contributionId)
    assert.ok(row, 'the exact Contribution exists in the actual SQLite store')
    return JSON.parse(row.json)
  } finally { db.close() }
}

function persistedRoutineMcp(profile, routineId) {
  const db = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = db.prepare('SELECT json FROM kv WHERE key = ?').get('routineMcp')
    assert.ok(row, 'the actual SQLite private Routine MCP slice exists')
    const state = JSON.parse(row.json)
    return { policies: state.policies.filter(item => item.routineId === routineId),
      runs: state.runs.filter(item => item.permission.routineId === routineId), decisions: state.decisions.filter(item => item.routineId === routineId) }
  } finally { db.close() }
}

/** Compare the actual private ledger, owner-only public review, and ordinary
 * delivered output. A remaining slot is evidence of bounded authority, not an
 * instruction for the model or scheduler to spend it. */
export function assertOAuthRoutineReceipt(stored, current, output, { tenantId, ownerUserId, connectionId, routineId, revoked = false }) {
  assert.equal(stored.policies.length, 1)
  assert.equal(stored.runs.length, 1, 'only one queued Routine run exists')
  assert.equal(stored.decisions.length, revoked ? 2 : 1)
  const policy = stored.policies[0], run = stored.runs[0], receipt = run.calls[0]
  const oauthAuthority = { ownerUserId, connectionIds: [connectionId] }
  for (const permission of [policy, run.permission]) {
    assert.equal(permission.tenantId, tenantId)
    assert.equal(permission.routineId, routineId)
    assert.deepEqual(permission.oauthAuthority, oauthAuthority, 'live and frozen authority retain the exact approving person')
  }
  for (const [index, decision] of stored.decisions.entries()) {
    assert.equal(decision.tenantId, tenantId)
    assert.equal(decision.routineId, routineId)
    assert.deepEqual(decision.oauthAuthority, oauthAuthority)
    assert.equal(decision.actorUserId, ownerUserId, 'the actual approving/revoking actor is privately retained')
    assert.equal(decision.action, index === 0 ? 'approve' : 'revoke')
    assert.equal(decision.policyRevision, index + 1)
  }
  assert.equal(policy.policy.revision, revoked ? 2 : 1)
  assert.equal(run.permission.policy.revision, 1)
  assert.equal(run.permission.policy.approval.maxCallsPerRun, 2)
  assert.equal(run.calls.length, 1, 'one remaining slot never dispatches itself')
  assert.equal(run.phase, 'active')
  assert.equal(receipt.status, 'done')
  assert.match(run.permissionHash, /^[a-f0-9]{64}$/)
  assert.match(receipt.callHash, /^[a-f0-9]{64}$/)
  assert.match(receipt.call.schemaHash, /^[a-f0-9]{64}$/)
  assert.ok(Number.isSafeInteger(receipt.call.connectionRevision) && receipt.call.connectionRevision >= 0)
  assert.deepEqual(receipt.call, { connectionId, connectionRevision: receipt.call.connectionRevision,
    toolName: 'records.search', schemaHash: receipt.call.schemaHash, arguments: MCP_OAUTH_ROUTINE_ARGUMENTS })
  const { arguments: fixedArguments, ...anchor } = receipt.call
  assert.deepEqual(run.permission.policy.approval.tools, [{ ...anchor, fixedArguments }])
  assert.deepEqual(receipt.result, MCP_OAUTH_ROUTINE_RESULT)
  assert.deepEqual(policy.policy.approval, revoked ? null : run.permission.policy.approval)
  assert.equal(current.routineId, routineId)
  assert.deepEqual(current.policy, policy.policy)
  assert.equal(current.active, !revoked)
  const { callHash: _private, ...publicReceipt } = receipt
  assert.deepEqual(current.runs, [{ runId: run.runId, phase: 'active', status: 'ok', calls: [publicReceipt] }])
  assert.equal(output.id, run.runId)
  assert.equal(output.status, 'ok')
  assert.equal(output.detail, MCP_OAUTH_ROUTINE_FINAL_TEXT, 'ordinary output preserves the actual post-result model response')
  const publicData = JSON.stringify({ current, output })
  for (const value of [ownerUserId, ...MCP_OAUTH_FIXTURE_SECRET_CANARIES]) assert.equal(publicData.includes(value), false)
  for (const field of ['oauthAuthority', 'ownerUserId', 'actorUserId', 'callHash', 'permissionHash', 'credentialReference']) {
    assert.equal(publicData.includes(`"${field}"`), false, `${field} remains private`)
  }
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

async function executeRoutineCall({ page, origin, profile, evidence, fixture, model, identity, connectionId }) {
  const provider = await api(page, '/providers', { label: 'OAuth Routine local model', modelFamily: 'claude',
    effortLevels: ['Low'], models: [{ id: MCP_OAUTH_ROUTINE_MODEL, label: 'OAuth Routine fixture' }],
    config: { baseURL: model.origin, model: MCP_OAUTH_ROUTINE_MODEL } })
  const prompt = await api(page, '/system-prompts', { label: 'OAuth Routine smoke prompt', targetFamily: 'claude',
    body: 'Use the exact reviewed external MCP tool once, then report its result.' })
  const agent = await api(page, '/agents', { label: 'OAuth Routine smoke agent', providerId: provider.id,
    systemPromptId: prompt.id, tools: [], instructions: 'Use only the reviewed external tool.' })
  const templates = await api(page, '/schedule-templates')
  const template = templates.find(row => row.name === 'Blank recipe') ?? templates[0]
  assert.ok(template)
  // Paused cadence is part of the reviewed definition. Run now remains the
  // explicit trigger, so no wall-clock boundary can create a second fixture run.
  const task = await api(page, '/schedules', { seed: { ...template.seed, name: 'Native OAuth Routine acceptance', enabled: false,
    prompt: MCP_OAUTH_ROUTINE_PROMPT, agentId: agent.id, providerId: provider.id, modelId: MCP_OAUTH_ROUTINE_MODEL,
    model: 'OAuth Routine local model', effort: 'Low', steps: [],
    delivery: { tool: { id: 'session', label: 'New session', tone: 'workspace' }, target: 'New session' }, runs: [] } })
  const path = `/schedules/${task.id}/mcp-permission`, route = `/scheduled/${task.id}/external-mcp`
  const authority = { tenantId: identity.tenant.id, ownerUserId: identity.user.id, connectionId, routineId: task.id }
  await page.goto(`${origin}${route}`)
  const panel = page.getByRole('region', { name: 'External MCP' })
  await expect(panel.getByText('records.search', { exact: true })).toBeVisible({ timeout: 25_000 })
  await panel.getByRole('checkbox').check()
  await panel.getByLabel('Fixed values for records.search').fill(JSON.stringify(MCP_OAUTH_ROUTINE_ARGUMENTS))
  await panel.getByLabel('Maximum calls per run').fill('2')
  await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
  const review = panel.locator('[aria-label="Approval review"]')
  await expect(review).toContainText('Native OAuth fixture')
  await expect(review).toContainText(MCP_OAUTH_ROUTINE_ARGUMENTS.query)
  await expect(review).toContainText('Up to 2 calls per run')
  await expect(review).toContainText('not a monetary cap')
  assert.equal(fixture.snapshot().counts.mcpCalls, 2, 'reviewing Routine permission does not use the grant')
  assert.equal(model.requests.length, 0)
  await review.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'routine-approval-review.png') })
  const approving = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1${path}`)
  await review.getByRole('button', { name: 'Approve these tools', exact: true }).click()
  const approvalRequest = await approving, approvalBody = approvalRequest.postDataJSON(), approvalKey = approvalRequest.headers()['idempotency-key']
  assert.equal(approvalKey, approvalBody.requestId)
  assert.equal(approvalBody.action, 'approve')
  await expect(panel.getByText('Approval active', { exact: true })).toBeVisible({ timeout: 20_000 })
  assert.equal(fixture.snapshot().counts.mcpCalls, 2, 'separate approval alone never queues work')
  assert.equal(persistedRoutineMcp(profile, task.id).runs.length, 0)
  await page.goto(`${origin}/scheduled/${task.id}`)
  const runPath = `/schedules/${task.id}/run`
  const running = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1${runPath}`)
  await page.getByRole('button', { name: 'Run now', exact: true }).click()
  const runRequest = await running, runKey = runRequest.headers()['idempotency-key']
  assert.ok(runKey, 'rendered Run now uses a durable logical run identity')
  assert.equal(runRequest.postData(), null)
  await expect.poll(async () => (await api(page, path)).runs.some(row => row.status === 'ok' && row.calls.some(call => call.status === 'done')),
    { timeout: 45_000 }).toBe(true)
  const current = await api(page, path), stored = persistedRoutineMcp(profile, task.id)
  const sharedTask = (await api(page, '/schedules')).find(row => row.id === task.id)
  assert.ok(sharedTask)
  assert.equal(sharedTask.runs.length, 1)
  const output = sharedTask.runs[0]
  assertOAuthRoutineReceipt(stored, current, output, authority)
  assert.equal(model.requests.length, 2, 'one Routine tool turn and one exact-result final turn complete the queued run')
  assert.equal(fixture.snapshot().counts.mcpCalls, 3)
  const protocolCalls = fixture.snapshot().requests.filter(request => request.headers['mcp-method'] === 'tools/call')
  assert.deepEqual(protocolCalls.map(request => ({ name: JSON.parse(request.body).params.name, arguments: JSON.parse(request.body).params.arguments })), [
    { name: 'records.search', arguments: { query: 'native-oauth-approved-record' } },
    { name: 'records.search', arguments: CONTRIBUTION_ARGUMENTS },
    { name: 'records.search', arguments: MCP_OAUTH_ROUTINE_ARGUMENTS },
  ])
  for (const privateValue of [...MCP_OAUTH_FIXTURE_SECRET_CANARIES, identity.user.id]) {
    assert.equal(JSON.stringify(model.requests).includes(privateValue), false, 'Routine model input contains no OAuth owner or token')
  }
  assert.doesNotMatch(JSON.stringify(sharedTask), /"(?:routineMcp|oauthAuthority|ownerUserId|callHash|credentialReference)"/)
  const outputRoute = `/s/${runSessionId(task.id, output.id)}`
  await page.goto(`${origin}${outputRoute}`)
  await expect(page.getByText(MCP_OAUTH_ROUTINE_FINAL_TEXT, { exact: true })).toBeVisible({ timeout: 20_000 })
  await captureTranscript(page, join(evidence, 'routine-output.png'))
  await page.goto(`${origin}${route}`)
  await expect(panel.getByRole('heading', { name: 'Private run receipts', exact: true })).toBeVisible()
  await expect(panel.getByLabel('Result for records.search', { exact: true })).toContainText(MCP_OAUTH_ROUTINE_ARGUMENTS.query)
  await panel.getByLabel('Result for records.search', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'routine-private-receipt.png') })
  return { id: task.id, path, route, runPath, runKey, approvalBody, approvalKey, stored, current, output, outputRoute, authority }
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

export async function smokePackagedMcpOAuth({ executable = packagedExecutable(), formReview = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('Packaged OAuth acceptance requires macOS')
  if (typeof formReview !== 'boolean') throw new TypeError('Invalid packaged form-review mode')
  const profile = await mkdtemp(join(tmpdir(), 'ac-native-oauth-smoke-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-oauth-smoke')
  await mkdir(evidenceRoot, { recursive: true })
  const evidence = await mkdtemp(join(evidenceRoot, 'run-'))
  const priorPersistence = { DATA_FILE: process.env.DATA_FILE, DATABASE_PATH: process.env.DATABASE_PATH }
  process.env.DATA_FILE = join(profile, 'unused-store.json')
  process.env.DATABASE_PATH = join(profile, 'store.db')
  let fixture, model, routineModel, copied, run
  let stage = 'startup'
  try {
    fixture = await startMcpOAuthSmokeFixture(formReview ? { formReview: true, accessTokenLifetimeSeconds: 3_600 } : undefined)
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

    if (formReview) {
      stage = 'private-form-review-relaunch-and-receipt-only-recovery'
      model = await startMcpOAuthMessagesSmokeFixture()
      await smokePrivateInput({ initialRun: run, profile, evidence, fixture, model, identity, connectionId: id,
        relaunch: async () => {
          await closePackagedDesktop(run); run = undefined
          run = await launchPackagedDesktop(copied.executable, profile)
          return run
        } })
      console.log('[desktop-oauth-form-smoke] native OAuth custody · private saved form · awaiting signed-in relaunch without dispatch · one explicit continuation · lost POST acknowledgement · exact GET-only recovery · verbatim opaque state/original arguments · SQLite digest-only receipt · completed relaunch without replay')
      console.log(`[desktop-oauth-form-smoke] evidence ${evidence}`)
      return
    }

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

    stage = 'routine-separate-bounded-approval-and-queued-owner-execution'
    routineModel = await startMcpOAuthRoutineMessagesSmokeFixture()
    const routine = await executeRoutineCall({ page, origin, profile, evidence, fixture, model: routineModel, identity, connectionId: id })
    assert.equal(model.requests.length, 2, 'Routine work never reuses or loosens the interactive Messages fixture')
    await assertPrivateStorage(profile, MCP_OAUTH_FIXTURE_SECRET_CANARIES)

    stage = 'tool-contribution-and-routine-receipt-relaunch-and-exact-replay'
    await closePackagedDesktop(run); run = undefined
    run = await launchPackagedDesktop(copied.executable, profile)
    ;({ page, origin } = run)
    assert.equal((await api(page, '/me')).user.id, identity.user.id)
    assert.deepEqual(persistedActivity(profile, proposed.sessionId, proposed.activity.id), completed)
    await page.goto(`${origin}/s/${proposed.sessionId}`)
    await expect(page.locator('[data-mcp-tool-status="done"]')).toContainText('Fixture record for native-oauth-approved-record')
    const replay = await api(page, decisionPath, { decision: 'confirm' }, decisionKey)
    assert.deepEqual(replay, completed.activity, 'a lost response reconciles the exact durable receipt after full restart')
    assert.equal(fixture.snapshot().counts.mcpCalls, 3, 'neither relaunch nor exact interactive receipt replay dispatches again')
    await captureTranscript(page, join(evidence, 'tool-result-relaunched.png'))

    await page.goto(`${origin}${contribution.route}`)
    const contributionCard = page.locator('[data-contribution-effect-status="done"]')
    await expect(contributionCard).toContainText(`Fixture record for ${CONTRIBUTION_ARGUMENTS.query}`)
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toBeVisible()
    const contributionReplay = await api(page, `${contribution.path}/effects`, contribution.body, contribution.key)
    assert.deepEqual(contributionReplay.effects, contribution.completed.effects, 'exact Contribution replay returns the saved receipt after restart')
    assert.deepEqual(persistedContribution(profile, contribution.id), contribution.stored, 'private owner, call and result survive full relaunch unchanged')
    assertOAuthContributionReceipt(persistedContribution(profile, contribution.id), contributionReplay, contribution.authority)
    assert.equal(fixture.snapshot().counts.mcpCalls, 3, 'remaining cardinality and exact Contribution replay grant no automatic dispatch')
    await contributionCard.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, 'contribution-result-relaunched.png') })

    const reopenedRoutine = await api(page, routine.path)
    const reopenedOutput = (await api(page, '/schedules')).find(row => row.id === routine.id)?.runs[0]
    assert.deepEqual(reopenedOutput, routine.output, 'the actual delivered Routine output survives full relaunch')
    assert.deepEqual(persistedRoutineMcp(profile, routine.id), routine.stored, 'private current/frozen owner and call/result survive unchanged')
    assertOAuthRoutineReceipt(persistedRoutineMcp(profile, routine.id), reopenedRoutine, reopenedOutput, routine.authority)
    const approvalReplay = await api(page, routine.path, routine.approvalBody, routine.approvalKey)
    assert.deepEqual(approvalReplay.review.policy, routine.current.policy)
    assert.deepEqual(await api(page, routine.runPath, undefined, routine.runKey, 'POST'), routine.output,
      'exact Run-now replay resolves the completed queued run instead of submitting another')
    assert.deepEqual(persistedRoutineMcp(profile, routine.id), routine.stored)
    assert.equal(fixture.snapshot().counts.mcpCalls, 3)
    assert.equal(routineModel.requests.length, 2, 'relaunch and exact replay never restart the completed model loop')
    await page.goto(`${origin}${routine.outputRoute}`)
    await expect(page.getByText(MCP_OAUTH_ROUTINE_FINAL_TEXT, { exact: true })).toBeVisible()
    await captureTranscript(page, join(evidence, 'routine-output-relaunched.png'))
    await page.goto(`${origin}${routine.route}`)
    const routinePanel = page.getByRole('region', { name: 'External MCP' })
    await expect(routinePanel.getByText('Approval active', { exact: true })).toBeVisible()
    await expect(routinePanel.getByLabel('Result for records.search', { exact: true })).toContainText(MCP_OAUTH_ROUTINE_ARGUMENTS.query)
    await routinePanel.getByLabel('Result for records.search', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, 'routine-private-receipt-relaunched.png') })

    stage = 'rendered-routine-revoke-retains-personal-receipt-and-output'
    const revoking = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1${routine.path}`)
    await routinePanel.getByRole('button', { name: 'Revoke approval', exact: true }).click()
    const revokeRequest = await revoking, revokeBody = revokeRequest.postDataJSON(), revokeKey = revokeRequest.headers()['idempotency-key']
    assert.equal(revokeBody.action, 'revoke')
    assert.equal(revokeKey, revokeBody.requestId)
    await expect(routinePanel.getByText('No unattended MCP tools', { exact: true })).toBeVisible({ timeout: 20_000 })
    const revokedStored = persistedRoutineMcp(profile, routine.id), revoked = await api(page, routine.path)
    assertOAuthRoutineReceipt(revokedStored, revoked, routine.output, { ...routine.authority, revoked: true })
    assert.deepEqual(revokedStored.runs, routine.stored.runs, 'revocation retains the original frozen grant and completed call')
    assert.equal((await api(page, routine.path, routine.approvalBody, routine.approvalKey)).review.policy.approval, null,
      'replaying the old approval acknowledges revoked truth without reviving it')
    assert.deepEqual(await api(page, routine.runPath, undefined, routine.runKey, 'POST'), routine.output)
    assert.equal(fixture.snapshot().counts.mcpCalls, 3)
    assert.equal(routineModel.requests.length, 2)
    await routinePanel.getByLabel('Result for records.search', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, 'routine-revoked-receipt.png') })

    stage = 'disconnect-after-tool-contribution-and-routine-receipts'
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
    const disconnectedRoutine = await api(page, routine.path)
    assertOAuthRoutineReceipt(persistedRoutineMcp(profile, routine.id), disconnectedRoutine, routine.output, { ...routine.authority, revoked: true })
    assert.deepEqual(persistedRoutineMcp(profile, routine.id), revokedStored)
    assert.equal((await api(page, routine.path, revokeBody, revokeKey)).review.policy.approval, null)
    assert.deepEqual(await api(page, routine.runPath, undefined, routine.runKey, 'POST'), routine.output)
    await page.goto(`${origin}${routine.route}`)
    await expect(routinePanel.getByText('No unattended MCP tools', { exact: true })).toBeVisible()
    await expect(routinePanel.getByRole('button', { name: 'Approve these tools', exact: true })).toHaveCount(0)
    await expect(routinePanel.getByLabel('Result for records.search', { exact: true })).toContainText(MCP_OAUTH_ROUTINE_ARGUMENTS.query)
    await routinePanel.getByLabel('Result for records.search', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, 'routine-disconnected-receipt.png') })
    assert.equal(fixture.snapshot().counts.mcpCalls, 3, 'revoke/disconnect preserve all receipts without another dispatch')
    assert.equal(model.requests.length, 2)
    assert.equal(routineModel.requests.length, 2)
    console.log('[desktop-oauth-smoke] reviewed scopes · real PKCE/callback · OS vault · refresh · interactive separate consent · Contribution separate approval/Run · Routine separate bounded approval/queued owner execution · three exact MCP calls · private SQLite owners + receipts + Routine output · signed-in relaunch/exact replay without redispatch · Routine revoke and Disconnect retain history')
    console.log(`[desktop-oauth-smoke] evidence ${evidence}`)
  } catch (error) {
    if (model) console.error('[desktop-oauth-smoke] model evidence', JSON.stringify({ accepted: model.requests.length,
      probes: model.probes.length, rejected: model.rejected }))
    if (routineModel) console.error('[desktop-oauth-smoke] Routine model evidence', JSON.stringify({ accepted: routineModel.requests.length,
      probes: routineModel.probes.length, rejected: routineModel.rejected }))
    await run?.page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {})
    throw new Error(`Packaged OAuth acceptance failed at ${stage}`, { cause: error })
  } finally {
    await closePackagedDesktop(run)
    await copied?.close()
    await model?.close()
    await routineModel?.close()
    await fixture?.close()
    await rm(profile, { recursive: true, force: true })
    for (const [key, value] of Object.entries(priorPersistence)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedMcpOAuth({ formReview: process.argv.includes('--forms') })
