import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { xlsxFixture } from '../tests/helpers/xlsxFixture.mjs'
import { assertWcag22Aa, settledAttachmentPreview as settledPreview } from './accessibility-helpers'
import { startMessagesFixture } from './attachment-endpoint'
import { ms } from './budget.ts'
import { newUser } from './social-helpers'

mkdirSync('.data/xlsx-review', { recursive: true })

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

async function createEndpointSession(page: Page) {
  const endpoint = await startMessagesFixture()
  const provider = await page.request.post('/api/v1/providers', { data: {
    label: `XLSX fixture ${Date.now().toString(36)}`, modelFamily: 'claude', effortLevels: ['Default'],
    config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
  } })
  expect(provider.ok()).toBe(true)
  const created = await page.request.post('/api/v1/sessions', { data: { providerId: (await provider.json()).id } })
  expect(created.ok()).toBe(true)
  return { endpoint, session: await created.json() as { id: string } }
}

async function useXlsxUsagePartition(page: Page) {
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-xlsx-${Date.now().toString(36)}`,
  })
}


test('a real workbook projects visible worksheet values, persists its preview, reaches the model, reloads and detaches', async ({ page, browser }) => {
  test.setTimeout(ms(90_000))
  await useXlsxUsagePartition(page)
  const { endpoint, session } = await createEndpointSession(page)
  const marker = `XLSX_VISIBLE_${Date.now().toString(36)}`
  const workbook = xlsxFixture({ sheets: [
    {
      name: 'Visible Data',
      rows: [[marker, 42, 'kept'], ['hidden row', 'hidden row value']],
      hiddenRows: [2],
      hiddenColumns: ['C'],
    },
    { name: 'Hidden Sheet', state: 'hidden', rows: [['HIDDEN_SHEET_MARKER']] },
  ] })
  try {
    await page.goto(`/s/${session.id}`)
    const parserRequests: string[] = []
    page.on('request', (request) => {
      if (/officeParser/i.test(request.url()) && /worker/.test(request.url())) parserRequests.push(request.url())
    })
    const picker = await selectFiles(page, [{
      name: 'research.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: workbook,
    }])
    await expect(page.locator('[data-attachment-input-ready]')).toHaveAttribute('data-attachment-input-ready', '1', { timeout: ms(20_000) })
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    const preview = page.locator('[data-attachment-preview]')
    await expect(preview.locator('[data-document-import="ready"]')).toBeVisible({ timeout: ms(20_000) })
    await expect(preview).toContainText(marker)
    await expect(preview).not.toContainText('hidden row')
    await expect(preview).not.toContainText('HIDDEN_SHEET_MARKER')
    expect(parserRequests.length, 'the dedicated Office worker was loaded').toBeGreaterThan(0)

    const savedBeforeSend = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    const savedAttachment = savedBeforeSend.workspace.attachments.find((attachment: { label: string }) => attachment.label === 'research.xlsx')
    expect(savedAttachment.documentImport).toEqual({ format: 'xlsx', status: 'ready' })
    expect(typeof savedAttachment.previewText).toBe('string')
    expect(savedAttachment.previewText).toContain(marker)
    expect(savedAttachment.previewText).not.toContain('hidden row')
    expect(savedAttachment.previewText).not.toContain('HIDDEN_SHEET_MARKER')

    await page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
    await page.getByLabel('Audience id').fill('tenant-beta')
    await page.getByRole('button', { name: /Share|Publish/ }).last().click()
    const viewer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
    try {
      await viewer.page.goto(`/s/${session.id}`)
      const sharedChip = viewer.page.getByTitle('Open in sidebar').filter({ hasText: 'research.xlsx' })
      await expect(sharedChip).toBeVisible()
      await sharedChip.click()
      const sharedPreview = viewer.page.locator('[data-attachment-preview]')
      await expect(sharedPreview).toBeVisible()
      await expect(sharedPreview).toContainText(marker)
      await expect(sharedPreview).not.toContainText('HIDDEN_SHEET_MARKER')
      await expect(viewer.page.getByTitle('Remove file', { exact: true })).toHaveCount(0)
      await expect(viewer.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
      await expect(viewer.page.getByText('This model connection is unavailable to this account.', { exact: true })).toBeVisible()
      await expect(viewer.page.getByPlaceholder('Checking model connection…', { exact: true })).toHaveCount(0)
      for (const viewport of VIEWPORTS) {
        await viewer.page.setViewportSize(viewport)
        await settledPreview(viewer.page)
        await expect(sharedPreview).toContainText(marker)
        await expect(viewer.page.getByTitle('Remove file', { exact: true })).toHaveCount(0)
        await assertWcag22Aa(viewer.page, `Shared XLSX preview at ${viewport.width}x${viewport.height}`)
        await viewer.page.screenshot({ path: `.data/xlsx-review/shared-${viewport.width}x${viewport.height}.png` })
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
      await expect(preview.locator('[data-document-import="ready"]')).toBeVisible()
      await expect.poll(() => preview.locator('[data-document-import]').evaluate((element) => {
        const box = element.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1
      })).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await assertWcag22Aa(page, `XLSX ready preview at ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: `.data/xlsx-review/${viewport.width}x${viewport.height}-ready.png` })
    }

    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('Summarize the visible workbook cells.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: marker })).toBeVisible({ timeout: ms(20_000) })
    const sent = endpoint.documents.at(-1)?.attached_files?.find((file) => file.name === 'research.xlsx') as { text?: string; extraction?: unknown } | undefined
    expect(sent?.text).toBe(savedAttachment.previewText)
    expect(sent?.extraction).toEqual({ format: 'xlsx' })

    await page.reload()
    await expect(page.locator('[data-attachment-preview]')).toContainText(marker)
    await expect(page.locator('[data-attachment-preview]')).not.toContainText('HIDDEN_SHEET_MARKER')
    await page.getByTitle('Remove file', { exact: true }).click()
    await expect(page.locator('[data-attachment-preview]')).toHaveCount(0)
    await composer.fill('What workbook text remains?')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'No supplied attachment text.' })).toBeVisible({ timeout: ms(20_000) })
    expect(endpoint.seen.at(-1)).not.toContain(marker)
  } finally {
    await endpoint.server.close()
  }
})

test('workbook intake reports malformed and no-text outcomes without sending them', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await useXlsxUsagePartition(page)
  const endpoint = await startMessagesFixture()
  try {
    const provider = await page.request.post('/api/v1/providers', { data: {
      label: `XLSX outcome fixture ${Date.now().toString(36)}`, modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
    } })
    expect(provider.ok()).toBe(true)
    const sessionResponse = await page.request.post('/api/v1/sessions', { data: { providerId: (await provider.json()).id } })
    expect(sessionResponse.ok()).toBe(true)
    const session = await sessionResponse.json() as { id: string }
    await page.goto(`/s/${session.id}`)
    const picker = await selectFiles(page, [
      { name: 'empty.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsxFixture() },
      { name: 'invalid.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('not a ZIP package') },
    ])
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText('2 not sent', { timeout: ms(20_000) })
    await expect(picker).toContainText('2 added')
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    const preview = page.locator('[data-attachment-preview]')
    for (const [name, status] of [['empty.xlsx', 'no-text'], ['invalid.xlsx', 'invalid']] as const) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(preview.locator('[data-document-import]')).toHaveAttribute('data-document-import', status)
      await expect(preview).toHaveAttribute('data-attachment-input-status', 'unavailable')
    }
    expect(endpoint.documents).toHaveLength(0)
  } finally {
    await endpoint.server.close()
  }
})
