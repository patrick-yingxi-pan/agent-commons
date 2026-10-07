/** Rendered contract for finding saved messages in bounded conversation history. */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const API = '/api/v1'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function createLongConversation(page: Page, needle: string) {
  const headers = {
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-conversation-search-${crypto.randomUUID()}`,
  }
  await page.context().setExtraHTTPHeaders(headers)
  const createdResponse = await page.request.post(`${API}/sessions`, {
    data: { firstMessage: `oldest ${needle} exact first message` }, headers,
  })
  expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy()
  const created = await createdResponse.json() as { id: string }
  for (let turn = 1; turn <= 21; turn += 1) {
    const sent = await page.request.post(`${API}/sessions/${created.id}/messages`, {
      data: { text: `${needle} later turn ${turn}` },
      headers: { ...headers, 'Idempotency-Key': `conversation-search-${needle}-${turn}` },
    })
    expect(sent.ok(), `turn ${turn} persisted`).toBeTruthy()
  }
  const overview = await page.request.get(`${API}/sessions/${created.id}?messageLimit=40`, { headers })
  expect(overview.ok()).toBeTruthy()
  const session = await overview.json() as { messages: { id: string }[]; messagePage: { olderCursor?: string } }
  expect(session.messages).toHaveLength(40)
  expect(session.messagePage.olderCursor).toBeTruthy()
  const search = await page.request.get(`${API}/sessions/${created.id}/search?q=${encodeURIComponent(needle)}`, { headers })
  expect(search.ok()).toBeTruthy()
  const results = await search.json() as { total: number; hits: { messageId: string }[] }
  expect(results.total).toBeGreaterThan(20)
  return { id: created.id, headers, targetId: results.hits[0]!.messageId, total: results.total }
}

async function openConversationSearch(page: Page) {
  const opener = page.getByRole('button', { name: 'Find in conversation', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Find in conversation', exact: true })
  const input = dialog.getByRole('textbox', { name: 'Find in conversation', exact: true })
  await expect(input).toBeFocused()
  return { opener, dialog, input }
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

test('conversation search pages and opens an exact message beyond the mounted history window', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(ms(120_000))
  page.setDefaultTimeout(ms(15_000))
  const needle = `atlas${Date.now().toString(36)}`
  const session = await createLongConversation(page, needle)
  await page.goto(`/s/${session.id}`)
  const rows = page.locator('[data-turn]')
  await expect(rows).toHaveCount(40, { timeout: ms(20_000) })
  const { dialog, input } = await openConversationSearch(page)
  await input.fill(needle)
  await expect(dialog.locator('[data-conversation-search-result]')).toHaveCount(20)
  await expect(dialog.getByText(new RegExp(`1–20 of ${session.total} messages`))).toBeVisible()
  await dialog.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(dialog.locator('[data-conversation-search-result]')).toHaveCount(Math.min(20, session.total - 20))
  const pageEnd = Math.min(40, session.total)
  await expect(dialog.getByText(new RegExp(`21–${pageEnd} of ${session.total} messages`))).toBeVisible()
  await dialog.getByRole('button', { name: 'Previous page', exact: true }).click()

  const target = dialog.locator(`[data-conversation-search-result="${session.targetId}"]`)
  await expect(target).toBeVisible()
  await target.click()
  await expect(dialog).toHaveCount(0)
  const exactTurn = page.locator(`[data-turn="${session.targetId}"]`)
  await expect(exactTurn).toBeVisible({ timeout: ms(20_000) })
  await expect(exactTurn).toBeInViewport()
  await expect(exactTurn).toHaveClass(/ring-co\/40/)
  await expect(rows).toHaveCount(40)

  await page.getByRole('button', { name: 'Jump to latest' }).click()
  await expect(rows).toHaveCount(40)
  await expect(rows.last()).toBeInViewport()
  await expect(page.locator(`[data-turn="${session.targetId}"]`)).toHaveCount(0)

  const reopened = await openConversationSearch(page)
  await reopened.input.fill(needle)
  await expect(reopened.dialog.locator('[data-conversation-search-result]')).toHaveCount(20)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(reopened.dialog).toBeVisible()
    await noHorizontalOverflow(page)
    await assertWcag22Aa(page, `conversation search results at ${viewport.width}×${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`conversation-search-${viewport.width}x${viewport.height}.png`) })
  }
  await reopened.input.press('ArrowDown')
  await expect(reopened.dialog.locator('[data-conversation-search-result]').nth(1)).toHaveAttribute('data-search-active', 'true')
  await reopened.input.press('ArrowUp')
  await expect(reopened.dialog.locator('[data-conversation-search-result]').first()).toHaveAttribute('data-search-active', 'true')
  await reopened.input.press('Escape')
  await expect(reopened.dialog).toHaveCount(0)
  await expect(reopened.opener).toBeFocused()

  // An already-open search follows saved turns without requiring a reopen.
  const liveFind = await openConversationSearch(page)
  await liveFind.input.fill(needle)
  await expect(liveFind.dialog.locator('[data-conversation-search-result]')).toHaveCount(20)
  const added = await page.request.post(`${API}/sessions/${session.id}/messages`, {
    data: { text: `${needle} arrived while Find was open` }, headers: session.headers,
  })
  expect(added.ok()).toBeTruthy()
  await expect(liveFind.dialog.getByText(`1–20 of ${session.total + 1} messages`, { exact: true })).toBeVisible()
})

test('query changes discard stale selection and failed reads can be retried', async ({ page }) => {
  test.setTimeout(ms(75_000))
  page.setDefaultTimeout(ms(15_000))
  const needle = `race${Date.now().toString(36)}`
  const session = await createLongConversation(page, needle)
  await page.goto(`/s/${session.id}`)
  const { dialog, input } = await openConversationSearch(page)
  await input.fill(needle)
  const oldHit = dialog.locator(`[data-conversation-search-result="${session.targetId}"]`)
  await expect(oldHit).toBeVisible()

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let held = false
  let failOnce = true
  await page.route(`**/api/v1/sessions/${session.id}/search*`, async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('q') === `${needle}broken` && failOnce) {
      failOnce = false
      held = true
      await gate
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' })
      return
    }
    await route.continue()
  })
  await input.fill(`${needle}broken`)
  await expect(dialog.locator('[data-conversation-search-result]')).toHaveCount(0)
  await expect.poll(() => held).toBe(true)
  await expect(dialog.getByText('Searching…', { exact: true })).toBeVisible()
  await input.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/s/${session.id}$`))
  await expect(dialog).toBeVisible()
  release()
  await expect(dialog.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible()
  await page.unroute(`**/api/v1/sessions/${session.id}/search*`)
  await dialog.getByRole('button', { name: 'Retry search', exact: true }).click()
  await expect(dialog.getByText('No matching messages.', { exact: true })).toBeVisible()
})

test('search visibility follows session grants and the exact turn door works for a shared reader', async ({ page, browser }) => {
  test.setTimeout(ms(90_000))
  page.setDefaultTimeout(ms(15_000))
  const needle = `sharedfind${Date.now().toString(36)}`
  const session = await createLongConversation(page, needle)
  const grantResponse = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
  })
  expect(grantResponse.ok(), await grantResponse.text()).toBeTruthy()
  const granted = await grantResponse.json() as { id: string }
  const reader = await browser.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' } })
  const foreign = await browser.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-maya', 'x-tenant-id': `tenant-conversation-foreign-${crypto.randomUUID()}` } })
  const readerPage = await reader.newPage()
  const foreignPage = await foreign.newPage()
  try {
    readerPage.setDefaultTimeout(ms(15_000))
    foreignPage.setDefaultTimeout(ms(15_000))
    await readerPage.goto(`/s/${session.id}`)
    const { dialog, input } = await openConversationSearch(readerPage)
    await input.fill(needle)
    const hit = dialog.locator(`[data-conversation-search-result="${session.targetId}"]`)
    await expect(hit).toBeVisible()
    await hit.click()
    await expect(readerPage.locator(`[data-turn="${session.targetId}"]`)).toBeVisible({ timeout: ms(20_000) })
    await expect(readerPage.locator(`[data-turn="${session.targetId}"]`)).toHaveClass(/ring-co\/40/)

    const openFind = await openConversationSearch(readerPage)
    await openFind.input.fill(needle)
    await expect(openFind.dialog.locator('[data-conversation-search-result]')).toHaveCount(20)
    const revoked = await page.request.delete(`${API}/grants/${granted.id}`, { headers: session.headers })
    expect(revoked.ok()).toBeTruthy()
    await expect(openFind.dialog.locator('[data-conversation-search-result]')).toHaveCount(0)
    await expect(openFind.dialog.getByRole('alert')).toContainText('Couldn’t search this conversation.')
    await expect(openFind.dialog.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible()

    await foreignPage.goto(`/s/${session.id}`)
    await expect(foreignPage.getByRole('button', { name: 'Find in conversation', exact: true })).toHaveCount(0)
    const hiddenSearch = await foreignPage.request.get(`${API}/sessions/${session.id}/search?q=${encodeURIComponent(needle)}`)
    expect(hiddenSearch.status()).toBe(404)
    await expect(foreignPage.locator('[data-conversation-search-result]')).toHaveCount(0)
  } finally {
    await Promise.allSettled([reader.close(), foreign.close()])
  }
})

test('a stale search hit reaches an explicit missing-message state that can be dismissed', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const needle = `stalehit${Date.now().toString(36)}`
  const session = await createLongConversation(page, needle)
  await page.goto(`/s/${session.id}`)
  const { dialog, input } = await openConversationSearch(page)
  let changed = false
  await page.route(`**/api/v1/sessions/${session.id}/search*`, async (route) => {
    const response = await route.fetch()
    const body = await response.json() as { hits: Array<{ messageId: string }> }
    if (!changed && body.hits.length) {
      changed = true
      body.hits[0]!.messageId = `removed-${crypto.randomUUID()}`
    }
    await route.fulfill({ response, json: body })
  })
  await input.fill(needle)
  const staleHit = dialog.locator('[data-conversation-search-result]').first()
  await expect(staleHit).toBeVisible()
  await staleHit.click()
  const missing = page.getByText('This message is no longer in the current conversation. It may have been compacted or removed.', { exact: true })
  await expect(missing).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(missing).toHaveCount(0)
})

test('selecting an older result retries a failed history read and lands on that message', async ({ page }) => {
  test.setTimeout(ms(90_000))
  page.setDefaultTimeout(ms(15_000))
  const needle = `retryhistory${Date.now().toString(36)}`
  const session = await createLongConversation(page, needle)
  await page.goto(`/s/${session.id}`)
  const { dialog, input } = await openConversationSearch(page)
  let failed = false
  let releaseFailure!: () => void
  const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve })
  let requestHeld = false
  await page.route(`**/api/v1/sessions/${session.id}?*`, async (route) => {
    const url = new URL(route.request().url())
    if (!failed && url.searchParams.has('messageCursor')) {
      failed = true
      requestHeld = true
      await failureGate
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary history outage"}' })
      return
    }
    await route.continue()
  })
  await input.fill(needle)
  await expect(dialog.locator('[data-conversation-search-result]')).toHaveCount(20)
  await dialog.locator(`[data-conversation-search-result="${session.targetId}"]`).click()
  const failure = page.getByText('Couldn’t load the selected message.', { exact: true })
  await expect.poll(() => requestHeld).toBe(true)
  await expect(page.getByText('Finding message in earlier history…', { exact: true })).toBeVisible()
  releaseFailure()
  await expect(failure).toBeVisible({ timeout: ms(20_000) })
  await expect(page.getByRole('button', { name: 'Retry finding message', exact: true })).toBeVisible()
  await page.unroute(`**/api/v1/sessions/${session.id}?*`)
  await page.getByRole('button', { name: 'Retry finding message', exact: true }).click()
  const exactTurn = page.locator(`[data-turn="${session.targetId}"]`)
  await expect(exactTurn).toBeVisible({ timeout: ms(20_000) })
  await expect(exactTurn).toHaveClass(/ring-co\/40/)
  expect(failed).toBe(true)
})

test('search opens the current conversation summary by its exact turn identity', async ({ page }) => {
  test.setTimeout(ms(90_000))
  page.setDefaultTimeout(ms(15_000))
  const stamp = Date.now().toString(36)
  const needle = `Firefly${stamp}`
  const headers = { 'x-user-id': 'user-grace', 'x-tenant-id': `tenant-summary-search-${crypto.randomUUID()}` }
  await page.context().setExtraHTTPHeaders(headers)
  const createdResponse = await page.request.post(`${API}/sessions`, {
    data: { firstMessage: `Summary search preparation ${stamp}` }, headers,
  })
  expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy()
  const created = await createdResponse.json() as { id: string }
  for (let turn = 1; turn <= 4; turn += 1) {
    const text = turn === 1 ? `Decision ${needle}: signed download stays available.` : `Summary search follow-up ${turn} ${stamp}`
    const sent = await page.request.post(`${API}/sessions/${created.id}/messages`, {
      data: { text }, headers: { ...headers, 'Idempotency-Key': `summary-search-${stamp}-${turn}` },
    })
    expect(sent.ok(), `turn ${turn} persisted`).toBeTruthy()
  }
  await page.goto(`/s/${created.id}`)
  await page.getByRole('button', { name: 'Compact conversation to free up context' }).click()
  const summaryToggle = page.getByRole('button', { name: /Conversation summary/ })
  await expect(summaryToggle).toBeVisible({ timeout: ms(25_000) })

  const currentResponse = await page.request.get(`${API}/sessions/${created.id}`, { headers })
  expect(currentResponse.ok()).toBeTruthy()
  const current = await currentResponse.json() as { messages: Array<{ id: string; content: string; compactedFrom?: number }> }
  const summaryMessage = current.messages.find((message) => typeof message.compactedFrom === 'number')
  expect(summaryMessage, 'the compacted transcript contains its current summary marker').toBeTruthy()
  const summaryQuery = summaryMessage!.content.match(/[A-Za-z]{5,}/)?.[0]
  expect(summaryQuery, 'the saved summary contains searchable text').toBeTruthy()
  const response = await page.request.get(`${API}/sessions/${created.id}/search?q=${encodeURIComponent(summaryQuery!)}`, { headers })
  expect(response.ok()).toBeTruthy()
  const search = await response.json() as { hits: Array<{ messageId: string }> }
  expect(search.hits.some((hit) => hit.messageId === summaryMessage!.id), 'the search result points to the current summary marker').toBe(true)
  const summaryId = summaryMessage!.id
  const { dialog, input } = await openConversationSearch(page)
  await input.fill(summaryQuery!)
  const hit = dialog.locator(`[data-conversation-search-result="${summaryId}"]`)
  await expect(hit).toBeVisible()
  await hit.click()
  const summaryTurn = page.locator(`[data-turn="${summaryId}"]`)
  await expect(summaryTurn).toBeVisible()
  await expect(summaryTurn).toBeInViewport()
  await expect(summaryTurn).toHaveClass(/ring-co\/40/)
  await expect(summaryToggle).toHaveAttribute('aria-expanded', 'true')
})
