/** Rendered document-artifact intake: review first, then explicit adoption. */
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { test, expect, type Locator, type Page, type Browser, type TestInfo } from '@playwright/test'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { assertWcag22Aa } from './accessibility-helpers'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const REVIEW_DIR = '.data/artifact-document-import-review'
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

mkdirSync(REVIEW_DIR, { recursive: true })

type PickedFile = { name: string; mimeType: string; buffer: Buffer }

async function openArtifactDialog(page: Page) {
  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible({ timeout: ms(20_000) })
  return dialog
}

async function chooseFile(page: Page, dialog: Locator, file: PickedFile) {
  const choosing = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await (await choosing).setFiles(file)
}

function importedTextField(dialog: Locator) {
  return dialog.getByRole('textbox', { name: 'Imported text', exact: true })
}

async function expectContained(page: Page, dialog: Locator) {
  await expect.poll(async () => {
    const box = await dialog.locator('[data-bounded-dialog="resource-form"]').boundingBox()
    const viewport = page.viewportSize()
    return !!box && !!viewport && box.x >= 7 && box.y >= 7
      && box.x + box.width <= viewport.width - 7
      && box.y + box.height <= viewport.height - 7
  }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function captureDialog(page: Page, dialog: Locator, testInfo: TestInfo, state: 'review' | 'error') {
  const size = page.viewportSize()!
  await (state === 'review' ? importedTextField(dialog) : dialog.getByRole('alert')).scrollIntoViewIfNeeded()
  await expectContained(page, dialog)
  await assertWcag22Aa(page, `Artifact document import ${state} ${size.width}x${size.height}`)
  await page.screenshot({
    path: `${REVIEW_DIR}/${testInfo.project.name}-${state}-${size.width}x${size.height}.png`,
    fullPage: false,
  })
}

async function captureAllViewports(page: Page, dialog: Locator, testInfo: TestInfo, state: 'review' | 'error') {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await captureDialog(page, dialog, testInfo, state)
  }
}

async function useImportedText(dialog: Locator, expected: string) {
  await expect(importedTextField(dialog)).toHaveValue(expected)
  const action = dialog.getByRole('button', { name: /Use imported text|Replace content with imported text/, exact: true })
  await action.click()
  await expect(importedTextField(dialog)).toHaveCount(0)
  await expect(dialog.getByLabel('Content')).toBeFocused()
}

async function createFromDialog(page: Page, dialog: Locator, name: string, expectedBody: string, suggestedName: string) {
  // The import must have populated the draft; never re-fill Content here or a
  // test could pass while the adoption action was a no-op.
  await expect(dialog.getByLabel('Content')).toHaveValue(expectedBody)
  await expect(dialog.getByLabel('Name')).toHaveValue(suggestedName)
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Create document', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  const artifactId = page.url().split('/').at(-1)!
  const detail = page.locator(`[data-artifact-page="${artifactId}"]`)
  await expect(detail).toBeVisible()
  return { artifactId, detail }
}

async function downloadMarkdown(page: Page, filename: string, expectedBody: string) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Markdown', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  expect(await readFile(path!, 'utf8')).toContain(expectedBody)
}

async function grantArtifact(page: Page, artifactId: string) {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id: artifactId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}

test('text, PDF, and DOCX imports require review before durable document creation', async ({ page, browser }: { page: Page; browser: Browser }) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const textBody = `Imported text body ${stamp}.\n\nA second durable paragraph.`
  const pdfMarker = `Imported PDF body ${stamp}`
  const docxMarker = `Imported DOCX body ${stamp}`
  const importedText = { name: `source-${stamp}.txt`, mimeType: 'text/plain', buffer: Buffer.from(textBody) }
  const importedPdf = { name: `source-${stamp}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture({ pages: [pdfMarker] }) }
  const importedDocx = { name: `source-${stamp}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture({ paragraphs: [docxMarker, 'A second Word paragraph.'] }) }

  const dialog = await openArtifactDialog(page)
  await chooseFile(page, dialog, importedText)
  await expect(dialog.getByRole('status')).toContainText('Review imported text')
  await useImportedText(dialog, textBody)
  const textName = `imported-text-${stamp}.md`
  const textArtifact = await createFromDialog(page, dialog, textName, textBody, `source-${stamp}.md`)
  await expect(textArtifact.detail.locator('p', { hasText: `Imported text body ${stamp}` })).toBeVisible()
  await page.reload()
  await expect(page.locator(`[data-artifact-page="${textArtifact.artifactId}"]`).locator('p', { hasText: 'A second durable paragraph.' })).toBeVisible()
  await downloadMarkdown(page, textName, `Imported text body ${stamp}`)

  const pdfDialog = await openArtifactDialog(page)
  await chooseFile(page, pdfDialog, importedPdf)
  await expect(importedTextField(pdfDialog)).toHaveValue(`[Page 1]\n${pdfMarker}`)
  await useImportedText(pdfDialog, `[Page 1]\n${pdfMarker}`)
  const pdfName = `imported-pdf-${stamp}.md`
  const pdfArtifact = await createFromDialog(page, pdfDialog, pdfName, `[Page 1]\n${pdfMarker}`, `source-${stamp}.md`)
  await expect(pdfArtifact.detail.locator('p', { hasText: pdfMarker })).toBeVisible()
  await page.reload()
  await expect(page.locator(`[data-artifact-page="${pdfArtifact.artifactId}"]`).locator('p', { hasText: pdfMarker })).toBeVisible()
  await downloadMarkdown(page, pdfName, pdfMarker)

  const docxDialog = await openArtifactDialog(page)
  await chooseFile(page, docxDialog, importedDocx)
  const docxBody = `${docxMarker}\nA second Word paragraph.`
  await expect(importedTextField(docxDialog)).toHaveValue(docxBody)
  await useImportedText(docxDialog, docxBody)
  const docxName = `imported-docx-${stamp}.md`
  const docxArtifact = await createFromDialog(page, docxDialog, docxName, docxBody, `source-${stamp}.md`)
  await expect(docxArtifact.detail.locator('p', { hasText: docxMarker })).toBeVisible()
  await page.reload()
  await expect(page.locator(`[data-artifact-page="${docxArtifact.artifactId}"]`).locator('p', { hasText: 'A second Word paragraph.' })).toBeVisible()
  await downloadMarkdown(page, docxName, docxMarker)

  await grantArtifact(page, textArtifact.artifactId)
  await page.goto(`/artifacts/${textArtifact.artifactId}`)
  const ownerDetail = page.locator(`[data-artifact-page="${textArtifact.artifactId}"]`)
  await expect(ownerDetail).toBeVisible()
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const maya = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    await grace.page.goto(`/artifacts/${textArtifact.artifactId}`)
    const graceDetail = grace.page.locator(`[data-artifact-page="${textArtifact.artifactId}"]`)
    await expect(graceDetail.locator('p', { hasText: 'A second durable paragraph.' })).toBeVisible()
    await maya.page.goto(`/artifacts/${textArtifact.artifactId}`)
    await expect(maya.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
    expect((await maya.page.request.get(`${API}/artifacts/${textArtifact.artifactId}`)).status()).toBe(404)

    for (const viewport of VIEWPORTS) {
      const size = `${viewport.width}x${viewport.height}`
      for (const [role, subjectPage, detail] of [
        ['owner-ada', page, ownerDetail],
        ['shared-grace', grace.page, graceDetail],
      ] as const) {
        await subjectPage.setViewportSize(viewport)
        await expect(detail.locator('p', { hasText: 'A second durable paragraph.' })).toBeVisible()
        if (role === 'owner-ada') {
          const edit = detail.getByRole('button', { name: 'Edit block 1', exact: true })
          await edit.locator('..').hover()
          await expect(edit).toBeVisible()
        } else {
          await expect(detail.getByRole('button', { name: 'Edit block 1', exact: true })).toHaveCount(0)
        }
        await expect.poll(() => subjectPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await assertWcag22Aa(subjectPage, `Imported document ${role} ${size}`)
        await subjectPage.screenshot({ path: `${REVIEW_DIR}/${role}-${size}.png`, fullPage: false })
      }
      await maya.page.setViewportSize(viewport)
      await expect(maya.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
      await expect.poll(() => maya.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await assertWcag22Aa(maya.page, `Imported document foreign-maya ${size}`)
      await maya.page.screenshot({ path: `${REVIEW_DIR}/foreign-maya-${size}.png`, fullPage: false })
    }
  } finally {
    await Promise.allSettled([grace.context.close(), maya.context.close()])
  }
})

test('import review preserves authored drafts until explicit replacement and rejects unsafe files', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const draftName = `held-draft-${stamp}.md`
  const originalDraft = `Typed before review ${stamp}.`
  const importedBody = `Candidate imported body ${stamp}.\n\nSecond imported paragraph.`
  const dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(draftName)
  await dialog.getByLabel('Content').fill(originalDraft)
  await chooseFile(page, dialog, { name: `candidate-${stamp}.txt`, mimeType: 'text/plain', buffer: Buffer.from(importedBody) })
  await expect(dialog.getByLabel('Name')).toHaveValue(draftName)
  await expect(dialog.getByLabel('Content')).toHaveValue(originalDraft)
  await captureAllViewports(page, dialog, testInfo, 'review')

  const editedDuringReview = `Edited while review is visible ${stamp}.`
  await dialog.getByLabel('Content').fill(editedDuringReview)
  await expect(importedTextField(dialog)).toHaveValue(importedBody)
  await expect(dialog.getByLabel('Content')).toHaveValue(editedDuringReview)
  await dialog.getByRole('button', { name: 'Replace content with imported text', exact: true }).click()
  await expect(dialog.getByLabel('Content')).toBeFocused()
  await expect(dialog.getByLabel('Content')).toHaveValue(importedBody)
  await expect(dialog.getByLabel('Name')).toHaveValue(draftName)

  const failures: PickedFile[] = [
    { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
    { name: 'malformed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-broken') },
    { name: 'oversize.txt', mimeType: 'text/plain', buffer: Buffer.alloc(20_001, 'x') },
    { name: 'unsupported.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('not a document import') },
  ]
  for (const [index, file] of failures.entries()) {
    await chooseFile(page, dialog, file)
    await expect(dialog.getByRole('alert')).toBeVisible({ timeout: ms(20_000) })
    await expect(dialog.getByLabel('Content')).toHaveValue(importedBody)
    await expect(dialog.getByLabel('Name')).toHaveValue(draftName)
    if (index === 1) await captureAllViewports(page, dialog, testInfo, 'error')
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('document and sheet drafts stay independent, and discarded imports can be reopened', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(`independent-${stamp}.md`)
  await dialog.getByLabel('Content').fill(`Document-only draft ${stamp}.`)
  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await dialog.getByLabel('Sheet column 1', { exact: true }).fill('Metric')
  await dialog.getByLabel('Sheet row 1 value 1', { exact: true }).fill(`Sheet-only value ${stamp}`)
  await dialog.getByLabel('Format').selectOption({ label: 'Document' })
  await expect(dialog.getByLabel('Name')).toHaveValue(`independent-${stamp}.md`)
  await expect(dialog.getByLabel('Content')).toHaveValue(`Document-only draft ${stamp}.`)
  await dialog.getByLabel('Format').selectOption({ label: 'Sheet' })
  await expect(dialog.getByLabel('Sheet row 1 value 1', { exact: true })).toHaveValue(`Sheet-only value ${stamp}`)

  await dialog.getByLabel('Format').selectOption({ label: 'Document' })
  let release!: () => void
  const heldWorker = new Promise<void>((resolve) => { release = resolve })
  let workerEntered = false
  let routeEnteredResolve!: () => void
  const routeEntered = new Promise<void>((resolve) => { routeEnteredResolve = resolve })
  let routeFinished!: () => void
  const routeComplete = new Promise<void>((resolve) => { routeFinished = resolve })
  const pdfWorkerRoute = /pdf\.worker/
  const holdPdfWorker = async (route: import('@playwright/test').Route) => {
    if (!new URL(route.request().url()).searchParams.has('worker_file')) return route.continue()
    workerEntered = true
    routeEnteredResolve()
    try {
      await heldWorker
      try {
        await route.abort()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/Route is already handled|Target page, context or browser has been closed|Request context disposed/i.test(message)) throw error
      }
    } finally {
      routeFinished()
    }
  }
  await page.route(pdfWorkerRoute, holdPdfWorker)
  await chooseFile(page, dialog, { name: 'cancelled.pdf', mimeType: 'application/pdf', buffer: pdfFixture({ pages: ['cancelled import'] }) })
  await expect(dialog.getByRole('status')).toContainText('Reading selected file')
  await expect.poll(() => workerEntered).toBe(true)
  await routeEntered
  await dialog.getByRole('button', { name: 'Cancel import', exact: true }).click()
  release()
  await routeComplete
  await page.unroute(pdfWorkerRoute, holdPdfWorker)
  await expect(importedTextField(dialog)).toHaveCount(0)

  await chooseFile(page, dialog, { name: 'reopen.txt', mimeType: 'text/plain', buffer: Buffer.from('Reopened import body.') })
  await expect(importedTextField(dialog)).toHaveValue('Reopened import body.')
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await expect(importedTextField(dialog)).toHaveCount(0)
  await chooseFile(page, dialog, { name: 'reopen-again.txt', mimeType: 'text/plain', buffer: Buffer.from('Reopened a second time.') })
  await expect(importedTextField(dialog)).toHaveValue('Reopened a second time.')
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
})
