/** Rendered acknowledgement, safe Retry, and lost-response reconciliation for
 * manual routine execution. */
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { ScheduledTask } from '../contract/index.ts'
import { manualScheduleRunId } from '../server/scheduleRunIdentity.ts'
import { ms } from './budget.ts'

test.beforeEach(async ({ page }) => {
  const tenantId = `tenant-schedule-run-${randomUUID()}`
  // The dev-header seam preserves the known Ada principal and synthesizes an
  // unknown tenant as an org; the unique tenant gives each test its own usage.
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': tenantId,
  })
  const response = await page.request.get('/api/v1/me')
  expect(response.ok(), 'the test identity echo is available before fixture setup').toBe(true)
  const identity = await response.json() as { user: { id: string }; tenant: { id: string } }
  expect(identity.user.id).toBe('user-ada')
  expect(identity.tenant.id).toBe(tenantId)
})

async function createRoutine(page: import('@playwright/test').Page, name: string): Promise<ScheduledTask> {
  const templates = await (await page.request.get('/api/v1/schedule-templates')).json() as Array<{
    seed: Omit<ScheduledTask, 'id'>
  }>
  const response = await page.request.post('/api/v1/schedules', {
    data: { seed: { ...templates[0]!.seed, name, runs: [] } },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ScheduledTask>
}

async function readRoutine(page: import('@playwright/test').Page, id: string): Promise<ScheduledTask> {
  const response = await page.request.get('/api/v1/schedules')
  expect(response.ok()).toBe(true)
  const schedules = await response.json() as ScheduledTask[]
  const task = schedules.find((candidate) => candidate.id === id)
  expect(task).toBeDefined()
  return task!
}

test('routine detail exposes the full native title when its page heading truncates', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const routineName = `Standup digest from Linear for identity disclosure ${Date.now().toString(36)}`
  const task = await createRoutine(page, routineName)
  await page.goto(`/scheduled/${task.id}`)

  const heading = page.locator('h1[data-identity-title]')
  await expect(heading).toBeVisible({ timeout: ms(20_000) })
  await expect(heading).toHaveText(routineName)
  await expect(heading).toHaveAttribute('title', routineName)
  await expect.poll(() => heading.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  for (const viewport of [{ width: 320, height: 700 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport)
    await expect(heading).toBeVisible()
    await expect(heading).toHaveAttribute('title', routineName)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})

test('manual execution holds every routine action and Retry preserves one logical run', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const task = await createRoutine(page, `Retryable run ${Date.now().toString(36)}`)
  const keys: string[] = []
  let attempts = 0

  await page.route(`**/api/v1/schedules/${task.id}/run`, async (route) => {
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      // An unrelated fire landing during reconciliation must not be mistaken for
      // this failed logical request.
      const concurrent = await page.request.post(`/api/v1/schedules/${task.id}/run`)
      expect(concurrent.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'temporary transport failure' }),
      })
      return
    }
    await route.continue()
  })

  await page.goto(`/scheduled/${task.id}`)
  await expect(page.getByRole('heading', { name: task.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Run now', exact: true }).click()

  const failed = page.locator('[data-schedule-run="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the run started')
  await expect(page.getByRole('button', { name: 'Stop this run', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^(Pause|Resume) routine$/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Delete routine', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  await expect.poll(async () => (await readRoutine(page, task.id)).runs.length).toBe(1)
  await expect.poll(async () => (await readRoutine(page, task.id)).runs[0]?.status).not.toBe('running')

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  await expect.poll(async () => (await readRoutine(page, task.id)).runs.length).toBe(2)
  const runs = (await readRoutine(page, task.id)).runs
  expect(runs.filter((run) => run.id === manualScheduleRunId(keys[0]!))).toHaveLength(1)
})

test('a committed run with a lost acknowledgement reconciles without duplicate execution', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const task = await createRoutine(page, `Lost acknowledgement ${Date.now().toString(36)}`)
  const keys: string[] = []
  let attempts = 0

  await page.route(`**/api/v1/schedules/${task.id}/run`, async (route) => {
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'acknowledgement lost after commit' }),
    })
  })

  await page.goto(`/scheduled/${task.id}`)
  await expect(page.getByRole('heading', { name: task.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Run now', exact: true }).click()

  await expect(page.locator('[data-schedule-run]')).toHaveCount(0)
  await expect.poll(async () => (await readRoutine(page, task.id)).runs.length).toBe(1)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
})
