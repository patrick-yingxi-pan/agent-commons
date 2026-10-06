/** Rendered on-device image OCR review for authored Document artifacts. */
import { mkdirSync } from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { docBlockText, type ArtifactContentLibrary } from '../contract/index.ts'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { assertWcag22Aa } from './accessibility-helpers'
import { API } from './social-helpers.ts'
import { ms } from './budget.ts'

const REVIEW_DIR = '.data/artifact-image-ocr-review'
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const
const SOURCE_PNG = imageFixture(160, 80)
const SOURCE_DATA_URL = `data:image/png;base64,${SOURCE_PNG.toString('base64')}`

mkdirSync(REVIEW_DIR, { recursive: true })

async function openArtifactDialog(page: Page) {
  await page.getByRole('button', { name: 'New artifact', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible({ timeout: ms(20_000) })
  return dialog
}

async function installImageBridge(page: Page, withOcr = true) {
  await page.addInitScript(({ sourceDataUrl, sourceBytes, withOcr: includeOcr }) => {
    const fixture = {
      picks: [] as string[],
      recognition: [] as Array<{ operationId: string; bytes: number[]; resolve: (value: unknown) => void }>,
      cancellations: [] as string[],
    }
    const bridge: Record<string, unknown> = {
      context: {
        pickFiles: async (accept: string) => {
          fixture.picks.push(accept)
          if (accept !== 'single-image') return { status: 'cancelled' }
          return { status: 'selected', files: [{
            name: 'cobalt-source.png', kind: 'photo', sizeBytes: sourceBytes,
            previewDataUrl: sourceDataUrl,
          }] }
        },
        pickFolder: async () => ({ status: 'cancelled' }),
      },
    }
    if (includeOcr) {
      bridge.imageOcr = {
        recognize: (operationId: string, bytes: Uint8Array) => new Promise((resolve) => {
          fixture.recognition.push({ operationId, bytes: Array.from(bytes), resolve })
        }),
        cancel: async (operationId: string) => {
          fixture.cancellations.push(operationId)
          return true
        },
      }
    }
    Object.assign(window, { agentCommonsDesktop: bridge, __imageOcrFixture: fixture })
  }, { sourceDataUrl: SOURCE_DATA_URL, sourceBytes: SOURCE_PNG.byteLength, withOcr })
}

async function startRecognition(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const previousCount = await page.evaluate(() => (window as any).__imageOcrFixture.recognition.length as number)
  await dialog.getByRole('button', { name: 'Extract image text', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Reading the image and recognizing text on this Mac')
  await expect.poll(() => page.evaluate(() => (window as any).__imageOcrFixture.recognition.length)).toBe(previousCount + 1)
  const call = await page.evaluate(() => {
    const item = (window as any).__imageOcrFixture.recognition.at(-1)
    const fixture = (window as any).__imageOcrFixture
    return { operationId: item.operationId as string, bytes: item.bytes as number[], picked: fixture.picks.at(-1) }
  })
  expect(call.picked).toBe('single-image')
  expect(call.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  expect(call.bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(call.bytes.length).toBeGreaterThan(40)
  return call
}

async function resolveRecognition(page: Page, result: unknown, index = -1) {
  await page.evaluate(({ index, result }) => {
    const call = (window as any).__imageOcrFixture.recognition.at(index)
    call.resolve(result)
  }, { index, result })
}

async function expectContained(page: Page, dialog: ReturnType<Page['getByRole']>) {
  await expect.poll(async () => {
    const box = await dialog.locator('[data-bounded-dialog="resource-form"]').boundingBox()
    const viewport = page.viewportSize()
    return !!box && !!viewport && box.x >= 7 && box.y >= 7
      && box.x + box.width <= viewport.width - 7
      && box.y + box.height <= viewport.height - 7
  }).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function captureReview(page: Page, dialog: ReturnType<Page['getByRole']>, testInfo: TestInfo, viewport: typeof VIEWPORTS[number]) {
  await page.setViewportSize(viewport)
  await dialog.getByRole('textbox', { name: 'Imported text', exact: true }).scrollIntoViewIfNeeded()
  await expectContained(page, dialog)
  await assertWcag22Aa(page, `Image OCR review ${viewport.width}x${viewport.height}`)
  await page.screenshot({
    path: `${REVIEW_DIR}/${testInfo.project.name}-review-${viewport.width}x${viewport.height}.png`,
    fullPage: false,
  })
  const adopt = dialog.getByRole('button', { name: 'Replace content with imported text', exact: true })
  await adopt.focus()
  await adopt.evaluate((button) => button.scrollIntoView({ block: 'center' }))
  await expect(adopt).toBeInViewport({ ratio: 1 })
  await expect(dialog.getByRole('button', { name: 'Discard import', exact: true })).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: `${REVIEW_DIR}/${testInfo.project.name}-adoption-${viewport.width}x${viewport.height}.png` })
}

async function stackArtifactAccounts(page: Page) {
  for (const name of ['grace', 'ada']) {
    const response = await page.request.post(`${API}/auth/login`, {
      data: { email: `${name}@acme.example`, password: `${name}-demo-password` },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
}

test('image text stays local for review, then corrected text saves as an ordinary Document', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  await installImageBridge(page)
  await page.goto('/artifacts')
  const stamp = Date.now().toString(36)
  const recognized = `Cobalt garden ${stamp}`
  const correction = `Corrected OCR body ${stamp}.\n\nA second saved paragraph.`
  const writes: Array<{ method: string; pathname: string; body: string }> = []
  page.on('request', (request) => {
    if (!request.url().includes('/api/v1/') || !['POST', 'PUT', 'PATCH'].includes(request.method())) return
    writes.push({ method: request.method(), pathname: new URL(request.url()).pathname, body: request.postData() ?? '' })
  })

  const dialog = await openArtifactDialog(page)
  const initialWrites = writes.length
  await dialog.getByLabel('Name', { exact: true }).fill(`ocr-draft-${stamp}.md`)
  await dialog.getByLabel('Content', { exact: true }).fill(`Keep this authored draft ${stamp}.`)
  const pending = await startRecognition(page, dialog)
  await expect(dialog.getByRole('button', { name: 'Create document', exact: true })).toBeDisabled()
  expect(writes.slice(initialWrites), 'choosing/normalizing/recognizing an image must not write to an API').toEqual([])

  await resolveRecognition(page, { status: 'ready', text: recognized })
  const imported = dialog.getByRole('textbox', { name: 'Imported text', exact: true })
  await expect(imported).toHaveValue(recognized)
  await expect(imported).toHaveAttribute('readonly', '')
  await expect(dialog.getByText(/on this Mac.*no image upload or provider charge/i)).toBeVisible()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(`Keep this authored draft ${stamp}.`)
  await expect(dialog.getByRole('button', { name: 'Replace content with imported text', exact: true })).toBeVisible()
  expect(pending.bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

  for (const viewport of VIEWPORTS) await captureReview(page, dialog, testInfo, viewport)

  await dialog.getByRole('button', { name: 'Replace content with imported text', exact: true }).click()
  await expect(dialog.getByLabel('Content', { exact: true })).toBeFocused()
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(recognized)
  await dialog.getByLabel('Content', { exact: true }).fill(correction)
  expect(writes.slice(initialWrites), 'review and adoption stay local until Create').toEqual([])
  await dialog.getByRole('button', { name: 'Create document', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  const artifactId = page.url().split('/').at(-1)!
  const artifact = page.locator(`[data-artifact-page="${artifactId}"]`)
  await expect(artifact.locator('p', { hasText: `Corrected OCR body ${stamp}` })).toBeVisible()
  await expect(artifact.locator('p', { hasText: 'A second saved paragraph.' })).toBeVisible()
  const afterCreate = writes.slice(initialWrites)
  expect(afterCreate.every(({ pathname }) => ['/api/v1/artifacts', '/api/v1/social/viewed'].includes(pathname))).toBe(true)
  const createWrites = afterCreate.filter(({ pathname }) => pathname === '/api/v1/artifacts')
  expect(createWrites).toHaveLength(1)
  expect(createWrites[0]!.pathname).toBe('/api/v1/artifacts')
  expect(JSON.parse(createWrites[0]!.body).body).toBe(correction)
  expect(createWrites[0]!.body).not.toContain(SOURCE_DATA_URL)
  expect(createWrites[0]!.body).not.toContain(recognized)
  expect(createWrites.some(({ pathname }) => /image|provider|upload/i.test(pathname))).toBe(false)

  const library = await (await page.request.get(`${API}/artifact-content`)).json() as ArtifactContentLibrary
  const saved = library[artifactId]
  expect(saved?.type).toBe('doc')
  if (!saved || saved.type !== 'doc') throw new Error('the saved OCR result must be an ordinary Document body')
  expect(saved.blocks.map(docBlockText).filter(Boolean).join('\n\n')).toBe(correction)

  await page.reload()
  const reloaded = page.locator(`[data-artifact-page="${artifactId}"]`)
  await expect(reloaded.locator('p', { hasText: `Corrected OCR body ${stamp}` })).toBeVisible()
  await expect(reloaded.locator('p', { hasText: 'A second saved paragraph.' })).toBeVisible()
})

test('OCR refusal preserves the draft, and a browser without the optional bridge has no OCR action', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await installImageBridge(page)
  await page.goto('/artifacts')
  const stamp = Date.now().toString(36)
  const draft = `Unsaved authored draft ${stamp}.`
  const dialog = await openArtifactDialog(page)
  await dialog.getByLabel('Name', { exact: true }).fill(`ocr-error-${stamp}.md`)
  await dialog.getByLabel('Content', { exact: true }).fill(draft)
  await startRecognition(page, dialog)
  await resolveRecognition(page, { status: 'no-text' })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(draft)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(`ocr-error-${stamp}.md`)

  await startRecognition(page, dialog)
  await resolveRecognition(page, { status: 'unavailable' }, 1)
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(draft)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await installImageBridge(page, false)
  await page.goto('/artifacts')
  const webDialog = await openArtifactDialog(page)
  await expect(webDialog.getByRole('button', { name: 'Import file', exact: true })).toBeVisible()
  await expect(webDialog.getByRole('button', { name: 'Extract image text', exact: true })).toHaveCount(0)
  await webDialog.getByRole('button', { name: 'Close', exact: true }).click()
})

test('pending OCR is cancelled and late results are fenced by Cancel, format change, close, and account switch', async ({ page }) => {
  test.setTimeout(ms(120_000))
  await installImageBridge(page)
  await stackArtifactAccounts(page)
  await page.goto('/artifacts')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  let dialog = await openArtifactDialog(page)
  const stamp = Date.now().toString(36)
  const draft = `Still only a draft ${stamp}.`
  await dialog.getByLabel('Name', { exact: true }).fill(`ocr-fence-${stamp}.md`)
  await dialog.getByLabel('Content', { exact: true }).fill(draft)

  const cancelled = await startRecognition(page, dialog)
  await dialog.getByRole('button', { name: 'Cancel import', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__imageOcrFixture.cancellations.length)).toBe(1)
  await expect.poll(() => page.evaluate(() => (window as any).__imageOcrFixture.cancellations[0])).toBe(cancelled.operationId)
  await resolveRecognition(page, { status: 'ready', text: 'Late after explicit cancel.' }, 0)
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(draft)

  const formatPending = await startRecognition(page, dialog)
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('sheet')
  await expect.poll(() => page.evaluate(() => (window as any).__imageOcrFixture.cancellations.length)).toBe(2)
  await expect.poll(() => page.evaluate(() => (window as any).__imageOcrFixture.cancellations[1])).toBe(formatPending.operationId)
  await resolveRecognition(page, { status: 'ready', text: 'Late after format change.' }, 1)
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('doc')
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(draft)

  const closePending = await startRecognition(page, dialog)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__imageOcrFixture.cancellations.length)).toBe(3)
  await expect.poll(() => page.evaluate(() => (window as any).__imageOcrFixture.cancellations[2])).toBe(closePending.operationId)
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Grace Hopper' }).click()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await page.getByRole('button', { name: 'Artifacts', exact: true }).first().click()
  dialog = await openArtifactDialog(page)
  const graceDraft = `Grace's independent draft ${stamp}.`
  await dialog.getByLabel('Content', { exact: true }).fill(graceDraft)
  await resolveRecognition(page, { status: 'ready', text: 'Late Ada text must not enter Grace.' }, 2)
  await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(graceDraft)
  await expect(dialog.getByRole('textbox', { name: 'Imported text', exact: true })).toHaveCount(0)
  expect([cancelled.operationId, formatPending.operationId, closePending.operationId]).toHaveLength(3)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
})
