/** Rendered, read-only comparisons between an immutable saved version and the
 * current artifact revision captured for the comparison. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
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
    headers: { 'Idempotency-Key': `artifact-history-compare-create-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = await response.json() as { artifact: ArtifactItem }
  expect(created.artifact.name).toBe(name)
  return created.artifact
}

async function editDocument(page: Page, artifactId: string, revision: number, block: number, text: string) {
  const response = await page.request.patch(`${API}/artifacts/${artifactId}/content`, {
    data: { block, text, expectedRevision: revision },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function editStructuredArtifact(page: Page, artifactId: string, revision: number, content: unknown) {
  const response = await page.request.patch(`${API}/artifacts/${artifactId}/content`, {
    data: { content, expectedRevision: revision },
    headers: { 'Idempotency-Key': `artifact-history-compare-edit-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

function artifactPage(page: Page, id: string) {
  return page.locator(`[data-artifact-page="${id}"]`)
}

async function openArtifact(page: Page, artifact: ArtifactItem) {
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(artifactPage(page, artifact.id)).toBeVisible({ timeout: ms(20_000) })
}

async function captureComparisonState(page: Page, subject: Locator, testInfo: TestInfo, label: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    await expect(subject).toBeInViewport()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
  }
}

async function captureComparisonRecovery(page: Page, subject: Locator, testInfo: TestInfo, label: string) {
  await page.setViewportSize({ width: 375, height: 812 })
  await settleArtifactPageRail(page)
  await expect(subject).toBeVisible()
  await subject.scrollIntoViewIfNeeded()
  await expect(subject).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath(`${label}-375x812.png`) })
  await assertWcag22Aa(page, `${label} 375x812`)
}

async function grantToGrace(page: Page, artifactId: string) {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id: artifactId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}

function compareWrapper(page: Page, artifactId: string) {
  return artifactPage(page, artifactId).locator('[data-artifact-history-comparison]')
}

function side(row: Locator, name: 'before' | 'after') {
  return row.locator(`[data-text-diff-side="${name}"]`)
}

test('owner compares a saved document without writes, refreshes a stale capture, and explicitly restores', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const baseline = `Baseline paragraph ${stamp}.`
  const current = `Current paragraph ${stamp}.`
  const artifact = await createArtifact(page, `compare-doc-${stamp}.md`, 'doc', baseline)
  await editDocument(page, artifact.id, 0, 0, current)
  await openArtifact(page, artifact)
  const detail = artifactPage(page, artifact.id)
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  const versionZero = detail.locator('[data-artifact-history-version="0"]')
  await versionZero.click()

  // Selecting a version keeps the existing saved-body preview as the default;
  // comparison begins only after the owner pins the current revision.
  const preview = detail.locator('[data-artifact-history-body]')
  await expect(preview).toContainText(baseline)
  await expect(detail.locator('[data-artifact-history-comparison]')).toHaveCount(0)
  const restoreRequests: string[] = []
  const countRestore = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/artifacts/${artifact.id}/history/0/restore`) restoreRequests.push(request.url())
  }
  page.on('request', countRestore)
  try {
    await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
    const comparison = compareWrapper(page, artifact.id)
    await expect(comparison).toHaveAttribute('data-comparison-current-revision', '1')
    await expect(comparison).toHaveAttribute('data-comparison-selected-revision', '0')
    const paragraph = comparison.locator('[data-artifact-history-change]').filter({ hasText: 'Block 1 · Paragraph' })
    await expect(paragraph).toBeVisible()
    await expect(side(paragraph, 'before')).toContainText(current)
    await expect(side(paragraph, 'after')).toContainText(baseline)
    await expect(comparison.getByRole('button', { name: 'Restore version 0', exact: true })).toHaveCount(0)
    await expect(detail.locator('[data-artifact-history-body]')).toContainText(baseline)
    expect(restoreRequests).toHaveLength(0)
    const beforeRestore = await (await page.request.get(`${API}/artifacts/${artifact.id}/history`)).json()
    expect(beforeRestore.currentRevision).toBe(1)
    await captureComparisonState(page, comparison, testInfo, 'artifact-history-compare-document')

    // A newer edit cannot rewrite the captured before-side. It disables the
    // restore path until Refresh comparison succeeds against revision 2.
    await editDocument(page, artifact.id, 1, 0, `Concurrent paragraph ${stamp}.`)
    await expect(detail.getByText('Current content changed after this comparison. Refresh it before restoring.', { exact: true })).toBeVisible()
    await expect(side(paragraph, 'before')).toContainText(current)
    await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeDisabled()
    await detail.getByRole('button', { name: 'Refresh comparison', exact: true }).click()
    await expect(comparison).toHaveAttribute('data-comparison-current-revision', '2')
    await expect(side(paragraph, 'before')).toContainText(`Concurrent paragraph ${stamp}.`)

    await detail.getByRole('button', { name: 'View version', exact: true }).click()
    await expect(comparison).toHaveCount(0)
    await expect(detail.locator('[data-artifact-history-body]')).toContainText(baseline)
    // Review and restore the old version while the immutable comparison is
    // still open; a successful restore must leave comparison mode afterward.
    await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
    await expect(compareWrapper(page, artifact.id)).toHaveAttribute('data-comparison-current-revision', '2')
    await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Restore artifact version', exact: true })
    await expect(confirmation).toContainText('current version 2')
    await confirmation.getByRole('button', { name: 'Restore version', exact: true }).click()
    await expect(compareWrapper(page, artifact.id)).toHaveCount(0)
    await expect(detail.locator('[data-artifact-history-version="3"]')).toBeVisible()
    await expect(detail.getByRole('heading', { name: 'Version 3 · Restored from version 0', exact: true })).toBeVisible()
    await expect(detail.locator('[data-artifact-history-body]')).toContainText(baseline)
    await expect(detail.locator('[data-resource-section="Content"]').locator('p', { hasText: baseline })).toBeVisible()
    expect(restoreRequests).toHaveLength(1)
    const history = await (await page.request.get(`${API}/artifacts/${artifact.id}/history`)).json()
    expect(history.currentRevision).toBe(3)
  } finally {
    page.off('request', countRestore)
  }
})

test('comparison shows literal sheet, workbook tab, and slide changes with stable tab identity', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const fixtures = [
    {
      name: `compare-legacy-${stamp}.sheet`, kind: 'sheet' as const,
      before: { type: 'sheet', columns: ['Name', 'Value'], rows: [['Revenue', '10'], ['Empty', '']] },
      after: { type: 'sheet', columns: ['Name', 'Amount'], rows: [['Revenue', '15']] },
      changes: [
        { label: 'Sheet · Header B', before: 'Amount', after: 'Value' },
        { label: 'Sheet · Cell B1', before: '15', after: '10' },
        { label: 'Sheet · Cell B2', before: 'Not present.', after: 'Empty value.' },
      ],
    },
    {
      name: `compare-workbook-${stamp}.sheet`, kind: 'sheet' as const,
      before: { type: 'workbook', sheets: [
        { id: 'summary', name: 'Summary', columns: ['Metric', 'Value'], rows: [['Status', 'Draft']], note: 'Old note' },
        { id: 'details', name: 'Details', columns: ['Field'], rows: [['Owner']] },
      ] },
      after: { type: 'workbook', sheets: [
        { id: 'details', name: 'Details', columns: ['Field'], rows: [['Owner']] },
        { id: 'summary', name: 'Summary', columns: ['Metric', 'Value'], rows: [['Status', 'Ready']], note: 'New note' },
      ] },
      changes: [
        { label: 'Sheet “Summary” · Position', before: '2', after: '1' },
        { label: 'Sheet “Summary” · Cell B1', before: 'Ready', after: 'Draft' },
        { label: 'Sheet “Summary” · Note', before: 'New note', after: 'Old note' },
      ],
    },
    {
      name: `compare-slides-${stamp}.slides`, kind: 'slide' as const,
      before: { type: 'slides', slides: [{ title: 'Quarterly results', bullets: ['Revenue grew', 'Retention improved'] }] },
      after: { type: 'slides', slides: [{ title: 'Quarterly review', bullets: ['Revenue grew', 'Retention softened'] }] },
      changes: [
        { label: 'Slide 1 · Title', before: 'Quarterly review', after: 'Quarterly results' },
        { label: 'Slide 1 · Bullet 2', before: 'Retention softened', after: 'Retention improved' },
      ],
    },
  ]

  for (const fixture of fixtures) {
    const artifact = await createArtifact(page, fixture.name, fixture.kind, fixture.before)
    await editStructuredArtifact(page, artifact.id, 0, fixture.after)
    await openArtifact(page, artifact)
    const detail = artifactPage(page, artifact.id)
    await detail.getByRole('button', { name: 'Load history', exact: true }).click()
    await detail.locator('[data-artifact-history-version="0"]').click()
    await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
    const comparison = compareWrapper(page, artifact.id)
    for (const change of fixture.changes) {
      const row = comparison.locator('[data-artifact-history-change]').filter({ hasText: change.label })
      await expect(row).toBeVisible()
      await expect(side(row, 'before')).toContainText(change.before)
      await expect(side(row, 'after')).toContainText(change.after)
    }
    if (fixture.name.startsWith('compare-workbook-')) {
      const summaryPosition = comparison.locator('[data-artifact-history-change]').filter({ hasText: 'Sheet “Summary” · Position' })
      await expect(side(summaryPosition, 'before')).toContainText('2')
      await expect(side(summaryPosition, 'after')).toContainText('1')
      const stableTabCell = comparison.locator('[data-artifact-history-change]').filter({ hasText: 'Sheet “Summary” · Cell B1' })
      await expect(side(stableTabCell, 'before')).toContainText('Ready')
      await expect(side(stableTabCell, 'after')).toContainText('Draft')
      await expect(comparison.locator('[data-artifact-history-change]').filter({ hasText: 'Sheet “Details” · Position' })).toBeVisible()
    }
  }
})

test('comparison current-version read retries cleanly, switches selections without stale rows, and remains owner-only', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const artifact = await createArtifact(owner.page, `compare-retry-${stamp}.md`, 'doc', `Baseline ${stamp}.`)
  await editDocument(owner.page, artifact.id, 0, 0, `First revision ${stamp}.`)
  await editDocument(owner.page, artifact.id, 1, 0, `Current revision ${stamp}.`)
  await grantToGrace(owner.page, artifact.id)
  try {
    await openArtifact(owner.page, artifact)
    const detail = artifactPage(owner.page, artifact.id)
    await detail.getByRole('button', { name: 'Load history', exact: true }).click()
    await detail.locator('[data-artifact-history-version="0"]').click()
    let requestCount = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    await owner.page.route(`**${API}/artifacts/${artifact.id}/history/2`, async (route) => {
      requestCount += 1
      if (requestCount === 1) {
        await gate
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'retry' } }) })
      }
      if (requestCount === 2) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'retry' } }) })
      return route.continue()
    })
    try {
      const firstRead = owner.page.waitForResponse((response) =>
        response.request().method() === 'GET' && new URL(response.url()).pathname === `${API}/artifacts/${artifact.id}/history/2`)
      const compareClick = detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
      const loadingStatus = detail.getByRole('status').filter({ hasText: 'Loading version comparison…' })
      await expect(loadingStatus).toBeVisible()
      await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeDisabled()
      await expect.poll(() => detail.getByRole('button', { name: 'Restore version 0', exact: true }).evaluate((button) => getComputedStyle(button).opacity)).toBe('0.5')
      await captureComparisonRecovery(owner.page, loadingStatus, testInfo, 'artifact-history-compare-loading')
      await detail.locator('[data-artifact-history-version="1"]').click()
      await expect(detail.locator('[data-artifact-history-body]')).toContainText(`First revision ${stamp}`)
      await expect(compareWrapper(owner.page, artifact.id)).toHaveCount(0)
      release()
      await Promise.all([compareClick, firstRead])
      await detail.locator('[data-artifact-history-version="0"]').click()
      await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
      const comparisonError = detail.getByText('Couldn’t load the versions for comparison.', { exact: true })
      await expect(comparisonError).toBeVisible()
      expect(requestCount).toBe(2)
      await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeDisabled()
      await expect.poll(() => detail.getByRole('button', { name: 'Restore version 0', exact: true }).evaluate((button) => getComputedStyle(button).opacity)).toBe('0.5')
      await captureComparisonRecovery(owner.page, comparisonError, testInfo, 'artifact-history-compare-error')
      await detail.getByRole('button', { name: 'Retry comparison', exact: true }).click()
      const comparison = compareWrapper(owner.page, artifact.id)
      await expect(comparison).toHaveAttribute('data-comparison-selected-revision', '0')
      const paragraph = comparison.locator('[data-artifact-history-change]').filter({ hasText: 'Block 1 · Paragraph' })
      await expect(side(paragraph, 'before')).toContainText(`Current revision ${stamp}`)
      await expect(side(paragraph, 'after')).toContainText(`Baseline ${stamp}`)
      await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeEnabled()
      await expect.poll(() => detail.getByRole('button', { name: 'Restore version 0', exact: true }).evaluate((button) => getComputedStyle(button).opacity)).toBe('1')
      expect(requestCount).toBe(3)
    } finally {
      release()
      await owner.page.unroute(`**${API}/artifacts/${artifact.id}/history/2`)
    }

    for (const account of [reader, foreign]) {
      await account.page.goto(`/artifacts/${artifact.id}`)
      if (account === reader) {
        const readerDetail = artifactPage(account.page, artifact.id)
        await expect(readerDetail).toBeVisible()
        await expect(readerDetail.getByRole('button', { name: 'Load history', exact: true })).toHaveCount(0)
        await expect(readerDetail.getByRole('button', { name: 'Compare with current', exact: true })).toHaveCount(0)
      } else {
        await expect(artifactPage(account.page, artifact.id)).toHaveCount(0)
        await expect(account.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
      }
      expect((await account.page.request.get(`${API}/artifacts/${artifact.id}/history`)).status()).toBe(404)
    }
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('comparison pagination exposes every changed cell across bounded 20-row pages', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const columns = Array.from({ length: 24 }, (_, index) => `Field ${index + 1}`)
  const beforeValues = Array.from({ length: 24 }, (_, index) => `Before ${index + 1} ${stamp}`)
  const afterValues = Array.from({ length: 24 }, (_, index) => `After ${index + 1} ${stamp}`)
  const artifact = await createArtifact(page, `compare-pages-${stamp}.sheet`, 'sheet', {
    type: 'sheet', columns, rows: [beforeValues],
  })
  await editStructuredArtifact(page, artifact.id, 0, { type: 'sheet', columns, rows: [afterValues] })
  await openArtifact(page, artifact)
  const detail = artifactPage(page, artifact.id)
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  await detail.locator('[data-artifact-history-version="0"]').click()
  await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
  const comparison = compareWrapper(page, artifact.id)
  const rows = comparison.locator('[data-artifact-history-change]')
  await expect(rows).toHaveCount(20)
  const firstPageValues = await rows.allTextContents()
  for (const value of beforeValues.slice(0, 20)) expect(firstPageValues.join('\n')).toContain(value)
  await expect(comparison.getByRole('button', { name: 'Previous comparison page', exact: true })).toBeDisabled()
  await comparison.getByRole('button', { name: 'Next comparison page', exact: true }).click()
  await expect(rows).toHaveCount(4)
  const secondPageValues = await rows.allTextContents()
  for (const value of beforeValues.slice(20)) expect(secondPageValues.join('\n')).toContain(value)
  for (const value of afterValues) expect([...firstPageValues, ...secondPageValues].join('\n')).toContain(value)
  await expect(comparison.getByRole('button', { name: 'Next comparison page', exact: true })).toBeDisabled()
  await comparison.getByRole('button', { name: 'Previous comparison page', exact: true }).click()
  await expect(rows).toHaveCount(20)
})

test('identical saved content reports no differences and Trash keeps comparison read-only', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const baseline = `Same saved content ${stamp}.`
  const interim = `Interim saved content ${stamp}.`
  const artifact = await createArtifact(page, `compare-identical-${stamp}.md`, 'doc', baseline)
  await editDocument(page, artifact.id, 0, 0, interim)
  await editDocument(page, artifact.id, 1, 0, baseline)
  await openArtifact(page, artifact)
  let detail = artifactPage(page, artifact.id)
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  await detail.locator('[data-artifact-history-version="0"]').click()
  await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
  let comparison = compareWrapper(page, artifact.id)
  await expect(comparison).toHaveAttribute('data-comparison-current-revision', '2')
  await expect(comparison).toHaveAttribute('data-comparison-selected-revision', '0')
  await expect(comparison.getByText('No content differences.', { exact: true })).toBeVisible()
  await expect(comparison.locator('[data-artifact-history-change]')).toHaveCount(0)
  expect((await (await page.request.get(`${API}/artifacts/${artifact.id}/history`)).json()).currentRevision).toBe(2)

  const trashed = await page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, {
    data: { state: 'trashed', expectedRevision: 0 },
  })
  expect(trashed.ok(), await trashed.text()).toBeTruthy()
  await openArtifact(page, artifact)
  detail = artifactPage(page, artifact.id)
  await expect(detail.getByText('In Trash', { exact: true })).toBeVisible()
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  await detail.locator('[data-artifact-history-version="1"]').click()
  await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
  comparison = compareWrapper(page, artifact.id)
  await expect(comparison).toHaveAttribute('data-comparison-current-revision', '2')
  await expect(comparison).toHaveAttribute('data-comparison-selected-revision', '1')
  const paragraph = comparison.locator('[data-artifact-history-change]').filter({ hasText: 'Block 1 · Paragraph' })
  await expect(side(paragraph, 'before')).toContainText(baseline)
  await expect(side(paragraph, 'after')).toContainText(interim)
  await expect(detail.getByRole('button', { name: /^Restore version/ })).toHaveCount(0)
  expect((await (await page.request.get(`${API}/artifacts/${artifact.id}/history`)).json()).currentRevision).toBe(2)
})

test('comparison refuses a pinned history list when an exact version read reports a newer current revision', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const baseline = `Race baseline ${stamp}.`
  const firstCurrent = `Revision one ${stamp}.`
  const racedCurrent = `Revision two ${stamp}.`
  const artifact = await createArtifact(page, `compare-revision-race-${stamp}.md`, 'doc', baseline)
  await editDocument(page, artifact.id, 0, 0, firstCurrent)
  const revisionOnePage = await (await page.request.get(`${API}/artifacts/${artifact.id}/history`)).json()
  expect(revisionOnePage.currentRevision).toBe(1)

  await openArtifact(page, artifact)
  const detail = artifactPage(page, artifact.id)
  let keepHistoryAtOne = true
  await page.route(`**${API}/artifacts/${artifact.id}/history?*`, async (route) => {
    if (new URL(route.request().url()).pathname !== `${API}/artifacts/${artifact.id}/history`) return route.continue()
    if (keepHistoryAtOne) return route.fulfill({ json: revisionOnePage })
    return route.continue()
  })
  let editedForRace = false
  let exactVersionCurrentRevision: number | undefined
  await page.route(`**${API}/artifacts/${artifact.id}/history/1`, async (route) => {
    if (!editedForRace) {
      editedForRace = true
      await editDocument(page, artifact.id, 1, 0, racedCurrent)
    }
    const response = await route.fetch()
    const payload = await response.json()
    exactVersionCurrentRevision = payload.currentRevision
    expect(payload.currentRevision).toBe(2)
    expect(payload.version.revision).toBe(1)
    return route.fulfill({
      status: response.status(),
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })
  try {
    await detail.getByRole('button', { name: 'Load history', exact: true }).click()
    await expect(detail.locator('[data-artifact-history]')).toHaveAttribute('data-artifact-history-current-revision', '1')
    await detail.locator('[data-artifact-history-version="0"]').click()
    await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
    const comparison = compareWrapper(page, artifact.id)
    await expect(comparison).toHaveAttribute('data-comparison-current-revision', '1')
    expect(exactVersionCurrentRevision).toBe(2)
    const actualHistory = await (await page.request.get(`${API}/artifacts/${artifact.id}/history`)).json()
    expect(actualHistory.currentRevision).toBe(2)
    await expect(detail.locator('[data-artifact-history]')).toHaveAttribute('data-artifact-history-current-revision', '1')
    await expect(detail.getByText('Current content changed after this comparison. Refresh it before restoring.', { exact: true })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeDisabled()
    const paragraph = comparison.locator('[data-artifact-history-change]').filter({ hasText: 'Block 1 · Paragraph' })
    await expect(side(paragraph, 'before')).toContainText(firstCurrent)
    await expect(side(paragraph, 'after')).toContainText(baseline)

    await detail.getByRole('button', { name: 'View version', exact: true }).click()
    await expect(comparison).toHaveCount(0)
    const knownRevisionNotice = detail.getByText('Current content changed. Reload history before restoring.', { exact: true })
    await expect(knownRevisionNotice).toBeVisible()
    await captureComparisonState(page, knownRevisionNotice, testInfo, 'artifact-history-compare-dismissed-stale')
    await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeDisabled()
    await detail.locator('[data-artifact-history-version="1"]').click()
    await detail.locator('[data-artifact-history-version="0"]').click()
    await expect(knownRevisionNotice).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeDisabled()

    await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
    await expect(detail.getByText('Current content changed after this comparison. Refresh it before restoring.', { exact: true })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeDisabled()

    // Only after the stale proof does the list route return real current truth.
    keepHistoryAtOne = false
    await detail.getByRole('button', { name: 'Refresh comparison', exact: true }).click()
    await expect(detail.locator('[data-artifact-history]')).toHaveAttribute('data-artifact-history-current-revision', '2')
    await expect(comparison).toHaveAttribute('data-comparison-current-revision', '2')
    await expect(detail.getByText('Current content changed after this comparison. Refresh it before restoring.', { exact: true })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toBeEnabled()
    await expect(side(paragraph, 'before')).toContainText(racedCurrent)
  } finally {
    await page.unroute(`**${API}/artifacts/${artifact.id}/history?*`)
    await page.unroute(`**${API}/artifacts/${artifact.id}/history/1`)
  }
})
