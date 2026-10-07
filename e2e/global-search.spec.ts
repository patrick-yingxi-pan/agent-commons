/** Rendered contract for global search: bounded overview, fixed paging, doors,
 * stale-query safety, keyboard scrolling, and narrow-layout accessibility. */
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import type { Agent, ArtifactItem, Grant, ModelProvider, SavedContextsSnapshot, SearchResponse, SystemPromptEntry } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const STAMP = Date.now().toString(36)
const QUERY = `searchatlas${STAMP}`
const PAGE_SIZE = 20
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function openSearch(page: Page) {
  await page.goto('/')
  const opener = page.getByRole('button', { name: 'Search', exact: true })
  await expect(opener).toBeVisible()
  await opener.click()
  const input = page.getByRole('textbox', { name: 'Search everything' })
  await expect(input).toBeVisible()
  return input
}

async function createMatchingArtifacts(page: Page, query: string, count: number) {
  const artifacts: ArtifactItem[] = []
  for (let index = 1; index <= count; index += 1) {
    const response = await page.request.post(`${API}/artifacts`, {
      data: {
        name: `${query}-artifact-${String(index).padStart(2, '0')}.md`,
        kind: 'doc',
        body: `Search fixture ${query} item ${index}.`,
      },
      headers: { 'Idempotency-Key': `global-search-${query}-${index}` },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    artifacts.push(((await response.json()) as { artifact: ArtifactItem }).artifact)
  }
  return artifacts
}

function resultButtons(page: Page) {
  return page.locator('[data-search-results] [data-search-result^="artifact-"]')
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

test('global search pages a real result set and opens the exact far-page artifact', async ({ page }) => {
  test.setTimeout(ms(120_000))
  page.setDefaultTimeout(ms(15_000))
  const query = `${QUERY}pages`
  const artifacts = await createMatchingArtifacts(page, query, 45)
  const input = await openSearch(page)
  await input.fill(query)

  const results = resultButtons(page)
  await expect(results).toHaveCount(5)
  await expect(page.getByRole('button', { name: /^Show all Artifacts/ })).toBeVisible()
  await page.getByRole('button', { name: /^Show all Artifacts/ }).click()
  await expect(results).toHaveCount(PAGE_SIZE)
  await expect(page.getByText('1–20 of 45', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(results).toHaveCount(PAGE_SIZE)
  await expect(page.getByText('21–40 of 45', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(results).toHaveCount(5)
  await expect(page.getByText('41–45 of 45', { exact: true })).toBeVisible()
  const lastPage = await page.request.get(`${API}/search?q=${encodeURIComponent(query)}&type=artifact&offset=40`)
  expect(lastPage.ok()).toBeTruthy()
  const targetHit = ((await lastPage.json()) as SearchResponse).groups[0]!.hits[4]!
  const target = artifacts.find((artifact) => artifact.id === targetHit.id)!
  await page.locator(`[data-search-result="artifact-${target.id}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/artifacts/${target.id}/match/0/doc.title$`))
  await expect(page.getByRole('heading', { name: target.name, exact: true })).toBeVisible()
})

test('keyboard search scrolls an offscreen active result and Enter opens its canonical door', async ({ page }) => {
  test.setTimeout(ms(90_000))
  page.setDefaultTimeout(ms(15_000))
  const query = `${QUERY}keyboard`
  await createMatchingArtifacts(page, query, 26)
  const input = await openSearch(page)
  await input.fill(query)
  await page.getByRole('button', { name: /^Show all Artifacts/ }).click()
  const firstPage = await page.request.get(`${API}/search?q=${encodeURIComponent(query)}&type=artifact&offset=0`)
  expect(firstPage.ok()).toBeTruthy()
  const targetHit = ((await firstPage.json()) as SearchResponse).groups[0]!.hits[19]!
  const target = { id: targetHit.id, name: targetHit.title }
  const targetResult = page.locator(`[data-search-result="artifact-${target.id}"]`)
  await expect(targetResult).toBeVisible()
  await expect.poll(() => targetResult.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const container = element.closest('[data-search-results]')!.getBoundingClientRect()
    return bounds.top >= container.top && bounds.bottom <= container.bottom
  })).toBe(false)
  for (let index = 0; index < 19; index += 1) await input.press('ArrowDown')
  await expect(targetResult).toHaveAttribute('data-search-active', 'true')
  await expect.poll(() => targetResult.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const container = element.closest('[data-search-results]')!.getBoundingClientRect()
    return bounds.top >= container.top && bounds.bottom <= container.bottom
  })).toBe(true)
  await input.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/artifacts/${target.id}/match/0/doc.title$`))
  await expect(page.getByRole('heading', { name: target.name, exact: true })).toBeVisible()
})

test('changing a query while paging returns to the overview immediately', async ({ page }) => {
  test.setTimeout(ms(75_000))
  page.setDefaultTimeout(ms(15_000))
  const query = `${QUERY}reset`
  await createMatchingArtifacts(page, query, 26)
  const input = await openSearch(page)
  await input.fill(query)
  await page.getByRole('button', { name: /^Show all Artifacts/ }).click()
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page.getByRole('button', { name: 'All categories', exact: true })).toBeVisible()
  await expect(page.getByText('21–26 of 26', { exact: true })).toBeVisible()

  await input.fill(`${query}nomatch`)
  await expect(page.getByRole('button', { name: 'All categories', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0)
  await expect(page.getByText(new RegExp(`No matches for “${query}nomatch”`))).toBeVisible()
})

test('agent, prompt, provider, and saved context hits open their exact canonical pages', async ({ page }) => {
  test.setTimeout(ms(90_000))
  page.setDefaultTimeout(ms(15_000))
  const agentsResponse = await page.request.get(`${API}/agents`)
  const promptsResponse = await page.request.get(`${API}/system-prompts`)
  const providersResponse = await page.request.get(`${API}/providers`)
  const contextsResponse = await page.request.get(`${API}/saved-contexts`)
  expect(agentsResponse.ok()).toBeTruthy()
  expect(promptsResponse.ok()).toBeTruthy()
  expect(providersResponse.ok()).toBeTruthy()
  expect(contextsResponse.ok()).toBeTruthy()
  const agent = ((await agentsResponse.json()) as Agent[])[0]!
  const prompt = ((await promptsResponse.json()) as SystemPromptEntry[])[0]!
  const provider = ((await providersResponse.json()) as ModelProvider[])[0]!
  const context = ((await contextsResponse.json()) as SavedContextsSnapshot).contexts[0]!
  expect([agent?.id, prompt?.id, provider?.id, context?.id].every(Boolean), 'all four typed search fixtures are present').toBe(true)

  const doors = [
    { type: 'agent', id: agent.id, query: agent.label, path: `/agents/${agent.id}` },
    { type: 'prompt', id: prompt.id, query: prompt.label, path: `/agents/prompts/${prompt.id}` },
    { type: 'model', id: provider.id, query: provider.label, path: `/models/${provider.id}` },
    { type: 'context', id: context.id, query: context.label, path: `/contexts/${context.id}` },
  ]
  for (const door of doors) {
    const input = await openSearch(page)
    await input.fill(door.query)
    const result = page.locator(`[data-search-result="${door.type}-${door.id}"]`)
    await expect(result, `${door.type} ${door.id} is found by its current visible label`).toBeVisible()
    await result.click()
    await expect(page).toHaveURL(new RegExp(`${door.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  }
})

test('query changes discard old hits immediately; a delayed failure exposes Retry without stale selection', async ({ page }) => {
  test.setTimeout(ms(60_000))
  page.setDefaultTimeout(ms(15_000))
  const query = `${QUERY}stale`
  const [oldArtifact] = await createMatchingArtifacts(page, query, 1)
  const input = await openSearch(page)
  await input.fill(query)
  const oldResult = page.locator(`[data-search-result="artifact-${oldArtifact!.id}"]`)
  await expect(oldResult).toBeVisible()

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let failNext = true
  let requestHeld = false
  await page.route('**/api/v1/search*', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('q') === `${query}broken` && failNext) {
      failNext = false
      requestHeld = true
      await gate
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"search unavailable"}' })
      return
    }
    await route.continue()
  })
  await input.fill(`${query}broken`)
  await expect(resultButtons(page)).toHaveCount(0)
  await expect(oldResult).toHaveCount(0)
  await expect.poll(() => requestHeld).toBe(true)
  await expect(page.getByText('Searching…', { exact: true })).toBeVisible()
  await input.press('Enter')
  await expect(page).toHaveURL(/\/$/)
  release()
  await expect(page.getByText('Search is unavailable right now.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible()

  await page.unroute('**/api/v1/search*')
  await page.getByRole('button', { name: 'Retry search', exact: true }).click()
  await expect(page.getByText(new RegExp(`No matches for “${query}broken”`))).toBeVisible()
})

test('search follows owner, shared-reader, and foreign-tenant artifact visibility', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const q = `searchwall${STAMP}`
  try {
    const created = await owner.page.request.post(`${API}/artifacts`, {
      data: { name: `${q}-shared.md`, kind: 'doc', body: `Private body ${q}` },
      headers: { 'Idempotency-Key': `global-search-wall-${STAMP}` },
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const { artifact } = await created.json() as { artifact: ArtifactItem }
    await owner.page.goto('/')
    let input = await openSearch(owner.page)
    await input.fill(q)
    await expect(owner.page.locator(`[data-search-result="artifact-${artifact.id}"]`)).toBeVisible()

    const grantResponse = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grantResponse.ok(), await grantResponse.text()).toBeTruthy()
    const grant = await grantResponse.json() as Grant

    input = await openSearch(reader.page)
    await input.fill(q)
    await expect(reader.page.locator(`[data-search-result="artifact-${artifact.id}"]`)).toBeVisible()
    await reader.page.locator(`[data-search-result="artifact-${artifact.id}"]`).click()
    await expect(reader.page).toHaveURL(new RegExp(`/artifacts/${artifact.id}/match/0/doc.title$`))
    await expect(reader.page.getByRole('heading', { name: artifact.name, exact: true })).toBeVisible()

    input = await openSearch(foreign.page)
    await input.fill(q)
    await expect(foreign.page.getByText(`No matches for “${q}”.`, { exact: true })).toBeVisible()
    await expect(foreign.page.locator(`[data-search-result="artifact-${artifact.id}"]`)).toHaveCount(0)
    await expect(resultButtons(foreign.page)).toHaveCount(0)
    const revoke = await owner.page.request.delete(`${API}/grants/${grant.id}`)
    expect(revoke.ok()).toBeTruthy()
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('a search read failure remains actionable beside matching local Pages', async ({ page }) => {
  const input = await openSearch(page)
  await page.route('**/api/v1/search*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' }))
  await input.fill('Projects')
  const dialog = page.getByRole('dialog', { name: 'Search', exact: true })
  await expect(dialog.locator('[data-search-result="pg-projects"]')).toBeVisible()
  await expect(dialog.getByText('Search is unavailable right now.', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Retry search', exact: true })).toBeEnabled()
  await page.unroute('**/api/v1/search*')
  await dialog.getByRole('button', { name: 'Retry search', exact: true }).click()
  await expect(dialog.getByText('Search is unavailable right now.', { exact: true })).toBeHidden()
  await dialog.locator('[data-search-result="pg-projects"]').click()
  await expect(page).toHaveURL(/\/projects$/)
})

test('overview, paged results, and search failure fit five viewports and pass WCAG 2.2 AA', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(ms(120_000))
  page.setDefaultTimeout(ms(15_000))
  const query = `${QUERY}viewports`
  await createMatchingArtifacts(page, query, 26)
  const input = await openSearch(page)
  await input.fill(query)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(resultButtons(page)).toHaveCount(5)
    await expectNoHorizontalOverflow(page)
    await assertWcag22Aa(page, `global search overview at ${viewport.width}×${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`overview-${viewport.width}x${viewport.height}.png`) })
  }

  await page.getByRole('button', { name: /^Show all Artifacts/ }).click()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(resultButtons(page)).toHaveCount(PAGE_SIZE)
    await expectNoHorizontalOverflow(page)
    await assertWcag22Aa(page, `global search page at ${viewport.width}×${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`page-${viewport.width}x${viewport.height}.png`) })
  }

  await page.route('**/api/v1/search*', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: '{"error":"search unavailable"}',
  }))
  await input.fill(`${query}failure`)
  await expect(page.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectNoHorizontalOverflow(page)
    await assertWcag22Aa(page, `global search failure at ${viewport.width}×${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`failure-${viewport.width}x${viewport.height}.png`) })
  }
})
