/** Rendered cross-device recovery for routine definition edits. */
import { test, expect, type Page } from '@playwright/test'
import type { ScheduledTask, ScheduleTemplate } from '../contract/index.ts'
import { ms } from './budget.ts'

async function createRoutine(page: Page, name: string): Promise<ScheduledTask> {
  const templates = await page.request.get('/api/v1/schedule-templates')
  expect(templates.ok()).toBe(true)
  const [template] = await templates.json() as ScheduleTemplate[]
  const response = await page.request.post('/api/v1/schedules', {
    data: { seed: { ...template!.seed, name, enabled: true, runs: [] } },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ScheduledTask>
}

test('a stale routine toggle loads the other device change and retries one user intent', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const target = await createRoutine(page, `Conflict-safe routine ${Date.now().toString(36)}`)
  const revision = target.revision ?? 0
  const remoteName = `${target.name} remote ${Date.now().toString(36)}`
  const nextEnabled = !target.enabled

  let attempts = 0
  const keys: string[] = []
  await page.route(`**/api/v1/schedules/${target.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const concurrent = await page.request.patch(`/api/v1/schedules/${target.id}`, {
        data: { name: remoteName, expectedRevision: revision },
      })
      expect(concurrent.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto('/')
  const rail = page.getByRole('complementary')
  const expand = rail.getByRole('button', { name: 'Expand Routines', exact: true })
  await expect(expand).toBeVisible()
  await expand.click()
  await rail.getByRole('button', { name: `Actions for ${target.name}` }).click()
  await page.getByRole('menuitem', { name: target.enabled ? 'Pause' : 'Resume' }).click()

  const failed = page.locator('[data-schedule-mutation="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await expect(rail.getByRole('button', { name: `Actions for ${remoteName}` })).toBeVisible()
  expect(attempts).toBe(1)

  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(failed).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])

  const stored = await (await page.request.get('/api/v1/schedules')).json() as ScheduledTask[]
  const landed = stored.find((candidate) => candidate.id === target.id)
  expect(landed?.name).toBe(remoteName)
  expect(landed?.enabled).toBe(nextEnabled)
  expect(landed?.revision).toBe(revision + 2)
})

test('the schedule editor saves timezone intent and an explicit downtime policy', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const target = await createRoutine(page, `Acknowledged cadence ${Date.now().toString(36)}`)
  let acknowledge!: () => void
  let sawRequest!: () => void
  const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve })
  const requestStarted = new Promise<void>((resolve) => { sawRequest = resolve })
  await page.route(`**/api/v1/schedules/${target.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    sawRequest()
    await acknowledgement
    await route.continue()
  })

  await page.goto(`/scheduled/${target.id}`)
  await expect(page.getByRole('heading', { name: target.name })).toBeVisible()
  const schedule = page.locator('[data-resource-section="Schedule"]')
  const disclosure = schedule.getByRole('button', { name: /Schedule/ }).first()
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
  await schedule.getByRole('button', { name: 'Edit schedule' }).click()

  const editor = page.getByRole('dialog', { name: 'Edit schedule' })
  await editor.getByLabel('Timezone').selectOption('UTC')
  await editor.getByLabel('After downtime').selectOption('catch-up-once')
  await editor.getByRole('button', { name: 'Apply' }).click()
  await requestStarted

  await expect(editor).toBeVisible()
  await expect(editor).toHaveAttribute('aria-busy', 'true')
  await expect(editor.getByRole('button', { name: 'Applying…' })).toBeDisabled()
  await expect(schedule.getByRole('button', { name: /Schedule/ }).first()).toHaveAttribute('aria-expanded', 'true')

  acknowledge()
  await expect(editor).toHaveCount(0)

  await expect(schedule.getByText('Run once when back')).toBeVisible()
  const stored = await (await page.request.get('/api/v1/schedules')).json() as ScheduledTask[]
  const landed = stored.find((candidate) => candidate.id === target.id)
  expect(landed?.timezone).toBe('UTC')
  expect(landed?.missedFirePolicy).toBe('catch-up-once')
  expect(Number.isFinite(landed?.nextFireAt)).toBe(true)
})

test('the workflow editor holds its authored steps until the server acknowledges them', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const target = await createRoutine(page, `Acknowledged workflow ${Date.now().toString(36)}`)
  const desiredAction = `Prepare acknowledged brief ${Date.now().toString(36)}`
  let acknowledge!: () => void
  let sawRequest!: () => void
  const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve })
  const requestStarted = new Promise<void>((resolve) => { sawRequest = resolve })
  await page.route(`**/api/v1/schedules/${target.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    sawRequest()
    await acknowledgement
    await route.continue()
  })

  await page.goto(`/scheduled/${target.id}`)
  const workflow = page.locator('[data-resource-section="Workflow"]')
  const disclosure = workflow.getByRole('button', { name: /Workflow/ }).first()
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
  await workflow.getByRole('button', { name: 'Edit steps' }).click()
  await workflow.locator('textarea').first().fill(desiredAction)
  await workflow.getByRole('button', { name: 'Save workflow' }).click()
  await requestStarted

  await expect(workflow.locator('[aria-busy="true"]')).toBeVisible()
  await expect(workflow.getByRole('button', { name: 'Saving workflow…' })).toBeDisabled()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')

  acknowledge()
  await expect(workflow.getByRole('button', { name: 'Edit steps' })).toBeVisible()
  await expect(workflow.getByText(desiredAction)).toBeVisible()
  const stored = await (await page.request.get('/api/v1/schedules')).json() as ScheduledTask[]
  expect(stored.find((candidate) => candidate.id === target.id)?.steps[0]?.action).toBe(desiredAction)
})

test('dismissing an uncertain cadence write keeps the exact editable draft', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const target = await createRoutine(page, `Retained cadence ${Date.now().toString(36)}`)
  const desiredZone = target.timezone === 'Asia/Tokyo' ? 'UTC' : 'Asia/Tokyo'
  let attempts = 0
  await page.route(`**/api/v1/schedules/${target.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'unavailable', message: 'Simulated acknowledgement loss.' } },
      })
      return
    }
    await route.continue()
  })

  await page.goto(`/scheduled/${target.id}`)
  const schedule = page.locator('[data-resource-section="Schedule"]')
  const disclosure = schedule.getByRole('button', { name: /Schedule/ }).first()
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
  await schedule.getByRole('button', { name: 'Edit schedule' }).click()

  const editor = page.getByRole('dialog', { name: 'Edit schedule' })
  await editor.getByLabel('Timezone').selectOption(desiredZone)
  await editor.getByRole('button', { name: 'Apply' }).click()

  const failed = page.locator('[data-schedule-mutation="failed"]')
  await expect(failed).toBeVisible()
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('Timezone')).toHaveValue(desiredZone)
  await failed.getByRole('button', { name: 'Dismiss' }).click()

  await expect(editor.getByRole('status')).toContainText('draft was not saved')
  await expect(editor.getByLabel('Timezone')).toBeEnabled()
  await expect(editor.getByLabel('Timezone')).toHaveValue(desiredZone)

  await editor.getByRole('button', { name: 'Apply' }).click()
  await expect(editor).toHaveCount(0)
  expect(attempts).toBe(2)
  const stored = await (await page.request.get('/api/v1/schedules')).json() as ScheduledTask[]
  expect(stored.find((candidate) => candidate.id === target.id)?.timezone).toBe(desiredZone)
})
