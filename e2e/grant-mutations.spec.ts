/** Rendered recovery for sharing: the exact audience draft stays frozen through
 * an uncertain response, Retry reuses one logical key, and a lost revoke
 * acknowledgement reconciles from server truth without a false failure. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'
import { openShareForm } from './social-helpers.ts'

test('sharing and revocation are acknowledgement-owned and retry-safe', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const name = `Reliable sharing ${stamp}`
  const note = `Review this exact draft ${stamp}`
  const createdResponse = await page.request.post('/api/v1/projects', {
    headers: { 'Idempotency-Key': `grant-ui-project-${stamp}` },
    data: { name },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as { project: { id: string } }

  await page.goto(`/projects/${created.project.id}`)
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: ms(20_000) })
  await openShareForm(page)
  const section = page.locator('[data-resource-section="Sharing"]')
  const audience = section.getByLabel('Audience id')
  const publishNote = section.getByLabel('Share note (publishes when present)')
  await audience.fill('tenant-beta')
  await section.getByLabel('Tier').selectOption('comment')
  await publishNote.fill(note)

  const postPattern = '**/api/v1/grants'
  const keys: string[] = []
  let postAttempts = 0
  await page.route(postPattern, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    postAttempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (postAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary sharing outage' } }),
      })
      return
    }
    await route.continue()
  })

  await section.getByRole('button', { name: 'Share', exact: true }).click()
  const failed = page.locator('[data-grant-mutation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm the sharing change', { timeout: ms(20_000) })
  await expect(audience).toBeDisabled()
  await expect(audience).toHaveValue('tenant-beta')
  await expect(publishNote).toBeDisabled()
  await expect(publishNote).toHaveValue(note)
  await expect(section.locator('button[aria-expanded]').first()).toHaveAttribute('aria-disabled', 'true')

  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(failed).toHaveCount(0)
  await expect(section.getByText('tenant-beta · published')).toBeVisible({ timeout: ms(20_000) })
  await expect(audience).toBeEnabled()
  await expect(audience).toHaveValue('')
  await expect(publishNote).toHaveValue('')
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
  await page.unroute(postPattern)

  let deletes = 0
  await page.route('**/api/v1/grants/*', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue()
      return
    }
    deletes += 1
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Lost revoke acknowledgement' } }),
    })
  })
  await section.getByRole('button', { name: 'Revoke the comment grant' }).click()
  await expect(section.getByText('tenant-beta · published')).toHaveCount(0, { timeout: ms(20_000) })
  await expect(page.locator('[data-grant-mutation="failed"]')).toHaveCount(0)
  expect(deletes).toBe(1)
})
