import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { imageFixture } from '../tests/helpers/imageFixture.mjs'
import { bitmapFixture, iconFixture, multiIconFixture } from '../tests/helpers/bitmapFixture.mjs'
import { svgFixture } from '../tests/helpers/svgFixture.mjs'
import { startMessagesFixture } from './attachment-endpoint'
import { ms } from './budget.ts'
import { newUser } from './social-helpers'
import { assertWcag22Aa } from './accessibility-helpers'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function selectImage(page: Page, name: string, buffer: Buffer, mimeType = 'image/png') {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Photos/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await picker.getByRole('button', { name: /Add photos from this computer/ }).click()
  await (await choosing).setFiles([{ name, mimeType, buffer }])
  return picker
}

test('an attached image is previewable by a read-only audience and hidden from a foreign tenant', async ({ page, browser }) => {
  test.setTimeout(ms(90_000))
  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'Shared image subject' } })
  expect(created.ok()).toBe(true)
  const session = await created.json()
  await page.goto(`/s/${session.id}`)
  const picker = await selectImage(page, 'shared.png', imageFixture())
  await expect(page.locator('[data-attachment-image-ready]')).toHaveAttribute('data-attachment-image-ready', '1', { timeout: ms(20_000) })
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.locator('[data-attachment-image-ready]')).toHaveAttribute('data-attachment-image-ready', '1')
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

test('real PNG, BMP, ICO and SVG images become durable references and model blocks, then detach', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-image-${randomUUID()}`,
  })
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
    const cases = [
      { slug: 'png', name: 'two-colors.png', mimeType: 'image/png', buffer: imageFixture(), width: 160, height: 80 },
      { slug: 'bmp', name: 'two-colors.bmp', mimeType: 'image/bmp', buffer: bitmapFixture(160, 80), width: 160, height: 80 },
      { slug: 'ico', name: 'multi-frame.ico', mimeType: 'image/x-icon', buffer: multiIconFixture([{ width: 16, height: 16 }, { width: 160, height: 80 }]), width: 160, height: 80 },
      { slug: 'svg', name: 'local-diagram.svg', mimeType: 'image/svg+xml', buffer: svgFixture(160, 80, { viewBoxOnly: true }), width: 160, height: 80 },
    ] as const
    for (const image of cases) {
      const picker = await selectImage(page, image.name, image.buffer, image.mimeType)
      await expect(page.locator('[data-attachment-image-ready]')).toHaveAttribute('data-attachment-image-ready', '1', { timeout: ms(20_000) })
      await picker.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(page.locator('[data-attachment-image-ready]')).toHaveAttribute('data-attachment-image-ready', '1')
      const preview = page.locator('[data-attachment-preview]')
      await expect(preview).toHaveAttribute('data-attachment-input-status', 'image-ready')
      await expect(preview.locator('img').last()).toHaveCSS('object-fit', 'contain')
      await expect.poll(() => preview.locator('img').last().evaluate((element: HTMLImageElement, dimensions) => element.complete && element.naturalWidth === dimensions.width && element.naturalHeight === dimensions.height, { width: image.width, height: image.height })).toBe(true)
      const saved = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
      const attachment = saved.workspace.attachments[0]
      expect(attachment.image).toMatchObject({ mimeType: 'image/png', width: image.width, height: image.height })
      expect(JSON.stringify(saved.workspace)).not.toMatch(/blob:|data:image|imageInput|"data":/)
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await expect(preview).toContainText(image.name)
        await expect.poll(() => preview.evaluate((node) => {
          const box = node.getBoundingClientRect()
          return box.width > 100 && box.left >= -1 && box.right <= innerWidth + 1
        })).toBe(true)
        await page.evaluate(async () => {
          await Promise.allSettled(document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map((animation) => animation.finished))
        })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: `.data/image-review/${image.slug}-${viewport.width}x${viewport.height}-ready.png` })
      }
      await page.reload()
      await expect(preview).toHaveAttribute('data-attachment-preview', attachment.id)
      await expect.poll(() => preview.locator('img').last().evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
      await assertWcag22Aa(page, `saved ${image.name} preview`)
      const composer = page.getByRole('textbox', { name: 'Message', exact: true })
      await composer.fill(`Describe the colors in ${image.name}.`)
      await composer.press('Enter')
      await expect(page.locator('[data-turn]').last().filter({ hasText: 'Received 1 supplied image(s).' })).toBeVisible({ timeout: ms(20_000) })
      await expect.poll(() => endpoint.images.at(-1)?.length ?? 0).toBe(1)
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
      await expect(page.locator('[data-turn]').last().filter({ hasText: 'No supplied attachment text.' })).toBeVisible({ timeout: ms(20_000) })
      await expect.poll(() => endpoint.images.at(-1)?.length ?? -1).toBe(0)
    }
  } finally { await new Promise<void>((resolve) => endpoint.server.close(() => resolve())) }
})

test('browser codecs normalize the BMP header/depth/orientation matrix and PNG/DIB ICO frames plus SVG to colored PNG pixels', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'Codec matrix' } })
  expect(created.ok()).toBe(true)
  const session = await created.json()
  await page.goto(`/s/${session.id}`)

  const cases = [
    ...[1, 4, 8, 24].map((bitDepth) => ({
      label: `core-${bitDepth}`,
      bytes: bitmapFixture(16, 8, { bitDepth, headerSize: 12 }), width: 16, height: 8,
    })),
    ...[1, 4, 8, 16, 24, 32].flatMap((bitDepth) => [40, 52, 56, 108, 124].flatMap((headerSize) => [false, true].map((topDown) => ({
      label: `rgb-${bitDepth}-${headerSize}-${topDown ? 'top' : 'bottom'}`,
      bytes: bitmapFixture(16, 8, { bitDepth, headerSize, topDown }), width: 16, height: 8,
    })))),
    ...[16, 32].flatMap((bitDepth) => [40, 52, 56, 108, 124].flatMap((headerSize) => [false, true].map((topDown) => ({
      label: `bitfields-${bitDepth}-${headerSize}-${topDown ? 'top' : 'bottom'}`,
      bytes: bitmapFixture(16, 8, { bitDepth, headerSize, topDown, compression: 3 }), width: 16, height: 8,
    })))),
    { label: 'ico-png', bytes: iconFixture(32, 16, { png: true }), width: 32, height: 16 },
    { label: 'ico-dib', bytes: iconFixture(32, 16), width: 32, height: 16 },
    { label: 'svg-sized', bytes: svgFixture(160, 80), width: 160, height: 80 },
    { label: 'svg-viewbox', bytes: svgFixture(160, 80, { viewBoxOnly: true }), width: 160, height: 80 },
  ]
  for (const image of cases) {
    const result = await page.evaluate(async ({ encoded, width, height }) => {
      const binary = atob(encoded)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      const { importImage } = await import('/src/lib/imageImport.ts')
      const normalized = await importImage(bytes)
      if (normalized.width !== width || normalized.height !== height) return { normalized, pixels: null }
      const decoded = await createImageBitmap(new Blob([Uint8Array.from(atob(normalized.data), (char) => char.charCodeAt(0))], { type: normalized.mimeType }))
      const canvas = document.createElement('canvas'); canvas.width = normalized.width; canvas.height = normalized.height
      const context = canvas.getContext('2d')!
      context.drawImage(decoded, 0, 0)
      decoded.close()
      const left = context.getImageData(1, Math.floor(normalized.height / 2), 1, 1).data
      const right = context.getImageData(normalized.width - 2, Math.floor(normalized.height / 2), 1, 1).data
      return { normalized: { mimeType: normalized.mimeType, width: normalized.width, height: normalized.height }, pixels: { left: [...left], right: [...right] } }
    }, { encoded: image.bytes.toString('base64'), width: image.width, height: image.height })
    expect(result.normalized, image.label).toMatchObject({ mimeType: 'image/png', width: image.width, height: image.height })
    expect(result.pixels, image.label).not.toBeNull()
    const left = result.pixels!.left; const right = result.pixels!.right
    expect(left[0], `${image.label} left red`).toBeGreaterThan(left[2] + 80)
    expect(left[3], `${image.label} left alpha`).toBeGreaterThan(200)
    expect(right[2], `${image.label} right blue`).toBeGreaterThan(right[0] + 80)
    expect(right[3], `${image.label} right alpha`).toBeGreaterThan(200)
  }
})

test('SVG active content, external resources, animation, and recursive use are rejected before attachment', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: 'SVG security rejection' } })
  expect(created.ok()).toBe(true)
  const session = await created.json()
  await page.goto(`/s/${session.id}`)
  const marker = `svg-rejection-${randomUUID()}`
  const externalOrigin = `https://svg-rejection-${randomUUID()}.example.invalid`
  const outbound: string[] = []
  await page.route(`${externalOrigin}/**`, async (route) => {
    outbound.push(route.request().url())
    await route.abort()
  })
  const cases = [
    {
      name: 'unsafe-active.svg',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><script>window['${marker}']=true</script></svg>`,
    },
    {
      name: 'unsafe-event.svg',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" onload="window['${marker}']=true"><rect width="80" height="80"/></svg>`,
    },
    {
      name: 'unsafe-external.svg',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><image href="${externalOrigin}/image.png" width="160" height="80"/></svg>`,
    },
    {
      name: 'unsafe-external-css.svg',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><style>@import url("${externalOrigin}/style.css");</style></svg>`,
    },
    {
      name: 'unsafe-animation.svg',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="80" height="80"><animate attributeName="x" from="0" to="80" dur="1s"/></rect></svg>',
    },
    {
      name: 'unsafe-recursive-use.svg',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><defs><g id="loop"><use href="#loop"/></g></defs><use href="#loop"/></svg>',
    },
  ]
  try {
    for (const image of cases) {
      const picker = await selectImage(page, image.name, Buffer.from(image.body), 'image/svg+xml')
      await expect(picker.getByRole('alert')).toContainText('valid PNG')
      await expect(page.locator('[data-attachment-image-ready]')).toHaveCount(0)
      expect(await page.evaluate((needle) => document.documentElement.innerHTML.includes(needle), marker)).toBe(false)
      expect(await page.evaluate((key) => Boolean((window as unknown as Record<string, unknown>)[key]), marker)).toBe(false)
      await expect.poll(async () => (await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()).workspace.attachments.length).toBe(0)
      if (image.name === 'unsafe-active.svg') await page.screenshot({ path: '.data/image-review/svg-unsafe-rejected.png' })
      await page.keyboard.press('Escape')
    }
  } finally {
    await page.unroute(`${externalOrigin}/**`)
  }
  expect(outbound).toEqual([])
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
