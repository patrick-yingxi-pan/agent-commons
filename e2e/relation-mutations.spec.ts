/** Rendered recovery path for graph-backed project creation: failure keeps the
 * form and server truth unchanged; Retry reuses the logical key and only the
 * acknowledgement closes/navigates. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('a failed relation create stays in place and retries the same logical mutation', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const name = `Acknowledged project ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0

  await page.route('**/api/v1/relations/ops', async (route) => {
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary relation outage' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await expect(page.getByPlaceholder('Reply to Claude…')).toBeVisible()
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click()
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByPlaceholder('e.g. Insights dashboard').fill(name)
  await dialog.getByRole('button', { name: 'Create project' }).click()

  const failed = page.locator('[data-relation-mutation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm the change')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('e.g. Insights dashboard')).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Waiting for recovery…' })).toBeDisabled()
  expect(attempts).toBe(1)
  const before = await (await page.request.get('/api/v1/relations')).json()
  expect(before.extraProjects.some((project: { name: string }) => project.name === name)).toBe(false)

  // A desktop window can cross layout tiers while a request is unresolved. The
  // pane tree must reflow without remounting away the initiating form.
  await page.setViewportSize({ width: 320, height: 700 })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('e.g. Insights dashboard')).toHaveValue(name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const after = await (await page.request.get('/api/v1/relations')).json()
  expect(after.extraProjects.filter((project: { name: string }) => project.name === name)).toHaveLength(1)
})
