import { test, expect, type Page } from '@playwright/test'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { startMessagesFixture } from './attachment-endpoint'
import { ms } from './budget.ts'
import { newUser } from './social-helpers'
import { assertWcag22Aa } from './accessibility-helpers'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function selectImage(page: Page, name: string, buffer: Buffer) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Photos/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await picker.getByRole('button', { name: /Add photos from this computer/ }).click()
  await (await choosing).setFiles([{ name, mimeType: 'image/png', buffer }])
  return picker
}

test('an attached image is previewable by a read-only audience and hidden from a foreign tenant', async ({ page, browser }) => {
  test.setTimeout(ms(90_000))
  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'Shared image subject' } })
  expect(created.ok()).toBe(true)
  const session = await created.json()
  await page.goto(`/s/${session.id}`)
  await selectImage(page, 'shared.png', imageFixture())
  await expect(page.locator('[data-attachment-image-ready]')).toHaveAttribute('data-attachment-image-ready', '1')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Share this conversation' }).click()
  await page.getByLabel('Audience id').fill('tenant-beta')
  await page.getByRole('button', { name: /Share|Publish/ }).last().click()

  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const maya = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    await grace.page.goto(`/s/${session.id}`)
    await grace.page.getByTitle('Open in sidebar').filter({ hasText: 'shared.png' }).click()
    await expect(grace.page.locator('[data-attachment-preview]')).toBeVisible({ timeout: ms(20_000) })
    await expect.poll(() => grace.page.locator('[data-attachment-preview] img').last().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    for (const viewport of VIEWPORTS) {
      await grace.page.setViewportSize(viewport)
      await expect.poll(() => grace.page.locator('[data-attachment-preview]').evaluate((node) => {
        const box = node.getBoundingClientRect()
        return box.width > 100 && box.left >= -1 && box.right <= innerWidth + 1
      })).toBe(true)
      await expect(grace.page.getByRole('button', { name: 'Remove photo', exact: true })).toHaveCount(0)
      await expect(grace.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
      await expect(grace.page.getByTitle('Remove from context', { exact: true })).toHaveCount(0)
      await grace.page.evaluate(async () => {
        await Promise.allSettled(document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map((animation) => animation.finished))
      })
      await grace.page.screenshot({ path: `.data/image-review/shared-${viewport.width}x${viewport.height}.png` })
    }

    const denied = maya.page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/sessions/${session.id}` && response.request().method() === 'GET')
    await maya.page.goto(`/s/${session.id}`)
    expect((await denied).status()).toBe(404)
    // A denied conversation currently returns to the viewer's empty draft.
    await expect(maya.page.getByRole('heading', { name: 'What should we work on?', exact: true })).toBeVisible()
    const detail = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    expect((await maya.page.request.get(`/api/v1/image-assets/${detail.workspace.attachments[0].image.id}/content`)).status()).toBe(404)
    await expect(maya.page.locator('[data-attachment-preview]')).toHaveCount(0)
  } finally {
    await grace.context.close(); await maya.context.close()
  }
})

test('a real image becomes durable reference context and real model image blocks, then detaches', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.setViewportSize({ width: 1280, height: 800 })
  const endpoint = await startMessagesFixture()
  try {
    const provider = await page.request.post('/api/v1/providers', { data: {
      label: `Image fixture ${Date.now()}`, modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
    } })
    expect(provider.ok()).toBe(true)
    const created = await page.request.post('/api/v1/sessions', { data: { providerId: (await provider.json()).id } })
    expect(created.ok()).toBe(true)
    const session = await created.json()
    await page.goto(`/s/${session.id}`)
    await selectImage(page, 'two-colors.png', imageFixture())
    await expect(page.locator('[data-attachment-image-ready]')).toHaveAttribute('data-attachment-image-ready', '1')
    await page.keyboard.press('Escape')
    const preview = page.locator('[data-attachment-preview]')
    await expect(preview).toHaveAttribute('data-attachment-input-status', 'image-ready')
    await expect(preview.locator('img').last()).toHaveCSS('object-fit', 'contain')
    await expect.poll(() => preview.locator('img').last().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 160 && image.naturalHeight === 80)).toBe(true)
    const saved = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    const attachment = saved.workspace.attachments[0]
    expect(attachment.image).toMatchObject({ mimeType: 'image/png', width: 160, height: 80 })
    expect(JSON.stringify(saved.workspace)).not.toMatch(/blob:|data:image|imageInput|"data":/)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(preview).toContainText('two-colors.png')
      await expect.poll(() => preview.evaluate((node) => {
        const box = node.getBoundingClientRect()
        return box.width > 100 && box.left >= -1 && box.right <= innerWidth + 1
      })).toBe(true)
      await page.evaluate(async () => {
        await Promise.allSettled(document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map((animation) => animation.finished))
      })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `.data/image-review/${viewport.width}x${viewport.height}-ready.png` })
    }
    await page.reload()
    await expect(preview).toHaveAttribute('data-attachment-preview', attachment.id)
    await expect.poll(() => preview.locator('img').last().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await assertWcag22Aa(page, 'saved image preview')
    const composer = page.getByPlaceholder('Reply to Claude…')
    await composer.fill('Describe the two colors in this picture.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'Received 1 supplied image(s).' })).toBeVisible({ timeout: ms(20_000) })
    const sent = endpoint.images.at(-1)!
    expect(sent).toHaveLength(1)
    const content = await page.request.get(`/api/v1/image-assets/${attachment.image.id}/content`)
    expect(Buffer.from(sent[0]!.source.data, 'base64')).toEqual(await content.body())
    expect(endpoint.seen.at(-1)).toContain('"image_index":1')
    expect(endpoint.seen.at(-1)).not.toContain(sent[0]!.source.data)
    await page.getByRole('button', { name: 'Remove photo', exact: true }).click()
    await expect(preview).toHaveCount(0)
    await composer.fill('Which image is attached now?')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'No supplied attachment text.' })).toBeVisible({ timeout: ms(20_000) })
    expect(endpoint.images.at(-1)).toEqual([])
  } finally { await new Promise<void>((resolve) => endpoint.server.close(() => resolve())) }
})

test('invalid images fail visibly without attaching placeholder context at every canonical viewport', async ({ page }) => {
  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'Image rejection' } })
  const id = (await created.json()).id
  await page.goto(`/s/${id}`)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const picker = await selectImage(page, `broken-${viewport.width}.png`, Buffer.from('not an image'))
    await expect(picker.getByRole('alert')).toContainText('valid PNG')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await assertWcag22Aa(page, `invalid image picker ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: `.data/image-review/${viewport.width}x${viewport.height}-invalid.png` })
    await page.keyboard.press('Escape')
  }
  expect((await (await page.request.get(`/api/v1/sessions/${id}`)).json()).workspace.attachments).toEqual([])
  await expect(page.locator('[data-attachment-image-ready]')).toHaveCount(0)
})
