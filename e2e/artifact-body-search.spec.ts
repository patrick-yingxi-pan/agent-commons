/** Rendered contract for searching readable current Artifact bodies, distinct
 * from the explicit owner-only saved-version search. */
import { test, expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactItem } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function createArtifact(page: Page, name: string, kind: 'doc' | 'sheet' | 'slide', body: unknown) {
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind, body },
    headers: { 'Idempotency-Key': `artifact-body-search-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = await response.json() as { artifact: ArtifactItem }
  expect(created.artifact.name).toBe(name)
  return created.artifact
}

async function openSearch(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Search', exact: true })
  if (await dialog.isVisible()) return page.getByRole('textbox', { name: 'Search everything' })
  if (page.url() === 'about:blank') await page.goto('/')
  await expect(page.getByRole('button', { name: 'Switch account', exact: true })).toBeVisible()
  // The rail can stay collapsed after the responsive walk; its offscreen
  // desktop button is still DOM-visible. Exercise the public keyboard door.
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByRole('textbox', { name: 'Search everything' })
  await expect(input).toBeVisible()
  return input
}

function artifactResult(page: Page, artifactId: string) {
  return page.locator(`[data-search-result="artifact-${artifactId}"]`)
}

function artifactPage(page: Page, artifactId: string) {
  return page.locator(`[data-artifact-page="${artifactId}"]`)
}

async function searchForArtifact(page: Page, artifact: ArtifactItem, query: string) {
  const input = await openSearch(page)
  await input.fill(query)
  const result = artifactResult(page, artifact.id)
  await expect(result, `the body-only query ${query} locates ${artifact.id}`).toBeVisible()
  await expect(result.locator('span').last(), 'the visible snippet includes the matched current body text').toContainText(query)
  await expect(result.locator('span[title]').first(), 'the query is not being matched from the artifact title').not.toContainText(query)
  return { input, result }
}

async function assertSearchBounds(page: Page, dialog: Locator, result: Locator) {
  const panel = dialog.locator('[data-bounded-dialog="search"]')
  await expect.poll(() => panel.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
  })).toBe(true)
  await expect.poll(() => result.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const panelRect = element.closest('[data-bounded-dialog="search"]')!.getBoundingClientRect()
    return rect.left >= panelRect.left && rect.right <= panelRect.right && rect.top >= panelRect.top && rect.bottom <= panelRect.bottom
  })).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

async function captureCurrentBodyResult(page: Page, result: Locator, testInfo: TestInfo) {
  const dialog = page.getByRole('dialog', { name: 'Search', exact: true })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(dialog).toBeVisible()
    await expect(result).toBeVisible()
    await assertSearchBounds(page, dialog, result)
    await page.screenshot({ path: testInfo.outputPath(`artifact-body-search-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `current Artifact body search ${viewport.width}x${viewport.height}`)
  }
}

async function captureEmptySearch(page: Page, testInfo: TestInfo, label: string, query: string) {
  const dialog = page.getByRole('dialog', { name: 'Search', exact: true })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(dialog).toBeVisible()
    await expect(page.getByText(`No matches for “${query}”.`, { exact: true })).toBeVisible()
    const panel = dialog.locator('[data-bounded-dialog="search"]')
    await expect.poll(() => panel.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    })).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
  }
}

test('current body search shows a matching snippet and opens the exact read-only current Artifact', async ({ page }, testInfo) => {
  test.setTimeout(ms(150_000))
  page.setDefaultTimeout(ms(15_000))
  const stamp = Date.now().toString(36)
  const documentQuery = `laterparagraph${stamp}`
  const workbookQuery = `latertabcell${stamp}`
  const slidesQuery = `laterbullet${stamp}`
  const document = await createArtifact(page, `Search notes ${stamp}.md`, 'doc',
    `A generic opening paragraph.\n\nThe later paragraph contains ${documentQuery} and its current context.`)
  const workbook = await createArtifact(page, `Search workbook ${stamp}.xlsx`, 'sheet', {
    type: 'workbook', sheets: [
      { id: 'overview', name: 'Overview', columns: ['Metric', 'Value'], rows: [['Status', 'Ordinary']] },
      { id: 'details', name: 'Details', columns: ['Metric', 'Value'], rows: [['Body-only', workbookQuery]], note: 'A later-tab note.' },
    ],
  })
  const slides = await createArtifact(page, `Search deck ${stamp}.slides`, 'slide', {
    type: 'slides', slides: [
      { title: 'Opening', bullets: ['A generic opening bullet.'] },
      { title: 'Details', bullets: [`A later slide contains ${slidesQuery}.`] },
    ],
  })

  const bodyMutations: string[] = []
  const currentSearchRequests: string[] = []
  const watchMutations = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === `${API}/search`) currentSearchRequests.push(url.href)
    if (url.pathname.startsWith(`${API}/artifacts/`) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) {
      bodyMutations.push(`${request.method()} ${url.pathname}`)
    }
  }
  page.on('request', watchMutations)
  try {
    const { input, result } = await searchForArtifact(page, document, documentQuery)
    await captureCurrentBodyResult(page, result, testInfo)
    await input.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/artifacts/${document.id}$`))
    const currentDocument = artifactPage(page, document.id)
    await expect(currentDocument.getByRole('heading', { name: document.name, exact: true })).toBeVisible()
    await expect(currentDocument.locator('[data-resource-section="Content"]')).toContainText(documentQuery)
    await expect(currentDocument.locator('[data-artifact-history-body]')).toHaveCount(0)

    const workbookSearch = await searchForArtifact(page, workbook, workbookQuery)
    await workbookSearch.input.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/artifacts/${workbook.id}$`))
    const workbookBody = artifactPage(page, workbook.id)
    const detailsTab = workbookBody.getByRole('tab', { name: 'Details', exact: true })
    await expect(detailsTab).toBeVisible()
    await detailsTab.click()
    await expect(workbookBody.getByRole('tabpanel')).toContainText(workbookQuery)
    await expect(page).not.toHaveURL(/\/history\//)

    const slidesSearch = await searchForArtifact(page, slides, slidesQuery)
    await slidesSearch.input.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/artifacts/${slides.id}$`))
    await expect(artifactPage(page, slides.id)).toContainText(slidesQuery)
    await expect(page).not.toHaveURL(/\/history\//)
    expect(bodyMutations, 'search and opening current artifact pages are read-only').toEqual([])
    expect(currentSearchRequests.length).toBeGreaterThan(0)
    expect(currentSearchRequests.every((request) => new URL(request).searchParams.get('type') !== 'artifactVersion'),
      'ordinary body matches use current-resource search, never the saved-version category').toBe(true)

    const history = await (await page.request.get(`${API}/artifacts/${document.id}/history`)).json()
    expect(history.currentRevision).toBe(0, 'search and opening the current body did not edit or restore it')
  } finally {
    page.off('request', watchMutations)
  }
})

test('body-only search follows shared access, live edits, revocation, and owner-only saved history', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(150_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const oldQuery = `oldbodyonly${stamp}`
  const currentQuery = `currentbodyonly${stamp}`
  const readerSearchRequests: string[] = []
  const watchReaderSearch = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === `${API}/search`) readerSearchRequests.push(url.href)
  }
  reader.page.on('request', watchReaderSearch)
  try {
    const artifact = await createArtifact(owner.page, `Private current body ${stamp}.md`, 'doc',
      `Generic opening excerpt.\n\nThe later block includes ${oldQuery} only.`)
    const grantResponse = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grantResponse.ok(), await grantResponse.text()).toBeTruthy()
    const grant = await grantResponse.json() as { id: string }

    await searchForArtifact(owner.page, artifact, oldQuery)
    const readerSearch = await searchForArtifact(reader.page, artifact, oldQuery)
    const foreignInput = await openSearch(foreign.page)
    await foreignInput.fill(oldQuery)
    await expect(foreign.page.getByText(`No matches for “${oldQuery}”.`, { exact: true })).toBeVisible()
    await expect(artifactResult(foreign.page, artifact.id)).toHaveCount(0)
    await captureCurrentBodyResult(reader.page, readerSearch.result, testInfo)
    await captureEmptySearch(foreign.page, testInfo, 'artifact-body-search-foreign-empty', oldQuery)

    const oldQueryRequestCount = readerSearchRequests.filter((request) => new URL(request).searchParams.get('q') === oldQuery).length
    expect(oldQueryRequestCount).toBeGreaterThan(0, 'a successful owner-created Artifact and active view grant precede the reader current-search request')

    const edit = await owner.page.request.patch(`${API}/artifacts/${artifact.id}/content`, {
      data: { block: 1, text: `The later block now includes ${currentQuery} only.`, expectedRevision: 0 },
    })
    expect(edit.ok(), await edit.text()).toBeTruthy()
    await expect(owner.page.getByText(`No matches for “${oldQuery}”.`, { exact: true })).toBeVisible()
    await expect(reader.page.getByText(`No matches for “${oldQuery}”.`, { exact: true }),
      'the already-open shared-reader search revalidates after the owner edits current content').toBeVisible({ timeout: ms(20_000) })
    await expect.poll(() => readerSearchRequests.filter((request) => new URL(request).searchParams.get('q') === oldQuery).length,
      'the successful body PATCH emits an artifact change that causes the still-open search query to refetch').toBeGreaterThan(oldQueryRequestCount)

    const updatedReaderSearch = await searchForArtifact(reader.page, artifact, currentQuery)
    await expect(updatedReaderSearch.result).toBeVisible()
    await searchForArtifact(owner.page, artifact, currentQuery)

    const ownerSavedInput = owner.page.getByRole('textbox', { name: 'Search everything' })
    await ownerSavedInput.fill(oldQuery)
    await owner.page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
    const ownerVersion = owner.page.locator(`[data-search-result^="artifactVersion-${artifact.id}-"]`)
    await expect(ownerVersion).toBeVisible()
    await expect(ownerVersion).toContainText('Version 0 · Baseline')
    await expect(ownerVersion.locator('span').last()).toContainText(oldQuery)

    const readerCurrentInput = reader.page.getByRole('textbox', { name: 'Search everything' })
    await readerCurrentInput.fill(currentQuery)
    await expect(artifactResult(reader.page, artifact.id)).toBeVisible()
    await reader.page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
    await readerCurrentInput.fill(oldQuery)
    await expect(reader.page.getByText('No matches on this page. Go back to review current results.', { exact: true })).toBeVisible()
    await expect(reader.page.locator(`[data-search-result^="artifactVersion-${artifact.id}-"]`)).toHaveCount(0)

    await reader.page.getByRole('button', { name: 'Current resources', exact: true }).click()
    await readerCurrentInput.fill(currentQuery)
    await expect(artifactResult(reader.page, artifact.id)).toBeVisible()
    const currentQueryRequestCount = readerSearchRequests.filter((request) => new URL(request).searchParams.get('q') === currentQuery).length
    const revoke = await owner.page.request.delete(`${API}/grants/${grant.id}`)
    expect(revoke.ok(), await revoke.text()).toBeTruthy()
    await expect(reader.page.getByText(`No matches for “${currentQuery}”.`, { exact: true }),
      'the open reader search drops the body when its grant is revoked').toBeVisible({ timeout: ms(20_000) })
    await expect(artifactResult(reader.page, artifact.id)).toHaveCount(0)
    await expect.poll(() => readerSearchRequests.filter((request) => new URL(request).searchParams.get('q') === currentQuery).length,
      'the successful grant DELETE invalidates the still-open reader search').toBeGreaterThan(currentQueryRequestCount)
  } finally {
    reader.page.off('request', watchReaderSearch)
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
