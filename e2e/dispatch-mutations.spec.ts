/** Rendered acknowledgement, retained form, and lost-response reconciliation
 * for one-off Dispatch creation. */
import { test, expect } from '@playwright/test'
import type { DispatchRun, Identity } from '../contract/index.ts'
import { manualDispatchRunId } from '../server/dispatchIdentity.ts'
import { ms } from './budget.ts'

async function readDispatch(page: import('@playwright/test').Page): Promise<DispatchRun[]> {
  const response = await page.request.get('/api/v1/dispatch')
  expect(response.ok()).toBe(true)
  return response.json() as Promise<DispatchRun[]>
}

async function tenantId(page: import('@playwright/test').Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.ok()).toBe(true)
  return ((await response.json()) as Identity).tenant.id
}

async function openDispatchForm(page: import('@playwright/test').Page, title: string, detail: string) {
  await page.goto('/dispatch')
  await page.getByRole('button', { name: 'New dispatch', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New dispatch' })
  await dialog.getByRole('textbox', { name: 'Task' }).fill(title)
  await dialog.getByRole('textbox', { name: 'Detail' }).fill(detail)
  return dialog
}

test('Dispatch retains its form and same logical key until Retry is acknowledged', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const title = `Retryable dispatch ${Date.now().toString(36)}`
  const detail = 'Keep this exact authored task through uncertainty.'
  const unrelatedTitle = `Unrelated dispatch ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0

  await page.route('**/api/v1/dispatch', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const unrelated = await page.request.post('/api/v1/dispatch', { data: { title: unrelatedTitle } })
      expect(unrelated.ok()).toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'temporary transport failure' }),
      })
      return
    }
    await route.continue()
  })

  const dialog = await openDispatchForm(page, title, detail)
  await dialog.getByRole('button', { name: 'Dispatch', exact: true }).click()

  const failed = page.locator('[data-dispatch-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the dispatch started')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Task' })).toHaveValue(title)
  await expect(dialog.getByRole('textbox', { name: 'Detail' })).toHaveValue(detail)
  await expect(dialog.getByRole('textbox', { name: 'Task' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled()
  expect(attempts).toBe(1)

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])

  const runs = await readDispatch(page)
  const expectedId = manualDispatchRunId(await tenantId(page), keys[0]!)
  expect(runs.filter((run) => run.id === expectedId)).toHaveLength(1)
  expect(runs.find((run) => run.id === expectedId)?.title).toBe(title)
  expect(runs.some((run) => run.title === unrelatedTitle)).toBe(true)
})

test('a committed Dispatch with a lost response reconciles and closes without duplication', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const title = `Lost Dispatch acknowledgement ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0

  await page.route('**/api/v1/dispatch', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
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

  const dialog = await openDispatchForm(page, title, 'Reconcile exact server truth.')
  await dialog.getByRole('button', { name: 'Dispatch', exact: true }).click()

  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-dispatch-creation]')).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const expectedId = manualDispatchRunId(await tenantId(page), keys[0]!)
  await expect.poll(async () => (await readDispatch(page)).filter((run) => run.id === expectedId).length).toBe(1)
})
