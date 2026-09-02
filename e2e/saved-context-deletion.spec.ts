/** Rendered confirmation and cross-device recovery for saved Context removal. */
import { test, expect } from '@playwright/test'
import type { SavedContext, SavedContextsSnapshot } from '../contract/index.ts'
import { ms } from './budget.ts'

test('saved Context removal confirms scope, holds the row, and retries stale intent', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const id = `context-delete-${stamp}`
  const label = `Removal context ${stamp}`
  const createdResponse = await page.request.post('/api/v1/saved-contexts', {
    data: {
      context: {
        id,
        label,
        kind: 'connector',
        status: 'connected',
        detail: 'Two-device removal test',
        lastUsedAt: null,
        sessions: 0,
      },
    },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as SavedContext
  expect(created.connectionRevision).toBe(0)

  let attempts = 0
  const keys: string[] = []
  const bodies: Record<string, unknown>[] = []
  await page.route(`**/api/v1/saved-contexts/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (attempts === 1) {
      const changed = await page.request.patch(`/api/v1/saved-contexts/${id}`, {
        data: { status: 'needs-auth', expectedRevision: 0 },
      })
      expect(changed.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto(`/contexts/${id}`)
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible({ timeout: ms(20_000) })

  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: `Remove ${label}?`, exact: true })
  await expect(dialog).toContainText('Existing session attachments stay')
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  dialog = page.getByRole('dialog', { name: `Remove ${label}?`, exact: true })
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()

  const failed = page.locator('[data-saved-context-deletion="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)
  expect(bodies[0]).toMatchObject({ expectedRevision: 0 })

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Contexts', exact: true })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toMatchObject({ expectedRevision: 1 })

  const snapshot = await (await page.request.get('/api/v1/saved-contexts')).json() as SavedContextsSnapshot
  expect(snapshot.contexts.some((context) => context.id === id)).toBe(false)
  await expect(page.getByRole('main').getByText(label, { exact: true })).toHaveCount(0)
})

test('saved Context removal does not redirect a person who left its detail', async ({ page }) => {
  test.setTimeout(ms(30_000))
  const stamp = Date.now().toString(36)
  const id = `context-delete-leave-${stamp}`
  const label = `Leaving context ${stamp}`
  const created = await page.request.post('/api/v1/saved-contexts', {
    data: {
      context: {
        id,
        label,
        kind: 'connector',
        status: 'connected',
        detail: 'Late acknowledgement navigation test',
        lastUsedAt: null,
        sessions: 0,
      },
    },
  })
  expect(created.ok()).toBe(true)

  let releaseDelete!: () => void
  let markDeleteStarted!: () => void
  const deleteStarted = new Promise<void>((resolve) => { markDeleteStarted = resolve })
  const deleteRelease = new Promise<void>((resolve) => { releaseDelete = resolve })
  await page.route(`**/api/v1/saved-contexts/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    markDeleteStarted()
    await deleteRelease
    await route.continue()
  })

  await page.goto(`/contexts/${id}`)
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByRole('dialog', { name: `Remove ${label}?`, exact: true })
    .getByRole('button', { name: 'Remove', exact: true }).click()
  await deleteStarted

  await page.getByRole('complementary').getByRole('button', { name: 'Models', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible()
  releaseDelete()

  await expect(page.locator('[data-saved-context-deletion]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible()
  const snapshot = await (await page.request.get('/api/v1/saved-contexts')).json() as SavedContextsSnapshot
  expect(snapshot.contexts.some((context) => context.id === id)).toBe(false)
})
