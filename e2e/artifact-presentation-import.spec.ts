/** Rendered PowerPoint intake: review the structural outline before saving. */
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { test, expect, type Browser, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'
import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'
import type { ArtifactExport } from '../contract/index.ts'
import { pptxFixture } from '../tests/helpers/pptxFixture.mjs'
import { assertWcag22Aa } from './accessibility-helpers'
import { ms } from './budget.ts'
import { API, newUser } from './social-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const REVIEW_DIR = '.data/artifact-presentation-import-review'
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const
const LONG_BULLET = `Long imported bullet ${'x'.repeat(120)}`

mkdirSync(REVIEW_DIR, { recursive: true })

type PickedFile = { name: string; mimeType: string; buffer: Buffer }

function sourceDeck(stamp: string) {
  return {
    name: `source-${stamp}.pptx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: pptxFixture({
      slides: [
        {
          name: 'Deck source',
          shapes: [`Deck title ${stamp}`, 'Intro bullet'],
          table: [['Revenue', '43'], ['Status', 'Ready']],
          hiddenShapes: ['HIDDEN_SHAPE'],
          notes: ['HIDDEN_NOTES'],
        },
        { name: 'Hidden slide', hidden: true, shapes: ['HIDDEN_SLIDE'] },
        { name: 'Final source', shapes: [`Final title ${stamp}`, 'Final bullet', LONG_BULLET] },
        { name: 'Empty visible slide', shapes: ['   '] },
      ],
      slideOrder: [2, 1, 0, 3],
    }),
  }
}

async function openArtifactDialog(page: Page) {
  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Format').selectOption({ label: 'Slides' })
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible({ timeout: ms(20_000) })
  return dialog
}

async function chooseFile(page: Page, dialog: Locator, file: PickedFile) {
  const choosing = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Import file', exact: true }).click()
  await (await choosing).setFiles(file)
}

function importedSlides(dialog: Locator) {
  return dialog.getByRole('region', { name: 'Imported slides', exact: true })
    .locator('[data-structured-artifact-body="slides"]')
}

async function expectPreview(dialog: Locator, stamp: string) {
  const slides = importedSlides(dialog)
  await expect(slides).toBeVisible()
  await expect(slides).toContainText(`Final title ${stamp}`)
  await expect(slides).toContainText(`Deck title ${stamp}`)
  await expect(slides).toContainText('Revenue')
  await expect(slides).toContainText('Status')
  await expect(slides).toContainText('Slide 4')
  await expect(slides).not.toContainText('HIDDEN_SLIDE')
  await expect(slides).not.toContainText('HIDDEN_SHAPE')
  await expect(slides).not.toContainText('HIDDEN_NOTES')
  await expect(slides.getByRole('textbox')).toHaveCount(0)
}

async function expectImportedFields(dialog: Locator, stamp: string) {
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(`Final title ${stamp}`)
  await expect(dialog.getByLabel('Slide 1 bullet 1', { exact: true })).toHaveValue('Final bullet')
  await expect(dialog.getByLabel('Slide 1 bullet 2', { exact: true })).toHaveValue(LONG_BULLET)
  await expect(dialog.getByLabel('Slide 2 title', { exact: true })).toHaveValue(`Deck title ${stamp}`)
  await expect(dialog.getByLabel('Slide 2 bullet 1', { exact: true })).toHaveValue('Intro bullet')
  await expect(dialog.getByLabel('Slide 2 bullet 2', { exact: true })).toHaveValue('Revenue\t43')
  await expect(dialog.getByLabel('Slide 2 bullet 3', { exact: true })).toHaveValue('Status\tReady')
  await expect(dialog.getByLabel('Slide 3 title', { exact: true })).toHaveValue('Slide 4')
  await expect(dialog.getByLabel('Slide 3 bullet 1', { exact: true })).toHaveCount(0)
}

async function expectContained(page: Page, dialog: Locator) {
  await expect.poll(async () => {
    const panel = dialog.locator('[data-bounded-dialog="resource-form"]')
    const box = await panel.boundingBox()
    const viewport = page.viewportSize()
    return !!box && !!viewport && box.x >= 7 && box.y >= 7
      && box.x + box.width <= viewport.width - 7
      && box.y + box.height <= viewport.height - 7
  }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function captureDialog(page: Page, dialog: Locator, testInfo: TestInfo, state: 'review' | 'error') {
  const viewport = page.viewportSize()!
  const subject = state === 'review' ? importedSlides(dialog) : dialog.getByRole('alert')
  await subject.scrollIntoViewIfNeeded()
  await expectContained(page, dialog)
  await assertWcag22Aa(page, `Presentation import ${state} ${viewport.width}x${viewport.height}`)
  await page.screenshot({ path: `${REVIEW_DIR}/${testInfo.project.name}-${state}-${viewport.width}x${viewport.height}.png`, fullPage: false })
}

async function captureDialogMatrix(page: Page, dialog: Locator, testInfo: TestInfo, state: 'review' | 'error') {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await captureDialog(page, dialog, testInfo, state)
  }
}

async function adoptSlides(dialog: Locator, expectedName: string) {
  await expect(dialog.getByRole('button', { name: 'Create slides', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Use imported slides', exact: true }).click()
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toBeFocused()
  await expect(dialog.getByLabel('Name')).toHaveValue(expectedName)
  await expect(dialog.getByRole('button', { name: 'Create slides', exact: true })).toBeEnabled()
}

async function createSlides(page: Page, dialog: Locator, name: string) {
  // The imported fields must already be adopted; this helper never fills them.
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).not.toHaveValue('')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Create slides', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  const id = page.url().split('/').at(-1)!
  const detail = page.locator(`[data-artifact-page="${id}"]`)
  await expect(detail).toBeVisible()
  return { id, detail }
}

async function downloadPresentation(page: Page, filename: string, expectedBytes: Uint8Array) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PowerPoint', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  const bytes = await readFile(path!)
  expect(bytes.equals(Buffer.from(expectedBytes))).toBe(true)
  expect(bytes.subarray(0, 4).toString()).toBe('PK\u0003\u0004')
  const zip = new ZipReader(new Uint8ArrayReader(bytes), { checkSignature: true })
  try {
    const entries = await zip.getEntries()
    const presentation = entries.find((entry) => entry.filename === 'ppt/presentation.xml')
    const slide = entries.find((entry) => entry.filename === 'ppt/slides/slide1.xml')
    expect(presentation?.getData).toBeTruthy()
    expect(slide?.getData).toBeTruthy()
    expect(await presentation!.getData!(new TextWriter())).toContain('<p:presentation')
    expect(await slide!.getData!(new TextWriter())).toContain('Edited title')
  } finally {
    await zip.close()
  }
}

async function grantArtifact(page: Page, id: string) {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}

test('real PPTX import reviews exact outline, creates editable slides, reloads, exports, and shares', async ({ page, browser }: { page: Page; browser: Browser }, testInfo) => {
  test.setTimeout(ms(150_000))
  const stamp = Date.now().toString(36)
  const file = sourceDeck(stamp)
  const dialog = await openArtifactDialog(page)
  await chooseFile(page, dialog, file)
  await expect(dialog.getByRole('status').filter({ hasText: 'Review imported slides' })).toBeVisible()
  await expectPreview(dialog, stamp)
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue('')
  await captureDialogMatrix(page, dialog, testInfo, 'review')
  await adoptSlides(dialog, `source-${stamp}.slides`)
  await expectImportedFields(dialog, stamp)

  const name = `imported-presentation-${stamp}.slides`
  const artifact = await createSlides(page, dialog, name)
  const body = artifact.detail.locator('[data-structured-artifact-body="slides"]')
  await expect(body).toContainText(`Final title ${stamp}`)
  await expect(body).toContainText('Revenue')
  await expect(body).toContainText('Slide 4')
  await expect(artifact.detail.getByRole('button', { name: 'Edit slides', exact: true })).toBeVisible()

  await artifact.detail.getByRole('button', { name: 'Edit slides', exact: true }).click()
  await artifact.detail.getByLabel('Slide 1 title', { exact: true }).fill(`Edited title ${stamp}`)
  await artifact.detail.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(artifact.detail.locator('[data-structured-artifact-body="slides"]')).toContainText(`Edited title ${stamp}`)
  await page.reload()
  await expect(page.locator(`[data-artifact-page="${artifact.id}"] [data-structured-artifact-body="slides"]`)).toContainText(`Edited title ${stamp}`)
  const exportResponse = await page.request.get(`${API}/artifacts/${artifact.id}/export?format=pptx`)
  expect(exportResponse.ok(), await exportResponse.text()).toBeTruthy()
  const exportDescriptor = await exportResponse.json() as ArtifactExport
  await downloadPresentation(page, exportDescriptor.filename, Buffer.from(exportDescriptor.content, 'base64'))

  await grantArtifact(page, artifact.id)
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const maya = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    await grace.page.goto(`/artifacts/${artifact.id}`)
    const graceDetail = grace.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(graceDetail.locator('[data-structured-artifact-body="slides"]')).toContainText(`Edited title ${stamp}`)
    await expect(graceDetail.getByRole('button', { name: 'Edit slides', exact: true })).toHaveCount(0)

    await maya.page.goto(`/artifacts/${artifact.id}`)
    await expect(maya.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
    expect((await maya.page.request.get(`${API}/artifacts/${artifact.id}`)).status()).toBe(404)

    for (const viewport of VIEWPORTS) {
      for (const [role, subjectPage, detail] of [['owner-ada', page, page.locator(`[data-artifact-page="${artifact.id}"]`)], ['shared-grace', grace.page, graceDetail]] as const) {
        await subjectPage.setViewportSize(viewport)
        await settleArtifactPageRail(subjectPage)
        await expect(detail.locator('[data-structured-artifact-body="slides"]')).toBeVisible()
        await expect.poll(() => subjectPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await assertWcag22Aa(subjectPage, `Presentation ${role} ${viewport.width}x${viewport.height}`)
        await subjectPage.screenshot({ path: `${REVIEW_DIR}/${role}-${viewport.width}x${viewport.height}.png`, fullPage: false })
      }
      await maya.page.setViewportSize(viewport)
      await expect(maya.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
      await assertWcag22Aa(maya.page, `Presentation foreign-maya ${viewport.width}x${viewport.height}`)
      await maya.page.screenshot({ path: `${REVIEW_DIR}/foreign-maya-${viewport.width}x${viewport.height}.png`, fullPage: false })
    }
  } finally {
    await Promise.allSettled([grace.context.close(), maya.context.close()])
  }
})

test('presentation drafts stay independent and malformed or over-limit imports never replace them', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(`draft-${stamp}.slides`)
  await dialog.getByLabel('Slide 1 title', { exact: true }).fill(`Existing title ${stamp}`)
  await dialog.getByRole('button', { name: 'Add bullet to slide 1', exact: true }).click()
  await dialog.getByLabel('Slide 1 bullet 1', { exact: true }).fill(`Existing bullet ${stamp}`)
  await dialog.getByLabel('Format').selectOption({ label: 'Document' })
  await dialog.getByLabel('Content').fill(`Independent document draft ${stamp}.`)
  await dialog.getByLabel('Format').selectOption({ label: 'Slides' })
  await expect(dialog.getByLabel('Name')).toHaveValue(`draft-${stamp}.slides`)
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(`Existing title ${stamp}`)
  await expect(dialog.getByLabel('Slide 1 bullet 1', { exact: true })).toHaveValue(`Existing bullet ${stamp}`)

  const valid = sourceDeck(stamp)
  await chooseFile(page, dialog, valid)
  await expectPreview(dialog, stamp)
  await expect(dialog.getByRole('button', { name: 'Replace slides with imported slides', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(`Existing title ${stamp}`)
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await expect(importedSlides(dialog)).toHaveCount(0)
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(`Existing title ${stamp}`)
  await chooseFile(page, dialog, { name: 'broken.pptx', mimeType: valid.mimeType, buffer: Buffer.from('not a pptx') })
  await expect(dialog.getByRole('alert')).toContainText(/presentation|read|complete/i)
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(`Existing title ${stamp}`)
  await captureDialogMatrix(page, dialog, testInfo, 'error')

  const longTitle = 'x'.repeat(300)
  await chooseFile(page, dialog, { name: 'oversized-title.pptx', mimeType: valid.mimeType, buffer: pptxFixture({ slides: [{ shapes: [longTitle] }] }) })
  await expect(dialog.getByRole('alert')).toContainText(/authoring limits|No slides were imported/i)
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(`Existing title ${stamp}`)

  const manySlides = pptxFixture({ slides: Array.from({ length: 41 }, (_, index) => ({ shapes: [`Slide ${index + 1}`] })) })
  await chooseFile(page, dialog, { name: 'many-slides.pptx', mimeType: valid.mimeType, buffer: manySlides })
  await expect(dialog.getByRole('alert')).toContainText(/visible slides|authoring limit|No slides were imported/i)
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(`Existing title ${stamp}`)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
})

test('cancelling a held presentation read preserves the draft and releases the next intake', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name').fill(`cancel-${stamp}.slides`)
  await dialog.getByLabel('Slide 1 title', { exact: true }).fill(`Held title ${stamp}`)
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let entered = false
  let routeEnteredResolve!: () => void
  const routeEntered = new Promise<void>((resolve) => { routeEnteredResolve = resolve })
  let routeFinished!: () => void
  const routeComplete = new Promise<void>((resolve) => { routeFinished = resolve })
  const workerRoute = /officeParser\.worker/
  const holdWorker = async (route: Route) => {
    if (!new URL(route.request().url()).searchParams.has('worker_file')) return route.continue()
    entered = true
    routeEnteredResolve()
    try {
      await held
      try { await route.abort() } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/Route is already handled|Target page, context or browser has been closed|Request context disposed/i.test(message)) throw error
      }
    } finally { routeFinished() }
  }
  await page.route(workerRoute, holdWorker)
  await chooseFile(page, dialog, sourceDeck(stamp))
  await expect(dialog.getByRole('status')).toContainText('Reading selected file')
  await expect.poll(() => entered).toBe(true)
  await routeEntered
  await expect(dialog.getByRole('button', { name: 'Create slides', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel import', exact: true }).click()
  release()
  await routeComplete
  await page.unroute(workerRoute, holdWorker)
  await expect(importedSlides(dialog)).toHaveCount(0)
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(`Held title ${stamp}`)
  await chooseFile(page, dialog, { name: 'next.pptx', mimeType: sourceDeck(stamp).mimeType, buffer: pptxFixture({ slides: [{ shapes: ['Next title'] }] }) })
  await expect(importedSlides(dialog)).toContainText('Next title')
  await expect(dialog.getByLabel('Slide 1 title', { exact: true })).toHaveValue(`Held title ${stamp}`)
  await dialog.getByRole('button', { name: 'Discard import', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
})
