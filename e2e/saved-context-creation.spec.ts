/** Rendered acknowledgement and recovery for adding reusable Context setup. */
import { test, expect, type Page } from '@playwright/test'
import type { SavedContextsSnapshot } from '../contract/index.ts'
import { ms } from './budget.ts'

async function removeIfPresent(page: Page, id: string): Promise<void> {
  const response = await page.request.delete(`/api/v1/saved-contexts/${id}`)
  expect([200, 404]).toContain(response.status())
}

async function savedCount(page: Page, id: string): Promise<number> {
  const snapshot = await (await page.request.get('/api/v1/saved-contexts')).json() as SavedContextsSnapshot
  return snapshot.contexts.filter((context) => context.id === id).length
}

test('Add context stays held across navigation and Retry reuses its exact request', async ({ page }) => {
  test.setTimeout(ms(45_000))
  await removeIfPresent(page, 'jira')
  const keys: string[] = []
  const bodies: string[] = []
  let attempts = 0
  await page.route('**/api/v1/saved-contexts', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    bodies.push(route.request().postData() ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/contexts')
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  let addDialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  let jira = addDialog.getByRole('button', { name: /Jira/ })
  await jira.click()

  const failed = page.locator('[data-saved-context-creation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the context was added')
  await expect(jira).toBeDisabled()
  await expect(jira).toContainText('Waiting for Retry')
  await expect.poll(() => savedCount(page, 'jira')).toBe(0)

  await page.getByRole('complementary').getByRole('button', { name: 'Models', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await page.getByRole('complementary').getByRole('button', { name: 'Contexts', exact: true }).click()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  addDialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  jira = addDialog.getByRole('button', { name: /Jira/ })
  await expect(jira).toBeDisabled()
  await expect(jira).toContainText('Waiting for Retry')

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('button', { name: 'Jira', exact: true })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  expect(bodies[1]).toBe(bodies[0])
  await expect.poll(() => savedCount(page, 'jira')).toBe(1)
  await removeIfPresent(page, 'jira')
})

test('a lost Add context response reconciles the exact row without a second POST', async ({ page }) => {
  test.setTimeout(ms(30_000))
  await removeIfPresent(page, 'asana')
  let attempts = 0
  let requestKey = ''
  await page.route('**/api/v1/saved-contexts', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    requestKey = route.request().headers()['idempotency-key'] ?? ''
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  await page.goto('/contexts')
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add context', exact: true })
    .getByRole('button', { name: /Asana/ }).click()

  await expect(page.locator('[data-saved-context-creation]')).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('button', { name: 'Asana', exact: true })).toBeVisible()
  expect(attempts).toBe(1)
  expect(requestKey).not.toBe('')
  await expect.poll(() => savedCount(page, 'asana')).toBe(1)
  await removeIfPresent(page, 'asana')
})
