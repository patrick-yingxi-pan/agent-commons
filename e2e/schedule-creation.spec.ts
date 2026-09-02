/** Rendered acknowledgement, retained template choice, and lost-response
 * reconciliation for routine creation. */
import { test, expect, type Page } from '@playwright/test'
import type { Identity, ScheduledTask, ScheduleTemplate } from '../contract/index.ts'
import { scheduleCreationId } from '../server/scheduleCreationIdentity.ts'
import { ms } from './budget.ts'

async function templates(page: Page): Promise<ScheduleTemplate[]> {
  const response = await page.request.get('/api/v1/schedule-templates')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ScheduleTemplate[]>
}

async function tenantId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function routines(page: Page): Promise<ScheduledTask[]> {
  const response = await page.request.get('/api/v1/schedules')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ScheduledTask[]>
}

async function openRoutinePicker(page: Page) {
  await page.goto('/scheduled')
  await page.getByRole('button', { name: 'New routine', exact: true }).click()
  return page.getByRole('dialog', { name: 'New routine' })
}

test('a routine template stays held and Retry reuses its exact logical identity', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const [template] = await templates(page)
  const unrelatedName = `Unrelated routine ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0

  await page.route('**/api/v1/schedules', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const unrelated = await page.request.post('/api/v1/schedules', {
        data: { seed: { ...template!.seed, name: unrelatedName, runs: [] } },
      })
      expect(unrelated.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated acknowledgement loss.' } }),
      })
      return
    }
    await route.continue()
  })

  const picker = await openRoutinePicker(page)
  await picker.getByRole('button', { name: template!.name, exact: true }).click()

  const failed = page.locator('[data-schedule-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the routine was created')
  await expect(picker).toBeVisible()
  await expect(picker).toHaveAttribute('aria-busy', 'true')
  await expect(picker.getByRole('button', { name: template!.name, exact: true })).toBeDisabled()
  await expect(picker.getByRole('status')).toContainText(`Creating “${template!.name}”`)

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const expectedId = scheduleCreationId(await tenantId(page), keys[0]!)
  await expect(page).toHaveURL(new RegExp(`/scheduled/${expectedId}$`))
  await expect(picker).toHaveCount(0)
  const stored = await routines(page)
  expect(stored.filter((task) => task.id === expectedId)).toHaveLength(1)
  expect(stored.some((task) => task.name === unrelatedName)).toBe(true)
})

test('Dismiss releases a failed create without erasing the selected template', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const [template] = await templates(page)
  let attempts = 0
  const keys: string[] = []
  await page.route('**/api/v1/schedules', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated failure.' } }),
      })
      return
    }
    await route.continue()
  })

  const picker = await openRoutinePicker(page)
  const choice = picker.getByRole('button', { name: template!.name, exact: true })
  await choice.click()
  const failed = page.locator('[data-schedule-creation="failed"]')
  await expect(failed).toBeVisible()
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()

  await expect(picker).toBeVisible()
  await expect(picker.getByRole('status')).toContainText('Your template choice is still here')
  await expect(choice).toBeEnabled()
  await choice.click()

  expect(keys[1]).not.toBe(keys[0])
  const expectedId = scheduleCreationId(await tenantId(page), keys[1]!)
  await expect(page).toHaveURL(new RegExp(`/scheduled/${expectedId}$`))
  expect((await routines(page)).filter((task) => task.id === expectedId)).toHaveLength(1)
})

test('a committed routine with a lost response reconciles and opens without duplication', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const [template] = await templates(page)
  const keys: string[] = []
  let attempts = 0
  await page.route('**/api/v1/schedules', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  const picker = await openRoutinePicker(page)
  await picker.getByRole('button', { name: template!.name, exact: true }).click()

  await expect.poll(() => attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = scheduleCreationId(await tenantId(page), keys[0]!)
  await expect(page).toHaveURL(new RegExp(`/scheduled/${expectedId}$`))
  await expect(page.locator('[data-schedule-creation]')).toHaveCount(0)
  expect((await routines(page)).filter((task) => task.id === expectedId)).toHaveLength(1)
})

test('a late creation acknowledgement does not steal a destination chosen meanwhile', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const [template] = await templates(page)
  let acknowledge!: () => void
  let sawRequest!: () => void
  const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve })
  const requestStarted = new Promise<void>((resolve) => { sawRequest = resolve })
  await page.route('**/api/v1/schedules', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    sawRequest()
    await acknowledgement
    await route.continue()
  })

  const picker = await openRoutinePicker(page)
  await picker.getByRole('button', { name: template!.name, exact: true }).click()
  await requestStarted
  await page.locator('[data-section-root="dispatch"] [data-rail-entry]').click()
  await expect(page).toHaveURL(/\/dispatch$/)

  acknowledge()
  await expect(page.locator('[data-schedule-creation]')).toHaveCount(0)
  await expect(page).toHaveURL(/\/dispatch$/)
})
