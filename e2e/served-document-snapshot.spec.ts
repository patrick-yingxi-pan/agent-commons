/** Rendered coverage for served PDF and Office snapshots. Source bytes are
 * captured once on Add/Refresh; the workspace, preview, and model use that
 * saved projection thereafter. */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { pptxFixture } from '../tests/helpers/pptxFixture.mjs'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { startMessagesFixture } from './attachment-endpoint.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'
import { tierFor } from '../src/lib/viewport.ts'

mkdirSync('.data/served-document-review', { recursive: true })

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

const SOURCES = [
  { id: 'cloud', kind: 'cloud', label: 'Cloud storage' },
  { id: 'runner:runner-local', kind: 'runner', runnerId: 'runner-local', label: 'Mapped documents' },
]

const FORMATS = [
  {
    ext: 'pdf', mimeType: 'application/pdf', sourceId: 'cloud', name: 'brief.pdf',
    make: (marker: string) => pdfFixture({ pages: [`${marker} first page`, 'second page'] }),
  },
  {
    ext: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sourceId: 'runner:runner-local', name: 'brief.docx',
    make: (marker: string) => docxFixture({ paragraphs: [marker, 'Word body'] }),
  },
  {
    ext: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sourceId: 'cloud', name: 'brief.xlsx',
    make: (marker: string) => xlsxFixture({ sheets: [{ name: 'Visible data', rows: [[marker, 42]] }] }),
  },
  {
    ext: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sourceId: 'runner:runner-local', name: 'brief.pptx',
    make: (marker: string) => pptxFixture({ slides: [{ name: 'Visible slide', shapes: [marker, 'Presentation body'] }] }),
  },
] as const

type CapturedFile = { sourceId: string; path: string; name: string; ext: string; size: number; mtime: number; mimeType: string; bytes: Buffer; marker: string }

function sourceFor(id: string) {
  const source = SOURCES.find((item) => item.id === id)
  if (!source) throw new Error(`Unknown served test source ${id}`)
  return source
}

function filesFor(captures: readonly CapturedFile[]): Array<{ id: string; name: string; ext: string; size: number; mtime: number; kind: 'doc' | 'sheet' | 'slide' }> {
  return captures.map(({ path, name, ext, bytes }) => ({
    id: path, name, ext, size: bytes.byteLength, mtime: 1,
    kind: ext === 'xlsx' ? 'sheet' : ext === 'pptx' ? 'slide' : 'doc',
  }))
}

/** The E2E owns the served-source HTTP fixture; the filesystem readers and
 * runner grant checks are locked separately in server tests. */
async function serveCatalogAndBytes(page: Page, captures: readonly CapturedFile[], read?: (file: CapturedFile, route: Route) => Promise<void>) {
  const reads: string[] = []
  await page.route('**/api/v1/fs/sources', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SOURCES),
  }))
  await page.route('**/api/v1/fs/catalog?*', (route) => {
    const url = new URL(route.request().url())
    const source = sourceFor(url.searchParams.get('source') ?? '')
    const entries = captures.filter((file) => file.sourceId === source.id).map((file) => filesFor([file])[0]!)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      source, files: entries, photos: [], folders: [],
    }) })
  })
  await page.route('**/api/v1/fs/content?*', async (route) => {
    const url = new URL(route.request().url())
    const sourceId = url.searchParams.get('source') ?? ''
    const path = url.searchParams.get('path') ?? ''
    const file = captures.find((item) => item.sourceId === sourceId && item.path === path)
    if (!file) return route.fulfill({ status: 404, body: 'missing test source' })
    reads.push(`${sourceId}::${path}`)
    if (read) return read(file, route)
    return route.fulfill({ status: 200, contentType: file.mimeType, body: file.bytes })
  })
  return reads
}

async function createSession(page: Page, tenant = `tenant-served-doc-${randomUUID()}`, providerId?: string) {
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  const response = await page.request.post('/api/v1/sessions', { data: providerId ? { providerId } : {} })
  expect(response.ok(), 'a test-owned conversation is created').toBe(true)
  return (await response.json() as { id: string }).id
}

async function createModelSession(page: Page) {
  const tenant = `tenant-served-doc-model-${randomUUID()}`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenant })
  const endpoint = await startMessagesFixture()
  const provider = await page.request.post('/api/v1/providers', { data: {
    label: `Served document fixture ${randomUUID()}`, modelFamily: 'claude', effortLevels: ['Default'],
    config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
  } })
  expect(provider.ok(), 'the fixture model provider is created').toBe(true)
  const sessionId = await createSession(page, tenant, (await provider.json()).id)
  return { endpoint, sessionId }
}

async function registerMappedRunner(page: Page) {
  const response = await page.request.post('/api/v1/runners', { data: {
    id: 'runner-local', label: 'Mapped documents', host: 'e2e',
    capabilities: [
      { type: 'fs.read', scopes: ['~/projects'] },
      { type: 'fs.list', scopes: ['~/projects'] },
    ],
  } })
  expect(response.ok(), 'the served refresh uses a real registered runner authority').toBe(true)
}

async function fileRow(page: Page, picker: ReturnType<Page['getByRole']>, name: string) {
  const row = page.getByRole('button', { name: new RegExp(`^${name.replaceAll('.', '\\.')}\\b`) }).first()
  const more = picker.getByRole('button', { name: /^More files\b/ })
  if (await more.isVisible().catch(() => false)) await more.click()
  await expect(row, `the source catalog exposes ${name}`).toBeVisible({ timeout: ms(15_000) })
  return row
}

async function openFiles(page: Page) {
  const dock = page.locator('[data-overlay-dock]').filter({ visible: true })
  if (await dock.count()) await dock.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Files/ }).click()
  return picker
}

async function chooseSource(page: Page, picker: ReturnType<Page['getByRole']>, sourceId: string) {
  const source = sourceFor(sourceId)
  await picker.getByRole('button', { name: source.label, exact: true }).click()
}

async function assertContained(locator: ReturnType<Page['locator']>, page: Page, description: string) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  expect(box, `${description} has a rendered box`).not.toBeNull()
  expect(viewport, 'the review viewport is explicit').not.toBeNull()
  expect(box!.x, `${description} stays inside the left edge`).toBeGreaterThanOrEqual(0)
  expect(box!.y, `${description} stays inside the top edge`).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, `${description} stays inside the right edge`).toBeLessThanOrEqual(viewport!.width)
  expect(box!.y + box!.height, `${description} stays inside the bottom edge`).toBeLessThanOrEqual(viewport!.height)
}

async function waitForSavedDocument(page: Page, file: CapturedFile, expectedText = file.marker) {
  const sessionId = decodeURIComponent(new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) ?? '')
  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)
    if (!response.ok()) return false
    const saved = await response.json() as {
      workspace?: { attachments?: Array<{ label: string; source?: { id?: string }; textSnapshot?: { version: number; sourceId: string; path: string; text: string; documentImport?: { format: string; status: string } } }> }
    }
    const attachment = saved.workspace?.attachments?.find((item) => item.label === file.name && item.source?.id === file.sourceId)
    const snapshot = attachment?.textSnapshot
    return snapshot?.version === 2 && snapshot.sourceId === file.sourceId && snapshot.path === file.path &&
      snapshot.documentImport?.format === file.ext && snapshot.documentImport.status === 'ready' && snapshot.text.includes(expectedText)
  }, { message: `${file.name} is attached with its own complete saved snapshot`, timeout: ms(20_000) }).toBe(true)
}

async function selectServedPreview(page: Page, file: CapturedFile) {
  const preview = page.locator(`[data-attachment-preview="${file.sourceId}::${file.path}"]`).filter({ visible: true })
  if (await preview.count()) {
    await settledAttachmentPreview(page)
    return preview
  }
  const chip = page.getByTitle('Open in sidebar').filter({ hasText: file.name }).filter({ visible: true })
  if (await chip.count()) {
    await chip.click()
  } else {
    const group = page.getByTitle(/^Files \(\d+\)$/).filter({ visible: true })
    await expect(group, 'the attached file group is visible').toBeVisible()
    await group.click()
    const menu = page.getByRole('menu', { name: 'Files', exact: true })
    await menu.getByRole('button', { name: file.name, exact: true }).click()
  }
  await settledAttachmentPreview(page)
  await expect(preview, `${file.name} is the selected read-only preview`).toBeVisible()
  await expect(preview.locator('[data-document-import="ready"]')).toBeVisible()
  return preview
}

async function attachServedFile(page: Page, file: CapturedFile, expectedText = file.marker) {
  const picker = await openFiles(page)
  await chooseSource(page, picker, file.sourceId)
  await (await fileRow(page, picker, file.name)).click()
  await waitForSavedDocument(page, file, expectedText)
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
  // Done releases the intake lease and reveals the acknowledged attachment.
  // Let that projection settle before deciding whether another row needs focus.
  await settledAttachmentPreview(page)
  return selectServedPreview(page, file)
}

async function captureReview(page: Page, testInfo: TestInfo, state: string, viewport: typeof VIEWPORTS[number]) {
  const size = `${viewport.width}x${viewport.height}`
  await page.setViewportSize(viewport)
  await settledAttachmentPreview(page)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), {
    message: `${state} has no horizontal overflow at ${size}`,
  }).toBe(true)
  await assertWcag22Aa(page, `Served document ${state} ${size}`)
  if (state === 'refresh-pending') {
    await expect(visibleMutationNotice(page, 'status', 'Updating context…')).toHaveCount(1)
    await expect(page.locator('[data-attachment-preview]').filter({ visible: true }).getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeDisabled()
  }
  if (state === 'refresh-recovery') {
    const error = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.')
    await expect(error).toHaveCount(1)
    await expect(page.locator('[data-attachment-preview]').filter({ visible: true }).getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeDisabled()
    if (viewport.width === 844) await assertContained(error, page, `refresh error at ${size}`)
  }
  if (state === 'refresh-pending' || state === 'refresh-recovery') {
    const footer = page.locator('[data-context-panel-status]').filter({ visible: true })
    await expect(footer).toHaveCount(1)
    await assertContained(footer, page, `context recovery footer at ${size}`)
    const body = page.locator('[data-panel-body]').filter({ visible: true })
    const bodyBox = await body.boundingBox()
    const footerBox = await footer.boundingBox()
    expect(bodyBox, 'the same panel retains its readable body').not.toBeNull()
    expect(bodyBox!.height).toBeGreaterThan(0)
    expect(bodyBox!.y + bodyBox!.height, 'recovery reserves space instead of covering saved text').toBeLessThanOrEqual(footerBox!.y)
    const preview = page.locator('[data-attachment-preview]').filter({ visible: true })
    if (viewport.width === 844) {
      await preview.focus()
      await expect(preview).toBeFocused()
      expect(await preview.evaluate(element => element.scrollHeight > element.clientHeight), 'short landscape really requires scrolling').toBe(true)
      await preview.press('Home')
      await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBe(0)
      await preview.press('End')
      await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    }
    await preview.locator('pre').scrollIntoViewIfNeeded()
  }
  await page.screenshot({ path: `.data/served-document-review/${state}-${size}-${testInfo.workerIndex}.png`, fullPage: true })
}

async function capturePicker(page: Page, testInfo: TestInfo, picker: ReturnType<Page['getByRole']>, viewport: typeof VIEWPORTS[number]) {
  const size = `${viewport.width}x${viewport.height}`
  await expect(picker).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), {
    message: `picker has no horizontal overflow at ${size}`,
  }).toBe(true)
  await assertWcag22Aa(page, `Served document picker ${size}`)
  await assertContained(picker.getByRole('button', { name: 'Done', exact: true }), page, `picker Done at ${size}`)
  await page.screenshot({ path: `.data/served-document-review/picker-${size}-${testInfo.workerIndex}.png`, fullPage: true })
}

function visibleMutationNotice(page: Page, role: 'status' | 'alert', message: string) {
  const host = tierFor(page.viewportSize()!.width) === 'wide'
    ? page.locator('[data-context-pane]').filter({ visible: true })
    : page.locator('[data-overlay-dock]').filter({ visible: true })
  return host.getByRole(role).filter({ hasText: message }).filter({ visible: true })
}

test('served PDF, DOCX, XLSX, and PPTX parse into saved snapshots and send the saved text', async ({ page, browser }) => {
  test.setTimeout(ms(120_000))
  const { endpoint, sessionId } = await createModelSession(page)
  const captures: CapturedFile[] = FORMATS.map((format, index) => {
    const marker = `SERVED_${format.ext.toUpperCase()}_${randomUUID().slice(0, 8)}`
    return {
      sourceId: format.sourceId, path: `documents/${format.name}`, name: format.name, ext: format.ext,
      mimeType: format.mimeType, bytes: format.make(marker), marker, size: 0, mtime: index + 1,
    }
  })
  const reads = await serveCatalogAndBytes(page, captures)
  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    for (const file of captures) {
      const preview = await attachServedFile(page, file)
      await expect(preview).toContainText(file.marker)
      await expect(preview.locator('[data-document-import="ready"]')).toBeVisible()
    }
    expect(reads).toHaveLength(4)
    const persisted = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
      workspace: { attachments: Array<{ label: string; textSnapshot?: { version: number; sourceId: string; path: string; text: string; documentImport?: { format: string; status: string } } }> }
    }
    expect(persisted.workspace.attachments).toHaveLength(4)
    for (const file of captures) {
      const attachment = persisted.workspace.attachments.find((item) => item.label === file.name)
      expect(attachment?.textSnapshot).toMatchObject({
        version: 2, sourceId: file.sourceId, path: file.path,
        documentImport: { format: file.ext, status: 'ready' },
      })
      expect(attachment?.textSnapshot?.text).toContain(file.marker)
    }

    await page.reload()
    await settledAttachmentPreview(page)
    const latestPreview = await selectServedPreview(page, captures.at(-1)!)
    await expect(latestPreview).toContainText(captures.at(-1)!.marker)
    const sharedGrant = await page.request.post('/api/v1/grants', {
      data: { subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(sharedGrant.ok(), 'the owner grants a read-only shared view').toBe(true)

    const viewer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
    try {
      await viewer.page.setViewportSize(VIEWPORTS[4])
      await viewer.page.goto(`/s/${encodeURIComponent(sessionId)}`)
      await selectServedPreview(viewer.page, captures[0]!)
      const sharedPreview = viewer.page.locator('[data-attachment-preview]').filter({ visible: true })
      await expect(sharedPreview).toContainText(captures[0]!.marker)
      await expect(sharedPreview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toHaveCount(0)
      await expect(viewer.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
    } finally {
      await viewer.context.close()
    }

    const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
    try {
      const hidden = foreign.page.waitForResponse((response) =>
        response.url().includes(`/api/v1/sessions/${sessionId}`) && response.request().method() === 'GET',
        { timeout: ms(15_000) },
      )
      await foreign.page.goto(`/s/${encodeURIComponent(sessionId)}`)
      expect((await hidden).status(), 'an unrelated tenant cannot open the conversation snapshot').toBe(404)
      await expect(foreign.page.getByText(captures[0]!.marker, { exact: false })).toHaveCount(0)
    } finally {
      await foreign.context.close()
    }

    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('Summarize the saved documents.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: /Read supplied attachment:/ })).toBeVisible({ timeout: ms(25_000) })
    await expect.poll(() => endpoint.documents.length, { message: 'the send reaches the model fixture with saved context' }).toBe(1)
    const sent = endpoint.documents.at(-1)?.attached_files ?? []
    expect(sent).toHaveLength(4)
    for (const file of captures) {
      expect(sent.find((item) => item.name === file.name)).toMatchObject({ status: 'ready', text: expect.stringContaining(file.marker) })
    }
    expect(reads, 'reload, sharing, and model preparation use the saved snapshots').toHaveLength(4)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await new Promise<void>((resolve) => endpoint.server.close(() => resolve()))
  }
})

test('served-document picker, saved preview, and Refresh recovery fit all five viewports', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const sessionId = await createSession(page)
  const marker = `RESPONSIVE_DOCX_${randomUUID().slice(0, 8)}`
  const file: CapturedFile = {
    sourceId: 'cloud', path: 'documents/responsive.docx', name: 'responsive.docx', ext: 'docx',
    mimeType: FORMATS[1].mimeType, bytes: docxFixture({ paragraphs: [marker, 'Saved text remains visible during Refresh.'] }), marker, size: 0, mtime: 1,
  }
  let version = 0
  const reads = await serveCatalogAndBytes(page, [file], async (entry, route) => {
    version += 1
    if (version === 1) return route.fulfill({ status: 200, contentType: entry.mimeType, body: entry.bytes })
    return route.fulfill({ status: 200, contentType: entry.mimeType, body: docxFixture({ paragraphs: [`REFRESHED_${marker}`] }) })
  })
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
  let firstRefresh = true
  const postBodies: unknown[] = []
  await page.route(`**/api/v1/sessions/${sessionId}/attachments/*/refresh`, async (route) => {
    postBodies.push(route.request().postDataJSON())
    if (firstRefresh) {
      firstRefresh = false
      await firstGate
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Refresh temporarily failed.' } }) })
    }
    await route.continue()
  })

  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const preview = await attachServedFile(page, file)
    await expect(preview).toContainText(marker)
    for (const viewport of VIEWPORTS) {
      await captureReview(page, testInfo, 'saved', viewport)
      const picker = await openFiles(page)
      await chooseSource(page, picker, 'cloud')
      await expect(await fileRow(page, picker, file.name)).toBeVisible()
      await capturePicker(page, testInfo, picker, viewport)
      await picker.getByRole('button', { name: 'Done', exact: true }).click()
      await selectServedPreview(page, file)
    }

    const refresh = preview.getByRole('button', { name: 'Refresh saved copy', exact: true })
    const postWait = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/refresh'), { timeout: ms(20_000) })
    await refresh.click()
    await postWait
    const pending = visibleMutationNotice(page, 'status', 'Updating context…')
    await expect(pending).toHaveCount(1)
    for (const viewport of VIEWPORTS) await captureReview(page, testInfo, 'refresh-pending', viewport)
    releaseFirst()
    const failure = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.')
    await expect(failure).toHaveCount(1)
    await expect(failure).toBeVisible({ timeout: ms(15_000) })
    await expect(preview).toContainText(marker)
    for (const viewport of VIEWPORTS) await captureReview(page, testInfo, 'refresh-recovery', viewport)

    const ack = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/refresh'), { timeout: ms(15_000) })
    await failure.getByRole('button', { name: 'Retry', exact: true }).click()
    expect((await ack).ok(), 'Retry commits the frozen snapshot').toBe(true)
    expect(postBodies).toHaveLength(2)
    expect(postBodies[1]).toEqual(postBodies[0])
    expect(reads).toHaveLength(2)
    await expect(preview).toContainText(`REFRESHED_${marker}`)
  } finally {
    releaseFirst()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('cancelled, malformed, and oversized served captures never attach partial content', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createSession(page)
  const docs: CapturedFile[] = [
    { sourceId: 'cloud', path: 'documents/cancel.docx', name: 'cancel.docx', ext: 'docx', mimeType: FORMATS[1].mimeType, bytes: docxFixture({ paragraphs: ['CANCEL_MARKER'] }), marker: 'CANCEL_MARKER', size: 0, mtime: 1 },
    { sourceId: 'cloud', path: 'documents/invalid.pdf', name: 'invalid.pdf', ext: 'pdf', mimeType: 'application/pdf', bytes: Buffer.from('not a PDF'), marker: '', size: 9, mtime: 2 },
    { sourceId: 'cloud', path: 'documents/large.pdf', name: 'large.pdf', ext: 'pdf', mimeType: 'application/pdf', bytes: Buffer.alloc(8 * 1024 * 1024 + 1), marker: '', size: 8 * 1024 * 1024 + 1, mtime: 3 },
  ]
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const reads = await serveCatalogAndBytes(page, docs, async (file, route) => {
    if (file.name === 'cancel.docx') {
      await gate
      return route.fulfill({ status: 200, contentType: file.mimeType, body: file.bytes })
    }
    if (file.name === 'large.pdf') return route.fulfill({ status: 200, contentType: file.mimeType, body: file.bytes })
    return route.fulfill({ status: 200, contentType: file.mimeType, body: file.bytes })
  })
  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    let picker = await openFiles(page)
    const cancel = await fileRow(page, picker, 'cancel.docx')
    const captureRequest = page.waitForRequest((request) => request.url().includes('/api/v1/fs/content?') && request.url().includes('cancel.docx'), { timeout: ms(15_000) })
    await cancel.click()
    await captureRequest
    await expect(picker.locator('[data-fs-file-read="loading"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    release()
    await expect(page.getByTitle('Open in sidebar').filter({ hasText: 'cancel.docx' })).toHaveCount(0)

    picker = await openFiles(page)
    await page.setViewportSize(VIEWPORTS[3])
    await expect(await fileRow(page, picker, 'invalid.pdf')).toBeVisible()
    await (await fileRow(page, picker, 'invalid.pdf')).click()
    const invalid = picker.locator('[data-fs-file-read="error"]')
    await expect(invalid).toBeVisible({ timeout: ms(20_000) })
    await expect(invalid).toContainText(/could not|not imported|invalid/i)
    await invalid.getByRole('button', { name: 'Retry', exact: true }).scrollIntoViewIfNeeded()
    await assertContained(invalid.getByRole('button', { name: 'Retry', exact: true }), page, 'invalid document Retry')
    await capturePicker(page, testInfo, picker, VIEWPORTS[3])
    await expect(page.getByTitle('Open in sidebar').filter({ hasText: 'invalid.pdf' })).toHaveCount(0)

    await (await fileRow(page, picker, 'large.pdf')).click()
    const oversized = picker.locator('[data-fs-file-read="error"]')
    await expect(oversized).toBeVisible({ timeout: ms(20_000) })
    await expect(oversized).toContainText(/8 MB|too large|not imported/i)
    await oversized.getByRole('button', { name: 'Retry', exact: true }).scrollIntoViewIfNeeded()
    await assertContained(oversized.getByRole('button', { name: 'Retry', exact: true }), page, 'oversized document Retry')
    await capturePicker(page, testInfo, picker, VIEWPORTS[3])
    await expect(page.getByTitle('Open in sidebar').filter({ hasText: 'large.pdf' })).toHaveCount(0)
    const saved = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as { workspace: { attachments: unknown[] } }
    expect(saved.workspace.attachments).toHaveLength(0)
    expect(reads).toHaveLength(3)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('invalid Refresh leaves the previous document snapshot readable and retryable', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const sessionId = await createSession(page)
  const marker = `PRIOR_DOC_${randomUUID().slice(0, 8)}`
  const file: CapturedFile = {
    sourceId: 'cloud', path: 'documents/refresh.docx', name: 'refresh.docx', ext: 'docx', mimeType: FORMATS[1].mimeType,
    bytes: docxFixture({ paragraphs: [marker] }), marker, size: 0, mtime: 1,
  }
  let readsOnPath = 0
  const reads = await serveCatalogAndBytes(page, [file], async (entry, route) => {
    readsOnPath += 1
    const bytes = readsOnPath === 1 ? entry.bytes : readsOnPath === 2 ? Buffer.from('invalid ZIP archive') : Buffer.alloc(8 * 1024 * 1024 + 1)
    return route.fulfill({ status: 200, contentType: entry.mimeType, body: bytes })
  })
  let refreshPosts = 0
  await page.route(`**/api/v1/sessions/${sessionId}/attachments/*/refresh`, async (route) => {
    refreshPosts += 1
    await route.continue()
  })
  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const preview = await attachServedFile(page, file)
    await expect(preview).toContainText(marker)
    await preview.getByRole('button', { name: 'Refresh saved copy', exact: true }).click()
    const failure = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.')
    await expect(failure).toBeVisible({ timeout: ms(20_000) })
    await expect(failure).toContainText(/invalid|archive|could not|not imported/i)
    await expect(preview).toContainText(marker)
    await expect(preview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeDisabled()
    await failure.getByRole('button', { name: 'Use saved state', exact: true }).click()
    await expect(failure).toHaveCount(0)
    await expect(preview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeEnabled()
    await preview.getByRole('button', { name: 'Refresh saved copy', exact: true }).click()
    const oversizedFailure = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.')
    await expect(oversizedFailure).toBeVisible({ timeout: ms(20_000) })
    await expect(oversizedFailure).toContainText(/8 MB|too large|not imported/i)
    await expect(preview).toContainText(marker)
    expect(reads).toHaveLength(3)
    expect(refreshPosts, 'invalid bytes fail before any saved-state mutation request').toBe(0)
    const persisted = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
      workspace: { attachments: Array<{ textSnapshot?: { text: string; snapshotId: string } }> }
    }
    expect(persisted.workspace.attachments[0]?.textSnapshot?.text).toContain(marker)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('lost Refresh acknowledgement replays the same parsed snapshot without another source read', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await registerMappedRunner(page)
  const sessionId = await createSession(page)
  const marker = `LOST_ACK_${randomUUID().slice(0, 8)}`
  const file: CapturedFile = {
    sourceId: 'runner:runner-local', path: 'documents/replay.pdf', name: 'replay.pdf', ext: 'pdf', mimeType: FORMATS[0].mimeType,
    bytes: pdfFixture({ pages: [marker] }), marker, size: 0, mtime: 1,
  }
  let sourceVersion = 0
  const reads = await serveCatalogAndBytes(page, [file], async (entry, route) => {
    sourceVersion += 1
    const bytes = sourceVersion === 1 ? pdfFixture({ pages: ['Prior PDF snapshot'] }) : entry.bytes
    return route.fulfill({ status: 200, contentType: entry.mimeType, body: bytes })
  })
  const bodies: unknown[] = []
  let failAfterCommit = true
  await page.route(`**/api/v1/sessions/${sessionId}/attachments/*/refresh`, async (route) => {
    bodies.push(route.request().postDataJSON())
    if (failAfterCommit) {
      failAfterCommit = false
      const committed = await route.fetch()
      expect(committed.ok(), 'the server commits before its acknowledgement is lost').toBe(true)
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement was lost.' } }) })
    }
    await route.continue()
  })
  try {
    await page.setViewportSize(VIEWPORTS[4])
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const preview = await attachServedFile(page, file, 'Prior PDF snapshot')
    await expect(preview).toContainText('Prior PDF snapshot')
    await preview.getByRole('button', { name: 'Refresh saved copy', exact: true }).click()
    const failure = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.')
    await expect(failure).toBeVisible({ timeout: ms(20_000) })
    const committed = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
      workspace: { attachments: Array<{ textSnapshot?: { snapshotId: string; text: string } }> }
    }
    expect(committed.workspace.attachments[0]?.textSnapshot?.text).toContain(marker)
    const acknowledged = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/refresh'), { timeout: ms(15_000) })
    await failure.getByRole('button', { name: 'Retry', exact: true }).click()
    expect((await acknowledged).ok(), 'same-key replay reconciles the committed snapshot').toBe(true)
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    const body = bodies[0] as { expectedSnapshotId: string; requestId: string; snapshot: { snapshotId: string; text: string; documentImport: { format: string; status: string } } }
    expect(body.snapshot).toMatchObject({ snapshotId: body.requestId, documentImport: { format: 'pdf', status: 'ready' } })
    expect(body.snapshot.text).toContain(marker)
    expect(reads).toHaveLength(2)
    await expect(preview).toContainText(marker)
    await page.reload()
    await settledAttachmentPreview(page)
    await expect(page.locator('[data-attachment-preview]').filter({ visible: true })).toContainText(marker)
    expect(reads, 'reopen uses the committed saved snapshot').toHaveLength(2)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})
