/** Rendered contract for opening an exact Artifact search field in its current
 * or retained body, without borrowing a nearby value or widening access. */
import { test, expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactItem } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function createArtifact(page: Page, name: string, kind: 'doc' | 'sheet' | 'slide', body: unknown) {
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind, body },
    headers: { 'Idempotency-Key': `artifact-search-reveal-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = await response.json() as { artifact: ArtifactItem }
  expect(created.artifact.name).toBe(name)
  return created.artifact
}

async function editDocument(page: Page, artifactId: string, expectedRevision: number, block: number, text: string) {
  const response = await page.request.patch(`${API}/artifacts/${artifactId}/content`, {
    data: { block, text, expectedRevision },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

function artifactResult(page: Page, artifactId: string) {
  return page.locator(`[data-search-result="artifact-${artifactId}"]`)
}

function artifactPage(page: Page, artifactId: string) {
  return page.locator(`[data-artifact-page="${artifactId}"]`)
}

async function openSearch(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Search', exact: true })
  if (await dialog.isVisible()) return page.getByRole('textbox', { name: 'Search everything' })
  if (page.url() === 'about:blank') await page.goto('/')
  await expect(page.getByRole('button', { name: 'Switch account', exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByRole('textbox', { name: 'Search everything' })
  await expect(input).toBeVisible()
  return input
}

async function openCurrentResult(page: Page, artifact: ArtifactItem, query: string, urlSuffix: string, fieldPath: string) {
  const input = await openSearch(page)
  await input.fill(query)
  const result = artifactResult(page, artifact.id)
  await expect(result, `body query ${query} finds the exact Artifact`).toBeVisible()
  await input.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}${urlSuffix}$`))
  const detail = artifactPage(page, artifact.id)
  const match = detail.locator(`[data-artifact-search-field="${fieldPath}"]`)
  await expect(match).toHaveAttribute('data-artifact-search-match', 'true')
  await expect(match).toBeFocused()
  await expect(match).toContainText(query)
  await expect.poll(() => match.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const region = element.closest('[aria-label="Sheet preview"]')?.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight &&
      rect.left >= 0 && rect.right <= window.innerWidth &&
      (!region || (rect.left >= region.left && rect.right <= region.right))
  }), `exact field ${fieldPath} is scrolled into the visible reading region`).toBe(true)
  return { input, detail, match }
}

async function captureMatchPage(page: Page, match: Locator, testInfo: TestInfo, label: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await page.getByRole('button', { name: 'Show match', exact: true }).click()
    await expect(match).toBeVisible()
    await expect.poll(() => match.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const region = element.closest('[aria-label="Sheet preview"]')?.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth &&
        (!region || (rect.left >= region.left && rect.right <= region.right))
    }), `${label} remains scrolled into view at ${viewport.width}x${viewport.height}`).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
  }
}

test('current search opens exact Document, Sheet, workbook-tab, and Slides fields and preserves the locator', async ({ page }, testInfo) => {
  test.setTimeout(ms(180_000))
  page.setDefaultTimeout(ms(15_000))
  const stamp = Date.now().toString(36)
  const docQuery = `revealparagraph${stamp}`
  const sheetQuery = `revealsheetcell${stamp}`
  const workbookQuery = `revealworkbookcell${stamp}`
  const slidesQuery = `revealslidebullet${stamp}`
  const document = await createArtifact(page, `Reveal document ${stamp}.md`, 'doc',
    `An opening paragraph.\n\nA later paragraph contains ${docQuery}.`)
  const sheet = await createArtifact(page, `Reveal sheet ${stamp}.csv`, 'sheet', {
    type: 'sheet', columns: ['Label', 'Value'], rows: [['row', sheetQuery]],
  })
  const workbook = await createArtifact(page, `Reveal workbook ${stamp}.xlsx`, 'sheet', {
    type: 'workbook', sheets: [
      { id: 'summary-private-id', name: 'Summary', columns: ['Metric', 'Value'], rows: [['Opening', 'Ordinary']] },
      { id: 'details-private-id', name: 'Details', columns: ['Metric', 'Value'], rows: [['Body-only', workbookQuery]] },
    ],
  })
  const slides = await createArtifact(page, `Reveal slides ${stamp}.pptx`, 'slide', {
    type: 'slides', slides: [
      { title: 'Opening', bullets: ['Ordinary opening'] },
      { title: 'Details', bullets: ['Other detail', slidesQuery] },
    ],
  })

  const bodyMutations: string[] = []
  const watchMutation = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith(`${API}/artifacts/`) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) {
      bodyMutations.push(`${request.method()} ${url.pathname}`)
    }
  }
  page.on('request', watchMutation)
  try {
    const doc = await openCurrentResult(page, document, docQuery, '/match/0/doc.block.1.p', 'doc.block.1.p')
    await expect(doc.detail.locator('[data-artifact-history-body]')).toHaveCount(0)

    await openCurrentResult(page, sheet, sheetQuery, '/match/0/sheet.cell.0.1', 'sheet.cell.0.1')

    const workbookHit = await openCurrentResult(page, workbook, workbookQuery,
      '/match/0/workbook.1.cell.0.1', 'workbook.1.cell.0.1')
    await expect(workbookHit.detail.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute('aria-selected', 'true',
      'the matched later workbook tab is selected without manual intervention')
    await expect(workbookHit.detail.getByRole('tabpanel')).toContainText(workbookQuery)
    await workbookHit.detail.getByRole('tab', { name: 'Summary', exact: true }).click()
    await expect(workbookHit.detail.getByRole('tabpanel')).not.toContainText(workbookQuery)
    await workbookHit.detail.getByRole('button', { name: 'Show match', exact: true }).click()
    await expect(workbookHit.match).toBeFocused()
    await captureMatchPage(page, workbookHit.match, testInfo, 'current-workbook-match')

    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/artifacts/${workbook.id}/match/0/workbook.1.cell.0.1$`))
    await expect(artifactPage(page, workbook.id).locator('[data-artifact-search-match="true"]')).toContainText(workbookQuery)

    const slidesHit = await openCurrentResult(page, slides, slidesQuery,
      '/match/0/slides.1.bullet.1', 'slides.1.bullet.1')
    await expect(slidesHit.detail.locator('[data-artifact-history-body]')).toHaveCount(0)
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/artifacts/${workbook.id}/match/0/workbook.1.cell.0.1$`))
    await expect(artifactPage(page, workbook.id).locator('[data-artifact-search-match="true"]')).toContainText(workbookQuery)
    expect(bodyMutations, 'search-result opening and revelation are read-only').toEqual([])
  } finally {
    page.off('request', watchMutation)
  }
})

test('stale and missing search targets never highlight a substitute field or current body', async ({ page }, testInfo) => {
  test.setTimeout(ms(150_000))
  page.setDefaultTimeout(ms(15_000))
  const stamp = Date.now().toString(36)
  const query = `staleparagraph${stamp}`
  const artifact = await createArtifact(page, `Stale reveal ${stamp}.md`, 'doc', `Opening.\n\n${query} before edit.`)
  await openCurrentResult(page, artifact, query, '/match/0/doc.block.1.p', 'doc.block.1.p')

  await editDocument(page, artifact.id, 0, 1, `Replacement text after the search.`)
  await page.reload()
  const stalePage = artifactPage(page, artifact.id)
  await expect(stalePage.getByRole('status')).toContainText('This artifact changed since this search result.')
  await expect(stalePage.locator('[data-artifact-search-match]')).toHaveCount(0,
    'a stale revision is not redirected to same-position current text')

  await page.goto(`/artifacts/${artifact.id}/match/1/doc.block.88.p`)
  await expect(artifactPage(page, artifact.id).locator('[data-artifact-search-reveal="missing"]')).toContainText(
    'This search location is not available in this body.')
  await expect(artifactPage(page, artifact.id).locator('[data-artifact-search-match]')).toHaveCount(0,
    'a well-formed but nonexistent field does not highlight another field')

  const baseline = `historyneedle${stamp}`
  const historical = await createArtifact(page, `Missing history target ${stamp}.md`, 'doc', baseline)
  await editDocument(page, historical.id, 0, 0, `Current replacement ${stamp}`)
  const savedInput = await openSearch(page)
  await savedInput.fill(baseline)
  await page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
  const savedResult = page.locator(`[data-search-result="artifactVersion-${historical.id}-0"]`)
  await expect(savedResult).toBeVisible()
  await savedInput.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/artifacts/${historical.id}/history/0/match/doc.block.0.p$`))
  const saved = artifactPage(page, historical.id)
  const savedMatch = saved.locator('[data-artifact-search-match="true"]')
  await expect(savedMatch).toContainText(baseline)
  await captureMatchPage(page, savedMatch, testInfo, 'saved-version-match')
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/artifacts/${historical.id}/history/0/match/doc.block.0.p$`))
  await expect(artifactPage(page, historical.id).locator('[data-artifact-search-match="true"]')).toContainText(baseline)
  await page.getByRole('button', { name: 'View current artifact', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/artifacts/${historical.id}$`))
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/artifacts/${historical.id}/history/0/match/doc.block.0.p$`))
  await expect(artifactPage(page, historical.id).locator('[data-artifact-search-match="true"]')).toContainText(baseline)

  await page.goto(`/artifacts/${historical.id}/history/999/match/doc.block.0.p`)
  await expect(artifactPage(page, historical.id).locator('[data-artifact-version-unavailable]')).toContainText(
    'Version 999 is not available')
  await expect(artifactPage(page, historical.id).locator('[data-artifact-history-body]')).toHaveCount(0)
  await expect(artifactPage(page, historical.id).locator('[data-artifact-search-match]')).toHaveCount(0,
    'a missing saved revision never falls through to current content')
})

test('shared readers can reveal current matches while foreign, revoked, and historical access stay walled', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(180_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const query = `sharedreveal${stamp}`
  try {
    const artifact = await createArtifact(owner.page, `Shared reveal ${stamp}.md`, 'doc', `Opening.\n\n${query}`)
    const grantResponse = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grantResponse.ok(), await grantResponse.text()).toBeTruthy()
    const grant = await grantResponse.json() as { id: string }

    const shared = await openCurrentResult(reader.page, artifact, query, '/match/0/doc.block.1.p', 'doc.block.1.p')
    await captureMatchPage(reader.page, shared.match, testInfo, 'shared-current-match')

    const foreignInput = await openSearch(foreign.page)
    await foreignInput.fill(query)
    await expect(foreign.page.getByText(`No matches for “${query}”.`, { exact: true })).toBeVisible()
    await expect(artifactResult(foreign.page, artifact.id)).toHaveCount(0)
    await foreign.page.goto(`/artifacts/${artifact.id}/match/0/doc.block.1.p`)
    await expect(foreign.page.locator('[data-resource-unavailable]')).toContainText(
      'This artifact isn’t visible from this account (or no longer exists).')
    await expect(foreign.page.getByText(query, { exact: true })).toHaveCount(0)
    await expect(foreign.page.locator('[data-artifact-search-match]')).toHaveCount(0)

    await reader.page.goto(`/artifacts/${artifact.id}/history/0/match/doc.block.1.p`)
    const readerHistory = artifactPage(reader.page, artifact.id)
    await expect(readerHistory.getByRole('status')).toContainText('Saved versions are available only to the artifact owner.')
    await expect(readerHistory.locator('[data-artifact-history-body]')).toHaveCount(0)
    await expect(readerHistory.locator('[data-artifact-search-match]')).toHaveCount(0)

    const revoke = await owner.page.request.delete(`${API}/grants/${grant.id}`)
    expect(revoke.ok(), await revoke.text()).toBeTruthy()
    await reader.page.reload()
    await expect(reader.page.locator('[data-resource-unavailable]')).toContainText(
      'This artifact isn’t visible from this account (or no longer exists).')
    await expect(reader.page.getByText(query, { exact: true })).toHaveCount(0)
    await expect(reader.page.locator('[data-artifact-search-match]')).toHaveCount(0)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
