/** Rendered exact-acknowledgement recovery for model-backed compaction. */
import { test, expect, type Page } from '@playwright/test'
import type { Session } from '../contract/index.ts'
import { sessionCompactionId } from '../server/sessionCompactionIdentity.ts'
import { ms } from './budget.ts'

async function longConversation(page: Page, stamp: string) {
  const tenantId = `tenant-compaction-${stamp}`
  const headers = { 'x-user-id': 'user-grace', 'x-tenant-id': tenantId }
  await page.context().setExtraHTTPHeaders(headers)
  const decision = `Decision Firefly ${stamp}: direct signed and notarized download.`
  const createdResponse = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `compaction walk ${stamp}` },
    headers,
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as { id: string }

  for (let turn = 1; turn <= 4; turn += 1) {
    const text = turn === 1 ? decision : `Compaction follow-up ${turn} ${stamp}`
    const sent = await page.request.post(`/api/v1/sessions/${created.id}/messages`, {
      data: { text },
      headers: { ...headers, 'Idempotency-Key': `compact-${stamp}-${turn}` },
    })
    expect(sent.ok(), `turn ${turn} persisted`).toBe(true)
  }
  return { id: created.id, tenantId, headers, decision }
}

async function leaveAndReturn(page: Page, sessionId: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Models', exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/s/${sessionId}$`))
}

test('a failed compaction stays held across navigation and same-key Retry keeps the archive inspectable', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const context = await longConversation(page, Date.now().toString(36))

  await page.goto(`/s/${context.id}`)
  const compact = page.getByRole('button', { name: 'Compact conversation to free up context' })
  await expect(compact).toBeVisible({ timeout: ms(20_000) })

  const keys: string[] = []
  let fail = true
  await page.route(`**/api/v1/sessions/${context.id}/compact`, async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated compaction outage.' } }),
      })
      return
    }
    await route.continue()
  })
  await compact.evaluate((button) => {
    button.click()
    button.click()
  })
  const recovery = page.locator('[data-session-compaction="failed"]')
  await expect(recovery).toContainText('Couldn’t confirm whether this conversation was compacted')
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  expect(keys).toHaveLength(1)
  expect(keys[0]).not.toBe('')

  await leaveAndReturn(page, context.id)
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled()

  fail = false
  await recovery.getByRole('button', { name: 'Retry', exact: true }).click()
  const summary = page.getByRole('button', { name: /Conversation summary/ })
  await expect(summary).toBeVisible({ timeout: ms(20_000) })
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled()
  // The current summary is also an addressable turn; only four original tail
  // messages remain outside it after compaction.
  await expect(page.locator('[data-turn]').filter({ has: summary })).toHaveCount(1)
  await expect(page.locator('[data-turn]').filter({ hasNot: summary })).toHaveCount(4, { timeout: ms(10_000) })

  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText(/Firefly/, { exact: false }).first()).toBeVisible()
  const archive = page.getByLabel('Archived conversation messages')
  await expect(archive).toBeVisible()
  await expect(archive.getByText(context.decision, { exact: false })).toBeVisible()

  await page.setViewportSize({ width: 320, height: 700 })
  const titleBox = await page.getByText('Conversation summary', { exact: true }).boundingBox()
  const countBox = await page.getByText('4 earlier messages', { exact: true }).boundingBox()
  expect(titleBox).not.toBeNull()
  expect(countBox).not.toBeNull()
  expect(countBox!.y).toBeGreaterThan(titleBox!.y, 'the compact count stacks below the title rather than squeezing both labels')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  const stored = await (await page.request.get(`/api/v1/sessions/${context.id}`, { headers: context.headers })).json() as Session
  expect(stored.compactedMessages).toHaveLength(4)
  expect(stored.messages?.[0]?.content).toContain('Firefly')
  expect(stored.compactionReceiptIds).toContain(sessionCompactionId(context.tenantId, context.id, keys[0]!))
})

test('a committed compaction with a lost response reconciles once without erasing a later turn', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = `${Date.now().toString(36)}-lost`
  const context = await longConversation(page, stamp)
  const stale = await (await page.request.get(`/api/v1/sessions/${context.id}`, { headers: context.headers })).json() as Session
  const keys: string[] = []
  let allowFreshReads = false
  let staleReads = 0
  await page.route(`**/api/v1/sessions/${context.id}/compact`, async (route) => {
    const key = route.request().headers()['idempotency-key'] ?? ''
    keys.push(key)
    const committed = await page.request.post(`/api/v1/sessions/${context.id}/compact`, {
      data: {},
      headers: { ...context.headers, 'Idempotency-Key': key },
    })
    expect(committed.ok()).toBe(true)
    await committed.body()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost.' } }),
    })
  })
  await page.route(`**/api/v1/sessions/${context.id}*`, async (route) => {
    if (route.request().method() === 'GET' && !allowFreshReads) {
      staleReads += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stale) })
      return
    }
    await route.continue()
  })

  await page.goto(`/s/${context.id}`)
  staleReads = 0
  await page.getByRole('button', { name: 'Compact conversation to free up context' }).click()
  await expect.poll(() => staleReads).toBeGreaterThan(0)
  const recovery = page.locator('[data-session-compaction="failed"]')
  await expect(recovery).toContainText('Couldn’t confirm whether this conversation was compacted')
  expect(keys).toHaveLength(1)

  const aftermath = `Conversation after the lost compaction response ${stamp}`
  const later = await page.request.post(`/api/v1/sessions/${context.id}/messages`, {
    data: { text: aftermath },
    headers: { ...context.headers, 'Idempotency-Key': `after-compaction-${stamp}` },
  })
  expect(later.ok()).toBe(true)
  await later.body()
  allowFreshReads = true
  await recovery.getByRole('button', { name: 'Dismiss', exact: true }).click()

  await expect(page.locator('[data-session-compaction]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Conversation summary/ })).toBeVisible()
  await expect(page.locator('[data-turn]').filter({ hasText: aftermath })).toBeVisible()
  expect(keys).toHaveLength(1)

  const stored = await (await page.request.get(`/api/v1/sessions/${context.id}`, { headers: context.headers })).json() as Session
  const expectedId = sessionCompactionId(context.tenantId, context.id, keys[0]!)
  expect(stored.compactionReceiptIds?.filter((id) => id === expectedId)).toHaveLength(1)
  expect(stored.messages?.some((message) => message.content === aftermath)).toBe(true)
})
