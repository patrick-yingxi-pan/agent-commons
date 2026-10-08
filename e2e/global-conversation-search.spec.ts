/** Rendered contract for global search over current, readable conversation turns. */
import { test, expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { SearchResponse } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { splitPane } from './pane-actions.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

type TurnHit = { messageId: string; role: 'user' | 'assistant'; snippet: string }
type CreatedConversation = { id: string; headers: Record<string, string>; target: TurnHit }

async function createConversation(page: Page, title: string, firstMessage: string): Promise<{ id: string; headers: Record<string, string> }> {
  const headers = {
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-global-conversation-search-${crypto.randomUUID()}`,
  }
  await page.context().setExtraHTTPHeaders(headers)
  const response = await page.request.post(`${API}/sessions`, { data: { title, firstMessage }, headers })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = await response.json() as { id: string }
  expect(created.id).toBeTruthy()
  return { id: created.id, headers }
}

async function postMessage(page: Page, conversation: { id: string; headers: Record<string, string> }, text: string, key: string) {
  const response = await page.request.post(`${API}/sessions/${encodeURIComponent(conversation.id)}/messages`, {
    data: { text },
    headers: { ...conversation.headers, 'Idempotency-Key': key },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}

async function createLongBodyConversation(page: Page, query: string, stamp: string): Promise<CreatedConversation> {
  const conversation = await createConversation(page, `Conversation ${stamp}`, `Neutral opening ${stamp}`)
  const longMatch = `An early reader note contains ${query}. ${'Long context without another match. '.repeat(32)}`
  await postMessage(page, conversation, longMatch, `global-conversation-${stamp}-1`)
  // A second body match proves global search projects one conversation row and
  // chooses the first matching current message, not a later match or summary.
  await postMessage(page, conversation, `A later duplicate ${query} should not replace the first result.`, `global-conversation-${stamp}-2`)
  for (let turn = 3; turn <= 21; turn += 1) {
    await postMessage(page, conversation, `Later neutral exchange ${turn} ${stamp}`, `global-conversation-${stamp}-${turn}`)
  }

  const searchResponse = await page.request.get(`${API}/sessions/${encodeURIComponent(conversation.id)}/search?q=${encodeURIComponent(query)}`, { headers: conversation.headers })
  expect(searchResponse.ok(), await searchResponse.text()).toBeTruthy()
  const search = await searchResponse.json() as { total: number; hits: TurnHit[] }
  expect(search.total).toBe(2)
  const target = search.hits[0]!
  expect(target.role).toBe('user')

  const currentResponse = await page.request.get(`${API}/sessions/${encodeURIComponent(conversation.id)}?messageLimit=40`, { headers: conversation.headers })
  expect(currentResponse.ok()).toBeTruthy()
  const current = await currentResponse.json() as { messages: Array<{ id: string }>; messagePage: { olderCursor?: string } }
  expect(current.messages).toHaveLength(40)
  expect(current.messagePage.olderCursor).toBeTruthy()
  expect(current.messages.some((message) => message.id === target.messageId), 'the match is outside the mounted latest-message window').toBe(false)

  const summariesResponse = await page.request.get(`${API}/sessions`, { headers: conversation.headers })
  expect(summariesResponse.ok()).toBeTruthy()
  const summaries = await summariesResponse.json() as Array<{ id: string; title: string; preview: string }>
  const summary = summaries.find((item) => item.id === conversation.id)
  expect(summary, 'the exact conversation has a list summary').toBeTruthy()
  expect(summary!.title).not.toContain(query)
  expect(summary!.preview).not.toContain(query)
  return { ...conversation, target }
}

async function openGlobalSearch(page: Page) {
  const opener = page.getByRole('button', { name: 'Search', exact: true })
  await expect(opener).toBeVisible()
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Search', exact: true })
  const input = dialog.getByRole('textbox', { name: 'Search everything', exact: true })
  await expect(input).toBeFocused()
  return { opener, dialog, input }
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

async function captureMatrix(page: Page, testInfo: TestInfo, label: string, surface: Locator) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(surface).toBeVisible()
    await noHorizontalOverflow(page)
    await assertWcag22Aa(page, `${label} at ${viewport.width}×${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }
}

test('global search opens the first exact older body match and returns keyboard selection to the focused duplicate pane', async ({ page }, testInfo) => {
  test.setTimeout(ms(180_000))
  page.setDefaultTimeout(ms(15_000))
  const stamp = Date.now().toString(36)
  const query = `bodyonly${stamp}`
  const conversation = await createLongBodyConversation(page, query, stamp)

  // Start from an ordinary resource surface. The body-only token is absent
  // from both the conversation title and its current list preview.
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: ms(20_000) })
  const { dialog, input } = await openGlobalSearch(page)
  await input.fill(query)
  const result = dialog.locator(`[data-search-result="session-${conversation.id}"]`)
  await expect(result).toBeVisible({ timeout: ms(20_000) })
  await expect(dialog.locator('[data-search-result^="session-"]')).toHaveCount(1)
  await expect(result).toContainText('User message')
  const snippet = result.locator('span[title]').last()
  await expect(snippet).toContainText(query)
  await expect(snippet).toHaveClass(/line-clamp-3/)
  expect((await snippet.innerText()).length, 'the rendered match context is bounded').toBeLessThanOrEqual(320)

  const globalResponse = await page.request.get(`${API}/search?q=${encodeURIComponent(query)}`, { headers: conversation.headers })
  expect(globalResponse.ok()).toBeTruthy()
  const global = await globalResponse.json() as SearchResponse
  const group = global.groups.find((item) => item.type === 'session')
  expect(group?.total, 'two matching messages still project one human-initiated conversation row').toBe(1)
  const hit = group?.hits[0]
  expect(hit?.type).toBe('session')
  if (hit?.type !== 'session') throw new Error('expected the exact conversation search result')
  expect(hit.match).toEqual({ messageId: conversation.target.messageId, role: 'user' })

  await captureMatrix(page, testInfo, 'global-conversation-results', result)
  await page.setViewportSize({ width: 1280, height: 800 })
  await result.click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/s/${conversation.id}$`))
  const firstPane = page.locator('[data-main-pane]').first()
  const exactTurn = firstPane.locator(`[data-turn="${conversation.target.messageId}"]`)
  await expect(exactTurn).toBeVisible({ timeout: ms(20_000) })
  await expect(exactTurn).toBeInViewport()
  await expect(exactTurn).toHaveClass(/ring-co\/40/)
  await captureMatrix(page, testInfo, 'global-conversation-landing', exactTurn)

  await page.setViewportSize({ width: 1280, height: 800 })
  const expandRail = page.getByRole('button', { name: 'Expand sidebar', exact: true })
  if (await expandRail.isVisible()) await expandRail.click()
  await expect(page.locator('[data-rail-toolbar-group="view"]').getByRole('button', { name: 'Split pane', exact: true })).toBeInViewport()
  await splitPane(page, 'right')
  const panes = page.locator('[data-main-pane]')
  await expect(panes).toHaveCount(2)
  const paneA = page.locator('[data-main-pane="a"]')
  const paneB = page.locator('[data-main-pane="b"]')
  await expect(paneB).toHaveAttribute('data-focused', 'true')
  await paneA.getByRole('textbox', { name: 'Message', exact: true }).click()
  await expect(paneA).toHaveAttribute('data-focused', 'true')
  await expect(paneB).not.toHaveAttribute('data-focused', 'true')
  await expect(page.locator('[data-main-pane][data-focused="true"]')).toHaveCount(1)

  const duplicateSearch = await openGlobalSearch(page)
  await duplicateSearch.input.fill(query)
  const duplicateResult = duplicateSearch.dialog.locator(`[data-search-result="session-${conversation.id}"]`)
  await expect(duplicateResult).toBeVisible({ timeout: ms(20_000) })
  await expect(duplicateResult).toHaveAttribute('data-search-active', 'true')
  await duplicateSearch.input.press('Enter')
  await expect(duplicateSearch.dialog).toHaveCount(0)
  await expect(paneA).toHaveAttribute('data-focused', 'true')
  await expect(paneA.locator(`[data-turn="${conversation.target.messageId}"]`)).toHaveClass(/ring-co\/40/)
  await expect(paneB.locator(`[data-turn="${conversation.target.messageId}"]`)).toHaveCount(0)
})

test('global conversation search is grant-aware, opens the shared exact turn read-only, and evicts it after revoke', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': `tenant-global-conversation-foreign-${crypto.randomUUID()}` })
  try {
    const stamp = Date.now().toString(36)
    const query = `sharedbody${stamp}`
    const conversation = await createConversation(owner.page, `Shared conversation ${stamp}`, `Neutral opening ${stamp}`)
    await postMessage(owner.page, conversation, `Readable shared turn ${query}.`, `shared-global-search-${stamp}`)
    const searchResponse = await owner.page.request.get(`${API}/sessions/${encodeURIComponent(conversation.id)}/search?q=${encodeURIComponent(query)}`, { headers: conversation.headers })
    expect(searchResponse.ok()).toBeTruthy()
    const search = await searchResponse.json() as { hits: TurnHit[] }
    const target = search.hits[0]!

    const grantResponse = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'session', id: conversation.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
      headers: conversation.headers,
    })
    expect(grantResponse.ok(), await grantResponse.text()).toBeTruthy()
    const grant = await grantResponse.json() as { id: string }

    await foreign.page.goto('/')
    const foreignSearch = await openGlobalSearch(foreign.page)
    await foreignSearch.input.fill(query)
    await expect(foreignSearch.dialog.locator(`[data-search-result="session-${conversation.id}"]`)).toHaveCount(0)
    await expect(foreignSearch.dialog.getByText(`No matches for “${query}”.`, { exact: true })).toBeVisible()

    await reader.page.goto('/')
    const readerSearch = await openGlobalSearch(reader.page)
    await readerSearch.input.fill(query)
    const readerHit = readerSearch.dialog.locator(`[data-search-result="session-${conversation.id}"]`)
    await expect(readerHit).toBeVisible({ timeout: ms(20_000) })
    await expect(readerHit).toContainText('User message')
    await readerHit.click()
    await expect(reader.page).toHaveURL(new RegExp(`/s/${conversation.id}$`))
    const exactTurn = reader.page.locator(`[data-turn="${target.messageId}"]`)
    await expect(exactTurn).toBeVisible({ timeout: ms(20_000) })
    await expect(exactTurn).toHaveClass(/ring-co\/40/)
    const composer = reader.page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toBeDisabled()

    const openSearch = await openGlobalSearch(reader.page)
    await openSearch.input.fill(query)
    const openResult = openSearch.dialog.locator(`[data-search-result="session-${conversation.id}"]`)
    await expect(openResult).toBeVisible()
    const revoked = await owner.page.request.delete(`${API}/grants/${encodeURIComponent(grant.id)}`, { headers: conversation.headers })
    expect(revoked.ok(), await revoked.text()).toBeTruthy()
    await expect(openResult, 'grant revocation removes the row from the already-open live global search').toHaveCount(0, { timeout: ms(20_000) })
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('global search reports an exact stale-turn miss and follows a newly persisted current message', async ({ page }) => {
  test.setTimeout(ms(90_000))
  page.setDefaultTimeout(ms(15_000))
  const stamp = Date.now().toString(36)
  const staleQuery = `staleturn${stamp}`
  const liveQuery = `newlypersisted${stamp}`
  const conversation = await createConversation(page, `Search recovery ${stamp}`, `Neutral setup ${stamp}`)
  await postMessage(page, conversation, `A current searchable turn ${staleQuery}.`, `stale-search-${stamp}`)

  await page.goto('/projects')
  let search = await openGlobalSearch(page)
  let injected = false
  await page.route('**/api/v1/search*', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('q') !== staleQuery || injected) return route.continue()
    const response = await route.fetch()
    const payload = await response.json() as SearchResponse
    const group = payload.groups.find((item) => item.type === 'session')
    const hit = group?.hits.find((item) => item.id === conversation.id)
    if (hit?.type !== 'session' || !hit.match) throw new Error('the stale-message fixture has an exact current session hit')
    hit.match = { messageId: `removed-${crypto.randomUUID()}`, role: hit.match.role }
    injected = true
    await route.fulfill({ response, json: payload })
  })
  await search.input.fill(staleQuery)
  const staleHit = search.dialog.locator(`[data-search-result="session-${conversation.id}"]`)
  await expect(staleHit).toBeVisible({ timeout: ms(20_000) })
  expect(injected, 'the fixture actually replaces the exact hit message id').toBe(true)
  await staleHit.click()
  const missing = page.getByText('This message is no longer in the current conversation. It may have been compacted or removed.', { exact: true })
  await expect(missing).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(missing).toHaveCount(0)
  await page.unroute('**/api/v1/search*')

  search = await openGlobalSearch(page)
  await search.input.fill(liveQuery)
  await expect(search.dialog.getByText(`No matches for “${liveQuery}”.`, { exact: true })).toBeVisible({ timeout: ms(20_000) })
  await postMessage(page, conversation, `A new live message includes ${liveQuery}.`, `live-global-search-${stamp}`)
  const liveHit = search.dialog.locator(`[data-search-result="session-${conversation.id}"]`)
  await expect(liveHit, 'an already-open global search follows the newly persisted message').toBeVisible({ timeout: ms(20_000) })
  await expect(liveHit).toContainText('User message')
  await expect(liveHit.locator('span[title]').last()).toContainText(liveQuery)
})

test('a first search arrival waits for initial truth and retries a failed read without claiming the turn disappeared', async ({ page }) => {
  test.setTimeout(ms(75_000))
  const stamp = Date.now().toString(36)
  const query = `firstread${stamp}`
  const conversation = await createConversation(page, `Initial read ${stamp}`, `Neutral setup ${stamp}`)
  await postMessage(page, conversation, `Target ${query}`, `first-read-${stamp}`)
  const found = await page.request.get(`${API}/sessions/${conversation.id}/search?q=${query}`)
  expect(found.ok()).toBeTruthy()
  const matches = await found.json() as { hits: TurnHit[] }
  expect(matches.hits).toHaveLength(1)
  const targetId = matches.hits[0]!.messageId
  await page.goto('/projects')
  const search = await openGlobalSearch(page)
  await search.input.fill(query)
  const hit = search.dialog.locator(`[data-search-result="session-${conversation.id}"]`)
  await expect(hit).toBeVisible()
  let release!: () => void
  let held = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/v1/sessions/${conversation.id}?*`, async route => {
    held = true
    await gate
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary read outage"}' })
  })
  await hit.click()
  await expect.poll(() => held).toBe(true)
  const missing = page.getByText('This message is no longer in the current conversation. It may have been compacted or removed.', { exact: true })
  try {
    await expect(page.getByText('Finding message in earlier history…', { exact: true })).toBeVisible()
    await expect(missing).toHaveCount(0)
  } finally {
    release()
  }
  await expect(page.getByText('Couldn’t load this conversation yet.', { exact: true })).toBeVisible()
  await expect(missing).toHaveCount(0)
  await page.unroute(`**/api/v1/sessions/${conversation.id}?*`)
  await page.getByRole('button', { name: 'Retry loading conversation', exact: true }).click()
  const exactTurn = page.locator(`[data-turn="${targetId}"]`)
  await expect(exactTurn).toHaveCount(1)
  await expect(exactTurn).toContainText(`Target ${query}`)
  await expect(exactTurn).toHaveClass(/ring-co\/40/)
  await expect(missing).toHaveCount(0)
})
