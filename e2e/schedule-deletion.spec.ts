/** Rendered confirmation, stale-revision recovery, and navigation safety for
 * permanent routine deletion. */
import { test, expect } from '@playwright/test'
import type { ScheduledTask } from '../contract/index.ts'
import { ms } from './budget.ts'

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

test('routine deletion confirms its cascade, holds the resource, and retries stale consent', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const task = await createRoutine(page, `Removal routine ${stamp}`)
  const remoteName = `${task.name} changed elsewhere`
  let attempts = 0
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []

  await page.route(`**/api/v1/schedules/${task.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      const changed = await page.request.patch(`/api/v1/schedules/${task.id}`, {
        data: { name: remoteName, expectedRevision: task.revision ?? 0 },
      })
      expect(changed.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto(`/scheduled/${task.id}`)
  await expect(page.getByRole('heading', { name: task.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Delete routine', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: `Delete “${task.name}”?`, exact: true })
  await expect(dialog).toContainText('permanently removes the routine and its run conversations')
  await expect(dialog).toContainText('Artifacts it created stay')
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await page.getByRole('button', { name: 'Delete routine', exact: true }).click()
  dialog = page.getByRole('dialog', { name: `Delete “${task.name}”?`, exact: true })
  await dialog.getByRole('button', { name: 'Delete routine', exact: true }).click()

  const failed = page.locator('[data-schedule-deletion="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await expect(page.getByRole('heading', { name: remoteName, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete routine', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  expect(bodies[0]).toMatchObject({ expectedRevision: task.revision ?? 0 })

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Routines', exact: true })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toMatchObject({ expectedRevision: (task.revision ?? 0) + 1 })

  const schedules = await (await page.request.get('/api/v1/schedules')).json() as ScheduledTask[]
  expect(schedules.some((candidate) => candidate.id === task.id)).toBe(false)
})

test('a late routine deletion acknowledgement cannot redirect a person who moved elsewhere', async ({ page }) => {
  test.setTimeout(ms(30_000))
  const stamp = Date.now().toString(36)
  const task = await createRoutine(page, `Leaving routine ${stamp}`)
  let releaseDelete!: () => void
  let markDeleteStarted!: () => void
  const deleteStarted = new Promise<void>((resolve) => { markDeleteStarted = resolve })
  const deleteRelease = new Promise<void>((resolve) => { releaseDelete = resolve })

  await page.route(`**/api/v1/schedules/${task.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    markDeleteStarted()
    await deleteRelease
    await route.continue()
  })

  await page.goto(`/scheduled/${task.id}`)
  await expect(page.getByRole('heading', { name: task.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Delete routine', exact: true }).click()
  await page.getByRole('dialog', { name: `Delete “${task.name}”?`, exact: true })
    .getByRole('button', { name: 'Delete routine', exact: true }).click()
  await deleteStarted

  await page.getByRole('complementary').getByRole('button', { name: 'Models', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible()
  releaseDelete()

  await expect(page.locator('[data-schedule-deletion]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible()
  const schedules = await (await page.request.get('/api/v1/schedules')).json() as ScheduledTask[]
  expect(schedules.some((candidate) => candidate.id === task.id)).toBe(false)
})
