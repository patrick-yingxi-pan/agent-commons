/** Rendered cross-device recovery for routine definition edits. */
import { test, expect } from '@playwright/test'
import type { ScheduledTask } from '../contract/index.ts'
import { ms } from './budget.ts'

test('a stale routine toggle loads the other device change and retries one user intent', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const listResponse = await page.request.get('/api/v1/schedules')
  expect(listResponse.ok()).toBe(true)
  const tasks = await listResponse.json() as ScheduledTask[]
  const task = tasks.find((candidate) => candidate.own !== false)
  expect(task).toBeTruthy()
  const target = task!
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
  const tasks = await (await page.request.get('/api/v1/schedules')).json() as ScheduledTask[]
  const target = tasks.find((candidate) => candidate.own !== false && candidate.enabled)
    ?? tasks.find((candidate) => candidate.own !== false)
  expect(target).toBeTruthy()

  await page.goto(`/scheduled/${target!.id}`)
  await expect(page.getByRole('heading', { name: target!.name })).toBeVisible()
  const schedule = page.locator('[data-resource-section="Schedule"]')
  const disclosure = schedule.getByRole('button', { name: /Schedule/ }).first()
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
  await schedule.getByRole('button', { name: 'Edit schedule' }).click()

  const editor = page.getByRole('dialog', { name: 'Edit schedule' })
  await editor.getByLabel('Timezone').selectOption('UTC')
  await editor.getByLabel('After downtime').selectOption('catch-up-once')
  await editor.getByRole('button', { name: 'Apply' }).click()

  await expect(schedule.getByText('Run once when back')).toBeVisible()
  const stored = await (await page.request.get('/api/v1/schedules')).json() as ScheduledTask[]
  const landed = stored.find((candidate) => candidate.id === target!.id)
  expect(landed?.timezone).toBe('UTC')
  expect(landed?.missedFirePolicy).toBe('catch-up-once')
  expect(Number.isFinite(landed?.nextFireAt)).toBe(true)
})
