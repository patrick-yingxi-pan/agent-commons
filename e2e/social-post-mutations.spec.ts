/** Rendered recovery for authored social prose: an uncommitted failure retains
 * the exact draft and logical key, while a committed reply whose response is
 * lost reconciles from its durable post identity without duplication. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('discussion prose is acknowledgement-owned and retry-safe', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const name = `Reliable discussion ${stamp}`
  const opening = `Keep this exact opening through uncertainty ${stamp}`
  const reply = `Committed once despite the lost response ${stamp}`
  const createdResponse = await page.request.post('/api/v1/projects', {
    headers: { 'Idempotency-Key': `social-post-project-${stamp}` },
    data: { name },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as { project: { id: string } }

  await page.goto(`/projects/${created.project.id}`)
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: ms(20_000) })
  const section = page.locator('[data-resource-section="Discussion"]')
  await section.getByRole('button', { name: 'Start the discussion' }).click()
  const field = section.getByRole('textbox', { name: 'Post to this project’s discussion' })
  await field.fill(opening)

  const openKeys: string[] = []
  let openAttempts = 0
  await page.route('**/api/v1/discussions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    openAttempts += 1
    openKeys.push(route.request().headers()['idempotency-key'] ?? '')
    if (openAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary posting outage' } }),
      })
      return
    }
    await route.continue()
  })

  await section.getByRole('button', { name: 'Post to this project’s discussion' }).click()
  const failed = page.locator('[data-social-post-mutation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm the post', { timeout: ms(20_000) })
  await expect(field).toBeDisabled()
  await expect(field).toHaveValue(opening)
  await expect(section.locator('button[aria-expanded]').first()).toHaveAttribute('aria-disabled', 'true')

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(field).toHaveCount(0)
  await expect(section.locator('p', { hasText: opening })).toHaveCount(1, { timeout: ms(20_000) })
  expect(openKeys).toHaveLength(2)
  expect(openKeys[0]).toBeTruthy()
  expect(openKeys[1]).toBe(openKeys[0])
  await page.unroute('**/api/v1/discussions')

  await section.getByRole('button', { name: 'Reply to this discussion' }).click()
  const replyField = section.getByRole('textbox', { name: 'Post to this project’s discussion' })
  await replyField.fill(reply)
  const appendKeys: string[] = []
  let appendAttempts = 0
  await page.route('**/api/v1/discussions/*/posts', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    appendAttempts += 1
    appendKeys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit' } }),
    })
  })

  await section.getByRole('button', { name: 'Post to this project’s discussion' }).click()
  await expect(page.locator('[data-social-post-mutation]')).toHaveCount(0, { timeout: ms(20_000) })
  await expect(replyField).toHaveCount(0)
  await expect(section.locator('p', { hasText: reply })).toHaveCount(1, { timeout: ms(20_000) })
  expect(appendAttempts).toBe(1)
  expect(appendKeys[0]).toBeTruthy()
})
