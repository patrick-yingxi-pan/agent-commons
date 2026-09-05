/** Rendered acknowledgement recovery for conversation tool-consent decisions. */
import { test, expect, type Page } from '@playwright/test'
import type { Session } from '../contract/index.ts'
import { toolActivityDecisionId } from '../server/toolActivityDecisionIdentity.ts'
import { ms } from './budget.ts'

// Tool-schema input is metered like a real turn. Use Grace's independent plan
// window so this recovery spec cannot consume the default demo tenant's budget
// and make later turn-control coverage order-dependent within a shard.
const ACTOR_HEADERS = {
  'x-user-id': 'user-grace',
  'x-tenant-id': 'tenant-beta',
}

async function arena(page: Page, stamp: string) {
  await page.context().setExtraHTTPHeaders(ACTOR_HEADERS)
  const targetResponse = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `Tool decision target ${stamp}` },
    headers: ACTOR_HEADERS,
  })
  expect(targetResponse.ok()).toBe(true)
  const target = await targetResponse.json() as Session
  const driverResponse = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `Tool decision driver ${stamp}` },
    headers: ACTOR_HEADERS,
  })
  expect(driverResponse.ok()).toBe(true)
  const driver = await driverResponse.json() as Session
  const proposed = await page.request.post(`/api/v1/sessions/${driver.id}/messages`, {
    data: { text: `Please archive session ${target.id}.` },
    headers: { ...ACTOR_HEADERS, 'Idempotency-Key': `tool-proposal-${stamp}` },
  })
  expect(proposed.ok()).toBe(true)
  await proposed.body()
  return { target, driver }
}

const activityRow = (page: Page, targetId: string) =>
  page.locator('[data-tool-activity-decision]').filter({ hasText: targetId }).first()

async function leaveAndReturn(page: Page, driverId: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Models', exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/s/${driverId}$`))
}

test('a failed tool decision stays exact across navigation and Retry applies it once', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const { target, driver } = await arena(page, stamp)
  await page.goto(`/s/${driver.id}`)
  const row = activityRow(page, target.id)
  await expect(row.getByRole('button', { name: 'Apply edit', exact: true })).toBeVisible({ timeout: ms(20_000) })

  const keys: string[] = []
  const bodies: unknown[] = []
  let fail = true
  await page.route(`**/api/v1/sessions/${driver.id}/tool-activities/*`, async (route) => {
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

  await row.getByRole('button', { name: 'Apply edit', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })
  const failed = page.locator('[data-tool-activity-decision="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether this tool decision was applied')
  await expect(row).toHaveAttribute('aria-busy', 'true')
  await expect(row.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled()
  await expect(row.getByRole('button', { name: 'Decline', exact: true })).toBeDisabled()
  await expect(row).toContainText('Couldn’t confirm whether this tool decision was applied')
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await leaveAndReturn(page, driver.id)
  const returned = activityRow(page, target.id)
  await expect(returned.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled()

  fail = false
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(returned).toHaveAttribute('data-tool-activity-decision', 'ready')
  await expect(returned.getByRole('button', { name: 'Applying…', exact: true })).toHaveCount(0)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toEqual(bodies[0])

  const me = await (await page.request.get('/api/v1/me', { headers: ACTOR_HEADERS })).json() as { tenant: { id: string } }
  const stored = await (await page.request.get(`/api/v1/sessions/${driver.id}`, { headers: ACTOR_HEADERS })).json() as Session
  const activity = (stored.messages ?? []).flatMap((message) => message.toolActivities ?? [])[0]!
  expect(activity.decisionId).toBe(toolActivityDecisionId(me.tenant.id, driver.id, activity.id, keys[0]!))
  expect(activity.status).toBe('done')
  const archived = await (await page.request.get(`/api/v1/sessions/${target.id}`, { headers: ACTOR_HEADERS })).json() as Session
  expect(archived.status).toBe('archived')
})

test('a committed tool decision stays held until its exact receipt reconciles', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const { target, driver } = await arena(page, stamp)
  await page.goto(`/s/${driver.id}`)
  const row = activityRow(page, target.id)
  await expect(row.getByRole('button', { name: 'Apply edit', exact: true })).toBeVisible({ timeout: ms(20_000) })

  const keys: string[] = []
  let committed = false
  let releaseRead!: () => void
  let markReadStarted!: () => void
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  await page.route(`**/api/v1/sessions/${driver.id}/tool-activities/*`, async (route) => {
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
  await page.route(`**/api/v1/sessions/${driver.id}`, async (route) => {
    if (committed && route.request().method() === 'GET' && new URL(route.request().url()).search === '') {
      markReadStarted()
      await readGate
    }
    await route.continue()
  })

  await row.getByRole('button', { name: 'Apply edit', exact: true }).click()
  await readStarted
  await expect(row).toHaveAttribute('aria-busy', 'true')
  await expect(row.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled()
  expect(keys).toHaveLength(1)

  await leaveAndReturn(page, driver.id)
  const returned = activityRow(page, target.id)
  await expect(returned.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled()
  releaseRead()
  await expect(returned).toHaveAttribute('data-tool-activity-decision', 'ready')
  await expect(returned.getByRole('button', { name: 'Applying…', exact: true })).toHaveCount(0)
  expect(keys).toHaveLength(1)

  const stored = await (await page.request.get(`/api/v1/sessions/${driver.id}`, { headers: ACTOR_HEADERS })).json() as Session
  const activity = (stored.messages ?? []).flatMap((message) => message.toolActivities ?? [])[0]!
  expect(activity.status).toBe('done')
  expect(activity.decisionId).toMatch(/^tool-activity-decision-[a-f0-9]{24}$/)
  const archived = await (await page.request.get(`/api/v1/sessions/${target.id}`, { headers: ACTOR_HEADERS })).json() as Session
  expect(archived.status).toBe('archived')
  expect(archived.metadataRevision).toBe(1)
})
