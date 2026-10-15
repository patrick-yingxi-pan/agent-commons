/** Explicit native OCR for a PDF already selected in a local source browser. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { isLocalConnectionId } from '../contract/localFolderCapture.ts'
import { isLocalGitConnectionId } from '../contract/localGitCapture.ts'
import { parseLocalFolderFileListing } from '../contract/localFolderBrowse.mjs'
import { parseLocalGitFileListing } from '../contract/localGitBrowse.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { API, createProject, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const FOLDER = `LOCAL_${'E'.repeat(32)}`
const GIT = `GIT_${'E'.repeat(32)}`
const stamp = Date.now().toString(36)
const PATH = `research/scans/quarterly-${stamp}.pdf`
const SCANNED_PATH = `research/scans/fully-scanned-${stamp}.pdf`
const BODY = `EMBEDDED_BASELINE_${stamp}`
const OCR_BODY = `Recognized cover ${stamp}.\n\nRecognized second page, exactly.`
const BYTES = [...pdfFixture({ pages: [BODY, null], compress: true })]
const SCANNED_BYTES = [...pdfFixture({ pages: [null, null], compress: true })]
const FILES = [PATH, SCANNED_PATH].sort().map(path => ({ path, kind: 'file' as const }))
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const
type Source = 'folder' | 'git' | 'git-untracked'

async function installFixture(page: Page, options: { pdfOcr?: boolean } = {}) {
  const { pdfOcr = true } = options
  const folderListing = { version: 1, visited: 4, hiddenCount: 0, directoryCount: 2, files: [
    ...FILES,
  ] }
  const gitListing = { version: 1, excludedCount: 0, files: [
    ...FILES,
  ] }
  expect(isLocalConnectionId(FOLDER), 'the Folder fixture connection id obeys the native contract').toBe(true)
  expect(isLocalGitConnectionId(GIT), 'the Git fixture connection id obeys the native contract').toBe(true)
  expect(parseLocalFolderFileListing(folderListing), 'the Folder fixture listing obeys the native contract').toEqual(folderListing)
  expect(parseLocalGitFileListing(gitListing), 'the Git fixture listing obeys the native contract').toEqual(gitListing)
  await page.addInitScript(({ connectionIds, listings, documents, hasOcr }) => {
    const state: any = { lists: [], reads: [], snapshots: 0, recognition: [], cancellations: [], documents, connected: true }
    Object.defineProperty(window, '__localPdfOcrBrowse', { configurable: true, value: state })
    const makeSource = (id: string, kind: string, listing: any) => ({
      list: async (input: any) => input?.userId === 'user-ada' && state.connected ? [{ id, name: 'OCR fixture', remembered: true }] : [],
      connect: async () => { throw new Error('browsing does not reconnect') },
      files: async (sourceId: string, auth: any) => { state.lists.push(kind); if (sourceId !== id || auth?.userId !== 'user-ada') throw new Error('wrong source'); return structuredClone(listing) },
      file: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== id || auth?.userId !== 'user-ada') throw new Error('wrong source')
        state.reads.push({ source: kind, path: input.path })
        const data = state.documents[input.path]
        return { version: 1, path: input.path, sizeBytes: data.length, snapshot: { document: { format: 'pdf', bytes: new Uint8Array(data) } } }
      },
      untrackedFiles: async (sourceId: string, input: any) => {
        if (sourceId !== id || input?.scope !== 'untracked' || !input.operationId) throw new Error('unscoped untracked listing')
        state.lists.push('git-untracked'); return { ...structuredClone(listing), scope: 'untracked' }
      },
      untrackedFile: async (sourceId: string, input: any, auth: any) => {
        if (sourceId !== id || input?.scope !== 'untracked' || !input.operationId || auth?.userId !== 'user-ada') throw new Error('unscoped untracked read')
        state.reads.push({ source: 'git-untracked', path: input.path })
        const data = state.documents[input.path]
        return { version: 1, scope: 'untracked', path: input.path, sizeBytes: data.length, snapshot: { document: { format: 'pdf', bytes: new Uint8Array(data) } } }
      },
      cancelUntrackedRead: async () => true,
      snapshot: async () => { state.snapshots++; throw new Error('no bulk capture') },
      review: async () => { throw new Error('no Git review') },
      disconnect: async () => { state.connected = false },
    })
    const desktop: any = { context: {
      localFolders: makeSource(connectionIds.folder, 'folder', listings.folder),
      localGit: makeSource(connectionIds.git, 'git', listings.git),
    } }
    if (hasOcr) desktop.pdfOcr = {
      recognize: (operationId: string, input: Uint8Array) => new Promise(resolve => state.recognition.push({ operationId, bytes: Array.from(input), resolve })),
      cancel: async (operationId: string) => { state.cancellations.push(operationId); return true },
    }
    Object.defineProperty(window, 'agentCommonsDesktop', { configurable: false, value: desktop })
  }, { connectionIds: { folder: FOLDER, git: GIT }, listings: { folder: folderListing, git: gitListing },
    documents: { [PATH]: BYTES, [SCANNED_PATH]: SCANNED_BYTES }, hasOcr: pdfOcr })
}

async function createSession(page: Page) {
  const response = await page.request.post(`${API}/sessions`, { data: {} })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).id as string
}

async function switchToAda(page: Page) {
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
}

async function openPicker(page: Page, source: Source = 'folder') {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: source === 'folder' ? /^Folder/ : /^Repository/ }).click()
  if (source === 'folder') await dialog.getByRole('button', { name: 'This computer', exact: true }).click()
  const picker = dialog.locator(source === 'folder' ? '[data-native-folder-picker]' : '[data-native-git-picker]')
  await picker.getByRole('button', { name: 'Browse files in OCR fixture', exact: true }).click()
  if (source === 'git-untracked') {
    const checkbox = picker.getByRole('checkbox', { name: 'Browse untracked files', exact: true })
    if (!(await checkbox.isChecked())) await checkbox.check()
  }
  return { dialog, picker, browser: picker.locator(`[data-local-${source}-browser]`) }
}

function listName(source: Source) { return source === 'folder' ? 'List folder paths' : source === 'git' ? 'List tracked paths' : 'List untracked paths' }
function listingName(source: Source) { return source === 'folder' ? 'Folder paths' : source === 'git' ? 'Tracked repository paths' : 'Untracked repository paths' }
function rowName(source: Source) { return source === 'folder' ? 'File' : source === 'git' ? 'Tracked file' : 'Untracked file' }
function previewSelector(source: Source) { return `[data-local-${source}-file-preview]` }

async function selectPdf(browser: Locator, source: Source, path = PATH, expectedText: string | null = BODY) {
  const listing = browser.locator(`[data-local-${source}-browser-listing]`)
  if (!(await listing.isVisible())) await browser.getByRole('button', { name: listName(source), exact: true }).click()
  await expect(listing).toBeVisible()
  await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(path)
  await browser.getByRole('list', { name: listingName(source) }).getByRole('button', { name: `${path} ${rowName(source)}`, exact: true }).click()
  const preview = browser.locator(previewSelector(source))
  await expect(preview.locator('[data-local-document-preview="pdf"]')).toBeVisible({ timeout: ms(20_000) })
  if (expectedText) await expect(preview.getByRole('region', { name: `Preview of ${path}` })).toContainText(expectedText)
  else await expect(preview.locator('[data-local-document-preview="pdf"]')).toContainText(/No embedded PDF text was found/)
  return preview
}

async function startOcr(browser: Locator, preview: Locator, options: { canAttach?: boolean; priorText?: string | null; path?: string; bytes?: number[] } = {}) {
  const { canAttach = true, priorText = BODY, path = PATH, bytes = BYTES } = options
  const before = await pageState(browser)
  await browser.getByRole('button', { name: 'Recognize scanned text', exact: true }).click()
  await expect(browser.getByText('Recognizing PDF text…', { exact: true })).toBeVisible()
  const pendingButton = browser.getByRole('button', { name: 'Cancel recognition', exact: true })
  await expect(pendingButton).toBeVisible()
  const attach = browser.getByRole('button', { name: 'Attach saved copy', exact: true })
  if (canAttach && priorText !== null) await expect(attach).toBeDisabled()
  else await expect(attach).toHaveCount(0)
  if (priorText) await expect(preview.getByRole('region', { name: `Preview of ${path}` })).toContainText(priorText)
  else await expect(preview.locator('[data-local-document-preview="pdf"]')).toContainText(/No embedded PDF text was found/)
  await expect.poll(() => browser.page().evaluate(() => (window as any).__localPdfOcrBrowse.recognition.length)).toBe(before.recognition + 1)
  const call = await browser.page().evaluate(() => {
    const item = (window as any).__localPdfOcrBrowse.recognition.at(-1)
    return { operationId: item.operationId as string, bytes: item.bytes as number[] }
  })
  expect(call.operationId).toMatch(/^[0-9a-f-]{36}$/i)
  expect(call.bytes).toEqual(bytes)
  return call
}

async function pageState(locator: Locator) {
  return locator.page().evaluate(() => {
    const state = (window as any).__localPdfOcrBrowse
    return { recognition: state.recognition.length, reads: state.reads.length, lists: state.lists.length }
  })
}

async function resolveOcr(page: Page, result: unknown, index = -1) {
  await page.evaluate(({ result, index }) => (window as any).__localPdfOcrBrowse.recognition.at(index).resolve(result), { result, index })
}

async function viewportMatrix(page: Page, browser: Locator, preview: Locator, info: TestInfo, state: string, path = PATH) {
  const before = await pageState(browser)
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size)
    await settledNarrowRail(page)
    const target = state.endsWith('pending') ? browser.getByRole('button', { name: 'Cancel recognition', exact: true })
      : preview.getByRole('region', { name: `Preview of ${path}` })
    await target.scrollIntoViewIfNeeded()
    await expect(target).toBeVisible()
    await settledOpaquePaint(target)
    await expect.poll(async () => target.evaluate(element => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return x >= 7 && y >= 7 && x + width <= innerWidth - 7 && y + height <= innerHeight - 7
    }), { message: `the ${state} OCR target remains inside the ${size.width}x${size.height} viewport` }).toBe(true)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await assertWcag22Aa(page, `local PDF OCR ${state} ${size.width}x${size.height}`)
    await page.screenshot({ path: info.outputPath(`local-pdf-ocr-${state}-${size.width}x${size.height}.png`) })
    expect(await pageState(browser), 'responsive captures do not repeat source reads or recognition').toEqual(before)
  }
  await page.setViewportSize(VIEWPORTS[4])
}

test('selected Folder PDF OCR replaces only preview text, then attaches exact recognized text', async ({ page, browser: engine }, info) => {
  test.setTimeout(ms(120_000))
  await installFixture(page)
  const session = await createSession(page)
  await page.goto(`/s/${session}`)
  const writes: string[] = []
  const messages: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (['POST', 'PUT', 'PATCH'].includes(request.method()) && /api\/v1\/(?!auth\/)/.test(path)) writes.push(path)
    if (request.method() === 'POST' && path.endsWith('/messages')) messages.push(path)
  })
  const { dialog, browser } = await openPicker(page)
  await expect(browser.getByRole('button', { name: 'Recognize scanned text', exact: true })).toHaveCount(0)
  const preview = await selectPdf(browser, 'folder')
  await expect(browser.getByRole('button', { name: 'Recognize scanned text', exact: true })).toBeVisible()
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toBeEnabled()
  const originalWrites = [...writes]
  const pending = await startOcr(browser, preview)
  await viewportMatrix(page, browser, preview, info, 'pending')
  expect(writes).toEqual(originalWrites)
  await resolveOcr(page, { status: 'ready', pages: 2, textPages: 2, text: OCR_BODY })
  const textRegion = preview.getByRole('region', { name: `Preview of ${PATH}` })
  await expect(textRegion).toHaveText(OCR_BODY)
  await expect(preview.locator('[data-local-document-preview="pdf"]')).toContainText('OCR')
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toBeEnabled()
  const shown = await textRegion.textContent()
  await viewportMatrix(page, browser, preview, info, 'success')
  expect(await pageState(browser)).toEqual({ recognition: 1, reads: 1, lists: 1 })
  await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  const saved = await (await page.request.get(`${API}/sessions/${session}`)).json()
  const attachment = saved.workspace.attachments.find((item: any) => item.label === PATH)
  expect(attachment.documentImport).toEqual({ format: 'pdf', status: 'ready', pages: 2, textPages: 2, method: 'ocr' })
  expect(attachment.previewText).toBe(shown)
  expect(attachment.previewText).toContain(OCR_BODY)
  expect(JSON.stringify(attachment)).not.toContain('%PDF-')
  expect(JSON.stringify(attachment)).not.toContain(Buffer.from(BYTES).toString('base64'))
  expect(messages).toEqual([])
  expect(writes.filter(path => path.endsWith('/messages'))).toEqual([])
  expect(await page.evaluate(() => (window as any).__localPdfOcrBrowse.reads)).toEqual([{ source: 'folder', path: PATH }])
  expect(await page.evaluate(() => (window as any).__localPdfOcrBrowse.snapshots)).toBe(0)
  expect(pending.bytes).toEqual(BYTES)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await page.reload()
  const reloaded = await (await page.request.get(`${API}/sessions/${session}`)).json()
  expect(reloaded.workspace.attachments.find((item: any) => item.id === attachment.id)).toEqual(attachment)
  expect(await page.evaluate(() => (window as any).__localPdfOcrBrowse.reads)).toEqual([],
    'reload recovers the saved text and metadata without reading the native source again')

  await page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
  await page.getByLabel('Audience id').fill('tenant-beta')
  await page.getByRole('button', { name: /Share|Publish/ }).last().click()
  const viewer = await newUser(engine, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  try {
    await viewer.page.goto(`/s/${session}`)
    const sharedCopy = viewer.page.getByTitle('Open in sidebar').filter({ hasText: PATH })
    await expect(sharedCopy).toBeVisible()
    await sharedCopy.click()
    const sharedPreview = viewer.page.locator('[data-attachment-preview]')
    await expect(sharedPreview).toBeVisible()
    await expect(sharedPreview.locator('[data-document-import="ready"]')).toContainText('On-device OCR text')
    await expect(sharedPreview.locator('pre')).toHaveText(OCR_BODY)
    await expect(viewer.page.getByTitle('Remove file', { exact: true })).toHaveCount(0)
    await expect(viewer.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
  } finally {
    await viewer.context.close()
  }
  const foreign = await newUser(engine, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    expect((await foreign.page.request.get(`${API}/sessions/${session}`)).status()).toBe(404)
    await foreign.page.goto(`/s/${session}`)
    await expect(foreign.page.getByRole('heading', { name: 'What should we work on?', exact: true })).toBeVisible()
    await expect(foreign.page.locator('[data-attachment-preview]')).toHaveCount(0)
  } finally {
    await foreign.context.close()
  }
})

test('PDF without embedded text exposes local OCR in conversation, canonical, and Project views', async ({ page }, info) => {
  test.setTimeout(ms(150_000))
  await installFixture(page)
  const session = await createSession(page)
  await page.goto(`/s/${session}`)
  for (const source of ['folder', 'git', 'git-untracked'] as const) {
    const { dialog, browser } = await openPicker(page, source)
    const preview = await selectPdf(browser, source, SCANNED_PATH, null)
    await expect(browser.getByRole('button', { name: 'Recognize scanned text', exact: true })).toBeVisible()
    await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
    const call = await startOcr(browser, preview, { canAttach: false, priorText: null, path: SCANNED_PATH, bytes: SCANNED_BYTES })
    await resolveOcr(page, { status: 'ready', pages: 2, textPages: 1, text: `${OCR_BODY}_${source}` })
    await expect(preview.getByRole('region', { name: `Preview of ${SCANNED_PATH}` })).toContainText(`${OCR_BODY}_${source}`)
    await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toBeEnabled()
    expect(call.bytes).toEqual(SCANNED_BYTES)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  }
  await page.goto(`/contexts/${GIT}`)
  const canonicalDetail = page.locator(`[data-local-git-detail="${GIT}"]`)
  const canonical = canonicalDetail.locator('[data-local-git-browser]')
  await expect(canonicalDetail.getByRole('heading', { name: 'OCR fixture', exact: true })).toBeVisible()
  await expect(canonical.getByRole('button', { name: 'List tracked paths', exact: true })).toBeVisible()
  await expect(canonical.locator('[data-local-git-browser-listing]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localPdfOcrBrowse.reads)).toHaveLength(0,
    'opening the canonical detail does not read a source file')
  const canonicalPreview = await selectPdf(canonical, 'git', SCANNED_PATH, null)
  await expect(canonical.getByRole('button', { name: 'Recognize scanned text', exact: true })).toBeVisible()
  await expect(canonical.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  await expect(canonical.locator('[data-local-git-browser-listing]')).toBeVisible()
  const pending = await startOcr(canonical, canonicalPreview, { canAttach: false, priorText: null, path: SCANNED_PATH, bytes: SCANNED_BYTES })
  await viewportMatrix(page, canonical, canonicalPreview, info, 'canonical-pending', SCANNED_PATH)
  await resolveOcr(page, { status: 'ready', pages: 2, textPages: 1, text: `${OCR_BODY}_canonical` })
  await expect(canonicalPreview.getByRole('region', { name: `Preview of ${SCANNED_PATH}` })).toContainText(`${OCR_BODY}_canonical`)
  expect(pending.bytes).toEqual(SCANNED_BYTES)
  expect(await page.evaluate(() => (window as any).__localPdfOcrBrowse.reads)).toHaveLength(1)

  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toBeVisible()
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  const projects = page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true })
  if (await expand.isVisible()) await expand.click()
  await expect(projects).toBeInViewport()
  await createProject(page, `OCR source ${stamp}`)
  const projectPath = new URL(page.url()).pathname
  const contextSection = page.locator('section[class~="group/section"]').filter({
    has: page.locator('[data-section-title]', { hasText: /^Context$/i }),
  })
  const contextHeading = contextSection.getByRole('button', { name: /^Context(?:\s|$)/i })
  if (await contextHeading.getAttribute('aria-expanded') === 'false') await contextHeading.click()
  await contextSection.getByRole('button', { name: 'Add context', exact: true }).click()
  const projectDialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await projectDialog.getByRole('button', { name: /^Repository/ }).click()
  const picker = projectDialog.locator('[data-native-git-picker]')
  await picker.getByRole('button', { name: 'Browse files in OCR fixture', exact: true }).click()
  const projectBrowser = picker.locator('[data-local-git-browser]')
  await expect(projectBrowser.getByRole('button', { name: 'List tracked paths', exact: true })).toBeVisible()
  await expect(projectBrowser.locator('[data-local-git-browser-listing]')).toHaveCount(0)
  const projectPreview = await selectPdf(projectBrowser, 'git', SCANNED_PATH, null)
  await expect(projectBrowser.getByRole('button', { name: 'Recognize scanned text', exact: true })).toBeVisible()
  await expect(projectBrowser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  const projectPending = await startOcr(projectBrowser, projectPreview, { canAttach: false, priorText: null, path: SCANNED_PATH, bytes: SCANNED_BYTES })
  await resolveOcr(page, { status: 'ready', pages: 2, textPages: 1, text: `${OCR_BODY}_project` })
  await expect(projectPreview.getByRole('region', { name: `Preview of ${SCANNED_PATH}` })).toContainText(`${OCR_BODY}_project`)
  expect(projectPending.bytes).toEqual(SCANNED_BYTES)
  expect(new URL(page.url()).pathname).toBe(projectPath, 'reading a Project source does not navigate away from its owner')
})

test('native OCR absence hides the action', async ({ page }) => {
  await installFixture(page, { pdfOcr: false })
  const session = await createSession(page)
  await page.goto(`/s/${session}`)
  const { browser } = await openPicker(page)
  await selectPdf(browser, 'folder')
  await expect(browser.getByRole('button', { name: 'Recognize scanned text', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localPdfOcrBrowse.recognition)).toEqual([])
})

test('unchecking untracked browsing fences a late OCR result', async ({ page }) => {
  test.setTimeout(ms(75_000))
  await installFixture(page)
  const session = await createSession(page)
  await page.goto(`/s/${session}`)
  const { browser } = await openPicker(page, 'git-untracked')
  const preview = await selectPdf(browser, 'git-untracked')
  const pending = await startOcr(browser, preview)
  const outerPicker = page.locator('[data-native-git-picker]')
  await outerPicker.getByRole('checkbox', { name: 'Browse untracked files', exact: true }).uncheck()
  await resolveOcr(page, { status: 'ready', pages: 2, textPages: 2, text: `${OCR_BODY}_opted_out` })
  await expect(outerPicker.locator('[data-local-git-untracked-file-preview]')).toHaveCount(0)
  await outerPicker.getByRole('checkbox', { name: 'Browse untracked files', exact: true }).check()
  await expect(outerPicker.getByRole('button', { name: 'Recognize scanned text', exact: true })).toHaveCount(0)
  expect(pending.bytes).toEqual(BYTES)
})

test('OCR failure preserves the prior preview and offers explicit retry', async ({ page }, info) => {
  test.setTimeout(ms(90_000))
  await installFixture(page)
  const session = await createSession(page)
  await page.goto(`/s/${session}`)
  const { browser } = await openPicker(page)
  const preview = await selectPdf(browser, 'folder')
  const savedStatus = await preview.locator('[data-local-document-preview="pdf"]').textContent()
  await startOcr(browser, preview)
  await resolveOcr(page, { status: 'unavailable' })
  await expect(browser.getByRole('alert')).toBeVisible()
  await expect(browser.getByRole('alert')).not.toContainText(/Error:|stack|file:\/\//i)
  await expect(preview.getByRole('region', { name: `Preview of ${PATH}` })).toContainText(BODY)
  await expect(preview.locator('[data-local-document-preview="pdf"]')).toHaveText(savedStatus!)
  await expect(browser.getByRole('button', { name: 'Recognize scanned text', exact: true })).toBeVisible()
  await viewportMatrix(page, browser, preview, info, 'failure')
  expect(await page.evaluate(() => (window as any).__localPdfOcrBrowse.reads)).toHaveLength(1)
  const retry = await startOcr(browser, preview)
  expect(retry.bytes).toEqual(BYTES)
  await resolveOcr(page, { status: 'ready', pages: 2, textPages: 2, text: OCR_BODY })
  await expect(preview.getByRole('region', { name: `Preview of ${PATH}` })).toHaveText(OCR_BODY)
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__localPdfOcrBrowse.reads)).toHaveLength(1,
    'retry recognizes the already captured bytes without rereading the source')
})

test('cancel, dismiss, account change, disconnect, and unchecking untracked browsing retire late OCR results', async ({ page }) => {
  test.setTimeout(ms(150_000))
  await installFixture(page)
  for (const name of ['grace', 'ada']) {
    const response = await page.request.post(`${API}/auth/login`, { data: { email: `${name}@acme.example`, password: `${name}-demo-password` } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const session = await createSession(page)
  await page.goto(`/s/${session}`)
  const first = await openPicker(page)
  const preview = await selectPdf(first.browser, 'folder')
  const call = await startOcr(first.browser, preview)
  await first.browser.getByRole('button', { name: 'Cancel recognition', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__localPdfOcrBrowse.cancellations.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).__localPdfOcrBrowse.cancellations[0])).toBe(call.operationId)
  await resolveOcr(page, { status: 'ready', pages: 2, textPages: 2, text: `${OCR_BODY}_cancelled` })
  await expect(preview.getByRole('region', { name: `Preview of ${PATH}` })).not.toContainText(`${OCR_BODY}_cancelled`)
  await expect(first.browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toBeEnabled()
  await first.browser.getByRole('button', { name: 'Recognize scanned text', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__localPdfOcrBrowse.recognition.length)).toBe(2)
  await first.browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await resolveOcr(page, { status: 'ready', pages: 2, textPages: 2, text: `${OCR_BODY}_dismissed` }, 1)
  await expect(first.browser.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await first.dialog.getByRole('button', { name: 'Done', exact: true }).click()

  const second = await openPicker(page)
  const secondPreview = await selectPdf(second.browser, 'folder')
  await startOcr(second.browser, secondPreview)
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Grace Hopper' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await resolveOcr(page, { status: 'ready', pages: 2, textPages: 2, text: `${OCR_BODY}_account` }, 2)
  await expect(page.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await expect(second.dialog).toBeHidden()

  await page.goto('/')
  await switchToAda(page)
  await page.goto(`/contexts/${FOLDER}`)
  const detail = page.locator(`[data-local-folder-detail="${FOLDER}"]`)
  const canonical = detail.locator('[data-local-folder-browser]')
  const canonicalPreview = await selectPdf(canonical, 'folder')
  await startOcr(canonical, canonicalPreview, { canAttach: false })
  await detail.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
  await resolveOcr(page, { status: 'ready', pages: 2, textPages: 2, text: `${OCR_BODY}_disconnected` })
  await expect(page.locator('[data-local-folder-file-preview]')).toHaveCount(0)
})
