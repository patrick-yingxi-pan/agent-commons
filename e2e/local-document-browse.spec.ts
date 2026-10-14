import { test, expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { pptxFixture } from '../tests/helpers/pptxFixture.mjs'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { documentImportCopy } from '../contract/documentImport.mjs'
import { parseLocalFolderFileListing } from '../contract/localFolderBrowse.mjs'
import { parseLocalGitFileListing } from '../contract/localGitBrowse.mjs'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { API, createProject, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const FOLDER_ID = `LOCAL_${'D'.repeat(32)}`
const GIT_ID = `GIT_${'D'.repeat(32)}`
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

const stamp = Date.now().toString(36)
const pdfPath = `research/quarterly/long-folder-name-${stamp}/source-report-${stamp}.pdf`
const docxPath = `research/word/brief-${stamp}.docx`
const xlsxPath = `research/sheets/budget-${stamp}.xlsx`
const pptxPath = `research/slides/launch-${stamp}.pptx`
const protectedPath = `restricted/locked-${stamp}.pdf`
const noTextPath = `research/word/empty-${stamp}.docx`
const invalidPath = `research/slides/broken-${stamp}.pptx`
const unsupportedPath = `research/word/legacy-${stamp}.docx`
const latePath = `research/held/late-${stamp}.pdf`
const marker = `LOCAL_DOCUMENT_BODY_${stamp}`
const changedMarker = `SOURCE_CHANGED_AFTER_PREVIEW_${stamp}`

const docs = {
  [pdfPath]: { format: 'pdf', bytes: pdfFixture({ pages: [`${marker}_PDF`, null], compress: true, unicode: true }) },
  [docxPath]: { format: 'docx', bytes: docxFixture({ paragraphs: [`${marker}_DOCX`, 'Word body paragraph'] }) },
  [xlsxPath]: { format: 'xlsx', bytes: xlsxFixture({ sheets: [{ name: 'Visible Budget', rows: [[`${marker}_XLSX`, 42]] }] }) },
  [pptxPath]: { format: 'pptx', bytes: pptxFixture({ slides: [{ name: 'Visible launch', shapes: [`${marker}_PPTX`, 'Slide body'] }] }) },
  [protectedPath]: { format: 'pdf', bytes: pdfFixture({ pages: [`${marker}_LOCKED`], password: 'fixture-password' }) },
  [noTextPath]: { format: 'docx', bytes: docxFixture() },
  [invalidPath]: { format: 'pptx', bytes: Buffer.from('not a ZIP package') },
  [unsupportedPath]: { format: 'docx', bytes: docxFixture({ compoundContainer: true }) },
  [latePath]: { format: 'pdf', bytes: pdfFixture({ pages: [`${marker}_LATE`], compress: true }) },
} as const

async function addDocumentNativeFixture(page: Page, bridge: 'localFolders' | 'localGit', holdPath?: string) {
  const serialized = Object.fromEntries(Object.entries(docs).map(([path, document]) => [path, {
    format: document.format,
    bytes: [...document.bytes],
  }]))
  const entries = Object.keys(serialized).sort().map(path => ({ path, kind: 'file' as const }))
  const directories = new Set(entries.flatMap(({ path }) => {
    const parts = path.split('/')
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
  }))
  const listing = bridge === 'localFolders'
    ? { version: 1, visited: entries.length + directories.size, hiddenCount: 0, directoryCount: directories.size, files: entries }
    : { version: 1, files: entries, excludedCount: 0 }
  expect((bridge === 'localFolders' ? parseLocalFolderFileListing : parseLocalGitFileListing)(listing))
    .toEqual(listing, 'the native fixture must obey the same closed listing contract as a real source')
  await page.addInitScript(({ connectionId, bridgeName, files, heldPath, listing }) => {
    const state: any = {
      listCalls: 0, fileCalls: [], snapshotCalls: 0, documents: files,
      resolveHeldFile: undefined, connected: true,
      rows: [{ id: connectionId, name: 'Document fixture', remembered: true }],
    }
    Object.defineProperty(window, '__localDocumentBrowseHarness', { configurable: true, value: state })
    const common = {
      list: async (source: any) => source?.userId === 'user-ada' && state.connected ? state.rows : [],
      connect: async () => { throw new Error('document browsing does not reconnect native sources') },
      files: async (id: string, source: any) => {
        state.listCalls++
        state.listSource = { id, userId: source?.userId }
        return structuredClone(listing)
      },
      file: async (id: string, selection: { path: string }, source: any) => {
        state.fileCalls.push({ id, path: selection.path, userId: source?.userId })
        let document = state.documents[selection.path]
        if (selection.path === heldPath) document = await new Promise(resolve => { state.resolveHeldFile = resolve })
        return {
          version: 1,
          path: selection.path,
          sizeBytes: document.bytes.length,
          snapshot: { document: { format: document.format, bytes: new Uint8Array(document.bytes) } },
        }
      },
      snapshot: async () => { state.snapshotCalls++; throw new Error('document browsing never captures a source snapshot') },
      review: async () => { throw new Error('document browsing never reads Git changes') },
      disconnect: async (id: string) => {
        state.connected = false
        state.rows = state.rows.filter((row: { id: string }) => row.id !== id)
      },
    }
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { [bridgeName]: common } },
    })
  }, { connectionId: bridge === 'localFolders' ? FOLDER_ID : GIT_ID, bridgeName: bridge, files: serialized, heldPath: holdPath, listing })
}

async function createEmptySession(page: Page) {
  const response = await page.request.post(`${API}/sessions`, { data: {} })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as { id: string }
}

async function switchAccount(page: Page, optionText: string, expected: string) {
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByTestId('account-chip')).toBeInViewport()
  await page.getByTestId('account-chip').click({ timeout: ms(10_000) })
  await page.getByTestId('account-stack-option').filter({ hasText: optionText }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(expected, { timeout: ms(5_000) })
}

async function signIntoAdaAndGrace(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const ada = await page.request.post(`${API}/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
  expect(ada.ok(), await ada.text()).toBeTruthy()
  const grace = await page.request.post(`${API}/auth/login`, { data: { email: 'grace@acme.example', password: 'grace-demo-password' } })
  expect(grace.ok(), await grace.text()).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')
}

async function folderPicker(page: Page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Folder/ }).click()
  await dialog.getByRole('button', { name: 'This computer', exact: true }).click()
  const picker = dialog.locator('[data-native-folder-picker]')
  await picker.getByRole('button', { name: 'Browse files in Document fixture', exact: true }).click()
  return { dialog, browser: picker.locator('[data-local-folder-browser]') }
}

async function selectPath(browser: Locator, path: string) {
  await browser.getByRole('searchbox', { name: 'Search paths' }).fill(path)
  const button = browser.getByRole('list', { name: 'Folder paths' }).getByRole('button', { name: `${path} File`, exact: true })
  await expect(button).toBeVisible()
  await button.click()
  return browser.locator('[data-local-folder-file-preview]')
}

async function expectNoPageOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    { message: `document preview has no page overflow at ${width}px` }).toBe(true)
}

test('local Folder document browsing runs real extractors, attaches only frozen text, and fences omissions', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(ms(120_000))
  await addDocumentNativeFixture(page, 'localFolders')
  const session = await createEmptySession(page)
  const messagePosts: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(`/sessions/${session.id}/messages`)) messagePosts.push(request.url())
  })
  await page.goto(`/s/${session.id}`)
  const parserRequests: string[] = []
  page.on('request', request => {
    if (/pdf\.worker|officeParser/i.test(request.url()) && /worker/.test(request.url())) parserRequests.push(request.url())
  })
  const { dialog, browser } = await folderPicker(page)
  await expect(browser.getByRole('button', { name: 'List folder paths', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.listCalls)).toBe(0)
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls)).toEqual([])
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls)).toEqual([], 'listing document names reads no document bytes')

  const expectedFormats = [
    { path: pdfPath, format: 'pdf', suffix: '_PDF' },
    { path: docxPath, format: 'docx', suffix: '_DOCX' },
    { path: xlsxPath, format: 'xlsx', suffix: '_XLSX' },
    { path: pptxPath, format: 'pptx', suffix: '_PPTX' },
  ] as const
  const expectedOutcomes = {
    pdf: { format: 'pdf', status: 'ready', pages: 2, textPages: 1 },
    docx: { format: 'docx', status: 'ready' },
    xlsx: { format: 'xlsx', status: 'ready' },
    pptx: { format: 'pptx', status: 'ready' },
  }
  const displayedText = new Map<string, string>()
  for (const item of expectedFormats) {
    const preview = await selectPath(browser, item.path)
    const disclosure = preview.locator(`[data-local-document-preview="${item.format}"]`)
    const textRegion = preview.getByRole('region', { name: `Preview of ${item.path}` })
    await expect(disclosure).toBeVisible({ timeout: ms(20_000) })
    await expect(preview.locator('p').filter({ hasText: 'Original document bytes are not saved.' })).toBeVisible()
    await expect(textRegion).toContainText(`${marker}${item.suffix}`)
    displayedText.set(item.path, (await textRegion.textContent()) ?? '')
    await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toBeEnabled()
    const prior = await (await page.request.get(`${API}/sessions/${session.id}`)).json()
    expect(JSON.stringify(prior)).not.toContain(`${marker}${item.suffix}`, 'selected document text remains transient before Attach saved copy')
    if (item.path === pdfPath) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await expectNoPageOverflow(page, viewport.width)
        await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth),
          { message: `long document path and disclosure fit at ${viewport.width}px` }).toBe(true)
        const attach = browser.getByRole('button', { name: 'Attach saved copy', exact: true })
        await attach.scrollIntoViewIfNeeded()
        await expect(attach).toBeVisible()
        await expect(attach).toBeEnabled()
        await assertWcag22Aa(page, `local document preview ${viewport.width}x${viewport.height}`)
        await page.screenshot({ path: testInfo.outputPath(`local-document-${viewport.width}x${viewport.height}.png`), fullPage: false })
      }
      await page.setViewportSize(VIEWPORTS[4])
      await page.evaluate(({ path, replacement }) => {
        const state = (window as any).__localDocumentBrowseHarness
        state.documents[path] = { format: 'pdf', bytes: [...new TextEncoder().encode(replacement)] }
      }, { path: pdfPath, replacement: changedMarker })
      await expect(textRegion).toContainText(`${marker}${item.suffix}`)
      await expect(textRegion).not.toContainText(changedMarker)
    }
    await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
    await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  }

  const saved = await (await page.request.get(`${API}/sessions/${session.id}`)).json()
  const attached = expectedFormats.map(item => {
    const value = saved.workspace.attachments.find((row: any) => row.label === item.path)
    expect(value, `${item.path} is durably attached`).toBeTruthy()
    expect(value.documentImport).toEqual(expectedOutcomes[item.format])
    expect(value.previewText).toContain(`${marker}${item.suffix}`)
    expect(value.previewText).toBe(displayedText.get(item.path), 'the attached text exactly matches the displayed extracted text')
    expect(value.previewText).not.toContain(changedMarker)
    return value
  })
  expect(new Set(attached.map((item: any) => item.id)).size).toBe(4, 'each document path has a stable distinct attachment identity')
  expect(JSON.stringify(saved)).not.toContain('%PDF-')
  expect(attached.every((item: any) => !Object.hasOwn(item, 'bytes') && !Object.hasOwn(item, 'document')))
    .toBe(true, 'persisted attachment records contain extracted text and outcome, never native bytes')
  expect(messagePosts).toEqual([], 'opening, listing, extracting and attaching never sends a model message')
  const fileCalls = await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls)
  expect(fileCalls).toEqual(expectedFormats.map(item => ({ id: FOLDER_ID, path: item.path, userId: 'user-ada' })))
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.snapshotCalls)).toBe(0)
  expect(parserRequests.some(url => /pdf\.worker/.test(url)), 'PDF bytes reached the dedicated real PDF worker').toBe(true)
  expect(parserRequests.some(url => /officeParser/i.test(url)), 'Office bytes reached the real Office extraction worker').toBe(true)

  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const reopened = await folderPicker(page)
  await expect(reopened.browser.locator('[data-local-folder-file-preview] h3')).toHaveText(pptxPath)
  await expect(reopened.browser.locator('[data-local-folder-file-preview] [data-local-document-preview="pptx"]'))
    .toContainText(documentImportCopy(expectedOutcomes.pptx))
  await expect(reopened.browser.getByRole('region', { name: `Preview of ${pptxPath}` })).toContainText(`${marker}_PPTX`)
  await expect(reopened.browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await expect(reopened.dialog).toContainText('4 added')
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls.map((call: any) => call.path))).toEqual(expectedFormats.map(item => item.path),
    'reopening shows only the current last-selected preview and does not reread source bytes')
  await reopened.dialog.getByRole('button', { name: 'Done', exact: true }).click()

  for (const item of [
    { path: protectedPath, marker: `${marker}_LOCKED`, outcome: 'protected' },
    { path: noTextPath, marker: undefined, outcome: 'no-text' },
    { path: invalidPath, marker: undefined, outcome: 'invalid' },
    { path: unsupportedPath, marker: undefined, outcome: 'unsupported' },
  ]) {
    const current = await folderPicker(page)
    const before = (await (await page.request.get(`${API}/sessions/${session.id}`)).json()).workspace.attachments.length
    const preview = await selectPath(current.browser, item.path)
    const format = item.path.endsWith('.pdf') ? 'pdf' : item.path.endsWith('.pptx') ? 'pptx' : 'docx'
    const disclosure = preview.locator(`[data-local-document-preview="${format}"]`)
    await expect(disclosure).toBeVisible({ timeout: ms(20_000) })
    await expect(disclosure).toContainText(documentImportCopy({ format, status: item.outcome } as any))
    if (item.marker) await expect(preview.getByRole('region', { name: `Preview of ${item.path}` })).toHaveCount(0)
    await expect(current.browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
    await expect(current.browser.getByRole('button', { name: 'Added', exact: true })).toHaveCount(0)
    const after = (await (await page.request.get(`${API}/sessions/${session.id}`)).json()).workspace.attachments.length
    expect(after).toBe(before, `${item.outcome} documents never attach partial or empty text`)
    await current.dialog.getByRole('button', { name: 'Done', exact: true }).click()
  }
})

test('a draft local document copy keeps its identity when first Send materializes the Session', async ({ page, browser: browserEngine }) => {
  test.setTimeout(ms(90_000))
  await addDocumentNativeFixture(page, 'localFolders')
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  await page.getByRole('navigation').getByRole('button', { name: 'New session', exact: true }).click()
  const composer = page.getByPlaceholder('Reply to Claude…')
  await expect(composer).toBeVisible()
  const messagePosts: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.includes('/messages')) messagePosts.push(request.url())
  })
  const { dialog, browser } = await folderPicker(page)
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  const preview = await selectPath(browser, pptxPath)
  const disclosure = preview.locator('[data-local-document-preview="pptx"]')
  const textRegion = preview.getByRole('region', { name: `Preview of ${pptxPath}` })
  await expect(disclosure).toBeVisible({ timeout: ms(20_000) })
  await expect(textRegion).toContainText(`${marker}_PPTX`)
  const displayedText = (await textRegion.textContent()) ?? ''
  await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await expect(dialog).toContainText('1 added')
  await expect.poll(() => page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls.length)).toBe(1)
  expect(messagePosts).toEqual([], 'a draft document preview never sends before explicit Send')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()

  await composer.fill('Use the saved local document copy.')
  await composer.press('Enter')
  await expect(page).toHaveURL(/\/s\/[^/?#]+$/, { timeout: ms(20_000) })
  const sessionId = decodeURIComponent(new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!)
  let savedId = ''
  await expect.poll(async () => {
    const response = await page.request.get(`${API}/sessions/${sessionId}`)
    if (!response.ok()) return false
    const body = await response.json()
    const saved = body.workspace?.attachments?.find((item: any) => item.label === pptxPath)
    if (!saved) return false
    savedId = saved.id
    return saved.previewText
  }, { message: 'first Send materializes the same frozen document copy', timeout: ms(20_000) }).toBe(displayedText)
  const saved = await (await page.request.get(`${API}/sessions/${sessionId}`)).json()
  const attachment = saved.workspace.attachments.find((item: any) => item.id === savedId)
  expect(attachment.documentImport).toEqual({ format: 'pptx', status: 'ready' })
  expect(attachment.previewText).toBe(displayedText)
  expect(messagePosts).toHaveLength(1, 'only the explicit first Send creates a model-input request')

  await page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
  await page.getByLabel('Audience id').fill('tenant-beta')
  await page.getByRole('button', { name: /Share|Publish/ }).last().click()
  const viewer = await newUser(browserEngine, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  try {
    await viewer.page.goto(`/s/${sessionId}`)
    const sharedChip = viewer.page.getByTitle('Open in sidebar').filter({ hasText: pptxPath })
    await expect(sharedChip).toBeVisible()
    await sharedChip.click()
    const sharedPreview = viewer.page.locator('[data-attachment-preview]')
    await expect(sharedPreview).toBeVisible()
    await expect(sharedPreview.locator('[data-document-import="ready"]')).toBeVisible()
    await expect(sharedPreview.locator('pre')).toHaveText(displayedText)
    await expect(viewer.page.getByTitle('Remove file', { exact: true })).toHaveCount(0)
    await expect(viewer.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
  } finally {
    await viewer.context.close()
  }
  const foreign = await newUser(browserEngine, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    expect((await foreign.page.request.get(`${API}/sessions/${sessionId}`)).status()).toBe(404)
    await foreign.page.goto(`/s/${sessionId}`)
    await expect(foreign.page.getByRole('heading', { name: 'What should we work on?', exact: true })).toBeVisible()
    await expect(foreign.page.locator('[data-attachment-preview]')).toHaveCount(0)
  } finally {
    await foreign.context.close()
  }

  const reopened = await folderPicker(page)
  await expect(reopened.dialog).toContainText('1 added')
  await expect(reopened.browser.locator('[data-local-folder-file-preview] h3')).toHaveText(pptxPath)
  await expect(reopened.browser.getByRole('region', { name: `Preview of ${pptxPath}` })).toContainText(`${marker}_PPTX`)
  await expect(reopened.browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  const final = await (await page.request.get(`${API}/sessions/${sessionId}`)).json()
  expect(final.workspace.attachments.filter((item: any) => item.id === savedId)).toHaveLength(1,
    'draft materialization and reopening preserve one stable saved attachment identity')
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls.length)).toBe(1,
    'reopening after materialization does not reread native document bytes')
})

test('dismissing a held native document response cannot publish stale bytes or extracted text', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await addDocumentNativeFixture(page, 'localFolders', latePath)
  const session = await createEmptySession(page)
  await page.goto(`/s/${session.id}`)
  const { browser } = await folderPicker(page)
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  await selectPath(browser, latePath)
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localDocumentBrowseHarness.resolveHeldFile)).toBe('function')
  await expect(browser.locator('p[role="status"]').filter({ hasText: `Reading ${latePath}…` })).toBeVisible()
  await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(browser.locator('p[role="status"]').filter({ hasText: 'The previous read is finishing' })).toBeVisible()
  await page.evaluate(({ format, bytes }) => (window as any).__localDocumentBrowseHarness.resolveHeldFile({
    format, bytes: new Uint8Array(bytes),
  }), { format: 'pdf', bytes: [...docs[latePath].bytes] })
  await expect(browser.getByRole('button', { name: 'List folder paths', exact: true })).toBeEnabled()
  await expect(browser.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await expect(page.getByText(`${marker}_LATE`, { exact: true })).toHaveCount(0)
  const saved = await (await page.request.get(`${API}/sessions/${session.id}`)).json()
  expect(JSON.stringify(saved)).not.toContain(`${marker}_LATE`)
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls.map((call: any) => call.path))).toEqual([latePath])
})

test('changing accounts while a native document response is held fences its late bytes', async ({ page }) => {
  test.setTimeout(ms(75_000))
  await addDocumentNativeFixture(page, 'localFolders', latePath)
  await signIntoAdaAndGrace(page)
  const session = await createEmptySession(page)
  await page.goto(`/s/${session.id}`)
  const { browser } = await folderPicker(page)
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  await selectPath(browser, latePath)
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localDocumentBrowseHarness.resolveHeldFile)).toBe('function')
  await switchAccount(page, 'Grace Hopper', 'Grace Hopper')
  await expect(page.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await page.evaluate(({ format, bytes }) => (window as any).__localDocumentBrowseHarness.resolveHeldFile({
    format, bytes: new Uint8Array(bytes),
  }), { format: 'pdf', bytes: [...docs[latePath].bytes] })
  await expect(page.getByText(`${marker}_LATE`, { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls.map((call: any) => call.path))).toEqual([latePath])
})

test('disconnecting while a native document response is held fences its late bytes', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await addDocumentNativeFixture(page, 'localFolders', latePath)
  await page.goto('/contexts/' + FOLDER_ID)
  const detail = page.locator(`[data-local-folder-detail="${FOLDER_ID}"]`)
  const browser = detail.locator('[data-local-folder-browser]')
  await expect(browser.getByRole('button', { name: 'List folder paths', exact: true })).toBeVisible()
  await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
  await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
  await selectPath(browser, latePath)
  await expect.poll(() => page.evaluate(() => typeof (window as any).__localDocumentBrowseHarness.resolveHeldFile)).toBe('function')
  await detail.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
  await expect(page.locator('[data-local-folder-file-preview]')).toHaveCount(0)
  await page.evaluate(({ format, bytes }) => (window as any).__localDocumentBrowseHarness.resolveHeldFile({
    format, bytes: new Uint8Array(bytes),
  }), { format: 'pdf', bytes: [...docs[latePath].bytes] })
  await expect(page.getByText(`${marker}_LATE`, { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls.map((call: any) => call.path))).toEqual([latePath])
})

test('dismissing a document while its real PDF worker is held fences the late extraction result', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await addDocumentNativeFixture(page, 'localFolders')
  const session = await createEmptySession(page)
  await page.goto(`/s/${session.id}`)
  let releaseWorker!: () => void
  let workerStarted = false
  const heldWorker = new Promise<void>(resolve => { releaseWorker = resolve })
  await page.route(/pdf\.worker/, async route => {
    if (!new URL(route.request().url()).searchParams.has('worker_file')) return route.continue()
    workerStarted = true
    await heldWorker
    await route.continue().catch(() => {})
  })
  try {
    const { browser } = await folderPicker(page)
    await browser.getByRole('button', { name: 'List folder paths', exact: true }).click()
    await expect(browser.locator('[data-local-folder-browser-listing]')).toBeVisible()
    await selectPath(browser, latePath)
    await expect.poll(() => workerStarted, { timeout: ms(20_000) }).toBe(true)
    await expect(browser.locator('p[role="status"]').filter({ hasText: `Reading ${latePath}…` })).toBeVisible()
    await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
    releaseWorker()
    await expect(browser.getByRole('button', { name: 'List folder paths', exact: true })).toBeEnabled()
    await expect(browser.locator('[data-local-folder-file-preview]')).toHaveCount(0)
    await expect(page.getByText(`${marker}_LATE`, { exact: true })).toHaveCount(0)
    const saved = await (await page.request.get(`${API}/sessions/${session.id}`)).json()
    expect(JSON.stringify(saved)).not.toContain(`${marker}_LATE`)
    expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls.map((call: any) => call.path))).toEqual([latePath])
  } finally {
    releaseWorker()
    await page.unroute(/pdf\.worker/)
  }
})

test('local Git document preview shares the real extraction disclosure and Project context stays browse-only', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await addDocumentNativeFixture(page, 'localGit')
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const projectName = `Git document browse ${stamp}`
  await createProject(page, projectName)
  const projectPath = new URL(page.url()).pathname
  const contextSection = page.locator('section[class~="group/section"]').filter({
    has: page.locator('[data-section-title]', { hasText: /^Context$/i }),
  })
  const heading = contextSection.getByRole('button', { name: /^Context(?:\s|$)/i })
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click()
  await contextSection.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Repository/ }).click()
  const nativePicker = dialog.locator('[data-native-git-picker]')
  await nativePicker.getByRole('button', { name: 'Browse files in Document fixture', exact: true }).click()
  const browser = nativePicker.locator('[data-local-git-browser]')
  await expect(browser.getByRole('button', { name: 'List tracked paths', exact: true })).toBeVisible()
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  await browser.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await expect(browser.locator('[data-local-git-browser-listing]')).toBeVisible()
  const search = browser.getByRole('searchbox', { name: 'Search paths' })
  await search.fill(docxPath)
  const row = browser.getByRole('list', { name: 'Tracked repository paths' }).getByRole('button', { name: `${docxPath} Tracked file`, exact: true })
  await row.click()
  const preview = browser.locator('[data-local-git-file-preview]')
  const disclosure = preview.locator('[data-local-document-preview="docx"]')
  await expect(disclosure).toBeVisible({ timeout: ms(20_000) })
  await expect(disclosure).toContainText(documentImportCopy({ format: 'docx', status: 'ready' }))
  await expect(preview.getByRole('region', { name: `Preview of ${docxPath}` })).toContainText(`${marker}_DOCX`)
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls.map((call: any) => call.path))).toEqual([docxPath])
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.snapshotCalls)).toBe(0)
  expect(new URL(page.url()).pathname).toBe(projectPath, 'reading a tracked document does not navigate away from its Project')
})

async function assertCanonicalDocumentDetail(
  page: Page,
  testInfo: TestInfo,
  bridge: 'localFolders' | 'localGit',
) {
  const connectionId = bridge === 'localFolders' ? FOLDER_ID : GIT_ID
  const route = `/contexts/${connectionId}`
  const detailSelector = bridge === 'localFolders'
    ? `[data-local-folder-detail="${connectionId}"]`
    : `[data-local-git-detail="${connectionId}"]`
  const browserSelector = bridge === 'localFolders' ? '[data-local-folder-browser]' : '[data-local-git-browser]'
  const listButtonName = bridge === 'localFolders' ? 'List folder paths' : 'List tracked paths'
  const listingSelector = bridge === 'localFolders' ? '[data-local-folder-browser-listing]' : '[data-local-git-browser-listing]'
  const listName = bridge === 'localFolders' ? 'Folder paths' : 'Tracked repository paths'
  const rowName = bridge === 'localFolders' ? `${docxPath} File` : `${docxPath} Tracked file`

  await addDocumentNativeFixture(page, bridge)
  await signIntoAdaAndGrace(page)
  await page.goto(route)
  expect(new URL(page.url()).pathname).toBe(route)
  const detail = page.locator(detailSelector)
  const browser = detail.locator(browserSelector)
  await expect(detail.getByRole('heading', { name: 'Document fixture', exact: true })).toBeVisible()
  await expect(browser.getByRole('button', { name: listButtonName, exact: true })).toBeVisible()
  await expect(browser.locator(listingSelector)).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.listCalls)).toBe(0)
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls)).toEqual([])

  await browser.getByRole('button', { name: listButtonName, exact: true }).click()
  await expect(browser.locator(listingSelector)).toBeVisible()
  const row = browser.getByRole('list', { name: listName }).getByRole('button', { name: rowName, exact: true })
  await expect(row).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls)).toEqual([], 'listing names alone never reads source bytes')
  const parserRequests: string[] = []
  page.on('request', request => {
    if (/officeParser/i.test(request.url()) && /worker/.test(request.url())) parserRequests.push(request.url())
  })
  await row.click()

  const previewSelector = bridge === 'localFolders' ? '[data-local-folder-file-preview]' : '[data-local-git-file-preview]'
  const preview = browser.locator(previewSelector)
  await expect(preview.getByRole('heading', { name: docxPath, exact: true })).toBeVisible()
  const disclosure = preview.locator('[data-local-document-preview="docx"]')
  const textRegion = preview.getByRole('region', { name: `Preview of ${docxPath}` })
  await expect(disclosure).toBeVisible({ timeout: ms(20_000) })
  await expect(disclosure).toContainText(documentImportCopy({ format: 'docx', status: 'ready' }))
  await expect(preview.locator('p').filter({ hasText: 'Original document bytes are not saved.' })).toBeVisible()
  await expect(textRegion).toBeVisible()
  await expect(textRegion).toContainText(`${marker}_DOCX`)
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.listCalls)).toBe(1)
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.fileCalls)).toEqual([
    { id: connectionId, path: docxPath, userId: 'user-ada' },
  ])
  expect(await page.evaluate(() => (window as any).__localDocumentBrowseHarness.snapshotCalls)).toBe(0)
  expect(parserRequests.length, 'the canonical source preview reaches the real Office extraction worker').toBeGreaterThan(0)

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expectNoPageOverflow(page, viewport.width)
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth),
      { message: `canonical document preview and disclosure fit at ${viewport.width}px` }).toBe(true)
    await expect(detail.getByRole('heading', { name: 'Document fixture', exact: true })).toBeVisible()
    await expect(textRegion).toBeVisible()
    await expect(textRegion).toContainText(`${marker}_DOCX`)
    await expect(preview.locator('p').filter({ hasText: 'Original document bytes are not saved.' })).toBeVisible()
    await assertWcag22Aa(page, `canonical ${bridge} document detail ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`canonical-${bridge}-document-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
}

test('canonical Folder source detail renders a real DOCX preview accessibly at five viewports', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  await assertCanonicalDocumentDetail(page, testInfo, 'localFolders')
})

test('canonical Git source detail renders a real DOCX preview accessibly at five viewports', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  await assertCanonicalDocumentDetail(page, testInfo, 'localGit')
})
