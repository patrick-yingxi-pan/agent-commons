/** Rendered contract for explicitly finding, paging, and opening retained
 * Artifact body versions without widening current-resource search. */
import { test, expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactItem, SearchResponse } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function createDocument(page: Page, name: string, body: string) {
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind: 'doc', body },
    headers: { 'Idempotency-Key': `artifact-version-search-create-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = await response.json() as { artifact: ArtifactItem }
  expect(created.artifact.name).toBe(name)
  return created.artifact
}

async function editDocument(page: Page, artifactId: string, expectedRevision: number, text: string) {
  const response = await page.request.patch(`${API}/artifacts/${artifactId}/content`, {
    data: { block: 0, text, expectedRevision },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function openSearch(page: Page) {
  await page.goto('/')
  const opener = page.getByRole('button', { name: 'Search', exact: true })
  await expect(opener).toBeVisible()
  await opener.click()
  const input = page.getByRole('textbox', { name: 'Search everything' })
  await expect(input).toBeVisible()
  return input
}

async function openSavedVersionSearch(page: Page, query: string) {
  const input = await openSearch(page)
  await input.fill(query)
  await page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Current resources', exact: true })).toBeVisible()
  return input
}

function result(page: Page, artifactId: string, revision: number) {
  return page.locator(`[data-search-result="artifactVersion-${artifactId}-${revision}"]`)
}

function artifactPage(page: Page, artifactId: string) {
  return page.locator(`[data-artifact-page="${artifactId}"]`)
}

async function assertNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

async function captureFiveViewports(page: Page, subject: Locator, testInfo: TestInfo, label: string, settleRail = true) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    if (settleRail) await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    if (settleRail) await subject.scrollIntoViewIfNeeded()
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
  }
}

test('explicit saved-version search opens the exact read-only revision, compares without writing, and returns to current', async ({ page }, testInfo) => {
  test.setTimeout(ms(150_000))
  page.setDefaultTimeout(ms(15_000))
  const stamp = Date.now().toString(36)
  const query = `savedversion${stamp}`
  const baseline = `Historical text ${query} ${'detail '.repeat(95)}ends here.`
  const current = `Current-only text ${stamp}.`
  const name = `Long artifact ${'Review notes '.repeat(13)}${stamp}.md`
  const artifact = await createDocument(page, name, baseline)
  await editDocument(page, artifact.id, 0, current)

  const ordinaryInput = await openSearch(page)
  await ordinaryInput.fill(query)
  await expect(page.getByText(`No matches for “${query}”.`, { exact: true })).toBeVisible()
  await expect(page.locator(`[data-search-result^="artifactVersion-${artifact.id}-"]`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Search', exact: true })
  await expect(result(page, artifact.id, 0)).toBeVisible()
  await expect(result(page, artifact.id, 0)).toContainText('Version 0 · Baseline')
  await expect(result(page, artifact.id, 0)).toContainText(baseline.slice(0, 90))
  const versionResult = result(page, artifact.id, 0)
  await expect.poll(() => versionResult.locator('span').last().textContent()).toMatch(/…|ends here\./)

  await captureFiveViewports(page, dialog, testInfo, 'artifact-version-search-dialog', false)
  const restoreRequests: string[] = []
  const currentLibraryRequests: string[] = []
  const watchRestore = (request: import('@playwright/test').Request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === `${API}/artifact-content`) {
      currentLibraryRequests.push(request.url())
    }
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/artifacts/${artifact.id}/history/0/restore`) {
      restoreRequests.push(request.url())
    }
  }
  page.on('request', watchRestore)
  try {
    const searchInput = page.getByRole('textbox', { name: 'Search everything' })
    await expect(versionResult).toHaveAttribute('data-search-active', 'true')
    await searchInput.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}/history/0/match/doc.block.0.p$`))
    await expect(page.getByRole('heading', { name: `${name} · Version 0`, exact: true })).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}/history/0/match/doc.block.0.p$`))
    const detail = artifactPage(page, artifact.id)
    await expect(detail.locator('[data-artifact-history-body]')).toContainText(baseline)
    await expect(detail.getByRole('button', { name: 'Compare with current', exact: true })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeVisible()
    expect(restoreRequests).toEqual([], 'opening a saved version does not restore it')
    expect(currentLibraryRequests).toEqual([], 'opening and reloading an exact version never fetches the current-content library')
    await expect(detail.locator('[data-artifact-history-comparison]')).toHaveCount(0)

    await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
    const comparison = detail.locator('[data-artifact-history-comparison]')
    await expect(comparison).toHaveAttribute('data-comparison-current-revision', '1')
    await expect(comparison).toHaveAttribute('data-comparison-selected-revision', '0')
    await expect(comparison).toContainText(baseline)
    await expect(comparison).toContainText(current)
    await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeVisible()
    await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
    const restoreReview = page.getByRole('dialog', { name: 'Restore artifact version', exact: true })
    await expect(restoreReview).toContainText('current version 1')
    await restoreReview.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(restoreReview).toHaveCount(0)
    expect(restoreRequests).toEqual([], 'opening and cancelling the restore review sends no restore mutation')
    await captureFiveViewports(page, comparison, testInfo, 'artifact-version-compare')
    expect(currentLibraryRequests).toEqual([], 'comparison reads exact history bodies without fetching the current-content library')

    const history = await (await page.request.get(`${API}/artifacts/${artifact.id}/history`)).json()
    expect(history.currentRevision).toBe(1)
    expect(restoreRequests).toEqual([])
    await detail.getByRole('button', { name: 'View version', exact: true }).click()
    await detail.getByRole('button', { name: 'View current artifact', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}$`))
    await expect(artifactPage(page, artifact.id).locator('[data-resource-section="Content"]')).toContainText(current)
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}/history/0/match/doc.block.0.p$`))
    await expect(artifactPage(page, artifact.id).locator('[data-artifact-history-body]')).toContainText(baseline)
    expect((await (await page.request.get(`${API}/artifacts/${artifact.id}/history`)).json()).currentRevision).toBe(1)
    expect(restoreRequests).toEqual([])

    await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
    await page.getByRole('dialog', { name: 'Restore artifact version', exact: true }).getByRole('button', { name: 'Restore version', exact: true }).click()
    await expect(detail.locator('[data-artifact-history-restored]')).toHaveText('Restored version 0 as current version 2. You are still viewing saved version 0.')
    await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}/history/0/match/doc.block.0.p$`))
    await expect.poll(async () => (await (await page.request.get(`${API}/artifacts/${artifact.id}/history`)).json()).currentRevision).toBe(2)
    expect(restoreRequests).toHaveLength(1)
    await page.goto(`/artifacts/${artifact.id}/history/99999`)
    await expect(artifactPage(page, artifact.id).locator('[data-artifact-version-unavailable]')).toContainText('Current content has not been substituted.')
    await expect(artifactPage(page, artifact.id).locator('[data-artifact-history-body]')).toHaveCount(0)
  } finally {
    page.off('request', watchRestore)
  }
})

test('an overlength current search explains the saved-version limit without requesting history and recovers when shortened', async ({ page }) => {
  test.setTimeout(ms(90_000))
  page.setDefaultTimeout(ms(15_000))
  const stamp = Date.now().toString(36)
  const savedQuery = `shortversion${stamp}`
  const artifact = await createDocument(page, `Shorten version search ${stamp}.md`, `Saved body ${savedQuery}`)
  await editDocument(page, artifact.id, 0, `Current body ${stamp}`)
  const historicalRequests: string[] = []
  const watchSearch = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === `${API}/search` && url.searchParams.get('type') === 'artifactVersion') {
      historicalRequests.push(url.href)
    }
  }
  page.on('request', watchSearch)
  try {
    const input = await openSearch(page)
    await input.fill('q'.repeat(257))
    await page.waitForTimeout(250)
    await page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Shorten your query to 256 characters to search saved versions.' })).toHaveText('Shorten your query to 256 characters to search saved versions.')
    await page.waitForTimeout(250)
    expect(historicalRequests).toEqual([], 'an overlength query does not issue any saved-version search request')

    await input.fill(savedQuery)
    await expect(result(page, artifact.id, 0)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Current resources', exact: true })).toBeVisible()
    expect(historicalRequests.length).toBeGreaterThan(0, 'shortening the query resumes saved-version search')
    expect(historicalRequests.every((requestUrl) => new URL(requestUrl).searchParams.get('q') === savedQuery),
      'the prior overlength text is never sent to saved-version search, including during recovery').toBe(true)
  } finally {
    page.off('request', watchSearch)
  }
})

test('saved-version pages distinguish repeated revisions, retain the mode on query changes, and reject stale results', async ({ page }) => {
  test.setTimeout(ms(150_000))
  page.setDefaultTimeout(ms(15_000))
  const stamp = Date.now().toString(36)
  const query = `versionpage${stamp}`
  const rareQuery = `onlyrevision${stamp}`
  const artifact = await createDocument(page, `Version paging ${stamp}.md`, `${query} baseline`)
  for (let revision = 1; revision <= 24; revision += 1) {
    await editDocument(page, artifact.id, revision - 1, `${query} edit ${revision}${revision === 24 ? ` ${rareQuery}` : ''}`)
  }

  const input = await openSavedVersionSearch(page, query)
  const pageOne = page.locator(`[data-search-results] [data-search-result^="artifactVersion-${artifact.id}-"]`)
  await expect(pageOne).toHaveCount(20)
  await expect(page.getByText('1–20 of 25', { exact: true })).toBeVisible()
  const firstKeys = await pageOne.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-search-result')))
  expect(new Set(firstKeys).size).toBe(20, 'revision number participates in each result key')

  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  const pageTwo = page.locator(`[data-search-results] [data-search-result^="artifactVersion-${artifact.id}-"]`)
  await expect(pageTwo).toHaveCount(5)
  await expect(page.getByText('21–25 of 25', { exact: true })).toBeVisible()
  await expect(result(page, artifact.id, 0)).toBeVisible()
  const finalPage = await page.request.get(`${API}/search?q=${encodeURIComponent(query)}&type=artifactVersion&offset=20`)
  expect(finalPage.ok()).toBeTruthy()
  const finalHit = (await finalPage.json() as SearchResponse).groups[0]!.hits[4]!
  expect(finalHit).toMatchObject({ type: 'artifactVersion', id: artifact.id, revision: 0 })
  await result(page, artifact.id, 0).click()
  await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}/history/0/match/doc.block.0.p$`))
  await expect(page.getByRole('heading', { name: `${artifact.name} · Version 0`, exact: true })).toBeVisible()

  const versionInput = await openSavedVersionSearch(page, query)
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page.getByText('21–25 of 25', { exact: true })).toBeVisible()

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let staleHeld = false
  const staleQuery = `${query}slow`
  await page.route('**/api/v1/search*', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('q') === staleQuery && url.searchParams.get('type') === 'artifactVersion') {
      staleHeld = true
      await gate
      return route.continue()
    }
    await route.continue()
  })
  try {
    await versionInput.fill(staleQuery)
    await expect.poll(() => staleHeld).toBe(true)
    await versionInput.fill(rareQuery)
    await expect(result(page, artifact.id, 24)).toBeVisible()
    await expect(page.getByText('1–1 of 1', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Current resources', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'All categories', exact: true })).toHaveCount(0)
    await versionInput.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}/history/24/match/doc.block.0.p$`))
    release()
    await expect(page.locator(`[data-artifact-page="${artifact.id}"][data-artifact-addressed-revision="24"]`)).toBeVisible()
  } finally {
    release()
    await page.unroute('**/api/v1/search*')
  }

  const failureQuery = `${query}retry`
  let failOnce = true
  await page.route('**/api/v1/search*', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('q') === failureQuery && url.searchParams.get('type') === 'artifactVersion' && failOnce) {
      failOnce = false
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary search outage"}' })
    }
    return route.continue()
  })
  try {
    await openSavedVersionSearch(page, failureQuery)
    await expect(page.getByText('Search is unavailable right now.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Retry search', exact: true }).click()
    await expect(page.getByText('No matches on this page. Go back to review current results.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Current resources', exact: true })).toBeVisible()
  } finally {
    await page.unroute('**/api/v1/search*')
  }
})

test('saved-version search and direct history doors remain owner-only through sharing, Trash, and deletion', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(ms(150_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const query = `privateversion${stamp}`
  const baseline = `Owner-only historical ${query}`
  try {
    const artifact = await createDocument(owner.page, `Private version ${stamp}.md`, baseline)
    await editDocument(owner.page, artifact.id, 0, `Current body ${stamp}.`)
    const grantResponse = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grantResponse.ok(), await grantResponse.text()).toBeTruthy()

    await openSavedVersionSearch(reader.page, query)
    await expect(reader.page.getByText('No matches on this page. Go back to review current results.', { exact: true })).toBeVisible()
    await expect(reader.page.getByText('0–0 of 0', { exact: true })).toBeVisible()
    await reader.page.goto(`/artifacts/${artifact.id}/history/0`)
    await expect(reader.page.getByRole('heading', { name: `${artifact.name} · Version 0`, exact: true })).toBeVisible()
    const readerDetail = artifactPage(reader.page, artifact.id)
    await expect(readerDetail.getByRole('status')).toContainText('Saved versions are available only to the artifact owner.')
    await expect(readerDetail.locator('[data-artifact-history-body]')).toHaveCount(0)
    await expect(readerDetail.getByRole('button', { name: /Restore version/ })).toHaveCount(0)
    await foreign.page.goto(`/artifacts/${artifact.id}/history/0`)
    await expect(foreign.page.locator('[data-resource-unavailable]')).toContainText('This artifact isn’t visible from this account (or no longer exists).')
    await expect(foreign.page.getByText(baseline, { exact: false })).toHaveCount(0)
    await openSavedVersionSearch(foreign.page, query)
    await expect(foreign.page.getByText('No matches on this page. Go back to review current results.', { exact: true })).toBeVisible()

    const trashResponse = await owner.page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, {
      data: { state: 'trashed', expectedRevision: 0 },
    })
    expect(trashResponse.ok(), await trashResponse.text()).toBeTruthy()
    await openSavedVersionSearch(owner.page, query)
    const trashedResult = result(owner.page, artifact.id, 0)
    await expect(trashedResult).toBeVisible()
    await expect(trashedResult).toContainText('In Trash')
    await trashedResult.click()
    await expect(owner.page).toHaveURL(new RegExp(`/artifacts/${artifact.id}/history/0/match/doc.block.0.p$`))
    const ownerDetail = artifactPage(owner.page, artifact.id)
    await expect(ownerDetail.locator('[data-artifact-history-body]')).toContainText(baseline)
    await expect(ownerDetail.getByRole('button', { name: /Restore version/ })).toHaveCount(0)
    const previewResponse = await owner.page.request.get(`${API}/artifacts/${artifact.id}/deletion-preview`)
    expect(previewResponse.ok(), await previewResponse.text()).toBeTruthy()
    const preview = await previewResponse.json()
    const deleteResponse = await owner.page.request.delete(`${API}/artifacts/${artifact.id}`, {
      data: { expectedLifecycleRevision: preview.lifecycleRevision, reviewToken: preview.reviewToken },
      headers: { 'Idempotency-Key': `artifact-version-search-delete-${crypto.randomUUID()}` },
    })
    expect(deleteResponse.ok(), await deleteResponse.text()).toBeTruthy()
    const unavailableHistory = await owner.page.request.get(`${API}/artifacts/${artifact.id}/history/0`)
    expect(unavailableHistory.status()).toBe(404)
    await owner.page.goto(`/artifacts/${artifact.id}/history/0`)
    await owner.page.reload()
    await expect(owner.page.locator('[data-resource-unavailable]')).toContainText('This artifact isn’t visible from this account (or no longer exists).')
    await expect(owner.page.locator(`[data-artifact-page="${artifact.id}"]`),
      'a retired revision does not fall through to a current-body Artifact page').toHaveCount(0)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
