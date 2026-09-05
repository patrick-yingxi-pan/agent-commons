/** Rendered acknowledgement recovery for model-proposed relation decisions. */
import { test, expect, type Page } from '@playwright/test'
import type { RelationGraph, Session } from '../contract/index.ts'
import { opKey } from '../contract/index.ts'
import { relationActionDecisionId } from '../server/relationActionDecisionIdentity.ts'
import { ms } from './budget.ts'

// Model-schema input is metered like a real turn. Use Grace's independent plan
// window so this recovery spec cannot consume the flagship tenant's budget.
const ACTOR_HEADERS = {
  'x-user-id': 'user-grace',
  'x-tenant-id': 'tenant-beta',
}

async function arena(page: Page, stamp: string) {
  await page.context().setExtraHTTPHeaders(ACTOR_HEADERS)
  const artifactName = `relation-decision-${stamp}.md`
  const sessionResponse = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `Relation decision driver ${stamp}` },
    headers: ACTOR_HEADERS,
  })
  expect(sessionResponse.ok()).toBe(true)
  const session = await sessionResponse.json() as Session
  const proposed = await page.request.post(`/api/v1/sessions/${session.id}/messages`, {
    data: { text: `Save the recap of this as ${artifactName}` },
    headers: { ...ACTOR_HEADERS, 'Idempotency-Key': `relation-proposal-${stamp}` },
  })
  expect(proposed.ok()).toBe(true)
  await proposed.body()
  const stored = await (await page.request.get(`/api/v1/sessions/${session.id}`, { headers: ACTOR_HEADERS })).json() as Session
  const carrier = (stored.messages ?? []).find((message) =>
    message.relationActions?.some((operation) => operation.kind === 'save-artifact' && operation.artifact.name === artifactName))
  const operation = carrier?.relationActions?.find((candidate) => candidate.kind === 'save-artifact' && candidate.artifact.name === artifactName)
  expect(carrier, 'the model proposal is carried by an addressable message').toBeTruthy()
  expect(operation, 'the proposal preserves the exact authored artifact operation').toBeTruthy()
  return { session, carrier: carrier!, operation: operation!, artifactName }
}

const decisionRow = (page: Page) => page.locator('[data-relation-action-key]').first()

async function leaveAndReturn(page: Page, sessionId: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Models', exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}$`))
}

async function artifactCount(page: Page, name: string): Promise<number> {
  const graph = await (await page.request.get('/api/v1/relations', { headers: ACTOR_HEADERS })).json() as RelationGraph
  return graph.extraArtifacts.filter((artifact) => artifact.name === name).length
}

test('a failed proposed-change decision stays exact across navigation and Retry applies it once', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const { session, carrier, operation, artifactName } = await arena(page, stamp)
  await page.goto(`/s/${session.id}`)
  const row = decisionRow(page)
  await expect(row).toContainText(artifactName)
  await expect(row.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({ timeout: ms(20_000) })

  const keys: string[] = []
  const bodies: unknown[] = []
  let fail = true
  await page.route(`**/api/v1/sessions/${session.id}/messages/${carrier.id}/relations`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON())
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated consent outage.' } }),
      })
      return
    }
    await route.continue()
  })

  await row.getByRole('button', { name: 'Confirm', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })
  const failed = page.locator('[data-relation-action-decision="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this proposed-change decision was applied')
  await expect(row).toHaveAttribute('aria-busy', 'true')
  await expect(row.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled()
  await expect(row.getByRole('button', { name: 'Not now', exact: true })).toBeDisabled()
  await expect(row).toContainText('Couldn’t confirm whether this proposed-change decision was applied')
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await leaveAndReturn(page, session.id)
  const returned = decisionRow(page)
  await expect(returned.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(returned).toHaveAttribute('data-relation-action-decision', 'ready')
  await expect(returned.getByRole('button', { name: 'Applying…', exact: true })).toHaveCount(0)
  await expect(returned).toContainText('Saved as an artifact')
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])

  const me = await (await page.request.get('/api/v1/me', { headers: ACTOR_HEADERS })).json() as { tenant: { id: string } }
  const stored = await (await page.request.get(`/api/v1/sessions/${session.id}`, { headers: ACTOR_HEADERS })).json() as Session
  const reread = stored.messages?.find((message) => message.id === carrier.id)
  const key = opKey(operation)
  expect(reread?.relationsResolved?.[key]).toBe('confirmed')
  expect(reread?.relationDecisionIds?.[key]).toBe(
    relationActionDecisionId(me.tenant.id, session.id, carrier.id, key, keys[0]!),
  )
  expect(await artifactCount(page, artifactName)).toBe(1)
})

test('a committed proposed change stays held until its exact receipt reconciles', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const { session, carrier, artifactName } = await arena(page, stamp)
  await page.goto(`/s/${session.id}`)
  const row = decisionRow(page)
  await expect(row).toContainText(artifactName)
  await expect(row.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({ timeout: ms(20_000) })

  const keys: string[] = []
  let committed = false
  let releaseRead!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  await page.route(`**/api/v1/sessions/${session.id}/messages/${carrier.id}/relations`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    await response.body()
    committed = true
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
    })
  })
  await page.route(`**/api/v1/sessions/${session.id}`, async (route) => {
    if (committed && route.request().method() === 'GET' && new URL(route.request().url()).search === '') {
      markReadStarted()
      await readGate
    }
    await route.continue()
  })

  await row.getByRole('button', { name: 'Confirm', exact: true }).click()
  await readStarted
  await expect(row).toHaveAttribute('aria-busy', 'true')
  await expect(row.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled()
  await expect(row.getByRole('button', { name: 'Not now', exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)

  await leaveAndReturn(page, session.id)
  const returned = decisionRow(page)
  await expect(returned.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled()
  releaseRead()
  await expect(returned).toHaveAttribute('data-relation-action-decision', 'ready')
  await expect(returned.getByRole('button', { name: 'Applying…', exact: true })).toHaveCount(0)
  await expect(returned).toContainText('Saved as an artifact')
  expect(keys).toHaveLength(1)

  const stored = await (await page.request.get(`/api/v1/sessions/${session.id}`, { headers: ACTOR_HEADERS })).json() as Session
  const reread = stored.messages?.find((message) => message.id === carrier.id)
  expect(Object.values(reread?.relationsResolved ?? {})).toContain('confirmed')
  expect(Object.values(reread?.relationDecisionIds ?? {})[0]).toMatch(/^relation-action-decision-[a-f0-9]{24}$/)
  expect(await artifactCount(page, artifactName)).toBe(1)
})
