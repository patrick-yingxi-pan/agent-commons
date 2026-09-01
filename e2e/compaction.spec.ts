/** Rendered long-conversation compaction: a failed model request remains retryable,
 * success replaces only active context with a substantive disclosure, and the
 * original turns are still readable through the bounded archive door. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('compaction recovers from failure and keeps the generated brief plus archived originals inspectable', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const decision = `Decision Firefly ${stamp}: direct signed and notarized download.`
  const createdResponse = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `compaction walk ${stamp}` },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as { id: string }

  for (let turn = 1; turn <= 4; turn += 1) {
    const text = turn === 1 ? decision : `Compaction follow-up ${turn} ${stamp}`
    const sent = await page.request.post(`/api/v1/sessions/${created.id}/messages`, {
      data: { text },
      headers: { 'Idempotency-Key': `compact-${stamp}-${turn}` },
    })
    expect(sent.ok(), `turn ${turn} persisted`).toBe(true)
  }

  await page.goto(`/s/${created.id}`)
  const compact = page.getByRole('button', { name: 'Compact conversation to free up context' })
  await expect(compact).toBeVisible({ timeout: ms(20_000) })

  let failOnce = true
  await page.route(`**/api/v1/sessions/${created.id}/compact`, async (route) => {
    if (failOnce) {
      failOnce = false
      await route.abort('connectionrefused')
      return
    }
    await route.continue()
  })
  await compact.click()
  const recovery = page.getByRole('alert')
  await expect(recovery.getByRole('button', { name: 'Retry compaction' })).toBeVisible()

  await recovery.getByRole('button', { name: 'Retry compaction' }).click()
  const summary = page.getByRole('button', { name: /Conversation summary/ })
  await expect(summary).toBeVisible({ timeout: ms(20_000) })
  await expect(page.getByPlaceholder('Reply to Claude…')).toBeEnabled()
  await expect(page.locator('[data-turn]')).toHaveCount(4, { timeout: ms(10_000) })

  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText(/Firefly/, { exact: false }).first()).toBeVisible()
  const archive = page.getByLabel('Archived conversation messages')
  await expect(archive).toBeVisible()
  await expect(archive.getByText(decision, { exact: false })).toBeVisible()

  await page.setViewportSize({ width: 320, height: 700 })
  const titleBox = await page.getByText('Conversation summary', { exact: true }).boundingBox()
  const countBox = await page.getByText('4 earlier messages', { exact: true }).boundingBox()
  expect(titleBox).not.toBeNull()
  expect(countBox).not.toBeNull()
  expect(countBox!.y).toBeGreaterThan(titleBox!.y, 'the compact count stacks below the title rather than squeezing both labels')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  const stored = await (await page.request.get(`/api/v1/sessions/${created.id}`)).json()
  expect(stored.compactedMessages).toHaveLength(4)
  expect(stored.messages[0].content).toContain('Firefly')
})
