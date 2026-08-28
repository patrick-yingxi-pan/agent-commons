/** Rendered cross-device recovery for conversation row edits. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('a stale rename loads the other device change and retries one user intent', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const seedTitle = `Revision target ${Date.now().toString(36)}`
  const remoteTitle = `${seedTitle} remote`
  const localTitle = `${seedTitle} local`
  const createdResponse = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: seedTitle },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as { id: string; metadataRevision: number }
  expect(created.metadataRevision).toBe(0)

  let attempts = 0
  const keys: string[] = []
  await page.route(`**/api/v1/sessions/${created.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const concurrent = await page.request.patch(`/api/v1/sessions/${created.id}`, {
        data: { title: remoteTitle, expectedRevision: 0 },
      })
      expect(concurrent.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto('/')
  const expand = page.getByRole('button', { name: 'Expand Sessions' })
  await expect(expand).toBeVisible()
  await expand.click()
  const action = page.getByRole('button', { name: `Actions for ${seedTitle}` })
  await action.click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const editor = page.getByRole('list', { name: 'Sessions' }).getByRole('textbox')
  await editor.fill(localTitle)
  await editor.press('Enter')

  const failed = page.locator('[data-session-metadata-mutation="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await expect(page.getByRole('button', { name: `Actions for ${remoteTitle}` })).toBeVisible()
  expect(attempts).toBe(1)

  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Actions for ${localTitle}` })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])

  const stored = await (await page.request.get(`/api/v1/sessions/${created.id}`)).json()
  expect(stored.title).toBe(localTitle)
  expect(stored.metadataRevision).toBe(2)
})
