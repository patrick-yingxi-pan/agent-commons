/** Rendered direct creation for every authored artifact format. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactItem, CreateProjectResponse } from '../contract/index.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'

const API = '/api/v1'

async function openArtifactDialog(page: Page) {
  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function expectDownload(page: Page, label: string, filename: string) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: label, exact: true }).click()
  expect((await downloadPromise).suggestedFilename()).toBe(filename)
}

const CREATION_VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

async function expectDialogContained(page: Page, dialog: Locator) {
  await expect.poll(async () => {
    const box = await dialog.boundingBox()
    const viewport = page.viewportSize()
    return !!box && !!viewport
      && box.x >= 0 && box.y >= 0
      && box.x + box.width <= viewport.width
      && box.y + box.height <= viewport.height
  }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

async function captureCreation(page: Page, dialog: Locator, action: Locator, testInfo: TestInfo, label: string) {
  await action.scrollIntoViewIfNeeded()
  await action.focus()
  await expect(action).toBeFocused()
  await expect(action).toBeInViewport({ ratio: 1 })
  await expectDialogContained(page, dialog)
  await page.screenshot({ path: testInfo.outputPath(`${label}.png`) })
}

test('documents, sheets, and slides create canonical bodies that survive reload and export', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)

  const documentName = `direct-document-${stamp}.md`
  let dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(documentName)
  await dialog.getByLabel('Content').fill(`Opening ${stamp}.\n\nDurable document paragraph.`)
  await dialog.getByRole('button', { name: 'Create document', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  await expect(page.getByText(`Opening ${stamp}.`, { exact: true })).toBeVisible()
  await expect(page.getByText('Durable document paragraph.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Durable document paragraph.', { exact: true })).toBeVisible()
  await expectDownload(page, 'Download Markdown', documentName)

  const sheetName = `direct-sheet-${stamp}.xlsx`
  dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(sheetName)
  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Metric')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Revenue')
  await dialog.getByRole('button', { name: 'Add column', exact: true }).click()
  await dialog.getByLabel('Sheet column 2', { exact: true }).fill('Value')
  await dialog.getByLabel('Sheet row 1 value 2', { exact: true }).fill('00043')
  await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('th').filter({ hasText: 'Metric' })).toBeVisible()
  await expect(page.locator('td').filter({ hasText: 'Revenue' })).toBeVisible()
  await expect(page.locator('td').filter({ hasText: '00043' })).toBeVisible()
  await page.reload()
  await expect(page.locator('td').filter({ hasText: '00043' })).toBeVisible()
  await expectDownload(page, 'Download XLSX', sheetName)

  const slidesName = `direct-slides-${stamp}.pptx`
  dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(slidesName)
  await dialog.getByLabel('Format').selectOption({ label: 'Slides' })
  await dialog.getByLabel('Slide 1 title').fill('Launch review')
  await dialog.getByRole('button', { name: 'Add bullet to slide 1', exact: true }).click()
  await dialog.getByLabel('Slide 1 bullet 1', { exact: true }).fill('Ship the direct authoring path')
  await dialog.getByRole('button', { name: 'Add slide', exact: true }).click()
  await dialog.getByLabel('Slide 2 title').fill('Next step')
  await dialog.getByRole('button', { name: 'Create slides', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Launch review', { exact: true })).toBeVisible()
  await expect(page.getByText('Ship the direct authoring path', { exact: true })).toBeVisible()
  await expect(page.getByText('Next step', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Next step', { exact: true })).toBeVisible()
  await expectDownload(page, 'Download PowerPoint', slidesName)
})

test('format changes retain separate drafts while name and project remain shared', async ({ page }) => {
  test.setTimeout(ms(30_000))
  const dialog = await openArtifactDialog(page)
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
  await dialog.getByLabel('Name').fill('retained-drafts.artifact')
  await dialog.getByLabel('Project').selectOption({ label: 'Insights dashboard' })
  await dialog.getByLabel('Content').fill('Document draft stays independent.')
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeEnabled()

  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeDisabled()
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Metric')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Retained sheet cell')
  await expect(dialog.getByRole('button', { name: 'Create sheet', exact: true })).toBeEnabled()

  await dialog.getByLabel('Format').selectOption({ label: 'Slides' })
  await expect(dialog.getByRole('button', { name: 'Create slides', exact: true })).toBeDisabled()
  await dialog.getByLabel('Slide 1 title').fill('Retained slide title')
  await dialog.getByRole('button', { name: 'Add bullet to slide 1', exact: true }).click()
  await dialog.getByLabel('Slide 1 bullet 1', { exact: true }).fill('Retained slide bullet')
  await expect(dialog.getByRole('button', { name: 'Create slides', exact: true })).toBeEnabled()

  await dialog.getByLabel('Format').selectOption({ label: 'Document' })
  await expect(dialog.getByLabel('Content')).toHaveValue('Document draft stays independent.')
  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Retained sheet cell')
  await dialog.getByLabel('Format').selectOption({ label: 'Slides' })
  await expect(dialog.getByLabel('Slide 1 title')).toHaveValue('Retained slide title')
  await expect(dialog.getByLabel('Slide 1 bullet 1', { exact: true })).toHaveValue('Retained slide bullet')
  await expect(dialog.getByLabel('Name')).toHaveValue('retained-drafts.artifact')
  await expect(dialog.getByLabel('Project')).toHaveValue('p-insights')
})

test('creation fields and actions remain operable across the canonical viewport matrix', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)

  for (const viewport of CREATION_VIEWPORTS) {
    await page.setViewportSize(viewport)
    const size = `${viewport.width}x${viewport.height}`
    const dialog = await openArtifactDialog(page)
    await dialog.getByLabel('Name').fill(`creation-review-${size}-${stamp}`)

    const createDocument = dialog.getByRole('button', { name: 'Create document', exact: true })
    await expect(createDocument).toBeDisabled()
    await dialog.getByLabel('Content').fill(`Document content for ${size}.\n\nA second paragraph verifies the authored body.`)
    await expect(createDocument).toBeEnabled()
    await captureCreation(page, dialog, createDocument, testInfo, `artifact-create-document-${size}`)

    await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
    const createSheet = dialog.getByRole('button', { name: 'Create sheet', exact: true })
    await expect(createSheet).toBeDisabled()
    await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Metric')
    await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Revenue')
    for (const [column, label, value] of [
      [2, 'Owner', 'Ada'],
      [3, 'Quarter', 'Q4'],
      [4, 'Status', 'Ready'],
      [5, 'Region', 'West'],
      [6, 'Channel', 'Direct'],
      [7, 'Forecast', '43'],
      [8, 'Review', 'Approved'],
    ] as const) {
      await dialog.getByRole('button', { name: 'Add column', exact: true }).click()
      await dialog.getByLabel(`Sheet column ${column}`, { exact: true }).fill(label)
      await dialog.getByLabel(`Sheet row 1 value ${column}`, { exact: true }).fill(value)
    }
    await expect(createSheet).toBeEnabled()
    const sheet = dialog.getByRole('region', { name: 'Edit sheet' })
    if (await sheet.evaluate((node) => node.scrollWidth > node.clientWidth)) {
      await sheet.focus()
      const finalColumn = sheet.locator('th:has(textarea)').last()
      await expect.poll(async () => {
        await sheet.press('ArrowRight')
        return finalColumn.evaluate((node) => {
          const box = node.getBoundingClientRect()
          const parent = node.closest('[role="region"]')!.getBoundingClientRect()
          return box.left >= parent.left - 1 && box.right <= parent.right + 1
        })
      }, { intervals: [16] }).toBe(true)
      expect(await sheet.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
    }
    const [nameWidth, formatWidth] = await Promise.all([
      dialog.getByLabel('Name').evaluate((node) => node.getBoundingClientRect().width),
      dialog.getByLabel('Format').evaluate((node) => node.getBoundingClientRect().width),
    ])
    expect(nameWidth, `Name field width after sheet pan at ${size}`).toBeGreaterThanOrEqual(formatWidth - 1)
    await captureCreation(page, dialog, createSheet, testInfo, `artifact-create-sheet-right-edge-${size}`)

    await dialog.getByLabel('Format').selectOption({ label: 'Slides' })
    const createSlides = dialog.getByRole('button', { name: 'Create slides', exact: true })
    await expect(createSlides).toBeDisabled()
    await dialog.getByLabel('Slide 1 title').fill(`Opening ${size}`)
    await dialog.getByRole('button', { name: 'Add bullet to slide 1', exact: true }).click()
    await dialog.getByLabel('Slide 1 bullet 1', { exact: true }).fill('First retained point')
    for (const slide of [2, 3]) {
      await dialog.getByRole('button', { name: 'Add slide', exact: true }).click()
      await dialog.getByLabel(`Slide ${slide} title`).fill(`Slide ${slide}`)
      await dialog.getByRole('button', { name: `Add bullet to slide ${slide}`, exact: true }).click()
      await dialog.getByLabel(`Slide ${slide} bullet 1`, { exact: true }).fill(`Point for slide ${slide}`)
    }
    await expect(createSlides).toBeEnabled()
    await captureCreation(page, dialog, createSlides, testInfo, `artifact-create-slides-footer-${size}`)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
})

test('same-name authored sheets and slides keep distinct identities and remain foreign-hidden', async ({ browser }) => {
  test.setTimeout(ms(45_000))
  const owner = await newUser(browser)
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const name = `same-name-${Date.now().toString(36)}`
  try {
    const sharedProjectName = `Read-only project ${Date.now().toString(36)}`
    const createdProject = await owner.page.request.post(`${API}/projects`, {
      data: { name: sharedProjectName, description: 'Visible across tenants but writable only by its owner.' },
    })
    expect(createdProject.ok()).toBe(true)
    const sharedProject = ((await createdProject.json()) as CreateProjectResponse).project
    const shared = await owner.page.request.post(`${API}/relations/ops`, {
      data: { op: { kind: 'share-project', projectId: sharedProject.id, projectName: sharedProject.name, shared: true } },
    })
    expect(shared.ok()).toBe(true)
    const foreignDialog = await openArtifactDialog(foreign.page)
    await expect(foreignDialog.getByLabel('Project').locator('option', { hasText: sharedProjectName })).toHaveCount(0)
    await foreignDialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    let dialog = await openArtifactDialog(owner.page)
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
    await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Metric')
    await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Sheet-only value')
    await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const sheetId = owner.page.url().split('/').at(-1)!
    await expect(owner.page.getByText('Sheet-only value', { exact: true })).toBeVisible()

    dialog = await openArtifactDialog(owner.page)
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByLabel('Format').selectOption({ label: 'Slides' })
    await dialog.getByLabel('Slide 1 title').fill('Slides-only title')
    await dialog.getByRole('button', { name: 'Create slides', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const slidesId = owner.page.url().split('/').at(-1)!
    expect(slidesId).not.toBe(sheetId)
    await expect(owner.page.getByText('Slides-only title', { exact: true })).toBeVisible()

    const artifacts = await (await owner.page.request.get(`${API}/artifacts`)).json() as ArtifactItem[]
    expect(artifacts.filter((artifact) => artifact.name === name).map((artifact) => artifact.id).sort()).toEqual([sheetId, slidesId].sort())
    await owner.page.goto(`/artifacts/${sheetId}`)
    await expect(owner.page.getByText('Sheet-only value', { exact: true })).toBeVisible()
    await foreign.page.goto(`/artifacts/${sheetId}`)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
    await foreign.page.goto(`/artifacts/${slidesId}`)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
  } finally {
    await Promise.allSettled([owner.context.close(), foreign.context.close()])
  }
})

test('a lost create response freezes the exact structured draft and reconciles without duplication', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const name = `recovered-sheet-${stamp}.xlsx`
  let attempts = 0
  const keys: string[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })

  await page.route(`**${API}/artifacts`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const request = route.request().postDataJSON() as { kind?: string; name?: string }
    if (request.kind !== 'sheet' || request.name !== name) return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    await gate
    const committed = await route.fetch()
    expect(committed.ok()).toBe(true)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  const dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Metric')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Held exact cell')
  await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByLabel('Name')).toBeDisabled()
  await expect(dialog.getByLabel('Format')).toBeDisabled()
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Held exact cell')
  release()

  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  expect(attempts).toBe(1)
  expect(keys[0]).not.toBe('')
  const artifacts = await (await page.request.get(`${API}/artifacts`)).json() as ArtifactItem[]
  expect(artifacts.filter((artifact) => artifact.name === name)).toHaveLength(1)
  await expect(page.getByText('Held exact cell', { exact: true })).toBeVisible()
})

test('pre-commit failure retains one exact draft across navigation for Retry and Dismiss', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const retryName = `retry-sheet-${stamp}.xlsx`
  const dismissName = `dismiss-document-${stamp}.md`
  const keysByName = new Map<string, string[]>()
  let allowRetry = false

  await page.route(`**${API}/artifacts`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const request = route.request().postDataJSON() as { name?: string }
    if (request.name !== retryName && request.name !== dismissName) return route.continue()
    const keys = keysByName.get(request.name) ?? []
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    keysByName.set(request.name, keys)
    if (request.name === retryName && allowRetry) return route.continue()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit outage.' } }),
    })
  })

  let dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(retryName)
  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Metric')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill('Retry exact cell')
  await dialog.getByRole('button', { name: 'Create sheet', exact: true }).click()
  let failed = page.locator('[data-revisioned-mutation="artifact-create"][data-mutation-status="failed"]')
  await expect(failed).toContainText('Retry safely or Dismiss')
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Retry exact cell')

  await page.evaluate(() => {
    window.history.pushState(null, '', '/projects')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page).toHaveURL(/\/projects$/)
  await expect(failed).toBeVisible()
  await page.evaluate(() => {
    window.history.pushState(null, '', '/artifacts')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page).toHaveURL(/\/artifacts$/)
  dialog = page.getByRole('dialog', { name: 'New artifact' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Name')).toHaveValue(retryName)
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue('Retry exact cell')
  await expect(dialog.getByLabel('Name')).toBeDisabled()
  allowRetry = true
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Retry exact cell', { exact: true })).toBeVisible()
  const retryKeys = keysByName.get(retryName) ?? []
  expect(retryKeys).toHaveLength(2)
  expect(retryKeys[0]).not.toBe('')
  expect(retryKeys[1]).toBe(retryKeys[0])

  dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(dismissName)
  await dialog.getByLabel('Content').fill('Dismiss keeps this exact editable document draft.')
  await dialog.getByRole('button', { name: 'Create document', exact: true }).click()
  failed = page.locator('[data-revisioned-mutation="artifact-create"][data-mutation-status="failed"]')
  await expect(failed).toBeVisible()
  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(dialog).toHaveAttribute('aria-busy', 'false')
  await expect(dialog.getByLabel('Name')).toBeEnabled()
  await expect(dialog.getByLabel('Name')).toHaveValue(dismissName)
  await expect(dialog.getByLabel('Content')).toHaveValue('Dismiss keeps this exact editable document draft.')
  await expect(dialog).toContainText('Creation was not completed. Your draft is ready to review.')
  expect(keysByName.get(dismissName)).toHaveLength(1)
  const artifacts = await (await page.request.get(`${API}/artifacts`)).json() as ArtifactItem[]
  expect(artifacts.filter((artifact) => artifact.name === dismissName)).toHaveLength(0)
})
