/** Rendered recovery path for the authorization-affecting context transaction:
 * failed delivery leaves the prior UI/server truth intact, Retry replays the
 * queued intent, and the binding + panel arrive together. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('a failed context update stays unchanged and retries in place', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const created = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `context recovery ${Date.now().toString(36)}` },
  })
  expect(created.ok()).toBe(true)
  const session = await created.json()

  let attempts = 0
  await page.route('**/api/v1/sessions/*/context-state', async (route) => {
    attempts += 1
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary context outage' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto(`/s/${session.id}`)
  await expect(page.getByPlaceholder('Reply to Claude…')).toBeVisible()
  await page.getByRole('button', { name: 'Add context' }).click()
  const picker = page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Connector/ }).click()
  await picker.getByRole('button', { name: /Google Drive/ }).click()
  await page.keyboard.press('Escape')

  const failed = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm the context update' })
  await expect(failed).toContainText('Temporary context outage')
  await expect(failed.getByRole('button', { name: 'Retry' })).toBeVisible()
  expect(attempts).toBe(1)
  const before = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect(before.workspace.connectors).toEqual([])
  expect(await (await page.request.get(`/api/v1/sessions/${session.id}/contexts`)).json()).toEqual([])

  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.getByText('Google Drive').first()).toBeVisible()
  expect(attempts).toBe(2)
  const after = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect(after.workspace.connectors.map((connector: { id: string }) => connector.id)).toContain('gdrive')
  expect(
    (await (await page.request.get(`/api/v1/sessions/${session.id}/contexts`)).json())
      .map((context: { id: string }) => context.id),
  ).toContain('gdrive')
})
