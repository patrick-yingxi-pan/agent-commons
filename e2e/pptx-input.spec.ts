import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { pptxFixture } from '../tests/helpers/pptxFixture.mjs'
import { assertWcag22Aa, settledAttachmentPreview as settledPreview } from './accessibility-helpers'
import { startMessagesFixture } from './attachment-endpoint'
import { ms } from './budget.ts'
import { newUser } from './social-helpers'

mkdirSync('.data/pptx-review', { recursive: true })

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
    label: `PPTX fixture ${Date.now().toString(36)}`, modelFamily: 'claude', effortLevels: ['Default'],
    config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
  } })
  expect(provider.ok()).toBe(true)
  const created = await page.request.post('/api/v1/sessions', { data: { providerId: (await provider.json()).id } })
  expect(created.ok()).toBe(true)
  return { endpoint, session: await created.json() as { id: string } }
}

async function usePptxUsagePartition(page: Page) {
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-pptx-${Date.now().toString(36)}`,
  })
}


test('a real presentation projects visible slide text, persists its preview, reaches the model, reloads and detaches', async ({ page, browser }) => {
  test.setTimeout(ms(90_000))
  await usePptxUsagePartition(page)
  const { endpoint, session } = await createEndpointSession(page)
  const marker = `PPTX_VISIBLE_${Date.now().toString(36)}`
  const deck = pptxFixture({ slides: [
    {
      name: 'Visible slide',
      shapes: [`${marker} title`, 'visible textbox body'],
      table: [['cell one', 'cell two'], ['cell three', 'cell four']],
      hiddenShapes: ['HIDDEN_SHAPE_MARKER'],
      notes: ['NOTES_MARKER'],
    },
    { name: 'Hidden slide', hidden: true, shapes: ['HIDDEN_SLIDE_MARKER'] },
    { name: 'Later visible slide', shapes: ['LATER_VISIBLE_MARKER'] },
  ], slideOrder: [2, 1, 0] })
  try {
    await page.goto(`/s/${session.id}`)
    const parserRequests: string[] = []
    page.on('request', (request) => {
      if (/officeParser/i.test(request.url()) && /worker/.test(request.url())) parserRequests.push(request.url())
    })
    const picker = await selectFiles(page, [{
      name: 'research.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      buffer: deck,
    }])
    await expect(page.locator('[data-attachment-input-ready]')).toHaveAttribute('data-attachment-input-ready', '1', { timeout: ms(20_000) })
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    const preview = page.locator('[data-attachment-preview]')
    await expect(preview.locator('[data-document-import="ready"]')).toBeVisible({ timeout: ms(20_000) })
    await expect(preview).toContainText(marker)
    await expect(preview).toContainText('cell one')
    await expect(preview).not.toContainText('HIDDEN_SHAPE_MARKER')
    await expect(preview).not.toContainText('HIDDEN_SLIDE_MARKER')
    await expect(preview).not.toContainText('NOTES_MARKER')
    await expect(preview).toContainText('LATER_VISIBLE_MARKER')
    const projected = await preview.textContent()
    expect(projected).not.toBeNull()
    expect(projected!.indexOf(marker)).toBeLessThan(projected!.indexOf('visible textbox body'))
    expect(projected!.indexOf('visible textbox body')).toBeLessThan(projected!.indexOf('cell one'))
    expect(projected!.indexOf('cell one')).toBeLessThan(projected!.indexOf('cell four'))
    expect(projected!.indexOf('LATER_VISIBLE_MARKER')).toBeLessThan(projected!.indexOf(marker))
    expect(parserRequests.length, 'the dedicated Office worker was loaded').toBeGreaterThan(0)

    const savedBeforeSend = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    const savedAttachment = savedBeforeSend.workspace.attachments.find((attachment: { label: string }) => attachment.label === 'research.pptx')
    expect(savedAttachment.documentImport).toEqual({ format: 'pptx', status: 'ready' })
    expect(typeof savedAttachment.previewText).toBe('string')
    expect(savedAttachment.previewText).toContain(marker)
    expect(savedAttachment.previewText).not.toContain('HIDDEN_SHAPE_MARKER')
    expect(savedAttachment.previewText).not.toContain('HIDDEN_SLIDE_MARKER')
    expect(savedAttachment.previewText).not.toContain('NOTES_MARKER')

    await page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
    await page.getByLabel('Audience id').fill('tenant-beta')
    await page.getByRole('button', { name: /Share|Publish/ }).last().click()
    const viewer = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
    try {
      await viewer.page.goto(`/s/${session.id}`)
      const sharedChip = viewer.page.getByTitle('Open in sidebar').filter({ hasText: 'research.pptx' })
      await expect(sharedChip).toBeVisible()
      await sharedChip.click()
      const sharedPreview = viewer.page.locator('[data-attachment-preview]')
      await expect(sharedPreview).toBeVisible()
      await expect(sharedPreview).toContainText(marker)
      await expect(sharedPreview).not.toContainText('HIDDEN_SLIDE_MARKER')
      await expect(viewer.page.getByTitle('Remove file', { exact: true })).toHaveCount(0)
      await expect(viewer.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
      await expect(viewer.page.getByText('This model connection is unavailable to this account.', { exact: true })).toBeVisible()
      await expect(viewer.page.getByPlaceholder('Checking model connection…', { exact: true })).toHaveCount(0)
      for (const viewport of VIEWPORTS) {
        await viewer.page.setViewportSize(viewport)
        await settledPreview(viewer.page)
        await expect(sharedPreview).toContainText(marker)
        await expect(viewer.page.getByTitle('Remove file', { exact: true })).toHaveCount(0)
        await assertWcag22Aa(viewer.page, `Shared PPTX preview at ${viewport.width}x${viewport.height}`)
        await viewer.page.screenshot({ path: `.data/pptx-review/shared-${viewport.width}x${viewport.height}.png` })
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
      await assertWcag22Aa(page, `PPTX ready preview at ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: `.data/pptx-review/${viewport.width}x${viewport.height}-ready.png` })
    }

    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('Summarize the visible presentation text.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: marker })).toBeVisible({ timeout: ms(20_000) })
    const sent = endpoint.documents.at(-1)?.attached_files?.find((file) => file.name === 'research.pptx') as { text?: string; extraction?: unknown } | undefined
    expect(sent?.text).toBe(savedAttachment.previewText)
    expect(sent?.extraction).toEqual({ format: 'pptx' })

    await page.reload()
    await expect(page.locator('[data-attachment-preview]')).toContainText(marker)
    await expect(page.locator('[data-attachment-preview]')).not.toContainText('HIDDEN_SLIDE_MARKER')
    await page.getByTitle('Remove file', { exact: true }).click()
    await expect(page.locator('[data-attachment-preview]')).toHaveCount(0)
    await composer.fill('What presentation text remains?')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'No supplied attachment text.' })).toBeVisible({ timeout: ms(20_000) })
    expect(endpoint.seen.at(-1)).not.toContain(marker)
  } finally {
    await endpoint.server.close()
  }
})

test('presentation intake reports malformed and no-text outcomes without sending them', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await usePptxUsagePartition(page)
  const endpoint = await startMessagesFixture()
  try {
    const provider = await page.request.post('/api/v1/providers', { data: {
      label: `PPTX outcome fixture ${Date.now().toString(36)}`, modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
    } })
    expect(provider.ok()).toBe(true)
    const sessionResponse = await page.request.post('/api/v1/sessions', { data: { providerId: (await provider.json()).id } })
    expect(sessionResponse.ok()).toBe(true)
    const session = await sessionResponse.json() as { id: string }
    await page.goto(`/s/${session.id}`)
    const picker = await selectFiles(page, [
      { name: 'empty.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: pptxFixture() },
      { name: 'invalid.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('not a ZIP package') },
    ])
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText('2 not sent', { timeout: ms(20_000) })
    await expect(picker).toContainText('2 added')
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    const preview = page.locator('[data-attachment-preview]')
    for (const [name, status] of [['empty.pptx', 'no-text'], ['invalid.pptx', 'invalid']] as const) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(preview.locator('[data-document-import]')).toHaveAttribute('data-document-import', status)
      await expect(preview).toHaveAttribute('data-attachment-input-status', 'unavailable')
    }
    expect(endpoint.documents).toHaveLength(0)
  } finally {
    await endpoint.server.close()
  }
})
