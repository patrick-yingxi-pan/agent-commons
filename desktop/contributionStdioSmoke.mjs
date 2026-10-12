/** Contribution extension of the isolated packaged stdio workflow. The caller
 * owns the exact native grant, repository-authored peer and full app lifecycle.
 * This helper adds no fixture route, transport bypass or shipped authority. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect } from '@playwright/test'

async function request(page, path, body, { key = randomUUID(), status = 200 } = {}) {
  const response = await page.evaluate(async ({ path, body, key }) => {
    const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { path, body, key })
  assert.equal(response.status, status, `Packaged local Contribution ${path}`)
  return response.body
}

function stored(profile, slice, id) {
  const db = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = db.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?').get(slice, id)
    assert.ok(row, `${slice} retains the exact row in SQLite`)
    return JSON.parse(row.json)
  } finally { db.close() }
}

async function calls(tracePath) {
  return (await readFile(tracePath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    .filter(row => row.kind === 'request' && row.method === 'tools/call')
}

function assertPublic(row, connectionId, identity) {
  const text = JSON.stringify(row)
  for (const privateValue of [connectionId, identity.user.id, 'ownerUserId', 'mcpAuthority', 'grantReference', 'executable']) {
    assert.equal(text.includes(privateValue), false, `${privateValue} stays outside Project-visible history`)
  }
}

async function prepareEnvelope(page, origin, route, connectionId, query, maxActs) {
  await page.goto(`${origin}${route}`)
  await page.getByRole('button', { name: 'Declare effects', exact: true }).click()
  await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
  const options = await page.getByLabel('MCP tool 1', { exact: true }).locator('option').evaluateAll(rows =>
    rows.map(row => ({ value: row.value, text: row.textContent })))
  const option = options.find(row => row.value.includes(connectionId))
  assert.ok(option, 'the real inspected person-owned local tool is selectable')
  await page.getByLabel('MCP tool 1', { exact: true }).selectOption(option.value)
  await expect(page.locator('[data-contribution-stdio-disclosure="proposal"]')).toContainText('normal access')
  await page.getByLabel('MCP arguments 1', { exact: true }).fill(JSON.stringify({ query }))
  await page.getByLabel('Max acts 1', { exact: true }).fill(String(maxActs))
  await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toBeVisible()
}

async function confirm(page) {
  await page.getByRole('button', { name: 'Review & run', exact: true }).click()
  const consent = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
  await expect(consent.locator('[data-contribution-stdio-disclosure="confirmation"]')).toContainText('just by starting')
  await consent.getByRole('button', { name: 'Confirm and run once', exact: true }).click()
}

export async function prepareContributionStdioSmoke({ page, origin, profile, connectionId, identity, tracePath, evidence }) {
  const { project } = await request(page, '/projects', { name: 'Native local Contribution work', description: '' }, { status: 201 })
  const item = await request(page, `/projects/${project.id}/open-subgoals`, {
    subGoal: 'Resolve exactly reviewed local work', type: 'mcp.mutate', target: 'records.search',
  })
  const linked = await request(page, `/projects/${project.id}/contributions`, {
    title: 'Reviewed local result', summary: 'Repository-authored child only.', workItemId: item.id,
  })
  const linkedRoute = `/projects/${project.id}/changes/${linked.id}`
  await prepareEnvelope(page, origin, linkedRoute, connectionId, 'contribution-smoke-success', 1)
  assert.equal((await calls(tracePath)).length, 1, 'Contribution proposal and Project approval do not launch a tool')
  await confirm(page)
  const done = page.locator('[data-contribution-effect-status="done"]')
  await expect(done).toContainText('Local fixture result for: contribution-smoke-success', { timeout: 30_000 })
  await expect(done.locator('[data-contribution-stdio-disclosure="receipt"]')).toBeVisible()
  const saved = stored(profile, 'contributions', linked.id)
  assert.equal(saved.effectAttempts[0].transport, 'stdio')
  assert.equal(saved.effectAttempts[0].ownerUserId, identity.user.id)
  assert.equal(saved.effectAttempts[0].status, 'done')
  assert.deepEqual(saved.effectAttempts[0].call.arguments, { query: 'contribution-smoke-success' })
  assert.equal(stored(profile, 'openSubGoals', item.id).status, 'open', 'successful tool evidence alone cannot resolve work')
  await page.getByRole('button', { name: 'Land and resolve work', exact: true }).click()
  await expect(page.locator('[data-linked-work-item-resolution]')).toContainText('landed and resolved')
  const resolved = stored(profile, 'openSubGoals', item.id)
  assert.equal(resolved.status, 'done')
  assert.equal(resolved.contributionResolution.effectId, saved.effectAttempts[0].id)
  assert.equal(resolved.resolvedBy, undefined, 'person-reviewed landing awards no Commission credit')
  await done.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'local-contribution-resolved.png'), fullPage: true })

  const pending = await request(page, `/projects/${project.id}/contributions`, {
    title: 'Interrupted local result', summary: 'The authored peer holds this exact request for process-exit acceptance.',
  })
  const path = `/projects/${project.id}/contributions/${pending.id}`
  const route = `/projects/${project.id}/changes/${pending.id}`
  await prepareEnvelope(page, origin, route, connectionId, 'contribution-smoke-interrupt', 2)
  let submission
  const observe = outgoing => {
    if (outgoing.method() === 'POST' && new URL(outgoing.url()).pathname === `/api/v1${path}/effects`) {
      assert.equal(submission, undefined, 'one rendered Run has one request')
      submission = { body: outgoing.postDataJSON(), key: outgoing.headers()['idempotency-key'] }
    }
  }
  page.on('request', observe)
  try {
    await confirm(page)
    await expect.poll(async () => (await calls(tracePath)).length).toBe(3)
    const durablePending = stored(profile, 'contributions', pending.id)
    assert.equal(durablePending.effectAttempts[0].status, 'pending')
    assert.equal(durablePending.effectAttempts[0].transport, 'stdio')
    assert.equal(durablePending.effectAttempts[0].ownerUserId, identity.user.id)
    assert.equal(durablePending.envelope.lines[0].used, 1, 'reservation is committed while the child has no result')
    assert.ok(submission?.key)
    assert.deepEqual((await calls(tracePath)).map(row => row.params.arguments.query),
      ['native-oauth-approved-record', 'contribution-smoke-success', 'contribution-smoke-interrupt'])
    return { projectId: project.id, linkedId: linked.id, linkedRoute, itemId: item.id, resolved,
      completed: stored(profile, 'contributions', linked.id).effectAttempts[0],
      pending: { id: pending.id, path, route, submission, attempt: durablePending.effectAttempts[0] } }
  } finally { page.off('request', observe) }
}

export function assertContributionStdioInterrupted(profile, state) {
  const attempt = stored(profile, 'contributions', state.pending.id).effectAttempts[0]
  // Native shutdown may persist cancellation before the backend exits. A
  // faster exit leaves pending for startup recovery; neither is a result.
  assert.ok(attempt.status === 'pending' || attempt.status === 'uncertain',
    'full app exit retains the exact unresolved attempt, never a false result')
  assert.equal(attempt.id, state.pending.attempt.id)
  assert.equal(attempt.result, undefined)
  assert.equal(attempt.callHash, state.pending.attempt.callHash)
}

export async function recoverContributionStdioSmoke({ page, origin, profile, connectionId, identity, tracePath, evidence }, state) {
  const { pending } = state
  await page.goto(`${origin}${pending.route}`)
  const uncertain = page.locator('[data-contribution-effect-status="uncertain"]')
  await expect(uncertain).toBeVisible({ timeout: 30_000 })
  await expect(uncertain.locator('[data-contribution-stdio-disclosure="receipt"]')).toContainText('normal access')
  const saved = stored(profile, 'contributions', pending.id)
  assert.equal(saved.effectAttempts[0].id, pending.attempt.id)
  assert.equal(saved.effectAttempts[0].status, 'uncertain')
  assert.equal(saved.effectAttempts[0].ownerUserId, identity.user.id)
  assert.equal(saved.effectAttempts[0].transport, 'stdio')
  assert.equal(saved.envelope.lines[0].used, 1)
  const replay = await request(page, `${pending.path}/effects`, pending.submission.body, { key: pending.submission.key })
  assert.equal(replay.effects[0].status, 'uncertain')
  assert.equal(replay.effects[0].transport, 'stdio')
  assertPublic(replay, connectionId, identity)
  assert.deepEqual(stored(profile, 'contributions', state.linkedId).effectAttempts[0], state.completed)
  assert.deepEqual(stored(profile, 'openSubGoals', state.itemId), state.resolved)
  assert.equal((await calls(tracePath)).length, 3, 'relaunch and exact Retry never dispatch another local request')
  await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toBeVisible()
  await uncertain.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'local-contribution-uncertain-relaunched.png'), fullPage: true })
}

export async function assertRevokedContributionStdioSmoke({ page, origin, profile, connectionId, identity, tracePath, evidence }, state) {
  await page.goto(`${origin}${state.pending.route}`)
  await expect(page.locator('[data-contribution-effect-status="uncertain"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
  const current = (await request(page, `/projects/${state.projectId}/contributions`)).find(row => row.id === state.pending.id)
  assert.equal(current.envelope.lines[0].mcp.transport, 'stdio')
  assert.equal(current.envelope.lines[0].mcp.canRun, undefined)
  assertPublic(current, connectionId, identity)
  await request(page, `${state.pending.path}/effects`, state.pending.submission.body, { status: 403 })
  assert.equal(stored(profile, 'contributions', state.pending.id).effectAttempts.length, 1)
  assert.equal((await calls(tracePath)).length, 3, 'revocation refuses new execution without starting the child')
  await page.screenshot({ path: join(evidence, 'local-contribution-revoked-history.png'), fullPage: true })
}
