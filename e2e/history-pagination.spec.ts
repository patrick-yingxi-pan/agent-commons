/** Long-conversation production path (ADAPT-24 / PD36): the browser requests a
 * newest tail, mounts a bounded row window, and can walk backward without losing
 * a direct route back to the live edge. Pure cursor/store rules are node-locked;
 * this spec proves their rendered wiring. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('a long conversation loads earlier history while keeping the mounted thread bounded', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const createdResponse = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `history paging ${stamp}` },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as { id: string }

  // Twenty-one persisted turns produce 42 messages: just over the shared
  // 40-message payload/render budget, so both page directions have real work.
  for (let turn = 1; turn <= 21; turn += 1) {
    const sent = await page.request.post(`/api/v1/sessions/${created.id}/messages`, {
      data: { text: `history turn ${turn} · ${stamp}` },
      headers: { 'Idempotency-Key': `history-${stamp}-${turn}` },
    })
    expect(sent.ok(), `turn ${turn} persisted`).toBe(true)
  }

  const bounded = await (await page.request.get(`/api/v1/sessions/${created.id}?messageLimit=40`)).json()
  expect(bounded.messages).toHaveLength(40)
  expect(bounded.messagePage.olderCursor).toBeTruthy()

  await page.goto(`/s/${created.id}`)
  const rows = page.locator('[data-turn]')
  await expect(rows).toHaveCount(40, { timeout: ms(20_000) })
  await expect(page.getByRole('button', { name: 'Load earlier messages' })).toBeVisible()
  await expect(page.getByText(`history turn 21 · ${stamp}`, { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'Load earlier messages' }).click()
  await expect(rows).toHaveCount(40, { timeout: ms(10_000) })
  await expect(page.getByText(`history turn 1 · ${stamp}`, { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeInViewport()

  await page.getByRole('button', { name: 'Jump to latest' }).click()
  await expect(rows).toHaveCount(40)
  await expect(page.getByText(`history turn 21 · ${stamp}`, { exact: false })).toBeVisible()
  await expect(rows.last()).toBeInViewport()
  await expect(page.getByText(`history turn 1 · ${stamp}`, { exact: false })).toHaveCount(0)
})
