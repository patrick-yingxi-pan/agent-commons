/** Rendered on-device scanned-PDF OCR review for authored Document artifacts. */
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { docBlockText, type ArtifactContentLibrary } from '../contract/index.ts'
import { MAX_AUTHORED_DOCUMENT_SOURCE_CHARS } from '../contract/content.ts'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { assertWcag22Aa } from './accessibility-helpers'
import { API } from './social-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const
const SOURCE_PDF = pdfFixture({ pages: ['Scanned source page one', null, 'Scanned source page three'] })
const SOURCE_BYTES = Array.from(SOURCE_PDF)
const SOURCE_BASE64 = SOURCE_PDF.toString('base64')

async function openArtifactDialog(page: Page) {
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible({ timeout: ms(20_000) })
  return dialog
}

async function installPdfBridge(page: Page) {
  await page.addInitScript(({ sourceBytes }) => {
    const fixture = {
      picks: [] as string[],
      reads: 0,
      recognition: [] as Array<{ operationId: string; bytes: number[]; resolve: (value: unknown) => void }>,
      cancellations: [] as string[],
    }
    const bridge: Record<string, any> = {
      context: {
        pickFiles: async (accept: string) => {
          fixture.picks.push(accept)
          if (accept !== 'single-pdf') return { status: 'cancelled' }
          fixture.reads++
          const bytes = new Uint8Array(sourceBytes)
          return { status: 'selected', files: [{
            name: 'three-page-scan.pdf', kind: 'file', sizeBytes: bytes.byteLength,
            // The native bridge contract returns the existing transient PDF byte field.
            // Explicit OCR must ignore extracted text even if a host supplies it.
            pdfBytes: bytes,
            get text() { throw new Error('the OCR path must not parse/import PDF text first') },
          }] }
        },
        pickFolder: async () => ({ status: 'cancelled' }),
      },
    }
    bridge.imageOcr = {
      recognize: async () => ({ status: 'unavailable' }),
      cancel: async () => true,
    }
    bridge.pdfOcr = {
      recognize: (operationId: string, bytes: Uint8Array) => new Promise((resolve) => {
        fixture.recognition.push({ operationId, bytes: Array.from(bytes), resolve })
      }),
      cancel: async (operationId: string) => { fixture.cancellations.push(operationId); return true },
    }
    Object.assign(window, { agentCommonsDesktop: bridge, __pdfOcrFixture: fixture })
  }, { sourceBytes: SOURCE_BYTES })
}

async function startRecognition(page: Page, dialog: Locator) {
  const previous = await page.evaluate(() => (window as any).__pdfOcrFixture.recognition.length as number)
  await dialog.getByRole('button', { name: 'Extract PDF text', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Reading the PDF and recognizing text on this Mac')
  await expect.poll(() => page.evaluate(() => (window as any).__pdfOcrFixture.recognition.length)).toBe(previous + 1)
  const call = await page.evaluate(() => {
    const fixture = (window as any).__pdfOcrFixture
    const item = fixture.recognition.at(-1)
    return { operationId: item.operationId as string, bytes: item.bytes as number[], picked: fixture.picks.at(-1) as string }
  })
  expect(call.picked).toBe('single-pdf')
  expect(call.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  expect(Buffer.from(call.bytes).subarray(0, 5).toString('ascii')).toBe('%PDF-')
  expect(call.bytes).toEqual(SOURCE_BYTES)
  return call
}

async function resolveRecognition(page: Page, result: unknown, index = -1) {
  await page.evaluate(({ index, result }) => (window as any).__pdfOcrFixture.recognition.at(index).resolve(result), { index, result })
}

async function stackArtifactAccounts(page: Page) {
  for (const name of ['grace', 'ada']) {
    const response = await page.request.post(`${API}/auth/login`, {
      data: { email: `${name}@acme.example`, password: `${name}-demo-password` },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
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

async function captureState(page: Page, dialog: Locator, testInfo: TestInfo, state: 'idle' | 'pending' | 'ready' | 'error') {
  const before = await page.evaluate(() => {
    const fixture = (window as any).__pdfOcrFixture
    return { picks: fixture.picks.length, reads: fixture.reads, recognitions: fixture.recognition.length }
  })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const bridgeReady = await page.evaluate(() => {
      const bridge = (window as any).agentCommonsDesktop
      return typeof bridge?.imageOcr?.recognize === 'function' && typeof bridge?.imageOcr?.cancel === 'function' &&
        typeof bridge?.pdfOcr?.recognize === 'function' && typeof bridge?.pdfOcr?.cancel === 'function'
    })
    expect(bridgeReady, 'macOS image and PDF OCR capabilities remain available in every captured state').toBe(true)
    const imageAction = dialog.getByRole('button', { name: 'Extract image text', exact: true })
    if (state === 'idle' || state === 'error') await expect(imageAction).toBeVisible()
    else await expect(imageAction).toHaveCount(0) // The shared review lifetime hides other pickers while busy or holding a candidate.
    const target = state === 'idle' ? dialog.getByRole('button', { name: 'Extract PDF text', exact: true })
      : state === 'pending' ? dialog.getByRole('button', { name: 'Cancel import', exact: true })
        : state === 'ready' ? dialog.getByRole('textbox', { name: 'Imported text', exact: true })
          : dialog.getByRole('alert')
    await target.scrollIntoViewIfNeeded()
    await expect(target).toBeInViewport({ ratio: 0.5 })
    await expectContained(page, dialog)
    await assertWcag22Aa(page, `PDF OCR ${state} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`pdf-ocr-${state}-${viewport.width}x${viewport.height}.png`), fullPage: false })
    const after = await page.evaluate(() => {
      const fixture = (window as any).__pdfOcrFixture
      return { picks: fixture.picks.length, reads: fixture.reads, recognitions: fixture.recognition.length }
    })
    expect(after, 'responsive rendering and screenshot capture never repeat native input/OCR work').toEqual(before)
  }
}

test('whole multi-page OCR stays local for review, then corrected text saves as an ordinary Document', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  await installPdfBridge(page)
  await page.goto('/artifacts')
  const stamp = Date.now().toString(36)
  const recognized = `Page one: ${stamp}\n\nPage three: ${stamp}`
  const correction = `Reviewed complete scan ${stamp}.\n\nSecond paragraph, retained exactly.`
  const writes: Array<{ method: string; pathname: string; body: string }> = []
  const requestPaths: string[] = []
  page.on('request', (request) => {
    requestPaths.push(new URL(request.url()).pathname)
    if (!request.url().includes('/api/v1/') || !['POST', 'PUT', 'PATCH'].includes(request.method())) return
    writes.push({ method: request.method(), pathname: new URL(request.url()).pathname, body: request.postData() ?? '' })
  })

  const dialog = await openArtifactDialog(page)
  const initialWrites = writes.length
  const draft = `Keep this authored draft ${stamp}.`
  await dialog.getByLabel('Name', { exact: true }).fill(`pdf-ocr-${stamp}.md`)
  await dialog.getByLabel('Content', { exact: true }).fill(draft)
  await captureState(page, dialog, testInfo, 'idle')

  const pending = await startRecognition(page, dialog)
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(draft)
  expect(writes.slice(initialWrites), 'choosing, reading, and recognizing a PDF must not write to an API').toEqual([])
  const extractionPathIndex = requestPaths.length
  await captureState(page, dialog, testInfo, 'pending')

  await resolveRecognition(page, { status: 'ready', text: recognized, pages: 3, textPages: 2 })
  const imported = dialog.getByRole('textbox', { name: 'Imported text', exact: true })
  await expect(imported).toHaveValue(recognized)
  await expect(imported).toHaveAttribute('readonly', '')
  await expect(dialog.getByText(/All 3 PDF pages were processed on this Mac; text was recognized on 2 pages/i)).toBeVisible()
  await expect(dialog.getByText(/Pages are rendered at up to 2,000 pixels per edge for recognition; formatting and layout are not preserved/i)).toBeVisible()
  await expect(dialog.getByText(/not uploaded or saved; extraction makes no model call/i)).toBeVisible()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(draft)
  await expect(dialog.getByRole('button', { name: 'Replace content with imported text', exact: true })).toBeVisible()
  const storedBeforeCreate = await page.evaluate(() => JSON.stringify(Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index)!
    return [key, localStorage.getItem(key)]
  }))))
  expect(storedBeforeCreate).not.toContain('%PDF-')
  expect(storedBeforeCreate).not.toContain(SOURCE_BASE64)
  expect(pending.bytes).toEqual(SOURCE_BYTES)
  await captureState(page, dialog, testInfo, 'ready')
  expect(writes.slice(initialWrites), 'reviewing and viewport captures stay local').toEqual([])
  expect(requestPaths.slice(extractionPathIndex).filter((pathname) => /pdf-ocr|provider|model|upload|asset/i.test(pathname))).toEqual([])

  await dialog.getByRole('button', { name: 'Replace content with imported text', exact: true }).click()
  await expect(dialog.getByLabel('Content', { exact: true })).toBeFocused()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(recognized)
  await dialog.getByLabel('Content', { exact: true }).fill(correction)
  expect(writes.slice(initialWrites), 'explicit adoption only updates the editable draft').toEqual([])
  await dialog.getByRole('button', { name: 'Create document', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  const artifactId = page.url().split('/').at(-1)!
  const artifact = page.locator(`[data-artifact-page="${artifactId}"]`)
  await expect(artifact.locator('p', { hasText: `Reviewed complete scan ${stamp}` })).toBeVisible()
  const creates = writes.slice(initialWrites).filter(({ pathname }) => pathname === '/api/v1/artifacts')
  expect(creates).toHaveLength(1)
  expect(JSON.parse(creates[0]!.body).body).toBe(correction)
  expect(creates[0]!.body).not.toContain('%PDF-')
  expect(creates[0]!.body).not.toContain(SOURCE_BASE64)
  expect(writes.slice(initialWrites).every(({ pathname }) => ['/api/v1/artifacts', '/api/v1/social/viewed'].includes(pathname))).toBe(true)
  expect(writes.some(({ pathname }) => /pdf-ocr|provider|model|upload|asset/i.test(pathname))).toBe(false)

  const library = await (await page.request.get(`${API}/artifact-content`)).json() as ArtifactContentLibrary
  const saved = library[artifactId]
  expect(saved?.type).toBe('doc')
  if (!saved || saved.type !== 'doc') throw new Error('the reviewed OCR result must save as an ordinary Document')
  expect(saved.blocks.map(docBlockText).filter(Boolean).join('\n\n')).toBe(correction)
  expect(JSON.stringify(saved)).not.toContain('%PDF-')
  expect(JSON.stringify(saved)).not.toContain(SOURCE_BASE64)
})

test('blank, protected, page-limit, timeout, and over-authoring-limit results preserve the draft', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  await installPdfBridge(page)
  await page.goto('/artifacts')
  const stamp = Date.now().toString(36)
  const draft = `Unchanged authored draft ${stamp}.`
  const dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Content', { exact: true }).fill(draft)

  const failures: Array<{ result: unknown; message: RegExp }> = [
    { result: { status: 'no-text', pages: 3, textPages: 0 }, message: /No readable text was recognized on any of the 3 PDF pages/ },
    { result: { status: 'protected' }, message: /password-protected or restricted/ },
    { result: { status: 'page-limit' }, message: /more than 100 pages/ },
    { result: { status: 'timeout' }, message: /took too long/ },
    { result: { status: 'ready', text: 'x'.repeat(MAX_AUTHORED_DOCUMENT_SOURCE_CHARS + 1), pages: 2, textPages: 2 }, message: new RegExp(`${MAX_AUTHORED_DOCUMENT_SOURCE_CHARS.toLocaleString()} character authoring limit.*Nothing was truncated`) },
  ]
  for (let index = 0; index < failures.length; index++) {
    const { result, message } = failures[index]!
    await startRecognition(page, dialog)
    await resolveRecognition(page, result, index)
    await expect(dialog.getByRole('alert')).toContainText(message)
    await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
    await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(draft)
    if (index === 1) await captureState(page, dialog, testInfo, 'error')
  }
})

test('Cancel, format change, close, and account switch fence PDF OCR late text; absent bridge exposes no action', async ({ page }) => {
  test.setTimeout(ms(120_000))
  await installPdfBridge(page)
  await stackArtifactAccounts(page)
  await page.goto('/artifacts')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  let dialog = await openArtifactDialog(page)
  const draft = `Only the current draft ${Date.now().toString(36)}.`
  await dialog.getByLabel('Content', { exact: true }).fill(draft)

  const cancelled = await startRecognition(page, dialog)
  await dialog.getByRole('button', { name: 'Cancel import', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__pdfOcrFixture.cancellations.length)).toBe(1)
  await expect.poll(() => page.evaluate(() => (window as any).__pdfOcrFixture.cancellations[0])).toBe(cancelled.operationId)
  await resolveRecognition(page, { status: 'ready', text: 'Late result after cancel.', pages: 1, textPages: 1 }, 0)
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(draft)

  const formatPending = await startRecognition(page, dialog)
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('sheet')
  await expect.poll(() => page.evaluate(() => (window as any).__pdfOcrFixture.cancellations.length)).toBe(2)
  await expect.poll(() => page.evaluate(() => (window as any).__pdfOcrFixture.cancellations[1])).toBe(formatPending.operationId)
  await resolveRecognition(page, { status: 'ready', text: 'Late result after format change.', pages: 1, textPages: 1 }, 1)
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('doc')
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(draft)

  const closePending = await startRecognition(page, dialog)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__pdfOcrFixture.cancellations.length)).toBe(3)
  await expect.poll(() => page.evaluate(() => (window as any).__pdfOcrFixture.cancellations[2])).toBe(closePending.operationId)

  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Grace Hopper' }).click()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await page.getByRole('button', { name: 'Artifacts', exact: true }).first().click()
  dialog = await openArtifactDialog(page)
  const graceDraft = `Grace's independent draft ${Date.now().toString(36)}.`
  await dialog.getByLabel('Content', { exact: true }).fill(graceDraft)
  await resolveRecognition(page, { status: 'ready', text: 'Late Ada text must not enter Grace.', pages: 1, textPages: 1 }, 2)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(graceDraft)
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  expect([cancelled.operationId, formatPending.operationId, closePending.operationId]).toHaveLength(3)

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const webPage = await page.context().newPage()
  await webPage.goto('/artifacts')
  const noBridge = await openArtifactDialog(webPage)
  await expect(noBridge.getByRole('button', { name: 'Import file', exact: true })).toBeVisible()
  await expect(noBridge.getByRole('button', { name: 'Extract PDF text', exact: true })).toHaveCount(0)
  await webPage.close()
})
