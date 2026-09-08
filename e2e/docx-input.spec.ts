import { test, expect, type Page, type Request } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { assertWcag22Aa } from './accessibility-helpers'
import { startMessagesFixture } from './attachment-endpoint'
import { ms } from './budget.ts'
import { newUser } from './social-helpers'

mkdirSync('.data/docx-review', { recursive: true })

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function selectFiles(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Files/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await picker.getByRole('button', { name: /Add files from this computer/ }).click()
  await (await choosing).setFiles(files)
  return picker
}

async function startColdUiServer(apiBaseUrl: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const cacheDir = await mkdtemp(`${tmpdir()}/agent-commons-docx-vite-`)
  let server: ViteDevServer | undefined
  try {
    server = await createServer({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      cacheDir,
      server: {
        host: '127.0.0.1',
        // Vite 6 treats port 0 as its 5173 default. Keep this stack on a
        // shard-derived test port, and fail rather than borrow a neighbour.
        port: Number(new URL(apiBaseUrl).port) + 100,
        strictPort: true,
        watch: null,
        proxy: {
          '/api': { target: apiBaseUrl, changeOrigin: true },
        },
      },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Cold Vite server did not expose a TCP address.')
    let closed = false
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      close: async () => {
        if (closed) return
        closed = true
        await server?.close()
        await rm(cacheDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await server?.close().catch(() => {})
    await rm(cacheDir, { recursive: true, force: true })
    throw error
  }
}

async function createSession(page: Page, firstMessage: string) {
  const response = await page.request.post('/api/v1/sessions', { data: { firstMessage } })
  expect(response.ok()).toBe(true)
  return await response.json() as { id: string }
}

async function createEndpointSession(page: Page) {
  const endpoint = await startMessagesFixture()
  const provider = await page.request.post('/api/v1/providers', { data: {
    label: `DOCX fixture ${Date.now().toString(36)}`, modelFamily: 'claude', effortLevels: ['Default'],
    config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
  } })
  expect(provider.ok()).toBe(true)
  const created = await page.request.post('/api/v1/sessions', { data: { providerId: (await provider.json()).id } })
  expect(created.ok()).toBe(true)
  return { endpoint, session: await created.json() as { id: string } }
}

async function useDocxUsagePartition(page: Page) {
  await page.context().setExtraHTTPHeaders({
    // The owner and shared viewer are different people; reusing Grace would
    // also reuse her remembered panel and make the chip click close it.
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-docx-${Date.now().toString(36)}`,
  })
}

async function settledPreview(page: Page) {
  // Resizing can replace the dock after the old preview already satisfied
  // geometry. Wait for the named tier, then for the new paint's full opacity.
  const width = page.viewportSize()!.width
  await expect(page.locator('[data-overlay-dock]')).toHaveCount(width < 1024 ? 1 : 0)
  await expect.poll(() => page.locator('[data-attachment-preview]').evaluate((element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (getComputedStyle(node).opacity !== '1') return false
    }
    return true
  })).toBe(true)
}

test('a real Word document projects body text, reaches the model, survives reload and detaches', async ({ page, browser, baseURL }) => {
  test.setTimeout(ms(90_000))
  await useDocxUsagePartition(page)
  const { endpoint, session } = await createEndpointSession(page)
  const marker = `DOCX_BODY_${Date.now().toString(36)}`
  const expectedText = `${marker}\ttabbed\nline\nparagraph\ncell one\tcell two`
  const bodyXml = `<w:p><w:r><w:t>${marker}</w:t><w:tab/><w:t>tabbed</w:t><w:br/><w:t>line</w:t></w:r></w:p>` +
    '<w:p><w:r><w:t>paragraph</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell one</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:del><w:r><w:delText>must not appear</w:delText></w:r></w:del>'
  let coldUi: Awaited<ReturnType<typeof startColdUiServer>> | undefined
  const mainFrameNavigations: string[] = []
  const onMainFrameNavigation = (request: Request) => {
    if (request.isNavigationRequest() && request.resourceType() === 'document' && request.frame() === page.mainFrame()) {
      mainFrameNavigations.push(request.url())
    }
  }
  try {
    if (!baseURL) throw new Error('The E2E base URL is required for the cold UI proxy.')
    coldUi = await startColdUiServer(baseURL)
    await page.goto(`${coldUi.baseUrl}/s/${session.id}`)
    page.on('request', onMainFrameNavigation)
    const parserRequests: string[] = []
    page.on('request', (request) => { if (/officeParser/i.test(request.url()) && /worker/.test(request.url())) parserRequests.push(request.url()) })
    await selectFiles(page, [{ name: 'research.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture({ bodyXml, entries: {
      'word/header1.xml': '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>header must not appear</w:t></w:r></w:p></w:hdr>',
      'word/comments.xml': '<comments>comment must not appear</comments>',
    } }) }])
    await expect(page.locator('[data-document-import="ready"]')).toBeVisible({ timeout: ms(20_000) })
    expect(mainFrameNavigations, 'DOCX import must not reload the main frame').toEqual([])
    page.off('request', onMainFrameNavigation)
    await page.keyboard.press('Escape')
    const preview = page.locator('[data-attachment-preview]')
    await expect(preview).toContainText(marker)
    await expect(preview).toContainText('cell one')
    await expect(preview).toContainText('cell two')
    await expect(preview).not.toContainText('must not appear')
    expect(parserRequests.length, 'the dedicated Office worker was loaded').toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
    await page.getByLabel('Audience id').fill('tenant-beta')
    await page.getByRole('button', { name: /Share|Publish/ }).last().click()
    const viewer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
    try {
      await viewer.page.goto(`/s/${session.id}`)
      const sharedChip = viewer.page.getByTitle('Open in sidebar').filter({ hasText: 'research.docx' })
      await expect(sharedChip).toBeVisible()
      await sharedChip.click()
      const sharedPreview = viewer.page.locator('[data-attachment-preview]')
      await expect(sharedPreview).toBeVisible()
      await expect(sharedPreview).toContainText(marker)
      await expect(viewer.page.getByTitle('Remove file', { exact: true })).toHaveCount(0)
      await expect(viewer.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
      for (const viewport of VIEWPORTS) {
        await viewer.page.setViewportSize(viewport)
        await settledPreview(viewer.page)
        await expect(sharedPreview).toContainText(marker)
        await expect(viewer.page.getByTitle('Remove file', { exact: true })).toHaveCount(0)
        await assertWcag22Aa(viewer.page, `Shared Word preview at ${viewport.width}x${viewport.height}`)
        await viewer.page.screenshot({ path: `.data/docx-review/shared-${viewport.width}x${viewport.height}.png` })
      }
    } finally {
      await viewer.context.close()
    }
    const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
    try {
      expect((await foreign.page.request.get(`/api/v1/sessions/${session.id}`)).status()).toBe(404)
      await foreign.page.goto(`/s/${session.id}`)
      await expect(foreign.page.getByRole('heading', { name: 'What should we work on?', exact: true })).toBeVisible()
      await expect(foreign.page.locator('[data-attachment-preview]')).toHaveCount(0)
    } finally {
      await foreign.context.close()
    }

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledPreview(page)
      await expect.poll(() => preview.locator('[data-document-import]').evaluate((element) => {
        const box = element.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1
      })).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `.data/docx-review/${viewport.width}x${viewport.height}-ready.png` })
      await assertWcag22Aa(page, `DOCX ready preview at ${viewport.width}x${viewport.height}`)
    }

    const composer = page.getByPlaceholder('Reply to Claude…')
    await composer.fill('Summarize the attached Word document.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: marker })).toBeVisible({ timeout: ms(20_000) })
    expect(endpoint.documents.at(-1)?.attached_files).toEqual([{
      name: 'research.docx', status: 'ready', text: expectedText, extraction: { format: 'docx' },
    }])
    const saved = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    expect(saved.workspace.attachments[0].documentImport).toEqual({ format: 'docx', status: 'ready' })
    expect(JSON.stringify(saved.workspace)).not.toContain('docxBytes')
    expect(JSON.stringify(saved.workspace)).not.toContain('PK\u0003\u0004')
    await page.reload()
    await expect(preview).toContainText(marker)

    await page.getByTitle('Remove file', { exact: true }).click()
    await expect(preview).toHaveCount(0)
    await composer.fill('What attached text remains?')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'No supplied attachment text.' })).toBeVisible({ timeout: ms(20_000) })
    expect(endpoint.seen.at(-1)).not.toContain(marker)
  } finally {
    page.off('request', onMainFrameNavigation)
    try { await coldUi?.close() } finally {
      await new Promise<void>((resolve) => endpoint.server.close(() => resolve()))
    }
  }
})

test('Word intake reports invalid, empty, compound, text-limit and expanded-part outcomes without sending them', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const session = await createSession(page, `DOCX outcomes ${Date.now().toString(36)}`)
  const expanded = 'x'.repeat(4 * 1024 * 1024 + 1)
  await page.goto(`/s/${session.id}`)
  await selectFiles(page, [
    { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('mixed text remains readable') },
    { name: 'context.pdf', mimeType: 'application/pdf', buffer: pdfFixture({ pages: ['mixed PDF remains readable'] }) },
    { name: 'empty.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture() },
    { name: 'invalid.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('not a ZIP package') },
    { name: 'compound.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture({ compoundContainer: true }) },
    { name: 'text-limit.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture({ paragraphs: ['t'.repeat(64 * 1024 + 1)] }) },
    { name: 'expanded-part.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture({ paragraphs: [expanded] }) },
  ])
  // One picker result intentionally mixes ordinary text, PDF and DOCX. The
  // queue must settle each independent import without turning a failed DOCX
  // into a failure for the other two readable inputs.
  await expect(page.locator('[data-attachment-input-disclosure]')).toContainText('5 not sent', { timeout: ms(20_000) })
  await expect(page.getByRole('button', { name: 'notes.md', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'context.pdf', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  const preview = page.locator('[data-attachment-preview]')
  const outcomes = [
    ['empty.docx', 'no-text'],
    ['invalid.docx', 'invalid'],
    ['compound.docx', 'unsupported'],
    ['text-limit.docx', 'text-limit'],
    ['expanded-part.docx', 'structure-limit'],
  ] as const
  for (const [name, status] of outcomes) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(preview.locator('[data-document-import]')).toHaveAttribute('data-document-import', status)
    await expect(preview).toHaveAttribute('data-attachment-input-status', 'unavailable')
  }
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledPreview(page)
    // Responsive panel remounts may select the first file again; reselect the
    // named invalid file at each viewport before asserting its omitted state.
    await page.getByRole('button', { name: 'invalid.docx', exact: true }).click()
    await expect(preview.locator('[data-document-import="invalid"]')).toBeVisible()
    await expect.poll(() => preview.locator('[data-document-import]').evaluate((element) => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1
    })).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const count = page.locator('[data-context-chip-count]')
    await expect(count).toHaveText('· 7')
    await expect(count).toHaveCSS('opacity', '1')
    await page.screenshot({ path: `.data/docx-review/${viewport.width}x${viewport.height}-omitted.png` })
    await assertWcag22Aa(page, `DOCX omitted preview at ${viewport.width}x${viewport.height}`)
  }
})

test('closing a pending DOCX import cancels it and releases the next intake', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const session = await createSession(page, 'DOCX cancellation fixture')
  await page.goto(`/s/${session.id}`)
  let unblock: () => void = () => {}
  const held = new Promise<void>((resolve) => { unblock = resolve })
  let workerRequests = 0
  await page.route(/officeParser/i, async (route) => {
    if (!new URL(route.request().url()).searchParams.has('worker_file')) return route.continue()
    workerRequests += 1
    if (workerRequests === 1) { await held; await route.abort() }
    else await route.continue()
  })
  try {
    const picker = await selectFiles(page, [{ name: 'cancelled.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture({ paragraphs: ['cancelled'] }) }])
    await expect(picker.getByRole('status')).toContainText('Importing selected files')
    await expect.poll(() => workerRequests).toBe(1)
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(picker).toHaveCount(0)
    unblock()
    await selectFiles(page, [{ name: 'next.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture({ paragraphs: ['next intake still works'] }) }])
    await expect(page.locator('[data-attachment-preview]')).toContainText('next intake still works', { timeout: ms(20_000) })
    await page.keyboard.press('Escape')
    const saved = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    expect(saved.workspace.attachments.map((attachment: { label: string }) => attachment.label)).toEqual(['next.docx'])
  } finally { unblock() }
})

test('a stalled DOCX worker reaches the exact deadline and leaves no live worker', async ({ page }) => {
  test.setTimeout(ms(45_000))
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker
    const active = new Set<Worker>()
    let created = 0
    Object.assign(window, { docxWorkerStats: () => ({ active: active.size, created }) })
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); active.add(this); created += 1 }
      terminate() { active.delete(this); super.terminate() }
    }
  })
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(/officeParser/i, async (route) => {
    if (!new URL(route.request().url()).searchParams.has('worker_file')) return route.continue()
    await held
    await route.abort()
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add context', exact: true })).toBeVisible()
  const session = await createSession(page, 'DOCX timeout fixture')
  await page.goto(`/s/${session.id}`)
  try {
    const started = Date.now()
    await selectFiles(page, [{ name: 'stalled.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxFixture({ paragraphs: ['stalled'] }) }])
    await expect(page.locator('[data-document-import="timeout"]')).toBeVisible({ timeout: ms(25_000) })
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(14_000)
    expect(elapsed).toBeLessThan(25_000)
    expect(await page.evaluate(() => (window as unknown as { docxWorkerStats(): { active: number; created: number } }).docxWorkerStats())).toEqual({ active: 0, created: 1 })
  } finally { release() }
})
