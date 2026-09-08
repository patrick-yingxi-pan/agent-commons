import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { pdfFixture } from '../tests/helpers/pdfFixture.mjs'
import { startMessagesFixture } from './attachment-endpoint'
import { ms } from './budget.ts'

const VIEWPORTS = [{ width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]

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

test('a real PDF is extracted locally, delivered as text, restored and detached', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-pdf-${randomUUID()}`,
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  const endpoint = await startMessagesFixture()
  const marker = `PDF_BODY_${Date.now().toString(36)}`
  try {
    const provider = await page.request.post('/api/v1/providers', { data: {
      label: `PDF fixture ${marker}`, modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
    } })
    expect(provider.ok()).toBe(true)
    const created = await page.request.post('/api/v1/sessions', { data: { providerId: (await provider.json()).id } })
    expect(created.ok()).toBe(true)
    const session = await created.json()
    await page.goto(`/s/${session.id}`)
    const parserRequests: string[] = []
    page.on('request', (request) => {
      if (/pdf\.worker/.test(request.url())) parserRequests.push(request.url())
    })
    const conclusion = 'Final page conclusion · café 世界 😀'
    await selectFiles(page, [{ name: 'research.pdf', mimeType: 'application/pdf', buffer: pdfFixture({ pages: [marker, null, conclusion], compress: true, unicode: true }) }])
    await expect(page.locator('[data-document-import="ready"]')).toBeVisible({ timeout: ms(20_000) })
    await page.keyboard.press('Escape')
    const preview = page.locator('[data-attachment-preview]')
    await expect(preview).toContainText('2 of 3 pages')
    await expect(preview).toContainText('No OCR')
    await expect(preview).toContainText(`[Page 1]\n${marker}`)
    await expect(preview).toContainText(`[Page 3]\n${conclusion}`)
    expect(parserRequests.length, 'the real dedicated PDF worker was loaded').toBeGreaterThan(0)
    const attachmentId = await preview.getAttribute('data-attachment-preview')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect.poll(() => preview.locator('[data-document-import]').evaluate((element) => {
        const box = element.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1
      })).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `.data/pdf-review/${viewport.width}x${viewport.height}-ready.png` })
    }
    await page.getByPlaceholder('Reply to Claude…').fill('Summarize the attached document.')
    await page.getByPlaceholder('Reply to Claude…').press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: marker })).toBeVisible({ timeout: ms(20_000) })
    expect(endpoint.documents.at(-1)?.attached_files).toEqual([{
      name: 'research.pdf', status: 'ready', text: `[Page 1]\n${marker}\n\n[Page 3]\n${conclusion}`,
      extraction: { format: 'pdf', pages: 3, text_pages: 2 },
    }])
    const saved = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    expect(saved.workspace.attachments[0].documentImport).toEqual({ format: 'pdf', status: 'ready', pages: 3, textPages: 2 })
    expect(JSON.stringify(saved.workspace)).not.toContain('pdfBytes')
    expect(JSON.stringify(saved.workspace)).not.toContain('%PDF-')
    await page.reload()
    await expect(preview).toHaveAttribute('data-attachment-preview', attachmentId!)
    await expect(preview).toContainText(marker)
    await page.getByTitle('Remove file', { exact: true }).click()
    await expect(preview).toHaveCount(0)
    await page.getByPlaceholder('Reply to Claude…').fill('What attached text remains?')
    await page.getByPlaceholder('Reply to Claude…').press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'No supplied attachment text.' })).toBeVisible({ timeout: ms(20_000) })
    expect(endpoint.seen.at(-1)).not.toContain(marker)
  } finally {
    await new Promise<void>((resolve) => endpoint.server.close(() => resolve()))
  }
})

test('unreadable PDFs have explicit outcomes and readable responsive previews', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'PDF outcomes fixture' } })
  expect(created.ok()).toBe(true)
  await page.goto(`/s/${(await created.json()).id}`)
  await selectFiles(page, [
    { name: 'empty.pdf', mimeType: 'application/pdf', buffer: pdfFixture({ pages: [null] }) },
    { name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-broken') },
    { name: 'long.pdf', mimeType: 'application/pdf', buffer: pdfFixture({ pages: Array(101).fill('page') }) },
    { name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) },
    { name: 'protected.pdf', mimeType: 'application/pdf', buffer: pdfFixture({ password: 'test-only-password' }) },
    { name: 'text-limit.pdf', mimeType: 'application/pdf', buffer: pdfFixture({ pages: Array(34).fill(Array(40).fill('x'.repeat(50)).join('\n')), compress: true }) },
  ])
  await expect(page.locator('[data-attachment-input-disclosure]')).toContainText('6 not sent', { timeout: ms(20_000) })
  await page.keyboard.press('Escape')
  const preview = page.locator('[data-attachment-preview]')
  for (const [name, status] of [['empty.pdf', 'no-text'], ['invalid.pdf', 'invalid'], ['long.pdf', 'page-limit'], ['large.pdf', 'file-too-large'], ['protected.pdf', 'protected'], ['text-limit.pdf', 'text-limit']]) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(preview.locator('[data-document-import]')).toHaveAttribute('data-document-import', status)
    await expect(preview).toHaveAttribute('data-attachment-input-status', 'unavailable')
  }
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: 'empty.pdf', exact: true }).click()
    await expect(preview).toContainText('OCR is not available')
    await expect.poll(() => preview.locator('[data-document-import]').evaluate((element) => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1
    })).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.data/pdf-review/${viewport.width}x${viewport.height}-omitted.png` })
  }
})

test('closing a pending PDF import cancels attachment and releases the next intake', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'PDF cancellation fixture' } })
  expect(created.ok()).toBe(true)
  const session = await created.json()
  await page.goto(`/s/${session.id}`)
  let unblock: () => void = () => {}
  const held = new Promise<void>((resolve) => { unblock = resolve })
  let workerRequests = 0
  await page.route(/pdf\.worker/, async (route) => {
    // Vite's ?worker wrapper is an ordinary module import, not the worker.
    if (!new URL(route.request().url()).searchParams.has('worker_file')) return route.continue()
    workerRequests += 1
    if (workerRequests === 1) { await held; await route.abort() }
    else await route.continue()
  })
  try {
    const picker = await selectFiles(page, [{ name: 'cancelled.pdf', mimeType: 'application/pdf', buffer: pdfFixture() }])
    await expect(picker.getByRole('status')).toContainText('Importing selected files')
    await expect.poll(() => workerRequests).toBe(1)
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(picker).toHaveCount(0)
    unblock()
    const next = await selectFiles(page, [{ name: 'next.pdf', mimeType: 'application/pdf', buffer: pdfFixture({ pages: ['next intake still works'] }) }])
    await expect(page.locator('[data-attachment-preview]')).toContainText('next intake still works')
    await page.keyboard.press('Escape')
    await expect(next).toHaveCount(0)
    const saved = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    expect(saved.workspace.attachments.map((attachment: { label: string }) => attachment.label)).toEqual(['next.pdf'])
  } finally { unblock() }
})

test('a stalled real PDF worker is terminated at its deadline without partial text', async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker
    const active = new Set<Worker>()
    let created = 0
    Object.assign(window, { pdfWorkerStats: () => ({ active: active.size, created }) })
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); active.add(this); created += 1 }
      terminate() { active.delete(this); super.terminate() }
    }
  })
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(/pdf\.worker/, async (route) => {
    if (!new URL(route.request().url()).searchParams.has('worker_file')) return route.continue()
    await held
    await route.abort()
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add context', exact: true })).toBeVisible()
  try {
    const result = await page.evaluate(async (bytes) => {
      const modulePath = '/src/lib/pdfExtractor.ts'
      const { extractPdf } = await import(modulePath)
      return extractPdf(new Uint8Array(bytes), 50)
    }, [...pdfFixture()])
    expect(result).toEqual({ documentImport: { format: 'pdf', status: 'timeout' } })
    expect(await page.evaluate(() => (window as unknown as { pdfWorkerStats(): { active: number; created: number } }).pdfWorkerStats())).toEqual({ active: 0, created: 1 })
  } finally { release() }
})
